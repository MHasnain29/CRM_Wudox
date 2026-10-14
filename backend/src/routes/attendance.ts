/**
 * Attendance API — daily check-in / check-out + history.
 * All logged-in users can check in/out and view their own history.
 * attendance:view_all → view all employees + export.
 */
import { Router, Request, Response } from 'express';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { actAsMiddleware } from '../middleware/actAs';
import { resolveAgencyScope, resolveAllowedSubCompanyIds } from '../config/agencyScope';
import { ensureAccessContext } from '../utils/requestPermission';
import { hasPermission } from '../services/accessContext';
import {
  ATTENDANCE_MAX_ROWS,
  attendanceDateWhere,
  attendanceOwnerIds,
  parseAttendanceQuery,
} from '../services/attendanceDateFilter';

export const attendanceRouter = Router();
attendanceRouter.use(authenticate);
attendanceRouter.use(actAsMiddleware);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── GET /attendance/status ─────────────────────────────────────────────────
// Returns today's attendance record for the current user (or null if not checked in).
attendanceRouter.get('/status', async (req: Request, res: Response) => {
  const userId = req.user!.sub;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    const record = await prisma.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    res.json({ data: record });
  } catch (err) {
    console.error('[attendance] status error', err);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// ── POST /attendance/checkin ───────────────────────────────────────────────
attendanceRouter.post('/checkin', async (req: Request, res: Response) => {
  const userId = req.user!.sub;
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) {
    res.status(400).json({ error: 'No agency context' });
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    const existing = await prisma.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    if (existing) {
      res.status(409).json({ error: 'Already checked in today', data: existing });
      return;
    }

    const record = await prisma.attendance.create({
      data: {
        userId,
        subCompanyId,
        date: today,
        checkInAt: new Date(),
      },
    });
    res.status(201).json({ data: record });
  } catch (err) {
    console.error('[attendance] checkin error', err);
    res.status(500).json({ error: 'Check-in failed' });
  }
});

// ── POST /attendance/checkout ──────────────────────────────────────────────
attendanceRouter.post('/checkout', async (req: Request, res: Response) => {
  const userId = req.user!.sub;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    const existing = await prisma.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    if (!existing) {
      res.status(404).json({ error: 'No check-in found for today' });
      return;
    }
    if (existing.checkOutAt) {
      res.status(409).json({ error: 'Already checked out today', data: existing });
      return;
    }

    const checkOutAt = new Date();
    const totalMinutes = Math.round(
      (checkOutAt.getTime() - existing.checkInAt.getTime()) / 60000,
    );

    const record = await prisma.attendance.update({
      where: { id: existing.id },
      data: { checkOutAt, totalMinutes },
    });
    res.json({ data: record });
  } catch (err) {
    console.error('[attendance] checkout error', err);
    res.status(500).json({ error: 'Check-out failed' });
  }
});

// ── GET /attendance/me ─────────────────────────────────────────────────────
// Own history — ?from=yyyy-MM-dd&to=yyyy-MM-dd (inclusive), or the legacy ?month=YYYY-MM; defaults to current month.
attendanceRouter.get('/me', async (req: Request, res: Response) => {
  const userId = req.user!.sub;

  const query = parseAttendanceQuery(req.query);
  if (!query.success) {
    res.status(400).json({ error: 'Invalid query', details: query.error.flatten() });
    return;
  }

  try {
    const records = await prisma.attendance.findMany({
      where: { userId, date: attendanceDateWhere(query.data) },
      orderBy: { date: 'desc' },
      take: ATTENDANCE_MAX_ROWS + 1,
    });
    const truncated = records.length > ATTENDANCE_MAX_ROWS;
    res.json({ data: truncated ? records.slice(0, ATTENDANCE_MAX_ROWS) : records, truncated });
  } catch (err) {
    console.error('[attendance] me error', err);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

// ── GET /attendance ────────────────────────────────────────────────────────
// All employees (attendance:view_all only). Supports ?from=yyyy-MM-dd&to=yyyy-MM-dd (inclusive; legacy
// ?month=YYYY-MM; default current month), ?ownerIds=<uuid>,<uuid> (the page's scope chips) and ?subCompanyId=.
attendanceRouter.get('/', async (req: Request, res: Response) => {
  try {
    // Authentication captures the real caller's authority before act-as mutates req.user.
    if (req.user?.actAsUserId && !req.access) {
      res.status(403).json({ error: 'Act-as context unavailable' });
      return;
    }
    const ctx = await ensureAccessContext(req);
    if (!ctx || ctx.userId !== req.user?.sub) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!hasPermission(ctx, 'attendance:view_all')) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const actAsHeader = req.headers['x-act-as-user-id'];
    if (actAsHeader !== undefined && typeof actAsHeader !== 'string') {
      res.status(400).json({ error: 'Invalid act-as account' });
      return;
    }
    const requestedActor = typeof actAsHeader === 'string' ? actAsHeader.trim() : '';
    if (requestedActor && requestedActor !== req.user.sub && requestedActor !== req.user.actAsUserId) {
      res.status(403).json({ error: 'Act-as account unavailable' });
      return;
    }

    const selection = req.query.subCompanyId;
    if (selection !== undefined && (typeof selection !== 'string' || !UUID_RE.test(selection.trim()))) {
      res.status(400).json({ error: 'Invalid subCompanyId' });
      return;
    }
    const selectedAgencyId = typeof selection === 'string' ? selection.trim() : null;
    let agencyIds = [...new Set(await resolveAllowedSubCompanyIds({
      ...req.user,
      role: ctx.roleKey,
      subCompanyId: ctx.subCompanyId,
      actAsUserId: undefined,
    }, req))];

    if (req.user.actAsUserId) {
      const target = await prisma.user.findUnique({
        where: { id: req.user.actAsUserId },
        select: { subCompanyId: true, isActive: true, offboardingStartedAt: true },
      });
      if (!target?.isActive || target.offboardingStartedAt) {
        res.status(403).json({ error: 'Act-as account unavailable' });
        return;
      }
      agencyIds = target.subCompanyId && agencyIds.includes(target.subCompanyId)
        ? [target.subCompanyId]
        : [];
    }
    if (selectedAgencyId) {
      if (!agencyIds.includes(selectedAgencyId)) {
        res.status(403).json({ error: 'You do not have access to the selected agency' });
        return;
      }
      agencyIds = [selectedAgencyId];
    }
    if (agencyIds.length === 0) {
      res.json({ data: [] });
      return;
    }

    const query = parseAttendanceQuery(req.query);
    if (!query.success) {
      res.status(400).json({ error: 'Invalid query', details: query.error.flatten() });
      return;
    }

    // Owner ids only ever NARROW the list: the agency clause below is the ceiling, so an id from another
    // agency (or a hand-edited URL) matches nothing rather than widening what this caller may see.
    const ownerIds = attendanceOwnerIds(query.data);
    const records = await prisma.attendance.findMany({
      where: {
        subCompanyId: { in: agencyIds },
        date: attendanceDateWhere(query.data),
        ...(ownerIds.length ? { userId: { in: ownerIds } } : {}),
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, role: true } },
        subCompany: { select: { id: true, name: true } },
      },
      orderBy: [{ date: 'desc' }, { user: { firstName: 'asc' } }],
      take: ATTENDANCE_MAX_ROWS + 1,
    });
    const truncated = records.length > ATTENDANCE_MAX_ROWS;
    res.json({ data: truncated ? records.slice(0, ATTENDANCE_MAX_ROWS) : records, truncated });
  } catch (err) {
    console.error('[attendance] list error', err);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});
