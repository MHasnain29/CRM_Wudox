import { z } from 'zod';
import type { User, UserActivitySession } from '@prisma/client';
import prisma from '../config/database';
import { resolveAllowedSubCompanyIds } from '../config/agencyScope';
import { buildAccessContext, canAccessMultipleAgencies, canViewAllDataInAgency, canViewTeamData, hasAnyPermission } from './accessContext';
import { filterInstantSchema, refineFromBeforeTo } from './campaignDateFilter';
import { reportUserSelect, userToken, type ReportUser } from './dailyReportRecipients';
import { loadCrmInactivityForAudience } from './crmInactivityReport';
import { usesCrmActivityTracking } from './crmActivityEligibility';
import type { CrmInactivity } from './dailyReportTypes';
import { MAX_NORMAL_ELAPSED_S, workingTimeIntervals } from './activityMeasurement';
import { WORKING_HOURS_TIME_ZONE } from '../config/workingHours';

const crmTimeUserSelect = { ...reportUserSelect, workStartTime: true, workEndTime: true } as const;
type CrmTimeUser = ReportUser & Pick<User, 'workStartTime' | 'workEndTime'>;

export interface CurrentCrmTracking {
  status: 'outside_working_hours' | 'on_break' | 'disconnected' | 'waiting' | 'waiting_for_canonical_measurement' | 'measuring' | 'schedule_unavailable';
  asOf: string;
  workStartTime: string | null;
  workEndTime: string | null;
  timeZone: string | null;
  lastHeartbeatAt: string | null;
  /** End of the latest persisted measurement in the current session, never a heartbeat guess. */
  lastObservedAt: string | null;
}

type CurrentSession = Pick<UserActivitySession,
  'userId' | 'lastSeenAt' | 'onBreak' | 'trackingTimezone' | 'measurementStartedAt' | 'lastClientTime' | 'lastInputAt'>
  & { intervals: { endedAt: Date }[] };

/** Describes the current session only; it never attributes historical missing time to a current cause. */
export function describeCurrentCrmTracking(
  person: Pick<CrmTimeUser, 'workStartTime' | 'workEndTime'>, session: CurrentSession | undefined, now: Date,
): CurrentCrmTracking {
  const lastObserved = session?.intervals[0]?.endedAt;
  const result: CurrentCrmTracking = {
    status: 'waiting', asOf: now.toISOString(),
    workStartTime: person.workStartTime ?? null, workEndTime: person.workEndTime ?? null,
    timeZone: WORKING_HOURS_TIME_ZONE,
    lastHeartbeatAt: session?.lastSeenAt.toISOString() ?? null, lastObservedAt: lastObserved?.toISOString() ?? null,
  };
  if (!session) return { ...result, status: 'disconnected' };
  // An explicitly declared break remains open even without fresh heartbeats.
  if (session.onBreak) return { ...result, status: 'on_break' };
  const age = now.getTime() - session.lastSeenAt.getTime();
  if (age > MAX_NORMAL_ELAPSED_S * 1000) return { ...result, status: 'disconnected' };
  if (age < 0) return result;
  const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
  const scheduleKnown = (result.workStartTime === null && result.workEndTime === null)
    || (result.workStartTime !== null && result.workEndTime !== null && clock.test(result.workStartTime) && clock.test(result.workEndTime));
  if (!scheduleKnown) return { ...result, status: 'schedule_unavailable' };
  const insideHours = workingTimeIntervals({
    from: now, to: new Date(now.getTime() + 1), timeZone: WORKING_HOURS_TIME_ZONE,
    workStartTime: result.workStartTime, workEndTime: result.workEndTime,
  }).length > 0;
  if (!insideHours) return { ...result, status: 'outside_working_hours' };
  // Existing device-timezone observations remain historical evidence. The next
  // heartbeat must establish the server-timezone baseline before we claim live measurement.
  if (session.trackingTimezone !== WORKING_HOURS_TIME_ZONE) return { ...result, status: 'waiting_for_canonical_measurement' };
  const hasRecentMeasurement = session.measurementStartedAt && session.lastClientTime && session.lastInputAt
    && lastObserved && lastObserved > session.measurementStartedAt
    && lastObserved <= now
    && now.getTime() - lastObserved.getTime() <= MAX_NORMAL_ELAPSED_S * 1000;
  return { ...result, status: hasRecentMeasurement ? 'measuring' : 'waiting' };
}

async function loadCurrentTracking(people: CrmTimeUser[], agencyIds: string[], now: Date) {
  const eligible = people.filter(person => usesCrmActivityTracking(person.role));
  if (!eligible.length) return new Map<string, CurrentCrmTracking>();
  const independentIds = eligible.filter(person => !person.subCompanyId).map(person => person.id);
  const sessions = await prisma.userActivitySession.findMany({
    where: { userId: { in: eligible.map(person => person.id) }, endedAt: null, OR: [
      { subCompanyId: { in: agencyIds } },
      ...(independentIds.length ? [{ userId: { in: independentIds } }] : []),
    ] },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], distinct: ['userId'],
    select: {
      userId: true, lastSeenAt: true, onBreak: true, trackingTimezone: true,
      measurementStartedAt: true, lastClientTime: true, lastInputAt: true,
      intervals: { where: { state: { in: ['active', 'idle'] }, endedAt: { lte: now } },
        orderBy: { endedAt: 'desc' }, take: 1, select: { endedAt: true } },
    },
  });
  const byUser = new Map(sessions.map(session => [session.userId, session]));
  return new Map(eligible.map(person => [person.id, describeCurrentCrmTracking(person, byUser.get(person.id), now)]));
}

const idsSchema = z.string().max(40_000).transform(value => [...new Set(value.split(',').map(id => id.trim()))])
  .pipe(z.array(z.string().uuid()).min(1).max(1000));

export const crmTimeReportQuerySchema = z.object({
  from: filterInstantSchema,
  to: filterInstantSchema,
  agencyIds: idsSchema.optional(),
  userIds: idsSchema.optional(),
  scope: z.enum(['mine', 'team', 'all']).default('all'),
}).superRefine(refineFromBeforeTo);

export interface CrmTimeReport {
  from: string;
  to: string;
  /** Effective observation cutoff; a requested future end never extends live time. */
  asOf: string;
  people: { userId: string; name: string; role: string; agencyId: string | null; timeSource: 'crm' | 'hubstaff'; crmInactivity?: CrmInactivity; currentTracking?: CurrentCrmTracking }[];
}

/**
 * Who a viewer may read in a Reports-page card, shared so cards fed by the same filters never disagree.
 * Filters only narrow the current account's live permissions and agency audience.
 * Returns null when an explicit agency filter names no agency the viewer may read.
 */
export async function resolveReportPeople(
  userId: string, query: z.infer<typeof crmTimeReportQuerySchema>,
): Promise<{ agencyIds: string[]; people: CrmTimeUser[] } | null> {
  const viewer = await prisma.user.findUnique({ where: { id: userId }, select: crmTimeUserSelect });
  if (!viewer?.isActive) throw Object.assign(new Error('Account unavailable'), { status: 403 });
  const token = userToken(viewer);
  const [access, permittedAgencyIds] = await Promise.all([buildAccessContext(token), resolveAllowedSubCompanyIds(token)]);
  if (!hasAnyPermission(access, ['analytics:read', 'jobs:read'])) {
    throw Object.assign(new Error('Report access requires analytics:read or jobs:read'), { status: 403 });
  }
  const agencyIds = [...new Set(query.agencyIds === undefined ? permittedAgencyIds
    : query.agencyIds.filter(id => permittedAgencyIds.includes(id)))];
  // An explicit inaccessible filter must never silently fall back to all agencies.
  if (query.agencyIds !== undefined && !agencyIds.length) return null;

  const selectedIds = query.userIds ? new Set(query.userIds) : null;
  const broad = canAccessMultipleAgencies(access) || canViewAllDataInAgency(access);
  const maySeePerson = (person: ReportUser) => person.isActive && (!selectedIds || selectedIds.has(person.id))
    && (query.scope === 'mine' ? person.id === viewer.id
      : query.scope === 'team' || !broad
        ? person.id === viewer.id || (canViewTeamData(access) && person.reportingManagerIds.includes(viewer.id))
        : true);
  const audience = new Map<string, CrmTimeUser>();
  if (query.scope !== 'mine' && agencyIds.length) {
    const limitedToTeam = query.scope === 'team' || !broad;
    const candidates = await prisma.user.findMany({
      where: {
        isActive: true, subCompanyId: { in: agencyIds },
        ...(query.userIds ? { id: { in: query.userIds } } : {}),
        ...(limitedToTeam ? { OR: [
          { id: viewer.id },
          ...(canViewTeamData(access) ? [{ reportingManagerIds: { has: viewer.id } }] : []),
        ] } : {}),
      }, select: crmTimeUserSelect, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    for (const person of candidates) {
      if (person.subCompanyId && agencyIds.includes(person.subCompanyId) && maySeePerson(person)) audience.set(person.id, person);
    }
  }
  // An independent identity's own timing remains readable without a home agency.
  if (maySeePerson(viewer) && (!viewer.subCompanyId || agencyIds.includes(viewer.subCompanyId))) audience.set(viewer.id, viewer);

  // Independent sessions can span agencies. Only cross-agency readers may select
  // another independent identity, and their permitted agency sets must overlap.
  if (query.scope !== 'mine' && query.userIds && agencyIds.length && canAccessMultipleAgencies(access)) {
    const independent = await prisma.user.findMany({
      where: { isActive: true, subCompanyId: null, id: { in: query.userIds.filter(id => id !== viewer.id) } },
      select: crmTimeUserSelect,
    });
    for (const person of independent) {
      if (person.subCompanyId || !maySeePerson(person)) continue;
      const ownAgencies = await resolveAllowedSubCompanyIds(userToken(person));
      if (ownAgencies.every(id => permittedAgencyIds.includes(id)) && agencyIds.some(id => ownAgencies.includes(id))) audience.set(person.id, person);
    }
  }
  return { agencyIds, people: [...audience.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}

/** Filters only narrow the current account's live permissions and agency audience. */
export async function buildCrmTimeReport(userId: string, rawQuery: unknown, now = new Date()): Promise<CrmTimeReport> {
  const query = crmTimeReportQuerySchema.parse(rawQuery);
  const from = new Date(query.from);
  const to = new Date(query.to);
  const cutoff = new Date(Math.min(to.getTime(), now.getTime()));
  const empty: CrmTimeReport = { from: from.toISOString(), to: to.toISOString(), asOf: cutoff.toISOString(), people: [] };
  const audience = await resolveReportPeople(userId, query);
  if (!audience) return empty;
  const { agencyIds, people } = audience;
  // The loader returns unavailable, never invented active/idle zeroes, for an
  // empty or wholly future window and does not query observations in that case.
  const [timing, currentTracking] = await Promise.all([
    loadCrmInactivityForAudience(people, agencyIds, from, cutoff),
    // Current state is only relevant to a live report, not a historical or future window.
    from <= now && now < to ? loadCurrentTracking(people, agencyIds, now) : new Map<string, CurrentCrmTracking>(),
  ]);
  return { ...empty, people: people.map(person => {
    const identity = { userId: person.id, name: `${person.firstName} ${person.lastName}`.trim() || person.email,
      role: person.role, agencyId: person.subCompanyId };
    return usesCrmActivityTracking(person.role)
      ? { ...identity, timeSource: 'crm' as const, crmInactivity: timing.get(person.id),
        ...(currentTracking.has(person.id) ? { currentTracking: currentTracking.get(person.id) } : {}) }
      : { ...identity, timeSource: 'hubstaff' as const };
  }) };
}
