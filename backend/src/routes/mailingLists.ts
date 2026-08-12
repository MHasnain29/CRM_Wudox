/**
 * Mailing Lists API — CRUD for lists and their client members.
 * Scoped to subCompanyId.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { actAsMiddleware, effectiveActorId } from '../middleware/actAs';
import { requirePermission } from '../middleware/requirePermission';
import { resolveAllowedSubCompanyIds, resolveAgencyScope } from '../config/agencyScope';
import { attachAccessContext } from '../utils/requestPermission';
import { canViewTeamData } from '../services/accessContext';
import { expandLinkedOwnerScope, ownerExactFromQuery } from '../services/linkedOwnerExpand';
import {
  assertCanAssignList,
  resolveAssignableUsers,
  canEditListMembers,
} from '../services/mailingListAssignment';
import { notifyListAssigned } from '../services/notificationDispatch';

export const mailingListsRouter = Router();

/** Shared Prisma include for list responses. */
const listInclude = {
  _count: { select: { members: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  assignments: {
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  },
} as const;

type ListWithRelations = {
  id: string;
  subCompanyId: string;
  name: string;
  description: string | null;
  isArchived: boolean;
  createdAt: Date;
  createdBy: { id: string; firstName: string; lastName: string } | null;
  assignments: { user: { id: string; firstName: string; lastName: string } }[];
  _count: { members: number };
};

function toListDto(l: ListWithRelations) {
  return {
    id: l.id,
    subCompanyId: l.subCompanyId,
    createdBy: l.createdBy
      ? { id: l.createdBy.id, firstName: l.createdBy.firstName, lastName: l.createdBy.lastName }
      : null,
    assignedTo: l.assignments.map((a) => ({
      id: a.user.id,
      firstName: a.user.firstName,
      lastName: a.user.lastName,
    })),
    name: l.name,
    description: l.description,
    isArchived: l.isArchived,
    memberCount: l._count.members,
    createdAt: l.createdAt,
  };
}
mailingListsRouter.use(authenticate);
mailingListsRouter.use(actAsMiddleware);
mailingListsRouter.use(attachAccessContext);

const createSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  createdById: z.string().uuid().optional(), // optional override for sync on behalf of another user
});

/** GET /lists — all lists for the agency */
mailingListsRouter.get('/', requirePermission('clients:read'), async (req: Request, res: Response) => {
  const scopedSubCompanyId = typeof req.query.subCompanyId === 'string'
    ? await resolveAgencyScope(req)
    : null;
  const allowedIds = scopedSubCompanyId ? [scopedSubCompanyId] : await resolveAllowedSubCompanyIds(req.user!);
  if (allowedIds.length === 0) return res.status(403).json({ error: 'Agency context required' });

  const createdByIdFilter = typeof req.query.createdById === 'string' ? req.query.createdById : undefined;
  const createdByIdsFilter = typeof req.query.createdByIds === 'string'
    ? req.query.createdByIds.split(',').filter((id) => /^[0-9a-f-]{36}$/i.test(id))
    : [];

  // Expand to linked agencies when a linked-user filter is active
  let effectiveAllowedIds = allowedIds;
  let effectiveCreatedByIds = createdByIdsFilter;
  if (createdByIdsFilter.length > 0) {
    const linked = await expandLinkedOwnerScope(req.user!.sub, req.user!.subCompanyId, createdByIdsFilter, { exact: ownerExactFromQuery(req.query) });
    if (linked) {
      effectiveAllowedIds = linked.subCompanyIds;
      effectiveCreatedByIds = linked.mode === 'agencies' ? [] : linked.userIds;
    }
  }

  // An owner filter must also surface lists the filtered user is assigned to (not just created).
  const ownerFilterIds = effectiveCreatedByIds.length > 0
    ? effectiveCreatedByIds
    : createdByIdFilter
      ? [createdByIdFilter]
      : null;

  const lists = await prisma.mailingList.findMany({
    where: {
      subCompanyId: { in: effectiveAllowedIds },
      ...(ownerFilterIds
        ? {
            OR: [
              { createdById: { in: ownerFilterIds } },
              { assignments: { some: { userId: { in: ownerFilterIds } } } },
            ],
          }
        : {}),
    },
    include: listInclude,
    orderBy: { createdAt: 'desc' },
  });

  return res.json({ data: lists.map(toListDto) });
});

/** POST /lists — create a list */
mailingListsRouter.post('/', requirePermission('clients:write'), async (req: Request, res: Response) => {
  const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
  if (allowedIds.length === 0) return res.status(403).json({ error: 'Agency context required' });

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId || !allowedIds.includes(subCompanyId)) {
    return res.status(403).json({ error: 'Agency context required' });
  }

  const authUserId = effectiveActorId(req);
  let createdById = authUserId;
  if (parsed.data.createdById && parsed.data.createdById !== authUserId) {
    const creator = await prisma.user.findUnique({
      where: { id: parsed.data.createdById },
      select: { id: true },
    });
    if (creator) createdById = creator.id;
  }

  const list = await prisma.mailingList.create({
    data: { name: parsed.data.name, description: parsed.data.description, subCompanyId, createdById },
    include: listInclude,
  });

  return res.status(201).json(toListDto(list));
});

/** PATCH /lists/:id */
mailingListsRouter.patch('/:id', requirePermission('clients:write'), async (req: Request, res: Response) => {
  const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
  if (allowedIds.length === 0) return res.status(403).json({ error: 'Agency context required' });

  const parsed = createSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

  const existing = await prisma.mailingList.findFirst({ where: { id: req.params.id, subCompanyId: { in: allowedIds } } });
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const updated = await prisma.mailingList.update({ where: { id: req.params.id }, data: parsed.data, include: listInclude });
  return res.json(toListDto(updated));
});

/** DELETE /lists/:id */
mailingListsRouter.delete('/:id', requirePermission('clients:write'), async (req: Request, res: Response) => {
  const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
  if (allowedIds.length === 0) return res.status(403).json({ error: 'Agency context required' });

  if (!req.access || !canViewTeamData(req.access)) {
    return res.status(403).json({ error: 'Only managers or above can delete mailing lists' });
  }

  const existing = await prisma.mailingList.findFirst({ where: { id: req.params.id, subCompanyId: { in: allowedIds } } });
  if (!existing) return res.status(404).json({ error: 'Not found' });

  await prisma.mailingList.delete({ where: { id: req.params.id } });
  return res.json({ success: true });
});

const assignSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(100).optional(),
  userId: z.string().uuid().optional(),
}).refine((d) => d.userId || (d.userIds && d.userIds.length > 0), { message: 'userId or userIds required' });

/** GET /lists/:id/assignable-users — users the creator may assign this list to */
mailingListsRouter.get('/:id/assignable-users', requirePermission('lists:assign'), async (req: Request, res: Response) => {
  const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
  if (allowedIds.length === 0) return res.status(403).json({ error: 'Agency context required' });

  const list = await prisma.mailingList.findFirst({ where: { id: req.params.id, subCompanyId: { in: allowedIds } } });
  if (!list) return res.status(404).json({ error: 'Not found' });
  if (list.createdById !== effectiveActorId(req)) {
    return res.status(403).json({ error: 'You can only assign lists you created' });
  }

  const users = await resolveAssignableUsers(req, list);
  return res.json({ data: users });
});

/** POST /lists/:id/assignees — add one or more assignees (creator only) */
mailingListsRouter.post('/:id/assignees', requirePermission('lists:assign'), async (req: Request, res: Response) => {
  const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
  if (allowedIds.length === 0) return res.status(403).json({ error: 'Agency context required' });

  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

  const list = await prisma.mailingList.findFirst({ where: { id: req.params.id, subCompanyId: { in: allowedIds } } });
  if (!list) return res.status(404).json({ error: 'Not found' });

  const targetIds = [...new Set(parsed.data.userIds ?? [parsed.data.userId!])];

  // Validate every target before writing anything.
  for (const targetId of targetIds) {
    const err = await assertCanAssignList(req, list, targetId);
    if (err) return res.status(403).json({ error: err });
  }

  const actorId = effectiveActorId(req);
  await prisma.$transaction(
    targetIds.map((userId) =>
      prisma.mailingListAssignment.upsert({
        where: { listId_userId: { listId: list.id, userId } },
        create: { listId: list.id, userId, assignedById: actorId },
        update: {},
      }),
    ),
  );

  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { firstName: true, lastName: true } });
  const assignerName = `${actor?.firstName ?? ''} ${actor?.lastName ?? ''}`.trim() || 'A manager';
  for (const userId of targetIds) {
    notifyListAssigned({
      assigneeId: userId,
      actorUserId: actorId,
      subCompanyId: list.subCompanyId,
      listId: list.id,
      listName: list.name,
      assignerName,
    });
  }

  const updated = await prisma.mailingList.findUnique({ where: { id: list.id }, include: listInclude });
  return res.json(updated ? toListDto(updated) : { success: true });
});

/** DELETE /lists/:id/assignees/:userId — remove an assignee (creator only) */
mailingListsRouter.delete('/:id/assignees/:userId', requirePermission('lists:assign'), async (req: Request, res: Response) => {
  const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
  if (allowedIds.length === 0) return res.status(403).json({ error: 'Agency context required' });

  const list = await prisma.mailingList.findFirst({ where: { id: req.params.id, subCompanyId: { in: allowedIds } } });
  if (!list) return res.status(404).json({ error: 'Not found' });
  if (list.createdById !== effectiveActorId(req)) {
    return res.status(403).json({ error: 'You can only unassign lists you created' });
  }

  await prisma.mailingListAssignment.deleteMany({ where: { listId: list.id, userId: req.params.userId } });

  const updated = await prisma.mailingList.findUnique({ where: { id: list.id }, include: listInclude });
  return res.json(updated ? toListDto(updated) : { success: true });
});

/** PATCH /lists/:id/archive — archive / unarchive (owner, assignee, or agency leader) */
mailingListsRouter.patch('/:id/archive', requirePermission('clients:write'), async (req: Request, res: Response) => {
  const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
  if (allowedIds.length === 0) return res.status(403).json({ error: 'Agency context required' });

  const archived = typeof req.body?.archived === 'boolean' ? req.body.archived : true;

  const list = await prisma.mailingList.findFirst({ where: { id: req.params.id, subCompanyId: { in: allowedIds } } });
  if (!list) return res.status(404).json({ error: 'Not found' });
  if (!(await canEditListMembers(req, list))) {
    return res.status(403).json({ error: 'You cannot archive this list' });
  }

  const updated = await prisma.mailingList.update({
    where: { id: list.id },
    data: { isArchived: archived, archivedAt: archived ? new Date() : null },
    include: listInclude,
  });
  return res.json(toListDto(updated));
});

/** GET /lists/:id/members */
mailingListsRouter.get('/:id/members', requirePermission('clients:read'), async (req: Request, res: Response) => {
  const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
  if (allowedIds.length === 0) return res.status(403).json({ error: 'Agency context required' });

  const list = await prisma.mailingList.findFirst({ where: { id: req.params.id, subCompanyId: { in: allowedIds } } });
  if (!list) return res.status(404).json({ error: 'Not found' });

  const members = await prisma.mailingListClient.findMany({
    where: {
      listId: req.params.id,
      // Exclude clients fully unsubscribed at the agency level
      client: {
        clientSubCompanies: {
          none: { subCompanyId: list.subCompanyId, status: 'unsubscribed' },
        },
      },
    },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          industry: true,
          contacts: {
            where: {
              email: { not: null },
              isUnsubscribed: false,
              emailBounced: false,
              emailInvalid: false,
            },
            select: { email: true },
          },
        },
      },
    },
    orderBy: { addedAt: 'desc' },
  });

  return res.json({
    data: members.map((m) => ({
      id: m.id,
      clientId: m.clientId,
      clientName: m.client.name,
      industry: m.client.industry,
      validContactCount: m.client.contacts.length,
      addedAt: m.addedAt,
    })),
  });
});

/** POST /lists/:id/members — add clients to list */
mailingListsRouter.post('/:id/members', requirePermission('clients:write'), async (req: Request, res: Response) => {
  const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
  if (allowedIds.length === 0) return res.status(403).json({ error: 'Agency context required' });

  const { clientIds } = req.body as { clientIds: string[] };
  if (!Array.isArray(clientIds) || clientIds.length === 0) {
    return res.status(400).json({ error: 'clientIds array required' });
  }

  const list = await prisma.mailingList.findFirst({ where: { id: req.params.id, subCompanyId: { in: allowedIds } } });
  if (!list) return res.status(404).json({ error: 'Not found' });
  if (!(await canEditListMembers(req, list))) {
    return res.status(403).json({ error: 'You can only edit members of lists you own or are assigned' });
  }

  // Filter to only valid clients visible to this agency
  const validClients = await prisma.clientSubCompany.findMany({
    where: { clientId: { in: clientIds }, subCompanyId: { in: allowedIds } },
    select: { clientId: true },
  });
  const validClientIds = validClients.map((c) => c.clientId);
  if (validClientIds.length === 0) return res.json({ success: true, memberCount: await prisma.mailingListClient.count({ where: { listId: req.params.id } }) });

  // Upsert — skip duplicates
  await prisma.$transaction(
    validClientIds.map((clientId) =>
      prisma.mailingListClient.upsert({
        where: { listId_clientId: { listId: req.params.id, clientId } },
        create: { listId: req.params.id, clientId },
        update: {},
      })
    )
  );

  const count = await prisma.mailingListClient.count({ where: { listId: req.params.id } });
  return res.json({ success: true, memberCount: count });
});

/** DELETE /lists/:id/members/:clientId */
mailingListsRouter.delete('/:id/members/:clientId', requirePermission('clients:write'), async (req: Request, res: Response) => {
  const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
  if (allowedIds.length === 0) return res.status(403).json({ error: 'Agency context required' });

  const list = await prisma.mailingList.findFirst({ where: { id: req.params.id, subCompanyId: { in: allowedIds } } });
  if (!list) return res.status(404).json({ error: 'Not found' });
  if (!(await canEditListMembers(req, list))) {
    return res.status(403).json({ error: 'You can only edit members of lists you own or are assigned' });
  }

  await prisma.mailingListClient.deleteMany({ where: { listId: req.params.id, clientId: req.params.clientId } });
  return res.json({ success: true });
});
