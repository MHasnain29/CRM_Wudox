import prisma from '../config/database';
import type { CrmInactivity } from './dailyReportTypes';
import { usesCrmActivityTracking } from './crmActivityEligibility';

type Range = [number, number];
export interface CrmObservedInterval {
  state: string;
  startedAt: Date;
  endedAt: Date;
  session: { userId: string };
}

export interface CrmDeclaredBreak {
  startedAt: Date;
  endedAt: Date | null;
  session: { userId: string };
}

function unionMilliseconds(ranges: Range[]): number {
  let total = 0;
  let start = 0;
  let end = 0;
  for (const range of ranges.sort((a, b) => a[0] - b[0])) {
    if (range[0] > end) {
      total += end - start;
      [start, end] = range;
    } else end = Math.max(end, range[1]);
  }
  return total + end - start;
}

/** Activity requires observations; a declared break lasts until ended or the report cutoff. */
export function aggregateCrmInactivity(
  rows: CrmObservedInterval[], userIds: string[], periodStart: Date, periodEnd: Date,
  breaks: CrmDeclaredBreak[] = [],
): Map<string, CrmInactivity> {
  const ranges = new Map(userIds.map(userId => [userId, {
    observed: [] as Range[], active: [] as Range[], breaks: [] as Range[], breakOngoing: false,
  }]));
  for (const row of breaks) {
    const own = ranges.get(row.session.userId);
    if (!own) continue;
    const start = Math.max(periodStart.getTime(), row.startedAt.getTime());
    const end = Math.min(periodEnd.getTime(), (row.endedAt ?? periodEnd).getTime());
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    own.breaks.push([start, end]);
    if (!row.endedAt || row.endedAt > periodEnd) own.breakOngoing = true;
  }
  for (const row of rows) {
    const own = ranges.get(row.session.userId);
    if (!own || !['active', 'idle'].includes(row.state)) continue;
    const start = Math.max(periodStart.getTime(), row.startedAt.getTime());
    const end = Math.min(periodEnd.getTime(), row.endedAt.getTime());
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    own.observed.push([start, end]);
    if (row.state === 'active') own.active.push([start, end]);
  }
  return new Map([...ranges].map(([userId, own]): [string, CrmInactivity] => {
    const breakMs = unionMilliseconds(own.breaks);
    // Explicit breaks win over any conflicting legacy/multi-session observation.
    const observedMs = unionMilliseconds([...own.observed, ...own.breaks]) - breakMs;
    // Any active evidence rules out inactivity during the same instant, including
    // conflicting observations from overlapping legacy sessions.
    const activeMs = unionMilliseconds([...own.active, ...own.breaks]) - breakMs;
    const idleMs = observedMs - activeMs;
    const activeSeconds = Math.floor(activeMs / 1000);
    const idleSeconds = Math.floor(idleMs / 1000);
    return [userId, {
      activeSeconds: observedMs > 0 ? activeSeconds : null,
      idleSeconds: observedMs > 0 ? idleSeconds : null,
      breakSeconds: Math.floor(breakMs / 1000),
      breakOngoing: own.breakOngoing,
      // Truncate each measured state after merging; displayed states reconcile
      // exactly with displayed coverage without rounding either state upwards.
      observedSeconds: activeSeconds + idleSeconds,
      status: observedMs > 0 ? 'measured' : 'unavailable',
    }];
  }));
}

/** All IDs must come from the report audience, never directly from request parameters. */
export async function loadCrmInactivity(
  userIds: string[], agencyIds: string[], independentUserIds: string[], periodStart: Date, periodEnd: Date,
): Promise<Map<string, CrmInactivity>> {
  if (!userIds.length || periodEnd <= periodStart) return aggregateCrmInactivity([], userIds, periodStart, periodEnd);
  const independent = independentUserIds.filter(id => userIds.includes(id));
  const session = {
    userId: { in: userIds },
    OR: [
      { subCompanyId: { in: agencyIds } },
      // Independent identities have no home agency; older sessions may use
      // their user ID or a fallback agency as the non-null context value.
      ...(independent.length ? [{ userId: { in: independent } }] : []),
    ],
  };
  const [rows, breaks] = await Promise.all([prisma.userActivityInterval.findMany({
    where: {
      startedAt: { lt: periodEnd }, endedAt: { gt: periodStart }, state: { in: ['active', 'idle'] },
      session,
    },
    select: { state: true, startedAt: true, endedAt: true, session: { select: { userId: true } } },
  }), prisma.userActivityBreak.findMany({
    where: {
      startedAt: { lt: periodEnd }, OR: [{ endedAt: null }, { endedAt: { gt: periodStart } }], session,
    },
    select: { startedAt: true, endedAt: true, session: { select: { userId: true } } },
  })]);
  return aggregateCrmInactivity(rows, userIds, periodStart, periodEnd, breaks);
}

/** The caller supplies the authorized audience; role eligibility is enforced before querying. */
export function loadCrmInactivityForAudience(
  users: { id: string; role: string; subCompanyId: string | null }[], agencyIds: string[], periodStart: Date, periodEnd: Date,
): Promise<Map<string, CrmInactivity>> {
  const eligible = users.filter(user => usesCrmActivityTracking(user.role));
  return loadCrmInactivity(eligible.map(user => user.id), agencyIds,
    eligible.filter(user => !user.subCompanyId).map(user => user.id), periodStart, periodEnd);
}
