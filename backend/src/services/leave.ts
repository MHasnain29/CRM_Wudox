import { LeaveSession, LeaveStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../config/database';

export class LeaveError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'LeaveError';
  }
}

const dayQuantity = z.number().finite().nonnegative().multipleOf(0.5);

export const leaveTypeInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  daysPerYear: dayQuantity.max(365),
  paid: z.boolean().default(true),
  maxCarryOver: dayQuantity.max(365).default(0),
});

export const leaveBalanceInputSchema = z.object({
  entitled: dayQuantity.optional(),
  carriedOver: dayQuantity.optional(),
});

const requestInputSchema = z.object({
  leaveTypeId: z.string().uuid(),
  startDate: z.string(),
  endDate: z.string(),
  days: z.number().finite().positive().optional(),
  session: z.nativeEnum(LeaveSession).default(LeaveSession.full_day),
  reason: z.string().max(1000).optional(),
});

const DAY_MS = 86_400_000;

/** Dates are calendar labels. Legacy ISO inputs retain their written date, not their UTC instant. */
export function parseLeaveDate(value: unknown): Date {
  if (typeof value !== 'string') throw new LeaveError(400, 'A valid leave date is required.');
  const plainDate = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!plainDate && !z.string().datetime({ offset: true }).safeParse(value).success) {
    throw new LeaveError(400, 'Use a valid date in YYYY-MM-DD or ISO format.');
  }
  const label = value.slice(0, 10);
  const result = new Date(`${label}T00:00:00.000Z`);
  if (!Number.isFinite(result.getTime()) || result.getUTCFullYear() < 1 || result.toISOString().slice(0, 10) !== label) {
    throw new LeaveError(400, 'Invalid leave date.');
  }
  return result;
}

function calendarDate(value: Date): Date {
  return parseLeaveDate(value.toISOString().slice(0, 10));
}

/** Inclusive weekdays; UTC arithmetic avoids daylight-saving and viewer-timezone changes. */
export function countLeaveWeekdays(start: Date, end: Date): number {
  const total = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (total <= 0) return 0;
  let weekdays = Math.floor(total / 7) * 5;
  for (let offset = 0; offset < total % 7; offset++) {
    const day = (start.getUTCDay() + offset) % 7;
    if (day !== 0 && day !== 6) weekdays++;
  }
  return weekdays;
}

export interface ParsedLeaveRequest {
  leaveTypeId: string;
  startDate: Date;
  endDate: Date;
  days: number;
  session: LeaveSession;
  reason?: string;
}

export function parseLeaveRequest(input: unknown): ParsedLeaveRequest {
  const parsed = requestInputSchema.safeParse(input);
  if (!parsed.success) throw new LeaveError(400, parsed.error.issues.map((issue) => issue.message).join('; '));
  const { days: submittedDays, ...data } = parsed.data;
  const startDate = parseLeaveDate(data.startDate);
  const endDate = parseLeaveDate(data.endDate);
  if (endDate < startDate) throw new LeaveError(400, 'End date cannot be before start date.');
  const workingDays = countLeaveWeekdays(startDate, endDate);
  if (!workingDays) throw new LeaveError(400, 'Choose at least one working day (Monday–Friday).');
  if (data.session !== LeaveSession.full_day && startDate.getTime() !== endDate.getTime()) {
    throw new LeaveError(400, 'Half-day leave must use one working date.');
  }
  const days = data.session === LeaveSession.full_day ? workingDays : 0.5;
  if (submittedDays !== undefined && submittedDays !== days) {
    throw new LeaveError(400, `The selected dates and session require ${days} day(s).`);
  }
  return { ...data, startDate, endDate, days };
}

/** Every leave mutation uses serializable isolation so overlap/balance predicates survive races. */
export async function withLeaveTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034') {
        if (attempt < 3) continue;
        throw new LeaveError(409, 'Leave data changed during this action. Please try again.');
      }
      throw error;
    }
  }
}

const requestInclude = {
  user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, subCompanyId: true, role: true } },
  leaveType: { select: { id: true, name: true, paid: true, subCompanyId: true } },
  approver: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.LeaveRequestInclude;

type RequestRecord = Prisma.LeaveRequestGetPayload<{ include: typeof requestInclude }>;
type AgencyOwner = { id: string; subCompanyId: string | null };
type CreateAuthorization = (requester: AgencyOwner, type: AgencyOwner) => void | Promise<void>;
type TransitionAuthorization = (request: RequestRecord) => void | Promise<void>;

async function assertNoOverlap(tx: Prisma.TransactionClient, input: Pick<ParsedLeaveRequest, 'startDate' | 'endDate' | 'session'>, userId: string, excludeId?: string) {
  const endExclusive = new Date(input.endDate.getTime() + DAY_MS);
  const candidates = await tx.leaveRequest.findMany({
    where: {
      userId,
      status: { in: [LeaveStatus.pending, LeaveStatus.approved] },
      startDate: { lt: endExclusive },
      endDate: { gte: input.startDate },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { startDate: true, endDate: true, session: true },
  });
  const conflict = candidates.some((existing) => {
    if (input.session !== LeaveSession.full_day && existing.session !== LeaveSession.full_day && input.session !== existing.session) return false;
    const overlapStart = new Date(Math.max(input.startDate.getTime(), calendarDate(existing.startDate).getTime()));
    const overlapEnd = new Date(Math.min(input.endDate.getTime(), calendarDate(existing.endDate).getTime()));
    return countLeaveWeekdays(overlapStart, overlapEnd) > 0;
  });
  if (conflict) throw new LeaveError(409, 'This leave overlaps a pending or approved request. Choose another date or half of the day.');
}

function assertAvailable(balance: { entitled: number; carriedOver: number; used: number }, days: number) {
  const available = balance.entitled + balance.carriedOver - balance.used;
  if (days > available) throw new LeaveError(400, `Insufficient balance. You have ${available} day(s) available but requested ${days}.`);
}

export async function createLeaveRequest(input: ParsedLeaveRequest, userId: string, authorize?: CreateAuthorization) {
  return withLeaveTransaction(async (tx) => {
    const requester = await tx.user.findUnique({ where: { id: userId }, select: { id: true, subCompanyId: true } });
    if (!requester) throw new LeaveError(404, 'Employee not found.');
    const leaveType = await tx.leaveType.findUnique({ where: { id: input.leaveTypeId } });
    if (!leaveType) throw new LeaveError(400, 'Leave type not found.');
    await authorize?.(requester, leaveType);
    await assertNoOverlap(tx, input, userId);
    const year = input.startDate.getUTCFullYear();
    const balance = await tx.leaveBalance.upsert({
      where: { userId_leaveTypeId_year: { userId, leaveTypeId: input.leaveTypeId, year } },
      update: {},
      create: { userId, leaveTypeId: input.leaveTypeId, year, entitled: leaveType.daysPerYear, used: 0, carriedOver: 0 },
    });
    assertAvailable(balance, input.days);
    return tx.leaveRequest.create({ data: { ...input, userId, status: LeaveStatus.pending }, include: requestInclude });
  });
}

export async function transitionLeaveRequest(id: string, action: 'approve' | 'reject' | 'cancel', actorId: string, authorize?: TransitionAuthorization) {
  return withLeaveTransaction(async (tx) => {
    const request = await tx.leaveRequest.findUnique({ where: { id }, include: requestInclude });
    if (!request) throw new LeaveError(404, 'Leave request not found.');
    await authorize?.(request);
    if (action === 'cancel' ? request.userId !== actorId : request.userId === actorId) {
      throw new LeaveError(403, action === 'cancel' ? 'You can only cancel your own requests.' : `You cannot ${action} your own leave request.`);
    }
    if (request.status !== LeaveStatus.pending) throw new LeaveError(409, 'This request has already been processed.');
    if (action === 'approve') {
      // Legacy pending requests may predate overlap validation. Do not approve a conflicting request.
      await assertNoOverlap(tx, { ...request, startDate: calendarDate(request.startDate), endDate: calendarDate(request.endDate) }, request.userId, id);
      const balance = await tx.leaveBalance.findUnique({
        where: { userId_leaveTypeId_year: { userId: request.userId, leaveTypeId: request.leaveTypeId, year: request.startDate.getUTCFullYear() } },
      });
      if (!balance) throw new LeaveError(400, 'Leave balance record not found. Contact HR.');
      assertAvailable(balance, request.days);
      await tx.leaveBalance.update({ where: { id: balance.id }, data: { used: { increment: request.days } } });
    }
    const status = action === 'approve' ? LeaveStatus.approved : action === 'reject' ? LeaveStatus.rejected : LeaveStatus.cancelled;
    const updated = await tx.leaveRequest.updateMany({
      where: { id, status: LeaveStatus.pending },
      data: { status, ...(action === 'cancel' ? {} : { approverId: actorId, approvedAt: new Date() }) },
    });
    if (updated.count !== 1) throw new LeaveError(409, 'This request has already been processed.');
    return tx.leaveRequest.findUniqueOrThrow({ where: { id }, include: requestInclude });
  });
}

type LeaveTypeInput = z.infer<typeof leaveTypeInputSchema>;

export async function createLeaveType(data: LeaveTypeInput & { subCompanyId: string }) {
  return withLeaveTransaction(async (tx) => {
    const leaveType = await tx.leaveType.create({ data });
    const users = await tx.user.findMany({ where: { isActive: true, subCompanyId: data.subCompanyId }, select: { id: true } });
    const balances = await tx.leaveBalance.createMany({
      data: users.map((user) => ({ userId: user.id, leaveTypeId: leaveType.id, year: new Date().getUTCFullYear(), entitled: leaveType.daysPerYear })),
      skipDuplicates: true,
    });
    return { leaveType, balancesCreated: balances.count };
  });
}

export async function updateLeaveType(id: string, data: Partial<LeaveTypeInput>, subCompanyId: string) {
  return withLeaveTransaction(async (tx) => {
    const existing = await tx.leaveType.findUnique({ where: { id } });
    if (!existing) throw new LeaveError(404, 'Leave type not found.');
    if (existing.subCompanyId !== null && existing.subCompanyId !== subCompanyId) throw new LeaveError(403, 'Leave type belongs to another agency.');
    if (data.daysPerYear !== undefined && data.daysPerYear !== existing.daysPerYear) {
      const where = { leaveTypeId: id, year: new Date().getUTCFullYear(), user: { subCompanyId } };
      const overused = await tx.leaveBalance.count({ where: { ...where, used: { gt: data.daysPerYear } } });
      if (overused) throw new LeaveError(400, 'The yearly allowance cannot be below leave already used by an employee in this agency.');
      await tx.leaveBalance.updateMany({ where, data: { entitled: data.daysPerYear } });
    }
    return tx.leaveType.update({ where: { id }, data });
  });
}

export async function deleteLeaveType(id: string, subCompanyId: string) {
  return withLeaveTransaction(async (tx) => {
    const existing = await tx.leaveType.findUnique({ where: { id } });
    if (!existing) throw new LeaveError(404, 'Leave type not found.');
    if (existing.subCompanyId !== null && existing.subCompanyId !== subCompanyId) throw new LeaveError(403, 'Leave type belongs to another agency.');
    if (await tx.leaveRequest.count({ where: { leaveTypeId: id } })) {
      throw new LeaveError(409, 'Cannot delete a leave type that has requests. Keep it to preserve leave history.');
    }
    const protectedBalances = await tx.leaveBalance.count({
      where: {
        leaveTypeId: id,
        OR: [
          { user: { subCompanyId: { not: subCompanyId } } },
          { user: { subCompanyId: null } },
          { year: { not: new Date().getUTCFullYear() } },
          { used: { gt: 0 } },
        ],
      },
    });
    if (protectedBalances) throw new LeaveError(409, 'Cannot delete a leave type with used balances or allocations for other years or agencies.');
    await tx.leaveBalance.deleteMany({ where: { leaveTypeId: id } });
    await tx.leaveType.delete({ where: { id } });
  });
}

export async function adjustLeaveBalance(
  id: string,
  data: z.infer<typeof leaveBalanceInputSchema>,
  authorize?: (balance: { userId: string; user: { subCompanyId: string | null } }) => void | Promise<void>,
) {
  return withLeaveTransaction(async (tx) => {
    const balance = await tx.leaveBalance.findUnique({ where: { id }, include: { user: { select: { subCompanyId: true } } } });
    if (!balance) throw new LeaveError(404, 'Balance not found.');
    await authorize?.(balance);
    if ((data.entitled ?? balance.entitled) + (data.carriedOver ?? balance.carriedOver) < balance.used) {
      throw new LeaveError(400, 'The adjusted allowance cannot be below leave already used.');
    }
    return tx.leaveBalance.update({
      where: { id }, data,
      include: { user: { select: { id: true, firstName: true, lastName: true } }, leaveType: { select: { id: true, name: true } } },
    });
  });
}

export async function carryOverLeave(subCompanyId: string) {
  return withLeaveTransaction(async (tx) => {
    const currentYear = new Date().getUTCFullYear();
    const nextYear = currentYear + 1;
    const balances = await tx.leaveBalance.findMany({ where: { year: currentYear, user: { subCompanyId } }, include: { leaveType: true } });
    for (const balance of balances) {
      const carriedOver = Math.min(Math.max(0, balance.entitled + balance.carriedOver - balance.used), balance.leaveType.maxCarryOver);
      const key = { userId: balance.userId, leaveTypeId: balance.leaveTypeId, year: nextYear };
      const nextBalance = await tx.leaveBalance.findUnique({ where: { userId_leaveTypeId_year: key } });
      if (nextBalance && balance.leaveType.daysPerYear + carriedOver < nextBalance.used) {
        throw new LeaveError(400, 'Carryover would reduce a next-year balance below leave already used.');
      }
      await tx.leaveBalance.upsert({
        where: { userId_leaveTypeId_year: key },
        create: { ...key, entitled: balance.leaveType.daysPerYear, carriedOver, used: 0 },
        update: { entitled: balance.leaveType.daysPerYear, carriedOver },
      });
    }
    return {
      updated: balances.length, nextYear,
      message: balances.length ? `Carryover complete — ${balances.length} balances created/updated for ${nextYear}.` : 'No balances found for current year.',
    };
  });
}
