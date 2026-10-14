import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { getRedis } from '../config/redis';
import {
  getCurrentSession,
  processHeartbeat,
  processManualBack,
  processBreak,
  endActivitySession,
  logActivityEvent,
} from '../services/activitySession';

export const activityRouter = Router();

// ── Rate limiting helpers ──────────────────────────────────────────────────────
// Per-user rate limit using Redis. Falls back to allow if Redis is unavailable.

async function isRateLimited(key: string, maxPerWindow: number, windowS: number): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowS);
    return count > maxPerWindow;
  } catch {
    return false;
  }
}

// ── Schemas ────────────────────────────────────────────────────────────────────

const heartbeatSchema = z.object({
  sessionId: z.string().min(1),
  visibilityState: z.enum(['visible', 'hidden']),
  hadActivitySinceLastBeat: z.boolean(),
  measurementVersion: z.literal(2).optional(),
  clientId: z.string().min(1).max(200).optional(),
  clientTime: z.string().datetime().optional(),
  lastActivityAt: z.string().datetime().nullable().optional(),
  firstActivityAt: z.string().datetime().nullable().optional(),
  timeZone: z.string().max(100).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }).optional(),
}).superRefine((value, context) => {
  if (value.measurementVersion !== 2) return;
  if (!value.clientId || !value.clientTime || !value.timeZone || value.lastActivityAt === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Version 2 requires clientId, clientTime, lastActivityAt and timeZone' });
  }
  if (value.lastActivityAt && value.clientTime && Date.parse(value.lastActivityAt) > Date.parse(value.clientTime)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Input time cannot be after clientTime' });
  }
  if (value.firstActivityAt && (!value.lastActivityAt || Date.parse(value.firstActivityAt) > Date.parse(value.lastActivityAt))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'First input must precede last input' });
  }
});

const eventSchema = z.object({
  sessionId: z.string().min(1),
  eventType: z.enum([
    'user_activity',
    'tab_hidden',
    'tab_visible',
    'before_unload',
    'manual_back',
    'session_start',
  ]),
  clientTime: z.string().optional(),
});

const sessionIdSchema = z.object({
  sessionId: z.string().min(1),
  measurement: z.preprocess(value => value && typeof value === 'object' ? {
    ...value, sessionId: 'snapshot', visibilityState: 'visible', hadActivitySinceLastBeat: true,
  } : value, heartbeatSchema.refine(value => value.measurementVersion === 2)).optional(),
});

function transitionMeasurement(value: z.infer<typeof sessionIdSchema>['measurement']) {
  return value ? { measurementVersion: 2 as const, clientId: value.clientId!, clientTime: value.clientTime!,
    lastActivityAt: value.lastActivityAt!, firstActivityAt: value.firstActivityAt, timeZone: value.timeZone! } : undefined;
}

// ── GET /current-session ───────────────────────────────────────────────────────
// Called on every app boot. Returns current server-authoritative state.
// Reopening also recovers a missing session; it never reconstructs unobserved time.

activityRouter.get('/current-session', authenticate, async (req: Request, res: Response) => {
  const userId = req.user!.sub;
  const session = await getCurrentSession(userId);
  if (!session) {
    return res.status(404).json({ error: 'No active session' });
  }
  return res.json(session);
});

// ── POST /heartbeat ────────────────────────────────────────────────────────────
// Rate limit: 5 per 30s per user. Frontend cadence is 20s from a single leader tab,
// but multi-tab leader-election races can briefly let two tabs both heartbeat. The
// window has to absorb that without 429-ing (which spams the browser console with
// no useful effect — the modal still works).

activityRouter.post('/heartbeat', authenticate, async (req: Request, res: Response) => {
  const userId = req.user!.sub;

  const limited = await isRateLimited(`activity:hb:${userId}`, 5, 30);
  if (limited) {
    return res.status(429).json({ error: 'Too many heartbeats' });
  }

  const parsed = heartbeatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  }

  const { sessionId, visibilityState, hadActivitySinceLastBeat } = parsed.data;

  try {
    const body = parsed.data;
    const measurement = body.measurementVersion === 2 ? {
      measurementVersion: 2 as const, clientId: body.clientId!, clientTime: body.clientTime!, lastActivityAt: body.lastActivityAt!,
      firstActivityAt: body.firstActivityAt, timeZone: body.timeZone!,
    } : undefined;
    const result = await processHeartbeat(sessionId, userId, visibilityState, hadActivitySinceLastBeat, measurement);
    return res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return res.status(404).json({ error: msg });
  }
});

// ── POST /event ────────────────────────────────────────────────────────────────
// Rate limit: 60 per minute per user. tab_hidden/tab_visible events fire on every
// focus change — a user flipping between tabs can produce a burst legitimately.

activityRouter.post('/event', authenticate, async (req: Request, res: Response) => {
  const userId = req.user!.sub;

  const limited = await isRateLimited(`activity:ev:${userId}`, 60, 60);
  if (limited) {
    return res.status(429).json({ error: 'Too many events' });
  }

  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  }

  await logActivityEvent(parsed.data.sessionId, userId, parsed.data.eventType);
  return res.json({ ok: true });
});

// ── POST /manual-back ──────────────────────────────────────────────────────────
// Explicit return; ordinary measured input also ends CRM inactivity.

activityRouter.post('/manual-back', authenticate, async (req: Request, res: Response) => {
  const userId = req.user!.sub;

  const parsed = sessionIdSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  }

  try {
    const result = await processManualBack(parsed.data.sessionId, userId, transitionMeasurement(parsed.data.measurement));
    return res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return res.status(404).json({ error: msg });
  }
});

const breakSchema = sessionIdSchema.extend({
  onBreak: z.boolean(),
  breakType: z.enum(['break', 'coaching', 'meeting']).optional(),
  timeZone: z.string().max(100).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }),
});

activityRouter.post('/break', authenticate, async (req: Request, res: Response) => {
  const parsed = breakSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  try {
    return res.json(await processBreak(parsed.data.sessionId, req.user!.sub, parsed.data.onBreak, parsed.data.timeZone, transitionMeasurement(parsed.data.measurement), parsed.data.breakType));
  } catch (err) {
    return res.status(404).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── POST /end-session ──────────────────────────────────────────────────────────
// Called on logout. Closes the session at its last confirmed measurement.

activityRouter.post('/end-session', authenticate, async (req: Request, res: Response) => {
  const userId = req.user!.sub;
  await endActivitySession(userId);
  return res.json({ ok: true });
});
