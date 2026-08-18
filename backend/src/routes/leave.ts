/**
 * Leave API — types, balances, requests, approvals, calendar.
 * leave:read   = view own data
 * leave:write  = submit/cancel own requests
 * leave:approve = manage types, view all, approve/reject
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { LeaveStatus } from '@prisma/client';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { actAsMiddleware } from '../middleware/actAs';
import { requirePermission } from '../middleware/requirePermission';
import { resolveAgencyScope, resolveListAgencyScope } from '../config/agencyScope';
import { createNotification } from '../services/notifications';
import { emitToUsers } from '../socket';

export const leaveRouter = Router();
leaveRouter.use(authenticate);
leaveRouter.use(actAsMiddleware);
leaveRouter.use(requirePermission('leave:read'));

// Roles that can see all leave data in the subCompany
const APPROVER_ROLES = new Set([
  'super_admin', 'director', 'company_director', 'hr', 'operations_manager',
]);

function isApprover(role: string): boolean {
  return APPROVER_ROLES.has(role);
}

// ── Schemas ────────────────────────────────────────────────────────────────

const leaveTypeSchema = z.object({
  name: z.string().min(1).max(100),
  daysPerYear: z.number().int().min(1).max(365),
  paid: z.boolean().default(true),
  maxCarryOver: z.number().int().min(0).max(365).default(0),
});

const leaveRequestSchema = z.object({
  leaveTypeId: z.string().uuid(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  days: z.number().int().min(1),
  reason: z.string().max(1000).optional(),
});

const balanceAdjustSchema = z.object({
  entitled: z.number().int().min(0).optional(),
  carriedOver: z.number().int().min(0).optional(),
});

// ── GET /leave/types ────────────────────────────────────────────────────────

leaveRouter.get('/types', async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const agencyScope = await resolveListAgencyScope(req);
  if (!agencyScope) return res.status(403).json({ error: 'Agency context required' });

  const types = await prisma.leaveType.findMany({
    where: {
      OR: [
        { subCompanyId: agencyScope.primarySubCompanyId },
        { subCompanyId: null },
      ],
    },
    orderBy: { name: 'asc' },
  });

  return res.json({ data: types });
});

// ── POST /leave/types ───────────────────────────────────────────────────────

leaveRouter.post('/types', requirePermission('leave:approve'), async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const parsed = leaveTypeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const leaveType = await prisma.leaveType.create({
    data: { ...parsed.data, subCompanyId },
  });

  // Auto-create balances for all users in this subCompany for the current year
  // Also includes agency-independent users (super_admin, director) whose subCompanyId is null
  const currentYear = new Date().getFullYear();
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [{ subCompanyId }, { subCompanyId: null }],
    },
    select: { id: true },
  });

  if (users.length > 0) {
    await prisma.leaveBalance.createMany({
      data: users.map((u) => ({
        userId: u.id,
        leaveTypeId: leaveType.id,
        year: currentYear,
        entitled: leaveType.daysPerYear,
        used: 0,
        carriedOver: 0,
      })),
      skipDuplicates: true,
    });
  }

  return res.status(201).json({ data: leaveType, balancesCreated: users.length });
});

// ── PATCH /leave/types/:id ──────────────────────────────────────────────────

leaveRouter.patch('/types/:id', requirePermission('leave:approve'), async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const parsed = leaveTypeSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.leaveType.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Leave type not found' });

  const updated = await prisma.leaveType.update({
    where: { id: req.params.id },
    data: parsed.data,
  });

  return res.json({ data: updated });
});

// ── DELETE /leave/types/:id ─────────────────────────────────────────────────

leaveRouter.delete('/types/:id', requirePermission('leave:approve'), async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const pendingCount = await prisma.leaveRequest.count({
    where: { leaveTypeId: req.params.id, status: LeaveStatus.pending },
  });
  if (pendingCount > 0) {
    return res.status(409).json({ error: `Cannot delete — ${pendingCount} pending request(s) are using this leave type. Approve or reject them first.` });
  }

  // Cascade-delete balances before removing the type
  await prisma.leaveBalance.deleteMany({ where: { leaveTypeId: req.params.id } });
  await prisma.leaveType.delete({ where: { id: req.params.id } });
  return res.json({ success: true });
});

// ── GET /leave/balances/me ──────────────────────────────────────────────────

leaveRouter.get('/balances/me', async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();

  const balances = await prisma.leaveBalance.findMany({
    where: { userId: req.user.sub, year },
    include: { leaveType: true },
    orderBy: { leaveType: { name: 'asc' } },
  });

  return res.json({ data: balances });
});

// ── GET /leave/balances ─────────────────────────────────────────────────────

leaveRouter.get('/balances', requirePermission('leave:approve'), async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const agencyScope = await resolveListAgencyScope(req);
  if (!agencyScope) return res.status(403).json({ error: 'Agency context required' });

  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();

  const balances = await prisma.leaveBalance.findMany({
    where: {
      year,
      user: { subCompanyId: agencyScope.primarySubCompanyId },
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      leaveType: { select: { id: true, name: true, paid: true } },
    },
    orderBy: [{ user: { firstName: 'asc' } }, { leaveType: { name: 'asc' } }],
  });

  return res.json({ data: balances });
});

// ── PATCH /leave/balances/:id ───────────────────────────────────────────────

leaveRouter.patch('/balances/:id', requirePermission('leave:approve'), async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const parsed = balanceAdjustSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const balance = await prisma.leaveBalance.findUnique({ where: { id: req.params.id } });
  if (!balance) return res.status(404).json({ error: 'Balance not found' });

  const updated = await prisma.leaveBalance.update({
    where: { id: req.params.id },
    data: parsed.data,
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
      leaveType: { select: { id: true, name: true } },
    },
  });

  return res.json({ data: updated });
});

// ── GET /leave/requests ─────────────────────────────────────────────────────

leaveRouter.get('/requests', async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const role = req.user.role;
  const userId = req.user.sub;

  let userFilter: { userId?: string; user?: { subCompanyId: string } } = { userId };

  if (isApprover(role)) {
    const agencyScope = await resolveListAgencyScope(req);
    if (!agencyScope) return res.status(403).json({ error: 'Agency context required' });
    userFilter = { user: { subCompanyId: agencyScope.primarySubCompanyId } };
  }

  const rawStatus = req.query.status as string | undefined;
  const status = rawStatus && (Object.values(LeaveStatus) as string[]).includes(rawStatus)
    ? (rawStatus as LeaveStatus) : undefined;

  const requests = await prisma.leaveRequest.findMany({
    where: {
      ...userFilter,
      ...(status ? { status } : {}),
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      leaveType: { select: { id: true, name: true, paid: true } },
      approver: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return res.json({ data: requests });
});

// ── GET /leave/requests/pending ─────────────────────────────────────────────

leaveRouter.get('/requests/pending', requirePermission('leave:approve'), async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const agencyScope = await resolveListAgencyScope(req);
  if (!agencyScope) return res.status(403).json({ error: 'Agency context required' });

  const requests = await prisma.leaveRequest.findMany({
    where: {
      status: LeaveStatus.pending,
      user: { subCompanyId: agencyScope.primarySubCompanyId },
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      leaveType: { select: { id: true, name: true, paid: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return res.json({ data: requests });
});

// ── POST /leave/requests ────────────────────────────────────────────────────

leaveRouter.post('/requests', requirePermission('leave:write'), async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const parsed = leaveRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { leaveTypeId, startDate, endDate, days, reason } = parsed.data;
  const currentYear = new Date(startDate).getFullYear();

  // Find or auto-create a balance record (handles users added after a leave type was seeded)
  const leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } });
  if (!leaveType) return res.status(400).json({ error: 'Leave type not found.' });

  const balance = await prisma.leaveBalance.upsert({
    where: {
      userId_leaveTypeId_year: {
        userId: req.user.sub,
        leaveTypeId,
        year: currentYear,
      },
    },
    update: {},
    create: {
      userId: req.user.sub,
      leaveTypeId,
      year: currentYear,
      entitled: leaveType.daysPerYear,
      used: 0,
      carriedOver: 0,
    },
  });

  const available = balance.entitled + balance.carriedOver - balance.used;
  if (days > available) {
    return res.status(400).json({
      error: `Insufficient balance. You have ${available} day(s) available but requested ${days}.`,
    });
  }

  const request = await prisma.leaveRequest.create({
    data: {
      userId: req.user.sub,
      leaveTypeId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      days,
      reason,
      status: LeaveStatus.pending,
    },
    include: {
      leaveType: { select: { id: true, name: true } },
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // Normal user → notify HR only; HR → notify super_admin, director, operations_manager
  try {
    const subCompanyId = leaveType.subCompanyId;
    const requesterRole = req.user.role;
    const notifyRoles = requesterRole === 'hr'
      ? ['super_admin', 'director', 'operations_manager']
      : ['hr'];

    const approvers = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: notifyRoles },
        ...(subCompanyId ? { OR: [{ subCompanyId }, { subCompanyId: null }] } : {}),
      },
      select: { id: true },
    });
    const approverIds = approvers.map((a) => a.id).filter((id) => id !== req.user!.sub);
    const dateRange = `${new Date(request.startDate).toLocaleDateString()} – ${new Date(request.endDate).toLocaleDateString()}`;
    await Promise.all(
      approverIds.map((uid) =>
        createNotification({
          userId: uid,
          subCompanyId: subCompanyId ?? undefined,
          type: 'leave_request',
          title: 'New Leave Request',
          body: `${request.user.firstName} ${request.user.lastName} requested ${request.leaveType.name} (${dateRange}).`,
          link: '/leave/admin',
          relatedId: request.id,
        }).catch(() => {}),
      ),
    );
    if (subCompanyId) emitToUsers(approverIds, 'leave:refresh', { subCompanyId });
  } catch (_) {/* never block the response */}

  return res.status(201).json({ data: request });
});

// ── PATCH /leave/requests/:id/approve ──────────────────────────────────────

leaveRouter.patch('/requests/:id/approve', requirePermission('leave:approve'), async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const leaveRequest = await prisma.leaveRequest.findUnique({
    where: { id: req.params.id },
  });

  if (!leaveRequest) return res.status(404).json({ error: 'Leave request not found' });
  if (leaveRequest.userId === req.user.sub) {
    return res.status(403).json({ error: 'You cannot approve your own leave request' });
  }

  // Approve + deduct balance atomically; status re-checked inside transaction to prevent double-approve
  let updated: any;
  try {
    updated = await prisma.$transaction(async (tx) => {
      // Atomic: only succeeds if request is still 'pending' — prevents race condition
      const result = await tx.leaveRequest.updateMany({
        where: { id: req.params.id, status: LeaveStatus.pending },
        data: { status: LeaveStatus.approved, approverId: req.user!.sub, approvedAt: new Date() },
      });
      if (result.count === 0) throw new Error('already_processed');

      const balResult = await tx.leaveBalance.updateMany({
        where: {
          userId: leaveRequest.userId,
          leaveTypeId: leaveRequest.leaveTypeId,
          year: new Date(leaveRequest.startDate).getFullYear(),
        },
        data: { used: { increment: leaveRequest.days } },
      });
      if (balResult.count === 0) throw new Error('balance_not_found');

      return tx.leaveRequest.findUnique({
        where: { id: req.params.id },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, subCompanyId: true } },
          leaveType: { select: { id: true, name: true } },
          approver: { select: { id: true, firstName: true, lastName: true } },
        },
      });
    });
  } catch (err: any) {
    if (err.message === 'already_processed') {
      return res.status(409).json({ error: 'This request has already been processed' });
    }
    if (err.message === 'balance_not_found') {
      return res.status(400).json({ error: 'Leave balance record not found. Contact HR.' });
    }
    throw err;
  }

  // Fire notification + socket refresh to employee — never block the response
  try {
    const u = updated as any;
    const dateRange = `${new Date(u.startDate).toLocaleDateString()} – ${new Date(u.endDate).toLocaleDateString()}`;
    const employeeId = u.user?.id ?? u.userId;
    const subCompanyId = u.user?.subCompanyId;
    await createNotification({
      userId: employeeId,
      subCompanyId,
      type: 'leave_approved',
      title: 'Leave Approved',
      body: `Your ${u.leaveType?.name ?? 'leave'} request for ${dateRange} has been approved.`,
      link: '/leave',
      relatedId: u.id,
    });
    if (subCompanyId) emitToUsers([employeeId], 'leave:refresh', { subCompanyId });
  } catch (_) {/* notification failure never blocks approval */}

  return res.json({ data: updated });
});

// ── PATCH /leave/requests/:id/reject ───────────────────────────────────────

leaveRouter.patch('/requests/:id/reject', requirePermission('leave:approve'), async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const leaveRequest = await prisma.leaveRequest.findUnique({
    where: { id: req.params.id },
  });

  if (!leaveRequest) return res.status(404).json({ error: 'Leave request not found' });
  if (leaveRequest.status !== LeaveStatus.pending) {
    return res.status(400).json({ error: 'Only pending requests can be rejected' });
  }
  if (leaveRequest.userId === req.user.sub) {
    return res.status(403).json({ error: 'You cannot reject your own leave request' });
  }

  const updated = await prisma.leaveRequest.update({
    where: { id: req.params.id },
    data: {
      status: LeaveStatus.rejected,
      approverId: req.user.sub,
      approvedAt: new Date(),
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, subCompanyId: true } },
      leaveType: { select: { id: true, name: true } },
      approver: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // Fire notification + socket refresh to employee — never block the response
  try {
    const u = updated as any;
    const dateRange = `${new Date(u.startDate).toLocaleDateString()} – ${new Date(u.endDate).toLocaleDateString()}`;
    const employeeId = u.user?.id ?? u.userId;
    const subCompanyId = u.user?.subCompanyId;
    await createNotification({
      userId: employeeId,
      subCompanyId,
      type: 'leave_rejected',
      title: 'Leave Rejected',
      body: `Your ${u.leaveType?.name ?? 'leave'} request for ${dateRange} has been rejected.`,
      link: '/leave',
      relatedId: u.id,
    });
    if (subCompanyId) emitToUsers([employeeId], 'leave:refresh', { subCompanyId });
  } catch (_) {/* notification failure never blocks rejection */}

  return res.json({ data: updated });
});

// ── PATCH /leave/requests/:id/cancel ───────────────────────────────────────

leaveRouter.patch('/requests/:id/cancel', requirePermission('leave:write'), async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const leaveRequest = await prisma.leaveRequest.findUnique({
    where: { id: req.params.id },
    include: {
      leaveType: { select: { name: true } },
      user: { select: { id: true, firstName: true, lastName: true, subCompanyId: true } },
    },
  });

  if (!leaveRequest) return res.status(404).json({ error: 'Leave request not found' });
  if (leaveRequest.userId !== req.user.sub) {
    return res.status(403).json({ error: 'You can only cancel your own requests' });
  }
  if (leaveRequest.status !== LeaveStatus.pending) {
    return res.status(400).json({ error: 'Only pending requests can be cancelled' });
  }

  const updated = await prisma.leaveRequest.update({
    where: { id: req.params.id },
    data: { status: LeaveStatus.cancelled },
  });

  // Same routing as request submission: normal user cancels → HR; HR cancels → senior mgmt
  try {
    const subCompanyId = leaveRequest.user?.subCompanyId;
    const name = `${leaveRequest.user?.firstName ?? ''} ${leaveRequest.user?.lastName ?? ''}`.trim();
    const dateRange = `${new Date(leaveRequest.startDate).toLocaleDateString()} – ${new Date(leaveRequest.endDate).toLocaleDateString()}`;
    const cancellerRole = req.user.role;
    const cancelNotifyRoles = cancellerRole === 'hr'
      ? ['super_admin', 'director', 'operations_manager']
      : ['hr'];

    const approvers = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: cancelNotifyRoles },
        ...(subCompanyId ? { OR: [{ subCompanyId }, { subCompanyId: null }] } : {}),
      },
      select: { id: true },
    });

    await Promise.all(approvers.map((a) =>
      createNotification({
        userId: a.id,
        subCompanyId: subCompanyId ?? undefined,
        type: 'leave_cancelled',
        title: 'Leave Request Cancelled',
        body: `${name} cancelled their ${leaveRequest.leaveType?.name ?? 'leave'} request for ${dateRange}.`,
        link: '/leave/admin',
        relatedId: leaveRequest.id,
      })
    ));

    if (approvers.length > 0) {
      emitToUsers(approvers.map((a) => a.id), 'leave:refresh', { subCompanyId });
    }
  } catch (_) {/* notification failure never blocks cancellation */}

  return res.json({ data: updated });
});

// ── GET /leave/calendar ─────────────────────────────────────────────────────

leaveRouter.get('/calendar', async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const agencyScope = await resolveListAgencyScope(req);
  if (!agencyScope) return res.status(403).json({ error: 'Agency context required' });

  const from = req.query.from ? new Date(req.query.from as string) : new Date();
  const to = req.query.to
    ? new Date(req.query.to as string)
    : new Date(new Date().setMonth(new Date().getMonth() + 1));

  const leaves = await prisma.leaveRequest.findMany({
    where: {
      status: LeaveStatus.approved,
      startDate: { lte: to },
      endDate: { gte: from },
      user: { subCompanyId: agencyScope.primarySubCompanyId },
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      leaveType: { select: { id: true, name: true, paid: true } },
    },
    orderBy: { startDate: 'asc' },
  });

  return res.json({ data: leaves });
});

// ── Year-end carryover ──────────────────────────────────────────────────────
leaveRouter.post('/carryover', requirePermission('leave:approve'), async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const agencyScope = await resolveListAgencyScope(req);
  if (!agencyScope) return res.status(403).json({ error: 'Agency context required' });

  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;

  // Load all current-year balances for this subCompany
  const balances = await prisma.leaveBalance.findMany({
    where: {
      year: currentYear,
      user: { subCompanyId: agencyScope.primarySubCompanyId },
    },
    include: { leaveType: true },
  });

  if (balances.length === 0) {
    return res.json({ data: { updated: 0, message: 'No balances found for current year.' } });
  }

  let updated = 0;
  await prisma.$transaction(async (tx) => {
    for (const balance of balances) {
      const remaining = Math.max(0, balance.entitled + balance.carriedOver - balance.used);
      const carryOver = Math.min(remaining, balance.leaveType.maxCarryOver);

      await tx.leaveBalance.upsert({
        where: { userId_leaveTypeId_year: { userId: balance.userId, leaveTypeId: balance.leaveTypeId, year: nextYear } },
        create: {
          userId: balance.userId,
          leaveTypeId: balance.leaveTypeId,
          year: nextYear,
          entitled: balance.leaveType.daysPerYear,
          carriedOver: carryOver,
          used: 0,
        },
        update: { carriedOver: carryOver, entitled: balance.leaveType.daysPerYear },
      });
      updated++;
    }
  });

  return res.json({ data: { updated, nextYear, message: `Carryover complete — ${updated} balances created/updated for ${nextYear}.` } });
});
