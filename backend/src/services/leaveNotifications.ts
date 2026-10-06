import type { Request } from 'express';
import prisma from '../config/database';
import { emitToUsers } from '../socket';
import { buildAccessContext, hasPermission, type AccessContext } from './accessContext';
import { hydrateRequestUserAgency } from './agencyContext';
import { getLeaveAccess, requireLeaveOwnerAccess } from './leaveAccess';
import { createNotificationForUsers, type NotificationType } from './notifications';

type LeaveNotificationRecord = {
  id: string;
  userId: string;
  startDate: Date;
  endDate: Date;
  session: string;
  days: number;
  hourlyCategory?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  durationMinutes?: number | null;
  timezone?: string | null;
  user: { id: string; firstName: string; lastName: string; subCompanyId: string | null; role: string };
  leaveType: { name: string };
};

type Approver = { id: string; role: string; subCompanyId: string | null };

/** Resolve RBAC once per role, then use the same owner-scope checks as leave routes. */
async function eligibleApprovers(agencyId: string | null, ownerId: string): Promise<Approver[]> {
  const roleRows = await prisma.user.findMany({
    where: { isActive: true, offboardingStartedAt: null },
    select: { role: true },
    distinct: ['role'],
  });
  const roleContexts = new Map<string, AccessContext>();
  await Promise.allSettled(roleRows.map(async ({ role }) => {
    const ctx = await buildAccessContext({ sub: '', role, subCompanyId: '', email: '' });
    if (hasPermission(ctx, 'leave:approve')) roleContexts.set(role, ctx);
  }));
  if (roleContexts.size === 0) return [];

  const candidates = await prisma.user.findMany({
    where: { isActive: true, offboardingStartedAt: null, role: { in: [...roleContexts.keys()] } },
    select: { id: true, role: true, subCompanyId: true },
  });
  const results = await Promise.allSettled(candidates.map(async (candidate) => {
    const ctx = roleContexts.get(candidate.role)!;
    const homeAgency = candidate.subCompanyId ?? '';
    const req = {
      user: { sub: candidate.id, email: '', role: candidate.role, subCompanyId: homeAgency },
      access: { ...ctx, userId: candidate.id, subCompanyId: homeAgency },
      query: {}, headers: {},
    } as unknown as Request;
    // Match authentication's effective-home behavior for agency-independent roles.
    await hydrateRequestUserAgency(req);
    req.access!.subCompanyId = req.user!.subCompanyId;
    const access = await getLeaveAccess(req);
    if (!access.canApprove) return null;
    requireLeaveOwnerAccess(access, ownerId, agencyId);
    return candidate;
  }));
  return results.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : []);
}

function dateLabel(record: LeaveNotificationRecord): string {
  const start = record.startDate.toISOString().slice(0, 10);
  const end = record.endDate.toISOString().slice(0, 10);
  const date = start === end ? start : `${start} – ${end}`;
  if (record.session === 'hourly') {
    const category = record.hourlyCategory === 'late_arrival' ? 'Late Arrival' : 'Time Away';
    const minutes = record.durationMinutes ?? 0;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    const duration = [
      hours ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : '',
      remainingMinutes ? `${remainingMinutes} ${remainingMinutes === 1 ? 'minute' : 'minutes'}` : '',
    ].filter(Boolean).join(' ');
    const interval = record.startTime && record.endTime ? `${record.startTime} – ${record.endTime}` : '';
    const time = [interval, record.timezone].filter(Boolean).join(' ');
    return `${date} (${[category, time, duration].filter(Boolean).join(', ')})`;
  }
  const session = record.session === 'first_half' ? 'First Half'
    : record.session === 'second_half' ? 'Second Half' : '';
  const duration = `${record.days} ${record.days === 1 ? 'day' : 'days'}`;
  return `${date} (${session ? `${session}, ` : ''}${duration})`;
}

export async function notifyLeaveChange(
  record: LeaveNotificationRecord,
  action: 'request' | 'approve' | 'reject' | 'cancel',
): Promise<void> {
  const agencyId = record.user.subCompanyId;
  // The persisted owner's agency is authoritative even for a global leave type.
  const approvers = await eligibleApprovers(agencyId, record.userId).catch(() => []);
  const employeeName = `${record.user.firstName} ${record.user.lastName}`.trim();
  const dates = dateLabel(record);
  let recipients: string[];
  let type: NotificationType;
  let title: string;
  let body: string;
  let link: string;

  if (action === 'approve' || action === 'reject') {
    const approved = action === 'approve';
    recipients = [record.userId];
    type = approved ? 'leave_approved' : 'leave_rejected';
    title = approved ? 'Leave Approved' : 'Leave Rejected';
    body = `Your ${record.leaveType.name} request for ${dates} has been ${approved ? 'approved' : 'rejected'}.`;
    link = '/leave';
  } else {
    // Preserve HR escalation; agency-less owners can only be reviewed by Super Admin.
    const roles = !agencyId ? ['super_admin'] : record.user.role === 'hr'
      ? ['super_admin', 'director', 'operations_manager'] : ['hr'];
    recipients = approvers.filter((user) => roles.includes(user.role) && user.id !== record.userId)
      .map((user) => user.id);
    type = action === 'request' ? 'leave_request' : 'leave_cancelled';
    title = action === 'request' ? 'New Leave Request' : 'Leave Request Cancelled';
    body = action === 'request'
      ? `${employeeName} requested ${record.leaveType.name} for ${dates}.`
      : `${employeeName} cancelled their ${record.leaveType.name} request for ${dates}.`;
    link = '/leave/admin';
  }

  // Refresh other reviewers too so their pending counts cannot remain stale.
  emitToUsers([...new Set([record.userId, ...approvers.map((user) => user.id)])], 'leave:refresh', { subCompanyId: agencyId });
  await createNotificationForUsers(recipients, agencyId ?? '', type, title, body, link, record.id).catch(() => {});
}

/** Configuration changes refresh affected employees and authorized approvers only. */
export async function refreshLeaveUsers(agencyId: string | null, extraUserIds: string[] = []): Promise<void> {
  const [employees, approvers] = await Promise.allSettled([
    agencyId ? prisma.user.findMany({
      where: { subCompanyId: agencyId, isActive: true, offboardingStartedAt: null },
      select: { id: true },
    }) : Promise.resolve([]),
    eligibleApprovers(agencyId, extraUserIds[0] ?? 'leave-configuration'),
  ]);
  const ids = new Set(extraUserIds);
  if (employees.status === 'fulfilled') employees.value.forEach((user) => ids.add(user.id));
  if (approvers.status === 'fulfilled') approvers.value.forEach((user) => ids.add(user.id));
  if (ids.size) emitToUsers([...ids], 'leave:refresh', { subCompanyId: agencyId });
}
