/**
 * Attendance API — daily check-in / check-out + history.
 * All logged-in users can check in/out and view their own history.
 * attendance:view_all → view all employees + export.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { actAsMiddleware } from '../middleware/actAs';
import { resolveAgencyScope } from '../config/agencyScope';

export const attendanceRouter = Router();
attendanceRouter.use(authenticate);
attendanceRouter.use(actAsMiddleware);

function hasViewAll(permissionKeys: string[]): boolean {
  return permissionKeys.includes('attendance:view_all');
}

async function getPermKeys(req: Request): Promise<string[]> {
  return (req as any).permissionKeys ?? [];
}

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
// Own history — month query param (YYYY-MM), defaults to current month.
attendanceRouter.get('/me', async (req: Request, res: Response) => {
  const userId = req.user!.sub;

  const monthSchema = z.string().regex(/^\d{4}-\d{2}$/).optional();
  const parsed = monthSchema.safeParse(req.query.month);
  const monthStr = parsed.success && parsed.data ? parsed.data : null;

  let from: Date;
  let to: Date;
  if (monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    from = new Date(y, m - 1, 1);
    to = new Date(y, m, 1);
  } else {
    const now = new Date();
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }

  try {
    const records = await prisma.attendance.findMany({
      where: { userId, date: { gte: from, lt: to } },
      orderBy: { date: 'desc' },
    });
    res.json({ data: records });
  } catch (err) {
    console.error('[attendance] me error', err);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

// ── GET /attendance ────────────────────────────────────────────────────────
// All employees (attendance:view_all only). Supports ?month=YYYY-MM&userId=...
attendanceRouter.get('/', async (req: Request, res: Response) => {
  const permKeys = await getPermKeys(req);
  if (!hasViewAll(permKeys)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) {
    res.status(400).json({ error: 'No agency context' });
    return;
  }

  const monthSchema = z.string().regex(/^\d{4}-\d{2}$/).optional();
  const parsed = monthSchema.safeParse(req.query.month);
  const monthStr = parsed.success && parsed.data ? parsed.data : null;

  let from: Date;
  let to: Date;
  if (monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    from = new Date(y, m - 1, 1);
    to = new Date(y, m, 1);
  } else {
    const now = new Date();
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }

  const filterUserId = typeof req.query.userId === 'string' ? req.query.userId : undefined;

  try {
    const records = await prisma.attendance.findMany({
      where: {
        subCompanyId,
        date: { gte: from, lt: to },
        ...(filterUserId ? { userId: filterUserId } : {}),
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
      orderBy: [{ date: 'desc' }, { user: { firstName: 'asc' } }],
    });
    res.json({ data: records });
  } catch (err) {
    console.error('[attendance] list error', err);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});
