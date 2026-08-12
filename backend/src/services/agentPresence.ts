/**
 * Agent phone presence — powers busy-aware dialing and the call queue.
 *
 * Effective status precedence:
 *   1. Manual status set by the agent (available | busy | away | offline) wins.
 *   2. Otherwise "busy" while the agent has one or more active calls.
 *   3. Otherwise "available".
 *
 * Only "available" agents are dialed. "busy" callers are queued; "away"/"offline"
 * agents are skipped entirely.
 */
import { AgentPresenceStatus, PhoneConferenceLegStatus, type AgentPhonePresence } from '@prisma/client';
import prisma from '../config/database';

export type EffectivePresence = AgentPresenceStatus;

export function computeEffectiveStatus(row: AgentPhonePresence | null | undefined): EffectivePresence {
  if (!row) return AgentPresenceStatus.available;
  if (row.manualStatus) return row.manualStatus;
  if (row.activeCallCount > 0) return AgentPresenceStatus.busy;
  return AgentPresenceStatus.available;
}

export async function getPresenceRow(userId: string): Promise<AgentPhonePresence | null> {
  return prisma.agentPhonePresence.findUnique({ where: { userId } });
}

export async function getEffectivePresence(userId: string): Promise<EffectivePresence> {
  return computeEffectiveStatus(await getPresenceRow(userId));
}

export async function getPresenceForUsers(
  userIds: string[],
): Promise<Map<string, AgentPhonePresence>> {
  if (userIds.length === 0) return new Map();
  const rows = await prisma.agentPhonePresence.findMany({ where: { userId: { in: userIds } } });
  return new Map(rows.map((r) => [r.userId, r]));
}

/** Agent manually sets availability. Passing null clears the override (back to auto). */
export async function setManualPresence(
  userId: string,
  subCompanyId: string | null,
  manualStatus: AgentPresenceStatus | null,
): Promise<{ manualStatus: AgentPresenceStatus | null; effective: EffectivePresence }> {
  const row = await prisma.agentPhonePresence.upsert({
    where: { userId },
    create: { userId, subCompanyId, manualStatus },
    update: { manualStatus, ...(subCompanyId ? { subCompanyId } : {}) },
  });
  return { manualStatus: row.manualStatus, effective: computeEffectiveStatus(row) };
}

/** Increment the agent's live-call counter (agent is now on a call). */
export async function markAgentOnCall(userId: string, subCompanyId?: string | null): Promise<void> {
  await prisma.agentPhonePresence.upsert({
    where: { userId },
    create: { userId, subCompanyId: subCompanyId ?? null, activeCallCount: 1 },
    update: { activeCallCount: { increment: 1 }, ...(subCompanyId ? { subCompanyId } : {}) },
  });
}

/**
 * Decrement the agent's live-call counter (a call ended). Returns whether the agent
 * is now effectively available so callers can trigger auto-dequeue.
 */
export async function markAgentCallEnded(userId: string): Promise<{ nowAvailable: boolean }> {
  const existing = await prisma.agentPhonePresence.findUnique({ where: { userId } });
  const nextCount = Math.max(0, (existing?.activeCallCount ?? 0) - 1);
  const row = await prisma.agentPhonePresence.upsert({
    where: { userId },
    create: { userId, activeCallCount: 0, lastCallEndedAt: new Date() },
    update: { activeCallCount: nextCount, lastCallEndedAt: new Date() },
  });
  return { nowAvailable: computeEffectiveStatus(row) === AgentPresenceStatus.available };
}

/** Count agent conference legs that are still live (ringing or joined). */
export async function countLiveConferenceLegs(userId: string): Promise<number> {
  return prisma.phoneConferenceLeg.count({
    where: {
      userId,
      status: { in: [PhoneConferenceLegStatus.ringing, PhoneConferenceLegStatus.joined] },
    },
  });
}

/**
 * Sync DB activeCallCount down when it exceeds live conference legs (stale softphone
 * presence after missed call-ended). Returns the reconciled count.
 */
export async function reconcileAgentActiveCallCount(userId: string): Promise<number> {
  const liveLegs = await countLiveConferenceLegs(userId);
  const row = await getPresenceRow(userId);
  const dbCount = row?.activeCallCount ?? 0;
  if (dbCount <= liveLegs) return dbCount;

  await prisma.agentPhonePresence
    .update({
      where: { userId },
      data: { activeCallCount: liveLegs },
    })
    .catch(() => undefined);

  return liveLegs;
}

export interface RingMember {
  userId: string;
  userName: string;
}

export interface AgentInboundCapacity {
  activeCallCount: number;
  ringingLegs: number;
  joinedLegs: number;
  canAcceptRing: boolean;
  canPickupFromQueue: boolean;
}

/** Max 2 joined legs; only 1 ringing leg while already on a call. */
export function computeCanAcceptRing(joinedLegs: number, ringingLegs: number): boolean {
  if (joinedLegs >= 2) return false;
  if (joinedLegs >= 1 && ringingLegs >= 1) return false;
  return true;
}

/** Ringing legs older than this are treated as stale (missed status callback) and ignored for capacity. */
export const STALE_RINGING_LEG_MS = 45_000;

async function countConferenceLegsByUser(
  userIds: string[],
): Promise<Map<string, { ringing: number; joined: number }>> {
  const counts = new Map<string, { ringing: number; joined: number }>();
  for (const id of userIds) counts.set(id, { ringing: 0, joined: 0 });
  if (userIds.length === 0) return counts;

  const legs = await prisma.phoneConferenceLeg.findMany({
    where: {
      userId: { in: userIds },
      status: { in: [PhoneConferenceLegStatus.ringing, PhoneConferenceLegStatus.joined] },
    },
    select: { userId: true, status: true, createdAt: true, agentCallSid: true },
  });

  const now = Date.now();
  const staleSids: string[] = [];

  for (const leg of legs) {
    const row = counts.get(leg.userId) ?? { ringing: 0, joined: 0 };
    if (leg.status === PhoneConferenceLegStatus.ringing) {
      const ageMs = now - leg.createdAt.getTime();
      if (ageMs > STALE_RINGING_LEG_MS) {
        staleSids.push(leg.agentCallSid);
        continue;
      }
      row.ringing += 1;
    } else {
      row.joined += 1;
    }
    counts.set(leg.userId, row);
  }

  if (staleSids.length > 0) {
    void prisma.phoneConferenceLeg
      .updateMany({
        where: {
          agentCallSid: { in: staleSids },
          status: PhoneConferenceLegStatus.ringing,
        },
        data: { status: PhoneConferenceLegStatus.canceled },
      })
      .catch(() => undefined);
  }

  return counts;
}

export async function getInboundCapacityForUsers(
  userIds: string[],
): Promise<Map<string, AgentInboundCapacity>> {
  const presence = await getPresenceForUsers(userIds);
  const legCounts = await countConferenceLegsByUser(userIds);
  const result = new Map<string, AgentInboundCapacity>();

  for (const userId of userIds) {
    const row = presence.get(userId);
    const legs = legCounts.get(userId) ?? { ringing: 0, joined: 0 };
    const canAcceptRing = computeCanAcceptRing(legs.joined, legs.ringing);
    result.set(userId, {
      activeCallCount: row?.activeCallCount ?? 0,
      ringingLegs: legs.ringing,
      joinedLegs: legs.joined,
      canAcceptRing,
      canPickupFromQueue: canAcceptRing,
    });
  }
  return result;
}

export async function getAgentInboundCapacity(userId: string): Promise<AgentInboundCapacity> {
  const map = await getInboundCapacityForUsers([userId]);
  return (
    map.get(userId) ?? {
      activeCallCount: 0,
      ringingLegs: 0,
      joinedLegs: 0,
      canAcceptRing: true,
      canPickupFromQueue: true,
    }
  );
}

/** Drop members who cannot accept another inbound ring (2 joined or 1 joined + 1 ringing). */
export async function filterMembersByInboundCapacity<T extends RingMember>(members: T[]): Promise<T[]> {
  if (members.length === 0) return [];
  const capacity = await getInboundCapacityForUsers(members.map((m) => m.userId));
  return members.filter((m) => capacity.get(m.userId)?.canAcceptRing ?? true);
}

/**
 * Filter a ring group's members to those effectively available, ordered longest-idle first
 * (least recently on a call). Members with no presence row are treated as most idle.
 */
export async function orderAvailableMembers<T extends RingMember>(members: T[]): Promise<T[]> {
  if (members.length === 0) return [];
  const presence = await getPresenceForUsers(members.map((m) => m.userId));
  const available = members.filter((m) => {
    const row = presence.get(m.userId);
    if (computeEffectiveStatus(row) !== AgentPresenceStatus.available) return false;
    // Manual "available" must not override an active call — only ring truly idle agents.
    return (row?.activeCallCount ?? 0) === 0;
  });
  return available.sort((a, b) => {
    const aIdle = presence.get(a.userId)?.lastCallEndedAt?.getTime() ?? 0;
    const bIdle = presence.get(b.userId)?.lastCallEndedAt?.getTime() ?? 0;
    return aIdle - bIdle;
  });
}

/** True when at least one member can be rung now (idle or call-waiting eligible). */
export async function hasRingableMember(members: RingMember[]): Promise<boolean> {
  return (await orderRingableMembers(members)).length > 0;
}

/** True when at least one member is effectively available to take a call now. */
export async function hasAvailableMember(members: RingMember[]): Promise<boolean> {
  return (await orderAvailableMembers(members)).length > 0;
}

/**
 * Members who can be rung now: available agents first, then busy agents on exactly
 * one call (call-waiting eligible), ordered longest-idle first within each tier.
 */
export async function orderRingableMembers<T extends RingMember>(members: T[]): Promise<T[]> {
  if (members.length === 0) return [];
  const presence = await getPresenceForUsers(members.map((m) => m.userId));

  const available: T[] = [];
  const callWaiting: T[] = [];

  for (const m of members) {
    const row = presence.get(m.userId);
    const effective = computeEffectiveStatus(row);
    if (effective === AgentPresenceStatus.available) {
      available.push(m);
    } else if (
      effective === AgentPresenceStatus.busy &&
      (row?.activeCallCount ?? 0) === 1
    ) {
      callWaiting.push(m);
    }
  }

  const byIdle = (a: T, b: T) => {
    const aIdle = presence.get(a.userId)?.lastCallEndedAt?.getTime() ?? 0;
    const bIdle = presence.get(b.userId)?.lastCallEndedAt?.getTime() ?? 0;
    return aIdle - bIdle;
  };

  const ringable = [...available.sort(byIdle), ...callWaiting.sort(byIdle)];
  return filterMembersByInboundCapacity(ringable);
}
