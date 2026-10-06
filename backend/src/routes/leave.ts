/** Leave approvals are permission/agency scoped; policy changes are Super Admin only. */
import { Router, Request, Response, NextFunction } from 'express';
import { LeaveStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { actAsMiddleware } from '../middleware/actAs';
import { requirePermission } from '../middleware/requirePermission';
import {
  getLeaveAccess, requireLeaveOwnerAccess, requireLeaveConfig, requireLeaveWriteAgency,
  LeaveAccessError, type LeaveAccess,
} from '../services/leaveAccess';
import {
  LeaveError, parseLeaveDate, leaveTypeInputSchema, leaveBalanceInputSchema, getLeavePolicy,
  createLeaveRequest, transitionLeaveRequest, createLeaveType, updateLeaveType,
  deleteLeaveType, adjustLeaveBalance, carryOverLeave,
} from '../services/leave';
import { notifyLeaveChange, refreshLeaveUsers } from '../services/leaveNotifications';

export const leaveRouter = Router();
leaveRouter.use(authenticate);
leaveRouter.use(actAsMiddleware);
const requireLeaveRead = requirePermission('leave:read');
leaveRouter.use((req, res, next) => {
  // Every authenticated employee can view their own leave, including custom roles.
  // Agency-wide reads and all mutations retain their existing permission checks.
  const ownRead = req.method === 'GET' && (
    req.path === '/policy/me' || req.path === '/balances/me'
    || ((req.path === '/requests' || req.path === '/types') && req.query.mine === 'true')
  );
  if (req.user?.sub && ownRead) {
    next();
    return;
  }
  return requireLeaveRead(req, res, next);
});

// Express 4 does not automatically forward rejected async handlers.
function handle(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req, res).catch((error: unknown) => {
      if (error instanceof LeaveError || error instanceof LeaveAccessError) {
        res.status(error.status).json({ error: error.message });
      } else if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.issues.map((issue) => issue.message).join('; ') });
      } else {
        next(error);
      }
    });
  };
}

function yearFrom(req: Request): number {
  return req.query.year === undefined
    ? new Date().getUTCFullYear()
    : z.coerce.number().int().min(1900).max(9999).parse(req.query.year);
}

function usersInScope(access: LeaveAccess): Prisma.UserWhereInput {
  const agencies = { subCompanyId: { in: access.agencyIds } };
  return access.canAccessAgencylessOwners ? { OR: [agencies, { subCompanyId: null }] } : agencies;
}

function assertApprover(access: LeaveAccess): void {
  if (!access.canApprove) throw new LeaveAccessError(403, 'Leave approval permission required');
}

function assertTypeAgency(type: { subCompanyId: string | null }, agencyId: string): void {
  if (type.subCompanyId && type.subCompanyId !== agencyId) {
    throw new LeaveAccessError(403, 'This leave type belongs to another agency');
  }
}

function assertOwnType(
  access: LeaveAccess,
  user: { subCompanyId: string | null },
  type: { subCompanyId: string | null },
): void {
  if (type.subCompanyId && (user.subCompanyId
    ? type.subCompanyId !== user.subCompanyId
    : !access.agencyIds.includes(type.subCompanyId))) {
    throw new LeaveAccessError(403, 'This leave type is not available to you');
  }
}

const requestInclude = {
  user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
  leaveType: { select: { id: true, name: true, paid: true } },
  approver: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.LeaveRequestInclude;

leaveRouter.get('/policy/me', handle(async (req, res) => {
  const access = await getLeaveAccess(req);
  return res.json({ data: await getLeavePolicy(access.userId) });
}));

leaveRouter.get('/types', handle(async (req, res) => {
  const access = await getLeaveAccess(req);
  let agencyIds = access.agencyIds;
  if (req.query.mine === 'true') {
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: access.userId }, select: { subCompanyId: true } });
    agencyIds = owner.subCompanyId ? [owner.subCompanyId] : agencyIds;
  }
  const data = await prisma.leaveType.findMany({
    where: { OR: [{ subCompanyId: { in: agencyIds } }, { subCompanyId: null }] },
    orderBy: { name: 'asc' },
  });
  return res.json({ data });
}));

leaveRouter.post('/types', handle(async (req, res) => {
  const access = await getLeaveAccess(req);
  requireLeaveConfig(access);
  const subCompanyId = requireLeaveWriteAgency(access);
  const result = await createLeaveType({ ...leaveTypeInputSchema.parse(req.body), subCompanyId });
  void refreshLeaveUsers(subCompanyId).catch(() => {});
  return res.status(201).json({ data: result.leaveType, balancesCreated: result.balancesCreated });
}));

leaveRouter.patch('/types/:id', handle(async (req, res) => {
  const access = await getLeaveAccess(req);
  requireLeaveConfig(access);
  const subCompanyId = requireLeaveWriteAgency(access);
  const data = await updateLeaveType(req.params.id, leaveTypeInputSchema.partial().parse(req.body), subCompanyId);
  void refreshLeaveUsers(subCompanyId).catch(() => {});
  return res.json({ data });
}));

leaveRouter.delete('/types/:id', handle(async (req, res) => {
  const access = await getLeaveAccess(req);
  requireLeaveConfig(access);
  const agencyId = requireLeaveWriteAgency(access);
  const type = await prisma.leaveType.findUnique({ where: { id: req.params.id } });
  if (!type) throw new LeaveError(404, 'Leave type not found');
  assertTypeAgency(type, agencyId);
  await deleteLeaveType(type.id, agencyId);
  void refreshLeaveUsers(agencyId).catch(() => {});
  return res.json({ success: true });
}));

leaveRouter.get('/balances/me', handle(async (req, res) => {
  const access = await getLeaveAccess(req);
  const data = await prisma.leaveBalance.findMany({
    where: { userId: access.userId, year: yearFrom(req) },
    include: { leaveType: true },
    orderBy: { leaveType: { name: 'asc' } },
  });
  return res.json({ data });
}));

leaveRouter.get('/balances', requirePermission('leave:approve'), handle(async (req, res) => {
  const access = await getLeaveAccess(req);
  assertApprover(access);
  const data = await prisma.leaveBalance.findMany({
    where: { year: yearFrom(req), user: usersInScope(access) },
    include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }, leaveType: true },
    orderBy: [{ user: { firstName: 'asc' } }, { leaveType: { name: 'asc' } }],
  });
  return res.json({ data });
}));

leaveRouter.patch('/balances/:id', handle(async (req, res) => {
  const access = await getLeaveAccess(req);
  requireLeaveConfig(access);
  const balance = await prisma.leaveBalance.findUnique({
    where: { id: req.params.id }, include: { user: { select: { subCompanyId: true } } },
  });
  if (!balance) throw new LeaveError(404, 'Balance not found');
  requireLeaveOwnerAccess(access, balance.userId, balance.user.subCompanyId);
  const data = await adjustLeaveBalance(balance.id, leaveBalanceInputSchema.parse(req.body),
    (current) => requireLeaveOwnerAccess(access, current.userId, current.user.subCompanyId));
  void refreshLeaveUsers(balance.user.subCompanyId, [balance.userId]).catch(() => {});
  return res.json({ data });
}));

leaveRouter.get('/requests', handle(async (req, res) => {
  const access = await getLeaveAccess(req);
  const where: Prisma.LeaveRequestWhereInput = access.canApprove && req.query.mine !== 'true'
    ? { user: usersInScope(access) } : { userId: access.userId };
  if (typeof req.query.status === 'string' && Object.values(LeaveStatus).includes(req.query.status as LeaveStatus)) {
    where.status = req.query.status as LeaveStatus;
  }
  const data = await prisma.leaveRequest.findMany({ where, include: requestInclude, orderBy: { createdAt: 'desc' } });
  return res.json({ data });
}));

leaveRouter.get('/requests/pending', requirePermission('leave:approve'), handle(async (req, res) => {
  const access = await getLeaveAccess(req);
  assertApprover(access);
  const data = await prisma.leaveRequest.findMany({
    where: { status: LeaveStatus.pending, user: usersInScope(access) },
    include: requestInclude, orderBy: { createdAt: 'asc' },
  });
  return res.json({ data });
}));

leaveRouter.post('/requests', requirePermission('leave:write'), handle(async (req, res) => {
  const access = await getLeaveAccess(req);
  const data = await createLeaveRequest(req.body, access.userId, (owner, type) => assertOwnType(access, owner, type));
  void notifyLeaveChange(data, 'request').catch(() => {});
  return res.status(201).json({ data });
}));

async function assertNotLinkedSelf(access: LeaveAccess, ownerId: string): Promise<void> {
  if (ownerId === access.userId || ownerId === access.actingAsUserId) {
    throw new LeaveAccessError(403, 'You cannot approve or reject your own leave request');
  }
  const link = await prisma.userAgencyLink.findFirst({ where: { userId: access.userId }, select: { groupId: true } });
  if (link && await prisma.userAgencyLink.findFirst({ where: { groupId: link.groupId, userId: ownerId }, select: { id: true } })) {
    throw new LeaveAccessError(403, 'You cannot approve or reject leave for your linked account');
  }
}

for (const action of ['approve', 'reject'] as const) {
  leaveRouter.patch(`/requests/:id/${action}`, requirePermission('leave:approve'), handle(async (req, res) => {
    const access = await getLeaveAccess(req);
    assertApprover(access);
    const existing = await prisma.leaveRequest.findUnique({
      where: { id: req.params.id }, include: { user: { select: { subCompanyId: true } } },
    });
    if (!existing) throw new LeaveError(404, 'Leave request not found');
    requireLeaveOwnerAccess(access, existing.userId, existing.user.subCompanyId);
    await assertNotLinkedSelf(access, existing.userId);
    const data = await transitionLeaveRequest(existing.id, action, access.userId,
      (request) => requireLeaveOwnerAccess(access, request.userId, request.user.subCompanyId));
    void notifyLeaveChange(data, action).catch(() => {});
    return res.json({ data });
  }));
}

leaveRouter.patch('/requests/:id/cancel', requirePermission('leave:write'), handle(async (req, res) => {
  const access = await getLeaveAccess(req);
  const data = await transitionLeaveRequest(req.params.id, 'cancel', access.userId);
  void notifyLeaveChange(data, 'cancel').catch(() => {});
  return res.json({ data });
}));

leaveRouter.get('/calendar', handle(async (req, res) => {
  const access = await getLeaveAccess(req);
  const from = parseLeaveDate(req.query.from ?? new Date().toISOString());
  const nextMonth = new Date();
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const to = parseLeaveDate(req.query.to ?? nextMonth.toISOString());
  if (to < from) throw new LeaveError(400, 'End date must be on or after start date');
  to.setUTCDate(to.getUTCDate() + 1);
  const data = await prisma.leaveRequest.findMany({
    where: { status: LeaveStatus.approved, startDate: { lt: to }, endDate: { gte: from }, user: usersInScope(access) },
    include: requestInclude, orderBy: { startDate: 'asc' },
  });
  return res.json({ data });
}));

leaveRouter.post('/carryover', handle(async (req, res) => {
  const access = await getLeaveAccess(req);
  requireLeaveConfig(access);
  const agencyId = requireLeaveWriteAgency(access);
  const data = await carryOverLeave(agencyId);
  void refreshLeaveUsers(agencyId).catch(() => {});
  return res.json({ data });
}));
