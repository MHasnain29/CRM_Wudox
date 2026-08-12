import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { attachAccessContext, ensureAccessContext } from '../utils/requestPermission';
import {
  buildAccessContext,
  canAccessMultipleAgencies,
  canViewAllDataInAgency,
  canViewTeamData,
} from '../services/accessContext';
import { createActivityLog } from '../services/activityLog';
import { emitToUsers } from '../socket';

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  // Raised from 200 → 1000: Reports page needs up to 500 records per fetch; passing limit > max
  // caused Zod validation to FAIL, making the fallback discard from/to and return all-time data.
  limit: z.coerce.number().min(1).max(1000).default(50),
  type: z.string().optional(),
  userId: z.string().uuid().optional(),
  // ISO strings
  from: z.string().optional(),
  to: z.string().optional(),
  subCompanyId: z.string().uuid().optional(),
});

export const activityLogsRouter = Router();
activityLogsRouter.use(attachAccessContext);

const breakSchema = z.object({
  breakType: z.enum(['coaching', 'meeting']),
  durationSeconds: z.number().int().min(1).max(28800),
  startedAt: z.string().datetime().optional(),
});

const idleSchema = z.object({
  durationSeconds: z.number().int().min(1).max(28800),
  startedAt: z.string().datetime().optional(),
});

/** POST /activity-logs/break — log completed break for current user */
activityLogsRouter.post('/break', authenticate, async (req: Request, res: Response) => {
  const parsed = breakSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }

  const userId = req.user?.sub;
  const subCompanyId = req.user?.subCompanyId;
  if (!userId || !subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }

  const { breakType, durationSeconds, startedAt } = parsed.data;
  if (durationSeconds > 28800) {
    return res.status(400).json({ error: 'Break duration exceeds maximum allowed (8 hours)' });
  }

  const recentBreakLog = await prisma.activityLog.findFirst({
    where: { userId, type: 'break_detected' },
    orderBy: { timestamp: 'desc' },
    select: { timestamp: true },
  });
  if (recentBreakLog && Date.now() - recentBreakLog.timestamp.getTime() < 30_000) {
    return res.status(429).json({ error: 'Too many break logs. Please wait before submitting again.' });
  }

  const duration = Math.round(durationSeconds / 60);
  await createActivityLog({
    userId,
    userName: req.user?.email ?? 'Unknown user',
    subCompanyId,
    type: 'break_detected',
    description: `${breakType === 'coaching' ? 'Coaching' : 'Meeting'} break (${duration} minutes)`,
    metadata: {
      duration,
      breakType,
      startedAt: startedAt ?? undefined,
    },
  });

  emitToUsers([userId], 'call:refresh', { subCompanyId });
  return res.status(201).json({ ok: true });
});

/** POST /activity-logs/idle — log completed idle period for current user */
activityLogsRouter.post('/idle', authenticate, async (req: Request, res: Response) => {
  const parsed = idleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }
  return res.status(410).json({
    error: 'Manual idle logging is disabled',
    message: 'Idle time is tracked server-side and recorded on manual-back confirmation.',
  });
});

/** GET /activity-logs/my-time — fetch break & idle logs for the current user (no special permission needed) */
activityLogsRouter.get('/my-time', authenticate, async (req: Request, res: Response) => {
  const userId = req.user?.sub;
  const subCompanyId = req.user?.subCompanyId;
  if (!userId || !subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }

  const parsed = querySchema.safeParse(req.query);
  const q = parsed.success ? parsed.data : { page: 1, limit: 200 };

  const ctx = req.access ?? (req.user ? await buildAccessContext(req.user) : null);
  const canViewOthers = !!ctx && canViewTeamData(ctx);

  const targetSubCompanyId =
    canViewOthers && ctx && canAccessMultipleAgencies(ctx) && q.subCompanyId
      ? q.subCompanyId
      : subCompanyId;

  const where: Record<string, unknown> = {
    subCompanyId: targetSubCompanyId,
    type: { in: ['break_detected', 'idle_detected'] },
  };

  if (canViewOthers) {
    // If a specific userId is requested, filter to that user; otherwise return all in agency
    if (q.userId) where.userId = q.userId;
  } else {
    // Regular users can only see their own logs
    where.userId = userId;
  }

  if (q.from || q.to) {
    const ts: Record<string, Date> = {};
    if (q.from) {
      const d = new Date(q.from);
      if (!isNaN(d.getTime())) ts.gte = d;
    }
    if (q.to) {
      const d = new Date(q.to);
      if (!isNaN(d.getTime())) ts.lte = d;
    }
    if (Object.keys(ts).length) where.timestamp = ts;
  }

  const list = await prisma.activityLog.findMany({
    where: where as never,
    orderBy: { timestamp: 'desc' },
    take: q.limit,
  });

  return res.json(list);
});

/** GET /activity-logs/mine — fetch own non-idle activity logs with optional type/date filter (no special permission needed) */
activityLogsRouter.get('/mine', authenticate, async (req: Request, res: Response) => {
  const userId = req.user?.sub;
  const subCompanyId = req.user?.subCompanyId;
  if (!userId || !subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }

  const parsed = querySchema.safeParse(req.query);
  const q = parsed.success ? parsed.data : { page: 1, limit: 20 };

  const where: Record<string, unknown> = {
    userId,
    subCompanyId,
    // If a specific type is requested, use it; otherwise exclude system/audit types
    type: q.type ? q.type : { notIn: ['idle_detected', 'break_detected', 'audit'] },
  };

  if (q.from || q.to) {
    const ts: Record<string, Date> = {};
    if (q.from) { const d = new Date(q.from); if (!isNaN(d.getTime())) ts.gte = d; }
    if (q.to)   { const d = new Date(q.to);   if (!isNaN(d.getTime())) ts.lte = d; }
    if (Object.keys(ts).length) where.timestamp = ts;
  }

  const list = await prisma.activityLog.findMany({
    where: where as never,
    orderBy: { timestamp: 'desc' },
    take: q.limit,
  });

  return res.json({ data: list });
});

activityLogsRouter.use(authenticate);
activityLogsRouter.use(requirePermission('settings:read'));

/** GET /activity-logs — list activity logs (agency-scoped; role-based user scope) */
activityLogsRouter.get('/', async (req: Request, res: Response) => {
  const parsed = querySchema.safeParse(req.query);
  const q = parsed.success ? parsed.data : { page: 1, limit: 50 };

  const ctx = await ensureAccessContext(req);
  const requesterId = req.user?.sub ?? null;
  const userSubCompanyId = req.user?.subCompanyId ?? null;
  if (!userSubCompanyId || !requesterId) {
    return res.status(403).json({ error: 'Agency context required' });
  }

  const targetSubCompanyId =
    q.subCompanyId && ctx && canAccessMultipleAgencies(ctx)
      ? q.subCompanyId
      : userSubCompanyId;

  const where: Record<string, unknown> = {
    subCompanyId: targetSubCompanyId,
  };
  if (q.type) where.type = q.type;

  if (ctx && canViewAllDataInAgency(ctx)) {
    if (q.userId) where.userId = q.userId;
  } else if (ctx && canViewTeamData(ctx)) {
    const targetUserId = q.userId ?? requesterId;
    if (q.userId && q.userId !== requesterId) {
      const allowed = await prisma.user.findFirst({
        where: {
          id: q.userId,
          subCompanyId: targetSubCompanyId,
          isActive: true,
          reportingManagerIds: { has: requesterId },
        },
        select: { id: true },
      });
      if (!allowed) {
        return res.status(403).json({ error: 'Not allowed to view this user\'s activity logs' });
      }
    }
    where.userId = targetUserId;
  } else {
    where.userId = requesterId;
  }

  if (q.from || q.to) {
    const ts: Record<string, Date> = {};
    if (q.from) {
      const d = new Date(q.from);
      if (!isNaN(d.getTime())) ts.gte = d;
    }
    if (q.to) {
      const d = new Date(q.to);
      if (!isNaN(d.getTime())) ts.lte = d;
    }
    if (Object.keys(ts).length) where.timestamp = ts;
  }

  const skip = (q.page - 1) * q.limit;
  const [total, list] = await Promise.all([
    prisma.activityLog.count({ where: where as never }),
    prisma.activityLog.findMany({
      where: where as never,
      orderBy: { timestamp: 'desc' },
      skip,
      take: q.limit,
    }),
  ]);

  return res.json({
    data: list,
    pagination: {
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.ceil(total / q.limit),
    },
  });
});

