/**
 * Mailing list assignment rules.
 *
 * - Only the list creator may add/remove assignees (enforced in routes).
 * - Reach follows RBAC data scope (same model as task assignment):
 *     own    → cannot assign (no lists:assign permission)
 *     team   → direct reports only
 *     agency+ → any active user inside the list's agency
 * - Same-agency only: a target must belong to the list's sub-company.
 * - No self-assign.
 */
import type { Request } from 'express';
import prisma from '../config/database';
import { effectiveActorId } from '../middleware/actAs';
import { ensureAccessContext } from '../utils/requestPermission';
import {
  canViewAllDataInAgency,
  canViewTeamData,
  isOwnDataOnlyScope,
} from './accessContext';
import { fetchTeamUserIds } from './teamScope';
import { getUserRoleTitleSync } from './rbac';

type AssignableList = { id: string; createdById: string | null; subCompanyId: string };

/**
 * Validate that `req`'s caller may assign `list` to `targetUserId`.
 * Returns an error message, or null when allowed.
 */
export async function assertCanAssignList(
  req: Request,
  list: AssignableList,
  targetUserId: string,
): Promise<string | null> {
  const ctx = await ensureAccessContext(req);
  if (!ctx || isOwnDataOnlyScope(ctx)) return 'You cannot assign lists';

  const actorId = effectiveActorId(req);
  if (list.createdById !== actorId) return 'You can only assign lists you created';
  if (targetUserId === actorId) return 'You cannot assign a list to yourself';

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, isActive: true, subCompanyId: true, reportingManagerIds: true },
  });
  if (!target || !target.isActive) return 'User not found or inactive';
  if (target.subCompanyId !== list.subCompanyId) return 'User is not in this list’s agency';

  if (canViewAllDataInAgency(ctx)) return null;

  if (canViewTeamData(ctx)) {
    if (!target.reportingManagerIds.includes(actorId)) {
      return 'You can only assign lists to your direct reports';
    }
    return null;
  }

  return 'You cannot assign lists';
}

export type AssignableUser = {
  id: string;
  firstName: string;
  lastName: string;
  roleLabel: string;
};

/**
 * Users the caller may add to `list`, excluding the caller and anyone already assigned.
 */
export async function resolveAssignableUsers(
  req: Request,
  list: AssignableList,
): Promise<AssignableUser[]> {
  const ctx = await ensureAccessContext(req);
  if (!ctx || isOwnDataOnlyScope(ctx)) return [];

  const actorId = effectiveActorId(req);

  const existing = await prisma.mailingListAssignment.findMany({
    where: { listId: list.id },
    select: { userId: true },
  });
  const exclude = new Set<string>([actorId, ...existing.map((a) => a.userId)]);

  let candidateIds: string[] | null = null; // null = every active agency user
  if (!canViewAllDataInAgency(ctx)) {
    if (!canViewTeamData(ctx)) return [];
    candidateIds = (await fetchTeamUserIds(actorId, list.subCompanyId)).filter((id) => id !== actorId);
  }

  const users = await prisma.user.findMany({
    where: {
      subCompanyId: list.subCompanyId,
      isActive: true,
      ...(candidateIds ? { id: { in: candidateIds } } : {}),
    },
    select: { id: true, firstName: true, lastName: true, role: true, userType: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });

  return users
    .filter((u) => !exclude.has(u.id))
    .map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      roleLabel: getUserRoleTitleSync(u),
    }));
}

/** Whether the caller may edit `list`'s members: owner, current assignee, or agency leader. */
export async function canEditListMembers(
  req: Request,
  list: { createdById: string | null; id: string },
): Promise<boolean> {
  const ctx = await ensureAccessContext(req);
  if (!ctx) return false;

  const actorId = effectiveActorId(req);
  if (list.createdById === actorId) return true;
  if (canViewAllDataInAgency(ctx)) return true;

  const assignment = await prisma.mailingListAssignment.findUnique({
    where: { listId_userId: { listId: list.id, userId: actorId } },
    select: { id: true },
  });
  return !!assignment;
}
