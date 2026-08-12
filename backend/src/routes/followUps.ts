/**
 * Follow-ups API: list (agency-scoped, role-based), create, update, complete, reschedule, comments.
 * Associates see own; managers+ see all in agency. Data scoped by subCompanyId.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { FollowUpOutcome } from '@prisma/client';
import prisma from '../config/database';
import type { Prisma } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { actAsMiddleware, effectiveActorId } from '../middleware/actAs';
import { requirePermission } from '../middleware/requirePermission';
import { createActivityLog } from '../services/activityLog';
import { dispatchNotificationToUser } from '../services/notificationDispatch';
import { emitToUsers } from '../socket';
import { resolveAgencyScope, resolveListAgencyScope } from '../config/agencyScope';
import { followUpsForClientDetail, resolveClientDetailScope } from '../services/clientAgencyAccess';
import {
  canViewAllDataInAgency,
  canViewTeamData,
  requestCanUseOwnerIdsFilter,
} from '../services/accessContext';
import { ensureAccessContext } from '../utils/requestPermission';
import { expandLinkedOwnerScope, linkedExpansionToWhere, ownerExactFromQuery } from '../services/linkedOwnerExpand';


const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(500).default(100),
  completed: z.enum(['true', 'false']).optional(),
  ownerId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  subCompanyId: z.string().uuid().optional(), // legacy
  agencyIds: z.string().optional(),           // multi-select: comma-separated UUIDs
  ownerIds: z.string().optional(),            // multi-user filter: comma-separated UUIDs
});

const createBodySchema = z
  .object({
    clientId: z.string().uuid().optional(),
    employeeId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional().nullable(),
    contactId: z.string().uuid().optional().nullable(),
    dueDate: z.string().datetime(),
    notes: z.string().min(1).max(10000),
  })
  .refine((d) => Boolean(d.clientId) !== Boolean(d.employeeId), {
    message: 'Provide exactly one of clientId or employeeId',
  });

const updateBodySchema = z.object({
  dueDate: z.string().datetime().optional(),
  notes: z.string().max(10000).optional(),
  completed: z.boolean().optional(),
  outcome: z.nativeEnum(FollowUpOutcome).optional().nullable(),
});

const commentBodySchema = z.object({
  content: z.string().min(1).max(5000),
});

async function resolveAllowedFollowUpAgencyIds(req: Request): Promise<string[] | null> {
  const scope = await resolveListAgencyScope(req);
  return scope?.allowedIds ?? null;
}

export const followUpsRouter = Router();
followUpsRouter.use(authenticate);
followUpsRouter.use(actAsMiddleware);
followUpsRouter.use(requirePermission('clients:read', 'employees:read'));

/** GET /follow-ups — list. Elevated roles see across all agencies with optional agencyIds filter. */
followUpsRouter.get('/', async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  const q = parsed.success ? parsed.data : { page: 1, limit: 100 };

  const agencyScope = await resolveListAgencyScope(req, q.agencyIds ?? q.subCompanyId);
  if (!agencyScope) return res.status(403).json({ error: 'Agency context required' });

  const { scopeFilter } = agencyScope;
  const primarySubCompanyId = (await resolveAgencyScope(req)) ?? agencyScope.primarySubCompanyId;
  const detailScope = await resolveClientDetailScope(req, primarySubCompanyId);

  const where: Prisma.FollowUpWhereInput = q.clientId
    ? {
        AND: [{ clientId: q.clientId }, followUpsForClientDetail(detailScope)],
      }
    : { ...scopeFilter };
  if (q.completed === 'true') where.completed = true;
  if (q.completed === 'false') where.completed = false;

  const userId = effectiveActorId(req);
  const ctx = await ensureAccessContext(req);
  const ownerIdsList = q.ownerIds ? q.ownerIds.split(',').filter((id) => /^[0-9a-f-]{36}$/i.test(id)) : [];
  const canUseOwnerIdsFilter = await requestCanUseOwnerIdsFilter(req);
  const seesAgencyWide = ctx ? canViewAllDataInAgency(ctx) : false;
  const seesTeamWide = ctx ? canViewTeamData(ctx) : false;

  if (ownerIdsList.length > 0) {
    const linked = await expandLinkedOwnerScope(req.user!.sub, req.user!.subCompanyId, ownerIdsList, { exact: ownerExactFromQuery(req.query) });
    if (linked) {
      Object.assign(where, linkedExpansionToWhere(linked));
    } else if (canUseOwnerIdsFilter) {
      where.ownerId = { in: ownerIdsList };
    } else {
      where.ownerId = userId;
    }
  } else if (q.ownerId) {
    where.ownerId = q.ownerId;
  } else if (!seesAgencyWide && !seesTeamWide) {
    where.ownerId = userId;
  }

  const skip = (q.page - 1) * q.limit;

  const [rows, total] = await Promise.all([
    prisma.followUp.findMany({
      where,
      skip,
      take: q.limit,
      orderBy: [{ completed: 'asc' }, { dueDate: 'asc' }],
      include: {
        owner: { select: { id: true, firstName: true, lastName: true } },
        client: { select: { id: true, name: true } },
        employee: { select: { id: true, firstName: true, lastName: true } },
        comments: { orderBy: { createdAt: 'desc' } },
        subCompany: { select: { id: true, name: true } },
        forwardedFromUser: { select: { id: true, firstName: true, lastName: true, subCompanyId: true } },
      },
    }),
    prisma.followUp.count({ where }),
  ]);

  const data = rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    employeeId: r.employeeId,
    leadId: r.leadId,
    contactId: r.contactId,
    subCompanyId: r.subCompanyId,
    ownerId: r.ownerId,
    ownerName: `${r.owner.firstName} ${r.owner.lastName}`.trim(),
    dueDate: r.dueDate,
    notes: r.notes,
    completed: r.completed,
    outcome: r.outcome,
    completedAt: r.completedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    clientName: r.client?.name ?? null,
    employeeName: r.employee
      ? `${r.employee.firstName} ${r.employee.lastName}`.trim() || null
      : null,
    subCompanyName: (r as any).subCompany?.name ?? null,
    forwardedFromName: (r as any).forwardedFromUser
      ? `${(r as any).forwardedFromUser.firstName} ${(r as any).forwardedFromUser.lastName}`.trim()
      : null,
    forwardedFromSubCompanyId: (r as any).forwardedFromUser?.subCompanyId ?? null,
    comments: r.comments.map((c) => ({
      id: c.id,
      followUpId: c.followUpId,
      userId: c.userId,
      userName: c.userName,
      content: c.content,
      createdAt: c.createdAt,
    })),
  }));

  return res.json({
    data,
    pagination: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
  });
});

/** POST /follow-ups — create. Owner = current user, subCompanyId from selected/allowed agency scope. */
followUpsRouter.post('/', requirePermission('clients:write', 'employees:write'), async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const parsed = createBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }
  const body = parsed.data;

  let partyLabel = '';
  if (body.clientId) {
    const client = await prisma.client.findFirst({ where: { id: body.clientId } });
    if (!client) return res.status(400).json({ error: 'Client not found' });
    partyLabel = client.name;

    if (body.leadId) {
      const lead = await prisma.lead.findFirst({ where: { id: body.leadId, subCompanyId } });
      if (!lead) return res.status(400).json({ error: 'Lead not found for this agency' });
    }

    if (body.contactId) {
      const contact = await prisma.clientContact.findFirst({
        where: { id: body.contactId, clientId: body.clientId },
      });
      if (!contact) return res.status(400).json({ error: 'Contact not found for this client' });
    }
  } else if (body.employeeId) {
    const employee = await prisma.employee.findFirst({
      where: { id: body.employeeId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!employee) return res.status(400).json({ error: 'Employee not found' });
    partyLabel = `${employee.firstName} ${employee.lastName}`.trim() || 'Employee';
  }

  const followUp = await prisma.followUp.create({
    data: {
      clientId: body.clientId ?? null,
      employeeId: body.employeeId ?? null,
      leadId: body.clientId ? (body.leadId ?? null) : null,
      contactId: body.clientId ? (body.contactId ?? null) : null,
      subCompanyId,
      ownerId: effectiveActorId(req),
      dueDate: new Date(body.dueDate),
      notes: body.notes.trim(),
    },
    include: {
      owner: { select: { id: true, firstName: true, lastName: true } },
      client: { select: { id: true, name: true } },
      employee: { select: { id: true, firstName: true, lastName: true } },
      comments: true,
    },
  });

  const employeeName = followUp.employee
    ? `${followUp.employee.firstName} ${followUp.employee.lastName}`.trim()
    : null;

  await createActivityLog({
    userId: effectiveActorId(req),
    userName: `${followUp.owner.firstName} ${followUp.owner.lastName}`.trim() || req.user!.email,
    subCompanyId,
    type: 'follow_up_created',
    description: `Created follow-up for ${partyLabel}`,
    metadata: {
      clientId: followUp.clientId,
      clientName: followUp.client?.name,
      employeeId: followUp.employeeId,
      employeeName,
      followUpId: followUp.id,
      dueDate: followUp.dueDate,
    },
  });

  dispatchNotificationToUser({
    userId: effectiveActorId(req),
    subCompanyId,
    eventKey: 'follow_up_created',
    context: { clientName: partyLabel },
    link: '/follow-ups',
    relatedId: followUp.id,
  }).catch(() => {});

  emitToUsers([followUp.ownerId], 'followup:refresh', { subCompanyId: followUp.subCompanyId });

  return res.status(201).json({
    id: followUp.id,
    clientId: followUp.clientId,
    employeeId: followUp.employeeId,
    leadId: followUp.leadId,
    contactId: followUp.contactId,
    subCompanyId: followUp.subCompanyId,
    ownerId: followUp.ownerId,
    ownerName: `${followUp.owner.firstName} ${followUp.owner.lastName}`.trim(),
    dueDate: followUp.dueDate,
    notes: followUp.notes,
    completed: followUp.completed,
    outcome: followUp.outcome,
    completedAt: followUp.completedAt,
    createdAt: followUp.createdAt,
    updatedAt: followUp.updatedAt,
    clientName: followUp.client?.name ?? null,
    employeeName,
    comments: [],
  });
});

/** PATCH /follow-ups/:id — update (reschedule, or complete with outcome). */
followUpsRouter.patch('/:id', requirePermission('clients:write', 'employees:write'), async (req: Request, res: Response) => {
  const allowedSubCompanyIds = await resolveAllowedFollowUpAgencyIds(req);
  if (!allowedSubCompanyIds) return res.status(403).json({ error: 'Agency context required' });

  const existing = await prisma.followUp.findFirst({
    where: { id: req.params.id, subCompanyId: { in: allowedSubCompanyIds } },
    include: { owner: true, client: true, employee: true, comments: true },
  });
  if (!existing) return res.status(404).json({ error: 'Follow-up not found' });
  const subCompanyId = existing.subCompanyId;

  const parsed = updateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }
  const data = parsed.data;

  const update: Prisma.FollowUpUpdateInput = {};
  if (data.dueDate !== undefined) update.dueDate = new Date(data.dueDate);
  if (data.notes !== undefined) update.notes = data.notes;
  if (data.completed !== undefined) {
    update.completed = data.completed;
    if (data.completed) update.completedAt = new Date();
  }
  if (data.outcome !== undefined) update.outcome = data.outcome;

  const updated = await prisma.followUp.update({
    where: { id: req.params.id },
    data: update,
    include: {
      owner: { select: { id: true, firstName: true, lastName: true } },
      client: { select: { id: true, name: true } },
      employee: { select: { id: true, firstName: true, lastName: true } },
      comments: true,
    },
  });

  const partyLabel =
    updated.client?.name ??
    (updated.employee
      ? `${updated.employee.firstName} ${updated.employee.lastName}`.trim()
      : 'party');
  const actorName = `${updated.owner.firstName} ${updated.owner.lastName}`.trim() || req.user!.email;
  const logMeta = {
    clientId: updated.clientId,
    clientName: updated.client?.name,
    employeeId: updated.employeeId,
    employeeName: updated.employee
      ? `${updated.employee.firstName} ${updated.employee.lastName}`.trim()
      : null,
    followUpId: updated.id,
  };

  if (data.dueDate !== undefined) {
    void createActivityLog({
      userId: effectiveActorId(req),
      userName: actorName,
      subCompanyId,
      type: 'follow_up_rescheduled',
      description: `Rescheduled follow-up for ${partyLabel} to ${new Date(data.dueDate).toLocaleDateString()}`,
      metadata: { ...logMeta, newDueDate: data.dueDate },
    });
  }

  if (data.completed !== undefined) {
    void createActivityLog({
      userId: effectiveActorId(req),
      userName: actorName,
      subCompanyId,
      type: data.completed ? 'follow_up_completed' : 'follow_up_reopened',
      description: data.completed
        ? `Completed follow-up for ${partyLabel}`
        : `Reopened follow-up for ${partyLabel}`,
      metadata: logMeta,
    });
  }

  emitToUsers([updated.ownerId], 'followup:refresh', { subCompanyId: updated.subCompanyId });

  return res.json({
    id: updated.id,
    clientId: updated.clientId,
    employeeId: updated.employeeId,
    leadId: updated.leadId,
    contactId: updated.contactId,
    subCompanyId: updated.subCompanyId,
    ownerId: updated.ownerId,
    ownerName: `${updated.owner.firstName} ${updated.owner.lastName}`.trim(),
    dueDate: updated.dueDate,
    notes: updated.notes,
    completed: updated.completed,
    outcome: updated.outcome,
    completedAt: updated.completedAt,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
    clientName: updated.client?.name ?? null,
    employeeName: updated.employee
      ? `${updated.employee.firstName} ${updated.employee.lastName}`.trim() || null
      : null,
    comments: updated.comments.map((c) => ({
      id: c.id,
      followUpId: c.followUpId,
      userId: c.userId,
      userName: c.userName,
      content: c.content,
      createdAt: c.createdAt,
    })),
  });
});

/** POST /follow-ups/:id/comments — add a comment (e.g. completion note or reschedule reason). */
followUpsRouter.post('/:id/comments', requirePermission('clients:write', 'employees:write'), async (req: Request, res: Response) => {
  const allowedSubCompanyIds = await resolveAllowedFollowUpAgencyIds(req);
  if (!allowedSubCompanyIds) return res.status(403).json({ error: 'Agency context required' });

  const followUp = await prisma.followUp.findFirst({
    where: { id: req.params.id, subCompanyId: { in: allowedSubCompanyIds } },
  });
  if (!followUp) return res.status(404).json({ error: 'Follow-up not found' });
  const subCompanyId = followUp.subCompanyId;

  const parsed = commentBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }

  const creator = await prisma.user.findUnique({
    where: { id: effectiveActorId(req) },
    select: { firstName: true, lastName: true },
  });
  const userName = creator ? `${creator.firstName} ${creator.lastName}`.trim() : 'User';
  await prisma.followUpComment.create({
    data: {
      followUpId: followUp.id,
      userId: effectiveActorId(req),
      userName,
      content: parsed.data.content.trim(),
    },
  });

  const updated = await prisma.followUp.findUnique({
    where: { id: followUp.id },
    include: {
      owner: { select: { id: true, firstName: true, lastName: true } },
      client: { select: { id: true, name: true } },
      employee: { select: { id: true, firstName: true, lastName: true } },
      comments: true,
    },
  });

  if (!updated) return res.status(500).json({ error: 'Failed to load follow-up' });

  const partyLabel =
    updated.client?.name ??
    (updated.employee
      ? `${updated.employee.firstName} ${updated.employee.lastName}`.trim()
      : 'party');

  void createActivityLog({
    userId: effectiveActorId(req),
    userName,
    subCompanyId,
    type: 'comment_added',
    description: `Commented on follow-up for ${partyLabel}`,
    metadata: {
      clientId: updated.clientId,
      clientName: updated.client?.name,
      employeeId: updated.employeeId,
      followUpId: updated.id,
    },
  });

  return res.json({
    id: updated.id,
    clientId: updated.clientId,
    employeeId: updated.employeeId,
    leadId: updated.leadId,
    contactId: updated.contactId,
    subCompanyId: updated.subCompanyId,
    ownerId: updated.ownerId,
    ownerName: `${updated.owner.firstName} ${updated.owner.lastName}`.trim(),
    dueDate: updated.dueDate,
    notes: updated.notes,
    completed: updated.completed,
    outcome: updated.outcome,
    completedAt: updated.completedAt,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
    clientName: updated.client?.name ?? null,
    employeeName: updated.employee
      ? `${updated.employee.firstName} ${updated.employee.lastName}`.trim() || null
      : null,
    comments: updated.comments.map((c) => ({
      id: c.id,
      followUpId: c.followUpId,
      userId: c.userId,
      userName: c.userName,
      content: c.content,
      createdAt: c.createdAt,
    })),
  });
});
