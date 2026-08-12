/**
 * Call queue (call-center style) — parks callers when all agents are busy and
 * connects the longest-waiting caller to an agent (auto when one frees up, or
 * manually from the softphone queue panel).
 *
 * Transport: callers sit in a Twilio <Enqueue> queue with hold music + position.
 * Connecting a specific caller to a specific agent is done by REST-updating the
 * waiting call's TwiML to the /voice/webhook/queue/connect endpoint, which pulls
 * the caller out of the queue and dials the chosen agent's Voice SDK client.
 */
import twilio from 'twilio';
import { PhoneQueueEntryStatus, type PhoneQueueEntry } from '@prisma/client';
import prisma from '../config/database';
import { env } from '../config/env';
import { getAgencyTwilioCredentials } from './agencyTwilioService';
import { toVoiceIdentity } from './twilioVoice';
import { getUserRingGroups } from './inboundVoicemailAccess';
import { emitToUsers } from '../socket';

/** Deterministic Twilio queue name per ring group (Twilio names must be <= 64 chars). */
export function queueNameFor(subCompanyId: string, ringGroupId: string | null | undefined): string {
  const group = (ringGroupId ?? 'default').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
  const sub = subCompanyId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 30);
  return `q-${sub}-${group}`;
}

/** Public webhook base for background triggers (no request object available). */
export function publicWebhookBase(): string {
  const origin = (env.PUBLIC_API_URL ?? env.APP_URL).replace(/\/$/, '');
  const prefix = env.API_PREFIX.replace(/^\//, '').replace(/\/$/, '');
  return `${origin}/${prefix}/${env.API_VERSION}/voice/webhook`;
}

interface EnqueueCallerInput {
  subCompanyId: string;
  ringGroupId?: string | null;
  ringGroupName?: string | null;
  queueName: string;
  callSid: string;
  callerNumber: string;
  callerName?: string | null;
  inboundCallId?: string | null;
}

/** Records a caller entering the queue (idempotent per active callSid). */
export async function enqueueCaller(input: EnqueueCallerInput): Promise<PhoneQueueEntry> {
  const existing = await prisma.phoneQueueEntry.findFirst({
    where: { callSid: input.callSid, status: { in: [PhoneQueueEntryStatus.waiting, PhoneQueueEntryStatus.connecting] } },
    orderBy: { enqueuedAt: 'desc' },
  });
  if (existing) return existing;

  const entry = await prisma.phoneQueueEntry.create({
    data: {
      subCompanyId: input.subCompanyId,
      ringGroupId: input.ringGroupId ?? null,
      ringGroupName: input.ringGroupName ?? null,
      queueName: input.queueName,
      callSid: input.callSid,
      callerNumber: input.callerNumber,
      callerName: input.callerName ?? null,
      inboundCallId: input.inboundCallId ?? null,
      status: PhoneQueueEntryStatus.waiting,
    },
  });
  void notifyQueueForGroup(input.subCompanyId, input.ringGroupId ?? null);
  return entry;
}

function queueScopeFilter(ringGroupIds?: string[] | null) {
  return ringGroupIds && ringGroupIds.length
    ? {
        OR: [
          { ringGroupId: { in: ringGroupIds } },
          // Extension-dial and other agency-wide queues have no ring group.
          { ringGroupId: null },
        ],
      }
    : {};
}

export async function listWaiting(params: {
  subCompanyId: string;
  ringGroupIds?: string[] | null;
}): Promise<PhoneQueueEntry[]> {
  return prisma.phoneQueueEntry.findMany({
    where: {
      subCompanyId: params.subCompanyId,
      status: PhoneQueueEntryStatus.waiting,
      ...queueScopeFilter(params.ringGroupIds),
    },
    orderBy: { enqueuedAt: 'asc' },
  });
}

/** In-progress pickups assigned to this agent (hidden from other agents). */
export async function listConnectingForAgent(params: {
  subCompanyId: string;
  userId: string;
  ringGroupIds?: string[] | null;
}): Promise<PhoneQueueEntry[]> {
  return prisma.phoneQueueEntry.findMany({
    where: {
      subCompanyId: params.subCompanyId,
      status: PhoneQueueEntryStatus.connecting,
      connectedUserId: params.userId,
      ...queueScopeFilter(params.ringGroupIds),
    },
    orderBy: { enqueuedAt: 'asc' },
  });
}

/**
 * Redirect a waiting caller's live call to the connect endpoint, which dials the
 * chosen agent's client. Returns true when the REST update succeeded.
 */
export async function connectEntryToAgent(entryId: string, userId: string): Promise<boolean> {
  const entry = await prisma.phoneQueueEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.status !== PhoneQueueEntryStatus.waiting) return false;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!user) return false;

  const creds = await getAgencyTwilioCredentials(entry.subCompanyId);
  if (!creds) return false;

  const identity = toVoiceIdentity(user.id, user.email);
  const connectUrl =
    `${publicWebhookBase()}/queue/connect` +
    `?entryId=${encodeURIComponent(entry.id)}` +
    `&agent=${encodeURIComponent(identity)}` +
    `&userId=${encodeURIComponent(user.id)}`;

  // Reserve first so a second free agent can't grab the same caller.
  await setEntryStatus(entry.id, PhoneQueueEntryStatus.connecting, { connectedUserId: userId });

  try {
    const client = twilio(creds.accountSid, creds.authToken);
    await client.calls(entry.callSid).update({ method: 'POST', url: connectUrl });
    return true;
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 21220) {
      console.warn('[callQueue] pickup: caller already gone, abandoning entry', entry.id);
      await setEntryStatus(entry.id, PhoneQueueEntryStatus.abandoned);
      return false;
    }
    console.error('[callQueue] connectEntryToAgent REST update failed:', err);
    await setEntryStatus(entry.id, PhoneQueueEntryStatus.waiting, { connectedUserId: null });
    return false;
  }
}

export async function setEntryStatus(
  entryId: string,
  status: PhoneQueueEntryStatus,
  extra?: { connectedUserId?: string | null },
): Promise<PhoneQueueEntry | null> {
  const now = new Date();
  const data: Record<string, unknown> = { status };
  if (status === PhoneQueueEntryStatus.connecting || status === PhoneQueueEntryStatus.connected) {
    if (extra?.connectedUserId !== undefined) data.connectedUserId = extra.connectedUserId;
    if (status === PhoneQueueEntryStatus.connected) data.connectedAt = now;
  }
  if (
    status === PhoneQueueEntryStatus.abandoned ||
    status === PhoneQueueEntryStatus.timeout ||
    status === PhoneQueueEntryStatus.connected
  ) {
    data.endedAt = now;
  }
  const entry = await prisma.phoneQueueEntry
    .update({ where: { id: entryId }, data })
    .catch(() => null);
  if (entry) void notifyQueueForGroup(entry.subCompanyId, entry.ringGroupId);
  return entry;
}

/** Mark any waiting/connecting entry for a callSid as ended (caller hung up / call done). */
export async function releaseByCallSid(
  callSid: string,
  status: PhoneQueueEntryStatus = PhoneQueueEntryStatus.abandoned,
): Promise<void> {
  const entries = await prisma.phoneQueueEntry.findMany({
    where: { callSid, status: { in: [PhoneQueueEntryStatus.waiting, PhoneQueueEntryStatus.connecting] } },
  });
  if (entries.length === 0) return;
  await prisma.phoneQueueEntry.updateMany({
    where: { id: { in: entries.map((e) => e.id) } },
    data: { status, endedAt: new Date() },
  });
  for (const e of entries) void notifyQueueForGroup(e.subCompanyId, e.ringGroupId);
}

/**
 * Manually remove a waiting/connecting caller from the queue (agent dismisses a
 * stale or unwanted entry). Marks it abandoned and notifies listeners.
 */
export async function cancelEntry(entryId: string): Promise<boolean> {
  const entry = await prisma.phoneQueueEntry.findUnique({ where: { id: entryId } });
  if (!entry) return false;
  if (
    entry.status !== PhoneQueueEntryStatus.waiting &&
    entry.status !== PhoneQueueEntryStatus.connecting
  ) {
    return true;
  }
  await setEntryStatus(entryId, PhoneQueueEntryStatus.abandoned);
  return true;
}

/** Auto-dequeue: connect the longest-waiting caller in one of the agent's ring groups. */
export async function connectNextForAgent(
  userId: string,
  subCompanyId: string | null | undefined,
): Promise<boolean> {
  const sub = subCompanyId ?? (await prisma.agentPhonePresence.findUnique({ where: { userId } }))?.subCompanyId;
  if (!sub) return false;

  const groups = await getUserRingGroups(sub, userId);
  const groupIds = groups.map((g) => g.id);
  const waiting = await listWaiting({ subCompanyId: sub, ringGroupIds: groupIds.length ? groupIds : undefined });
  const next = waiting[0];
  if (!next) return false;
  return connectEntryToAgent(next.id, userId);
}

/** Notify members of a ring group (and agency) that the queue changed, for live UI. */
async function notifyQueueForGroup(subCompanyId: string, ringGroupId: string | null): Promise<void> {
  try {
    const bundleGroups = await prisma.phoneAgencyConfig.findUnique({
      where: { subCompanyId },
      select: { ringGroups: true },
    });
    const ringGroups = (bundleGroups?.ringGroups as Array<{ id: string; members?: Array<{ userId: string }> }> | null) ?? [];
    const memberIds = new Set<string>();
    for (const g of ringGroups) {
      if (ringGroupId && g.id !== ringGroupId) continue;
      for (const m of g.members ?? []) memberIds.add(m.userId);
    }
    if (memberIds.size) emitToUsers([...memberIds], 'queue:refresh', { subCompanyId });
  } catch (err) {
    console.error('[callQueue] notifyQueueForGroup failed:', err);
  }
}
