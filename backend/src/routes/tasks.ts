/**
 * Tasks API: list (agency-scoped, role-based), create, update, delete, comments.
 * Creator = assignedBy; assignee = owner. Associates can only assign to self; managers+ to anyone in agency.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { TaskPriority, TaskStatus, TaskLinkType } from '@prisma/client';
import prisma from '../config/database';
import type { Prisma } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { actAsMiddleware, effectiveActorId } from '../middleware/actAs';
import { requirePermission } from '../middleware/requirePermission';
import { dispatchNotificationToUser, notifyTaskAssigned } from '../services/notificationDispatch';
import { createActivityLog } from '../services/activityLog';
import { emitToUsers } from '../socket';
import { resolveAgencyScope, resolveListAgencyScope } from '../config/agencyScope';
import {
  assertCanAssignTaskToUser,
  buildOwnerIdFilterForList,
  canAssignTasksToOthers,
} from '../services/listOwnerScope';
import { expandLinkedOwnerScope, linkedExpansionToWhere, ownerExactFromQuery } from '../services/linkedOwnerExpand';
import { uploadToR2, getFromR2, deleteFromR2 } from '../services/r2Storage';
import { env } from '../config/env';


const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(500).default(50),
  status: z.nativeEnum(TaskStatus).optional(),
  ownerId: z.string().uuid().optional(),
  subCompanyId: z.string().uuid().optional(), // legacy single-agency param (kept for compat)
  agencyIds: z.string().optional(),           // new: comma-separated UUIDs for multi-select
  ownerIds: z.string().optional(),            // multi-user filter: comma-separated UUIDs
  scope: z.enum(['mine', 'team', 'all']).optional(),
});

const createBodySchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional(),
  dueDate: z.string().datetime(), // ISO with time
  priority: z.nativeEnum(TaskPriority).default('medium'),
  ownerId: z.string().uuid(),
  linkType: z.nativeEnum(TaskLinkType).optional().nullable(),
  linkId: z.string().uuid().optional().nullable(),
});

const updateBodySchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).optional().nullable(),
  dueDate: z.string().datetime().optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  ownerId: z.string().uuid().optional(),
  linkType: z.nativeEnum(TaskLinkType).optional().nullable(),
  linkId: z.string().uuid().optional().nullable(),
});

export const tasksRouter = Router();
tasksRouter.use(authenticate);
tasksRouter.use(actAsMiddleware);
tasksRouter.use(requirePermission('tasks:read'));

async function resolveAllowedTaskAgencyIds(req: Request): Promise<string[] | null> {
  const scope = await resolveListAgencyScope(req);
  return scope?.allowedIds ?? null;
}

/** GET /tasks — list tasks. Elevated roles see across all agencies (with optional agencyIds filter). Others see own agency. */
tasksRouter.get('/', async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  const q = parsed.success ? parsed.data : { page: 1, limit: 50 };

  const agencyScope = await resolveListAgencyScope(req, q.agencyIds ?? q.subCompanyId);
  if (!agencyScope) return res.status(403).json({ error: 'Agency context required' });

  const { scopeFilter, primarySubCompanyId } = agencyScope;

  const where: Prisma.TaskWhereInput = { ...scopeFilter };
  if (q.status) where.status = q.status;

  const userId = effectiveActorId(req);
  const ownerIdsList = q.ownerIds ? q.ownerIds.split(',').filter((id) => /^[0-9a-f-]{36}$/i.test(id)) : [];
  // Expand against the real caller’s link group (not act-as identity).
  const linked = ownerIdsList.length > 0
    ? await expandLinkedOwnerScope(req.user!.sub, req.user!.subCompanyId, ownerIdsList, { exact: ownerExactFromQuery(req.query) })
    : null;
  if (linked) {
    Object.assign(where, linkedExpansionToWhere(linked));
  } else {
    const ownerFilter = await buildOwnerIdFilterForList(req, {
      userId,
      primarySubCompanyId,
      scope: q.scope,
      explicitOwnerId: q.ownerId,
      ownerIdsList,
    });
    if (ownerFilter !== undefined) where.ownerId = ownerFilter;
  }

  const skip = (q.page - 1) * q.limit;

  const [tasks, total] = await Promise.all([
    (prisma.task.findMany as any)({
      where,
      skip,
      take: q.limit,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      include: {
        owner: { select: { id: true, firstName: true, lastName: true, email: true } },
        assignedBy: { select: { id: true, firstName: true, lastName: true } },
        comments: { orderBy: { createdAt: 'asc' } },
        attachments: { orderBy: { createdAt: 'asc' } },
        subCompany: { select: { id: true, name: true } },
        forwardedFromUser: { select: { firstName: true, lastName: true, subCompanyId: true } },
      },
    }),
    prisma.task.count({ where }),
  ]);

  // Resolve linked client/lead details for all tasks
  const linkedClientIds = tasks.filter((t: any) => t.linkType === 'client' && t.linkId).map((t: any) => t.linkId!);
  const linkedLeadIds = tasks.filter((t: any) => t.linkType === 'lead' && t.linkId).map((t: any) => t.linkId!);

  const [linkedClients, linkedLeads] = await Promise.all([
    linkedClientIds.length > 0
      ? prisma.client.findMany({
          where: { id: { in: linkedClientIds } },
          select: { id: true, name: true, industry: true, location: true, status: true },
        })
      : [],
    linkedLeadIds.length > 0
      ? prisma.lead.findMany({
          where: { id: { in: linkedLeadIds } },
          include: {
            client: { select: { id: true, name: true, industry: true, location: true, status: true } },
            owner: { select: { id: true, firstName: true, lastName: true } },
          },
        })
      : [],
  ]);

  const clientMap = new Map(linkedClients.map(c => [c.id, c]));
  const leadMap = new Map(linkedLeads.map(l => [l.id, l]));

  const data = tasks.map((t: any) => {
    let linkedClient = null;
    let linkedLead = null;

    if (t.linkType === 'client' && t.linkId) {
      const c = clientMap.get(t.linkId);
      if (c) linkedClient = { id: c.id, name: c.name, industry: c.industry, location: c.location, status: c.status };
    } else if (t.linkType === 'lead' && t.linkId) {
      const l = leadMap.get(t.linkId);
      if (l) {
        linkedLead = {
          id: l.id,
          stage: l.stage,
          status: l.status,
          temperature: l.temperature,
          ownerName: `${l.owner.firstName} ${l.owner.lastName}`.trim(),
          clientId: l.clientId,
          clientName: l.client.name,
          clientIndustry: l.client.industry,
          clientLocation: l.client.location,
        };
      }
    }

    return {
      id: t.id,
      title: t.title,
      description: t.description,
      dueDate: t.dueDate,
      priority: t.priority,
      status: t.status,
      ownerId: t.ownerId,
      ownerName: `${t.owner.firstName} ${t.owner.lastName}`.trim(),
      assignedById: t.assignedById,
      assignedByName: `${t.assignedBy.firstName} ${t.assignedBy.lastName}`.trim(),
      subCompanyId: t.subCompanyId,
      subCompanyName: (t as any).subCompany?.name ?? null,
      forwardedFromName: (t as any).forwardedFromUser
        ? `${(t as any).forwardedFromUser.firstName ?? ''} ${(t as any).forwardedFromUser.lastName ?? ''}`.trim() || null
        : null,
      forwardedFromSubCompanyId: (t as any).forwardedFromUser?.subCompanyId ?? null,
      linkType: t.linkType,
      linkId: t.linkId,
      reminderEnabled: t.reminderEnabled,
      reminderDate: t.reminderDate,
      completedAt: t.completedAt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      linkedClient,
      linkedLead,
      comments: t.comments.map((c: any) => ({
        id: c.id,
        taskId: c.taskId,
        userId: c.userId,
        userName: c.userName,
        content: c.content,
        createdAt: c.createdAt,
      })),
      attachments: (t as any).attachments?.map((a: any) => ({
        id: a.id,
        taskId: a.taskId,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        uploadedBy: a.uploadedBy,
        createdAt: a.createdAt,
      })) ?? [],
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

/** POST /tasks — create task. Creator = current user (assignedBy). Associates can only set ownerId = self. */
tasksRouter.post('/', requirePermission('tasks:write'), async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const parsed = createBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }
  const data = parsed.data;

  const canAssignAny = await canAssignTasksToOthers(req);
  const actorId = effectiveActorId(req);
  const ownerId = canAssignAny ? data.ownerId : actorId;
  if (!canAssignAny && ownerId !== actorId) {
    return res.status(403).json({ error: 'You can only create tasks for yourself' });
  }

  const owner = await prisma.user.findFirst({
    where: { id: ownerId, subCompanyId, isActive: true },
  });
  if (!owner) {
    return res.status(400).json({ error: 'Assignee must be an active user in your agency' });
  }

  if (ownerId !== actorId) {
    const assignErr = await assertCanAssignTaskToUser(req, {
      role: owner.role,
      reportingManagerIds: owner.reportingManagerIds as string[] | null,
    });
    if (assignErr) {
      return res.status(403).json({ error: assignErr });
    }
  }

  if (data.linkType && data.linkId) {
    if (data.linkType === 'client') {
      const client = await prisma.client.findFirst({
        where: { id: data.linkId },
      });
      if (!client) return res.status(400).json({ error: 'Invalid client' });
    } else if (data.linkType === 'lead') {
      const lead = await prisma.lead.findFirst({
        where: { id: data.linkId, subCompanyId },
      });
      if (!lead) return res.status(400).json({ error: 'Invalid lead for this agency' });
    }
  }

  const task = await prisma.task.create({
    data: {
      title: data.title.trim(),
      description: data.description?.trim() ?? null,
      dueDate: new Date(data.dueDate),
      priority: data.priority,
      status: 'to_do',
      ownerId,
      assignedById: actorId,
      subCompanyId,
      linkType: data.linkType ?? null,
      linkId: data.linkId ?? null,
    },
    include: {
      owner: { select: { id: true, firstName: true, lastName: true, email: true } },
      assignedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  const assigneeId = task.ownerId;
  const assignerName = `${task.assignedBy.firstName} ${task.assignedBy.lastName}`.trim();

  void createActivityLog({
    userId: actorId,
    userName: assignerName,
    subCompanyId,
    type: 'task_created',
    description: `Created task '${task.title}'`,
    metadata: {
      taskId: task.id,
      title: task.title,
      clientId: task.linkType === 'client' && task.linkId ? task.linkId : undefined,
    },
  });

  notifyTaskAssigned({
    assigneeId,
    actorUserId: actorId,
    subCompanyId,
    taskId: task.id,
    taskTitle: task.title,
    taskPriority: task.priority,
    dueDate: task.dueDate,
    assignerName,
  });

  // Socket: trigger task list refresh for assignee, real caller, and act-as user
  const refreshIds = [...new Set([assigneeId, actorId, req.user!.sub])];
  emitToUsers(refreshIds, 'task:refresh', { subCompanyId });

  const payload = {
    id: task.id,
    title: task.title,
    description: task.description,
    dueDate: task.dueDate,
    priority: task.priority,
    status: task.status,
    ownerId: task.ownerId,
    ownerName: `${task.owner.firstName} ${task.owner.lastName}`.trim(),
    assignedById: task.assignedById,
    assignedByName: assignerName,
    subCompanyId: task.subCompanyId,
    linkType: task.linkType,
    linkId: task.linkId,
    reminderEnabled: task.reminderEnabled,
    reminderDate: task.reminderDate,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };

  return res.status(201).json(payload);
});

/** PATCH /tasks/:id — update task. Owner change only if manager+. */
tasksRouter.patch('/:id', requirePermission('tasks:write'), async (req: Request, res: Response) => {
  const allowedSubCompanyIds = await resolveAllowedTaskAgencyIds(req);
  if (!allowedSubCompanyIds) return res.status(403).json({ error: 'Agency context required' });

  const existing = await prisma.task.findFirst({
    where: { id: req.params.id, subCompanyId: { in: allowedSubCompanyIds } },
  });
  if (!existing) return res.status(404).json({ error: 'Task not found' });
  const subCompanyId = existing.subCompanyId;

  const parsed = updateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }
  const data = parsed.data;

  const canAssignAny = await canAssignTasksToOthers(req);
  const actorId = effectiveActorId(req);
  if (data.ownerId !== undefined) {
    if (!canAssignAny && data.ownerId !== actorId) {
      return res.status(403).json({ error: 'You can only assign tasks to yourself' });
    }
    const owner = await prisma.user.findFirst({
      where: { id: data.ownerId, subCompanyId, isActive: true },
    });
    if (!owner) return res.status(400).json({ error: 'Assignee must be an active user in your agency' });
    if (data.ownerId !== actorId) {
      const assignErr = await assertCanAssignTaskToUser(req, {
        role: owner.role,
        reportingManagerIds: owner.reportingManagerIds as string[] | null,
      });
      if (assignErr) return res.status(403).json({ error: assignErr });
    }
  }

  if (data.linkType !== undefined && data.linkId !== undefined && data.linkType && data.linkId) {
    if (data.linkType === 'client') {
      const client = await prisma.client.findFirst({ where: { id: data.linkId } });
      if (!client) return res.status(400).json({ error: 'Invalid client' });
    } else if (data.linkType === 'lead') {
      const lead = await prisma.lead.findFirst({ where: { id: data.linkId, subCompanyId } });
      if (!lead) return res.status(400).json({ error: 'Invalid lead for this agency' });
    }
  }

  const update: Prisma.TaskUpdateInput = {};
  if (data.title !== undefined) update.title = data.title.trim();
  if (data.description !== undefined) update.description = data.description;
  if (data.dueDate !== undefined) update.dueDate = new Date(data.dueDate);
  if (data.priority !== undefined) update.priority = data.priority;
  if (data.status !== undefined) {
    update.status = data.status;
    if (data.status === 'done') update.completedAt = new Date();
  }
  if (data.ownerId !== undefined) update.owner = { connect: { id: data.ownerId } };
  if (data.linkType !== undefined) update.linkType = data.linkType;
  if (data.linkId !== undefined) update.linkId = data.linkId;

  const task = await prisma.task.update({
    where: { id: req.params.id },
    data: update,
    include: {
      owner: { select: { id: true, firstName: true, lastName: true, email: true } },
      assignedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  const newOwnerId = task.ownerId;
  if (data.ownerId !== undefined && newOwnerId !== req.user!.sub && newOwnerId !== existing.ownerId) {
    const actor = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: { firstName: true, lastName: true },
    });
    const assignerName = actor
      ? (`${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim() || 'A manager')
      : 'A manager';
    notifyTaskAssigned({
      assigneeId: newOwnerId,
      actorUserId: effectiveActorId(req),
      subCompanyId,
      taskId: task.id,
      taskTitle: task.title,
      taskPriority: task.priority,
      dueDate: task.dueDate,
      assignerName,
    });
  }

  // Notify relevant parties when task is marked done (fire-and-forget, never block response)
  if (data.status === 'done') {
    const actorId = effectiveActorId(req);
    const taskRef = { id: task.id, title: task.title, ownerId: task.ownerId, assignedById: task.assignedById, owner: task.owner, assignedBy: task.assignedBy };
    void (async () => {
      try {
        // Dedup: skip if a task_completed notification already exists for this task
        const alreadySent = await prisma.notification.count({
          where: { type: 'task_completed', relatedId: taskRef.id },
        });
        if (alreadySent > 0) return;

        let actorName: string;
        if (actorId === taskRef.ownerId) {
          actorName = `${taskRef.owner.firstName} ${taskRef.owner.lastName}`.trim() || 'Someone';
        } else if (actorId === taskRef.assignedById) {
          actorName = `${taskRef.assignedBy.firstName} ${taskRef.assignedBy.lastName}`.trim() || 'Someone';
        } else {
          const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { firstName: true, lastName: true } });
          actorName = actor ? (`${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim() || 'A manager') : 'A manager';
        }
        // Notify creator if they didn't mark it done
        if (taskRef.assignedById !== actorId) {
          await dispatchNotificationToUser({
            userId: taskRef.assignedById,
            subCompanyId,
            eventKey: 'task_completed_creator',
            context: { taskTitle: taskRef.title, actorName },
            link: `/tasks?openTask=${taskRef.id}`,
            relatedId: taskRef.id,
          });
        }
        // Notify owner if they didn't mark it done AND owner is different from creator
        if (taskRef.ownerId !== actorId && taskRef.ownerId !== taskRef.assignedById) {
          await dispatchNotificationToUser({
            userId: taskRef.ownerId,
            subCompanyId,
            eventKey: 'task_completed_owner',
            context: { taskTitle: taskRef.title, actorName },
            link: `/tasks?openTask=${taskRef.id}`,
            relatedId: taskRef.id,
          });
        }
      } catch (err) {
        console.error('[task_completed notification]', err);
      }
    })();
  }

  const taskActorId = effectiveActorId(req);
  if (data.status !== undefined) {
    const isCompleted = data.status === 'done' && existing.status !== 'done';
    let actorNameForLog: string;
    if (taskActorId === task.ownerId) {
      actorNameForLog = `${task.owner.firstName} ${task.owner.lastName}`.trim() || 'User';
    } else if (taskActorId === task.assignedById) {
      actorNameForLog = `${task.assignedBy.firstName} ${task.assignedBy.lastName}`.trim() || 'User';
    } else {
      actorNameForLog = 'User';
    }
    void createActivityLog({
      userId: taskActorId,
      userName: actorNameForLog,
      subCompanyId,
      type: isCompleted ? 'task_completed' : 'task_status_changed',
      description: isCompleted
        ? `Completed task '${task.title}'`
        : `Updated task '${task.title}' status to '${task.status}'`,
      metadata: {
        taskId: task.id,
        title: task.title,
        oldStatus: existing.status,
        newStatus: task.status,
        clientId: task.linkType === 'client' && task.linkId ? task.linkId : undefined,
      },
    });
  }

  // Socket: trigger task refresh for all relevant parties (include act-as user so their dashboard updates)
  const patchRefreshIds = [...new Set([task.ownerId, existing.ownerId, task.assignedById, taskActorId, req.user!.sub])];
  emitToUsers(patchRefreshIds, 'task:refresh', { subCompanyId });

  return res.json({
    id: task.id,
    title: task.title,
    description: task.description,
    dueDate: task.dueDate,
    priority: task.priority,
    status: task.status,
    ownerId: task.ownerId,
    ownerName: `${task.owner.firstName} ${task.owner.lastName}`.trim(),
    assignedById: task.assignedById,
    assignedByName: `${task.assignedBy.firstName} ${task.assignedBy.lastName}`.trim(),
    subCompanyId: task.subCompanyId,
    linkType: task.linkType,
    linkId: task.linkId,
    reminderEnabled: task.reminderEnabled,
    reminderDate: task.reminderDate,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  });
});

/** GET /tasks/:id — get single task with comments (e.g. for opening from notification). */
tasksRouter.get('/:id', async (req: Request, res: Response) => {
  const allowedSubCompanyIds = await resolveAllowedTaskAgencyIds(req);
  if (!allowedSubCompanyIds) return res.status(403).json({ error: 'Agency context required' });

  const task = await (prisma.task.findFirst as any)({
    where: { id: req.params.id, subCompanyId: { in: allowedSubCompanyIds } },
    include: {
      owner: { select: { id: true, firstName: true, lastName: true, email: true } },
      assignedBy: { select: { id: true, firstName: true, lastName: true } },
      comments: { orderBy: { createdAt: 'asc' } },
      attachments: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (!(await canAssignTasksToOthers(req)) && task.ownerId !== effectiveActorId(req)) {
    return res.status(403).json({ error: 'You can only view your own tasks' });
  }

  // Resolve linked entity details
  let linkedClient = null;
  let linkedLead = null;

  if (task.linkType === 'client' && task.linkId) {
    const c = await prisma.client.findFirst({
      where: { id: task.linkId },
      select: { id: true, name: true, industry: true, location: true, status: true },
    });
    if (c) linkedClient = { id: c.id, name: c.name, industry: c.industry, location: c.location, status: c.status };
  } else if (task.linkType === 'lead' && task.linkId) {
    const l = await prisma.lead.findFirst({
      where: { id: task.linkId },
      include: {
        client: { select: { id: true, name: true, industry: true, location: true, status: true } },
        owner: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (l) {
      linkedLead = {
        id: l.id,
        stage: l.stage,
        status: l.status,
        temperature: l.temperature,
        ownerName: `${l.owner.firstName} ${l.owner.lastName}`.trim(),
        clientId: l.clientId,
        clientName: l.client.name,
        clientIndustry: l.client.industry,
        clientLocation: l.client.location,
      };
    }
  }

  return res.json({
    id: task.id,
    title: task.title,
    description: task.description,
    dueDate: task.dueDate,
    priority: task.priority,
    status: task.status,
    ownerId: task.ownerId,
    ownerName: `${task.owner.firstName} ${task.owner.lastName}`.trim(),
    assignedById: task.assignedById,
    assignedByName: `${task.assignedBy.firstName} ${task.assignedBy.lastName}`.trim(),
    subCompanyId: task.subCompanyId,
    linkType: task.linkType,
    linkId: task.linkId,
    reminderEnabled: task.reminderEnabled,
    reminderDate: task.reminderDate,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    linkedClient,
    linkedLead,
    comments: task.comments.map((c: any) => ({
      id: c.id,
      taskId: c.taskId,
      userId: c.userId,
      userName: c.userName,
      content: c.content,
      createdAt: c.createdAt,
    })),
    attachments: (task as any).attachments?.map((a: any) => ({
      id: a.id,
      taskId: a.taskId,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      uploadedBy: a.uploadedBy,
      createdAt: a.createdAt,
    })) ?? [],
  });
});

const attachmentUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  data: z.string().min(1), // base64
});

/** POST /tasks/:id/attachments — upload a file attachment. */
tasksRouter.post('/:id/attachments', requirePermission('tasks:write'), async (req: Request, res: Response) => {
  const allowedSubCompanyIds = await resolveAllowedTaskAgencyIds(req);
  if (!allowedSubCompanyIds) return res.status(403).json({ error: 'Agency context required' });

  const task = await prisma.task.findFirst({ where: { id: req.params.id, subCompanyId: { in: allowedSubCompanyIds } } });
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const parsed = attachmentUploadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });

  const { filename, mimeType, data } = parsed.data;
  const maxSize = parseInt(env.MAX_FILE_SIZE ?? '10485760', 10);
  let buffer: Buffer;
  try {
    buffer = Buffer.from(data, 'base64');
  } catch {
    return res.status(400).json({ error: 'Invalid base64 content' });
  }
  if (buffer.length > maxSize) {
    return res.status(400).json({ error: `File too large (max ${Math.round(maxSize / 1024 / 1024)}MB)` });
  }

  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `task-attachments/${task.id}/${Date.now()}-${safeFilename}`;
  const fileUrl = await uploadToR2(key, buffer, mimeType);

  const attachment = await (prisma as any).taskAttachment.create({
    data: {
      taskId: task.id,
      filename,
      fileKey: fileUrl ?? key,
      mimeType,
      size: buffer.length,
      uploadedBy: effectiveActorId(req),
    },
  });

  return res.status(201).json({
    id: attachment.id,
    taskId: attachment.taskId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.size,
    uploadedBy: attachment.uploadedBy,
    createdAt: attachment.createdAt,
  });
});

/** GET /tasks/:id/attachments/:attachmentId/download — download a file. */
tasksRouter.get('/:id/attachments/:attachmentId/download', async (req: Request, res: Response) => {
  const allowedSubCompanyIds = await resolveAllowedTaskAgencyIds(req);
  if (!allowedSubCompanyIds) return res.status(403).json({ error: 'Agency context required' });

  const attachment = await (prisma as any).taskAttachment.findFirst({
    where: { id: req.params.attachmentId, taskId: req.params.id },
    include: { task: { select: { subCompanyId: true } } },
  });
  if (!attachment || !allowedSubCompanyIds.includes(attachment.task.subCompanyId)) {
    return res.status(404).json({ error: 'Attachment not found' });
  }

  const result = await getFromR2(attachment.fileKey);
  if (!result) return res.status(503).json({ error: 'File not available' });

  res.setHeader('Content-Type', result.contentType ?? attachment.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.filename)}"`);
  res.setHeader('Content-Length', String(result.body.length));
  return res.end(result.body);
});

/** DELETE /tasks/:id/attachments/:attachmentId — remove attachment. */
tasksRouter.delete('/:id/attachments/:attachmentId', requirePermission('tasks:write'), async (req: Request, res: Response) => {
  const allowedSubCompanyIds = await resolveAllowedTaskAgencyIds(req);
  if (!allowedSubCompanyIds) return res.status(403).json({ error: 'Agency context required' });

  const attachment = await (prisma as any).taskAttachment.findFirst({
    where: { id: req.params.attachmentId, taskId: req.params.id },
    include: { task: { select: { subCompanyId: true } } },
  });
  if (!attachment || !allowedSubCompanyIds.includes(attachment.task.subCompanyId)) {
    return res.status(404).json({ error: 'Attachment not found' });
  }

  await (prisma as any).taskAttachment.delete({ where: { id: attachment.id } });
  void deleteFromR2(attachment.fileKey);

  return res.status(204).send();
});

const addCommentBodySchema = z.object({
  content: z.string().min(1).max(10000),
});

/** POST /tasks/:id/comments — add comment; notify task creator and owner (except the commenter). */
tasksRouter.post('/:id/comments', requirePermission('tasks:write'), async (req: Request, res: Response) => {
  const allowedSubCompanyIds = await resolveAllowedTaskAgencyIds(req);
  const userId = req.user?.sub;
  if (!allowedSubCompanyIds || !userId) return res.status(403).json({ error: 'Agency context required' });

  const task = await prisma.task.findFirst({
    where: { id: req.params.id, subCompanyId: { in: allowedSubCompanyIds } },
    include: {
      assignedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const subCompanyId = task.subCompanyId;

  const parsed = addCommentBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }

  const commenter = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true },
  });
  const commenterName = commenter
    ? `${commenter.firstName ?? ''} ${commenter.lastName ?? ''}`.trim() || 'Someone'
    : 'Someone';

  const comment = await prisma.taskComment.create({
    data: {
      taskId: task.id,
      userId,
      userName: commenterName,
      content: parsed.data.content.trim(),
    },
  });

  const creatorId = task.assignedById;
  const ownerId = task.ownerId;
  const snippet = parsed.data.content.trim().slice(0, 80) + (parsed.data.content.length > 80 ? '…' : '');
  // Notify creator if they're not the commenter
  if (creatorId !== userId) {
    await dispatchNotificationToUser({
      userId: creatorId,
      subCompanyId,
      eventKey: 'task_comment',
      context: { taskTitle: task.title, actorName: commenterName, commentSnippet: snippet },
      link: `/tasks?openTask=${task.id}`,
      relatedId: task.id,
    });
  }
  // Notify owner if they're not the commenter AND not already notified as creator
  if (ownerId !== userId && ownerId !== creatorId) {
    await dispatchNotificationToUser({
      userId: ownerId,
      subCompanyId,
      eventKey: 'task_comment',
      context: { taskTitle: task.title, actorName: commenterName, commentSnippet: snippet },
      link: `/tasks?openTask=${task.id}`,
      relatedId: task.id,
    });
  }

  void createActivityLog({
    userId,
    userName: commenterName,
    subCompanyId,
    type: 'comment_added',
    description: `Commented on task '${task.title}'`,
    metadata: {
      taskId: task.id,
      title: task.title,
      commentId: comment.id,
      clientId: task.linkType === 'client' && task.linkId ? task.linkId : undefined,
    },
  });

  const commentPayload = {
    id: comment.id,
    taskId: comment.taskId,
    userId: comment.userId,
    userName: comment.userName,
    content: comment.content,
    createdAt: comment.createdAt,
  };
  const recipientIds = [ownerId, creatorId].filter((id) => id !== userId);
  const uniqueRecipients = [...new Set(recipientIds)];
  if (uniqueRecipients.length > 0) {
    emitToUsers(uniqueRecipients, 'task:comment', { taskId: task.id, comment: commentPayload });
  }

  return res.status(201).json(commentPayload);
});

/** DELETE /tasks/:id */
tasksRouter.delete('/:id', requirePermission('tasks:write'), async (req: Request, res: Response) => {
  const allowedSubCompanyIds = await resolveAllowedTaskAgencyIds(req);
  if (!allowedSubCompanyIds) return res.status(403).json({ error: 'Agency context required' });

  const task = await prisma.task.findFirst({
    where: { id: req.params.id, subCompanyId: { in: allowedSubCompanyIds } },
  });
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const subCompanyId = task.subCompanyId;

  await prisma.task.delete({ where: { id: req.params.id } });

  // Socket: trigger task refresh for owner and creator
  const deleteRefreshIds = [...new Set([task.ownerId, task.assignedById])].filter(Boolean);
  emitToUsers(deleteRefreshIds, 'task:refresh', { subCompanyId });

  return res.status(204).send();
});
