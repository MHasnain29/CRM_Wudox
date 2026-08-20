/**
 * Hubstaff integration API.
 *
 * - Everyone can view their own synced time data (GET /time-entries without userId).
 * - hubstaff:view_all → time data for all users in the agency.
 * - hubstaff:manage → connect/disconnect, map users, trigger sync.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { actAsMiddleware } from '../middleware/actAs';
import { requirePermission } from '../middleware/requirePermission';
import { ensurePermissionKeys } from '../utils/requestPermission';
import { resolveAgencyScope } from '../config/agencyScope';
import {
  HubstaffError,
  listOrganizationsForToken,
  runHubstaffSync,
  syncUserLinks,
} from '../services/hubstaff';

export const hubstaffRouter = Router();
hubstaffRouter.use(authenticate);
hubstaffRouter.use(actAsMiddleware);

function hubstaffErrorStatus(err: unknown): number {
  if (err instanceof HubstaffError && err.status === 401) return 502;
  return 500;
}

// ── GET /hubstaff/status ─────────────────────────────────────────────────────
// Connection state for the current agency (any authenticated user).
hubstaffRouter.get('/status', async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) { res.status(400).json({ error: 'No agency context' }); return; }

  try {
    const config = await prisma.hubstaffConfig.findUnique({
      where: { subCompanyId },
      select: {
        id: true,
        hubstaffOrgId: true,
        orgName: true,
        syncEnabled: true,
        lastSyncAt: true,
        lastSyncError: true,
        createdAt: true,
      },
    });
    if (!config) { res.json({ data: { connected: false } }); return; }

    const [linkedCount, unlinkedCount] = await Promise.all([
      prisma.hubstaffUserLink.count({ where: { configId: config.id, userId: { not: null } } }),
      prisma.hubstaffUserLink.count({ where: { configId: config.id, userId: null } }),
    ]);
    res.json({ data: { connected: true, ...config, linkedCount, unlinkedCount } });
  } catch (err) {
    console.error('[hubstaff] status error', err);
    res.status(500).json({ error: 'Failed to fetch Hubstaff status' });
  }
});

// ── POST /hubstaff/connect ───────────────────────────────────────────────────
// Body: { personalAccessToken, organizationId? }.
// Exchanges the PAT; when the token can see multiple orgs and none is chosen,
// returns the list so the UI can ask (nothing is stored in that case).
hubstaffRouter.post('/connect', requirePermission('hubstaff:manage'), async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) { res.status(400).json({ error: 'No agency context' }); return; }

  const schema = z.object({
    personalAccessToken: z.string().min(10),
    organizationId: z.number().int().positive().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'personalAccessToken is required' }); return; }

  try {
    const { organizations, tokens } = await listOrganizationsForToken(parsed.data.personalAccessToken);
    if (organizations.length === 0) {
      res.status(400).json({ error: 'This token has no Hubstaff organizations' });
      return;
    }

    let org = organizations[0];
    if (parsed.data.organizationId) {
      const found = organizations.find((o) => o.id === parsed.data.organizationId);
      if (!found) { res.status(400).json({ error: 'Organization not found for this token' }); return; }
      org = found;
    } else if (organizations.length > 1) {
      // Token already rotated — the caller must re-enter the PAT? No: Hubstaff
      // PATs stay valid until first use as refresh token rotates them, so we
      // return the rotated refresh token for the UI to send back with the org.
      res.json({
        data: {
          requiresOrganizationChoice: true,
          organizations: organizations.map((o) => ({ id: o.id, name: o.name })),
          rotatedToken: tokens.refresh_token,
        },
      });
      return;
    }

    const config = await prisma.hubstaffConfig.upsert({
      where: { subCompanyId },
      create: {
        subCompanyId,
        hubstaffOrgId: org.id,
        orgName: org.name,
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        connectedById: req.user!.sub,
      },
      update: {
        hubstaffOrgId: org.id,
        orgName: org.name,
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        connectedById: req.user!.sub,
        lastSyncError: null,
        syncEnabled: true,
      },
    });

    const newLinks = await syncUserLinks(config);
    res.status(201).json({
      data: { connected: true, hubstaffOrgId: org.id, orgName: org.name, newLinks },
    });
  } catch (err) {
    console.error('[hubstaff] connect error', err);
    const message = err instanceof HubstaffError ? err.message : 'Failed to connect Hubstaff';
    res.status(hubstaffErrorStatus(err)).json({ error: message });
  }
});

// ── DELETE /hubstaff/disconnect ──────────────────────────────────────────────
// Removes the connection. Synced activity rows are kept for history.
hubstaffRouter.delete('/disconnect', requirePermission('hubstaff:manage'), async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) { res.status(400).json({ error: 'No agency context' }); return; }

  try {
    const config = await prisma.hubstaffConfig.findUnique({ where: { subCompanyId } });
    if (!config) { res.status(404).json({ error: 'Hubstaff is not connected' }); return; }
    await prisma.hubstaffConfig.delete({ where: { id: config.id } });
    res.json({ success: true });
  } catch (err) {
    console.error('[hubstaff] disconnect error', err);
    res.status(500).json({ error: 'Failed to disconnect Hubstaff' });
  }
});

// ── GET /hubstaff/members ────────────────────────────────────────────────────
// Hubstaff members + their CRM user mapping, for the Settings mapping table.
hubstaffRouter.get('/members', requirePermission('hubstaff:manage'), async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) { res.status(400).json({ error: 'No agency context' }); return; }

  try {
    const config = await prisma.hubstaffConfig.findUnique({ where: { subCompanyId } });
    if (!config) { res.status(404).json({ error: 'Hubstaff is not connected' }); return; }

    const links = await prisma.hubstaffUserLink.findMany({
      where: { configId: config.id },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } } },
      orderBy: { hubstaffName: 'asc' },
    });
    res.json({ data: links });
  } catch (err) {
    console.error('[hubstaff] members error', err);
    res.status(500).json({ error: 'Failed to fetch Hubstaff members' });
  }
});

// ── PUT /hubstaff/members/:hubstaffUserId/link ───────────────────────────────
// Body: { userId: string | null } — map or unmap a Hubstaff member.
// Re-attributes already-synced activity rows to the new user.
hubstaffRouter.put('/members/:hubstaffUserId/link', requirePermission('hubstaff:manage'), async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) { res.status(400).json({ error: 'No agency context' }); return; }

  const hubstaffUserId = parseInt(req.params.hubstaffUserId, 10);
  if (!Number.isFinite(hubstaffUserId)) { res.status(400).json({ error: 'Invalid Hubstaff user id' }); return; }

  const schema = z.object({ userId: z.string().uuid().nullable() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'userId must be a user id or null' }); return; }
  const userId = parsed.data.userId;

  try {
    const config = await prisma.hubstaffConfig.findUnique({ where: { subCompanyId } });
    if (!config) { res.status(404).json({ error: 'Hubstaff is not connected' }); return; }

    if (userId) {
      const user = await prisma.user.findFirst({ where: { id: userId, subCompanyId } });
      if (!user) { res.status(404).json({ error: 'User not found in this agency' }); return; }
    }

    const link = await prisma.hubstaffUserLink.update({
      where: { configId_hubstaffUserId: { configId: config.id, hubstaffUserId } },
      data: { userId, autoMatched: false },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } } },
    });

    await prisma.hubstaffDailyActivity.updateMany({
      where: { subCompanyId, hubstaffUserId },
      data: { userId },
    });

    res.json({ data: link });
  } catch (err) {
    console.error('[hubstaff] link error', err);
    res.status(500).json({ error: 'Failed to update mapping' });
  }
});

// ── POST /hubstaff/sync ──────────────────────────────────────────────────────
// Body: { startDate?, endDate? } (YYYY-MM-DD). Defaults to the last 14 days.
hubstaffRouter.post('/sync', requirePermission('hubstaff:manage'), async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) { res.status(400).json({ error: 'No agency context' }); return; }

  const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const schema = z.object({ startDate: dateStr.optional(), endDate: dateStr.optional() });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: 'Dates must be YYYY-MM-DD' }); return; }

  const endDate = parsed.data.endDate ?? new Date().toISOString().slice(0, 10);
  const startDate =
    parsed.data.startDate ??
    new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (startDate > endDate) { res.status(400).json({ error: 'startDate must be before endDate' }); return; }

  try {
    const config = await prisma.hubstaffConfig.findUnique({ where: { subCompanyId } });
    if (!config) { res.status(404).json({ error: 'Hubstaff is not connected' }); return; }

    const result = await runHubstaffSync(config, startDate, endDate);
    res.json({ data: { ...result, startDate, endDate } });
  } catch (err) {
    console.error('[hubstaff] sync error', err);
    const message = err instanceof HubstaffError ? err.message : 'Sync failed';
    res.status(hubstaffErrorStatus(err)).json({ error: message });
  }
});

// ── GET /hubstaff/time-entries ───────────────────────────────────────────────
// Query: month=YYYY-MM (default current) OR start/end=YYYY-MM-DD; userId=...
// Own data for everyone; other/all users require hubstaff:view_all.
hubstaffRouter.get('/time-entries', async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) { res.status(400).json({ error: 'No agency context' }); return; }

  const monthSchema = z.string().regex(/^\d{4}-\d{2}$/).optional();
  const monthParsed = monthSchema.safeParse(req.query.month);
  const monthStr = monthParsed.success && monthParsed.data ? monthParsed.data : null;

  let from: Date;
  let to: Date;
  if (monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    from = new Date(Date.UTC(y, m - 1, 1));
    to = new Date(Date.UTC(y, m, 1));
  } else {
    const now = new Date();
    from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  }

  const requestedUserId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
  const scope = typeof req.query.scope === 'string' ? req.query.scope : 'me';

  const permKeys = req.user!.role === 'super_admin' ? ['hubstaff:view_all'] : await ensurePermissionKeys(req);
  const canViewAll = permKeys.includes('hubstaff:view_all');

  // Default to own data; "all" scope or another user's data requires view_all
  let userFilter: { userId: string } | Record<string, never>;
  if (scope === 'all' || (requestedUserId && requestedUserId !== req.user!.sub)) {
    if (!canViewAll) { res.status(403).json({ error: 'Forbidden' }); return; }
    userFilter = requestedUserId ? { userId: requestedUserId } : {};
  } else {
    userFilter = { userId: req.user!.sub };
  }

  try {
    const records = await prisma.hubstaffDailyActivity.findMany({
      where: {
        subCompanyId,
        date: { gte: from, lt: to },
        ...userFilter,
        ...(scope === 'all' && !requestedUserId ? { userId: { not: null } } : {}),
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
      orderBy: [{ date: 'desc' }],
    });
    res.json({ data: records, meta: { canViewAll } });
  } catch (err) {
    console.error('[hubstaff] time-entries error', err);
    res.status(500).json({ error: 'Failed to fetch time entries' });
  }
});
