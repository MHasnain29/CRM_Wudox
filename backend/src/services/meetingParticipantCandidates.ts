/**
 * Meeting participant candidates — restricted set:
 * 1) Operations managers assigned to the caller's allowed agencies
 * 2) Users with a multi-agency account link (UserAgencyLink)
 */
import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { resolveListAgencyScope } from '../config/agencyScope';
import { canAccessMultipleAgencies } from '../services/accessContext';
import { ensureAccessContext } from '../utils/requestPermission';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MeetingParticipantCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  userType: string | null;
  subCompanyId: string | null;
  subCompanyName: string | null;
};

function isUuid(id: string | undefined): id is string {
  return !!id && UUID_RE.test(id);
}

const candidateSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true,
  userType: true,
  subCompanyId: true,
  subCompany: { select: { name: true } },
} as const;

function mapCandidate(u: {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  userType: string | null;
  subCompanyId: string | null;
  subCompany: { name: string } | null;
}): MeetingParticipantCandidate {
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    role: u.role,
    userType: u.userType,
    subCompanyId: u.subCompanyId,
    subCompanyName: u.subCompany?.name ?? null,
  };
}

/**
 * Only ops managers (assigned to scope) + multi-agency linked users.
 */
export async function listMeetingParticipantCandidates(
  req: Request,
  opts: { subCompanyId?: string },
): Promise<{ data: MeetingParticipantCandidate[] } | { error: string; status: number }> {
  const requestedAgencyId = isUuid(opts.subCompanyId?.trim()) ? opts.subCompanyId!.trim() : undefined;

  const agencyScope = await resolveListAgencyScope(req, requestedAgencyId);
  if (!agencyScope || agencyScope.allowedIds.length === 0) {
    return { error: 'Agency context required', status: 403 };
  }

  const ctx = await ensureAccessContext(req);
  const multiAgency = ctx ? canAccessMultipleAgencies(ctx) : false;

  let agencyIds = agencyScope.allowedIds;
  if (requestedAgencyId) {
    if (!agencyScope.allowedIds.includes(requestedAgencyId)) {
      return { error: 'Agency not in your scope', status: 403 };
    }
    agencyIds = [requestedAgencyId];
  } else if (!multiAgency) {
    const home = req.user?.subCompanyId?.trim();
    agencyIds = isUuid(home) && agencyScope.allowedIds.includes(home)
      ? [home]
      : [agencyScope.primarySubCompanyId];
  }

  const actorId = req.user?.sub;
  const agencyIdFilter: Prisma.StringFilter | string =
    agencyIds.length === 1 ? agencyIds[0]! : { in: agencyIds };

  const [opsManagers, linkedUsers] = await Promise.all([
    prisma.user.findMany({
      where: {
        isActive: true,
        role: 'operations_manager',
        id: actorId ? { not: actorId } : undefined,
        managedSubCompanies: {
          some: {
            subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
          },
        },
      },
      select: candidateSelect,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    }),
    prisma.user.findMany({
      where: {
        isActive: true,
        id: actorId ? { not: actorId } : undefined,
        agencyLinks: { some: {} },
        // Linked accounts whose home agency is in scope (or any linked user when elevated all-agencies)
        ...(multiAgency && !requestedAgencyId
          ? {}
          : { subCompanyId: agencyIdFilter }),
      },
      select: candidateSelect,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 500,
    }),
  ]);

  const byId = new Map<string, MeetingParticipantCandidate>();
  for (const u of [...opsManagers, ...linkedUsers]) {
    byId.set(u.id, mapCandidate(u));
  }

  const data = [...byId.values()].sort((a, b) => {
    const nameA = `${a.lastName} ${a.firstName}`.trim();
    const nameB = `${b.lastName} ${b.firstName}`.trim();
    return nameA.localeCompare(nameB);
  });

  return { data };
}
