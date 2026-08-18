/**
 * Projects API — create, list, detail, members, milestones, leave calendar.
 * Permission: projects:read (base), projects:write (mutations).
 * Scope: IC roles (developer/qa/designer/ba/devops) see only projects they're members of.
 *        PM/TL/Scrum see all projects in their subCompany where they have membership.
 *        CTO/Director/HR/Finance see all projects in subCompany.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ProjectStatus, ProjectMemberRole, LeaveStatus } from '@prisma/client';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { actAsMiddleware } from '../middleware/actAs';
import { requirePermission } from '../middleware/requirePermission';
import { resolveAgencyScope, resolveListAgencyScope } from '../config/agencyScope';

export const projectsRouter = Router();
projectsRouter.use(authenticate);
projectsRouter.use(actAsMiddleware);
projectsRouter.use(requirePermission('projects:read'));

// Roles that see ALL projects in their subCompany (not scoped to membership)
const BROAD_ROLES = new Set([
  'super_admin', 'director', 'company_director', 'cto',
  'operations_manager', 'hr', 'finance', 'it',
]);

function hasBroadAccess(role: string): boolean {
  return BROAD_ROLES.has(role);
}

// ── Schemas ────────────────────────────────────────────────────────────────

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  status: z.nativeEnum(ProjectStatus).default('active'),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  memberIds: z.array(z.string().uuid()).optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional().nullable(),
  status: z.nativeEnum(ProjectStatus).optional(),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
});

const addMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.nativeEnum(ProjectMemberRole).default('member'),
});

const milestoneSchema = z.object({
  title: z.string().min(1).max(300),
  dueDate: z.string().datetime(),
  done: z.boolean().optional(),
});

// ── GET /projects ───────────────────────────────────────────────────────────

projectsRouter.get('/', async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const agencyScope = await resolveListAgencyScope(req);
  if (!agencyScope) return res.status(403).json({ error: 'Agency context required' });

  const { scopeFilter } = agencyScope;
  const userId = req.user.sub;
  const role = req.user.role;

  const where = hasBroadAccess(role)
    ? { ...scopeFilter }
    : {
        ...scopeFilter,
        members: { some: { userId } },
      };

  const projects = await prisma.project.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      owner: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      members: {
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        },
      },
      milestones: { orderBy: { dueDate: 'asc' } },
      _count: { select: { tasks: true, milestones: true } },
    },
  });

  return res.json({ data: projects });
});

// ── POST /projects ──────────────────────────────────────────────────────────

projectsRouter.post('/', requirePermission('projects:write'), async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { name, description, status, startDate, endDate, memberIds = [] } = parsed.data;

  const project = await prisma.project.create({
    data: {
      name,
      description,
      status,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      ownerId: req.user.sub,
      subCompanyId,
      members: {
        create: [
          { userId: req.user.sub, role: 'lead' },
          ...memberIds
            .filter((id) => id !== req.user!.sub)
            .map((id) => ({ userId: id, role: 'member' as ProjectMemberRole })),
        ],
      },
    },
    include: {
      owner: { select: { id: true, firstName: true, lastName: true } },
      members: {
        include: { user: { select: { id: true, firstName: true, lastName: true } } },
      },
      milestones: true,
    },
  });

  return res.status(201).json({ data: project });
});

// ── GET /projects/:id ───────────────────────────────────────────────────────

projectsRouter.get('/:id', async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: {
      owner: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      members: {
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true } },
        },
      },
      milestones: { orderBy: { dueDate: 'asc' } },
      tasks: {
        orderBy: { createdAt: 'desc' },
        include: {
          owner: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        },
      },
    },
  });

  if (!project) return res.status(404).json({ error: 'Project not found' });

  // IC roles can only view projects they're members of
  if (!hasBroadAccess(req.user.role)) {
    const isMember = project.members.some((m) => m.userId === req.user!.sub);
    if (!isMember) return res.status(403).json({ error: 'Access denied' });
  }

  return res.json({ data: project });
});

// ── PATCH /projects/:id ─────────────────────────────────────────────────────

projectsRouter.patch('/:id', requirePermission('projects:write'), async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const existing = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: { members: { select: { userId: true } } },
  });
  if (!existing) return res.status(404).json({ error: 'Project not found' });

  // Only owner, lead member, or broad-access roles can update
  const isOwner = existing.ownerId === req.user.sub;
  const isMember = existing.members.some((m) => m.userId === req.user!.sub);
  if (!hasBroadAccess(req.user.role) && !isOwner && !isMember) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const parsed = updateProjectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const updated = await prisma.project.update({
    where: { id: req.params.id },
    data: {
      ...parsed.data,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : parsed.data.startDate,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : parsed.data.endDate,
    },
    include: {
      owner: { select: { id: true, firstName: true, lastName: true } },
      members: {
        include: { user: { select: { id: true, firstName: true, lastName: true } } },
      },
      milestones: true,
    },
  });

  return res.json({ data: updated });
});

// ── DELETE /projects/:id ────────────────────────────────────────────────────

projectsRouter.delete('/:id', requirePermission('projects:write'), async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const existing = await prisma.project.findUnique({
    where: { id: req.params.id },
    select: { ownerId: true },
  });
  if (!existing) return res.status(404).json({ error: 'Project not found' });

  if (!hasBroadAccess(req.user.role) && existing.ownerId !== req.user.sub) {
    return res.status(403).json({ error: 'Only the project owner can delete this project' });
  }

  await prisma.project.delete({ where: { id: req.params.id } });
  return res.json({ success: true });
});

// ── POST /projects/:id/members ──────────────────────────────────────────────

projectsRouter.post('/:id/members', requirePermission('projects:write'), async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: { members: { select: { userId: true } } },
  });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  if (!hasBroadAccess(req.user.role) && project.ownerId !== req.user.sub) {
    return res.status(403).json({ error: 'Only the project owner can manage members' });
  }

  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const alreadyMember = project.members.some((m) => m.userId === parsed.data.userId);
  if (alreadyMember) return res.status(409).json({ error: 'User is already a member' });

  const member = await prisma.projectMember.create({
    data: { projectId: req.params.id, userId: parsed.data.userId, role: parsed.data.role },
    include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
  });

  return res.status(201).json({ data: member });
});

// ── DELETE /projects/:id/members/:userId ────────────────────────────────────

projectsRouter.delete('/:id/members/:userId', requirePermission('projects:write'), async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    select: { ownerId: true },
  });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  if (!hasBroadAccess(req.user.role) && project.ownerId !== req.user.sub) {
    return res.status(403).json({ error: 'Only the project owner can manage members' });
  }

  await prisma.projectMember.deleteMany({
    where: { projectId: req.params.id, userId: req.params.userId },
  });

  return res.json({ success: true });
});

// ── POST /projects/:id/milestones ───────────────────────────────────────────

projectsRouter.post('/:id/milestones', requirePermission('projects:write'), async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: { members: { select: { userId: true } } },
  });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  if (!hasBroadAccess(req.user.role)) {
    const isMember = project.members.some((m) => m.userId === req.user!.sub);
    if (!isMember) return res.status(403).json({ error: 'Access denied' });
  }

  const parsed = milestoneSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const milestone = await prisma.milestone.create({
    data: {
      projectId: req.params.id,
      title: parsed.data.title,
      dueDate: new Date(parsed.data.dueDate),
    },
  });

  return res.status(201).json({ data: milestone });
});

// ── PATCH /projects/:id/milestones/:mId ─────────────────────────────────────

projectsRouter.patch('/:id/milestones/:mId', requirePermission('projects:write'), async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const parsed = milestoneSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const milestone = await prisma.milestone.update({
    where: { id: req.params.mId },
    data: {
      ...parsed.data,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
    },
  });

  return res.json({ data: milestone });
});

// ── DELETE /projects/:id/milestones/:mId ────────────────────────────────────

projectsRouter.delete('/:id/milestones/:mId', requirePermission('projects:write'), async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  await prisma.milestone.delete({ where: { id: req.params.mId } });
  return res.json({ success: true });
});

// ── GET /projects/:id/leave-calendar ────────────────────────────────────────

projectsRouter.get('/:id/leave-calendar', async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: { members: { select: { userId: true } } },
  });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const memberIds = project.members.map((m) => m.userId);

  const leaves = await prisma.leaveRequest.findMany({
    where: {
      userId: { in: memberIds },
      status: LeaveStatus.approved,
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      leaveType: { select: { id: true, name: true } },
    },
    orderBy: { startDate: 'asc' },
  });

  return res.json({ data: leaves });
});
