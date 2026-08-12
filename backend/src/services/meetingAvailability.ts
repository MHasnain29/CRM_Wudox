/**
 * Staff meeting availability for ops managers & multi-agency linked users.
 * Conflict search uses the union of the caller's allowed agencies and each
 * participant's agencies (OM managed agencies + link-group home agencies) so
 * busy status is checked across all agencies they operate in.
 */
import type { Request } from 'express';
import prisma from '../config/database';
import { resolveListAgencyScope } from '../config/agencyScope';

export type MeetingAvailabilityConflict = {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  subCompanyId: string;
  subCompanyName: string | null;
};

export type MeetingAvailabilityResult = {
  userId: string;
  /** CRM meeting overlap — used for hard conflict on create/update. */
  available: boolean;
  conflicts: MeetingAvailabilityConflict[];
  /** Soft Google FreeBusy signal (agency calendar). Absent when Google not checked. */
  googleChecked?: boolean;
  googleBusy?: boolean;
};

/** Agencies each participant can have meetings in (OM assignments + linked accounts). */
async function resolveParticipantAgencyIds(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      role: true,
      subCompanyId: true,
      managedSubCompanies: { select: { subCompanyId: true } },
      agencyLinks: { select: { groupId: true } },
    },
  });

  const agencyIds = new Set<string>();
  const linkGroupIds = new Set<string>();

  for (const u of users) {
    if (u.subCompanyId) agencyIds.add(u.subCompanyId);
    if (u.role === 'operations_manager') {
      for (const m of u.managedSubCompanies) agencyIds.add(m.subCompanyId);
    }
    for (const link of u.agencyLinks) linkGroupIds.add(link.groupId);
  }

  if (linkGroupIds.size > 0) {
    const peers = await prisma.userAgencyLink.findMany({
      where: { groupId: { in: [...linkGroupIds] } },
      include: { user: { select: { subCompanyId: true } } },
    });
    for (const p of peers) {
      if (p.user.subCompanyId) agencyIds.add(p.user.subCompanyId);
    }
  }

  return [...agencyIds];
}

/**
 * Check whether each userId is free in [startTime, endTime).
 * For ops managers / multi-agency linked users, scans meetings across all agencies
 * they are tied to (not only the caller's home agency).
 */
export async function checkStaffMeetingAvailability(
  req: Request,
  opts: {
    userIds: string[];
    startTime: Date;
    endTime: Date;
    excludeMeetingId?: string;
  },
): Promise<{ agencyIds: string[]; results: MeetingAvailabilityResult[] } | { error: string; status: number }> {
  const uniqueIds = [...new Set(opts.userIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return { agencyIds: [], results: [] };
  }
  if (opts.endTime <= opts.startTime) {
    return { error: 'End time must be after start time', status: 400 };
  }

  const agencyScope = await resolveListAgencyScope(req);
  if (!agencyScope || agencyScope.allowedIds.length === 0) {
    return { error: 'Agency context required', status: 403 };
  }

  const participantAgencyIds = await resolveParticipantAgencyIds(uniqueIds);
  // Caller scope ∪ participant multi-agency footprint → check busy across all relevant agencies
  const agencyIds = [...new Set([...agencyScope.allowedIds, ...participantAgencyIds])];

  if (agencyIds.length === 0) {
    return {
      agencyIds: [],
      results: uniqueIds.map((userId) => ({ userId, available: true, conflicts: [] })),
    };
  }

  const overlapping = await prisma.meeting.findMany({
    where: {
      subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
      status: { not: 'completed' },
      startTime: { lt: opts.endTime },
      endTime: { gt: opts.startTime },
      ...(opts.excludeMeetingId ? { id: { not: opts.excludeMeetingId } } : {}),
      OR: [
        { ownerId: { in: uniqueIds } },
        { attendees: { some: { userId: { in: uniqueIds } } } },
      ],
    },
    select: {
      id: true,
      title: true,
      startTime: true,
      endTime: true,
      ownerId: true,
      subCompanyId: true,
      subCompany: { select: { name: true } },
      attendees: { select: { userId: true } },
    },
    orderBy: { startTime: 'asc' },
    take: 500,
  });

  const byUser = new Map<string, MeetingAvailabilityConflict[]>();
  for (const id of uniqueIds) byUser.set(id, []);

  for (const m of overlapping) {
    const conflict: MeetingAvailabilityConflict = {
      id: m.id,
      title: m.title,
      startTime: m.startTime,
      endTime: m.endTime,
      subCompanyId: m.subCompanyId,
      subCompanyName: m.subCompany?.name ?? null,
    };
    const involved = new Set<string>();
    if (uniqueIds.includes(m.ownerId)) involved.add(m.ownerId);
    for (const a of m.attendees) {
      if (a.userId && uniqueIds.includes(a.userId)) involved.add(a.userId);
    }
    for (const uid of involved) {
      byUser.get(uid)!.push(conflict);
    }
  }

  const results: MeetingAvailabilityResult[] = uniqueIds.map((userId) => {
    const conflicts = byUser.get(userId) ?? [];
    return { userId, available: conflicts.length === 0, conflicts };
  });

  return { agencyIds, results };
}

/**
 * Hard conflict check for create/update: owner + staff attendees must be free.
 * Returns a human-readable error or null if ok.
 */
export async function assertNoMeetingConflicts(
  req: Request,
  opts: {
    ownerId: string;
    attendeeUserIds?: string[];
    startTime: Date;
    endTime: Date;
    excludeMeetingId?: string;
  },
): Promise<string | null> {
  const userIds = [...new Set([opts.ownerId, ...(opts.attendeeUserIds ?? [])])];
  const result = await checkStaffMeetingAvailability(req, {
    userIds,
    startTime: opts.startTime,
    endTime: opts.endTime,
    excludeMeetingId: opts.excludeMeetingId,
  });
  if ('error' in result) return result.error;

  const busy = result.results.filter((r) => !r.available);
  if (busy.length === 0) return null;

  const ownerBusy = busy.find((r) => r.userId === opts.ownerId);
  if (ownerBusy) {
    const c = ownerBusy.conflicts[0];
    const when = c
      ? `"${c.title}"${c.subCompanyName ? ` (${c.subCompanyName})` : ''}`
      : 'another meeting';
    return `You already have an overlapping meeting: ${when}`;
  }

  return `${busy.length} participant${busy.length === 1 ? ' is' : 's are'} busy at this time (checked across all their agencies)`;
}
