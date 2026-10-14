import { format, parseISO } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { ATTENDANCE_DEFAULT_PERIOD, normalizeRange, resolveDateRange, type DatePeriodPreset } from './dateRangeFilter';

/** Calendar days as the API takes them: inclusive, local `yyyy-MM-dd`. */
export interface AttendanceDayQuery {
  from: string;
  to: string;
}

/**
 * The range shown on the Attendance page: the viewer's LOCAL day edges, resolved relative to `todayKey`
 * (their local "yyyy-MM-dd") so a rolling preset flips once at local midnight rather than on every render.
 * Never null (the page is not paginated, so it is never unbounded): a custom range without usable dates, or
 * a hand-edited URL the API would reject, falls back to the default period (This Month).
 */
export function resolveAttendanceDateRange(
  period: DatePeriodPreset,
  customRange: DateRange | undefined,
  todayKey: string,
): { from: Date; to: Date } {
  const today = parseISO(todayKey);
  return (
    normalizeRange(resolveDateRange(period, customRange, today)) ??
    (resolveDateRange(ATTENDANCE_DEFAULT_PERIOD, undefined, today) as { from: Date; to: Date })
  );
}

/**
 * `attendance.date` is a DATE column, so the range goes over the wire as plain calendar days. Never
 * `toISOString()` here: the instant of a +05:00 viewer's local midnight is the PREVIOUS UTC day, which would
 * shift the whole range by one day.
 */
export function toAttendanceDayQuery(range: { from: Date; to: Date }): AttendanceDayQuery {
  return { from: format(range.from, 'yyyy-MM-dd'), to: format(range.to, 'yyyy-MM-dd') };
}

/** Stable primitive for react-query keys. */
export function attendanceDayKey(query: AttendanceDayQuery): string {
  return `${query.from}|${query.to}`;
}

/** True when the viewer's local today falls inside the range (drives the live 30-second refresh). */
export function attendanceRangeIncludesToday(query: AttendanceDayQuery, todayKey: string): boolean {
  return query.from <= todayKey && todayKey <= query.to;
}

/** Empty-list copy; `periodLabel` is the short range name ("Last 7 Days", "Oct 2 – Oct 8, 2026"). */
export function attendanceEmptyMessage(periodLabel: string): string {
  return `No attendance records for ${periodLabel}`;
}
