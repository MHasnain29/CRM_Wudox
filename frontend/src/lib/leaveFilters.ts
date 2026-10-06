import type { LeaveTimingFields } from './leave';

export type LeaveDurationFilter = 'all' | 'hourly' | 'half_day' | 'full_day';
export type LeaveRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type LeaveStatusFilter = 'all' | LeaveRequestStatus;

export function matchesLeaveRequestFilters(
  request: Pick<LeaveTimingFields, 'session'> & { status: LeaveRequestStatus },
  duration: LeaveDurationFilter,
  status: LeaveStatusFilter = 'all',
): boolean {
  const session = request.session ?? 'full_day';
  const matchesDuration = duration === 'all'
    || (duration === 'half_day'
      ? session === 'first_half' || session === 'second_half'
      : session === duration);
  return matchesDuration && (status === 'all' || request.status === status);
}
