/**
 * Email Campaigns API: list, create, update, delete campaigns and fetch recipients.
 * Scoped to subCompanyId. Elevated roles can see across agencies.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { CampaignStatus } from '@prisma/client';
import prisma from '../config/database';
import type { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { authenticate } from '../middleware/auth';
import { actAsMiddleware, effectiveActorId } from '../middleware/actAs';
import { requirePermission } from '../middleware/requirePermission';
import {
  resolveAllowedSubCompanyIds,
  parseAgencyIdsParam,
  buildSubCompanyFilter,
  resolveAgencyScope,
} from '../config/agencyScope';
import { requestCanUseOwnerIdsFilter } from '../services/accessContext';
import { expandLinkedOwnerScope, linkedExpansionToWhere, ownerExactFromQuery } from '../services/linkedOwnerExpand';
import { sendCampaignById } from '../services/campaignSender';
import { recomputeCampaignStats } from '../services/campaignStats';
import { applyCampaignDateRange, filterInstantSchema, refineFromBeforeTo } from '../services/campaignDateFilter';

const listQuerySchema = z
  .object({
    // page is capped so `skip` can never overflow Postgres' Int32 (Express 4 has no async error wrapper).
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).default(20).transform((n) => Math.min(n, 100)),
    status: z.nativeEnum(CampaignStatus).optional(),
    subCompanyId: z.string().uuid().optional(),
    agencyIds: z.string().optional(),
    ownerIds: z.string().optional(),
    // Inclusive instants; the client sends its local day edges as ISO strings. Either may be omitted.
    from: filterInstantSchema.optional(),
    to: filterInstantSchema.optional(),
  })
  .superRefine(refineFromBeforeTo);

const createBodySchema = z.object({
  name: z.string().min(1).max(255),
  listId: z.string().min(1).max(255),
  listName: z.string().min(1).max(255),
  subject: z.string().min(1).max(500),
  body: z.string().min(1),
  templateId: z.string().optional().nullable(),
  scheduledDate: z.string().datetime().optional(),
});

const updateBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  listId: z.string().min(1).max(255).optional(),
  listName: z.string().min(1).max(255).optional(),
  subject: z.string().min(1).max(500).optional(),
  body: z.string().optional(),
  templateId: z.string().optional().nullable(),
  scheduledDate: z.string().datetime().optional(),
  status: z.nativeEnum(CampaignStatus).optional(),
});

export const campaignsRouter = Router();
campaignsRouter.use(authenticate);
campaignsRouter.use(actAsMiddleware);

function formatCampaign(c: {
  id: string; subCompanyId: string; name: string; listId: string; listName: string;
  subject: string; body: string; templateId: string | null; scheduledDate: Date;
  sentAt: Date | null; status: CampaignStatus; totalRecipients: number;
  statsSent: number; statsDelivered: number; statsOpened: number;
  statsClicked: number; statsBounced: number; statsFailed: number; createdAt: Date;
}) {
  return {
    id: c.id,
    subCompanyId: c.subCompanyId,
    name: c.name,
    listId: c.listId,
    listName: c.listName,
    subject: c.subject,
    body: c.body,
    templateId: c.templateId,
    scheduledDate: c.scheduledDate,
    sentAt: c.sentAt,
    status: c.status,
    totalRecipients: c.totalRecipients,
    createdAt: c.createdAt,
    stats: {
      sent: c.statsSent,
      delivered: c.statsDelivered,
      opened: c.statsOpened,
      clicked: c.statsClicked,
      bounced: c.statsBounced,
      failed: c.statsFailed,
    },
  };
}

/** GET /campaigns — list, scoped to agency */
campaignsRouter.get('/', requirePermission('clients:read'), async (req: Request, res: Response) => {
  const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
  if (allowedIds.length === 0) return res.status(403).json({ error: 'Agency context required' });

  // An invalid query is a 400, never a silent fallback to defaults: falling back used to drop
  // ownerIds / agency / status and widen the result set beyond what the caller asked for.
  // Empty values (`?limit=&from=`) mean "absent".
  const cleanedQuery = Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== ''));
  const parsed = listQuerySchema.safeParse(cleanedQuery);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
  const q = parsed.data;
  const requestedIds = parseAgencyIdsParam(q.agencyIds ?? q.subCompanyId);
  const scopeFilter = buildSubCompanyFilter(allowedIds, requestedIds);

  const where: Prisma.EmailCampaignWhereInput = { ...scopeFilter };
  if (q.status) where.status = q.status;

  const ownerIdsList = q.ownerIds
    ? q.ownerIds.split(',').filter((id) => /^[0-9a-f-]{36}$/i.test(id))
    : [];
  if (ownerIdsList.length > 0) {
    const linked = await expandLinkedOwnerScope(req.user!.sub, req.user!.subCompanyId, ownerIdsList, { exact: ownerExactFromQuery(req.query) });
    if (linked) {
      Object.assign(where, linkedExpansionToWhere(linked, 'createdById'));
    } else {
      const canFilter = await requestCanUseOwnerIdsFilter(req);
      if (canFilter) {
        where.createdById = { in: ownerIdsList };
      }
    }
  }

  // Date range is ANDed after the owner logic so it never overwrites an owner-scope OR.
  const range = { from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined };
  if ((range.from && Number.isNaN(range.from.getTime())) || (range.to && Number.isNaN(range.to.getTime()))) {
    return res.status(400).json({ error: 'Invalid query', details: { fieldErrors: { from: ['Invalid date'] } } });
  }
  applyCampaignDateRange(where, range);

  const skip = (q.page - 1) * q.limit;
  // Express 4 does not forward a rejected async handler to the error middleware: an uncaught Prisma error here
  // would be an unhandled rejection (hung request / process exit on Node 22), so answer it explicitly.
  try {
    const [rows, total] = await Promise.all([
      // id tiebreaker keeps offset paging stable when createdAt ties.
      prisma.emailCampaign.findMany({ where, skip, take: q.limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      prisma.emailCampaign.count({ where }),
    ]);

    return res.json({
      data: rows.map(formatCampaign),
      pagination: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
    });
  } catch (error) {
    console.error('[campaigns] List failed:', error);
    return res.status(500).json({ error: 'Unable to load campaigns' });
  }
});

/** GET /campaigns/:id */
campaignsRouter.get('/:id', requirePermission('clients:read'), async (req: Request, res: Response) => {
  const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
  if (allowedIds.length === 0) return res.status(403).json({ error: 'Agency context required' });
  const campaign = await prisma.emailCampaign.findFirst({
    where: { id: req.params.id, subCompanyId: { in: allowedIds } },
  });
  if (!campaign) return res.status(404).json({ error: 'Not found' });

  return res.json(formatCampaign(campaign));
});

/** GET /campaigns/:id/recipients */
campaignsRouter.get('/:id/recipients', requirePermission('clients:read'), async (req: Request, res: Response) => {
  const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
  if (allowedIds.length === 0) return res.status(403).json({ error: 'Agency context required' });
  const campaign = await prisma.emailCampaign.findFirst({
    where: { id: req.params.id, subCompanyId: { in: allowedIds } },
  });
  if (!campaign) return res.status(404).json({ error: 'Not found' });

  const recipients = await prisma.emailCampaignRecipient.findMany({
    where: { campaignId: req.params.id },
    orderBy: { sentAt: 'asc' },
  });

  return res.json({ data: recipients });
});

/** POST /campaigns — create as draft */
campaignsRouter.post('/', requirePermission('clients:write'), async (req: Request, res: Response) => {
  const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
  if (allowedIds.length === 0) return res.status(403).json({ error: 'Agency context required' });

  const parsed = createBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId || !allowedIds.includes(subCompanyId)) {
    return res.status(403).json({ error: 'Agency context required' });
  }

  const scheduledDate = parsed.data.scheduledDate ? new Date(parsed.data.scheduledDate) : new Date();
  const status: CampaignStatus = parsed.data.scheduledDate && scheduledDate > new Date() ? 'scheduled' : 'draft';

  const campaign = await prisma.emailCampaign.create({
    data: {
      ...parsed.data,
      scheduledDate,
      status,
      subCompanyId,
      createdById: effectiveActorId(req),
    },
  });

  return res.status(201).json(formatCampaign(campaign));
});

/** PATCH /campaigns/:id — update draft/scheduled only */
campaignsRouter.patch('/:id', requirePermission('clients:write'), async (req: Request, res: Response) => {
  const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
  if (allowedIds.length === 0) return res.status(403).json({ error: 'Agency context required' });

  const parsed = updateBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  const existing = await prisma.emailCampaign.findFirst({
    where: { id: req.params.id, subCompanyId: { in: allowedIds } },
  });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!['draft', 'scheduled'].includes(existing.status)) {
    return res.status(400).json({ error: 'Only draft or scheduled campaigns can be edited' });
  }

  const data: Prisma.EmailCampaignUpdateInput = { ...parsed.data };
  if (parsed.data.scheduledDate) data.scheduledDate = new Date(parsed.data.scheduledDate);

  const updated = await prisma.emailCampaign.update({ where: { id: req.params.id }, data });
  return res.json(formatCampaign(updated));
});

/** DELETE /campaigns/:id — draft only */
campaignsRouter.delete('/:id', requirePermission('clients:write'), async (req: Request, res: Response) => {
  const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
  if (allowedIds.length === 0) return res.status(403).json({ error: 'Agency context required' });
  const existing = await prisma.emailCampaign.findFirst({
    where: { id: req.params.id, subCompanyId: { in: allowedIds } },
  });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.status !== 'draft') {
    return res.status(400).json({ error: 'Only draft campaigns can be deleted' });
  }

  await prisma.emailCampaign.delete({ where: { id: req.params.id } });
  return res.json({ success: true });
});

/** GET /campaigns/:id/refresh-stats — re-aggregate from per-recipient state */
campaignsRouter.get('/:id/refresh-stats', requirePermission('clients:read'), async (req: Request, res: Response) => {
  const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
  if (allowedIds.length === 0) return res.status(403).json({ error: 'Agency context required' });
  const campaign = await prisma.emailCampaign.findFirst({
    where: { id: req.params.id, subCompanyId: { in: allowedIds } },
  });
  if (!campaign) return res.status(404).json({ error: 'Not found' });
  if (campaign.status !== 'sent' || !campaign.sentAt) {
    return res.status(400).json({ error: 'Campaign has not been sent yet' });
  }

  await recomputeCampaignStats(campaign.id);
  const updated = await prisma.emailCampaign.findUnique({ where: { id: campaign.id } });
  if (!updated) return res.status(404).json({ error: 'Not found' });

  return res.json(formatCampaign(updated));
});

/** POST /campaigns/:id/send — manually send a draft/scheduled campaign now */
campaignsRouter.post('/:id/send', requirePermission('clients:write'), async (req: Request, res: Response) => {
  const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
  if (allowedIds.length === 0) return res.status(403).json({ error: 'Agency context required' });
  if (!env.SENDGRID_API_KEY) {
    return res.status(503).json({ error: 'Email sending is not configured' });
  }
  const campaign = await prisma.emailCampaign.findFirst({
    where: { id: req.params.id, subCompanyId: { in: allowedIds } },
  });
  if (!campaign) return res.status(404).json({ error: 'Not found' });
  if (!['draft', 'scheduled'].includes(campaign.status)) {
    return res.status(400).json({ error: 'Campaign already sent or is sending' });
  }

  // Verify the mailing list still exists before sending
  const list = await prisma.mailingList.findFirst({ where: { id: campaign.listId } });
  if (!list) {
    return res.status(400).json({ error: 'The mailing list attached to this campaign no longer exists. Please create a new campaign with an active list.' });
  }

  const result = await sendCampaignById(req.params.id);
  if (!result.success) return res.status(400).json({ error: result.error });

  const updated = await prisma.emailCampaign.findUnique({ where: { id: req.params.id } });
  return res.json(updated ? formatCampaign(updated) : { success: true });
});

