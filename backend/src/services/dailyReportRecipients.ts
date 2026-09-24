import type { DailyReportPolicy, User } from '@prisma/client';
import { z } from 'zod';
import prisma from '../config/database';
import { resolveAllowedSubCompanyIds } from '../config/agencyScope';
import { buildAccessContext, canAccessMultipleAgencies, canViewAllDataInAgency, canViewTeamData, hasAnyPermission, hasPermission } from './accessContext';
import type { JwtPayload } from '../middleware/auth';
import type { DailyReportPayload } from './dailyReportTypes';

export const reportUserSelect = { id: true, firstName: true, lastName: true, email: true, role: true, subCompanyId: true, isActive: true, reportingManagerIds: true } as const;
export type ReportUser = Pick<User, keyof typeof reportUserSelect>;
export function userToken(user: ReportUser): JwtPayload {
  return { sub: user.id, email: user.email, role: user.role, subCompanyId: user.subCompanyId ?? '' };
}

export async function reportAudience(user: ReportUser, agencyIds: string[], directReportsOnly = false, includeInactive = false, includeOrganizationUsers = false) {
  const token = userToken(user);
  const [ctx, allowed] = await Promise.all([buildAccessContext(token), resolveAllowedSubCompanyIds(token)]);
  const agencies = [...new Set(agencyIds)].filter(id => allowed.includes(id));
  if (!user.isActive || !agencies.length || !hasAnyPermission(ctx, ['analytics:read', 'settings:write', 'jobs:read']) || (directReportsOnly && !canViewTeamData(ctx))) return { ctx, agencyIds: [], users: [] as ReportUser[] };
  const broad = !directReportsOnly && (canAccessMultipleAgencies(ctx) || canViewAllDataInAgency(ctx));
  // A shared connection's home agency is not the agency of all its members' work.
  // Expand identities only from work assigned to the agencies in this report.
  const [activityPeople, projectMappings] = await Promise.all([
    prisma.hubstaffTaskActivity.findMany({
      where: { subCompanyId: { in: agencies }, userId: { not: null } },
      select: { userId: true }, distinct: ['userId'],
    }),
    prisma.hubstaffProjectMapping.findMany({
      where: { subCompanyId: { in: agencies } },
      select: { configId: true, hubstaffProjectId: true },
    }),
  ]);
  const assignedTasks = projectMappings.length ? await prisma.hubstaffTask.findMany({
    where: { isDeleted: false, OR: projectMappings.map(mapping => ({
      configId: mapping.configId, hubstaffProjectId: mapping.hubstaffProjectId,
    })) }, select: { configId: true, assigneeIds: true },
  }) : [];
  const assigneesByConfig = new Map<string, Set<number>>();
  for (const task of assignedTasks) {
    const assignees = assigneesByConfig.get(task.configId) ?? new Set<number>();
    task.assigneeIds.forEach(id => assignees.add(id));
    if (assignees.size) assigneesByConfig.set(task.configId, assignees);
  }
  const assignedPeople = assigneesByConfig.size ? await prisma.hubstaffUserLink.findMany({
    where: {
      userId: { not: null },
      OR: [...assigneesByConfig].map(([configId, ids]) => ({ configId, hubstaffUserId: { in: [...ids] } })),
    }, select: { userId: true },
  }) : [];
  const scopedUserIds = [...new Set([
    ...activityPeople.flatMap(person => person.userId ? [person.userId] : []),
    ...assignedPeople.flatMap(person => person.userId ? [person.userId] : []),
    user.id,
  ])];
  const candidates = await prisma.user.findMany({
    where: {
      ...(includeInactive ? {} : { isActive: true }),
      OR: [{ subCompanyId: { in: agencies } }, { id: { in: scopedUserIds } }],
    }, select: reportUserSelect, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  if (includeOrganizationUsers && broad) {
    const independent = await prisma.user.findMany({ where: { subCompanyId: null, ...(includeInactive ? {} : { isActive: true }) }, select: reportUserSelect });
    for (const person of independent) {
      if (candidates.some(existing => existing.id === person.id)) continue;
      const permittedAgencies = await resolveAllowedSubCompanyIds(userToken(person));
      if (agencies.some(id => permittedAgencies.includes(id))) candidates.push(person);
    }
  }
  const users = candidates.filter(person => broad || (directReportsOnly
    ? person.reportingManagerIds.includes(user.id)
    : person.id === user.id || (canViewTeamData(ctx) && person.reportingManagerIds.includes(user.id))));
  return { ctx, agencyIds: agencies, users };
}

export function canConfigureReportDelivery(ctx: Awaited<ReturnType<typeof buildAccessContext>>): boolean {
  return (canViewAllDataInAgency(ctx) || canAccessMultipleAgencies(ctx)) &&
    ['settings:write', 'hubstaff:view_all', 'calls:read', 'tasks:read'].every(permission => hasPermission(ctx, permission)) &&
    hasAnyPermission(ctx, ['clients:read', 'employees:read']);
}

export const reportRecipientEmail = z.string().trim().toLowerCase().email().max(254);

/** The saved administrator authorizes the report; the email is only its destination. */
export async function resolveReportDeliveryTarget(policy: DailyReportPolicy): Promise<{ user: ReportUser; email: string; agencyIds: string[] } | null> {
  const parsed = reportRecipientEmail.safeParse(policy.recipientEmail);
  if (!parsed.success || !policy.recipientsConfigured || !policy.authorizedById || !policy.agencyIds.length) return null;
  const user = await prisma.user.findUnique({ where: { id: policy.authorizedById }, select: reportUserSelect });
  if (!user?.isActive) return null;
  const [ctx, allowed] = await Promise.all([buildAccessContext(userToken(user)), resolveAllowedSubCompanyIds(userToken(user))]);
  if (!canConfigureReportDelivery(ctx) || policy.agencyIds.some(id => !allowed.includes(id))) return null;
  if (policy.scope === 'organization') {
    const agencies = await prisma.subCompany.findMany({ where: { mainOrgId: policy.scopeId }, select: { id: true } });
    if (!canAccessMultipleAgencies(ctx) || !agencies.length || agencies.some(agency => !allowed.includes(agency.id))) return null;
    if (policy.agencyIds.some(id => !agencies.some(agency => agency.id === id))) return null;
    return { user, email: parsed.data, agencyIds: agencies.map(agency => agency.id) };
  } else if (policy.scope !== 'agency' || policy.agencyIds.length !== 1 || policy.agencyIds[0] !== policy.scopeId) return null;
  return { user, email: parsed.data, agencyIds: policy.agencyIds };
}

/** Snapshots are immutable, but access is rechecked against today's permissions. */
export async function canReadReport(user: ReportUser, report: DailyReportPayload): Promise<boolean> {
  const audience = await reportAudience(user, report.agencyIds, false, true, report.scope === 'organization');
  if (report.agencyIds.some(id => !audience.agencyIds.includes(id))) return false;
  if (report.userIds.some(id => !audience.users.some(u => u.id === id))) return false;
  if (!hasPermission(audience.ctx, 'hubstaff:view_all') && report.people.some(person => person.userId !== user.id && (person.time.trackedSeconds !== null || person.tasks.length > 0))) return false;
  return report.requiredPermissions.every(permission => hasPermission(audience.ctx, permission));
}
