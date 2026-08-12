/**
 * Expand linked-account anchor user IDs into list filters by each user's
 * normal RBAC data scope (own / team / agency|global).
 *
 * Fail-closed: only link-group members (+ caller) are valid anchors.
 */
import type { DataScopeLevel } from '@prisma/client';
import prisma from '../config/database';
import { resolveEffectiveScopeLevel } from './accessContext';
import { getDataScopeLevelForRoleKey, getEffectivePermissionKeysForRoleKey } from './rbac';
import { teamMemberIds } from './listOwnerScope';

export type LinkedOwnerExpansion = {
  /** Owner IDs for the owner-filtered branch (own/team anchors). */
  userIds: string[];
  /** Agencies where results are limited to userIds. */
  ownerSubCompanyIds: string[];
  /** Agencies with full agency/global visibility (no owner predicate). */
  agencySubCompanyIds: string[];
  /** Union of owner + agency subCompany IDs. */
  subCompanyIds: string[];
  mode: 'owners' | 'agencies' | 'mixed';
};

async function scopeLevelForUserRole(roleKey: string): Promise<DataScopeLevel> {
  const [scopeFromDb, permissions] = await Promise.all([
    getDataScopeLevelForRoleKey(roleKey),
    getEffectivePermissionKeysForRoleKey(roleKey),
  ]);
  return resolveEffectiveScopeLevel(roleKey, scopeFromDb, permissions);
}

/** Validate requestedIds against the caller's link group (excludes caller). */
async function resolveLinkedAnchors(
  callerUserId: string,
  requestedIds: string[],
): Promise<{ userIds: string[]; subCompanyIds: string[] } | null> {
  if (requestedIds.length === 0) return null;
  const callerLink = await prisma.userAgencyLink.findFirst({
    where: { userId: callerUserId },
    select: { groupId: true },
  });
  if (!callerLink) return null;
  const matched = await prisma.userAgencyLink.findMany({
    where: { groupId: callerLink.groupId, userId: { in: requestedIds, not: callerUserId } },
    include: { user: { select: { subCompanyId: true } } },
  });
  if (matched.length === 0) return null;
  const subCompanyIds = [
    ...new Set(matched.map((m) => m.user.subCompanyId).filter((id): id is string => !!id)),
  ];
  return { userIds: matched.map((m) => m.userId), subCompanyIds };
}

function finalizeMode(
  userIds: string[],
  ownerSubCompanyIds: string[],
  agencySubCompanyIds: string[],
): LinkedOwnerExpansion {
  const subCompanyIds = [...new Set([...ownerSubCompanyIds, ...agencySubCompanyIds])];
  const hasOwners = userIds.length > 0 && ownerSubCompanyIds.length > 0;
  const hasAgencies = agencySubCompanyIds.length > 0;
  let mode: LinkedOwnerExpansion['mode'] = 'owners';
  if (hasOwners && hasAgencies) mode = 'mixed';
  else if (hasAgencies && !hasOwners) mode = 'agencies';
  return {
    userIds: [...new Set(userIds)],
    ownerSubCompanyIds: [...new Set(ownerSubCompanyIds)],
    agencySubCompanyIds: [...new Set(agencySubCompanyIds)],
    subCompanyIds,
    mode,
  };
}

/**
 * Expand requested linked-anchor IDs into owner and/or agency list scope.
 * Returns null when nothing valid is found (caller should fall back to normal scope).
 *
 * @param opts.exact When true, do not expand team/agency scopes — filter to the
 *   anchor user IDs only (manager chip = that manager's records, not their whole team).
 */
export async function expandLinkedOwnerScope(
  callerUserId: string,
  callerSubCompanyId: string | null | undefined,
  requestedIds: string[],
  opts?: { exact?: boolean },
): Promise<LinkedOwnerExpansion | null> {
  if (requestedIds.length === 0) return null;
  const exact = !!opts?.exact;

  const callerIncluded = requestedIds.includes(callerUserId);
  const idsToValidate = requestedIds.filter((id) => id !== callerUserId);

  const linked =
    idsToValidate.length > 0
      ? await resolveLinkedAnchors(callerUserId, idsToValidate)
      : null;

  // Caller-only selection still requires a link group (linked-filter context).
  if (!linked && !callerIncluded) return null;
  if (!linked && callerIncluded) {
    const callerLink = await prisma.userAgencyLink.findFirst({
      where: { userId: callerUserId },
      select: { groupId: true },
    });
    if (!callerLink) return null;
  }

  const anchorIds = [
    ...(callerIncluded ? [callerUserId] : []),
    ...(linked?.userIds ?? []),
  ];
  if (anchorIds.length === 0) return null;

  const users = await prisma.user.findMany({
    where: { id: { in: anchorIds }, isActive: true },
    select: { id: true, role: true, subCompanyId: true },
  });
  if (users.length === 0) return null;

  const userIds: string[] = [];
  const ownerSubCompanyIds: string[] = [];
  const agencySubCompanyIds: string[] = [];

  for (const u of users) {
    const agencyId =
      u.id === callerUserId
        ? (u.subCompanyId ?? callerSubCompanyId ?? null)
        : u.subCompanyId;
    if (!agencyId) continue;

    if (exact) {
      // Manager / person chip: only that user's records.
      userIds.push(u.id);
      ownerSubCompanyIds.push(agencyId);
      continue;
    }

    const level = await scopeLevelForUserRole(u.role);
    if (level === 'agency' || level === 'global') {
      agencySubCompanyIds.push(agencyId);
      continue;
    }
    if (level === 'team') {
      const team = await teamMemberIds(u.id, agencyId);
      userIds.push(...team);
      ownerSubCompanyIds.push(agencyId);
      continue;
    }
    // own
    userIds.push(u.id);
    ownerSubCompanyIds.push(agencyId);
  }

  const result = finalizeMode(userIds, ownerSubCompanyIds, agencySubCompanyIds);
  if (result.subCompanyIds.length === 0) return null;
  if (result.mode === 'owners' && result.userIds.length === 0) return null;
  return result;
}

/** Read ownerExact=1|true from list query (manager chip = exact person, not expanded team). */
export function ownerExactFromQuery(query: unknown): boolean {
  if (!query || typeof query !== 'object') return false;
  const v = (query as Record<string, unknown>).ownerExact;
  return v === '1' || v === 'true' || v === true;
}

/**
 * Prisma where fragment for a top-level ownerId + subCompanyId model
 * (leads, tasks, meetings, follow-ups, etc.).
 */
export function linkedExpansionToWhere(
  exp: LinkedOwnerExpansion,
  ownerField: string = 'ownerId',
): Record<string, unknown> {
  if (exp.mode === 'owners') {
    return {
      [ownerField]: { in: exp.userIds },
      subCompanyId: { in: exp.subCompanyIds },
    };
  }
  if (exp.mode === 'agencies') {
    return { subCompanyId: { in: exp.agencySubCompanyIds } };
  }
  const clauses: Record<string, unknown>[] = [];
  if (exp.userIds.length > 0 && exp.ownerSubCompanyIds.length > 0) {
    clauses.push({
      [ownerField]: { in: exp.userIds },
      subCompanyId: { in: exp.ownerSubCompanyIds },
    });
  }
  if (exp.agencySubCompanyIds.length > 0) {
    clauses.push({ subCompanyId: { in: exp.agencySubCompanyIds } });
  }
  if (clauses.length === 0) {
    return { subCompanyId: { in: exp.subCompanyIds } };
  }
  if (clauses.length === 1) return clauses[0];
  return { OR: clauses };
}
