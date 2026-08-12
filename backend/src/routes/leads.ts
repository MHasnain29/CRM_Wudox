import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { LeadStatus, LeadExtensionRequestStatus } from '@prisma/client';
import prisma from '../config/database';
import type { Prisma } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { actAsMiddleware, effectiveActorId } from '../middleware/actAs';
import { requirePermission } from '../middleware/requirePermission';
import { getDataScopeAsync } from '../config/dataScope';
import { resolveAllowedSubCompanyIds, parseAgencyIdsParam, buildSubCompanyFilter, resolveAgencyScope } from '../config/agencyScope';
import { attachAccessContext, ensureAccessContext, requestHasPermission } from '../utils/requestPermission';
import { canViewAllDataInAgency, canViewTeamData, isOwnDataOnlyScope } from '../services/accessContext';
import { dispatchNotificationToUser } from '../services/notificationDispatch';
import { createActivityLog } from '../services/activityLog';
import { autoAssignOwnershipForClosedWon } from '../services/clientOwnership';
import { invalidateClientListCache } from '../services/clientListCache';
import { findOpenLeadForClient, isOpenOrActiveLeadStatus, syncClientStatusFromLeadOutcomes } from '../services/leadClientStatus';
import { getAgencyBranding, sendLeadAssignedEmail, fetchClientDetailsForEmail } from '../services/email';
import { env } from '../config/env';
import { emitToUsers } from '../socket';
import { isOwnScopeRoleKey } from '../services/rbac';
import { notifyChainTargetUsers, submitEntityForApproval, performApprovalAction } from '../services/approvalActions';
import { expandLinkedOwnerScope, linkedExpansionToWhere, ownerExactFromQuery } from '../services/linkedOwnerExpand';
import { getApprovalEventKey } from '../services/notificationRegistry';

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(1000).default(100),
  status: z.nativeEnum(LeadStatus).optional(),
  stage: z.string().optional(),
  clientId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  subCompanyId: z.string().uuid().optional(), // legacy single-agency
  agencyIds: z.string().optional(),           // multi-select: comma-separated UUIDs
  ownerIds: z.string().optional(),            // multi-user filter: comma-separated UUIDs
});

const createLeadSchema = z.object({
  clientId:     z.string().uuid(),
  ownerId:      z.string().uuid().optional(),
  stage:        z.string().min(1).max(100),
  status:       z.nativeEnum(LeadStatus).default('open'),
  temperature:  z.enum(['hot', 'warm', 'cold']).optional(),
  value:        z.number().min(0).optional(),
  notes:        z.string().max(50000).optional(),
  nextFollowUp: z.string().datetime().optional(),
});

const updateLeadSchema = z.object({
  ownerId: z.string().uuid().optional(),
  stage: z.string().min(1).max(100).optional(),
  status: z.nativeEnum(LeadStatus).optional(),
  temperature: z.enum(['hot', 'warm', 'cold']).optional().nullable(),
  value: z.number().min(0).optional().nullable(),
  notes: z.string().max(50000).optional().nullable(),
  lossReason: z.string().max(5000).optional().nullable(),
  nextFollowUp: z.string().datetime().optional().nullable(),
  lastActivity: z.string().datetime().optional().nullable(),
});

const reassignLeadSchema = z.object({
  ownerId: z.string().uuid(),
  note: z.string().max(5000).optional(),
});

const deadlineDecisionSchema = z.object({
  requestExtension: z.boolean(),
  reason: z.string().min(1).max(5000),
  requestedDays: z.number().int().min(1).max(365).optional(),
});

const extensionReviewSchema = z.object({
  remarks: z.string().max(5000).optional(),
});

export const leadsRouter = Router();
leadsRouter.use(authenticate);
leadsRouter.use(actAsMiddleware);
leadsRouter.use(attachAccessContext);
leadsRouter.use(requirePermission('leads:read', 'pipeline:read'));

/** Acquisition lead deadline / extension does not apply in proposal-and-beyond stages (e.g. Send Proposal / proposal_sent). */
const STAGES_EXEMPT_FROM_LEAD_DEADLINE_ENFORCEMENT = new Set<string>([
  'proposal_sent',
  'awaiting_client_approval',
  'closed_won',
  'closed_lost',
]);


async function ensureLeadWritableByRequester(
  req: Request,
  lead: { ownerId: string; subCompanyId: string }
): Promise<boolean> {
  if (!req.user) return false;
  const ctx = await ensureAccessContext(req);
  const scope = await getDataScopeAsync(req.user, req);
  if (!scope?.subCompanyId) return false;
  const allowedSubCompanyIds = await resolveAllowedSubCompanyIds(req.user, req);
  if (!allowedSubCompanyIds.includes(lead.subCompanyId)) return false;
  if (!scope.ownerId || lead.ownerId === scope.ownerId) return true;

  if (!ctx || !canViewTeamData(ctx)) return false;

  const reportees = await prisma.user.findMany({
    where: {
      subCompanyId: lead.subCompanyId,
      OR: [{ id: scope.ownerId }, { reportingManagerIds: { has: scope.ownerId } }],
    },
    select: { id: true },
  });

  return reportees.some((user) => user.id === lead.ownerId);
}

async function resolveActorDisplayName(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true },
  });
  return user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email || 'User' : 'User';
}

async function getLeadDeadlineDays(subCompanyId: string): Promise<number> {
  const row = await prisma.leadDeadlineSetting.findUnique({
    where: { subCompanyId },
    select: { days: true },
  });
  return Math.max(0, row?.days ?? 7);
}

function computeLeadDeadline(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/** GET /leads — list leads. Elevated roles see across all agencies with optional agencyIds filter. */
leadsRouter.get('/', async (req: Request, res: Response) => {
  if (!req.user?.sub) return res.status(401).json({ error: 'Unauthorized' });

  const parsed = listQuerySchema.safeParse(req.query);
  const q = parsed.success ? parsed.data : { page: 1, limit: 100 };

  const allowedIds = await resolveAllowedSubCompanyIds(req.user);
  const requestedIds = parseAgencyIdsParam(q.agencyIds ?? q.subCompanyId);
  const scopeFilter = buildSubCompanyFilter(allowedIds, requestedIds);

  const skip = (q.page - 1) * q.limit;
  const userId = effectiveActorId(req);

  // Build where — start with agency scope, then layer owner/team filtering
  const where: Prisma.LeadWhereInput = { ...scopeFilter };
  if (q.status) where.status = q.status;
  if (q.stage) where.stage = q.stage;
  if (q.clientId) where.clientId = q.clientId;
  // Hide leads that have been superseded by a reassignment — only the latest
  // lead in any reassignment chain should appear in the list.
  where.reassignedToLeads = { none: {} };

  const ctx = await ensureAccessContext(req);
  const ownerIdsList = q.ownerIds ? q.ownerIds.split(',').filter((id) => /^[0-9a-f-]{36}$/i.test(id)) : [];
  const canUseOwnerIdsFilter = !!ctx && canViewTeamData(ctx);

  // Linked anchors first (any role): expand own/team/agency scopes across the link group.
  if (ownerIdsList.length > 0) {
    const linked = await expandLinkedOwnerScope(userId, req.user.subCompanyId, ownerIdsList, { exact: ownerExactFromQuery(req.query) });
    if (linked) {
      Object.assign(where, linkedExpansionToWhere(linked));
    } else if (canUseOwnerIdsFilter) {
      // Team scope: intersect requested IDs with actual reportees to prevent data leaks
      if (ctx && canViewTeamData(ctx) && !canViewAllDataInAgency(ctx)) {
        const primarySubCompanyId = 'subCompanyId' in scopeFilter ? (scopeFilter as { subCompanyId: string }).subCompanyId : allowedIds[0];
        const reportees = await prisma.user.findMany({
          where: { subCompanyId: primarySubCompanyId, OR: [{ id: userId }, { reportingManagerIds: { has: userId } }] },
          select: { id: true },
        });
        const allowedOwnerSet = new Set(reportees.map((u) => u.id));
        const safeIds = ownerIdsList.filter((id) => allowedOwnerSet.has(id));
        where.ownerId = { in: safeIds };
      } else {
        where.ownerId = { in: ownerIdsList };
      }
    } else {
      where.ownerId = userId;
    }
  } else if (q.ownerId) {
    where.ownerId = q.ownerId;
  } else if (ctx && canViewAllDataInAgency(ctx)) {
    // Agency-wide scope — no owner filter
  } else if (ctx && canViewTeamData(ctx)) {
    const primarySubCompanyId = 'subCompanyId' in scopeFilter ? scopeFilter.subCompanyId : allowedIds[0];
    const reportees = await prisma.user.findMany({
      where: { subCompanyId: primarySubCompanyId, OR: [{ id: userId }, { reportingManagerIds: { has: userId } }] },
      select: { id: true },
    });
    where.ownerId = { in: reportees.map((u) => u.id) };
  } else {
    where.ownerId = userId;
  }

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      skip,
      take: q.limit,
      orderBy: [{ updatedAt: 'desc' }, { lastActivity: 'desc' }],
      include: {
        client: {
          select: {
            id: true,
            corporateCode: true,
            name: true,
            industry: true,
            location: true,
            contacts: {
              where: { isPrimary: true },
              take: 1,
              select: { name: true, title: true },
            },
          },
        },
        owner: { select: { id: true, firstName: true, lastName: true, email: true } },
        subCompany: { select: { id: true, name: true } },
        proposals: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, rejectionComment: true, isForReview: true, reviewEmailSentAt: true },
        } as any,
        extensionRequests: {
          orderBy: { requestedAt: 'desc' },
          take: 1,
          include: {
            requestedBy: { select: { id: true, firstName: true, lastName: true } },
            reviewedBy: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        forwardedFromUser: { select: { firstName: true, lastName: true, subCompanyId: true } } as any,
      },
    }),
    prisma.lead.count({ where }),
  ]);

  const data = (leads as any[]).map((lead) => {
    const latest = lead.proposals?.[0] as any;
    const latestExtensionRequest = lead.extensionRequests?.[0] ?? null;
    const { subCompany, forwardedFromUser, ...rest } = lead;
    delete rest.proposals;
    delete rest.extensionRequests;
    const forwardedFromName = forwardedFromUser
      ? `${forwardedFromUser.firstName ?? ''} ${forwardedFromUser.lastName ?? ''}`.trim() || null
      : null;
    const forwardedFromSubCompanyId = forwardedFromUser?.subCompanyId ?? null;
    const requiresDeadlineAction =
      lead.ownerId === userId &&
      !!ctx &&
      isOwnDataOnlyScope(ctx) &&
      isOpenOrActiveLeadStatus(lead.status) &&
      !STAGES_EXEMPT_FROM_LEAD_DEADLINE_ENFORCEMENT.has(lead.stage) &&
      !!lead.leadDeadline &&
      new Date(lead.leadDeadline).getTime() <= Date.now() &&
      latestExtensionRequest?.status !== 'pending';
    return {
      ...rest,
      subCompanyName: subCompany?.name ?? null,
      forwardedFromName,
      forwardedFromSubCompanyId,
      latestExtensionRequest,
      requiresDeadlineAction,
      latestProposalId: latest?.id ?? null,
      latestProposalStatus: latest?.status ?? null,
      latestRejectionComment: latest?.rejectionComment ?? null,
      latestProposalIsForReview: latest?.isForReview ?? false,
      latestProposalReviewEmailSentAt: latest?.reviewEmailSentAt ?? null,
    };
  });

  return res.json({
    data,
    pagination: {
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.ceil(total / q.limit),
    },
  });
});

/** GET /pipeline-stages — list pipeline stages for current agency (or global) */
leadsRouter.get('/pipeline-stages', async (req: Request, res: Response) => {
  const subCompanyId = req.user?.subCompanyId;
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const stages = await prisma.pipelineStage.findMany({
    where: { OR: [{ subCompanyId: null }, { subCompanyId }] },
    orderBy: { orderIndex: 'asc' },
  });
  return res.json({ data: stages });
});

/** GET /leads/:id — lead detail */
leadsRouter.get('/:id', async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const scope = await getDataScopeAsync(req.user, req);
  if (!scope) return res.status(403).json({ error: 'Agency context required' });
  const agencyScope = { ...scope, subCompanyId };
  const ctx = await ensureAccessContext(req);

  const interactionAgencyFilter = { subCompanyId };
  const lead = await prisma.lead.findFirst({
    where: {
      id: req.params.id,
      subCompanyId,
    },
    include: {
      client: true,
      owner: { select: { id: true, firstName: true, lastName: true, email: true } },
      calls: { where: interactionAgencyFilter, orderBy: { timestamp: 'desc' }, take: 20 },
      followUps: { where: interactionAgencyFilter, orderBy: { dueDate: 'asc' }, take: 20 },
      meetings: { where: interactionAgencyFilter, orderBy: { startTime: 'desc' }, take: 20 },
    },
  });
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  // Data scope: if not sub-company wide, must be owner or (manager and owner in team)
  if (agencyScope.ownerId && lead.ownerId !== agencyScope.ownerId) {
    if (!ctx || !canViewTeamData(ctx)) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    const reportees = await prisma.user.findMany({
      where: {
        subCompanyId,
        OR: [{ id: agencyScope.ownerId }, { reportingManagerIds: { has: agencyScope.ownerId } }],
      },
      select: { id: true },
    });
    const allowedIds = reportees.map((u) => u.id);
    if (!allowedIds.includes(lead.ownerId)) {
      return res.status(404).json({ error: 'Lead not found' });
    }
  }

  return res.json(lead);
});

/** PATCH before leads:write gate — stage moves need pipeline:write; other fields need leads:write */
leadsRouter.patch('/:id', requirePermission('leads:write', 'pipeline:write'), async (req: Request, res: Response) => {
  const tokenSubCompanyId = req.user?.subCompanyId;
  if (!tokenSubCompanyId || !req.user) return res.status(403).json({ error: 'Agency context required' });

  const parsed = updateLeadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }
  const data = parsed.data;

  const allowedSubCompanyIds = await resolveAllowedSubCompanyIds(req.user, req);
  const existing = await prisma.lead.findFirst({
    where: { id: req.params.id, subCompanyId: { in: allowedSubCompanyIds } },
  });
  if (!existing) return res.status(404).json({ error: 'Lead not found' });
  const subCompanyId = existing.subCompanyId;

  if (!(await ensureLeadWritableByRequester(req, existing))) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  const isChangingPipelineStage =
    data.stage !== undefined ||
    data.status !== undefined;
  const isChangingLeadDetails =
    data.temperature !== undefined ||
    data.value !== undefined ||
    data.notes !== undefined ||
    data.lossReason !== undefined ||
    data.nextFollowUp !== undefined ||
    data.lastActivity !== undefined ||
    data.ownerId !== undefined;

  if (
    isChangingPipelineStage &&
    !(await requestHasPermission(req, 'pipeline:write')) &&
    !(await requestHasPermission(req, 'leads:write'))
  ) {
    return res.status(403).json({ error: 'Permission denied: pipeline:write or leads:write required to move leads' });
  }
  if (isChangingLeadDetails && !(await requestHasPermission(req, 'leads:write'))) {
    return res.status(403).json({ error: 'Permission denied: leads:write required to edit lead details' });
  }

  const requesterRole = req.user?.role ?? '';
  const isAssociateOwner =
    existing.ownerId === effectiveActorId(req) &&
    (await isOwnScopeRoleKey(requesterRole));
  if (
    isAssociateOwner &&
    isOpenOrActiveLeadStatus(existing.status) &&
    !STAGES_EXEMPT_FROM_LEAD_DEADLINE_ENFORCEMENT.has(existing.stage) &&
    existing.leadDeadline &&
    existing.leadDeadline.getTime() <= Date.now()
  ) {
    const latestExtensionRequest = await prisma.leadExtensionRequest.findFirst({
      where: { leadId: existing.id },
      orderBy: { requestedAt: 'desc' },
      select: { status: true },
    });
    if (latestExtensionRequest?.status !== LeadExtensionRequestStatus.pending) {
      return res.status(409).json({
        error: 'Lead deadline has expired. Submit an extension decision before editing this lead.',
      });
    }
  }

  if (data.ownerId != null && data.ownerId !== existing.ownerId) {
    return res.status(400).json({
      error: 'Lead ownership changes require the reassignment approval workflow. Use POST /api/v1/lead-reassignment-requests.',
    });
  }

  const isAttemptingToLeaveClosedLost =
    existing.status === LeadStatus.closed_lost &&
    ((data.status !== undefined && data.status !== LeadStatus.closed_lost) ||
      (data.stage !== undefined && data.stage !== 'closed_lost'));
  if (isAttemptingToLeaveClosedLost) {
    return res.status(409).json({ error: 'Closed lost leads are historical records and cannot be reopened in place' });
  }

  const nextStage = data.stage
    ?? (data.status === LeadStatus.closed_won ? 'closed_won' : undefined)
    ?? (data.status === LeadStatus.closed_lost ? 'closed_lost' : undefined)
    ?? existing.stage;
  const nextStatus = data.status
    ?? (data.stage === 'closed_won' ? LeadStatus.closed_won : undefined)
    ?? (data.stage === 'closed_lost' ? LeadStatus.closed_lost : undefined)
    ?? existing.status;

  if (nextStatus === LeadStatus.open && existing.status !== LeadStatus.open) {
    const otherOpenLead = await findOpenLeadForClient({
      clientId: existing.clientId,
      subCompanyId,
      excludeLeadId: existing.id,
    });
    if (otherOpenLead) {
      return res.status(409).json({ error: 'An open lead already exists for this client in your agency' });
    }
  }

  const updatePayload: Prisma.LeadUpdateInput = {};
  if (data.stage !== undefined || nextStage !== existing.stage) updatePayload.stage = nextStage;
  if (data.status !== undefined || nextStatus !== existing.status) updatePayload.status = nextStatus;
  if (data.temperature !== undefined) updatePayload.temperature = data.temperature;
  if (data.value !== undefined) updatePayload.value = data.value;
  if (data.notes !== undefined) updatePayload.notes = data.notes;
  if (data.lossReason !== undefined) updatePayload.lossReason = data.lossReason;
  if (data.nextFollowUp !== undefined) updatePayload.nextFollowUp = data.nextFollowUp ? new Date(data.nextFollowUp) : null;
  if (data.lastActivity !== undefined) updatePayload.lastActivity = data.lastActivity ? new Date(data.lastActivity) : null;
  if (data.ownerId !== undefined) updatePayload.owner = { connect: { id: data.ownerId } };

  const isClosingLost = nextStatus === LeadStatus.closed_lost;
  const isClosingWon = nextStatus === LeadStatus.closed_won;
  if (isClosingLost && existing.status !== LeadStatus.closed_lost) {
    updatePayload.closedAt = new Date();
    updatePayload.closedBy = { connect: { id: effectiveActorId(req) } };
    if (data.lossReason === undefined) {
      updatePayload.lossReason = existing.lossReason ?? null;
    }
  } else if (isClosingWon && existing.status !== LeadStatus.closed_won) {
    updatePayload.closedAt = new Date();
    updatePayload.closedBy = { connect: { id: effectiveActorId(req) } };
    updatePayload.lossReason = null;
  } else if (nextStatus === LeadStatus.open && existing.status !== LeadStatus.open) {
    updatePayload.closedAt = null;
    updatePayload.closedBy = { disconnect: true };
    updatePayload.lossReason = null;
  }

  const shouldSyncClientStatus =
    nextStage !== existing.stage ||
    nextStatus !== existing.status ||
    data.ownerId !== undefined;
  const isClosingWonTransition = isClosingWon && existing.status !== LeadStatus.closed_won;
  const actorDisplayName = isClosingWonTransition
    ? await resolveActorDisplayName(effectiveActorId(req))
    : null;
  const lead = await prisma.$transaction(async (tx) => {
    const updated = await tx.lead.update({
      where: { id: req.params.id },
      data: updatePayload,
      include: {
        client: { select: { id: true, corporateCode: true, name: true } },
        owner: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (shouldSyncClientStatus) {
      await syncClientStatusFromLeadOutcomes({
        tx,
        clientId: updated.clientId,
        subCompanyId,
        touchLastActivityAt: new Date(),
      });
    }

    if (isClosingWonTransition) {
      await autoAssignOwnershipForClosedWon({
        tx,
        clientId: updated.clientId,
        leadId: updated.id,
        subCompanyId,
        actorId: effectiveActorId(req),
        actorName: actorDisplayName ?? 'Manager',
      });
    }

    return updated;
  });

  await invalidateClientListCache(subCompanyId);

  const stageChanged = nextStage !== existing.stage;
  const statusChanged = nextStatus !== existing.status;
  if (stageChanged || statusChanged) {
    const patchLog = {
      actorId: effectiveActorId(req),
      subCompanyId,
      leadId: lead.id,
      clientId: lead.clientId,
      clientName: lead.client.name,
      fromStage: existing.stage,
      toStage: nextStage,
      stageChanged,
      statusChanged,
      toStatus: nextStatus,
    };
    void (async () => {
      const actorName = await resolveActorDisplayName(patchLog.actorId);
      if (patchLog.stageChanged) {
        await createActivityLog({ userId: patchLog.actorId, userName: actorName, subCompanyId: patchLog.subCompanyId, type: 'pipeline_moved', description: `Lead moved from "${patchLog.fromStage}" to "${patchLog.toStage}"`, metadata: { clientId: patchLog.clientId, leadId: patchLog.leadId, fromStage: patchLog.fromStage, toStage: patchLog.toStage } });
      }
      if (patchLog.statusChanged && patchLog.toStatus === LeadStatus.closed_lost) {
        await createActivityLog({ userId: patchLog.actorId, userName: actorName, subCompanyId: patchLog.subCompanyId, type: 'lead_lost', description: `Marked lead for "${patchLog.clientName}" as lost`, metadata: { leadId: patchLog.leadId, clientId: patchLog.clientId, clientName: patchLog.clientName } });
      }
      if (patchLog.statusChanged && patchLog.toStatus === LeadStatus.closed_won) {
        await createActivityLog({ userId: patchLog.actorId, userName: actorName, subCompanyId: patchLog.subCompanyId, type: 'lead_won', description: `Closed lead for "${patchLog.clientName}" as won`, metadata: { leadId: patchLog.leadId, clientId: patchLog.clientId, clientName: patchLog.clientName } });
      }
      if (patchLog.stageChanged && patchLog.toStage === 'contacted') {
        await createActivityLog({ userId: patchLog.actorId, userName: actorName, subCompanyId: patchLog.subCompanyId, type: 'client_contacted', description: `Contacted client "${patchLog.clientName}"`, metadata: { leadId: patchLog.leadId, clientId: patchLog.clientId, clientName: patchLog.clientName } });
      }
    })();
  }

  emitToUsers([lead.ownerId, req.user!.sub], 'lead:refresh', { subCompanyId });
  if (isClosingWonTransition) {
    emitToUsers([lead.ownerId, req.user!.sub], 'client:refresh', { subCompanyId });
  }

  return res.json(lead);
});

leadsRouter.use(requirePermission('leads:write'));

/** POST /leads — create lead (agency-scoped; owner = self or, with leads:assign, associate/self) */
leadsRouter.post('/', async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const parsed = createLeadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }
  const data = parsed.data;
  const canAssignLeads = await requestHasPermission(req, 'leads:assign');

  const client = await prisma.client.findUnique({ where: { id: data.clientId } });
  if (!client) return res.status(404).json({ error: 'Client not found' });

  let ownerId = data.ownerId ?? effectiveActorId(req);
  const isSelfAssign = !data.ownerId || data.ownerId === effectiveActorId(req);
  if (isSelfAssign && !canAssignLeads) {
    const { getAgencyApprovalPolicy } = await import('../services/approvalPolicy');
    const policy = await getAgencyApprovalPolicy(subCompanyId);
    if (!policy.allowLeadSelfAssign) {
      return res.status(403).json({ error: 'Lead self-assign is disabled for this agency. Submit a lead request instead.' });
    }
  }
  if (data.ownerId && data.ownerId !== effectiveActorId(req)) {
    if (!canAssignLeads) {
      return res.status(403).json({ error: 'Cannot assign lead to another user without leads:assign' });
    }
    const owner = await prisma.user.findFirst({
      where: { id: data.ownerId, subCompanyId, isActive: true },
    });
    if (!owner) return res.status(400).json({ error: 'Owner must be an active user in your agency' });
    ownerId = owner.id;
  }

  const existingOpenLead = await findOpenLeadForClient({
    clientId: data.clientId,
    subCompanyId,
  });
  if (existingOpenLead) {
    return res.status(409).json({ error: 'An open lead already exists for this client in your agency' });
  }

  const lockedForOwner = await prisma.lead.findFirst({
    where: {
      clientId: data.clientId,
      subCompanyId,
      reassignmentLocked: true,
      lockedAssociateId: ownerId,
    },
    select: { id: true },
  });
  // Lock prevents self-reclaim; manager/director can still manually reassign.
  if (lockedForOwner && !canAssignLeads) {
    return res.status(409).json({ error: 'This associate cannot reclaim this lead' });
  }

  const now = new Date();
  const leadDeadlineDays = await getLeadDeadlineDays(subCompanyId);
  const leadDeadline = computeLeadDeadline(leadDeadlineDays);
  const lead = await prisma.$transaction(async (tx) => {
    const created = await tx.lead.create({
      data: {
        clientId: data.clientId,
        ownerId,
        subCompanyId,
        stage: data.stage,
        status: data.status,
        temperature: data.temperature ?? undefined,
        value: data.value != null ? data.value : undefined,
        notes: data.notes ?? undefined,
        nextFollowUp: data.nextFollowUp ? new Date(data.nextFollowUp) : undefined,
        lastActivity: now,
        leadDeadline,
      },
      include: {
        client: { select: { id: true, corporateCode: true, name: true } },
        owner: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    await syncClientStatusFromLeadOutcomes({
      tx,
      clientId: created.clientId,
      subCompanyId,
      touchLastActivityAt: now,
    });

    return created;
  });


  const leadActorId = effectiveActorId(req);
  if (ownerId !== leadActorId) {
    const assignerName = await resolveActorDisplayName(leadActorId);
    await dispatchNotificationToUser({
      userId: ownerId,
      subCompanyId,
      eventKey: 'lead_assigned_manual',
      context: { entityLabel: lead.client.name, actorName: assignerName },
      link: '/leads',
      relatedId: lead.id,
    });
    if (lead.owner.email) {
      void (async () => {
        try {
          const [clientDetails, agency, assignedByName] = await Promise.all([
            fetchClientDetailsForEmail(lead.clientId, subCompanyId),
            getAgencyBranding(subCompanyId),
            resolveActorDisplayName(leadActorId),
          ]);
          await sendLeadAssignedEmail({
            toEmail: lead.owner.email,
            toName: `${lead.owner.firstName ?? ''} ${lead.owner.lastName ?? ''}`.trim() || lead.owner.email,
            assignedByName,
            clientDetails,
            lead: {
              id: lead.id,
              stage: lead.stage,
              status: lead.status,
              temperature: lead.temperature ?? null,
              value: lead.value,
              notes: lead.notes ?? null,
              nextFollowUp: lead.nextFollowUp,
            },
            leadsUrl: `${env.FRONTEND_URL}/leads`,
            agency,
          });
        } catch (err) {
          console.error('Failed to send lead assigned email', err);
        }
      })();
    }
  }

  await invalidateClientListCache(subCompanyId);

  // Fire-and-forget activity logging — best-effort, does not block response
  const postLog = {
    actorId:      leadActorId,
    subCompanyId,
    leadId:       lead.id,
    clientId:     lead.clientId,
    clientName:   lead.client.name,
    ownerId,
    ownerName:    `${lead.owner.firstName ?? ''} ${lead.owner.lastName ?? ''}`.trim() || lead.owner.email || 'User',
    isAssigned:   ownerId !== leadActorId,
  };
  void (async () => {
    const actorName = await resolveActorDisplayName(postLog.actorId);
    await createActivityLog({ userId: postLog.actorId, userName: actorName, subCompanyId: postLog.subCompanyId, type: 'lead_created', description: `Created lead for client "${postLog.clientName}"`, metadata: { leadId: postLog.leadId, clientId: postLog.clientId, clientName: postLog.clientName } });
    if (postLog.isAssigned) {
      await createActivityLog({ userId: postLog.actorId, userName: actorName, subCompanyId: postLog.subCompanyId, type: 'lead_assigned', description: `Assigned lead for "${postLog.clientName}" to ${postLog.ownerName}`, metadata: { leadId: postLog.leadId, clientId: postLog.clientId, clientName: postLog.clientName, ownerId: postLog.ownerId, ownerName: postLog.ownerName } });
    }
  })();

  emitToUsers([lead.ownerId], 'lead:refresh', { subCompanyId });

  return res.status(201).json(lead);
});

/** POST /leads/:id/deadline-decision — associate handles expired lead */
leadsRouter.post('/:id/deadline-decision', async (req: Request, res: Response) => {
  const subCompanyId = req.user?.subCompanyId;
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
  const parsed = deadlineDecisionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }
  const userRole = req.user?.role ?? '';
  if (!(await isOwnScopeRoleKey(userRole))) {
    return res.status(403).json({ error: 'Only own-scope users can submit this decision' });
  }
  const data = parsed.data;
  if (data.requestExtension && !data.requestedDays) {
    return res.status(400).json({ error: 'requestedDays is required for extension request' });
  }

  const lead = await prisma.lead.findFirst({
    where: { id: req.params.id, subCompanyId },
    include: { client: { select: { id: true, name: true } }, owner: { select: { id: true, reportingManagerIds: true } } },
  });
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  if (lead.ownerId !== effectiveActorId(req)) return res.status(403).json({ error: 'Only lead owner can submit this decision' });
  if (!isOpenOrActiveLeadStatus(lead.status)) {
    return res.status(409).json({ error: 'Lead deadline action only applies to open leads' });
  }
  if (STAGES_EXEMPT_FROM_LEAD_DEADLINE_ENFORCEMENT.has(lead.stage)) {
    return res.status(409).json({ error: 'Lead deadline does not apply at this pipeline stage' });
  }
  if (!lead.leadDeadline || lead.leadDeadline.getTime() > Date.now()) {
    return res.status(409).json({ error: 'Lead deadline has not expired yet' });
  }

  if (data.requestExtension) {
    const pending = await prisma.leadExtensionRequest.findFirst({
      where: { leadId: lead.id, status: LeadExtensionRequestStatus.pending },
      select: { id: true },
    });
    if (pending) return res.status(409).json({ error: 'An extension request is already pending' });

    const ctx = await ensureAccessContext(req);
    if (!ctx) return res.status(403).json({ error: 'Forbidden' });

    const created = await prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          extensionRequested: true,
          extensionReason: data.reason.trim(),
          extensionDays: data.requestedDays!,
          extensionStatus: 'pending',
          extensionRequestedAt: new Date(),
          managerRemarks: null,
          reviewedBy: null,
          extensionReviewedAt: null,
        },
      });
      return tx.leadExtensionRequest.create({
        data: {
          leadId: lead.id,
          requestedById: effectiveActorId(req),
          reason: data.reason.trim(),
          requestedDays: data.requestedDays!,
          status: LeadExtensionRequestStatus.pending,
          currentStepIndex: 0,
          approvalChain: [],
        },
      });
    });

    const approval = await submitEntityForApproval({
      workflow: 'lead_extension',
      entityId: created.id,
      subCompanyId,
      submitterUserId: effectiveActorId(req),
      submitterRoleKey: userRole,
      submitterPermissions: ctx.permissions,
    });

    if (approval.autoApproved) {
      const approved = await prisma.leadExtensionRequest.findUnique({ where: { id: created.id } });
      emitToUsers([req.user!.sub], 'lead:refresh', { subCompanyId });
      return res.status(201).json({ request: approved, autoApproved: true });
    }

    if (!approval.targetRoleKey) {
      return res.status(400).json({
        error: 'No approval path configured for lead extension. Check Settings → Approvals and Settings → Roles.',
      });
    }

    const requesterName = await resolveActorDisplayName(req.user!.sub);
    const notifierIds = await notifyChainTargetUsers({
      subCompanyId,
      targetRoleKey: approval.targetRoleKey,
      eventKey: getApprovalEventKey('lead_extension', 'submit'),
      context: { entityLabel: lead.client.name, actorName: requesterName },
      link: '/leads?tab=lead-extensions',
      relatedId: created.id,
    });
    if (notifierIds.length > 0) {
      emitToUsers(notifierIds, 'lead:refresh', { subCompanyId });
    }
    emitToUsers([req.user!.sub], 'lead:refresh', { subCompanyId });
    return res.status(201).json({ request: created, autoApproved: false, targetRoleKey: approval.targetRoleKey });
  }

  const reportingManagerIds = lead.owner.reportingManagerIds;

  await prisma.$transaction(async (tx) => {
    await tx.leadExtensionRequest.deleteMany({
      where: { leadId: lead.id, status: LeadExtensionRequestStatus.pending },
    });

    await tx.lead.update({
      where: { id: lead.id },
      data: {
        stage: 'closed_lost',
        status: LeadStatus.closed_lost,
        closedAt: new Date(),
        closedById: effectiveActorId(req),
        lossReason: data.reason.trim(),
        reassignmentLocked: true,
        lockedAssociateId: effectiveActorId(req),
        extensionRequested: false,
        extensionReason: null,
        extensionDays: null,
        extensionStatus: null,
        extensionRequestedAt: null,
        extensionReviewedAt: null,
        reviewedBy: null,
        managerRemarks: null,
        leadDeadline: null,
      },
    });

    await tx.leadExtensionRequest.create({
      data: {
        leadId: lead.id,
        requestedById: effectiveActorId(req),
        reason: data.reason.trim(),
        requestedDays: 0,
        status: LeadExtensionRequestStatus.returned,
      },
    });

    await syncClientStatusFromLeadOutcomes({
      tx,
      clientId: lead.clientId,
      subCompanyId,
      touchLastActivityAt: new Date(),
    });
  });

  // No manager notification: associate returned the lead after expiry without requesting extension (audit row only).
  const refreshRecipients = [...new Set([...reportingManagerIds, req.user!.sub])];
  emitToUsers(refreshRecipients, 'lead:refresh', { subCompanyId });
  return res.json({ ok: true });
});

/** GET /leads/extension-requests — queue/history (managers or own requests) */
leadsRouter.get('/extension-requests/list', async (req: Request, res: Response) => {
  const subCompanyId = req.user?.subCompanyId;
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
  const ctx = await ensureAccessContext(req);
  if (!ctx) return res.status(403).json({ error: 'Forbidden' });

  const canViewAgencyQueue =
    ctx.permissions.includes('leads:assign') ||
    ctx.permissions.includes('leads:approve') ||
    ctx.permissions.includes('leads:manager_recommend');

  const status = (req.query.status as string | undefined)?.trim();
  const where: Prisma.LeadExtensionRequestWhereInput = { lead: { subCompanyId } };
  if (!canViewAgencyQueue) {
    where.requestedById = effectiveActorId(req);
  }
  if (status && ['pending', 'approved', 'rejected', 'returned'].includes(status)) {
    where.status = status as LeadExtensionRequestStatus;
  }
  const requests = await prisma.leadExtensionRequest.findMany({
    where,
    orderBy: { requestedAt: 'desc' },
    include: {
      requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      reviewedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      lead: { select: { id: true, status: true, client: { select: { id: true, name: true } }, leadDeadline: true } },
    },
  });
  return res.json({ requests });
});

/** PATCH /leads/extension-requests/:id/:decision — approve/reject via approval chain */
leadsRouter.patch('/extension-requests/:id/:decision', async (req: Request, res: Response) => {
  const subCompanyId = req.user?.subCompanyId;
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
  const ctx = await ensureAccessContext(req);
  if (!ctx) return res.status(403).json({ error: 'Forbidden' });

  const decision = req.params.decision;
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'Invalid decision' });
  const parsed = extensionReviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });

  const remarks = parsed.data.remarks?.trim() || null;
  if (decision === 'reject' && !remarks) return res.status(400).json({ error: 'remarks are required for rejection' });

  const row = await prisma.leadExtensionRequest.findUnique({
    where: { id: req.params.id },
    include: { lead: { select: { subCompanyId: true, client: { select: { name: true } } } } },
  });
  if (!row) return res.status(404).json({ error: 'Extension request not found' });
  if (row.lead.subCompanyId !== subCompanyId) return res.status(403).json({ error: 'Not authorized' });
  if (row.status !== LeadExtensionRequestStatus.pending) return res.status(409).json({ error: `Request already ${row.status}` });

  const result = await performApprovalAction({
    workflow: 'lead_extension',
    entityId: row.id,
    subCompanyId,
    actorUserId: effectiveActorId(req),
    actorRoleKey: ctx.roleKey,
    actorPermissions: ctx.permissions,
    action: decision === 'approve' ? 'approve' : 'reject',
    remarks: remarks ?? undefined,
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });

  emitToUsers([row.requestedById, req.user!.sub], 'lead:refresh', { subCompanyId });
  return res.json({ ok: true });
});

/** POST /leads/:id/reassign — clone a closed-lost lead into a new open lead for another owner */
leadsRouter.post('/:id/reassign', async (req: Request, res: Response) => {
  if (!req.user?.subCompanyId || !req.user) return res.status(403).json({ error: 'Agency context required' });

  const parsed = reassignLeadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }

  if (!(await requestHasPermission(req, 'leads:assign'))) {
    return res.status(403).json({ error: 'Reassigning a lost lead requires leads:assign' });
  }

  const allowedSubCompanyIds = await resolveAllowedSubCompanyIds(req.user);
  const sourceLead = await prisma.lead.findFirst({
    where: { id: req.params.id, subCompanyId: { in: allowedSubCompanyIds } },
    include: {
      client: { select: { id: true, corporateCode: true, name: true } },
      owner: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
  if (!sourceLead) return res.status(404).json({ error: 'Lead not found' });
  const subCompanyId = sourceLead.subCompanyId;
  if (!(await ensureLeadWritableByRequester(req, sourceLead))) {
    return res.status(404).json({ error: 'Lead not found' });
  }
  if (sourceLead.status !== LeadStatus.closed_lost) {
    return res.status(409).json({ error: 'Only closed lost leads can be reassigned' });
  }
  // Manager-triggered reassignment is allowed even back to previously locked associate.

  const newOwner = await prisma.user.findFirst({
    where: { id: parsed.data.ownerId, subCompanyId, isActive: true },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  if (!newOwner) {
    return res.status(400).json({ error: 'New owner must be an active user in your agency' });
  }

  const existingOpenLead = await findOpenLeadForClient({
    clientId: sourceLead.clientId,
    subCompanyId,
  });
  if (existingOpenLead) {
    return res.status(409).json({ error: 'An open lead already exists for this client in your agency' });
  }

  const now = new Date();
  const leadDeadlineDays = await getLeadDeadlineDays(subCompanyId);
  const leadDeadline = computeLeadDeadline(leadDeadlineDays);
  const nextNotes = [sourceLead.notes?.trim(), parsed.data.note?.trim() ? `Reassignment note: ${parsed.data.note.trim()}` : null]
    .filter(Boolean)
    .join('\n\n');

  const newLead = await prisma.$transaction(async (tx) => {
    const created = await tx.lead.create({
      data: {
        clientId: sourceLead.clientId,
        ownerId: newOwner.id,
        subCompanyId,
        stage: 'new_lead',
        status: LeadStatus.open,
        temperature: sourceLead.temperature ?? undefined,
        value: sourceLead.value ?? undefined,
        notes: nextNotes || undefined,
        lastActivity: now,
        leadDeadline,
        reassignedFromLeadId: sourceLead.id,
        reassignedById: effectiveActorId(req),
      },
      include: {
        client: { select: { id: true, corporateCode: true, name: true } },
        owner: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    await syncClientStatusFromLeadOutcomes({
      tx,
      clientId: created.clientId,
      subCompanyId,
      touchLastActivityAt: now,
    });

    return created;
  });

  await invalidateClientListCache(subCompanyId);
  const assignerName = await resolveActorDisplayName(req.user!.sub);
  await dispatchNotificationToUser({
    userId: newOwner.id,
    subCompanyId,
    eventKey: 'lead_assigned_after_loss',
    context: { entityLabel: newLead.client.name, actorName: assignerName },
    link: '/leads',
    relatedId: newLead.id,
  });

  if (newOwner.email) {
    void (async () => {
      try {
        const [clientDetails, agency, assignedByName] = await Promise.all([
          fetchClientDetailsForEmail(newLead.clientId, subCompanyId),
          getAgencyBranding(subCompanyId),
          resolveActorDisplayName(req.user!.sub),
        ]);
        await sendLeadAssignedEmail({
          toEmail: newOwner.email,
          toName: `${newOwner.firstName ?? ''} ${newOwner.lastName ?? ''}`.trim() || newOwner.email,
          assignedByName,
          clientDetails,
          lead: {
            id: newLead.id,
            stage: newLead.stage,
            status: newLead.status,
            temperature: newLead.temperature ?? null,
            value: newLead.value,
            notes: newLead.notes ?? null,
            nextFollowUp: newLead.nextFollowUp,
          },
          leadsUrl: `${env.FRONTEND_URL}/leads`,
          lostLeadReassignment: true,
          agency,
        });
      } catch (err) {
        console.error('Failed to send lead assigned email', err);
      }
    })();
  }

  void (async () => {
    const actorName = await resolveActorDisplayName(effectiveActorId(req));
    const oldOwnerName = `${sourceLead.owner.firstName ?? ''} ${sourceLead.owner.lastName ?? ''}`.trim() || sourceLead.owner.email || 'User';
    const newOwnerName = `${newOwner.firstName ?? ''} ${newOwner.lastName ?? ''}`.trim() || newOwner.email || 'User';
    await createActivityLog({
      userId: effectiveActorId(req),
      userName: actorName,
      subCompanyId,
      type: 'lead_reassigned_after_loss',
      description: `Reassigned lost lead for "${newLead.client.name}" from ${oldOwnerName} to ${newOwnerName}`,
      metadata: {
        oldLeadId: sourceLead.id,
        leadId: newLead.id,
        clientId: newLead.clientId,
        clientName: newLead.client.name,
        previousOwnerId: sourceLead.ownerId,
        previousOwnerName: oldOwnerName,
        ownerId: newOwner.id,
        ownerName: newOwnerName,
      },
    });
  })();

  emitToUsers([newOwner.id, sourceLead.ownerId, req.user!.sub], 'lead:refresh', { subCompanyId });
  emitToUsers([newOwner.id, sourceLead.ownerId, req.user!.sub], 'client:refresh', { subCompanyId });

  return res.status(201).json(newLead);
});
