import { addDays, differenceInBusinessDays, format, isWeekend, parseISO } from 'date-fns';
import { useSearchParams } from 'react-router-dom';
import { useAuthStore } from './authStore';
import { useStore } from './store';
import { onLeaveRefresh } from './socket';

export type LeaveSession = 'full_day' | 'first_half' | 'second_half';

export const LEAVE_SESSION_LABELS: Record<LeaveSession, string> = {
  full_day: 'Full Day',
  first_half: 'First Half',
  second_half: 'Second Half',
};

/** Leave dates are calendar dates, including legacy UTC-midnight API values. */
export function formatLeaveDate(value: string, pattern = 'dd MMM yyyy'): string {
  return format(parseISO(value.slice(0, 10)), pattern);
}

export function formatLeavePeriod(request: { startDate: string; endDate: string; session?: LeaveSession }, pattern = 'dd MMM yyyy'): string {
  const start = formatLeaveDate(request.startDate, pattern);
  const dates = request.startDate.slice(0, 10) === request.endDate.slice(0, 10)
    ? start
    : `${start} – ${formatLeaveDate(request.endDate, pattern)}`;
  return `${dates} · ${LEAVE_SESSION_LABELS[request.session ?? 'full_day']}`;
}

export function countLeaveDays(startDate: string, endDate: string, halfDay: boolean): number {
  if (!startDate || (!halfDay && !endDate)) return 0;
  const start = parseISO(startDate);
  const end = parseISO(halfDay ? startDate : endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  if (halfDay) return isWeekend(start) ? 0 : 0.5;
  return differenceInBusinessDays(addDays(end, 1), start);
}

/** Invalidates data when agency, login, linked identity, or permissions change. */
export function useLeaveScopeKey(): string {
  const user = useAuthStore((state) => state.user);
  const permissions = useAuthStore((state) => state.permissions);
  const agencyId = useStore((state) => state.viewedSubCompanyId);
  const currentAgencyId = useStore((state) => state.currentSubCompany?.id);
  const [params] = useSearchParams();
  return JSON.stringify([user?.id, user?.role, agencyId, currentAgencyId, params.get('linkedUserId'), permissions]);
}

export function announceLeaveChange(): void {
  window.dispatchEvent(new Event('leave:refresh'));
}

export function onLeaveDataRefresh(handler: () => void): () => void {
  const unsubscribe = onLeaveRefresh(handler);
  window.addEventListener('leave:refresh', handler);
  return () => {
    unsubscribe();
    window.removeEventListener('leave:refresh', handler);
  };
}
