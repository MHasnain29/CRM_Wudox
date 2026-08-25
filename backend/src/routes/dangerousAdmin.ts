/**
 * Super-admin Danger Zone API.
 * Only mounted when ALLOW_DANGEROUS_ADMIN_TOOLS=true.
 * HANDOVER: delete this file + unmount in server.ts.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { env } from '../config/env';
import {
  DEFAULT_KEEP_EMAIL,
  WIPE_CONFIRM_PHRASE,
  executeCrmWipe,
  normalizeKeepEmail,
  previewCrmWipe,
} from '../services/dangerousAdminWipe';

export const dangerousAdminRouter = Router();

function toolsEnabled(): boolean {
  return env.ALLOW_DANGEROUS_ADMIN_TOOLS === true;
}

function keepEmail(): string {
  return normalizeKeepEmail(env.DANGEROUS_ADMIN_KEEP_EMAIL || DEFAULT_KEEP_EMAIL);
}

function assertActorAllowed(req: Request, res: Response): boolean {
  if (!toolsEnabled()) {
    res.status(404).json({ error: 'Not found' });
    return false;
  }
  const actorEmail = normalizeKeepEmail(req.user?.email ?? '');
  const allowed = keepEmail();
  if (actorEmail !== allowed) {
    res.status(403).json({
      error: 'Forbidden',
      message: `Only ${allowed} may run Danger Zone tools.`,
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
  const preview = await previewCrmWipe(keepEmail());
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

  const allowedEmail = keepEmail();
  if (parsed.data.confirmPhrase.trim() !== WIPE_CONFIRM_PHRASE) {
    return res.status(400).json({
      error: 'Confirmation phrase mismatch',
      message: `Type exactly: ${WIPE_CONFIRM_PHRASE}`,
    });
  }
  if (normalizeKeepEmail(parsed.data.confirmEmail) !== allowedEmail) {
    return res.status(400).json({
      error: 'Confirmation email mismatch',
      message: `Type exactly: ${allowedEmail}`,
    });
  }

  const preview = await previewCrmWipe(allowedEmail);
  if (!preview.keepUserFound) {
    return res.status(400).json({ error: `Keep user not found: ${allowedEmail}` });
  }

  try {
    const result = await executeCrmWipe(allowedEmail);
    return res.json(result);
  } catch (err) {
    console.error('Danger Zone wipe failed', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Wipe failed',
    });
  }
});
