/**
 * Meetings API: CRUD for client meetings (agency-scoped, role-based).
 * Owner = the user who owns the meeting. Managers+ can see team meetings.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import type { Prisma } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { actAsMiddleware, effectiveActorId } from '../middleware/actAs';
import { requirePermission } from '../middleware/requirePermission';
import { requestHasPermission } from '../utils/requestPermission';
import { dispatchNotificationToUser } from '../services/notificationDispatch';
import { createActivityLog } from '../services/activityLog';
import { sendMeetingScheduledEmail, getAgencyBranding, resolveOutboundUserSender } from '../services/email';
import { isSenderDomainError } from '../services/senderDomainErrors';
import { emitToUsers } from '../socket';
import { resolveAgencyScope, resolveListAgencyScope } from '../config/agencyScope';
import { buildOwnerIdFilterForList, canAssignTasksToOthers } from '../services/listOwnerScope';
import { expandLinkedOwnerScope, linkedExpansionToWhere, ownerExactFromQuery } from '../services/linkedOwnerExpand';
import { checkStaffMeetingAvailability, assertNoMeetingConflicts } from '../services/meetingAvailability';
import { enrichAvailabilityWithGoogleFreeBusy } from '../services/meetingGoogleFreeBusy';
import { listMeetingParticipantCandidates } from '../services/meetingParticipantCandidates';
import {
  createCalendarEventWithMeet,
  updateCalendarEvent,
  deleteCalendarEvent,
  decryptToken,
} from '../services/googleCalendar';
import { tryDecryptToken } from '../utils/secretsCrypto';

async function resolveAllowedMeetingAgencyIds(req: Request): Promise<string[] | null> {
  const scope = await resolveListAgencyScope(req);
  return scope?.allowedIds ?? null;
}

/** Reject if caller tries to set staff participants without meetings:add_participants. */
async function assertCanAddMeetingParticipants(
  req: Request,
  attendeeUserIds: string[] | undefined,
): Promise<string | null> {
  if (!attendeeUserIds?.length) return null;
  if (await requestHasPermission(req, 'meetings:add_participants')) return null;
  return 'You do not have permission to add meeting participants';
}

function isOwnOwnerFilter(ownerFilter: string | { in: string[] } | { not: string }, userId: string): boolean {
  if (ownerFilter === userId) return true;
  if (typeof ownerFilter === 'object' && 'in' in ownerFilter) {
    return Array.isArray(ownerFilter.in) && ownerFilter.in.length === 1 && ownerFilter.in[0] === userId;
  }
  return false;
}

function attendeeUserIdsFromMeeting(meeting: { attendees?: { userId?: string | null }[] } | null | undefined): string[] {
  return (meeting?.attendees ?? [])
    .map((a) => a.userId)
    .filter((id): id is string => !!id);
}

function meetingRefreshUserIds(ownerId: string, attendeeUserIds: string[]): string[] {
  return [...new Set([ownerId, ...attendeeUserIds])];
}

// ── Schemas ──

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(500).default(50),
  ownerId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  scope: z.enum(['mine', 'team', 'all']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  agencyIds: z.string().optional(), // multi-select: comma-separated UUIDs
  ownerIds: z.string().optional(),  // multi-user filter: comma-separated UUIDs
});

const createBodySchema = z.object({
  clientId: z.string().uuid(),
  leadId: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(500),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  location: z.string().max(500).optional().nullable(),
  meetingLink: z.string().max(1000).optional().nullable(),
  agenda: z.string().max(10000).optional().nullable(),
  notes: z.string().max(10000).optional().nullable(),
  attendeeUserIds: z.array(z.string().uuid()).optional(),
  attendeeContactIds: z.array(z.string().uuid()).optional(),
  googleAutoMeetLink: z.boolean().optional(), // if true, auto-generate Meet link via Google Calendar API
});

const updateBodySchema = z.object({
  title: z.string().min(1).max(500).optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  location: z.string().max(500).optional().nullable(),
  meetingLink: z.string().max(1000).optional().nullable(),
  agenda: z.string().max(10000).optional().nullable(),
  notes: z.string().max(10000).optional().nullable(),
  attendeeUserIds: z.array(z.string().uuid()).optional(),
  attendeeContactIds: z.array(z.string().uuid()).optional(),
});

const checkAvailabilityBodySchema = z.object({
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  userIds: z.array(z.string().uuid()).min(1).max(50),
  excludeMeetingId: z.string().uuid().optional(),
  /** Agency whose Google Calendar connection is used for soft FreeBusy. */
  subCompanyId: z.string().uuid().optional(),
});

// ── Helpers ──

const MEETING_INCLUDE = {
  owner: { select: { id: true, firstName: true, lastName: true, email: true } },
  client: { select: { id: true, name: true } },
  lead: { select: { id: true, stage: true, status: true } },
  subCompany: { select: { id: true, name: true } },
  attendees: {
    include: {
      contact: { select: { id: true, name: true, email: true } },
    },
  },
  forwardedFromUser: { select: { firstName: true, lastName: true, subCompanyId: true } },
} satisfies Prisma.MeetingInclude;

async function loadAttendeeUsersById(
  attendees: { userId?: string | null }[],
): Promise<Map<string, { firstName: string; lastName: string; email: string }>> {
  const userIds = [...new Set(attendees.map((a) => a.userId).filter((id): id is string => !!id))];
  if (userIds.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  return new Map(users.map((u) => [u.id, u]));
}

async function formatMeeting(m: any) {
  const usersById = await loadAttendeeUsersById(m.attendees ?? []);
  return {
    id: m.id,
    clientId: m.clientId,
    clientName: m.client?.name ?? null,
    leadId: m.leadId,
    leadStage: m.lead?.stage ?? null,
    ownerId: m.ownerId,
    ownerName: m.owner ? `${m.owner.firstName} ${m.owner.lastName}`.trim() : null,
    title: m.title,
    startTime: m.startTime,
    endTime: m.endTime,
    location: m.location,
    meetingLink: m.meetingLink,
    agenda: m.agenda,
    notes: m.notes,
    status: m.status,
    subCompanyId: m.subCompanyId,
    subCompanyName: m.subCompany?.name ?? null,
    attendees: (m.attendees ?? []).map((a: any) => {
      const staff = a.userId ? usersById.get(a.userId) : undefined;
      const userName = staff ? `${staff.firstName} ${staff.lastName}`.trim() : null;
      return {
        id: a.id,
        userId: a.userId,
        contactId: a.contactId,
        contactName: a.contact?.name ?? null,
        contactEmail: a.contact?.email ?? null,
        userName,
        userEmail: staff?.email ?? null,
        displayName: a.contact?.name ?? userName ?? null,
        displayEmail: a.contact?.email ?? staff?.email ?? null,
      };
    }),
    forwardedFromName: m.forwardedFromUser
      ? `${m.forwardedFromUser.firstName ?? ''} ${m.forwardedFromUser.lastName ?? ''}`.trim() || null
      : null,
    forwardedFromSubCompanyId: m.forwardedFromUser?.subCompanyId ?? null,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

// ── Router ──

export const meetingsRouter = Router();
meetingsRouter.use(authenticate);
meetingsRouter.use(actAsMiddleware);
meetingsRouter.use(requirePermission('meetings:read'));

/** GET /meetings — list meetings. Elevated roles see across all agencies with optional agencyIds filter. */
meetingsRouter.get('/', async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  const q = parsed.success ? parsed.data : { page: 1, limit: 50 };

  const agencyScope = await resolveListAgencyScope(req, q.agencyIds);
  if (!agencyScope) return res.status(403).json({ error: 'Agency context required' });

  const { scopeFilter, primarySubCompanyId } = agencyScope;

  const where: Prisma.MeetingWhereInput = { ...scopeFilter };

  // Date range filter
  if (q.from || q.to) {
    where.startTime = {};
    if (q.from) (where.startTime as any).gte = new Date(q.from);
    if (q.to) (where.startTime as any).lte = new Date(q.to);
  }

  if (q.clientId) where.clientId = q.clientId;
  if (q.leadId) where.leadId = q.leadId;

  const userId = req.user!.sub;
  const ownerIdsList = q.ownerIds ? q.ownerIds.split(',').filter((id) => /^[0-9a-f-]{36}$/i.test(id)) : [];
  const linked = ownerIdsList.length > 0 ? await expandLinkedOwnerScope(userId, req.user!.subCompanyId, ownerIdsList, { exact: ownerExactFromQuery(req.query) }) : null;
  if (linked) {
    Object.assign(where, linkedExpansionToWhere(linked));
  } else {
    const ownerFilter = await buildOwnerIdFilterForList(req, {
      userId,
      primarySubCompanyId,
      scope: q.scope,
      explicitOwnerId: q.ownerId,
      ownerIdsList,
    });
    if (ownerFilter !== undefined) {
      // Own list: include meetings the user owns OR is invited to as a staff attendee.
      if (isOwnOwnerFilter(ownerFilter, userId)) {
        where.OR = [
          { ownerId: userId },
          { attendees: { some: { userId } } },
        ];
      } else {
        where.ownerId = ownerFilter;
      }
    }
  }

  const skip = (q.page - 1) * q.limit;

  const [meetings, total] = await Promise.all([
    prisma.meeting.findMany({
      where,
      skip,
      take: q.limit,
      orderBy: { startTime: 'asc' },
      include: MEETING_INCLUDE,
    }),
    prisma.meeting.count({ where }),
  ]);

  return res.json({
    data: await Promise.all(meetings.map((m) => formatMeeting(m))),
    pagination: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
  });
});

/**
 * POST /meetings/check-availability — soft conflict check for staff participants.
 * Scope: caller's full allowed agencies (Director / global → all agencies they can access).
 * Soft Google FreeBusy is layered when the agency Google Calendar is connected.
 */
meetingsRouter.post('/check-availability', requirePermission('meetings:write'), async (req: Request, res: Response) => {
  const parsed = checkAvailabilityBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }
  const data = parsed.data;

  const result = await checkStaffMeetingAvailability(req, {
    userIds: data.userIds,
    startTime: new Date(data.startTime),
    endTime: new Date(data.endTime),
    excludeMeetingId: data.excludeMeetingId,
  });

  if ('error' in result) {
    return res.status(result.status).json({ error: result.error });
  }

  let googleAgencyId = data.subCompanyId ?? null;
  if (googleAgencyId) {
    const allowed = await resolveAllowedMeetingAgencyIds(req);
    if (!allowed?.includes(googleAgencyId)) googleAgencyId = null;
  }
  if (!googleAgencyId && result.agencyIds.length === 1) {
    googleAgencyId = result.agencyIds[0];
  }

  const enriched = await enrichAvailabilityWithGoogleFreeBusy({
    subCompanyId: googleAgencyId,
    userIds: data.userIds,
    startTime: new Date(data.startTime),
    endTime: new Date(data.endTime),
    results: result.results,
  });

  return res.json({
    agencyCount: result.agencyIds.length,
    googleChecked: enriched.googleChecked,
    results: enriched.results.map((r) => ({
      userId: r.userId,
      available: r.available,
      googleChecked: r.googleChecked ?? false,
      googleBusy: r.googleBusy ?? false,
      conflicts: r.conflicts.map((c) => ({
        id: c.id,
        title: c.title,
        startTime: c.startTime.toISOString(),
        endTime: c.endTime.toISOString(),
        subCompanyId: c.subCompanyId,
        subCompanyName: c.subCompanyName,
      })),
    })),
  });
});

/**
 * GET /meetings/participant-candidates — staff you can invite (no users:read required).
 * Director / global: all agencies they can access (optional ?subCompanyId= to narrow).
 */
meetingsRouter.get(
  '/participant-candidates',
  requirePermission('meetings:add_participants', 'meetings:write'),
  async (req: Request, res: Response) => {
    const subCompanyId =
      typeof req.query.subCompanyId === 'string' && req.query.subCompanyId.trim()
        ? req.query.subCompanyId.trim()
        : undefined;

    const result = await listMeetingParticipantCandidates(req, { subCompanyId });
    if ('error' in result) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.json({ data: result.data });
  },
);

/** GET /meetings/:id — single meeting */
meetingsRouter.get('/:id', async (req: Request, res: Response) => {
  const allowedSubCompanyIds = await resolveAllowedMeetingAgencyIds(req);
  if (!allowedSubCompanyIds) return res.status(403).json({ error: 'Agency context required' });

  const meeting = await prisma.meeting.findFirst({
    where: { id: req.params.id, subCompanyId: { in: allowedSubCompanyIds } },
    include: MEETING_INCLUDE,
  });
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

  const actorId = effectiveActorId(req);
  const isAttendee = (meeting.attendees ?? []).some((a) => a.userId === actorId);
  // Non-managers can view own meetings or meetings they are invited to
  if (!(await canAssignTasksToOthers(req)) && meeting.ownerId !== actorId && !isAttendee) {
    return res.status(403).json({ error: 'You can only view your own meetings' });
  }

  return res.json(await formatMeeting(meeting));
});

/** POST /meetings — create meeting */
meetingsRouter.post('/', requirePermission('meetings:write'), async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const parsed = createBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }
  const data = parsed.data;

  const participantsDenied = await assertCanAddMeetingParticipants(req, data.attendeeUserIds);
  if (participantsDenied) return res.status(403).json({ error: participantsDenied });

  // Validate time range
  if (new Date(data.endTime) <= new Date(data.startTime)) {
    return res.status(400).json({ error: 'End time must be after start time' });
  }

  const ownerId = effectiveActorId(req);
  const conflictError = await assertNoMeetingConflicts(req, {
    ownerId,
    attendeeUserIds: data.attendeeUserIds,
    startTime: new Date(data.startTime),
    endTime: new Date(data.endTime),
  });
  if (conflictError) {
    return res.status(409).json({ error: conflictError });
  }

  // Validate client exists
  const client = await prisma.client.findUnique({ where: { id: data.clientId } });
  if (!client) return res.status(400).json({ error: 'Client not found' });

  // Validate lead if provided
  if (data.leadId) {
    const lead = await prisma.lead.findFirst({ where: { id: data.leadId, subCompanyId } });
    if (!lead) return res.status(400).json({ error: 'Lead not found in your agency' });
  }

  // Resolve CRM invite From before create (fail closed for Super User domain errors).
  let inviteFrom;
  let inviteAgency;
  try {
    ({ from: inviteFrom, agency: inviteAgency } = await resolveOutboundUserSender({
      userId: ownerId,
      subCompanyId,
      applyOmAgencyEmail: false,
    }));
  } catch (err) {
    if (isSenderDomainError(err)) {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    throw err;
  }

  const meeting = await prisma.$transaction(async (tx) => {
    const m = await tx.meeting.create({
      data: {
        clientId: data.clientId,
        leadId: data.leadId ?? null,
        ownerId,
        title: data.title.trim(),
        startTime: new Date(data.startTime),
        endTime: new Date(data.endTime),
        location: data.location?.trim() ?? null,
        meetingLink: data.meetingLink?.trim() ?? null,
        agenda: data.agenda?.trim() ?? null,
        notes: data.notes?.trim() ?? null,
        subCompanyId,
      },
    });

    // Create attendees
    const attendees: { meetingId: string; userId?: string; contactId?: string }[] = [];
    if (data.attendeeUserIds?.length) {
      for (const uid of data.attendeeUserIds) {
        attendees.push({ meetingId: m.id, userId: uid });
      }
    }
    if (data.attendeeContactIds?.length) {
      for (const cid of data.attendeeContactIds) {
        attendees.push({ meetingId: m.id, contactId: cid });
      }
    }
    if (attendees.length > 0) {
      await tx.meetingAttendee.createMany({ data: attendees });
    }

    return tx.meeting.findUnique({
      where: { id: m.id },
      include: MEETING_INCLUDE,
    });
  });

  if (!meeting) return res.status(500).json({ error: 'Failed to create meeting' });

  // ── Google Calendar sync (awaited so Meet link is in the response + email) ──
  let finalMeetingLink: string | null = data.meetingLink?.trim() ?? null;
  try {
    const agency = await prisma.subCompany.findUnique({
      where: { id: subCompanyId },
      select: { googleRefreshToken: true, googleCalendarConnected: true },
    });

    if (agency?.googleCalendarConnected && agency.googleRefreshToken && data.googleAutoMeetLink !== false) {
      const rawToken = decryptToken(agency.googleRefreshToken);
      const contactEmails: string[] = [];

      // Always add meeting owner's email so event appears in their calendar too
      const owner = await prisma.user.findUnique({
        where: { id: meeting.ownerId },
        select: { email: true },
      });
      if (owner?.email) contactEmails.push(owner.email);

      if (data.attendeeContactIds?.length) {
        const contacts = await prisma.clientContact.findMany({
          where: { id: { in: data.attendeeContactIds } },
          select: { email: true },
        });
        contacts.forEach((c) => { if (c.email) contactEmails.push(c.email); });
      }

      if (data.attendeeUserIds?.length) {
        const staffUsers = await prisma.user.findMany({
          where: { id: { in: data.attendeeUserIds } },
          select: { email: true },
        });
        staffUsers.forEach((u) => { if (u.email) contactEmails.push(u.email); });
      }

      const gcResult = await createCalendarEventWithMeet({
        refreshToken: rawToken,
        title: meeting.title,
        startTime: new Date(data.startTime),
        endTime: new Date(data.endTime),
        description: data.agenda ?? undefined,
        location: data.location ?? undefined,
        attendeeEmails: [...new Set(contactEmails)],
      });

      if (gcResult.ok) {
        finalMeetingLink = gcResult.meetLink;
        await prisma.meeting.update({
          where: { id: meeting.id },
          data: { meetingLink: gcResult.meetLink, googleCalendarEventId: gcResult.googleEventId },
        });
        (meeting as any).meetingLink = gcResult.meetLink;
      } else if (gcResult.revoked) {
        // Token was revoked — reset agency connection so director is prompted to reconnect
        await prisma.subCompany.update({
          where: { id: subCompanyId },
          data: { googleCalendarConnected: false, googleRefreshToken: null, googleConnectedEmail: null },
        });
        console.warn('[meetings] Google token revoked — agency connection reset');
      }
    }
  } catch (err) {
    console.error('[meetings] Google Calendar sync failed:', err);
  }

  // Activity log (fire-and-forget)
  const actor = await prisma.user.findUnique({
    where: { id: effectiveActorId(req) },
    select: { firstName: true, lastName: true },
  });
  const actorName = actor ? `${actor.firstName} ${actor.lastName}`.trim() : 'User';

  void createActivityLog({
    userId: effectiveActorId(req),
    userName: actorName,
    subCompanyId,
    type: 'meeting_created',
    description: `Scheduled meeting '${meeting.title}' with ${client.name}`,
    metadata: { meetingId: meeting.id, clientId: data.clientId, clientName: client.name },
  });

  // Notify attendee users
  if (data.attendeeUserIds?.length) {
    const notifyIds = data.attendeeUserIds.filter((id) => id !== req.user!.sub);
    const start = new Date(data.startTime);
    const dueDate = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const dueTime = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    for (const uid of notifyIds) {
      dispatchNotificationToUser({
        userId: uid,
        subCompanyId,
        eventKey: 'meeting_scheduled',
        context: { meetingTitle: meeting.title, dueDate, dueTime },
        link: '/meetings',
        relatedId: meeting.id,
      }).catch(() => {});
    }
  }

  const staffAttendeeIds = data.attendeeUserIds ?? [];
  emitToUsers(meetingRefreshUserIds(meeting.ownerId, staffAttendeeIds), 'meeting:refresh', { subCompanyId });

  // Send meeting email to owner + staff invitees + client contacts (fire-and-forget)
  void (async () => {
    try {
      const agency = inviteAgency ?? (await getAgencyBranding(subCompanyId));
      const start = new Date(data.startTime);
      const end = new Date(data.endTime);
      const dateOpts: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
      const startStr = `${start.toLocaleDateString('en-US', dateOpts)} at ${start.toLocaleTimeString('en-US', timeOpts)}`;
      const endStr = end.toLocaleTimeString('en-US', timeOpts);

      const emailPayloadBase = {
        meetingTitle: meeting.title,
        clientName: client.name,
        scheduledBy: actorName,
        startTime: startStr,
        endTime: endStr,
        startDate: start,
        endDate: end,
        meetingId: meeting.id,
        location: data.location,
        meetingLink: finalMeetingLink,
        agenda: data.agenda,
        agency,
      };

      const ownerUser = await prisma.user.findUnique({
        where: { id: meeting.ownerId },
        select: { email: true, firstName: true, lastName: true },
      });

      const emailed = new Set<string>();

      const sendOne = (email: string | null | undefined, name: string) => {
        const to = email?.trim().toLowerCase();
        if (!to || emailed.has(to)) return;
        emailed.add(to);
        void sendMeetingScheduledEmail({
          ...emailPayloadBase,
          contactEmail: email!.trim(),
          contactName: name,
          from: inviteFrom,
          fromUserId: meeting.ownerId,
          subCompanyId,
        });
      };

      if (ownerUser?.email) {
        sendOne(ownerUser.email, `${ownerUser.firstName} ${ownerUser.lastName}`.trim());
      }

      // All staff participants
      if (staffAttendeeIds.length) {
        const staffUsers = await prisma.user.findMany({
          where: { id: { in: staffAttendeeIds } },
          select: { id: true, email: true, firstName: true, lastName: true },
        });
        for (const staff of staffUsers) {
          sendOne(staff.email, `${staff.firstName} ${staff.lastName}`.trim());
        }
      }

      // Client contact(s): selected attendees, else primary contact on the client
      let contactIds = data.attendeeContactIds?.filter(Boolean) ?? [];
      if (contactIds.length === 0) {
        const primary = await prisma.clientContact.findFirst({
          where: { clientId: data.clientId, isPrimary: true },
          select: { id: true },
        });
        if (primary) contactIds = [primary.id];
        else {
          const anyContact = await prisma.clientContact.findFirst({
            where: { clientId: data.clientId, email: { not: null } },
            select: { id: true },
            orderBy: { name: 'asc' },
          });
          if (anyContact) contactIds = [anyContact.id];
        }
      }

      if (contactIds.length) {
        const contacts = await prisma.clientContact.findMany({
          where: { id: { in: contactIds } },
          select: { email: true, name: true },
        });
        for (const contact of contacts) {
          sendOne(contact.email, contact.name);
        }
      }

      console.log('[meeting] emails queued:', {
        meetingId: meeting.id,
        recipients: emailed.size,
        staffAttendeeCount: staffAttendeeIds.length,
        contactCount: contactIds.length,
        from: inviteFrom.email,
      });
    } catch (err) {
      console.error('[meetings] Failed to send meeting email:', err);
    }
  })();

  return res.status(201).json(await formatMeeting(meeting));
});

/** PATCH /meetings/:id — update meeting */
meetingsRouter.patch('/:id', requirePermission('meetings:write'), async (req: Request, res: Response) => {
  const allowedSubCompanyIds = await resolveAllowedMeetingAgencyIds(req);
  if (!allowedSubCompanyIds) return res.status(403).json({ error: 'Agency context required' });

  const existing = await prisma.meeting.findFirst({
    where: { id: req.params.id, subCompanyId: { in: allowedSubCompanyIds } },
  });
  if (!existing) return res.status(404).json({ error: 'Meeting not found' });
  const subCompanyId = existing.subCompanyId;

  // Only owner or managers can update
  if (!(await canAssignTasksToOthers(req)) && existing.ownerId !== effectiveActorId(req)) {
    return res.status(403).json({ error: 'You can only update your own meetings' });
  }

  const parsed = updateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }
  const data = parsed.data;

  const participantsDenied = await assertCanAddMeetingParticipants(req, data.attendeeUserIds);
  if (participantsDenied) return res.status(403).json({ error: participantsDenied });

  // Validate time range if both provided
  const newStart = data.startTime ? new Date(data.startTime) : existing.startTime;
  const newEnd = data.endTime ? new Date(data.endTime) : existing.endTime;
  if (newEnd <= newStart) {
    return res.status(400).json({ error: 'End time must be after start time' });
  }

  const timeOrAttendeesChanged =
    data.startTime !== undefined ||
    data.endTime !== undefined ||
    data.attendeeUserIds !== undefined;
  if (timeOrAttendeesChanged) {
    let attendeeUserIds = data.attendeeUserIds;
    if (attendeeUserIds === undefined) {
      const existingStaff = await prisma.meetingAttendee.findMany({
        where: { meetingId: req.params.id, userId: { not: null } },
        select: { userId: true },
      });
      attendeeUserIds = existingStaff.map((a) => a.userId!).filter(Boolean);
    }
    const conflictError = await assertNoMeetingConflicts(req, {
      ownerId: existing.ownerId,
      attendeeUserIds,
      startTime: newStart,
      endTime: newEnd,
      excludeMeetingId: req.params.id,
    });
    if (conflictError) {
      return res.status(409).json({ error: conflictError });
    }
  }

  const previousStaffIds = data.attendeeUserIds !== undefined
    ? (
        await prisma.meetingAttendee.findMany({
          where: { meetingId: req.params.id, userId: { not: null } },
          select: { userId: true },
        })
      ).map((a) => a.userId!).filter(Boolean)
    : [];

  const previousContactIds =
    data.attendeeUserIds !== undefined || data.attendeeContactIds !== undefined
      ? (
          await prisma.meetingAttendee.findMany({
            where: { meetingId: req.params.id, contactId: { not: null } },
            select: { contactId: true },
          })
        ).map((a) => a.contactId!).filter(Boolean)
      : [];

  const timeChanged =
    (data.startTime !== undefined && new Date(data.startTime).getTime() !== existing.startTime.getTime()) ||
    (data.endTime !== undefined && new Date(data.endTime).getTime() !== existing.endTime.getTime());

  const willReEmail =
    timeChanged ||
    data.attendeeUserIds !== undefined ||
    data.attendeeContactIds !== undefined;

  let inviteFrom;
  let inviteAgency;
  if (willReEmail) {
    try {
      ({ from: inviteFrom, agency: inviteAgency } = await resolveOutboundUserSender({
        userId: existing.ownerId,
        subCompanyId,
        applyOmAgencyEmail: false,
      }));
    } catch (err) {
      if (isSenderDomainError(err)) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      throw err;
    }
  }

  const meeting = await prisma.$transaction(async (tx) => {
    const update: Prisma.MeetingUpdateInput = {};
    if (data.title !== undefined) update.title = data.title.trim();
    if (data.startTime !== undefined) update.startTime = new Date(data.startTime);
    if (data.endTime !== undefined) update.endTime = new Date(data.endTime);
    if (data.location !== undefined) update.location = data.location?.trim() ?? null;
    if (data.meetingLink !== undefined) update.meetingLink = data.meetingLink?.trim() ?? null;
    if (data.agenda !== undefined) update.agenda = data.agenda?.trim() ?? null;
    if (data.notes !== undefined) update.notes = data.notes?.trim() ?? null;

    await tx.meeting.update({ where: { id: req.params.id }, data: update });

    // Replace attendees if provided — preserve contacts when only staff ids are patched
    if (data.attendeeUserIds !== undefined || data.attendeeContactIds !== undefined) {
      const nextStaffIds =
        data.attendeeUserIds !== undefined
          ? data.attendeeUserIds
          : (
              await tx.meetingAttendee.findMany({
                where: { meetingId: req.params.id, userId: { not: null } },
                select: { userId: true },
              })
            ).map((a) => a.userId!).filter(Boolean);
      const nextContactIds =
        data.attendeeContactIds !== undefined ? data.attendeeContactIds : previousContactIds;

      await tx.meetingAttendee.deleteMany({ where: { meetingId: req.params.id } });
      const attendees: { meetingId: string; userId?: string; contactId?: string }[] = [];
      for (const uid of nextStaffIds) {
        attendees.push({ meetingId: req.params.id, userId: uid });
      }
      for (const cid of nextContactIds) {
        attendees.push({ meetingId: req.params.id, contactId: cid });
      }
      if (attendees.length > 0) {
        await tx.meetingAttendee.createMany({ data: attendees });
      }
    }

    return tx.meeting.findUnique({
      where: { id: req.params.id },
      include: MEETING_INCLUDE,
    });
  });

  if (!meeting) return res.status(500).json({ error: 'Failed to update meeting' });

  const staffAttendeeIds = attendeeUserIdsFromMeeting(meeting);
  const newlyAddedStaff = data.attendeeUserIds !== undefined
    ? staffAttendeeIds.filter((id) => !previousStaffIds.includes(id) && id !== req.user!.sub)
    : [];
  const participantsChanged =
    data.attendeeUserIds !== undefined || data.attendeeContactIds !== undefined;

  if (newlyAddedStaff.length && !timeChanged) {
    const start = meeting.startTime;
    const dueDate = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const dueTime = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    for (const uid of newlyAddedStaff) {
      dispatchNotificationToUser({
        userId: uid,
        subCompanyId,
        eventKey: 'meeting_scheduled',
        context: { meetingTitle: meeting.title, dueDate, dueTime },
        link: '/meetings',
        relatedId: meeting.id,
      }).catch(() => {});
    }
  }

  // Re-email owner + all staff + client contact(s) when time or participants change
  if (timeChanged || participantsChanged) {
    void (async () => {
      try {
        const agency = inviteAgency ?? (await getAgencyBranding(subCompanyId));
        const clientRow = await prisma.client.findUnique({ where: { id: meeting.clientId }, select: { name: true } });
        const ownerUser = await prisma.user.findUnique({
          where: { id: meeting.ownerId },
          select: { email: true, firstName: true, lastName: true },
        });
        const start = meeting.startTime;
        const end = meeting.endTime;
        const dateOpts: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
        const emailPayloadBase = {
          meetingTitle: meeting.title,
          clientName: clientRow?.name ?? 'Client',
          scheduledBy: ownerUser ? `${ownerUser.firstName} ${ownerUser.lastName}`.trim() : 'User',
          startTime: `${start.toLocaleDateString('en-US', dateOpts)} at ${start.toLocaleTimeString('en-US', timeOpts)}`,
          endTime: end.toLocaleTimeString('en-US', timeOpts),
          startDate: start,
          endDate: end,
          meetingId: meeting.id,
          location: meeting.location,
          meetingLink: meeting.meetingLink,
          agenda: meeting.agenda,
          agency,
          isUpdate: true as const,
        };

        const emailed = new Set<string>();
        const sendOne = (email: string | null | undefined, name: string) => {
          const to = email?.trim().toLowerCase();
          if (!to || emailed.has(to)) return;
          emailed.add(to);
          void sendMeetingScheduledEmail({
            ...emailPayloadBase,
            contactEmail: email!.trim(),
            contactName: name,
            from: inviteFrom!,
            fromUserId: meeting.ownerId,
            subCompanyId,
          });
        };

        if (ownerUser?.email) {
          sendOne(ownerUser.email, `${ownerUser.firstName} ${ownerUser.lastName}`.trim());
        }

        if (staffAttendeeIds.length) {
          const staffUsers = await prisma.user.findMany({
            where: { id: { in: staffAttendeeIds } },
            select: { email: true, firstName: true, lastName: true },
          });
          for (const staff of staffUsers) {
            sendOne(staff.email, `${staff.firstName} ${staff.lastName}`.trim());
          }
        }

        let contactIds = meeting.attendees.map((a) => a.contactId).filter(Boolean) as string[];
        if (contactIds.length === 0) {
          const primary = await prisma.clientContact.findFirst({
            where: { clientId: meeting.clientId, isPrimary: true },
            select: { id: true },
          });
          if (primary) contactIds = [primary.id];
          else {
            const anyContact = await prisma.clientContact.findFirst({
              where: { clientId: meeting.clientId, email: { not: null } },
              select: { id: true },
              orderBy: { name: 'asc' },
            });
            if (anyContact) contactIds = [anyContact.id];
          }
        }
        if (contactIds.length) {
          const contacts = await prisma.clientContact.findMany({
            where: { id: { in: contactIds } },
            select: { email: true, name: true },
          });
          for (const contact of contacts) {
            sendOne(contact.email, contact.name);
          }
        }

        console.log('[meeting] update emails queued:', {
          meetingId: meeting.id,
          recipients: emailed.size,
          reason: timeChanged ? 'time_changed' : 'participants_changed',
        });
      } catch (err) {
        console.error('[meetings] Failed to re-email on meeting update:', err);
      }
    })();
  }

  // ── Google Calendar sync: update event if linked (incl. guest list) ──
  void (async () => {
    try {
      const existingWithGcal = await prisma.meeting.findUnique({
        where: { id: req.params.id },
        select: { googleCalendarEventId: true },
      });
      const agency = existingWithGcal ? await prisma.subCompany.findUnique({
        where: { id: subCompanyId },
        select: { googleRefreshToken: true, googleCalendarConnected: true },
      }) : null;
      if (
        existingWithGcal?.googleCalendarEventId &&
        agency?.googleCalendarConnected &&
        agency.googleRefreshToken
      ) {
        let attendeeEmails: string[] | undefined;
        if (data.attendeeUserIds !== undefined || data.attendeeContactIds !== undefined || timeChanged) {
          const emails = new Set<string>();
          if (staffAttendeeIds.length) {
            const staffUsers = await prisma.user.findMany({
              where: { id: { in: staffAttendeeIds } },
              select: { email: true },
            });
            for (const s of staffUsers) {
              if (s.email?.trim()) emails.add(s.email.trim().toLowerCase());
            }
          }
          const contactIds = meeting.attendees.map((a) => a.contactId).filter(Boolean) as string[];
          if (contactIds.length) {
            const contacts = await prisma.clientContact.findMany({
              where: { id: { in: contactIds } },
              select: { email: true },
            });
            for (const c of contacts) {
              if (c.email?.trim()) emails.add(c.email.trim().toLowerCase());
            }
          }
          attendeeEmails = [...emails];
        }

        await updateCalendarEvent({
          refreshToken: decryptToken(agency.googleRefreshToken),
          googleEventId: existingWithGcal.googleCalendarEventId,
          title: data.title,
          startTime: data.startTime ? new Date(data.startTime) : undefined,
          endTime: data.endTime ? new Date(data.endTime) : undefined,
          description: data.agenda ?? undefined,
          location: data.location ?? undefined,
          attendeeEmails,
        });
      }
    } catch (err) {
      console.error('[meetings] Google Calendar update failed:', err);
    }
  })();

  emitToUsers(
    meetingRefreshUserIds(meeting.ownerId, [...staffAttendeeIds, ...previousStaffIds]),
    'meeting:refresh',
    { subCompanyId },
  );

  return res.json(await formatMeeting(meeting));
});

/** PATCH /meetings/:id/complete — mark a client meeting as completed */
meetingsRouter.patch('/:id/complete', requirePermission('meetings:write'), async (req: Request, res: Response) => {
  const allowedSubCompanyIds = await resolveAllowedMeetingAgencyIds(req);
  if (!allowedSubCompanyIds) return res.status(403).json({ error: 'Agency context required' });

  const meeting = await prisma.meeting.findFirst({
    where: { id: req.params.id, subCompanyId: { in: allowedSubCompanyIds } },
  });
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  const subCompanyId = meeting.subCompanyId;

  if (!(await canAssignTasksToOthers(req)) && meeting.ownerId !== effectiveActorId(req)) {
    return res.status(403).json({ error: 'You can only update your own meetings' });
  }

  if (meeting.status === 'completed') {
    return res.status(400).json({ error: 'Meeting is already completed' });
  }

  const updated = await prisma.meeting.update({
    where: { id: req.params.id },
    data: { status: 'completed' },
    include: MEETING_INCLUDE,
  });

  emitToUsers(
    meetingRefreshUserIds(updated.ownerId, attendeeUserIdsFromMeeting(updated)),
    'meeting:refresh',
    { subCompanyId },
  );

  return res.json(await formatMeeting(updated));
});

/** DELETE /meetings/:id */
meetingsRouter.delete('/:id', requirePermission('meetings:write'), async (req: Request, res: Response) => {
  const allowedSubCompanyIds = await resolveAllowedMeetingAgencyIds(req);
  if (!allowedSubCompanyIds) return res.status(403).json({ error: 'Agency context required' });

  const meeting = await prisma.meeting.findFirst({
    where: { id: req.params.id, subCompanyId: { in: allowedSubCompanyIds } },
    include: { attendees: { select: { userId: true } } },
  });
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  const subCompanyId = meeting.subCompanyId;
  const staffAttendeeIds = attendeeUserIdsFromMeeting(meeting);

  // Only owner or managers can delete
  if (!(await canAssignTasksToOthers(req)) && meeting.ownerId !== effectiveActorId(req)) {
    return res.status(403).json({ error: 'You can only delete your own meetings' });
  }

  // Fetch Google Calendar data before deleting
  const meetingWithGcal = await prisma.meeting.findUnique({
    where: { id: req.params.id },
    select: { googleCalendarEventId: true },
  });
  const agencyGcal = meetingWithGcal ? await prisma.subCompany.findUnique({
    where: { id: subCompanyId },
    select: { googleRefreshToken: true, googleCalendarConnected: true },
  }) : null;

  await prisma.meeting.delete({ where: { id: req.params.id } });

  // ── Google Calendar sync: delete event if linked (fire-and-forget) ──
  if (
    meetingWithGcal?.googleCalendarEventId &&
    agencyGcal?.googleCalendarConnected &&
    agencyGcal.googleRefreshToken
  ) {
    // tryDecryptToken: decryptToken throws synchronously, before .catch() could apply
    const gcalDeleteToken = tryDecryptToken(agencyGcal.googleRefreshToken);
    if (gcalDeleteToken) {
      void deleteCalendarEvent({
        refreshToken: gcalDeleteToken,
        googleEventId: meetingWithGcal.googleCalendarEventId,
      }).catch((err) => console.error('[meetings] Google Calendar delete failed:', err));
    }
  }

  emitToUsers(meetingRefreshUserIds(meeting.ownerId, staffAttendeeIds), 'meeting:refresh', { subCompanyId });

  return res.status(204).send();
});
