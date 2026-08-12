/**
 * Shared helpers for agency-scoped client visibility and related resources.
 */
import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import type { JwtPayload } from '../middleware/auth';
import { resolveAllowedSubCompanyIds } from '../config/agencyScope';
import { canAccessMultipleAgencies, getUserRoleEnumKeysForScopeLevels } from './accessContext';
import { ensureAccessContext } from '../utils/requestPermission';

/** Role enum keys with global data scope (director, super_admin, etc.). */
async function fetchGlobalCreatorRoleKeys(): Promise<string[]> {
  return getUserRoleEnumKeysForScopeLevels(['global']);
}

/** Users with global scope or agencies:global see cross-agency client detail merges. */
export async function isGlobalCreatorRole(req: Request): Promise<boolean> {
  const ctx = await ensureAccessContext(req);
  if (!ctx) return false;
  return ctx.scopeLevel === 'global' || ctx.permissions.includes('agencies:global');
}

function toSubFilter(subCompanyIds: string[]): string | { in: string[] } {
  return subCompanyIds.length === 1 ? subCompanyIds[0] : { in: subCompanyIds };
}

export type ClientDetailAgencyScope = {
  primarySubCompanyId: string;
  subCompanyIds: string[];
  /** Elevated user requested merged data across allowed agencies */
  viewAllAgencies: boolean;
  /** Users whose RBAC scope is global (cross-agency notes/calls visibility). */
  globalCreatorRoleKeys: string[];
};

export async function wantsAllAgenciesClientDetail(req: Request): Promise<boolean> {
  const flag = req.query.allAgencies === 'true';
  if (!flag) return false;
  const ctx = await ensureAccessContext(req);
  return ctx ? canAccessMultipleAgencies(ctx) : false;
}

export async function resolveClientDetailScope(
  req: Request,
  primarySubCompanyId: string,
): Promise<ClientDetailAgencyScope> {
  if ((await wantsAllAgenciesClientDetail(req)) && req.user) {
    const ids = await resolveAllowedSubCompanyIds(req.user as JwtPayload);
    const subCompanyIds = ids.length > 0 ? ids : [primarySubCompanyId];
    const globalCreatorRoleKeys = await fetchGlobalCreatorRoleKeys();
    return {
      primarySubCompanyId,
      subCompanyIds,
      viewAllAgencies: true,
      globalCreatorRoleKeys,
    };
  }
  const globalCreatorRoleKeys = await fetchGlobalCreatorRoleKeys();
  return {
    primarySubCompanyId,
    subCompanyIds: [primarySubCompanyId],
    viewAllAgencies: false,
    globalCreatorRoleKeys,
  };
}

/** Clients visible in an agency context (global or agency-linked). */
export function clientVisibilityWhere(subCompanyId: string): Prisma.ClientWhereInput {
  const subFilter = toSubFilter([subCompanyId]);
  return {
    OR: [
      { visibility: 'global' },
      { visibility: 'agency', clientSubCompanies: { some: { subCompanyId: subFilter } } },
    ],
  };
}

/** True when the client exists and is visible under the given agency. */
export async function assertClientAccessibleInAgency(
  clientId: string,
  subCompanyId: string,
): Promise<boolean> {
  const row = await prisma.client.findFirst({
    where: { id: clientId, ...clientVisibilityWhere(subCompanyId) },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * Notes visibility:
 *   - mine (userId == viewerId), OR
 *   - public + in any agency the viewer can see, OR
 *   - shared with the viewer
 * `viewerId` must be the authenticated user; omit only when serving an admin tool.
 */
export function notesForClientDetail(
  scope: ClientDetailAgencyScope,
  viewerId?: string,
): Prisma.ClientNoteWhereInput {
  const subFilter = toSubFilter(scope.subCompanyIds);
  const orClauses: Prisma.ClientNoteWhereInput[] = [
    { visibility: 'public', subCompanyId: subFilter },
    { visibility: 'public', userRole: { in: scope.globalCreatorRoleKeys } },
    // public_global: visible to everyone, every agency
    { visibility: 'public_global' },
  ];
  if (viewerId) {
    orClauses.push({ userId: viewerId });
    orClauses.push({ visibility: 'shared', sharedWith: { has: viewerId } });
  }
  return { OR: orClauses };
}

export function tagsForClientDetail(scope: ClientDetailAgencyScope): Prisma.ClientTagWhereInput {
  return { subCompanyId: toSubFilter(scope.subCompanyIds) };
}

export function callsForClientDetail(scope: ClientDetailAgencyScope): Prisma.CallWhereInput {
  if (scope.viewAllAgencies) {
    return { subCompanyId: toSubFilter(scope.subCompanyIds) };
  }
  return {
    OR: [
      { subCompanyId: scope.primarySubCompanyId },
      { owner: { role: { in: scope.globalCreatorRoleKeys } } },
    ],
  };
}

export function followUpsForClientDetail(scope: ClientDetailAgencyScope): Prisma.FollowUpWhereInput {
  if (scope.viewAllAgencies) {
    return { subCompanyId: toSubFilter(scope.subCompanyIds) };
  }
  return {
    OR: [
      { subCompanyId: scope.primarySubCompanyId },
      { owner: { role: { in: scope.globalCreatorRoleKeys } } },
    ],
  };
}

export function meetingsForClientDetail(scope: ClientDetailAgencyScope): Prisma.MeetingWhereInput {
  if (scope.viewAllAgencies) {
    return { subCompanyId: toSubFilter(scope.subCompanyIds) };
  }
  return {
    OR: [
      { subCompanyId: scope.primarySubCompanyId },
      { owner: { role: { in: scope.globalCreatorRoleKeys } } },
    ],
  };
}

export function activityLogsForClientDetail(
  scope: ClientDetailAgencyScope,
  clientId: string,
): Prisma.ActivityLogWhereInput {
  const clientMeta = {
    metadata: {
      path: ['clientId'],
      equals: clientId,
    },
  } as Prisma.ActivityLogWhereInput;

  if (scope.viewAllAgencies) {
    return {
      AND: [clientMeta, { subCompanyId: toSubFilter(scope.subCompanyIds) }],
    };
  }
  return {
    AND: [
      clientMeta,
      {
        OR: [
          { subCompanyId: scope.primarySubCompanyId },
          { user: { role: { in: scope.globalCreatorRoleKeys } } },
        ],
      },
    ],
  };
}

/** Lead history for a client: all allowed agencies when viewAllAgencies; else agency + director/super_admin leads. */
export function leadHistoryWhereForClient(
  scope: ClientDetailAgencyScope,
  clientId: string,
): Prisma.LeadWhereInput {
  if (scope.viewAllAgencies) {
    return { clientId, subCompanyId: toSubFilter(scope.subCompanyIds) };
  }
  return {
    clientId,
    OR: [
      { subCompanyId: scope.primarySubCompanyId },
      { owner: { role: { in: scope.globalCreatorRoleKeys } } },
    ],
  };
}

/** @deprecated use leadHistoryWhereForClient */
export function leadsForClientHistory(
  scope: ClientDetailAgencyScope,
): Prisma.LeadWhereInput['subCompanyId'] | Prisma.StringFilter {
  return toSubFilter(scope.subCompanyIds) as Prisma.LeadWhereInput['subCompanyId'];
}

/** Prisma filter: documents for this agency view (incl. global director uploads). */
export function documentsForClientDetail(scope: ClientDetailAgencyScope): Prisma.DocumentWhereInput {
  if (scope.viewAllAgencies) {
    return {
      OR: [
        { subCompanyId: toSubFilter(scope.subCompanyIds) },
        { isPublic: true },
      ],
    };
  }
  return {
    OR: [
      { subCompanyId: scope.primarySubCompanyId },
      { isPublic: true },
    ],
  };
}

/** @deprecated use documentsForClientDetail */
export function documentAgencyWhere(subCompanyId: string): Prisma.DocumentWhereInput {
  return documentsForClientDetail({
    primarySubCompanyId: subCompanyId,
    subCompanyIds: [subCompanyId],
    viewAllAgencies: false,
    globalCreatorRoleKeys: [],
  });
}
