import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { resolveAllowedSubCompanyIds } from '../config/agencyScope';
import prisma from '../config/database';
import {
  createLeadReassignmentRequest,
  createSuperUserReassignment,
  getPendingReassignmentRequests,
  getMyReassignmentRequests,
  getAllReassignmentRequests,
  getLeadReassignmentHistory,
  cancelReassignmentRequest,
} from '../services/leadReassignment';
import { performApprovalAction } from '../services/approvalActions';
import { ensureAccessContext } from '../utils/requestPermission';
import { actAsMiddleware, effectiveActorId } from '../middleware/actAs';

const createSchema = z.object({
  leadId: z.string().uuid(),
  proposedOwnerId: z.string().uuid(),
  numberOfPositions: z.number().int().positive().optional().nullable(),
});

const superUserSchema = z.object({
  leadId: z.string().uuid(),
  proposedOwnerId: z.string().uuid(),
  numberOfPositions: z.number().int().positive().optional().nullable(),
});

export const leadReassignmentRequestsRouter = Router();
leadReassignmentRequestsRouter.use(authenticate);
leadReassignmentRequestsRouter.use(actAsMiddleware);

function serviceError(err: unknown): { status: number; message: string } {
  const e = err as { statusCode?: number; message?: string };
  return { status: e.statusCode ?? 500, message: e.message ?? 'Internal server error' };
}

async function resolveLeadAgencyForRequester(leadId: string, req: Request): Promise<string> {
  if (!req.user?.subCompanyId) {
    throw Object.assign(new Error('Agency context required'), { statusCode: 403 });
  }
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { subCompanyId: true },
  });
  if (!lead) throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
  const allowedIds = await resolveAllowedSubCompanyIds(req.user);
  if (!allowedIds.includes(lead.subCompanyId)) {
    throw Object.assign(new Error('Lead does not belong to an agency you can access'), { statusCode: 403 });
  }
  return lead.subCompanyId;
}

/** POST / — initiate a reassignment request */
leadReassignmentRequestsRouter.post(
  '/',
  requirePermission('leads:reassign'),
  async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });

    try {
      const subCompanyId = await resolveLeadAgencyForRequester(parsed.data.leadId, req);
      const request = await createLeadReassignmentRequest(
        parsed.data.leadId,
        parsed.data.proposedOwnerId,
        effectiveActorId(req),
        subCompanyId,
        parsed.data.numberOfPositions,
      );
      return res.status(201).json(request);
    } catch (err) {
      const { status, message } = serviceError(err);
      return res.status(status).json({ error: message });
    }
  }
);

/** POST /super-user — Case 2: super user reassigns immediately (no approval) */
leadReassignmentRequestsRouter.post(
  '/super-user',
  requirePermission('leads:reassign_approve'),
  async (req: Request, res: Response) => {
    const parsed = superUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });

    try {
      const subCompanyId = await resolveLeadAgencyForRequester(parsed.data.leadId, req);
      const result = await createSuperUserReassignment(
        parsed.data.leadId,
        parsed.data.proposedOwnerId,
        effectiveActorId(req),
        subCompanyId,
        parsed.data.numberOfPositions,
      );
      return res.status(201).json(result);
    } catch (err) {
      const { status, message } = serviceError(err);
      return res.status(status).json({ error: message });
    }
  }
);

/** GET / — my requests (as requester) */
leadReassignmentRequestsRouter.get(
  '/',
  requirePermission('leads:reassign'),
  async (req: Request, res: Response) => {
    if (!req.user?.subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    try {
      const allowedIds = await resolveAllowedSubCompanyIds(req.user);
      const requests = await getMyReassignmentRequests(effectiveActorId(req), allowedIds);
      return res.json(requests);
    } catch (err) {
      const { status, message } = serviceError(err);
      return res.status(status).json({ error: message });
    }
  }
);

/** GET /pending — Director's approval queue */
leadReassignmentRequestsRouter.get(
  '/pending',
  requirePermission('leads:reassign_approve'),
  async (req: Request, res: Response) => {
    if (!req.user?.subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    try {
      const allowedIds = await resolveAllowedSubCompanyIds(req.user);
      const requests = await getPendingReassignmentRequests(allowedIds);
      return res.json(requests);
    } catch (err) {
      const { status, message } = serviceError(err);
      return res.status(status).json({ error: message });
    }
  }
);

/** GET /lead/:leadId — history for a specific lead */
leadReassignmentRequestsRouter.get(
  '/lead/:leadId',
  requirePermission('leads:read'),
  async (req: Request, res: Response) => {
    try {
      const history = await getLeadReassignmentHistory(req.params.leadId);
      return res.json(history);
    } catch (err) {
      const { status, message } = serviceError(err);
      return res.status(status).json({ error: message });
    }
  }
);

/** PATCH /:id/approve — approve via approval chain */
leadReassignmentRequestsRouter.patch('/:id/approve', async (req: Request, res: Response) => {
  try {
    if (!req.user?.subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    const ctx = await ensureAccessContext(req);
    if (!ctx) return res.status(403).json({ error: 'Forbidden' });

    const result = await performApprovalAction({
      workflow: 'lead_reassignment',
      entityId: req.params.id,
      subCompanyId: req.user.subCompanyId,
      actorUserId: req.user.sub,
      actorRoleKey: ctx.roleKey,
      actorPermissions: ctx.permissions,
      action: 'approve',
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json({ success: true });
  } catch (err) {
    const { status, message } = serviceError(err);
    return res.status(status).json({ error: message });
  }
});

/** PATCH /:id/reject — reject via approval chain */
leadReassignmentRequestsRouter.patch('/:id/reject', async (req: Request, res: Response) => {
  try {
    if (!req.user?.subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    const ctx = await ensureAccessContext(req);
    if (!ctx) return res.status(403).json({ error: 'Forbidden' });

    const result = await performApprovalAction({
      workflow: 'lead_reassignment',
      entityId: req.params.id,
      subCompanyId: req.user.subCompanyId,
      actorUserId: req.user.sub,
      actorRoleKey: ctx.roleKey,
      actorPermissions: ctx.permissions,
      action: 'reject',
      remarks: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json({ success: true });
  } catch (err) {
    const { status, message } = serviceError(err);
    return res.status(status).json({ error: message });
  }
});

/** GET /all — super-user history view */
leadReassignmentRequestsRouter.get(
  '/all',
  requirePermission('leads:reassign_approve'),
  async (req: Request, res: Response) => {
    if (!req.user?.subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    try {
      const allowedIds = await resolveAllowedSubCompanyIds(req.user);
      const requests = await getAllReassignmentRequests(allowedIds);
      return res.json(requests);
    } catch (err) {
      const { status, message } = serviceError(err);
      return res.status(status).json({ error: message });
    }
  }
);

/** DELETE /:id — requester cancels their own pending request */
leadReassignmentRequestsRouter.delete(
  '/:id',
  requirePermission('leads:reassign'),
  async (req: Request, res: Response) => {
    try {
      await cancelReassignmentRequest(req.params.id, effectiveActorId(req));
      return res.json({ success: true });
    } catch (err) {
      const { status, message } = serviceError(err);
      return res.status(status).json({ error: message });
    }
  }
);
