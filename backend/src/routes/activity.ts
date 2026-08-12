import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { getRedis } from '../config/redis';
import {
  getCurrentSession,
  processHeartbeat,
  processManualBack,
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
});

// ── GET /current-session ───────────────────────────────────────────────────────
// Called on every app boot. Returns current server-authoritative state.
// This is what prevents the refresh/reopen bypass.

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
    const result = await processHeartbeat(sessionId, userId, visibilityState, hadActivitySinceLastBeat);
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
// The ONLY endpoint that can transition state back to active.
// Frontend must check response.state === 'active' before closing the modal.

activityRouter.post('/manual-back', authenticate, async (req: Request, res: Response) => {
  const userId = req.user!.sub;

  const parsed = sessionIdSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  }

  try {
    const result = await processManualBack(parsed.data.sessionId, userId);
    return res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return res.status(404).json({ error: msg });
  }
});

// ── POST /end-session ──────────────────────────────────────────────────────────
// Called on logout. Flushes final counters and closes the session.

activityRouter.post('/end-session', authenticate, async (req: Request, res: Response) => {
  const userId = req.user!.sub;
  await endActivitySession(userId);
  return res.json({ ok: true });
});
