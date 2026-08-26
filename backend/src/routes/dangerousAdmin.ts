/**
 * Super-admin Danger Zone API.
 * HANDOVER: delete this file + unmount in server.ts before client delivery.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  DEFAULT_KEEP_EMAIL,
  WIPE_CONFIRM_PHRASE,
  executeCrmWipe,
  normalizeKeepEmail,
  previewCrmWipe,
} from '../services/dangerousAdminWipe';

export const dangerousAdminRouter = Router();

const KEEP_EMAIL = DEFAULT_KEEP_EMAIL;

function assertActorAllowed(req: Request, res: Response): boolean {
  const actorEmail = normalizeKeepEmail(req.user?.email ?? '');
  if (actorEmail !== normalizeKeepEmail(KEEP_EMAIL)) {
    res.status(403).json({
      error: 'Forbidden',
      message: `Only ${KEEP_EMAIL} may run Danger Zone tools.`,
    });
    return false;
  }
  return true;
}

dangerousAdminRouter.use(authenticate);
dangerousAdminRouter.use(requireRole('super_admin'));

/** Status + preview counts (no mutation). */
dangerousAdminRouter.get('/status', async (req: Request, res: Response) => {
  if (!assertActorAllowed(req, res)) return;
  const preview = await previewCrmWipe(KEEP_EMAIL);
  return res.json({
    enabled: true,
    confirmPhrase: WIPE_CONFIRM_PHRASE,
    keepEmail: preview.keepEmail,
    preview,
  });
});

const wipeSchema = z.object({
  confirmPhrase: z.string().min(1),
  confirmEmail: z.string().email(),
});

/** Irreversible CRM wipe — keeps one user + system scaffolding. */
dangerousAdminRouter.post('/wipe-crm', async (req: Request, res: Response) => {
  if (!assertActorAllowed(req, res)) return;

  const parsed = wipeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  }

  if (parsed.data.confirmPhrase.trim() !== WIPE_CONFIRM_PHRASE) {
    return res.status(400).json({
      error: 'Confirmation phrase mismatch',
      message: `Type exactly: ${WIPE_CONFIRM_PHRASE}`,
    });
  }
  if (normalizeKeepEmail(parsed.data.confirmEmail) !== normalizeKeepEmail(KEEP_EMAIL)) {
    return res.status(400).json({
      error: 'Confirmation email mismatch',
      message: `Type exactly: ${KEEP_EMAIL}`,
    });
  }

  const preview = await previewCrmWipe(KEEP_EMAIL);
  if (!preview.keepUserFound) {
    return res.status(400).json({ error: `Keep user not found: ${KEEP_EMAIL}` });
  }

  try {
    const result = await executeCrmWipe(KEEP_EMAIL);
    return res.json(result);
  } catch (err) {
    console.error('Danger Zone wipe failed', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Wipe failed',
    });
  }
});
