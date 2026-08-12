import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import {
  linkUsers,
  unlinkUser,
  dissolveLinkGroup,
  getLinkedAccounts,
  getAllLinkGroups,
} from '../services/agencyLink';

const agencyLinkRouter = Router();

const linkBody = z.object({
  userIdA: z.string().uuid(),
  userIdB: z.string().uuid(),
});

const unlinkParams = z.object({
  targetUserId: z.string().uuid(),
});

const dissolveParams = z.object({
  groupId: z.string().uuid(),
});

// GET /agency-links — list all link groups (admin view, requires users:link_agency)
agencyLinkRouter.get(
  '/',
  authenticate,
  requirePermission('users:link_agency'),
  async (_req: Request, res: Response) => {
    try {
      const groups = await getAllLinkGroups();
      return res.json(groups);
    } catch (err: any) {
      return res.status(err.status ?? 500).json({ error: err.message ?? 'Internal server error' });
    }
  },
);

// GET /agency-links/my-accounts — return all linked accounts for the current user (self-service, no permission required)
agencyLinkRouter.get('/my-accounts', authenticate, async (req: Request, res: Response) => {
  try {
    const accounts = await getLinkedAccounts(req.user!.sub);
    return res.json(accounts);
  } catch (err: any) {
    return res.status(err.status ?? 500).json({ error: err.message ?? 'Internal server error' });
  }
});

// POST /agency-links — link two users (requires users:link_agency)
agencyLinkRouter.post(
  '/',
  authenticate,
  requirePermission('users:link_agency'),
  async (req: Request, res: Response) => {
    const parsed = linkBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    }
    const { userIdA, userIdB } = parsed.data;
    try {
      await linkUsers(req.user!.sub, userIdA, userIdB);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(err.status ?? 500).json({ error: err.message ?? 'Internal server error' });
    }
  },
);

// DELETE /agency-links/groups/:groupId — dissolve entire group (must be before /:targetUserId)
agencyLinkRouter.delete(
  '/groups/:groupId',
  authenticate,
  requirePermission('users:link_agency'),
  async (req: Request, res: Response) => {
    const parsed = dissolveParams.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid group ID' });
    }
    try {
      await dissolveLinkGroup(req.user!.sub, parsed.data.groupId);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(err.status ?? 500).json({ error: err.message ?? 'Internal server error' });
    }
  },
);

// DELETE /agency-links/:targetUserId — unlink a user from their group (requires users:link_agency)
agencyLinkRouter.delete(
  '/:targetUserId',
  authenticate,
  requirePermission('users:link_agency'),
  async (req: Request, res: Response) => {
    const parsed = unlinkParams.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    try {
      await unlinkUser(req.user!.sub, parsed.data.targetUserId);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(err.status ?? 500).json({ error: err.message ?? 'Internal server error' });
    }
  },
);

export default agencyLinkRouter;
