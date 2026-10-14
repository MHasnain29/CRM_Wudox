import prisma from '../config/database';
import { emitToUsers } from '../socket';
import { getRedis } from '../config/redis';
import { WORKING_HOURS_TIME_ZONE } from '../config/workingHours';
import type { ActivityBreakType, ActivityState, Prisma, UserActivitySession } from '@prisma/client';
import { MAX_NORMAL_ELAPSED_S, measureActivityWindow, type ActivityMeasurementInterval } from './activityMeasurement';
import { usesCrmActivityTracking } from './crmActivityEligibility';

// Idle threshold cache — Redis is the source of truth (no TTL, updated on every settings change).
// The in-memory map is a 5-second micro-dedup so concurrent heartbeats on the same instance
// don't all hit Redis simultaneously.
const localThresholdCache = new Map<string, { thresholdMinutes: number; cachedAt: number }>();
const LOCAL_TTL_MS = 5 * 1000;
const REDIS_KEY = (id: string) => `idle_threshold:${id}`;

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

export { MAX_NORMAL_ELAPSED_S } from './activityMeasurement';
export const OFFLINE_THRESHOLD_S = 90;

export interface ActivityMeasurementInput {
  measurementVersion: 2;
  clientId: string;
  clientTime: string;
  lastActivityAt: string | null;
  firstActivityAt?: string | null;
  timeZone: string;
}

const seconds = (milliseconds: bigint) => Number(milliseconds / 1000n);

async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`activity:${userId}`}))`;
}

function stateResponse(session: UserActivitySession, now = new Date(), trackingEnabled = true) {
  const disconnected = now.getTime() - session.lastSeenAt.getTime() > MAX_NORMAL_ELAPSED_S * 1000;
  return {
    sessionId: session.id,
    trackingEnabled,
    state: !trackingEnabled ? 'active' as const : disconnected && !session.onBreak ? 'offline_suspected' as const : session.currentState,
    idleSeconds: trackingEnabled ? seconds(session.measuredIdleMilliseconds) : 0,
    activeSeconds: trackingEnabled ? seconds(session.measuredActiveMilliseconds) : 0,
    currentIdleSeconds: !trackingEnabled || disconnected ? 0 : seconds(session.currentIdleMilliseconds),
    serverTime: now.toISOString(),
    idleStartedAt: !trackingEnabled || disconnected ? null : session.idleStartedAt?.toISOString() ?? null,
    onBreak: session.onBreak,
    breakType: session.onBreak ? session.breakType ?? 'break' : null,
    breakStartedAt: session.breakStartedAt?.toISOString() ?? null,
    trackingTimezone: WORKING_HOURS_TIME_ZONE,
    trackingPaused: !trackingEnabled || disconnected || session.onBreak || session.currentState === 'offline_suspected',
  };
}

/** These rows follow an explicit declared break, including time without heartbeats. */
async function ensureRecordedBreak(tx: Prisma.TransactionClient, session: UserActivitySession, now: Date) {
  const current = await tx.userActivityBreak.findFirst({ where: { sessionId: session.id, endedAt: null } });
  if (!current) await tx.userActivityBreak.create({ data: {
    sessionId: session.id, breakType: session.breakType ?? 'break', startedAt: now,
  } });
}

async function closeRecordedBreak(tx: Prisma.TransactionClient, sessionId: string, now: Date) {
  await tx.userActivityBreak.updateMany({ where: { sessionId, endedAt: null }, data: { endedAt: now } });
}

/** Preserve the existing coaching/meeting feed, using server-confirmed endpoints. */
async function finishDeclaredBreak(
  tx: Prisma.TransactionClient,
  session: UserActivitySession,
  now: Date,
  reason: 'user_returned' | 'session_ended' | 'session_replaced',
) {
  await closeRecordedBreak(tx, session.id, now);
  if (!session.onBreak || !session.breakStartedAt || !session.breakType || session.breakType === 'break') return;
  const milliseconds = now.getTime() - session.breakStartedAt.getTime();
  if (milliseconds <= 0) return;
  const user = await tx.user.findUnique({ where: { id: session.userId }, select: { firstName: true, lastName: true, email: true, subCompanyId: true } });
  // A session may use the independent user's ID as its context. Do not write
  // that value into the agency foreign key, or move an old break to a new agency.
  if (!user?.subCompanyId || user.subCompanyId !== session.subCompanyId) return;
  const durationSeconds = Math.floor(milliseconds / 1000);
  const duration = Math.round(milliseconds / 60_000);
  await tx.activityLog.create({ data: {
    type: 'break_detected', userId: session.userId, subCompanyId: session.subCompanyId,
    userName: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email || 'User',
    description: `${session.breakType === 'coaching' ? 'Coaching' : 'Meeting'} break (${duration} minutes)`,
    metadata: { duration, durationSeconds, durationMilliseconds: milliseconds, breakType: session.breakType,
      startedAt: session.breakStartedAt.toISOString(), endedAt: now.toISOString(),
      source: 'server_recorded_break', reason },
  } });
}

/** Retain history and break state, but never carry CRM timing through an excluded role. */
async function disableMeasurement(tx: Prisma.TransactionClient, session: UserActivitySession, now = new Date()) {
  if (session.onBreak) await closeRecordedBreak(tx, session.id, now);
  if (session.currentState === 'active' && !session.idleStartedAt && !session.measurementStartedAt
    && !session.lastClientTime && !session.lastInputAt && !session.measurementClientId
    && !session.lastReportedInputAt && session.currentIdleMilliseconds === 0n) return session;
  return tx.userActivitySession.update({ where: { id: session.id }, data: {
    currentState: 'active', idleStartedAt: null, currentIdleMilliseconds: 0n,
    measurementStartedAt: null, lastInputAt: null, lastClientTime: null,
    measurementClientId: null, lastReportedInputAt: null, version: { increment: 1 },
  } });
}

/** A previous timezone policy cannot supply a baseline for the Toronto schedule. */
async function alignWorkingHoursTimezone(tx: Prisma.TransactionClient, session: UserActivitySession) {
  if (session.trackingTimezone === WORKING_HOURS_TIME_ZONE) return session;
  return tx.userActivitySession.update({ where: { id: session.id }, data: {
    trackingTimezone: WORKING_HOURS_TIME_ZONE,
    currentState: 'active', idleStartedAt: null, currentIdleMilliseconds: 0n,
    measurementStartedAt: null, lastInputAt: null, lastClientTime: null,
    measurementClientId: null, lastReportedInputAt: null, version: { increment: 1 },
  } });
}

async function newSession(tx: Prisma.TransactionClient, userId: string, subCompanyId: string, now: Date) {
  // No unobserved tail is added when replacing an old session.
  const previous = await tx.userActivitySession.findMany({ where: { userId, endedAt: null } });
  for (const session of previous) await finishDeclaredBreak(tx, session, now, 'session_replaced');
  await tx.userActivitySession.updateMany({ where: { userId, endedAt: null }, data: {
    endedAt: now, onBreak: false, breakStartedAt: null, breakType: null, version: { increment: 1 },
  } });
  return tx.userActivitySession.create({ data: {
    userId, subCompanyId, lastSeenAt: now, currentState: 'active', trackingTimezone: WORKING_HOURS_TIME_ZONE,
  } });
}

export async function startActivitySession(userId: string, subCompanyId: string): Promise<string> {
  return prisma.$transaction(async tx => {
    await lockUser(tx, userId);
    // A login in another tab/device must not end the user's ongoing measurement.
    const current = await tx.userActivitySession.findFirst({ where: { userId, endedAt: null }, orderBy: { startedAt: 'desc' } });
    return (current?.subCompanyId === subCompanyId
      ? await alignWorkingHoursTimezone(tx, current)
      : await newSession(tx, userId, subCompanyId, new Date())).id;
  });
}

export async function endActivitySession(userId: string): Promise<void> {
  await prisma.$transaction(async tx => {
    await lockUser(tx, userId);
    const now = new Date();
    const sessions = await tx.userActivitySession.findMany({ where: { userId, endedAt: null } });
    for (const session of sessions) {
      await finishIdleEpisode(tx, session, session.currentIdleMilliseconds, session.lastSeenAt);
      await finishDeclaredBreak(tx, session, now, 'session_ended');
    }
    await tx.userActivitySession.updateMany({ where: { userId, endedAt: null }, data: {
      endedAt: now, onBreak: false, breakStartedAt: null, breakType: null, version: { increment: 1 },
    } });
  });
}

export async function getCurrentSession(userId: string) {
  return prisma.$transaction(async tx => {
    await lockUser(tx, userId);
    const current = await tx.userActivitySession.findFirst({ where: { userId, endedAt: null }, orderBy: { startedAt: 'desc' } });
    const user = await tx.user.findUnique({ where: { id: userId }, select: { subCompanyId: true, isActive: true, role: true } });
    if (!user?.isActive) {
      if (current) await disableMeasurement(tx, await alignWorkingHoursTimezone(tx, current));
      return null;
    }
    let session = current && (!user.subCompanyId || current.subCompanyId === user.subCompanyId)
      ? current : await newSession(tx, userId, user.subCompanyId ?? userId, new Date());
    session = await alignWorkingHoursTimezone(tx, session);
    const trackingEnabled = usesCrmActivityTracking(user.role);
    if (!trackingEnabled) session = await disableMeasurement(tx, session);
    else if (session.onBreak) await ensureRecordedBreak(tx, session, new Date());
    return stateResponse(session, new Date(), trackingEnabled);
  });
}

/** Store adjacent intervals as one range, retaining exact endpoints and atomic counters. */
async function saveIntervals(tx: Prisma.TransactionClient, sessionId: string, intervals: ActivityMeasurementInterval[]) {
  let last = await tx.userActivityInterval.findFirst({ where: { sessionId }, orderBy: { endedAt: 'desc' } });
  for (const interval of intervals) {
    if (last && last.state === interval.state && last.endedAt.getTime() === interval.startedAt.getTime()) {
      last = await tx.userActivityInterval.update({ where: { id: last.id }, data: { endedAt: interval.endedAt } });
    } else {
      last = await tx.userActivityInterval.create({ data: { sessionId, ...interval } });
    }
  }
}

/** Keep the existing dashboard feed, but derive its duration only from measured intervals. */
async function finishIdleEpisode(tx: Prisma.TransactionClient, session: UserActivitySession, milliseconds: bigint, endedAt: Date) {
  if (milliseconds <= 0n) return false;
  const user = await tx.user.findUnique({ where: { id: session.userId }, select: { subCompanyId: true, firstName: true, lastName: true, email: true, role: true } });
  if (!user?.subCompanyId || !usesCrmActivityTracking(user.role)) return false;
  const durationSeconds = seconds(milliseconds);
  const duration = Math.round(durationSeconds / 60);
  await tx.activityLog.create({ data: {
    type: 'idle_detected', userId: session.userId, subCompanyId: user.subCompanyId,
    userName: `${user.firstName} ${user.lastName}`.trim() || user.email,
    description: `Measured CRM inactivity (${durationSeconds} seconds)`,
    metadata: { duration, durationSeconds, durationMilliseconds: Number(milliseconds),
      startedAt: session.idleStartedAt?.toISOString() ?? null, endedAt: endedAt.toISOString(),
      source: 'measured_crm_intervals', durationBasis: 'observed_working_hours', measurementVersion: 2 },
  } });
  return true;
}

function validMeasurement(input: ActivityMeasurementInput | undefined): input is ActivityMeasurementInput {
  if (!input || input.measurementVersion !== 2 || !input.clientId) return false;
  const clientTime = Date.parse(input.clientTime);
  if (!Number.isFinite(clientTime)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: input.timeZone }).format(); } catch { return false; }
  const latest = input.lastActivityAt === null ? null : Date.parse(input.lastActivityAt);
  const first = input.firstActivityAt == null ? null : Date.parse(input.firstActivityAt);
  return (latest === null || (Number.isFinite(latest) && latest <= clientTime))
    && (first === null || (Number.isFinite(first) && latest !== null && first <= latest));
}

/** Late input invalidates the affected observations; do not leave known false idle in history. */
async function discardUncertainTail(tx: Prisma.TransactionClient, session: UserActivitySession, from: Date) {
  const rows = await tx.userActivityInterval.findMany({ where: { sessionId: session.id, endedAt: { gt: from } } });
  for (const row of rows) {
    const removed = BigInt(row.endedAt.getTime() - Math.max(from.getTime(), row.startedAt.getTime()));
    if (row.state === 'idle') session.measuredIdleMilliseconds -= removed;
    else session.measuredActiveMilliseconds -= removed;
    if (row.startedAt >= from) await tx.userActivityInterval.delete({ where: { id: row.id } });
    else await tx.userActivityInterval.update({ where: { id: row.id }, data: { endedAt: from } });
  }
  session.currentIdleMilliseconds = 0n;
}

export async function processHeartbeat(
  sessionId: string,
  userId: string,
  _visibilityState: 'visible' | 'hidden',
  _hadActivitySinceLastBeat: boolean,
  measurement?: ActivityMeasurementInput,
) {
  let refreshDashboard = false;
  const response = await prisma.$transaction(async tx => {
    await lockUser(tx, userId);
    const now = new Date();
    let session = await tx.userActivitySession.findFirst({ where: { id: sessionId, userId, endedAt: null } });
    if (!session) throw new Error('Session not found');
    const user = await tx.user.findUnique({ where: { id: userId }, select: { workStartTime: true, workEndTime: true, subCompanyId: true, role: true, isActive: true } });
    if (user?.subCompanyId && user.subCompanyId !== session.subCompanyId) throw new Error('Session not found');
    session = await alignWorkingHoursTimezone(tx, session);
    if (!usesCrmActivityTracking(user?.role) || user?.isActive === false) {
      return stateResponse(await disableMeasurement(tx, session), now, false);
    }
    if (session.onBreak) await ensureRecordedBreak(tx, session, now);
    const thresholdSeconds = (await getIdleThresholdMinutes(session.subCompanyId)) * 60;
    const elapsedMs = now.getTime() - session.lastSeenAt.getTime();
    const valid = validMeasurement(measurement);
    const clientTime = valid ? new Date(measurement.clientTime) : null;
    // Duplicate or reordered packets cannot mutate coverage or revive an old input.
    const sameClient = valid && session.measurementClientId === measurement.clientId;
    if (sameClient && clientTime && session.lastClientTime && clientTime <= session.lastClientTime) return stateResponse(session, now);
    const clientElapsed = clientTime && session.lastClientTime ? clientTime.getTime() - session.lastClientTime.getTime() : null;
    const reportedInput = valid && measurement.lastActivityAt ? new Date(measurement.lastActivityAt) : null;
    const newlyReportedInput = !!reportedInput && (!sameClient || !session.lastReportedInputAt || reportedInput > session.lastReportedInputAt);
    const lateInput = sameClient && newlyReportedInput && !!session.lastClientTime && reportedInput! < session.lastClientTime;
    if (lateInput && session.measurementStartedAt) {
      const first = measurement!.firstActivityAt ? new Date(measurement!.firstActivityAt) : reportedInput!;
      const newFirstKnown = !session.lastReportedInputAt || first > session.lastReportedInputAt;
      const mapped = new Date(session.lastSeenAt.getTime() + first.getTime() - session.lastClientTime!.getTime());
      const uncertainFrom = newFirstKnown && mapped > session.measurementStartedAt ? mapped : session.measurementStartedAt;
      await discardUncertainTail(tx, session, uncertainFrom);
    }
    // Advance by the client's observed elapsed time, never by delivery latency.
    // If a packet arrives slightly earlier than this prediction, retain the
    // observation but trim its uncertain tail at receipt. The next anchor uses
    // that clipped end, so discarded milliseconds are never counted later.
    const predictedObservedAt = clientElapsed === null ? now : new Date(session.lastSeenAt.getTime() + clientElapsed);
    const observedAt = new Date(Math.min(predictedObservedAt.getTime(), now.getTime()));
    const continuous = valid && sameClient && !lateInput && !!session.lastClientTime && !!session.lastInputAt
      && elapsedMs > 0 && elapsedMs <= MAX_NORMAL_ELAPSED_S * 1000
      && clientElapsed !== null && clientElapsed > 0 && clientElapsed <= MAX_NORMAL_ELAPSED_S * 1000
      && Math.abs(now.getTime() - predictedObservedAt.getTime()) <= 5000
      && session.trackingTimezone === WORKING_HOURS_TIME_ZONE;
    const freshInput = continuous && newlyReportedInput && measurement.lastActivityAt !== null
      && Date.parse(measurement.lastActivityAt) >= session.lastClientTime!.getTime();
    const mapInput = (value: string) => new Date(Math.max(session.lastSeenAt.getTime(), Math.min(observedAt.getTime(), session.lastSeenAt.getTime() + Date.parse(value) - session.lastClientTime!.getTime())));
    const lastInput = freshInput ? mapInput(measurement!.lastActivityAt!) : null;
    const firstInput = freshInput && measurement!.firstActivityAt && Date.parse(measurement!.firstActivityAt) >= session.lastClientTime!.getTime()
      ? mapInput(measurement!.firstActivityAt) : null;
    const intervals = continuous ? measureActivityWindow({
      from: session.lastSeenAt, to: observedAt, previousInputAt: session.lastInputAt!, lastInputAt: lastInput,
      firstInputAt: firstInput, thresholdSeconds, timeZone: WORKING_HOURS_TIME_ZONE,
      workStartTime: user?.workStartTime, workEndTime: user?.workEndTime, onBreak: session.onBreak,
    }).intervals : [];
    const inputAt = continuous ? lastInput ?? session.lastInputAt! : now;
    const measuredThrough = continuous ? observedAt : now;
    let activeMs = session.measuredActiveMilliseconds;
    let idleMs = session.measuredIdleMilliseconds;
    let currentIdleMs = continuous && !freshInput && !session.onBreak ? session.currentIdleMilliseconds : 0n;
    for (const interval of intervals) {
      const ms = BigInt(interval.endedAt.getTime() - interval.startedAt.getTime());
      if (interval.state === 'idle') { idleMs += ms; if (!freshInput) currentIdleMs += ms; }
      else activeMs += ms;
    }
    if (!continuous || freshInput) {
      const finalIdleMs = intervals.filter(interval => interval.state === 'idle')
        .reduce((sum, interval) => sum + BigInt(interval.endedAt.getTime() - interval.startedAt.getTime()), 0n);
      refreshDashboard = await finishIdleEpisode(tx, session, session.currentIdleMilliseconds + finalIdleMs, firstInput ?? session.lastSeenAt);
    }
    // Test the actual current instant, including exact shift boundaries, without extrapolating duration.
    const insideHours = valid && measureActivityWindow({
      from: measuredThrough, to: new Date(measuredThrough.getTime() + 1), previousInputAt: inputAt, lastInputAt: null,
      thresholdSeconds, timeZone: WORKING_HOURS_TIME_ZONE, workStartTime: user?.workStartTime,
      workEndTime: user?.workEndTime, onBreak: session.onBreak,
    }).intervals.length > 0;
    const idle = continuous && insideHours && !session.onBreak && measuredThrough.getTime() - inputAt.getTime() >= thresholdSeconds * 1000;
    const currentState: ActivityState = idle ? 'idle' : 'active';
    const updated = await tx.userActivitySession.update({ where: { id: session.id }, data: {
      lastSeenAt: measuredThrough, lastClientTime: clientTime, lastInputAt: inputAt,
      measurementClientId: valid ? measurement.clientId : null,
      lastReportedInputAt: sameClient && session.lastReportedInputAt && (!reportedInput || reportedInput < session.lastReportedInputAt)
        ? session.lastReportedInputAt : reportedInput,
      trackingTimezone: WORKING_HOURS_TIME_ZONE,
      measurementStartedAt: continuous ? session.measurementStartedAt : valid ? now : null,
      currentState, idleStartedAt: idle ? new Date(inputAt.getTime() + thresholdSeconds * 1000) : null,
      measuredActiveMilliseconds: activeMs, measuredIdleMilliseconds: idleMs, currentIdleMilliseconds: currentIdleMs,
      activeSeconds: seconds(activeMs), idleSeconds: seconds(idleMs),
      offlineSeconds: { increment: elapsedMs > MAX_NORMAL_ELAPSED_S * 1000 ? Math.floor(elapsedMs / 1000) : 0 },
      version: { increment: 1 },
    } });
    if (intervals.length) await saveIntervals(tx, session.id, intervals);
    if (currentState !== session.currentState) await tx.userActivityEvent.create({ data: {
      sessionId, eventType: 'state_change', reasonCode: idle ? 'measured_inactivity' : 'observed_input_or_measurement_reset',
      metadata: { previousState: session.currentState, newState: currentState, measurementVersion: 2 },
    } });
    return { ...stateResponse(updated, now), trackingPaused: !valid || !insideHours || session.onBreak };
  });
  // Broadcast every confirmed measurement so all tabs display the same measured total/break state.
  emitToUsers([userId], 'activity:state_changed', response);
  if (refreshDashboard) emitToUsers([userId], 'call:refresh', {});
  return response;
}

/** Explicit return/break transitions never invent activity between the last observation and this request. */
async function transitionSession(sessionId: string, userId: string, onBreak?: boolean, breakType?: ActivityBreakType) {
  const response = await prisma.$transaction(async tx => {
    await lockUser(tx, userId);
    let session = await tx.userActivitySession.findFirst({ where: { id: sessionId, userId, endedAt: null } });
    if (!session) throw new Error('Session not found');
    const now = new Date();
    const nextBreak = onBreak ?? session.onBreak;
    const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true, subCompanyId: true } });
    if (user?.subCompanyId && user.subCompanyId !== session.subCompanyId) throw new Error('Session not found');
    session = await alignWorkingHoursTimezone(tx, session);
    const trackingEnabled = usesCrmActivityTracking(user?.role) && user?.isActive !== false;
    const eligibleSession = !trackingEnabled ? await disableMeasurement(tx, session, now) : session;
    if (onBreak !== undefined && onBreak === session.onBreak) {
      if (onBreak && trackingEnabled) await ensureRecordedBreak(tx, session, now);
      return stateResponse(eligibleSession, now, trackingEnabled);
    }
    await finishIdleEpisode(tx, session, session.currentIdleMilliseconds, session.lastSeenAt);
    if (session.onBreak && !nextBreak) await finishDeclaredBreak(tx, session, now, 'user_returned');
    const nextBreakType = nextBreak ? session.onBreak ? session.breakType ?? 'break' : breakType ?? 'break' : null;
    const updated = await tx.userActivitySession.update({ where: { id: sessionId }, data: {
      currentState: 'active', idleStartedAt: null, currentIdleMilliseconds: 0n,
      lastInputAt: trackingEnabled ? now : null, lastClientTime: null, lastSeenAt: now,
      onBreak: nextBreak, breakStartedAt: nextBreak ? session.breakStartedAt ?? now : null,
      breakType: nextBreakType,
      trackingTimezone: WORKING_HOURS_TIME_ZONE, version: { increment: 1 },
    } });
    if (nextBreak && trackingEnabled) await ensureRecordedBreak(tx, updated, now);
    await tx.userActivityEvent.create({ data: { sessionId,
      eventType: onBreak === undefined ? 'manual_back' : onBreak ? 'break_started' : 'break_ended',
      reasonCode: 'user_confirmed', metadata: { measurementVersion: 2 },
    } });
    return stateResponse(updated, now, trackingEnabled);
  });
  emitToUsers([userId], 'activity:state_changed', response);
  emitToUsers([userId], 'call:refresh', {});
  return response;
}

export async function processManualBack(sessionId: string, userId: string, measurement?: ActivityMeasurementInput) {
  if (measurement) await processHeartbeat(sessionId, userId, 'visible', true, measurement);
  return transitionSession(sessionId, userId);
}
export async function processBreak(sessionId: string, userId: string, onBreak: boolean, _timeZone: string, measurement?: ActivityMeasurementInput, breakType?: ActivityBreakType) {
  if (measurement) await processHeartbeat(sessionId, userId, 'visible', true, measurement);
  return transitionSession(sessionId, userId, onBreak, breakType);
}

export async function logActivityEvent(sessionId: string, userId: string, eventType: string): Promise<void> {
  const session = await prisma.userActivitySession.findFirst({ where: { id: sessionId, userId, endedAt: null }, select: { id: true } });
  if (session) await prisma.userActivityEvent.create({ data: { sessionId, eventType } });
}
