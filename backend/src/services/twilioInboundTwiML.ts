/**
 * Inbound PSTN → TwiML interpreter for published call-flow graphs.
 */
import twilio from 'twilio';
import { InboundCallOutcome, Prisma } from '@prisma/client';
import prisma from '../config/database';
import { normalizeToE164 } from '../utils/phoneE164';
import {
  ensureExtensionDialInFlow,
  ensureBusinessHoursInFlow,
  ensureQueueOnBusyInFlow,
  ensureExtensionMessageNodesInFlow,
  ensureGreetingClipExtensionHint,
  resolveExtensionDialNodeId,
} from './phoneSystemFlowRepair';
import {
  edgeTarget,
  followEdge,
  findGatherNode,
  isGatherMenuDigit,
  mainMenuResumeNodeId,
  repairFlowEdges,
  type CallFlowGraph,
} from './callFlowRouter';
import { ensureSystemAudioClips, SYSTEM_CLIP_NAMES } from './phoneSystemSystemClips';
import {
  clipScriptText,
  findAudioClipByName,
  normalizeAudioClips,
  renderAudioClipPlayback,
  resolveAudioClipSourceType,
} from './phoneSystemAudioClips';
import { PhoneQueueEntryStatus } from '@prisma/client';
import { orderRingableMembers, filterMembersByInboundCapacity } from './agentPresence';
import { enqueueCaller, queueNameFor, releaseByCallSid } from './callQueue';
import {
  appendCallerConference,
  callerConferenceTwiml,
  conferenceRoomFor,
  ringAgentsIntoConference,
  handleInboundCallerRemoteHangup,
} from './conferenceBridge';

const VoiceResponse = twilio.twiml.VoiceResponse;

/** Default hold music played to callers waiting in a queue when no clip URL is set. */
const DEFAULT_QUEUE_HOLD_MUSIC_URL = 'https://demo.twilio.com/docs/classic.mp3';

interface InboundContext {
  callSid: string;
  from: string;
  to: string;
  digits?: string;
  dialCallStatus?: string;
  webhookBase: string;
  subCompanyId: string;
  inboundCallId: string;
}

interface AgencyBundle {
  inboundEnabled: boolean;
  outboundCallerId: string | null;
  config: {
    gatherTimeoutSec: number;
    allowExtensionDialing: boolean;
    greetingClipName: string;
  };
  ringGroups: Array<{
    id: string;
    name: string;
    extension: string;
    dialTimeoutSec: number;
    ringStrategy: string;
    fallbackAction: string;
    fallbackVoicemailBoxId: string;
    fallbackForwardE164: string;
    members: Array<{ userId: string; userName: string }>;
  }>;
  voicemailBoxes: Array<{ id: string; name: string; extension: string }>;
  staffExtensions: Array<{ userId: string; userName: string; extension: string }>;
  audioClips: Array<{
    id?: string;
    name: string;
    sourceType?: 'message' | 'upload';
    scriptText: string;
    r2Key?: string | null;
  }>;
  businessHours: Array<{ dayOfWeek: number; enabled: boolean; open: string; close: string; label: string }>;
  timezone: string;
  publishedFlow: CallFlowGraph;
}

const DEFAULT_TIMEZONE = 'America/Toronto';

function safeTimezone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Day of week (0=Sunday) and minute-of-day for `date` in the given IANA timezone. */
function localDayAndMinute(date: Date, timezone: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimezone(timezone),
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const dayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10) % 24;
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return { day: dayIndex < 0 ? date.getDay() : dayIndex, minute: hour * 60 + minute };
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  return value as T;
}

function findNode(flow: CallFlowGraph, id: string) {
  return flow.nodes.find((n) => n.id === id);
}

function findTriggerNode(flow: CallFlowGraph) {
  return flow.nodes.find((n) => n.type === 'trigger_incoming') ?? flow.nodes[0];
}

function clipScript(
  clips: AgencyBundle['audioClips'],
  clipName: string | undefined,
  fallback = 'Please hold.',
): string {
  return clipScriptText(clips, clipName, fallback);
}

function renderAudioClip(
  target: { say: (text: string) => unknown; play: (url: string) => unknown },
  clips: AgencyBundle['audioClips'],
  clipName: string | undefined,
  subCompanyId: string,
  fallback = 'Please hold.',
): void {
  renderAudioClipPlayback(target, clips, clipName, subCompanyId, fallback);
}

function nodeClipName(nodeData: Record<string, unknown>, field: string, defaultName: string): string {
  const raw = nodeData[field];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : defaultName;
}

function normalizeGatherDigits(raw: string | undefined): string {
  return (raw ?? '').replace(/#/g, '').trim();
}

function extensionDialNode(flow: CallFlowGraph) {
  return flow.nodes.find((n) => n.type === 'connect_extension');
}

function isExtensionDialingEnabled(bundle: AgencyBundle, flow: CallFlowGraph): boolean {
  if (!bundle.config.allowExtensionDialing) return false;
  const node = extensionDialNode(flow);
  return Boolean(node && node.data.enabled !== false);
}

function shouldRouteExtensionDigits(
  digits: string,
  allowExtension: boolean,
  flow: CallFlowGraph,
  gatherId: string,
): boolean {
  const normalized = normalizeGatherDigits(digits);
  if (!allowExtension || !normalized) return false;
  if (normalized.length === 1 && isGatherMenuDigit(flow, gatherId, normalized)) return false;
  return true;
}

function gatherMenuPrompt(bundle: AgencyBundle): string {
  return clipScript(
    bundle.audioClips,
    bundle.config.greetingClipName,
    'Please make a selection.',
  );
}

function gatherTimeoutSec(
  node: { data: Record<string, unknown> },
  bundle: AgencyBundle,
): number {
  return (
    (typeof node.data.timeoutSec === 'number' ? node.data.timeoutSec : null) ??
    bundle.config.gatherTimeoutSec
  );
}

/**
 * Builds main-menu gather TwiML (greeting inside Gather, action-only timeout).
 * When extension dialing is enabled: finishOnKey=# so callers can dial 105#.
 * When disabled: numDigits=1 for immediate single-key menu routing.
 */
export function buildGatherDtmfTwiml(
  bundle: AgencyBundle,
  node: { data: Record<string, unknown> },
  webhookBase: string,
  vr = new VoiceResponse(),
  flow?: CallFlowGraph,
  subCompanyId?: string,
): string {
  const gatherUrl = `${webhookBase}/inbound`;
  const extDialEnabled = flow
    ? isExtensionDialingEnabled(bundle, flow)
    : bundle.config.allowExtensionDialing;
  const gatherOpts: {
    timeout: number;
    action: string;
    method: 'POST';
    numDigits?: number;
    finishOnKey?: string;
  } = {
    timeout: gatherTimeoutSec(node, bundle),
    action: gatherUrl,
    method: 'POST',
  };
  if (extDialEnabled) {
    gatherOpts.finishOnKey = '#';
  } else {
    gatherOpts.numDigits = 1;
  }
  const gather = vr.gather(gatherOpts);
  if (subCompanyId) {
    renderAudioClip(
      gather,
      bundle.audioClips,
      bundle.config.greetingClipName,
      subCompanyId,
      'Please make a selection.',
    );
  } else {
    gather.say(gatherMenuPrompt(bundle));
  }
  return vr.toString();
}

export function gatherTimeoutBehavior(
  node: { data: Record<string, unknown> },
): 'loop' | 'end' {
  return node.data.timeoutBehavior === 'end' ? 'end' : 'loop';
}

/** Target node after conference bridge rings out with no agent join. */
export function resolveConferenceNoAnswerTarget(
  flow: CallFlowGraph,
  nodeId: string,
): string | null {
  return (
    dialOutcomeEdgeTarget(flow, nodeId, 'no-answer') ?? edgeTarget(flow, nodeId, 'busy')
  );
}

async function loadAgencyBundle(subCompanyId: string): Promise<AgencyBundle | null> {
  const config = await prisma.phoneAgencyConfig.findUnique({ where: { subCompanyId } });
  if (!config) return null;

  const publishedFlow = parseJson<CallFlowGraph | null>(config.publishedFlow, null);
  if (!publishedFlow?.nodes?.length) return null;

  const withExtDial =
    ensureExtensionDialInFlow(publishedFlow, config.allowExtensionDialing) ?? publishedFlow;
  const withBusinessHours = ensureBusinessHoursInFlow(withExtDial) ?? withExtDial;
  const withQueues = ensureQueueOnBusyInFlow(withBusinessHours) ?? withBusinessHours;
  const withExtMessages = ensureExtensionMessageNodesInFlow(withQueues) ?? withQueues;
  const repairedFlow = repairFlowEdges(withExtMessages);
  const audioClips = normalizeAudioClips(
    ensureSystemAudioClips(
      ensureGreetingClipExtensionHint(
        parseJson<Array<{ name: string; scriptText: string }>>(config.audioClips, []),
      ),
    ),
  );

  return {
    inboundEnabled: config.inboundEnabled,
    outboundCallerId: config.outboundCallerId,
    config: {
      gatherTimeoutSec: config.gatherTimeoutSec,
      allowExtensionDialing: config.allowExtensionDialing,
      greetingClipName: config.greetingClipName ?? 'Greeting Options',
    },
    ringGroups: parseJson(config.ringGroups, []),
    voicemailBoxes: parseJson(config.voicemailBoxes, []),
    staffExtensions: parseJson(config.staffExtensions, []),
    audioClips,
    businessHours: parseJson(config.businessHours, []),
    timezone: safeTimezone(config.timezone),
    publishedFlow: repairedFlow,
  };
}

export async function resolveAgencyByDid(toRaw: string): Promise<{ subCompanyId: string; e164: string } | null> {
  const trimmed = toRaw?.trim() ?? '';
  if (!trimmed) return null;

  const e164 = normalizeToE164(trimmed);
  const candidates = new Set<string>();
  if (e164) candidates.add(e164);
  const digits = trimmed.replace(/\D/g, '');
  if (digits) {
    candidates.add(`+${digits}`);
    if (digits.length === 11 && digits.startsWith('1')) candidates.add(`+${digits}`);
    if (digits.length === 10) candidates.add(`+1${digits}`);
  }

  for (const candidate of candidates) {
    // A DID may exist on multiple agencies (shared outbound caller ID). Inbound
    // must be deterministic, so the earliest-created active number wins.
    const row = await prisma.phoneNumber.findFirst({
      where: { e164: candidate, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { subCompanyId: true, e164: true },
    });
    if (row) return { subCompanyId: row.subCompanyId, e164: row.e164 };
  }

  // Last resort: digit-only match (Twilio To vs stored E.164 formatting differences)
  if (digits.length >= 10) {
    const numbers = await prisma.phoneNumber.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { subCompanyId: true, e164: true },
    });
    const match = numbers.find((n) => {
      const nDigits = n.e164.replace(/\D/g, '');
      return nDigits === digits || nDigits.endsWith(digits) || digits.endsWith(nDigits);
    });
    if (match) return { subCompanyId: match.subCompanyId, e164: match.e164 };
  }

  return null;
}

async function ensureInboundCall(
  ctx: InboundContext,
  node: { data: Record<string, unknown> } | undefined,
): Promise<void> {
  if (ctx.inboundCallId) return;

  const menuKey = typeof node?.data.menuKey === 'number' ? node.data.menuKey : null;
  const departmentLabel =
    (typeof node?.data.callerIdLabel === 'string' ? node.data.callerIdLabel : null) ??
    (typeof node?.data.label === 'string' ? node.data.label : null);
  const ringGroupName = typeof node?.data.ringGroupName === 'string' ? node.data.ringGroupName : null;
  const ringGroupId = typeof node?.data.ringGroupId === 'string' ? node.data.ringGroupId : null;

  const call = await prisma.inboundCall.upsert({
    where: { twilioCallSid: ctx.callSid },
    create: {
      subCompanyId: ctx.subCompanyId,
      fromNumber: ctx.from,
      toNumber: ctx.to,
      menuKey,
      departmentLabel,
      ringGroupName,
      ringGroupId,
      outcome: InboundCallOutcome.no_answer,
      startedAt: new Date(),
      twilioCallSid: ctx.callSid,
    },
    update: {
      menuKey,
      departmentLabel,
      ringGroupName,
      ringGroupId,
    },
  });
  ctx.inboundCallId = call.id;
  void prisma.phoneCallSession
    .update({
      where: { callSid: ctx.callSid },
      data: { inboundCallId: call.id },
    })
    .catch(() => undefined);
}

/** Non-blocking — participant rows are for CRM history, not TwiML. */
function syncInboundParticipants(
  inboundCallId: string,
  members: Array<{ userId: string; userName: string }>,
  users: Array<{ id: string; email: string | null }>,
): void {
  const userById = new Map(users.map((u) => [u.id, u]));
  void (async () => {
    await prisma.inboundCallParticipant.deleteMany({ where: { inboundCallId } });
    const rows = members
      .filter((m) => userById.has(m.userId))
      .map((m) => ({
        inboundCallId,
        userId: m.userId,
        userName: m.userName,
      }));
    if (rows.length) {
      await prisma.inboundCallParticipant.createMany({ data: rows });
    }
  })().catch((err) => console.error('[inbound] participant sync failed:', err));
}

/** Dial action must hit /inbound so buildInboundTwiML receives DialCallStatus and can run fallback edges. */
function dialActionUrl(ctx: InboundContext): string {
  return `${ctx.webhookBase}/inbound`;
}

type RingGroupRecord = AgencyBundle['ringGroups'][number];

interface RingGroupDialState {
  groupId: string;
  memberIndex: number;
  sourceNodeId: string;
  sourceType: 'connect_group' | 'connect_extension';
}

interface DialableRingMember {
  userId: string;
  userName: string;
  email: string | null;
}

/**
 * Outcome of a dial attempt.
 * - dialed: Client legs were emitted.
 * - allBusy: members exist but none are currently available (route to the "busy" edge → queue).
 */
interface DialResult {
  dialed: boolean;
  allBusy: boolean;
}

function parseRingGroupDialState(metadata: unknown): RingGroupDialState | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = (metadata as { ringGroupDial?: unknown }).ringGroupDial;
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (
    typeof s.groupId !== 'string' ||
    typeof s.memberIndex !== 'number' ||
    typeof s.sourceNodeId !== 'string' ||
    (s.sourceType !== 'connect_group' && s.sourceType !== 'connect_extension')
  ) {
    return null;
  }
  return {
    groupId: s.groupId,
    memberIndex: s.memberIndex,
    sourceNodeId: s.sourceNodeId,
    sourceType: s.sourceType,
  };
}

function ringGroupFallbackNodeData(group: RingGroupRecord): Record<string, unknown> {
  return {
    ringGroupId: group.id,
    ringGroupName: group.name,
    fallbackAction: group.fallbackAction,
    voicemailBoxId: group.fallbackVoicemailBoxId,
    forwardToE164: group.fallbackForwardE164,
    fallbackForwardE164: group.fallbackForwardE164,
    dialTimeoutSec: group.dialTimeoutSec,
  };
}

function tagInboundVoicemail(
  ctx: InboundContext,
  bundle: AgencyBundle,
  nodeData: Record<string, unknown>,
): void {
  if (!ctx.inboundCallId) return;
  const ringGroupId = typeof nodeData.ringGroupId === 'string' ? nodeData.ringGroupId : null;
  const voicemailBoxId = typeof nodeData.voicemailBoxId === 'string' ? nodeData.voicemailBoxId : null;
  const vm = voicemailBoxId
    ? bundle.voicemailBoxes.find((v) => v.id === voicemailBoxId)
    : undefined;
  void prisma.inboundCall
    .update({
      where: { id: ctx.inboundCallId },
      data: {
        outcome: InboundCallOutcome.voicemail,
        ringGroupId,
        ringGroupName:
          typeof nodeData.ringGroupName === 'string' ? nodeData.ringGroupName : undefined,
        voicemailBoxId,
        voicemailBoxName: vm?.name ?? null,
      },
    })
    .catch((err) => console.error('[inbound] tag voicemail failed:', err));
}

async function getDialableRingGroupMembers(
  members: RingGroupRecord['members'],
): Promise<DialableRingMember[]> {
  if (members.length === 0) return [];
  const memberIds = members.map((m) => m.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: memberIds } },
    select: { id: true, email: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));
  return members
    .filter((m) => userById.has(m.userId))
    .map((m) => {
      const user = userById.get(m.userId)!;
      return { userId: m.userId, userName: m.userName, email: user.email };
    });
}

async function persistSessionNode(
  ctx: InboundContext,
  flowNodeId: string,
  ringGroupDial?: RingGroupDialState | null,
  extDialRingGroupId?: string | null,
): Promise<void> {
  const existing = await prisma.phoneCallSession.findUnique({ where: { callSid: ctx.callSid } });
  const prevMeta =
    existing?.metadata && typeof existing.metadata === 'object'
      ? { ...(existing.metadata as Record<string, unknown>) }
      : {};
  // Drop legacy two-step extension buffer if still present on older sessions.
  delete prevMeta.extDialBuffer;
  if (ringGroupDial !== undefined) {
    if (ringGroupDial === null) {
      delete prevMeta.ringGroupDial;
    } else {
      prevMeta.ringGroupDial = ringGroupDial;
    }
  }
  if (extDialRingGroupId !== undefined) {
    if (extDialRingGroupId === null) {
      delete prevMeta.extDialRingGroupId;
    } else {
      prevMeta.extDialRingGroupId = extDialRingGroupId;
    }
  }
  const metadataValue: Prisma.InputJsonValue | undefined = Object.keys(prevMeta).length
    ? (prevMeta as Prisma.InputJsonValue)
    : undefined;
  await prisma.phoneCallSession.upsert({
    where: { callSid: ctx.callSid },
    create: {
      callSid: ctx.callSid,
      subCompanyId: ctx.subCompanyId,
      inboundCallId: ctx.inboundCallId || null,
      flowNodeId,
      metadata: metadataValue,
    },
    update: {
      flowNodeId,
      metadata: metadataValue ?? Prisma.DbNull,
    },
  });
}

function renderFallbackAction(
  vr: twilio.twiml.VoiceResponse,
  ctx: InboundContext,
  bundle: AgencyBundle,
  nodeData: Record<string, unknown>,
  callerId: string,
): void {
  const action = (nodeData.fallbackAction as string) ?? 'voicemail';
  if (action === 'forward') {
    const forwardRaw =
      (nodeData.forwardToE164 as string) ||
      (nodeData.fallbackForwardE164 as string) ||
      '';
    const forwardTo = normalizeToE164(forwardRaw);
    if (forwardTo) {
      const dial = vr.dial({
        callerId,
        timeout: (nodeData.dialTimeoutSec as number) ?? 30,
        action: dialActionUrl(ctx),
        method: 'POST',
      });
      dial.number(forwardTo);
      return;
    }
  }
  tagInboundVoicemail(ctx, bundle, nodeData);
  const vmClip = nodeClipName(nodeData, 'voicemailClipName', SYSTEM_CLIP_NAMES.voicemailPrompt);
  renderAudioClip(
    vr,
    bundle.audioClips,
    vmClip,
    ctx.subCompanyId,
    'Please leave a message after the tone.',
  );
  vr.record({
    maxLength: 120,
    playBeep: true,
    recordingStatusCallback: `${ctx.webhookBase}/inbound/recording?inboundCallId=${encodeURIComponent(ctx.inboundCallId)}`,
    recordingStatusCallbackMethod: 'POST',
  });
}

/**
 * Park the PSTN caller in a conference and REST-ring agents into the same room.
 * Enables PSTN hold with music via participant hold API.
 */
async function dialAgentsViaConference(
  vr: twilio.twiml.VoiceResponse,
  ctx: InboundContext,
  params: {
    members: DialableRingMember[];
    callerId: string;
    sourceNodeId: string;
    dialTimeoutSec: number;
    departmentLabel: string;
    ringGroupId?: string;
    ringGroupName?: string;
    sequentialState?: RingGroupDialState | null;
    extDialRingGroupId?: string | null;
    participantMembers?: Array<{ userId: string; userName: string }>;
    participantUsers?: Array<{ id: string; email: string | null }>;
  },
): Promise<boolean> {
  if (!ctx.inboundCallId || params.members.length === 0) return false;

  const members = await filterMembersByInboundCapacity(params.members);
  if (members.length === 0) return false;

  const conferenceRoom = conferenceRoomFor(ctx.inboundCallId);

  const legsRung = await ringAgentsIntoConference({
    inboundCallId: ctx.inboundCallId,
    subCompanyId: ctx.subCompanyId,
    conferenceRoom,
    members: members.map((m) => ({
      userId: m.userId,
      userName: m.userName,
      email: m.email,
    })),
    callerId: params.callerId,
    meta: {
      fromNumber: ctx.from,
      toNumber: ctx.to,
      departmentLabel: params.departmentLabel,
    },
    dialTimeoutSec: params.dialTimeoutSec,
  });

  if (legsRung === 0) return false;

  await persistSessionNode(
    ctx,
    params.sourceNodeId,
    params.sequentialState ?? null,
    params.extDialRingGroupId ?? null,
  );

  appendCallerConference(vr, {
    conferenceRoom,
    inboundCallId: ctx.inboundCallId,
    subCompanyId: ctx.subCompanyId,
    webhookBase: ctx.webhookBase,
  });

  await prisma.inboundCall
    .update({
      where: { id: ctx.inboundCallId },
      data: {
        conferenceRoom,
        ...(params.ringGroupId
          ? { ringGroupId: params.ringGroupId, ringGroupName: params.ringGroupName }
          : {}),
      },
    })
    .catch((err) => console.error('[inbound] stamp conference room failed:', err));

  if (params.participantMembers && params.participantUsers) {
    syncInboundParticipants(ctx.inboundCallId, params.participantMembers, params.participantUsers);
  }

  return true;
}

async function dialRingGroupViaConference(
  vr: twilio.twiml.VoiceResponse,
  ctx: InboundContext,
  bundle: AgencyBundle,
  groupId: string | undefined,
  nodeData: Record<string, unknown>,
  callerId: string,
  sourceNodeId: string,
  sourceType: RingGroupDialState['sourceType'],
  memberIndex = 0,
): Promise<DialResult> {
  if (!ctx.inboundCallId) return { dialed: false, allBusy: false };

  const group = bundle.ringGroups.find((g) => g.id === groupId);
  if (!group) return { dialed: false, allBusy: false };

  const timeout = (nodeData.dialTimeoutSec as number) ?? group.dialTimeoutSec ?? 25;
  const dialable = await getDialableRingGroupMembers(group.members);
  if (dialable.length === 0) return { dialed: false, allBusy: false };

  const ringable = await orderRingableMembers(dialable);
  if (ringable.length === 0) return { dialed: false, allBusy: true };

  const strategy =
    group.ringStrategy === 'sequential'
      ? 'sequential'
      : group.ringStrategy === 'balanced'
        ? 'balanced'
        : 'simultaneous';

  let membersToRing: DialableRingMember[];
  let sequentialState: RingGroupDialState | null = null;
  if (strategy === 'simultaneous') {
    membersToRing = ringable;
  } else if (strategy === 'balanced') {
    membersToRing = [ringable[0]!];
  } else {
    const idx = Math.min(Math.max(memberIndex, 0), ringable.length - 1);
    membersToRing = [ringable[idx]!];
    sequentialState = { groupId: group.id, memberIndex: idx, sourceNodeId, sourceType };
  }

  const dialed = await dialAgentsViaConference(vr, ctx, {
    members: membersToRing,
    callerId,
    sourceNodeId,
    dialTimeoutSec: timeout,
    departmentLabel: group.name,
    ringGroupId: group.id,
    ringGroupName: group.name,
    sequentialState,
    extDialRingGroupId: sourceType === 'connect_extension' ? group.id : null,
    participantMembers: group.members,
    participantUsers: dialable.map((m) => ({ id: m.userId, email: m.email })),
  });

  // 0 legs created (capacity race / Twilio create failed) — treat as busy so
  // the flow prefers the busy → connect_queue edge instead of no-answer.
  if (!dialed) return { dialed: false, allBusy: true };

  return { dialed: true, allBusy: false };
}

async function continueSequentialRingGroupDial(
  ctx: InboundContext,
  bundle: AgencyBundle,
  dialState: RingGroupDialState,
  callerId: string,
): Promise<string | null> {
  const group = bundle.ringGroups.find((g) => g.id === dialState.groupId);
  if (!group) return null;

  const dialable = await getDialableRingGroupMembers(group.members);
  const ringable = await orderRingableMembers(dialable);
  const nextIndex = dialState.memberIndex + 1;
  if (nextIndex >= ringable.length) return null;

  const vr = new VoiceResponse();
  const nodeData = ringGroupFallbackNodeData(group);
  const result = await dialRingGroupViaConference(
    vr,
    ctx,
    bundle,
    group.id,
    nodeData,
    callerId,
    dialState.sourceNodeId,
    dialState.sourceType,
    nextIndex,
  );
  if (!result.dialed) return null;
  return vr.toString();
}

async function renderRingGroupNoAnswerFallback(
  ctx: InboundContext,
  bundle: AgencyBundle,
  flow: CallFlowGraph,
  dialState: RingGroupDialState,
  callerId: string,
  dialCallStatus?: string,
): Promise<string> {
  await persistSessionNode(ctx, dialState.sourceNodeId, null, null);

  if (dialState.sourceType === 'connect_group' || dialState.sourceType === 'connect_extension') {
    const fbId = dialOutcomeEdgeTarget(flow, dialState.sourceNodeId, dialCallStatus);
    if (fbId) {
      return renderFlow(ctx, bundle, fbId);
    }
  }

  const group = bundle.ringGroups.find((g) => g.id === dialState.groupId);
  if (group) {
    const vr = new VoiceResponse();
    renderFallbackAction(vr, ctx, bundle, ringGroupFallbackNodeData(group), callerId);
    return vr.toString();
  }

  const vr = new VoiceResponse();
  renderAudioClip(
    vr,
    bundle.audioClips,
    SYSTEM_CLIP_NAMES.noAgentsAvailable,
    ctx.subCompanyId,
    'No one is available to take your call. Goodbye.',
  );
  vr.hangup();
  return vr.toString();
}

function officeHoursScript(hours: AgencyBundle['businessHours'], timezone: string): string {
  const { day: today } = localDayAndMinute(new Date(), timezone);
  const day = hours.find((h) => h.dayOfWeek === today);
  if (!day?.enabled) return 'We are currently closed. Our regular hours are Monday through Friday, 9 AM to 5 PM.';
  return `Today we are open from ${day.open} to ${day.close}.`;
}

/** Minutes since midnight for an "HH:MM" string, or null when unparseable. */
function parseHhMm(value: string | undefined): number | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Whether the agency is currently open, per the Business hours settings.
 * Evaluated in the agency's configured IANA `timezone` (not the server clock),
 * so hours set in local time route correctly regardless of where the app runs.
 *
 * Overnight ranges are supported: when `close < open` the window wraps past
 * midnight (e.g. 09:00–08:00 = open until 08:00 the next day). Such a day covers
 * two segments — the evening portion (`>= open`) on that weekday, and the
 * early-morning portion (`< close`) which spills into the following weekday.
 * `open === close` is treated as closed.
 */
export function isWithinBusinessHours(
  hours: AgencyBundle['businessHours'],
  timezone: string = DEFAULT_TIMEZONE,
  now: Date = new Date(),
): boolean {
  const { day: dayOfWeek, minute: minutes } = localDayAndMinute(now, timezone);

  // Today's own window (same-day or the evening side of an overnight window).
  const today = hours.find((h) => h.dayOfWeek === dayOfWeek);
  if (today?.enabled) {
    const open = parseHhMm(today.open);
    const close = parseHhMm(today.close);
    if (open != null && close != null) {
      if (open < close) {
        if (minutes >= open && minutes < close) return true;
      } else if (open > close) {
        // Overnight: open from `open` through end of day.
        if (minutes >= open) return true;
      }
    }
  }

  // Early-morning spillover from the previous day's overnight window.
  const prevDayOfWeek = (dayOfWeek + 6) % 7;
  const prev = hours.find((h) => h.dayOfWeek === prevDayOfWeek);
  if (prev?.enabled) {
    const open = parseHhMm(prev.open);
    const close = parseHhMm(prev.close);
    if (open != null && close != null && open > close && minutes < close) {
      return true;
    }
  }

  return false;
}

/**
 * Fallback edge for a finished dial. A busy leg prefers a dedicated "busy" edge
 * and falls back to "no answer" so existing flows keep working unchanged.
 */
function dialOutcomeEdgeTarget(
  flow: CallFlowGraph,
  nodeId: string,
  dialCallStatus: string | undefined,
): string | null {
  if (dialCallStatus === 'busy') {
    return edgeTarget(flow, nodeId, 'busy') ?? edgeTarget(flow, nodeId, 'no answer');
  }
  return edgeTarget(flow, nodeId, 'no answer');
}

async function renderFlow(
  ctx: InboundContext,
  bundle: AgencyBundle,
  startNodeId: string,
): Promise<string> {
  const flow = bundle.publishedFlow;
  const vr = new VoiceResponse();
  const callerId = bundle.outboundCallerId ?? ctx.to;

  let currentId: string | null = startNodeId;
  let steps = 0;
  let lastNodeId = startNodeId;

  while (currentId && steps < 12) {
    steps += 1;
    const node = findNode(flow, currentId);
    if (!node) break;
    lastNodeId = currentId;

    switch (node.type) {
      case 'trigger_incoming': {
        currentId = edgeTarget(flow, node.id);
        continue;
      }
      case 'play_message': {
        renderAudioClip(
          vr,
          bundle.audioClips,
          node.data.clipName as string,
          ctx.subCompanyId,
          bundle.config.greetingClipName,
        );
        currentId = edgeTarget(flow, node.id);
        continue;
      }
      case 'gather_dtmf': {
        await persistSessionNode(ctx, currentId);
        return buildGatherDtmfTwiml(bundle, node, ctx.webhookBase, vr, flow, ctx.subCompanyId);
      }
      case 'connect_group': {
        await ensureInboundCall(ctx, node);
        if (node.data.isFallback) {
          renderFallbackAction(vr, ctx, bundle, node.data, callerId);
          void persistSessionNode(ctx, currentId).catch(() => undefined);
          return vr.toString();
        }
        const group = bundle.ringGroups.find((g) => g.id === (node.data.ringGroupId as string));
        const members = group?.members ?? [];
        if (members.length === 0) {
          const fbId = edgeTarget(flow, node.id, 'no answer');
          if (fbId) {
            return renderFlow(ctx, bundle, fbId);
          }
          const noAgentsClip = nodeClipName(
            node.data,
            'noAgentsClipName',
            SYSTEM_CLIP_NAMES.noAgentsAvailable,
          );
          renderAudioClip(
            vr,
            bundle.audioClips,
            noAgentsClip,
            ctx.subCompanyId,
            'No agents are available. Please try again later.',
          );
          vr.hangup();
          void persistSessionNode(ctx, currentId).catch(() => undefined);
          return vr.toString();
        }
        const result = await dialRingGroupViaConference(
          vr,
          ctx,
          bundle,
          node.data.ringGroupId as string | undefined,
          node.data,
          callerId,
          currentId,
          'connect_group',
        );
        if (!result.dialed) {
          // All agents busy → prefer the "busy" edge (typically a queue). Otherwise
          // (no members, no matching group) fall back to the "no answer" edge.
          const primaryLabel = result.allBusy ? 'busy' : 'no answer';
          const fbId =
            edgeTarget(flow, node.id, primaryLabel) ??
            edgeTarget(flow, node.id, 'no answer') ??
            edgeTarget(flow, node.id, 'busy');
          if (fbId) {
            return renderFlow(ctx, bundle, fbId);
          }
          const noAgentsClip = nodeClipName(
            node.data,
            'noAgentsClipName',
            SYSTEM_CLIP_NAMES.noAgentsAvailable,
          );
          renderAudioClip(
            vr,
            bundle.audioClips,
            noAgentsClip,
            ctx.subCompanyId,
            'No agents are available. Please try again later.',
          );
          vr.hangup();
          void persistSessionNode(ctx, currentId).catch(() => undefined);
          return vr.toString();
        }
        void persistSessionNode(ctx, currentId).catch(() => undefined);
        return vr.toString();
      }
      case 'connect_extension': {
        if (!isExtensionDialingEnabled(bundle, flow)) {
          const { targetId } = followEdge(flow, node.id, ['disabled']);
          const nextId = targetId ?? mainMenuResumeNodeId(flow);
          if (!targetId) {
            console.warn(
              `[callFlow] connect_extension disabled with no outgoing edge; falling back to ${nextId}`,
            );
          }
          return renderFlow(ctx, bundle, nextId);
        }
        await ensureInboundCall(ctx, node);
        const ext = normalizeGatherDigits(ctx.digits);
        const staff = bundle.staffExtensions.find((s) => s.extension === ext);
        if (staff) {
          const user = await prisma.user.findUnique({
            where: { id: staff.userId },
            select: { id: true, email: true },
          });
          if (user) {
            const member: DialableRingMember = {
              userId: staff.userId,
              userName: staff.userName,
              email: user.email,
            };
            const ringable = await orderRingableMembers([member]);
            if (ringable.length === 0) {
              const { targetId: busyId } = followEdge(flow, node.id, ['busy']);
              if (busyId) {
                return renderFlow(ctx, bundle, busyId);
              }
              const { targetId: noAnswerId } = followEdge(flow, node.id, ['no answer']);
              if (noAnswerId) {
                return renderFlow(ctx, bundle, noAnswerId);
              }
            } else {
              const dialed = await dialAgentsViaConference(vr, ctx, {
                members: ringable,
                callerId,
                sourceNodeId: currentId,
                dialTimeoutSec: 25,
                departmentLabel: `Ext ${ext}`,
                participantMembers: [{ userId: staff.userId, userName: staff.userName }],
                participantUsers: [{ id: user.id, email: user.email }],
              });
              if (dialed) {
                void persistSessionNode(ctx, currentId).catch(() => undefined);
                return vr.toString();
              }
            }
          }
          const { targetId: busyId } = followEdge(flow, node.id, ['busy']);
          if (busyId) {
            return renderFlow(ctx, bundle, busyId);
          }
          const { targetId: noAnswerId } = followEdge(flow, node.id, ['no answer']);
          if (noAnswerId) {
            return renderFlow(ctx, bundle, noAnswerId);
          }
        }
        const ringGroup = bundle.ringGroups.find((g) => g.extension === ext);
        if (ringGroup) {
          await ensureInboundCall(ctx, {
            data: {
              ringGroupId: ringGroup.id,
              ringGroupName: ringGroup.name,
              label: ringGroup.name,
            },
          });
          const extResult = await dialRingGroupViaConference(
            vr,
            ctx,
            bundle,
            ringGroup.id,
            ringGroupFallbackNodeData(ringGroup),
            callerId,
            currentId,
            'connect_extension',
          );
          if (extResult.dialed) {
            void persistSessionNode(ctx, currentId).catch(() => undefined);
            return vr.toString();
          }
          const { targetId: noAnswerId } = followEdge(flow, node.id, ['no answer']);
          if (noAnswerId) {
            return renderFlow(ctx, bundle, noAnswerId);
          }
          renderFallbackAction(
            vr,
            ctx,
            bundle,
            ringGroupFallbackNodeData(ringGroup),
            callerId,
          );
          void persistSessionNode(ctx, currentId).catch(() => undefined);
          return vr.toString();
        }
        const { targetId: notFoundId } = followEdge(flow, node.id, ['not found']);
        if (notFoundId) {
          return renderFlow(ctx, bundle, notFoundId);
        }
        const notFoundClip = nodeClipName(
          node.data,
          'notFoundClipName',
          SYSTEM_CLIP_NAMES.extensionNotFound,
        );
        renderAudioClip(
          vr,
          bundle.audioClips,
          notFoundClip,
          ctx.subCompanyId,
          'Extension not found.',
        );
        console.warn(
          `[callFlow] connect_extension missing "not found" edge; falling back to main menu`,
        );
        await persistSessionNode(ctx, mainMenuResumeNodeId(flow));
        vr.redirect(`${ctx.webhookBase}/inbound`);
        return vr.toString();
      }
      case 'business_hours': {
        const open = isWithinBusinessHours(bundle.businessHours, bundle.timezone);
        const branchId = edgeTarget(flow, node.id, open ? 'open' : 'closed');
        if (branchId) {
          currentId = branchId;
          continue;
        }
        // No branch wired for the current state — fall back to the other branch,
        // then to any single unlabeled edge, so the call is never silently dropped.
        const fallbackBranch =
          edgeTarget(flow, node.id, open ? 'closed' : 'open') ?? edgeTarget(flow, node.id);
        if (fallbackBranch) {
          console.warn(
            `[callFlow] business_hours node ${node.id} missing "${open ? 'open' : 'closed'}" edge; using fallback branch`,
          );
          currentId = fallbackBranch;
          continue;
        }
        vr.hangup();
        void persistSessionNode(ctx, node.id).catch(() => undefined);
        return vr.toString();
      }
      case 'play_office_hours': {
        const hoursClip = nodeClipName(node.data, 'clipName', 'Locations');
        const hoursLibraryClip = findAudioClipByName(bundle.audioClips, hoursClip);
        if (
          hoursLibraryClip &&
          resolveAudioClipSourceType(hoursLibraryClip) === 'upload' &&
          hoursLibraryClip.r2Key
        ) {
          renderAudioClip(vr, bundle.audioClips, hoursClip, ctx.subCompanyId, '');
        } else {
          const fromLibrary = clipScript(bundle.audioClips, hoursClip, '');
          vr.say(fromLibrary || officeHoursScript(bundle.businessHours, bundle.timezone));
        }
        currentId = edgeTarget(flow, node.id);
        if (!currentId) {
          vr.hangup();
          void persistSessionNode(ctx, node.id).catch(() => undefined);
          return vr.toString();
        }
        continue;
      }
      case 'invalid_message_loop': {
        const invalidClip =
          (typeof node.data.clipName === 'string' && node.data.clipName.trim()) || 'Invalid option';
        renderAudioClip(vr, bundle.audioClips, invalidClip, ctx.subCompanyId, 'Invalid option.');
        const { targetId } = followEdge(flow, node.id, []);
        if (targetId) {
          currentId = targetId;
          continue;
        }
        const loopTo = typeof node.data.loopTo === 'string' ? node.data.loopTo : undefined;
        const legacyTarget =
          (loopTo ? flow.nodes.find((n) => n.id === loopTo)?.id : undefined) ??
          findGatherNode(flow)?.id;
        if (legacyTarget) {
          console.warn(
            `[callFlow] invalid_message_loop missing outgoing edge; using legacy loopTo → ${legacyTarget}`,
          );
          currentId = legacyTarget;
          continue;
        }
        break;
      }
      case 'voicemail_directory': {
        await ensureInboundCall(ctx, node);
        const vmClip = nodeClipName(node.data, 'clipName', SYSTEM_CLIP_NAMES.voicemailPrompt);
        tagInboundVoicemail(ctx, bundle, node.data);
        renderAudioClip(
          vr,
          bundle.audioClips,
          vmClip,
          ctx.subCompanyId,
          'Please leave a message after the tone.',
        );
        vr.record({
          maxLength: 120,
          playBeep: true,
          recordingStatusCallback: `${ctx.webhookBase}/inbound/recording?inboundCallId=${encodeURIComponent(ctx.inboundCallId)}`,
          recordingStatusCallbackMethod: 'POST',
        });
        void persistSessionNode(ctx, currentId).catch(() => undefined);
        return vr.toString();
      }
      case 'connect_queue': {
        await ensureInboundCall(ctx, node);
        const ringGroupId =
          (typeof node.data.ringGroupId === 'string' && node.data.ringGroupId) || null;
        const group = ringGroupId
          ? bundle.ringGroups.find((g) => g.id === ringGroupId)
          : undefined;
        const effectiveGroupId = ringGroupId ?? group?.id ?? null;
        const queueName = queueNameFor(ctx.subCompanyId, effectiveGroupId);
        const maxWaitSec =
          typeof node.data.maxWaitSec === 'number' && node.data.maxWaitSec > 0
            ? node.data.maxWaitSec
            : 120;
        const holdMusicUrl =
          (typeof node.data.holdMusicUrl === 'string' && node.data.holdMusicUrl.trim()) ||
          DEFAULT_QUEUE_HOLD_MUSIC_URL;

        const entry = await enqueueCaller({
          subCompanyId: ctx.subCompanyId,
          ringGroupId: effectiveGroupId,
          ringGroupName:
            group?.name ??
            (typeof node.data.ringGroupName === 'string' ? node.data.ringGroupName : null),
          queueName,
          callSid: ctx.callSid,
          callerNumber: ctx.from,
          callerName: null,
          inboundCallId: ctx.inboundCallId || null,
        });

        const waitUrl =
          `${ctx.webhookBase}/queue/wait` +
          `?entryId=${encodeURIComponent(entry.id)}` +
          `&maxWaitSec=${maxWaitSec}` +
          `&music=${encodeURIComponent(holdMusicUrl)}`;
        const actionUrl = `${ctx.webhookBase}/queue/action?entryId=${encodeURIComponent(entry.id)}`;

        vr.enqueue(
          { waitUrl, waitUrlMethod: 'POST', action: actionUrl, method: 'POST' },
          queueName,
        );
        await persistSessionNode(ctx, currentId);
        return vr.toString();
      }
      default: {
        currentId = edgeTarget(flow, node.id);
      }
    }
  }

  renderAudioClip(
    vr,
    bundle.audioClips,
    SYSTEM_CLIP_NAMES.goodbye,
    ctx.subCompanyId,
    'Thank you for calling. Goodbye.',
  );
  vr.hangup();
  void persistSessionNode(ctx, lastNodeId).catch(() => undefined);
  return vr.toString();
}

export type InboundWebhookOutcome =
  | 'INVALID'
  | 'NO_AGENCY'
  | 'NO_FLOW'
  | 'INBOUND_DISABLED'
  | 'MISCONFIGURED'
  | 'OK';

export async function buildInboundTwiML(
  body: Record<string, string | undefined>,
  webhookBase: string,
  query?: Record<string, string | undefined>,
): Promise<{ twiml: string; status: number; outcome: InboundWebhookOutcome }> {
  const callSid = body.CallSid;
  const from = body.From ?? '';
  const to = body.To ?? body.Called ?? '';

  if (!callSid || !to) {
    const vr = new VoiceResponse();
    vr.say('Invalid call.');
    return { twiml: vr.toString(), status: 400, outcome: 'INVALID' };
  }

  const agency = await resolveAgencyByDid(to);
  if (!agency) {
    const vr = new VoiceResponse();
    vr.say('This number is not configured.');
    return { twiml: vr.toString(), status: 404, outcome: 'NO_AGENCY' };
  }

  const bundle = await loadAgencyBundle(agency.subCompanyId);
  if (!bundle) {
    const vr = new VoiceResponse();
    vr.say('Call flow not published. An administrator must publish the call flow in Phone System settings.');
    return { twiml: vr.toString(), status: 503, outcome: 'NO_FLOW' };
  }
  if (!bundle.inboundEnabled) {
    const vr = new VoiceResponse();
    vr.say('Inbound calling is disabled for this agency.');
    return { twiml: vr.toString(), status: 403, outcome: 'INBOUND_DISABLED' };
  }

  const flow = bundle.publishedFlow;
  let session = await prisma.phoneCallSession.findUnique({ where: { callSid } });
  const digits = body.Digits?.trim();
  const dialCallStatus = body.DialCallStatus;

  const ctx: InboundContext = {
    callSid,
    from,
    to: agency.e164,
    digits,
    dialCallStatus,
    webhookBase,
    subCompanyId: agency.subCompanyId,
    inboundCallId: session?.inboundCallId ?? '',
  };

  if (!session) {
    const trigger = findTriggerNode(flow);
    if (!trigger) {
      const vr = new VoiceResponse();
      vr.say('Call flow misconfigured.');
      return { twiml: vr.toString(), status: 503, outcome: 'MISCONFIGURED' };
    }
    session = await prisma.phoneCallSession.create({
      data: {
        callSid,
        subCompanyId: agency.subCompanyId,
        flowNodeId: trigger.id,
      },
    });
    ctx.inboundCallId = session.inboundCallId ?? '';
  }

  // Conference bridge rang agents but none joined — follow no-answer / busy fallback edge.
  if (query?.conferenceNoAnswer === '1') {
    const inboundCallIdFromQuery =
      typeof query.inboundCallId === 'string' ? query.inboundCallId : '';
    if (inboundCallIdFromQuery) {
      ctx.inboundCallId = inboundCallIdFromQuery;
    }
    if (session.flowNodeId) {
      const node = findNode(flow, session.flowNodeId);
      if (
        (node?.type === 'connect_group' && !node.data.isFallback) ||
        node?.type === 'connect_extension'
      ) {
        const fbId = resolveConferenceNoAnswerTarget(flow, node.id);
        if (fbId) {
          await persistSessionNode(ctx, node.id, null, null);
          const twiml = await renderFlow(ctx, bundle, fbId);
          return { twiml, status: 200, outcome: 'OK' };
        }
      }
    }
  }

  // Gather callback — route by digit (session must point at gather node)
  if (digits) {
    let gatherNode = session.flowNodeId ? findNode(flow, session.flowNodeId) : undefined;
    if (gatherNode?.type !== 'gather_dtmf') {
      const legacyGather = findGatherNode(flow);
      if (legacyGather) {
        console.warn(
          `[callFlow] gather callback with session at ${session.flowNodeId ?? 'none'}; using legacy gather lookup`,
        );
        gatherNode = legacyGather;
      }
    }
    if (gatherNode?.type === 'gather_dtmf') {
      const extDialEnabled = isExtensionDialingEnabled(bundle, flow);
      const normalized = normalizeGatherDigits(digits);

      if (shouldRouteExtensionDigits(digits, extDialEnabled, flow, gatherNode.id)) {
        const extId = resolveExtensionDialNodeId(flow, gatherNode.id);
        if (extId) {
          ctx.digits = normalized;
          const twiml = await renderFlow(ctx, bundle, extId);
          return { twiml, status: 200, outcome: 'OK' };
        }
      }

      const label = normalized;
      const { targetId: nextId } = followEdge(flow, gatherNode.id, [label, 'invalid']);
      if (nextId) {
        const twiml = await renderFlow(ctx, bundle, nextId);
        return { twiml, status: 200, outcome: 'OK' };
      }
      const legacyInvalidId = edgeTarget(flow, gatherNode.id, '0');
      if (legacyInvalidId) {
        console.warn('[callFlow] invalid menu digit used legacy gather "0" edge');
        const twiml = await renderFlow(ctx, bundle, legacyInvalidId);
        return { twiml, status: 200, outcome: 'OK' };
      }
    }
  }

  // Gather timed out (action with no digit) — loop (retry) or end per node config.
  if (!digits && !dialCallStatus && session.flowNodeId) {
    const gatherNode = findNode(flow, session.flowNodeId);
    if (gatherNode?.type === 'gather_dtmf') {
      if (gatherTimeoutBehavior(gatherNode) === 'end') {
        const endClip =
          (typeof gatherNode.data.timeoutEndClipName === 'string' &&
            gatherNode.data.timeoutEndClipName.trim()) ||
          SYSTEM_CLIP_NAMES.goodbye;
        const vr = new VoiceResponse();
        renderAudioClip(
          vr,
          bundle.audioClips,
          endClip,
          ctx.subCompanyId,
          'Thank you for calling. Goodbye.',
        );
        vr.hangup();
        return { twiml: vr.toString(), status: 200, outcome: 'OK' };
      }
      const timeoutId = edgeTarget(flow, gatherNode.id, 'timeout');
      if (timeoutId) {
        const twiml = await renderFlow(ctx, bundle, timeoutId);
        return { twiml, status: 200, outcome: 'OK' };
      }
    }
  }

  // Dial finished — update DB; on no-answer run the flow's fallback edge (voicemail / forward).
  if (dialCallStatus) {
    void handleInboundStatusCallback(body, ctx.inboundCallId || undefined);
    if (dialCallStatus === 'completed') {
      await persistSessionNode(ctx, session.flowNodeId, null, null);
      const vr = new VoiceResponse();
      return { twiml: vr.toString(), status: 200, outcome: 'OK' };
    }

    const callerId = bundle.outboundCallerId ?? ctx.to;
    const dialState = parseRingGroupDialState(session.metadata);
    if (dialState) {
      const continued = await continueSequentialRingGroupDial(ctx, bundle, dialState, callerId);
      if (continued) {
        return { twiml: continued, status: 200, outcome: 'OK' };
      }
      const twiml = await renderRingGroupNoAnswerFallback(
        ctx,
        bundle,
        flow,
        dialState,
        callerId,
        dialCallStatus,
      );
      return { twiml, status: 200, outcome: 'OK' };
    }

    if (session.flowNodeId) {
      const node = findNode(flow, session.flowNodeId);
      if (
        (node?.type === 'connect_group' && !node.data.isFallback) ||
        node?.type === 'connect_extension'
      ) {
        const fbId = dialOutcomeEdgeTarget(flow, node.id, dialCallStatus);
        if (fbId) {
          const twiml = await renderFlow(ctx, bundle, fbId);
          return { twiml, status: 200, outcome: 'OK' };
        }
        if (node.type === 'connect_group' && !node.data.isFallback) {
          await prisma.inboundCall.updateMany({
            where: { twilioCallSid: callSid },
            data: { outcome: InboundCallOutcome.no_answer },
          });
        }
        if (node.type === 'connect_extension') {
          const meta =
            session.metadata && typeof session.metadata === 'object'
              ? (session.metadata as Record<string, unknown>)
              : {};
          const extGroupId =
            typeof meta.extDialRingGroupId === 'string' ? meta.extDialRingGroupId : undefined;
          const ringGroup = extGroupId
            ? bundle.ringGroups.find((g) => g.id === extGroupId)
            : bundle.ringGroups.find((g) => g.extension === normalizeGatherDigits(ctx.digits));
          if (ringGroup) {
            await persistSessionNode(ctx, session.flowNodeId, null, null);
            const vr = new VoiceResponse();
            renderFallbackAction(
              vr,
              ctx,
              bundle,
              ringGroupFallbackNodeData(ringGroup),
              callerId,
            );
            return { twiml: vr.toString(), status: 200, outcome: 'OK' };
          }
          const vr = new VoiceResponse();
          const unavailableClip = nodeClipName(
            node.data,
            'unavailableClipName',
            SYSTEM_CLIP_NAMES.extensionNotAvailable,
          );
          renderAudioClip(
            vr,
            bundle.audioClips,
            unavailableClip,
            ctx.subCompanyId,
            'That extension is not available.',
          );
          console.warn(
            `[callFlow] connect_extension dial no-answer missing "no answer" edge; falling back to main menu`,
          );
          await persistSessionNode(ctx, mainMenuResumeNodeId(flow));
          vr.redirect(`${ctx.webhookBase}/inbound`);
          return { twiml: vr.toString(), status: 200, outcome: 'OK' };
        }
      }
    }
    const menuId = mainMenuResumeNodeId(flow);
    await persistSessionNode(ctx, menuId, null, null);
    const vr = new VoiceResponse();
    vr.redirect(`${ctx.webhookBase}/inbound`);
    return { twiml: vr.toString(), status: 200, outcome: 'OK' };
  }

  const resumeNodeId = session.flowNodeId ?? findTriggerNode(flow)?.id ?? 'trigger';
  const twiml = await renderFlow(ctx, bundle, resumeNodeId);
  return { twiml, status: 200, outcome: 'OK' };
}

export async function handleInboundStatusCallback(
  body: Record<string, string | undefined>,
  inboundCallId: string | undefined,
): Promise<void> {
  const dialStatus = body.DialCallStatus;
  const callSid = body.CallSid;
  if (!callSid) return;

  const answered = dialStatus === 'completed' || body.CallStatus === 'in-progress';

  if (answered && inboundCallId) {
    await prisma.inboundCall.update({
      where: { id: inboundCallId },
      data: { outcome: InboundCallOutcome.answered },
    }).catch(() => undefined);
  } else if (dialStatus === 'no-answer' || dialStatus === 'busy' || dialStatus === 'failed') {
    await prisma.inboundCall.updateMany({
      where: { twilioCallSid: callSid },
      data: { outcome: InboundCallOutcome.no_answer },
    });
  }

  // Safety net: when the caller's leg reaches a terminal state, clear any queue
  // entry so a caller who hung up while waiting doesn't linger in the panel.
  const callStatus = (body.CallStatus ?? '').toLowerCase();
  if (
    callStatus === 'completed' ||
    callStatus === 'busy' ||
    callStatus === 'no-answer' ||
    callStatus === 'failed' ||
    callStatus === 'canceled'
  ) {
    await releaseByCallSid(callSid, PhoneQueueEntryStatus.abandoned);
    await handleInboundCallerRemoteHangup({ callSid, inboundCallId });
  }
}

export async function markInboundAnswered(inboundCallId: string, userId: string): Promise<void> {
  await prisma.inboundCall.update({
    where: { id: inboundCallId },
    data: {
      outcome: InboundCallOutcome.answered,
      answeredByUserId: userId,
    },
  });
}

export async function markInboundDeclined(inboundCallId: string): Promise<void> {
  await prisma.inboundCall.update({
    where: { id: inboundCallId },
    data: { outcome: InboundCallOutcome.no_answer },
  }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Call queue TwiML (waitUrl / action / connect / connected)
// ---------------------------------------------------------------------------

/** Hold experience for a caller waiting in a queue. Returns <Leave/> once max wait is exceeded. */
export function buildQueueWaitTwiML(params: {
  maxWaitSec: number;
  musicUrl: string;
  queueTime: number;
  position?: string;
}): string {
  const vr = new VoiceResponse();
  if (params.queueTime >= params.maxWaitSec) {
    vr.leave();
    return vr.toString();
  }
  const posText = params.position
    ? `You are caller number ${params.position}. `
    : '';
  vr.say(`${posText}Please hold while we connect you to the next available agent.`);
  vr.play({}, params.musicUrl || DEFAULT_QUEUE_HOLD_MUSIC_URL);
  return vr.toString();
}

/**
 * Enqueue verb action — fired when the caller leaves the queue. On a max-wait
 * "leave" we follow the connect_queue node's "timeout" edge; on hangup we mark
 * the entry abandoned. Bridged/redirected outcomes are handled elsewhere.
 */
export async function renderQueueAction(
  entryId: string,
  body: Record<string, string | undefined>,
  webhookBase: string,
): Promise<string> {
  const queueResult = (body.QueueResult ?? '').toLowerCase();
  const callSid = body.CallSid ?? '';

  if (queueResult === 'bridged' || queueResult === 'redirected') {
    await prisma.phoneQueueEntry
      .update({ where: { id: entryId }, data: { status: PhoneQueueEntryStatus.connected, connectedAt: new Date(), endedAt: new Date() } })
      .catch(() => undefined);
    return new VoiceResponse().toString();
  }

  if (queueResult === 'hangup' || queueResult === 'error' || queueResult === 'system-error') {
    if (callSid) await releaseByCallSid(callSid, PhoneQueueEntryStatus.abandoned);
    return new VoiceResponse().toString();
  }

  // "leave" (max wait exceeded) or anything else → follow the timeout edge.
  await prisma.phoneQueueEntry
    .update({ where: { id: entryId }, data: { status: PhoneQueueEntryStatus.timeout, endedAt: new Date() } })
    .catch(() => undefined);

  return renderQueueTimeout(callSid, webhookBase);
}

/** Follows the connect_queue node's "timeout" edge, or plays goodbye when none. */
async function renderQueueTimeout(callSid: string, webhookBase: string): Promise<string> {
  const session = callSid
    ? await prisma.phoneCallSession.findUnique({ where: { callSid } })
    : null;
  if (!session) return new VoiceResponse().toString();

  const bundle = await loadAgencyBundle(session.subCompanyId);
  if (!bundle) return new VoiceResponse().toString();

  const flow = bundle.publishedFlow;
  const node = findNode(flow, session.flowNodeId);
  const inboundCall = session.inboundCallId
    ? await prisma.inboundCall.findUnique({ where: { id: session.inboundCallId } })
    : null;

  const ctx: InboundContext = {
    callSid,
    from: inboundCall?.fromNumber ?? '',
    to: inboundCall?.toNumber ?? bundle.outboundCallerId ?? '',
    webhookBase,
    subCompanyId: session.subCompanyId,
    inboundCallId: session.inboundCallId ?? '',
  };

  const timeoutId = node ? edgeTarget(flow, node.id, 'timeout') : null;
  if (timeoutId) {
    return renderFlow(ctx, bundle, timeoutId);
  }

  const vr = new VoiceResponse();
  renderAudioClip(
    vr,
    bundle.audioClips,
    SYSTEM_CLIP_NAMES.goodbye,
    ctx.subCompanyId,
    'Thank you for calling. Goodbye.',
  );
  vr.hangup();
  return vr.toString();
}

/** TwiML that connects a waiting caller to the chosen agent via conference bridge. */
export async function renderQueueConnect(params: {
  entryId: string;
  agentIdentity: string;
  userId: string;
  webhookBase: string;
}): Promise<string> {
  const entry = await prisma.phoneQueueEntry.findUnique({ where: { id: params.entryId } });
  const vr = new VoiceResponse();
  if (!entry) {
    vr.say('We could not connect your call. Goodbye.');
    vr.hangup();
    return vr.toString();
  }

  const inboundCallId = entry.inboundCallId;
  if (!inboundCallId) {
    vr.say('We could not connect your call. Goodbye.');
    vr.hangup();
    return vr.toString();
  }

  const bundle = await loadAgencyBundle(entry.subCompanyId);
  const inboundCall = await prisma.inboundCall.findUnique({ where: { id: inboundCallId } });
  const callerId = bundle?.outboundCallerId ?? inboundCall?.toNumber ?? entry.callerNumber;
  const conferenceRoom = conferenceRoomFor(inboundCallId);

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  const userName = user
    ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'Agent'
    : 'Agent';

  await prisma.inboundCall
    .update({ where: { id: inboundCallId }, data: { conferenceRoom } })
    .catch(() => undefined);

  void ringAgentsIntoConference({
    inboundCallId,
    subCompanyId: entry.subCompanyId,
    conferenceRoom,
    members: [{ userId: params.userId, userName, email: user?.email ?? null }],
    callerId,
    meta: {
      fromNumber: entry.callerNumber,
      toNumber: inboundCall?.toNumber ?? callerId,
      callerName: entry.callerName ?? entry.callerNumber,
      departmentLabel: entry.ringGroupName ?? undefined,
    },
  });

  return callerConferenceTwiml({
    conferenceRoom,
    inboundCallId,
    subCompanyId: entry.subCompanyId,
    webhookBase: params.webhookBase,
  });
}

/**
 * Dial action after connecting a queued caller to an agent. On success mark the
 * entry connected; otherwise put the caller back into the queue to keep waiting.
 */
export async function renderQueueConnected(params: {
  entryId: string;
  userId: string;
  body: Record<string, string | undefined>;
  webhookBase: string;
}): Promise<string> {
  const status = (params.body.DialCallStatus ?? '').toLowerCase();
  const entry = await prisma.phoneQueueEntry.findUnique({ where: { id: params.entryId } });

  if (status === 'completed' || status === 'answered' || status === 'in-progress') {
    await prisma.phoneQueueEntry
      .update({
        where: { id: params.entryId },
        data: {
          status: PhoneQueueEntryStatus.connected,
          connectedUserId: params.userId,
          connectedAt: new Date(),
          endedAt: new Date(),
        },
      })
      .catch(() => undefined);
    return new VoiceResponse().toString();
  }

  // Agent did not answer — return the caller to the queue.
  if (entry) {
    await prisma.phoneQueueEntry
      .update({
        where: { id: params.entryId },
        data: { status: PhoneQueueEntryStatus.waiting, connectedUserId: null },
      })
      .catch(() => undefined);

    const vr = new VoiceResponse();
    const waitUrl =
      `${params.webhookBase}/queue/wait` +
      `?entryId=${encodeURIComponent(entry.id)}` +
      `&maxWaitSec=120&music=${encodeURIComponent(DEFAULT_QUEUE_HOLD_MUSIC_URL)}`;
    const actionUrl = `${params.webhookBase}/queue/action?entryId=${encodeURIComponent(entry.id)}`;
    vr.enqueue(
      { waitUrl, waitUrlMethod: 'POST', action: actionUrl, method: 'POST' },
      entry.queueName,
    );
    return vr.toString();
  }

  return new VoiceResponse().toString();
}
