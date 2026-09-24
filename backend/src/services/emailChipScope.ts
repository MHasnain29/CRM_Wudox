import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { resolveAllowedSubCompanyIds } from '../config/agencyScope';
import { effectiveActorId } from '../middleware/actAs';
import { ensureAccessContext } from '../utils/requestPermission';
import { canAccessMultipleAgencies, canViewAllDataInAgency, canViewTeamData } from './accessContext';

export type EmailChipScope = { agencyIds: string[]; ownerIds?: string[] };

/** Exact IDs from the Emails chips, intersected with the caller's existing access. */
export async function resolveEmailChipScope(
  req: Request,
  requestedAgencyIds: string[] | undefined,
  requestedOwnerIds: string[] | undefined,
): Promise<EmailChipScope> {
  const userId = effectiveActorId(req);
  const allowedAgencies = await resolveAllowedSubCompanyIds(req.user!, req);
  const agencyIds = requestedAgencyIds === undefined
    ? allowedAgencies
    : allowedAgencies.filter((id) => requestedAgencyIds.includes(id));
  const ctx = await ensureAccessContext(req);
  const agencyWide = ctx && (canAccessMultipleAgencies(ctx) || canViewAllDataInAgency(ctx));

  // Self can be an organization-level account with no home agency. Do not look
  // it up as a member of the selected agency or expand its linked accounts.
  if (requestedOwnerIds?.length === 1 && requestedOwnerIds[0] === userId) {
    return { agencyIds, ownerIds: [userId] };
  }
  if (agencyWide && requestedOwnerIds === undefined) return { agencyIds };

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      subCompanyId: { in: agencyIds },
      ...(requestedOwnerIds !== undefined ? { id: { in: requestedOwnerIds } } : {}),
      ...(!agencyWide
        ? { OR: [
          { id: userId },
          ...(ctx && canViewTeamData(ctx) ? [{ reportingManagerIds: { has: userId } }] : []),
        ] }
        : {}),
    },
    select: { id: true },
  });
  const ownerIds = users.map((user) => user.id);
  if (requestedOwnerIds === undefined || requestedOwnerIds.includes(userId)) ownerIds.push(userId);
  return { agencyIds, ownerIds: [...new Set(ownerIds)] };
}

export function buildEmailChipWhere(
  scope: EmailChipScope,
  folder: 'inbox' | 'sent' | 'drafts',
): Prisma.EmailWhereInput {
  const ownerField = folder === 'inbox' ? 'toUserId' : 'fromUserId';
  return {
    subCompanyId: { in: scope.agencyIds },
    folder,
    ...(scope.ownerIds !== undefined ? {
      OR: [
        { [ownerField]: { in: scope.ownerIds } },
        { forwardedToUserId: { in: scope.ownerIds } },
      ],
    } : {}),
  };
}
