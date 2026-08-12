import prisma from '../config/database';
import { emitToUsers } from '../socket';
import { getRedis } from '../config/redis';
import type { ActivityState } from '@prisma/client';

const HEARTBEAT_INTERVAL_S = 20;
const MAX_NORMAL_ELAPSED_S = HEARTBEAT_INTERVAL_S * 2; // 40s — gap beyond this is treated as offline
export const OFFLINE_THRESHOLD_S = 90;

// Idle threshold cache — Redis is the source of truth (no TTL, updated on every settings change).
// The in-memory map is a 5-second micro-dedup so concurrent heartbeats on the same instance
// don't all hit Redis simultaneously.
const localThresholdCache = new Map<string, { thresholdMinutes: number; cachedAt: number }>();
const LOCAL_TTL_MS = 5 * 1000;
const REDIS_KEY = (id: string) => `idle_threshold:${id}`;

function parseTimeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const [hRaw, mRaw] = time.split(':');
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function isInsideWorkingHoursAt(date: Date, startMin: number, endMin: number): boolean {
  const nowMin = date.getHours() * 60 + date.getMinutes();
  if (startMin === endMin) return true; // 24/7
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin; // overnight windows
}

function calculateWorkingHoursSecondsBetween(
  start: Date,
  end: Date,
  workStartTime: string | null | undefined,
  workEndTime: string | null | undefined,
): number {
  if (end <= start) return 0;
  const startMin = parseTimeToMinutes(workStartTime);
  const endMin = parseTimeToMinutes(workEndTime);
  if (startMin === null || endMin === null) {
    return Math.floor((end.getTime() - start.getTime()) / 1000);
  }

  // Small-interval approximation: split by minute and only count portions
  // that fall inside configured working hours.
  let totalMs = 0;
  let cursor = new Date(start);
  while (cursor < end) {
    const next = new Date(Math.min(end.getTime(), cursor.getTime() + 60_000));
    if (isInsideWorkingHoursAt(cursor, startMin, endMin)) {
      totalMs += next.getTime() - cursor.getTime();
    }
    cursor = next;
  }
  return Math.floor(totalMs / 1000);
}

/** Dashboard `idle_detected`: only time inside the user's configured working hours (no off-hours wall fallback). */
async function writeIdleDetectedActivityLog(input: {
  userId: string;
  subCompanyId: string;
  idleStart: Date;
  now: Date;
  workStartTime: string | null | undefined;
  workEndTime: string | null | undefined;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  source: 'server_manual_back' | 'server_offline_reconnect';
}): Promise<boolean> {
  const inHoursSeconds = calculateWorkingHoursSecondsBetween(
    input.idleStart,
    input.now,
    input.workStartTime,
    input.workEndTime,
  );
  if (inHoursSeconds <= 0) return false;
  let durationMinutes = Math.round(inHoursSeconds / 60);
  if (durationMinutes < 1) durationMinutes = 1;

  const userName = `${input.firstName ?? ''} ${input.lastName ?? ''}`.trim() || input.email || 'User';
  await prisma.activityLog.create({
    data: {
      type: 'idle_detected',
      userId: input.userId,
      userName,
      subCompanyId: input.subCompanyId,
      description: `Idle time detected (${durationMinutes} minutes)`,
      metadata: {
        duration: durationMinutes,
        startedAt: input.idleStart.toISOString(),
        source: input.source,
        durationBasis: 'working_hours',
      },
    },
  });
  return true;
}

export async function getIdleThresholdMinutes(subCompanyId: string): Promise<number> {
  // 1. In-memory micro-dedup (5s)
  const local = localThresholdCache.get(subCompanyId);
  if (local && Date.now() - local.cachedAt < LOCAL_TTL_MS) {
    return local.thresholdMinutes;
  }

  // 2. Redis (authoritative, no TTL)
  const redis = getRedis();
  if (redis) {
    try {
      const val = await redis.get(REDIS_KEY(subCompanyId));
      if (val !== null) {
        const thresholdMinutes = parseInt(val, 10);
        localThresholdCache.set(subCompanyId, { thresholdMinutes, cachedAt: Date.now() });
        return thresholdMinutes;
      }
    } catch { /* ignore redis read errors */ }
  }

  // 3. DB fallback — also warms Redis and local cache
  const setting = await prisma.idleTimeSetting.findUnique({
    where: { subCompanyId },
    select: { thresholdMinutes: true },
  });
  const thresholdMinutes = setting?.thresholdMinutes ?? 5;
  localThresholdCache.set(subCompanyId, { thresholdMinutes, cachedAt: Date.now() });
  if (redis) {
    try { await redis.set(REDIS_KEY(subCompanyId), String(thresholdMinutes)); } catch { /* ignore redis write errors */ }
  }
  return thresholdMinutes;
}

/** Called by the settings route after saving a new threshold — updates Redis immediately. */
export async function setIdleThresholdCache(subCompanyId: string, thresholdMinutes: number): Promise<void> {
  localThresholdCache.set(subCompanyId, { thresholdMinutes, cachedAt: Date.now() });
  const redis = getRedis();
  if (redis) {
    try { await redis.set(REDIS_KEY(subCompanyId), String(thresholdMinutes)); } catch { /* ignore redis write errors */ }
  }
}

/** @deprecated Use setIdleThresholdCache from the settings route instead. */
export function invalidateThresholdCache(subCompanyId: string): void {
  localThresholdCache.delete(subCompanyId);
  const redis = getRedis();
  if (redis) {
    redis.del(REDIS_KEY(subCompanyId)).catch(() => {});
  }
}

/** Opens a new session on login. Closes any orphaned open sessions first. */
export async function startActivitySession(userId: string, subCompanyId: string): Promise<string> {
  const now = new Date();
  await prisma.userActivitySession.updateMany({
    where: { userId, endedAt: null },
    data: { endedAt: now },
  });
  const session = await prisma.userActivitySession.create({
    data: { userId, subCompanyId, lastSeenAt: now, currentState: 'active' },
  });
  return session.id;
}

/** Closes session on logout and flushes final elapsed time. */
export async function endActivitySession(userId: string): Promise<void> {
  const now = new Date();
  const session = await prisma.userActivitySession.findFirst({
    where: { userId, endedAt: null },
    orderBy: { startedAt: 'desc' },
  });
  if (!session) return;

  const elapsedS = Math.floor((now.getTime() - session.lastSeenAt.getTime()) / 1000);
  const isGap = elapsedS > MAX_NORMAL_ELAPSED_S;

  await prisma.userActivitySession.update({
    where: { id: session.id },
    data: {
      endedAt: now,
      activeSeconds: !isGap && session.currentState === 'active'
        ? { increment: elapsedS }
        : session.activeSeconds,
      idleSeconds: !isGap && session.currentState === 'idle'
        ? { increment: elapsedS }
        : session.idleSeconds,
      offlineSeconds: isGap
        ? { increment: elapsedS }
        : session.currentState === 'offline_suspected'
          ? { increment: elapsedS }
          : session.offlineSeconds,
    },
  });
}

export async function getCurrentSession(userId: string) {
  const session = await prisma.userActivitySession.findFirst({
    where: { userId, endedAt: null },
    orderBy: { startedAt: 'desc' },
  });
  if (!session) return null;
  return {
    sessionId: session.id,
    state: session.currentState,
    idleSeconds: session.idleSeconds,
    activeSeconds: session.activeSeconds,
    serverTime: new Date().toISOString(),
    idleStartedAt: session.idleStartedAt?.toISOString() ?? null,
  };
}

export async function processHeartbeat(
  sessionId: string,
  userId: string,
  _visibilityState: 'visible' | 'hidden',
  hadActivitySinceLastBeat: boolean,
): Promise<{ state: ActivityState; idleSeconds: number; serverTime: string; idleStartedAt: string | null }> {
  const now = new Date();

  const session = await prisma.userActivitySession.findFirst({
    where: { id: sessionId, userId, endedAt: null },
  });
  if (!session) throw new Error('Session not found');

  const elapsedS = Math.floor((now.getTime() - session.lastSeenAt.getTime()) / 1000);
  const isGap = elapsedS > MAX_NORMAL_ELAPSED_S;

  const thresholdMinutes = await getIdleThresholdMinutes(session.subCompanyId);
  const thresholdS = thresholdMinutes * 60;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      workStartTime: true,
      workEndTime: true,
      email: true,
      firstName: true,
      lastName: true,
      subCompanyId: true,
    },
  });
  const inHoursElapsedS = calculateWorkingHoursSecondsBetween(
    session.lastSeenAt,
    now,
    user?.workStartTime,
    user?.workEndTime,
  );

  let newState: ActivityState = session.currentState;
  let newIdleStartedAt: Date | null = session.idleStartedAt;
  let activeInc = 0;
  let idleInc = 0;
  let offlineInc = 0;
  const logIdleAfterOfflineReconnect =
    !isGap && session.currentState === 'offline_suspected';
  const idleStartForActivityLog = logIdleAfterOfflineReconnect
    ? (session.idleStartedAt ?? session.lastSeenAt)
    : null;

  if (isGap) {
    offlineInc = elapsedS;
    if (newState !== 'offline_suspected') {
      // Only trigger offline_suspected (which shows the idle modal) if the gap itself
      // exceeds the director-configured threshold. Smaller gaps (laptop sleep, browser
      // throttling, network hiccups) are recorded as offline time but don't interrupt the user.
      if (elapsedS >= thresholdS) {
        newState = 'offline_suspected';
      }
      // Start idle clock from lastSeenAt so cumulative idle time is tracked correctly
      if (!newIdleStartedAt) newIdleStartedAt = session.lastSeenAt;
    }
  } else if (session.currentState === 'offline_suspected') {
    activeInc = inHoursElapsedS;
    newState = 'active';
    newIdleStartedAt = null;
  } else if (session.currentState === 'idle') {
    // Only manual_back clears idle state
    idleInc = inHoursElapsedS;
  } else {
    // State is 'active'
    if (hadActivitySinceLastBeat) {
      // Activity resets idle clock regardless of tab visibility
      activeInc = inHoursElapsedS;
      newIdleStartedAt = null;
    } else {
      activeInc = inHoursElapsedS;
      if (!newIdleStartedAt) {
        newIdleStartedAt = now; // start idle clock from now, not stale lastSeenAt
      }
      const idleForS = Math.floor((now.getTime() - newIdleStartedAt.getTime()) / 1000);
      if (idleForS >= thresholdS) {
        newState = 'idle';
        const idlePortionS = Math.min(inHoursElapsedS, activeInc);
        activeInc -= idlePortionS;
        idleInc += idlePortionS;
      }
    }
  }

  // Optimistic concurrency — prevents double-counting from concurrent tab heartbeats
  const updated = await prisma.userActivitySession.updateMany({
    where: { id: session.id, version: session.version },
    data: {
      lastSeenAt: now,
      currentState: newState,
      idleStartedAt: newIdleStartedAt,
      activeSeconds: { increment: activeInc },
      idleSeconds: { increment: idleInc },
      offlineSeconds: { increment: offlineInc },
      version: { increment: 1 },
    },
  });

  if (updated.count === 0) {
    // Version conflict — return current state from DB
    const fresh = await prisma.userActivitySession.findUnique({ where: { id: session.id } });
    if (fresh) {
      return {
        state: fresh.currentState,
        idleSeconds: fresh.idleSeconds,
        serverTime: now.toISOString(),
        idleStartedAt: fresh.idleStartedAt?.toISOString() ?? null,
      };
    }
  }

  if (updated.count > 0 && logIdleAfterOfflineReconnect && idleStartForActivityLog && user?.subCompanyId) {
    const wrote = await writeIdleDetectedActivityLog({
      userId,
      subCompanyId: user.subCompanyId,
      idleStart: idleStartForActivityLog,
      now,
      workStartTime: user.workStartTime,
      workEndTime: user.workEndTime,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      source: 'server_offline_reconnect',
    });
    if (wrote) {
      emitToUsers([userId], 'call:refresh', { subCompanyId: user.subCompanyId });
    }
  }

  if (newState !== session.currentState) {
    await prisma.userActivityEvent.create({
      data: {
        sessionId: session.id,
        eventType: 'state_change',
        reasonCode: isGap
          ? 'heartbeat_gap'
          : newState === 'idle'
            ? 'idle_threshold_exceeded'
            : 'heartbeat_reconnect',
        metadata: {
          previousState: session.currentState,
          newState,
          elapsedSeconds: elapsedS,
          idleThresholdUsed: thresholdMinutes,
        },
      },
    });
    emitToUsers([userId], 'activity:state_changed', {
      state: newState,
      idleSeconds: session.idleSeconds + idleInc,
      idleStartedAt: newIdleStartedAt?.toISOString() ?? null,
      serverTime: now.toISOString(),
    });
  }

  return {
    state: newState,
    idleSeconds: session.idleSeconds + idleInc,
    serverTime: now.toISOString(),
    idleStartedAt: newIdleStartedAt?.toISOString() ?? null,
  };
}

/** Only backend path to clear idle state. Returns 'active' on success. */
export async function processManualBack(
  sessionId: string,
  userId: string,
): Promise<{ state: ActivityState; serverTime: string }> {
  const now = new Date();

  const session = await prisma.userActivitySession.findFirst({
    where: { id: sessionId, userId, endedAt: null },
  });
  if (!session) throw new Error('Session not found');

  if (session.currentState === 'active') {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { subCompanyId: true } });
    if (u?.subCompanyId) emitToUsers([userId], 'call:refresh', { subCompanyId: u.subCompanyId });
    return { state: 'active', serverTime: now.toISOString() };
  }

  const prevState = session.currentState;
  const idleStart = session.idleStartedAt ?? session.lastSeenAt;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { workStartTime: true, workEndTime: true, email: true, subCompanyId: true, firstName: true, lastName: true },
  });
  if (!user?.subCompanyId) {
    await prisma.userActivitySession.update({
      where: { id: session.id },
      data: {
        currentState: 'active',
        idleStartedAt: null,
        lastSeenAt: now,
        version: { increment: 1 },
      },
    });
    emitToUsers([userId], 'activity:state_changed', {
      state: 'active',
      idleSeconds: 0,
      idleStartedAt: null,
      serverTime: now.toISOString(),
    });
    emitToUsers([userId], 'call:refresh', { subCompanyId: session.subCompanyId });
    return { state: 'active', serverTime: now.toISOString() };
  }

  await prisma.userActivitySession.update({
    where: { id: session.id },
    data: {
      currentState: 'active',
      idleStartedAt: null,
      lastSeenAt: now,
      version: { increment: 1 },
    },
  });

  await prisma.userActivityEvent.create({
    data: {
      sessionId: session.id,
      eventType: 'manual_back',
      reasonCode: 'user_confirmed_active',
      metadata: { previousState: prevState },
    },
  });

  await writeIdleDetectedActivityLog({
    userId,
    subCompanyId: user.subCompanyId,
    idleStart,
    now,
    workStartTime: user.workStartTime,
    workEndTime: user.workEndTime,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    source: 'server_manual_back',
  });

  emitToUsers([userId], 'call:refresh', { subCompanyId: user.subCompanyId });

  emitToUsers([userId], 'activity:state_changed', {
    state: 'active',
    idleSeconds: 0,
    idleStartedAt: null,
    serverTime: now.toISOString(),
  });

  return { state: 'active', serverTime: now.toISOString() };
}

export async function logActivityEvent(
  sessionId: string,
  userId: string,
  eventType: string,
): Promise<void> {
  const session = await prisma.userActivitySession.findFirst({
    where: { id: sessionId, userId, endedAt: null },
  });
  if (!session) return;
  await prisma.userActivityEvent.create({
    data: { sessionId, eventType },
  });
}
