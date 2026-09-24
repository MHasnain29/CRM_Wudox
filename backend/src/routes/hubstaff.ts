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
import { resolveAgencyScope, resolveAllowedSubCompanyIds } from '../config/agencyScope';
import { encryptSecret } from '../utils/secretsCrypto';
import { dateOnly } from '../services/hubstaffData';
import {
  HubstaffError,
  listOrganizationsForToken,
  runHubstaffSync,
  syncUserLinks,
  eligibleHubstaffUsers,
  withHubstaffLease,
  lockHubstaffAgencies,
  rebuildHubstaffDaily,
} from '../services/hubstaff';

export const hubstaffRouter = Router();
hubstaffRouter.use(authenticate);
hubstaffRouter.use(actAsMiddleware);

function hubstaffErrorStatus(err: unknown): number {
  if (err instanceof HubstaffError && err.status === 409) return 409;
  if (err instanceof HubstaffError && err.status === 400) return 400;
  if (err instanceof HubstaffError && err.status === 401) return 502;
  return 500;
}

/** A shared organization cannot be administered through only one of its agencies. */
async function canManageHubstaffConnection(
  req: Request,
  res: Response,
  config: { id: string; subCompanyId: string }
): Promise<boolean> {
  const allowed = await resolveAllowedSubCompanyIds(req.user!, req);
  const mappings = await prisma.hubstaffProjectMapping.findMany({
    where: { configId: config.id },
    select: { subCompanyId: true },
  });
  if (
    [config.subCompanyId, ...mappings.map(mapping => mapping.subCompanyId)].every(id =>
      allowed.includes(id)
    )
  )
    return true;
  res.status(403).json({
    error: 'Managing this shared Hubstaff connection requires access to every agency mapped to it.',
  });
  return false;
}

// ── GET /hubstaff/status ─────────────────────────────────────────────────────
// Connection state for the current agency (any authenticated user).
hubstaffRouter.get('/status', async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) {
    res.status(400).json({ error: 'No agency context' });
    return;
  }

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
        taskSyncStatus: true,
        taskSyncError: true,
        lastTaskSyncAt: true,
        orgTimezone: true,
        tasksOrganizationId: true,
        tasksIntegrationId: true,
        createdAt: true,
      },
    });
    if (!config) {
      res.json({ data: { connected: false } });
      return;
    }

    const [linkedCount, unlinkedCount] = await Promise.all([
      prisma.hubstaffUserLink.count({ where: { configId: config.id, userId: { not: null } } }),
      prisma.hubstaffUserLink.count({ where: { configId: config.id, userId: null } }),
    ]);
    const latestRun = await prisma.hubstaffSyncRun.findFirst({
      where: { configId: config.id },
      orderBy: { startedAt: 'desc' },
    });
    res.json({
      data: { connected: config.syncEnabled, ...config, linkedCount, unlinkedCount, latestRun },
    });
  } catch (err) {
    console.error('[hubstaff] status error', err);
    res.status(500).json({ error: 'Failed to fetch Hubstaff status' });
  }
});

// ── POST /hubstaff/connect ───────────────────────────────────────────────────
// Body: { personalAccessToken, organizationId? }.
// Exchanges the PAT; when the token can see multiple orgs and none is chosen,
// returns the list so the UI can ask (nothing is stored in that case).
hubstaffRouter.post(
  '/connect',
  requirePermission('hubstaff:manage'),
  async (req: Request, res: Response) => {
    const subCompanyId = await resolveAgencyScope(req);
    if (!subCompanyId) {
      res.status(400).json({ error: 'No agency context' });
      return;
    }
    const parsed = z
      .object({
        personalAccessToken: z.string().min(10),
        organizationId: z.number().int().positive().optional(),
        orgTimezone: z.string().max(100).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'A personal access token is required' });
      return;
    }
    let orgTimezone: string | undefined;
    if (parsed.data.orgTimezone) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: parsed.data.orgTimezone }).format();
        orgTimezone = parsed.data.orgTimezone;
      } catch {
        res.status(400).json({ error: 'Invalid Hubstaff organization timezone' });
        return;
      }
    }
    try {
      const existing = await prisma.hubstaffConfig.findUnique({ where: { subCompanyId } });
      if (existing && !(await canManageHubstaffConnection(req, res, existing))) return;
      if (
        existing &&
        parsed.data.organizationId &&
        parsed.data.organizationId !== existing.hubstaffOrgId
      ) {
        throw new HubstaffError(
          'This agency has history for another Hubstaff organization. Keep that connection separate.',
          409
        );
      }
      const connect = async () => {
        const { organizations, tokens } = await listOrganizationsForToken(
          parsed.data.personalAccessToken
        );
        if (!organizations.length)
          throw new HubstaffError('This token has no Hubstaff organizations', 400);
        const requestedId = parsed.data.organizationId ?? existing?.hubstaffOrgId;
        if (!requestedId && organizations.length > 1) {
          return {
            status: 200,
            data: {
              requiresOrganizationChoice: true,
              organizations: organizations.map(organization => ({
                id: organization.id,
                name: organization.name,
              })),
              rotatedToken: tokens.refresh_token,
            },
          };
        }
        const org = requestedId
          ? organizations.find(organization => organization.id === requestedId)
          : organizations[0];
        if (!org) throw new HubstaffError('Organization not found for this token', 400);
        if (existing && org.id !== existing.hubstaffOrgId)
          throw new HubstaffError(
            'A different organization cannot replace existing Hubstaff history.',
            409
          );
        const duplicate = await prisma.hubstaffConfig.findFirst({
          where: { hubstaffOrgId: org.id, subCompanyId: { not: subCompanyId } },
        });
        if (duplicate)
          throw new HubstaffError(
            'This Hubstaff organization is already connected. Map its projects to agencies from the existing connection.',
            409
          );
        const data = {
          hubstaffOrgId: org.id,
          orgName: org.name,
          orgTimezone,
          refreshToken: encryptSecret(tokens.refresh_token),
          accessToken: encryptSecret(tokens.access_token),
          accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          connectedById: req.user!.sub,
          lastSyncError: null,
          syncEnabled: true,
        };
        // A concurrent first connection fails the unique constraint instead of replacing history.
        const config = existing
          ? await prisma.hubstaffConfig.update({ where: { id: existing.id }, data })
          : await prisma.hubstaffConfig.create({ data: { ...data, subCompanyId } });
        let newLinks = 0;
        try {
          newLinks = existing
            ? await syncUserLinks(config)
            : await withHubstaffLease(config.id, locked => syncUserLinks(locked));
        } catch (err) {
          await prisma.hubstaffConfig.update({
            where: { id: config.id },
            data: {
              lastSyncError:
                err instanceof Error
                  ? err.message.slice(0, 1000)
                  : 'Member import will retry on the next sync',
            },
          });
        }
        return {
          status: 201,
          data: { connected: true, hubstaffOrgId: org.id, orgName: org.name, newLinks },
        };
      };
      // Reconnection exchanges and saves credentials under the same lease as background refresh.
      const result = existing ? await withHubstaffLease(existing.id, connect) : await connect();
      res.status(result.status).json({ data: result.data });
    } catch (err) {
      console.error('[hubstaff] connect error', err);
      res
        .status(hubstaffErrorStatus(err))
        .json({ error: err instanceof HubstaffError ? err.message : 'Failed to connect Hubstaff' });
    }
  }
);

// ── DELETE /hubstaff/disconnect ──────────────────────────────────────────────
// Stops syncing and clears credentials; organization identity and history are retained.
hubstaffRouter.delete(
  '/disconnect',
  requirePermission('hubstaff:manage'),
  async (req: Request, res: Response) => {
    const subCompanyId = await resolveAgencyScope(req);
    if (!subCompanyId) {
      res.status(400).json({ error: 'No agency context' });
      return;
    }

    try {
      const config = await prisma.hubstaffConfig.findUnique({ where: { subCompanyId } });
      if (config && !(await canManageHubstaffConnection(req, res, config))) return;
      if (!config) {
        res.status(404).json({ error: 'Hubstaff is not connected' });
        return;
      }
      await withHubstaffLease(config.id, async () => {
        await prisma.hubstaffConfig.update({
          where: { id: config.id },
          data: {
            syncEnabled: false,
            refreshToken: '',
            accessToken: null,
            accessTokenExpiresAt: null,
          },
        });
      });
      res.json({ success: true });
    } catch (err) {
      console.error('[hubstaff] disconnect error', err);
      res.status(500).json({ error: 'Failed to disconnect Hubstaff' });
    }
  }
);

// ── GET /hubstaff/members ────────────────────────────────────────────────────
// Hubstaff members + their CRM user mapping, for the Settings mapping table.
hubstaffRouter.get(
  '/members',
  requirePermission('hubstaff:manage'),
  async (req: Request, res: Response) => {
    const subCompanyId = await resolveAgencyScope(req);
    if (!subCompanyId) {
      res.status(400).json({ error: 'No agency context' });
      return;
    }

    try {
      const config = await prisma.hubstaffConfig.findUnique({ where: { subCompanyId } });
      if (config && !(await canManageHubstaffConnection(req, res, config))) return;
      if (!config) {
        res.status(404).json({ error: 'Hubstaff is not connected' });
        return;
      }

      const links = await prisma.hubstaffUserLink.findMany({
        where: { configId: config.id },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
        },
        orderBy: { hubstaffName: 'asc' },
      });
      res.json({ data: links });
    } catch (err) {
      console.error('[hubstaff] members error', err);
      res.status(500).json({ error: 'Failed to fetch Hubstaff members' });
    }
  }
);

// ── PUT /hubstaff/members/:hubstaffUserId/link ───────────────────────────────
// Body: { userId: string | null } — map or unmap a Hubstaff member.
// Re-attributes already-synced activity rows to the new user.
hubstaffRouter.put(
  '/members/:hubstaffUserId/link',
  requirePermission('hubstaff:manage'),
  async (req: Request, res: Response) => {
    const subCompanyId = await resolveAgencyScope(req);
    if (!subCompanyId) {
      res.status(400).json({ error: 'No agency context' });
      return;
    }

    const hubstaffUserId = Number(req.params.hubstaffUserId);
    if (!/^[1-9]\d*$/.test(req.params.hubstaffUserId) || !Number.isSafeInteger(hubstaffUserId)) {
      res.status(400).json({ error: 'Invalid Hubstaff user id' });
      return;
    }

    const schema = z.object({ userId: z.string().uuid().nullable() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'userId must be a user id or null' });
      return;
    }
    const userId = parsed.data.userId;

    try {
      const config = await prisma.hubstaffConfig.findUnique({ where: { subCompanyId } });
      if (config && !(await canManageHubstaffConnection(req, res, config))) return;
      if (!config) {
        res.status(404).json({ error: 'Hubstaff is not connected' });
        return;
      }

      if (userId) {
        const eligible = await eligibleHubstaffUsers(config);
        if (!eligible.some(user => user.id === userId)) {
          res
            .status(404)
            .json({ error: 'User does not have access to this connection’s agencies' });
          return;
        }
      }

      const link = await withHubstaffLease(config.id, async () =>
        prisma.$transaction(
          async tx => {
            const mappings = await tx.hubstaffProjectMapping.findMany({
              where: { configId: config.id },
              select: { subCompanyId: true },
            });
            const agencies = [
              ...new Set([subCompanyId, ...mappings.map(mapping => mapping.subCompanyId)]),
            ];
            await lockHubstaffAgencies(tx, agencies);
            const updated = await tx.hubstaffUserLink.update({
              where: { configId_hubstaffUserId: { configId: config.id, hubstaffUserId } },
              data: { userId, autoMatched: false },
              include: {
                user: {
                  select: { id: true, firstName: true, lastName: true, email: true, role: true },
                },
              },
            });

            await tx.hubstaffTaskActivity.updateMany({
              where: { configId: config.id, hubstaffUserId },
              data: { userId },
            });
            if (await tx.hubstaffTaskActivity.count({ where: { configId: config.id } })) {
              await rebuildHubstaffDaily(tx, agencies);
            } else {
              await tx.hubstaffDailyActivity.updateMany({
                where: { subCompanyId, hubstaffUserId },
                data: { userId },
              });
            }
            return updated;
          },
          { timeout: 120_000 }
        )
      );

      res.json({ data: link });
    } catch (err) {
      console.error('[hubstaff] link error', err);
      res.status(500).json({ error: 'Failed to update mapping' });
    }
  }
);

// ── POST /hubstaff/sync ──────────────────────────────────────────────────────
// Body: { startDate?, endDate? } (YYYY-MM-DD). Defaults to the last 14 days.
hubstaffRouter.post(
  '/sync',
  requirePermission('hubstaff:manage'),
  async (req: Request, res: Response) => {
    const subCompanyId = await resolveAgencyScope(req);
    if (!subCompanyId) {
      res.status(400).json({ error: 'No agency context' });
      return;
    }

    const dateStr = z.string().refine(value => {
      try {
        dateOnly(value);
        return true;
      } catch {
        return false;
      }
    });
    const schema = z.object({ startDate: dateStr.optional(), endDate: dateStr.optional() });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Dates must be YYYY-MM-DD' });
      return;
    }

    const endDate = parsed.data.endDate ?? new Date().toISOString().slice(0, 10);
    const startDate =
      parsed.data.startDate ??
      new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (
      startDate > endDate ||
      dateOnly(endDate).getTime() - dateOnly(startDate).getTime() > 1096 * 86400_000
    ) {
      res.status(400).json({ error: 'Choose a valid date range within three years' });
      return;
    }

    try {
      const config = await prisma.hubstaffConfig.findUnique({ where: { subCompanyId } });
      if (config && !(await canManageHubstaffConnection(req, res, config))) return;
      if (!config) {
        res.status(404).json({ error: 'Hubstaff is not connected' });
        return;
      }

      const result = await runHubstaffSync(config, startDate, endDate);
      res.json({ data: { ...result, startDate, endDate } });
    } catch (err) {
      console.error('[hubstaff] sync error', err);
      const message = err instanceof HubstaffError ? err.message : 'Sync failed';
      res.status(hubstaffErrorStatus(err)).json({ error: message });
    }
  }
);

// ── GET /hubstaff/time-entries ───────────────────────────────────────────────
// Query: month=YYYY-MM (default current) OR start/end=YYYY-MM-DD; userId=...
// Own data for everyone; other/all users require hubstaff:view_all.
hubstaffRouter.get('/time-entries', async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) {
    res.status(400).json({ error: 'No agency context' });
    return;
  }

  const monthSchema = z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional();
  const monthParsed = monthSchema.safeParse(req.query.month);
  const monthStr = monthParsed.success && monthParsed.data ? monthParsed.data : null;

  let from: Date;
  let to: Date;
  if (monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    from = new Date(Date.UTC(y, m - 1, 1));
    to = new Date(Date.UTC(y, m, 1));
  } else if (typeof req.query.start === 'string' && typeof req.query.end === 'string') {
    try {
      from = dateOnly(req.query.start);
      to = new Date(dateOnly(req.query.end).getTime() + 86400_000);
    } catch {
      res.status(400).json({ error: 'Dates must be valid calendar dates' });
      return;
    }
    if (from >= to) {
      res.status(400).json({ error: 'Invalid date range' });
      return;
    }
  } else {
    const now = new Date();
    from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  }

  const requestedUserId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
  const scope = typeof req.query.scope === 'string' ? req.query.scope : 'me';

  const permKeys =
    req.user!.role === 'super_admin' ? ['hubstaff:view_all'] : await ensurePermissionKeys(req);
  const canViewAll = permKeys.includes('hubstaff:view_all');

  // Default to own data; "all" scope or another user's data requires view_all
  let userFilter: { userId: string } | Record<string, never>;
  if (scope === 'all' || (requestedUserId && requestedUserId !== req.user!.sub)) {
    if (!canViewAll) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
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

hubstaffRouter.get(
  '/eligible-users',
  requirePermission('hubstaff:manage'),
  async (req: Request, res: Response) => {
    const subCompanyId = await resolveAgencyScope(req);
    if (!subCompanyId) {
      res.status(400).json({ error: 'No agency context' });
      return;
    }
    try {
      const config = await prisma.hubstaffConfig.findUnique({ where: { subCompanyId } });
      if (config && !(await canManageHubstaffConnection(req, res, config))) return;
      if (!config) {
        res.status(404).json({ error: 'Hubstaff is not connected' });
        return;
      }
      res.json({ data: await eligibleHubstaffUsers(config) });
    } catch {
      res.status(500).json({ error: 'Failed to load eligible users' });
    }
  }
);

hubstaffRouter.put(
  '/configuration',
  requirePermission('hubstaff:manage'),
  async (req: Request, res: Response) => {
    const subCompanyId = await resolveAgencyScope(req);
    if (!subCompanyId) {
      res.status(400).json({ error: 'No agency context' });
      return;
    }
    const parsed = z
      .object({
        orgTimezone: z.string().min(1).max(100),
        tasksOrganizationId: z
          .string()
          .regex(/^[1-9]\d*$/)
          .nullable()
          .optional(),
        tasksIntegrationId: z.number().int().positive().nullable().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'A valid timezone and optional Hubstaff Tasks identifiers are required' });
      return;
    }
    try {
      new Intl.DateTimeFormat('en', { timeZone: parsed.data.orgTimezone }).format();
    } catch {
      res.status(400).json({ error: 'Invalid Hubstaff organization timezone' });
      return;
    }
    if (Boolean(parsed.data.tasksOrganizationId) !== Boolean(parsed.data.tasksIntegrationId)) {
      res.status(400).json({
        error: 'Provide both the Hubstaff Tasks organization and its Time Tracking integration ID',
      });
      return;
    }
    try {
      const config = await prisma.hubstaffConfig.findUnique({ where: { subCompanyId } });
      if (config && !(await canManageHubstaffConnection(req, res, config))) return;
      if (!config) {
        res.status(404).json({ error: 'Hubstaff is not connected' });
        return;
      }
      await withHubstaffLease(config.id, async () => {
        await prisma.hubstaffConfig.update({
          where: { id: config.id },
          data: { ...parsed.data, taskSyncStatus: 'unknown', taskSyncError: null },
        });
      });
      res.json({ success: true });
    } catch (err) {
      res.status(hubstaffErrorStatus(err)).json({
        error:
          err instanceof HubstaffError ? err.message : 'Failed to update Hubstaff configuration',
      });
    }
  }
);

hubstaffRouter.get(
  '/projects',
  requirePermission('hubstaff:manage'),
  async (req: Request, res: Response) => {
    const subCompanyId = await resolveAgencyScope(req);
    if (!subCompanyId) {
      res.status(400).json({ error: 'No agency context' });
      return;
    }
    try {
      const config = await prisma.hubstaffConfig.findUnique({ where: { subCompanyId } });
      if (config && !(await canManageHubstaffConnection(req, res, config))) return;
      if (!config) {
        res.status(404).json({ error: 'Hubstaff is not connected' });
        return;
      }
      const allowed = await resolveAllowedSubCompanyIds(req.user!, req);
      const [projects, agencies] = await Promise.all([
        prisma.hubstaffProjectMapping.findMany({
          where: { configId: config.id, subCompanyId: { in: allowed } },
          orderBy: { projectName: 'asc' },
        }),
        prisma.subCompany.findMany({
          where: { id: { in: allowed } },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
      ]);
      res.json({ data: projects, agencies });
    } catch {
      res.status(500).json({ error: 'Failed to load Hubstaff projects' });
    }
  }
);

hubstaffRouter.put(
  '/projects/:projectId',
  requirePermission('hubstaff:manage'),
  async (req: Request, res: Response) => {
    const subCompanyId = await resolveAgencyScope(req);
    if (!subCompanyId) {
      res.status(400).json({ error: 'No agency context' });
      return;
    }
    const projectId = Number(req.params.projectId);
    const parsed = z
      .object({
        subCompanyId: z.string().uuid(),
        workProfile: z.enum(['software', 'marketing_sales', 'recruitment', 'general']).nullable(),
        internal: z.boolean(),
      })
      .safeParse(req.body);
    if (!parsed.success || !Number.isSafeInteger(projectId) || projectId <= 0) {
      res.status(400).json({ error: 'Invalid project mapping' });
      return;
    }
    try {
      const allowed = await resolveAllowedSubCompanyIds(req.user!, req);
      if (!allowed.includes(parsed.data.subCompanyId)) {
        res.status(403).json({ error: 'You cannot map projects to this agency' });
        return;
      }
      const config = await prisma.hubstaffConfig.findUnique({ where: { subCompanyId } });
      if (config && !(await canManageHubstaffConnection(req, res, config))) return;
      if (!config) {
        res.status(404).json({ error: 'Hubstaff is not connected' });
        return;
      }
      const mapping = await prisma.hubstaffProjectMapping.findUnique({
        where: {
          configId_hubstaffProjectId: { configId: config.id, hubstaffProjectId: projectId },
        },
      });
      if (!mapping || !allowed.includes(mapping.subCompanyId)) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      const result = await withHubstaffLease(config.id, async () =>
        prisma.$transaction(
          async tx => {
            const agencies = [...new Set([mapping.subCompanyId, parsed.data.subCompanyId])];
            await lockHubstaffAgencies(tx, agencies);
            const updated = await tx.hubstaffProjectMapping.update({
              where: { id: mapping.id },
              data: parsed.data,
            });
            await tx.hubstaffTaskActivity.updateMany({
              where: { configId: config.id, hubstaffProjectId: projectId },
              data: { subCompanyId: parsed.data.subCompanyId },
            });
            if (await tx.hubstaffTaskActivity.count({ where: { configId: config.id } }))
              await rebuildHubstaffDaily(tx, agencies);
            else
              await tx.hubstaffDailyActivity.updateMany({
                where: { subCompanyId: mapping.subCompanyId, hubstaffProjectId: projectId },
                data: { subCompanyId: parsed.data.subCompanyId },
              });
            return updated;
          },
          { timeout: 120_000 }
        )
      );
      res.json({ data: result });
    } catch (err) {
      res.status(hubstaffErrorStatus(err)).json({
        error: err instanceof HubstaffError ? err.message : 'Failed to update project mapping',
      });
    }
  }
);
