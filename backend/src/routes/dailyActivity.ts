/**
 * Unified daily activity: hierarchy, feed items, summary counters.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { parseAgencyIdsParam } from '../config/agencyScope';
import {
  getDailyActivityHierarchy,
  getDailyActivitySummary,
  getDailyActivityTodayCount,
  listDailyActivityItems,
  type ActivityFilter,
  type DailyActivityKind,
} from '../services/dailyActivityService';

export const dailyActivityRouter = Router();
dailyActivityRouter.use(authenticate);

const itemsQuerySchema = z.object({
  scope: z.enum(['self', 'team', 'user']).optional(),
  userId: z.string().uuid().optional(),
  filter: z
    .enum([
      'today',
      'action_today',
      'pending',
      'overdue',
      'completed_today',
      'awaiting_approval',
      'all',
    ])
    .optional(),
  kinds: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  agencyIds: z.string().optional(),
});

const summaryQuerySchema = z.object({
  userIds: z.string().min(1),
  agencyIds: z.string().optional(),
});

const hierarchyQuerySchema = z.object({
  agencyIds: z.string().optional(),
});

/** GET /daily-activity/today-count — badge count (due today + overdue) */
dailyActivityRouter.get('/today-count', async (req: Request, res: Response) => {
  if (!req.user?.subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const parsed = hierarchyQuerySchema.safeParse(req.query);
  const agencyIds = parseAgencyIdsParam(parsed.success ? parsed.data.agencyIds : undefined);
  try {
    const result = await getDailyActivityTodayCount(req.user, agencyIds);
    return res.json(result);
  } catch (err) {
    console.error('[daily-activity/today-count]', err);
    return res.status(500).json({ error: 'Failed to load today count' });
  }
});

/** GET /daily-activity/hierarchy — role-based tree with per-user counters */
dailyActivityRouter.get('/hierarchy', async (req: Request, res: Response) => {
  if (!req.user?.subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const parsed = hierarchyQuerySchema.safeParse(req.query);
  const agencyIds = parseAgencyIdsParam(parsed.success ? parsed.data.agencyIds : undefined);

  try {
    const result = await getDailyActivityHierarchy(req.user, agencyIds);
    return res.json(result);
  } catch (err) {
    console.error('[daily-activity/hierarchy]', err);
    return res.status(500).json({ error: 'Failed to load activity hierarchy' });
  }
});

/** GET /daily-activity/items — paginated unified activity feed */
dailyActivityRouter.get('/items', async (req: Request, res: Response) => {
  if (!req.user?.subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const parsed = itemsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
  }
  const kinds = parsed.data.kinds
    ? (parsed.data.kinds.split(',').filter(Boolean) as DailyActivityKind[])
    : undefined;

  try {
    const agencyIds = parseAgencyIdsParam(parsed.data.agencyIds);

    const result = await listDailyActivityItems(req.user, {
      scope: parsed.data.scope,
      userId: parsed.data.userId,
      filter: (parsed.data.filter ?? 'action_today') as ActivityFilter,
      kinds,
      q: parsed.data.q,
      page: parsed.data.page,
      limit: parsed.data.limit,
      agencyIds,
    });
    return res.json(result);
  } catch (err) {
    console.error('[daily-activity/items]', err);
    return res.status(500).json({ error: 'Failed to load activity items' });
  }
});

/** GET /daily-activity/summary — counter refresh for userIds (comma-separated) */
dailyActivityRouter.get('/summary', async (req: Request, res: Response) => {
  if (!req.user?.subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const parsed = summaryQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'userIds query required (comma-separated UUIDs)' });
  }
  const userIds = parsed.data.userIds.split(',').map((s) => s.trim()).filter(Boolean);
  if (userIds.length === 0) {
    return res.status(400).json({ error: 'At least one userId required' });
  }
  if (userIds.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 userIds per request' });
  }

  try {
    const agencyIds = parseAgencyIdsParam(parsed.data.agencyIds);
    const result = await getDailyActivitySummary(req.user, userIds, agencyIds);
    return res.json(result);
  } catch (err) {
    console.error('[daily-activity/summary]', err);
    return res.status(500).json({ error: 'Failed to load activity summary' });
  }
});
