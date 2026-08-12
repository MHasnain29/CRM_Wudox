import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { LeadRequestStatus } from '@prisma/client';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { attachAccessContext, ensureAccessContext, requestHasPermission } from '../utils/requestPermission';
import { canAccessMultipleAgencies } from '../services/accessContext';
import { resolveAgencyScope } from '../config/agencyScope';
import { actAsMiddleware, effectiveActorId } from '../middleware/actAs';
import { dispatchNotificationToUser } from '../services/notificationDispatch';
import { getApprovalEventKey } from '../services/notificationRegistry';
import { createActivityLog } from '../services/activityLog';
import {
  sendLeadRequestedEmail,
  sendLeadRequestRejectedEmail,
  getAgencyBranding,
  fetchClientDetailsForEmail,
} from '../services/email';
import { env } from '../config/env';
import { emitToUsers } from '../socket';
import {
  notifyChainTargetUsers,
  performApprovalAction,
  submitEntityForApproval,
} from '../services/approvalActions';

const listQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  subCompanyId: z.string().uuid().optional(),
  requestedByIds: z.string().optional(), // comma-separated UUIDs — for cross-agency linked-user scope
});

const createBodySchema = z.object({
  clientId: z.string().uuid(),
  managerId: z.string().uuid(),
  note: z.string().min(1).max(10000),
});

const approveBodySchema = z.object({
  comments: z.string().max(5000).optional(),
});

const rejectBodySchema = z.object({
  comments: z.string().min(1).max(5000),
});

export const leadRequestsRouter = Router();
leadRequestsRouter.use(authenticate);
leadRequestsRouter.use(actAsMiddleware);
leadRequestsRouter.use(attachAccessContext);
leadRequestsRouter.use(requirePermission('leads:read'));

async function getDisplayName(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true },
  });
  if (!u) return 'Unknown';
  return `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email || 'Unknown';
}

/** GET /lead-requests — list lead requests. Elevated scope without subCompanyId sees all (or all managed); others agency-scoped. */
leadRequestsRouter.get('/', async (req: Request, res: Response) => {
  const querySub = typeof req.query?.subCompanyId === 'string' ? req.query.subCompanyId.trim() : undefined;
  const ctx = await ensureAccessContext(req);
  const elevated = ctx ? canAccessMultipleAgencies(ctx) : false;
  const isGlobalElevated =
    elevated && (ctx!.scopeLevel === 'global' || ctx!.permissions.includes('agencies:global'));

  let whereSub: string | { in: string[] } | undefined;

  if (elevated && !querySub) {
    if (!isGlobalElevated) {
      const managed = await prisma.operationsManagerSubCompany.findMany({
        where: { userId: req.user!.sub },
        select: { subCompanyId: true },
      });
      const managedIds = managed.map((m) => m.subCompanyId);
      if (managedIds.length === 0) {
        // Fall back to own agency if no managed agencies configured
        const ownSubId = req.user!.subCompanyId;
        if (!ownSubId) return res.json({ data: [] });
        whereSub = ownSubId;
      } else {
        whereSub = { in: managedIds };
      }
    } else {
      // super_admin / director: no subCompanyId filter
      whereSub = undefined;
    }
  } else {
    const subCompanyId = (await resolveAgencyScope(req)) ?? req.user!.subCompanyId;
    if (!subCompanyId) {
      return res.status(403).json({ error: 'Agency context required' });
    }
    whereSub = subCompanyId;
  }

  const parsed = listQuerySchema.safeParse(req.query);
  const status = parsed.success && parsed.data.status ? parsed.data.status : undefined;
  const requestedByIdsParam = parsed.success && parsed.data.requestedByIds ? parsed.data.requestedByIds : undefined;

  const where: { subCompanyId?: string | { in: string[] }; status?: LeadRequestStatus; requestedById?: string | { in: string[] } } = {};
  if (whereSub !== undefined) where.subCompanyId = whereSub;
  if (status) where.status = status as LeadRequestStatus;

  const canReviewAll = await requestHasPermission(req, 'leads:assign');
  if (!canReviewAll) {
    if (requestedByIdsParam) {
      // Cross-agency linked-user scope: validate all IDs are in the caller's link group
      const requestedIds = requestedByIdsParam.split(',').filter((id) => /^[0-9a-f-]{36}$/i.test(id));
      const callerLink = await prisma.userAgencyLink.findFirst({
        where: { userId: req.user!.sub },
        select: { groupId: true },
      });
      let allowedIds: string[];
      if (callerLink) {
        const groupMembers = await prisma.userAgencyLink.findMany({
          where: { groupId: callerLink.groupId },
          select: { userId: true },
        });
        const groupMemberSet = new Set([...groupMembers.map((m) => m.userId), req.user!.sub]);
        allowedIds = requestedIds.filter((id) => groupMemberSet.has(id));
      } else {
        allowedIds = [req.user!.sub];
      }
      if (allowedIds.length === 0) allowedIds = [req.user!.sub];
      // Remove subCompanyId restriction — linked users may span agencies
      delete where.subCompanyId;
      where.requestedById = allowedIds.length === 1 ? allowedIds[0] : { in: allowedIds };
    } else {
      where.requestedById = effectiveActorId(req);
    }
  } else if (requestedByIdsParam) {
    // Elevated reviewers already see all requests; still honor filter scope
    // (All Agencies + specific team member, per-user sections, etc.)
    const requestedIds = requestedByIdsParam.split(',').filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (requestedIds.length === 1) {
      where.requestedById = requestedIds[0];
    } else if (requestedIds.length > 1) {
      where.requestedById = { in: requestedIds };
    }
  }

  const list = await prisma.leadRequest.findMany({
    where,
    orderBy: { requestedAt: 'desc' },
    include: {
      client: { select: { id: true, name: true } },
      requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      manager: { select: { id: true, firstName: true, lastName: true, email: true } },
      reviewedBy: { select: { id: true, firstName: true, lastName: true } },
      comments: { orderBy: { createdAt: 'asc' } },
    },
  });

  const data = list.map((lr) => ({
    id: lr.id,
    clientId: lr.clientId,
    clientName: lr.client.name,
    primaryContactName: lr.client.name,
    requestedBy: lr.requestedById,
    requestedByName: `${lr.requestedBy.firstName} ${lr.requestedBy.lastName}`.trim(),
    managerId: lr.managerId,
    managerName: `${lr.manager.firstName} ${lr.manager.lastName}`.trim(),
    note: lr.note,
    requestedAt: lr.requestedAt,
    status: lr.status,
    reviewedBy: lr.reviewedById ?? undefined,
    reviewedByName: lr.reviewedBy ? `${lr.reviewedBy.firstName} ${lr.reviewedBy.lastName}`.trim() : undefined,
    reviewedAt: lr.reviewedAt ?? undefined,
    subCompanyId: lr.subCompanyId,
    comments: lr.comments.map((c) => ({
      id: c.id,
      userId: c.userId,
      userName: c.userName,
      text: c.text,
      createdAt: c.createdAt,
    })),
  }));

  return res.json({ data });
});

/** POST /lead-requests — create a lead request (associate requests lead from manager) */
leadRequestsRouter.post('/', requirePermission('leads:write'), async (req: Request, res: Response) => {
  const subCompanyId = req.user?.subCompanyId;
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const parsed = createBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }
  const { clientId, managerId, note } = parsed.data;

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const manager = await prisma.user.findFirst({
    where: { id: managerId, subCompanyId, isActive: true },
  });
  if (!manager) return res.status(400).json({ error: 'Manager must be an active user in your agency' });

  const requesterId = effectiveActorId(req);
  const requesterDisplayName = await getDisplayName(requesterId);
  const existing = await prisma.leadRequest.findFirst({
    where: { clientId, subCompanyId, requestedById: requesterId, status: 'pending' },
  });
  if (existing) {
    return res.status(409).json({ error: 'You already have a pending lead request for this client' });
  }

  const lockedLeadForRequester = await prisma.lead.findFirst({
    where: {
      clientId,
      subCompanyId,
      reassignmentLocked: true,
      lockedAssociateId: requesterId,
    },
    select: { id: true },
  });
  if (lockedLeadForRequester) {
    return res.status(409).json({ error: 'You cannot reclaim this lead. Ask a manager for reassignment.' });
  }

  const lr = await prisma.leadRequest.create({
    data: {
      clientId,
      requestedById: requesterId,
      managerId,
      note: note.trim(),
      status: 'pending',
      subCompanyId,
      currentStepIndex: 0,
      approvalChain: [],
    },
    include: {
      client: { select: { id: true, name: true } },
      requestedBy: { select: { id: true, firstName: true, lastName: true } },
      manager: { select: { id: true, firstName: true, lastName: true } },
      comments: true,
    },
  });

  await prisma.leadRequestComment.create({
    data: {
      requestId: lr.id,
      userId: requesterId,
      userName: requesterDisplayName,
      text: note.trim(),
    },
  });

  const submitCtx = await ensureAccessContext(req);
  const approval = await submitEntityForApproval({
    workflow: 'lead_request',
    entityId: lr.id,
    subCompanyId,
    submitterUserId: requesterId,
    submitterRoleKey: req.user?.role ?? 'sales_associate',
    submitterPermissions: submitCtx?.permissions ?? [],
  });

  const created = await prisma.leadRequest.findUnique({
    where: { id: lr.id },
    include: {
      client: { select: { id: true, name: true } },
      requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      manager: { select: { id: true, firstName: true, lastName: true } },
      comments: true,
    },
  });

  const requesterName = created
    ? `${created.requestedBy.firstName} ${created.requestedBy.lastName}`.trim() || created.requestedBy.email
    : '';
  if (approval.autoApproved) {
    emitToUsers([requesterId], 'lead:refresh', { subCompanyId });
    const mappedAuto = {
      id: created!.id,
      clientId: created!.clientId,
      clientName: created!.client.name,
      primaryContactName: created!.client.name,
      requestedBy: created!.requestedById,
      requestedByName: `${created!.requestedBy.firstName} ${created!.requestedBy.lastName}`.trim(),
      managerId: created!.managerId,
      managerName: `${created!.manager.firstName} ${created!.manager.lastName}`.trim(),
      note: created!.note,
      requestedAt: created!.requestedAt,
      status: 'approved' as const,
      subCompanyId: created!.subCompanyId,
      autoApproved: true,
      comments: created!.comments.map((c) => ({
        id: c.id,
        userId: c.userId,
        userName: c.userName,
        text: c.text,
        createdAt: c.createdAt,
      })),
    };
    return res.status(201).json(mappedAuto);
  }

  if (!approval.targetRoleKey) {
    return res.status(400).json({
      error: 'No approval path configured for lead request. Check Settings → Approvals and Settings → Roles.',
    });
  }

  await notifyChainTargetUsers({
    subCompanyId,
    targetRoleKey: approval.targetRoleKey,
    eventKey: getApprovalEventKey('lead_request', 'submit'),
    context: { entityLabel: created!.client.name, actorName: requesterName },
    link: `/leads?review=${lr.id}`,
    relatedId: lr.id,
    alsoNotifyUserIds: managerId ? [managerId] : [],
  });

  await createActivityLog({
    userId: requesterId,
    userName: requesterDisplayName,
    subCompanyId,
    type: 'lead_request',
    description: `Requested lead for client "${created!.client.name}"`,
    metadata: { clientId: clientId, leadRequestId: lr.id },
  });

  const [agency, clientDetails] = await Promise.all([
    getAgencyBranding(subCompanyId),
    fetchClientDetailsForEmail(clientId, subCompanyId),
  ]);
  sendLeadRequestedEmail({
    toEmail: manager.email,
    toName: `${manager.firstName ?? ''} ${manager.lastName ?? ''}`.trim() || manager.email,
    requesterName: requesterDisplayName,
    clientName: created!.client.name,
    note: note.trim(),
    requestUrl: `${env.FRONTEND_URL}/leads?review=${lr.id}`,
    clientDetails,
    requesterEmail: created!.requestedBy.email,
    requestedAt: created!.requestedAt,
    agency,
  }).catch((err) => console.error('Failed to send lead request email', err));

  const mapped = {
    id: created!.id,
    clientId: created!.clientId,
    clientName: created!.client.name,
    primaryContactName: created!.client.name,
    requestedBy: created!.requestedById,
    requestedByName: `${created!.requestedBy.firstName} ${created!.requestedBy.lastName}`.trim(),
    managerId: created!.managerId,
    managerName: `${created!.manager.firstName} ${created!.manager.lastName}`.trim(),
    note: created!.note,
    requestedAt: created!.requestedAt,
    status: created!.status,
    subCompanyId: created!.subCompanyId,
    comments: created!.comments.map((c) => ({
      id: c.id,
      userId: c.userId,
      userName: c.userName,
      text: c.text,
      createdAt: c.createdAt,
    })),
  };
  return res.status(201).json(mapped);
});

/** PATCH /lead-requests/:id/approve — approve via approval chain and create lead for requester */
leadRequestsRouter.patch('/:id/approve', async (req: Request, res: Response) => {
  const body = approveBodySchema.safeParse(req.body);
  const comments = body.success ? body.data.comments : undefined;

  const lr = await prisma.leadRequest.findUnique({
    where: { id: req.params.id },
    include: { client: true, requestedBy: true, manager: true },
  });
  if (!lr) return res.status(404).json({ error: 'Lead request not found' });
  if (lr.status !== 'pending') {
    return res.status(400).json({ error: 'Request is no longer pending' });
  }

  const actorId = req.user!.sub;
  const approveCtx = await ensureAccessContext(req);
  if (!approveCtx) return res.status(403).json({ error: 'Forbidden' });

  const chainResult = await performApprovalAction({
    workflow: 'lead_request',
    entityId: lr.id,
    subCompanyId: lr.subCompanyId,
    actorUserId: actorId,
    actorRoleKey: approveCtx.roleKey,
    actorPermissions: approveCtx.permissions,
    action: 'approve',
    remarks: comments,
  });
  if (!chainResult.ok) return res.status(chainResult.status).json({ error: chainResult.error });

  const updated = await prisma.leadRequest.findUnique({
    where: { id: lr.id },
    include: {
      client: { select: { id: true, name: true } },
      requestedBy: { select: { id: true, firstName: true, lastName: true } },
      manager: { select: { id: true, firstName: true, lastName: true } },
      reviewedBy: { select: { id: true, firstName: true, lastName: true } },
      comments: true,
    },
  });

  return res.json(mapLeadRequest(updated!));
});

/** PATCH /lead-requests/:id/reject — reject via approval chain */
leadRequestsRouter.patch('/:id/reject', async (req: Request, res: Response) => {
  const body = rejectBodySchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: 'Comments required for rejection', details: body.error.flatten() });
  }
  const { comments } = body.data;

  const lr = await prisma.leadRequest.findUnique({
    where: { id: req.params.id },
    include: { manager: true, client: { select: { name: true } } },
  });
  if (!lr) return res.status(404).json({ error: 'Lead request not found' });
  if (lr.status !== 'pending') {
    return res.status(400).json({ error: 'Request is no longer pending' });
  }

  const actorId = req.user!.sub;
  const actorDisplayName = await getDisplayName(actorId);
  const rejectCtx = await ensureAccessContext(req);
  if (!rejectCtx) return res.status(403).json({ error: 'Forbidden' });

  const chainResult = await performApprovalAction({
    workflow: 'lead_request',
    entityId: lr.id,
    subCompanyId: lr.subCompanyId,
    actorUserId: actorId,
    actorRoleKey: rejectCtx.roleKey,
    actorPermissions: rejectCtx.permissions,
    action: 'reject',
    remarks: comments,
  });
  if (!chainResult.ok) return res.status(chainResult.status).json({ error: chainResult.error });

  await prisma.leadRequestComment.create({
    data: {
      requestId: lr.id,
      userId: actorId,
      userName: actorDisplayName,
      text: comments,
    },
  });

  const updated = await prisma.leadRequest.findUnique({
    where: { id: lr.id },
    include: {
      client: { select: { id: true, name: true } },
      requestedBy: { select: { id: true, firstName: true, lastName: true } },
      manager: { select: { id: true, firstName: true, lastName: true } },
      reviewedBy: { select: { id: true, firstName: true, lastName: true } },
      comments: true,
    },
  });

  // Emit lead:refresh so the requester's Leads page updates instantly
  emitToUsers([lr.requestedById], 'lead:refresh', { subCompanyId: lr.subCompanyId });

  // Requester reject notification is sent by performApprovalAction; only notify manager on-behalf here.
  if (actorId !== lr.managerId) {
    await dispatchNotificationToUser({
      userId: lr.managerId,
      subCompanyId: lr.subCompanyId,
      eventKey: 'lead_request_rejected_on_behalf',
      context: { entityLabel: lr.client.name, actorName: actorDisplayName },
      link: '/leads',
      relatedId: lr.id,
    });
  }

  await createActivityLog({
    userId: actorId,
    userName: actorDisplayName,
    subCompanyId: lr.subCompanyId,
    type: 'lead_request_rejected',
    description: `Rejected lead request for "${lr.client.name}" (requested by ${updated!.requestedBy.firstName} ${updated!.requestedBy.lastName})`,
    metadata: { clientId: lr.clientId, leadRequestId: lr.id },
  });

  const requester = await prisma.user.findUnique({
    where: { id: lr.requestedById },
    select: { email: true, firstName: true, lastName: true },
  });
  if (requester?.email) {
    const agency = await getAgencyBranding(lr.subCompanyId);
    sendLeadRequestRejectedEmail({
      toEmail: requester.email,
      toName: `${requester.firstName ?? ''} ${requester.lastName ?? ''}`.trim() || requester.email,
      clientName: lr.client.name,
      reason: comments,
      leadsUrl: `${env.FRONTEND_URL}/leads`,
      agency,
    }).catch((err) => console.error('Failed to send lead rejected email', err));
  }

  return res.json(mapLeadRequest(updated!));
});

/** POST /lead-requests/:id/comments — add a comment to an existing lead request */
leadRequestsRouter.post('/:id/comments', requirePermission('leads:read'), async (req: Request, res: Response) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Comment text is required' });
  }
  const lr = await prisma.leadRequest.findUnique({ where: { id: req.params.id }, select: { id: true, requestedById: true, subCompanyId: true } });
  if (!lr) return res.status(404).json({ error: 'Lead request not found' });

  const actorId = effectiveActorId(req);
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { firstName: true, lastName: true, email: true } });
  const actorName = actor ? `${actor.firstName} ${actor.lastName}`.trim() || actor.email : actorId;

  const comment = await prisma.leadRequestComment.create({
    data: { requestId: lr.id, userId: actorId, userName: actorName, text: text.trim() },
  });

  // Notify all parties so their Leads page refreshes instantly
  const notifyIds = [...new Set([lr.requestedById, actorId, req.user!.sub])];
  emitToUsers(notifyIds, 'lead:refresh', { subCompanyId: lr.subCompanyId });

  return res.status(201).json({ id: comment.id, userId: comment.userId, userName: comment.userName, text: comment.text, createdAt: comment.createdAt });
});

function mapLeadRequest(lr: {
  id: string;
  clientId: string;
  requestedById: string;
  managerId: string;
  note: string;
  status: string;
  reviewedById: string | null;
  reviewedAt: Date | null;
  subCompanyId: string;
  requestedAt: Date;
  client: { id: string; name: string };
  requestedBy: { id: string; firstName: string; lastName: string };
  manager: { id: string; firstName: string; lastName: string };
  reviewedBy?: { id: string; firstName: string; lastName: string } | null;
  comments: Array<{ id: string; userId: string; userName: string; text: string; createdAt: Date }>;
}) {
  return {
    id: lr.id,
    clientId: lr.clientId,
    clientName: lr.client.name,
    primaryContactName: lr.client.name,
    requestedBy: lr.requestedById,
    requestedByName: `${lr.requestedBy.firstName} ${lr.requestedBy.lastName}`.trim(),
    managerId: lr.managerId,
    managerName: `${lr.manager.firstName} ${lr.manager.lastName}`.trim(),
    note: lr.note,
    requestedAt: lr.requestedAt,
    status: lr.status,
    reviewedBy: lr.reviewedById ?? undefined,
    reviewedByName: lr.reviewedBy ? `${lr.reviewedBy.firstName} ${lr.reviewedBy.lastName}`.trim() : undefined,
    reviewedAt: lr.reviewedAt ?? undefined,
    subCompanyId: lr.subCompanyId,
    comments: lr.comments.map((c) => ({
      id: c.id,
      userId: c.userId,
      userName: c.userName,
      text: c.text,
      createdAt: c.createdAt,
    })),
  };
}
