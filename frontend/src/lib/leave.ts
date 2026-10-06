import { addDays, differenceInBusinessDays, format, isWeekend, parseISO } from 'date-fns';
import { useSearchParams } from 'react-router-dom';
import { useAuthStore } from './authStore';
import { useStore } from './store';
import { onLeaveRefresh } from './socket';

export type LeaveSession = 'full_day' | 'first_half' | 'second_half' | 'hourly';
export type HourlyLeaveCategory = 'time_away' | 'late_arrival';

export interface LeaveTimingFields {
  session?: LeaveSession | null;
  hourlyCategory?: HourlyLeaveCategory | null;
  startTime?: string | null;
  endTime?: string | null;
  durationMinutes?: number | null;
  timezone?: string | null;
}

export interface LeavePolicy {
  workStartTime: string;
  workEndTime: string;
  timezone: string;
  hourlyBalanceDeduction: 'both' | 'time_away' | 'none';
  balanceDayMinutes: number;
  halfDayBoundary: string | null;
}

export const HOURLY_LEAVE_CATEGORY_LABELS: Record<HourlyLeaveCategory, string> = {
  time_away: 'Time Away',
  late_arrival: 'Late Arrival',
};

export const LEAVE_SESSION_LABELS: Record<LeaveSession, string> = {
  full_day: 'Full Day',
  first_half: 'First Half',
  second_half: 'Second Half',
  hourly: 'Hourly',
};

export function leaveTimeMinutes(value: string): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function leaveMinutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function formatLeaveTime(value: string): string {
  const minutes = leaveTimeMinutes(value);
  if (minutes === null) return '';
  const hour = Math.floor(minutes / 60);
  return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

export function countHourlyLeaveMinutes(startTime: string, endTime: string): number {
  const start = leaveTimeMinutes(startTime);
  const end = leaveTimeMinutes(endTime);
  return start === null || end === null || end <= start ? 0 : end - start;
}

export function formatLeaveMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [
    hours ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : '',
    remainder ? `${remainder} ${remainder === 1 ? 'minute' : 'minutes'}` : '',
  ].filter(Boolean).join(' ') || '0 minutes';
}

export function formatLeaveDays(days: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(days);
}

/** Leave dates are calendar dates, including legacy UTC-midnight API values. */
export function formatLeaveDate(value: string, pattern = 'dd MMM yyyy'): string {
  return format(parseISO(value.slice(0, 10)), pattern);
}

export function formatLeavePeriod(request: { startDate: string; endDate: string } & LeaveTimingFields, pattern = 'dd MMM yyyy'): string {
  const start = formatLeaveDate(request.startDate, pattern);
  const dates = request.startDate.slice(0, 10) === request.endDate.slice(0, 10)
    ? start
    : `${start} – ${formatLeaveDate(request.endDate, pattern)}`;
  if (request.session !== 'hourly') return `${dates} · ${LEAVE_SESSION_LABELS[request.session ?? 'full_day']}`;
  const category = request.hourlyCategory ? HOURLY_LEAVE_CATEGORY_LABELS[request.hourlyCategory] : 'Hourly';
  const interval = request.startTime && request.endTime ? `${request.startTime}–${request.endTime}${request.timezone ? ` (${request.timezone})` : ''}` : '';
  const duration = request.durationMinutes != null ? formatLeaveMinutes(request.durationMinutes) : '';
  return [dates, category, interval, duration].filter(Boolean).join(' · ');
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
