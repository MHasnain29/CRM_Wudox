/**
 * Booked Meetings API: manage meetings booked via public booking links.
 * Authenticated — host users can list and manage their booked meetings.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import type { Prisma, BookedMeetingStatus } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { attachAccessContext } from '../utils/requestPermission';
import { canViewAllDataInAgency } from '../services/accessContext';

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(200).default(50),
  status: z.enum(['scheduled', 'completed', 'cancelled']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

function canViewAll(req: Request): boolean {
  return !!req.access && canViewAllDataInAgency(req.access);
}

// ── Router ──

export const bookedMeetingsRouter = Router();
bookedMeetingsRouter.use(authenticate);
bookedMeetingsRouter.use(attachAccessContext);
bookedMeetingsRouter.use(requirePermission('meetings:read'));

/** GET /booked-meetings — list booked meetings for current user (or all for managers) */
bookedMeetingsRouter.get('/', async (req: Request, res: Response) => {
  const subCompanyId = req.user?.subCompanyId;
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const parsed = listQuerySchema.safeParse(req.query);
  const q = parsed.success ? parsed.data : { page: 1, limit: 50 };

  const where: Prisma.BookedMeetingWhereInput = {
    // Agency scope: only show booked meetings for hosts in this agency
    host: { user: { subCompanyId } },
  };

  // Scope: non-managers see only their own
  if (!canViewAll(req)) {
    where.hostUserId = req.user!.sub;
  }

  if (q.status) where.status = q.status as BookedMeetingStatus;

  if (q.from || q.to) {
    where.startTime = {};
    if (q.from) (where.startTime as any).gte = new Date(q.from);
    if (q.to) (where.startTime as any).lte = new Date(q.to);
  }

  const skip = (q.page - 1) * q.limit;

  const [meetings, total] = await Promise.all([
    prisma.bookedMeeting.findMany({
      where,
      skip,
      take: q.limit,
      orderBy: { startTime: 'asc' },
      include: {
        host: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    }),
    prisma.bookedMeeting.count({ where }),
  ]);

  const data = meetings.map((m) => ({
    id: m.id,
    hostUserId: m.hostUserId,
    hostName: m.host?.user ? `${m.host.user.firstName} ${m.host.user.lastName}`.trim() : null,
    guestName: m.guestName,
    guestEmail: m.guestEmail,
    guestCompany: m.guestCompany,
    startTime: m.startTime,
    endTime: m.endTime,
    meetingLink: m.meetingLink,
    notes: m.notes,
    status: m.status,
    createdAt: m.createdAt,
  }));

  return res.json({
    data,
    pagination: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
  });
});

/** GET /booked-meetings/:id — single booked meeting */
bookedMeetingsRouter.get('/:id', async (req: Request, res: Response) => {
  const meeting = await prisma.bookedMeeting.findUnique({
    where: { id: req.params.id },
    include: {
      host: {
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });
  if (!meeting) return res.status(404).json({ error: 'Booked meeting not found' });

  // Only host or managers can view
  if (!canViewAll(req) && meeting.hostUserId !== req.user!.sub) {
    return res.status(403).json({ error: 'You can only view your own booked meetings' });
  }

  return res.json({
    id: meeting.id,
    hostUserId: meeting.hostUserId,
    hostName: meeting.host?.user ? `${meeting.host.user.firstName} ${meeting.host.user.lastName}`.trim() : null,
    guestName: meeting.guestName,
    guestEmail: meeting.guestEmail,
    guestCompany: meeting.guestCompany,
    startTime: meeting.startTime,
    endTime: meeting.endTime,
    meetingLink: meeting.meetingLink,
    notes: meeting.notes,
    status: meeting.status,
    createdAt: meeting.createdAt,
  });
});

/** PATCH /booked-meetings/:id/cancel — cancel a booked meeting */
bookedMeetingsRouter.patch('/:id/cancel', requirePermission('meetings:write'), async (req: Request, res: Response) => {
  const meeting = await prisma.bookedMeeting.findUnique({ where: { id: req.params.id } });
  if (!meeting) return res.status(404).json({ error: 'Booked meeting not found' });

  if (!canViewAll(req) && meeting.hostUserId !== req.user!.sub) {
    return res.status(403).json({ error: 'You can only cancel your own booked meetings' });
  }

  if (meeting.status === 'cancelled') {
    return res.status(400).json({ error: 'Meeting is already cancelled' });
  }

  const updated = await prisma.bookedMeeting.update({
    where: { id: req.params.id },
    data: { status: 'cancelled' },
  });

  return res.json({
    id: updated.id,
    status: updated.status,
    message: 'Meeting cancelled successfully',
  });
});

/** PATCH /booked-meetings/:id/complete — mark a booked meeting as completed */
bookedMeetingsRouter.patch('/:id/complete', requirePermission('meetings:write'), async (req: Request, res: Response) => {
  const meeting = await prisma.bookedMeeting.findUnique({ where: { id: req.params.id } });
  if (!meeting) return res.status(404).json({ error: 'Booked meeting not found' });

  if (!canViewAll(req) && meeting.hostUserId !== req.user!.sub) {
    return res.status(403).json({ error: 'You can only update your own booked meetings' });
  }

  if (meeting.status !== 'scheduled') {
    return res.status(400).json({ error: `Cannot complete a meeting with status '${meeting.status}'` });
  }

  const updated = await prisma.bookedMeeting.update({
    where: { id: req.params.id },
    data: { status: 'completed' },
  });

  return res.json({
    id: updated.id,
    status: updated.status,
    message: 'Meeting marked as completed',
  });
});
