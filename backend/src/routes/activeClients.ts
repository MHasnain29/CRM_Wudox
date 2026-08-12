/**
 * Recruitment Active Clients API — /api/v1/active-clients
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { actAsMiddleware, effectiveActorId } from '../middleware/actAs';
import { requirePermission } from '../middleware/requirePermission';
import { resolveListAgencyScope, resolveAgencyScope } from '../config/agencyScope';
import { resolveRecruitmentOwnerWhere } from '../services/recruitmentOwnerScope';
import {
  listActiveClients,
  getActiveClientById,
  createActiveClient,
  updateActiveClient,
  deleteActiveClient,
} from '../services/activeClients';
import { getActiveClientTrainingDocumentBuffer } from '../services/activeClientTraining';
import { ACTIVE_CLIENT_TRAINING_PANDA_TEMPLATES } from '../services/activeClientTrainingTemplates';

export const activeClientsRouter = Router();
activeClientsRouter.use(authenticate);
activeClientsRouter.use(actAsMiddleware);

/** Fixed allowlist of PandaDoc templates for Client training. */
activeClientsRouter.get(
  '/training-templates',
  requirePermission('jobs:read'),
  (_req: Request, res: Response) => {
    res.json({ data: ACTIVE_CLIENT_TRAINING_PANDA_TEMPLATES });
  },
);

const inputSchema = z.object({
  name: z.string().min(1).max(255),
  industry: z.string().min(1).max(255),
  location: z.string().min(1).max(255),
  contactName: z.string().min(1).max(255),
  contactEmail: z.string().email().max(255),
  contactPhone: z.string().min(1).max(50),
  status: z.enum(['active', 'inactive']).optional(),
  notes: z.string().max(5000).optional().nullable(),
  clientTraining: z.boolean().optional(),
  trainingFileBase64: z.string().min(1).optional().nullable(),
  trainingFileName: z.string().min(1).max(255).optional().nullable(),
  trainingMimeType: z.string().max(128).optional().nullable(),
  trainingPandaDocTemplateId: z.string().min(1).max(128).optional().nullable(),
});

const patchSchema = inputSchema.partial();

activeClientsRouter.get('/', requirePermission('jobs:read'), async (req: Request, res: Response) => {
  try {
    const scope = await resolveListAgencyScope(req, req.query.agencyIds as string | undefined);
    if (!scope?.allowedIds.length) {
      res.json({ data: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const status =
      req.query.status === 'active' || req.query.status === 'inactive'
        ? req.query.status
        : undefined;
    const page = req.query.page ? Number(req.query.page) : 1;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 50;
    const ownerWhere = await resolveRecruitmentOwnerWhere(req, 'createdById', scope.allowedIds);
    const result = await listActiveClients({
      agencyIds: scope.allowedIds,
      search,
      status,
      page,
      pageSize,
      ownerWhere,
    });
    res.json(result);
  } catch (err) {
    console.error('[activeClients] list', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

activeClientsRouter.get(
  '/:id/training-document',
  requirePermission('jobs:read', 'employees:read'),
  async (req: Request, res: Response) => {
    try {
      const scope = await resolveListAgencyScope(req);
      if (!scope?.allowedIds.length) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const file = await getActiveClientTrainingDocumentBuffer(req.params.id, scope.allowedIds);
      if (!file) {
        res.status(404).json({ error: 'Training document not found' });
        return;
      }
      res.setHeader('Content-Type', file.contentType);
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(file.fileName)}"`,
      );
      res.send(file.body);
    } catch (err) {
      console.error('[activeClients] training-document', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

activeClientsRouter.get('/:id', requirePermission('jobs:read'), async (req: Request, res: Response) => {
  try {
    const scope = await resolveListAgencyScope(req);
    if (!scope?.allowedIds.length) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const row = await getActiveClientById(req.params.id, scope.allowedIds);
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(row);
  } catch (err) {
    console.error('[activeClients] get', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

activeClientsRouter.post('/', requirePermission('jobs:write'), async (req: Request, res: Response) => {
  try {
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
      return;
    }
    const agencyId = await resolveAgencyScope(req);
    if (!agencyId) {
      res.status(400).json({ error: 'No agency context' });
      return;
    }
    const actorId = effectiveActorId(req) ?? req.user!.sub;
    const row = await createActiveClient({
      input: parsed.data,
      subCompanyId: agencyId,
      createdById: actorId,
    });
    res.status(201).json(row);
  } catch (err) {
    const status =
      (err as { status?: number }).status ?? (err as { statusCode?: number }).statusCode;
    const message = err instanceof Error ? err.message : 'Internal server error';
    if (status && status >= 400 && status < 500) {
      res.status(status).json({ error: message });
      return;
    }
    console.error('[activeClients] create', err);
    res.status(500).json({ error: message || 'Internal server error' });
  }
});

activeClientsRouter.patch('/:id', requirePermission('jobs:write'), async (req: Request, res: Response) => {
  try {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
      return;
    }
    const scope = await resolveListAgencyScope(req);
    if (!scope?.allowedIds.length) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const row = await updateActiveClient(req.params.id, scope.allowedIds, parsed.data);
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(row);
  } catch (err) {
    const status =
      (err as { status?: number }).status ?? (err as { statusCode?: number }).statusCode;
    const message = err instanceof Error ? err.message : 'Internal server error';
    if (status && status >= 400 && status < 500) {
      res.status(status).json({ error: message });
      return;
    }
    console.error('[activeClients] update', err);
    res.status(500).json({ error: message || 'Internal server error' });
  }
});

activeClientsRouter.delete('/:id', requirePermission('jobs:write'), async (req: Request, res: Response) => {
  try {
    const scope = await resolveListAgencyScope(req);
    if (!scope?.allowedIds.length) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const result = await deleteActiveClient(req.params.id, scope.allowedIds);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[activeClients] delete', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
