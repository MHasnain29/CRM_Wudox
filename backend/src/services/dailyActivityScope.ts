/**
 * Daily Agenda scope — who owns rows in the feed for a tree selection.
 * One person selected → only that person's items (matches their row count).
 * Entire team → all visible users in the agency.
 */
import prisma from '../config/database';
import type { JwtPayload } from '../middleware/auth';
import { filterVisibleUserIds, getVisibleUserIds } from './teamScope';

export type DailyActivityAgendaScope = 'agency' | 'user';

export interface ResolvedAgendaScope {
  userIds: string[];
  scope: DailyActivityAgendaScope;
  label: string;
}

function displayName(u: { firstName: string; lastName: string }): string {
  const name = `${u.firstName} ${u.lastName}`.trim();
  return name || 'User';
}

/**
 * Resolve which user IDs the agenda may include.
 * @param targetUserId null = entire visible agency; otherwise that user only
 */
export async function resolveDailyActivityAgendaUserIds(
  viewer: JwtPayload,
  targetUserId: string | null,
  requestedAgencyIds: string[] = [],
): Promise<ResolvedAgendaScope> {
  if (!targetUserId) {
    const userIds = await getVisibleUserIds(viewer, requestedAgencyIds);
    return { userIds, scope: 'agency', label: 'Entire team' };
  }

  const allowed = await filterVisibleUserIds(viewer, [targetUserId], requestedAgencyIds);
  if (allowed.length === 0) {
    return { userIds: [], scope: 'user', label: '' };
  }

  const targetId = allowed[0]!;
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, firstName: true, lastName: true },
  });

  if (!target) {
    return { userIds: [], scope: 'user', label: '' };
  }

  return {
    userIds: [targetId],
    scope: 'user',
    label: displayName(target),
  };
}
