import { LeaveSession } from '@prisma/client';
import { LeaveError } from './leaveError';

export const LEAVE_TIMEZONE = 'America/Toronto';
export const HOURLY_BALANCE_DEDUCTION = 'none' as const;

export type WorkSchedule = { workStartTime: string; workEndTime: string };

export function clockMinutes(value: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new LeaveError(400, 'Use a valid time in HH:mm format.');
  }
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function workdayInterval(schedule: WorkSchedule): [number, number] {
  const start = clockMinutes(schedule.workStartTime);
  const end = clockMinutes(schedule.workEndTime);
  if (end <= start) throw new LeaveError(400, 'Hourly leave requires a work schedule that starts and ends on the same day. Contact HR to check your working hours.');
  return [start, end];
}

export function leavePolicy(schedule: WorkSchedule) {
  // Invalid/overnight schedules must not stop employees requesting full or half days.
  let balanceDayMinutes = 0;
  let halfDayBoundary: string | null = null;
  try {
    const [start, end] = workdayInterval(schedule);
    balanceDayMinutes = end - start;
    const midpoint = (start + end) / 2;
    halfDayBoundary = `${String(Math.floor(midpoint / 60)).padStart(2, '0')}:${String(Math.floor(midpoint % 60)).padStart(2, '0')}${Number.isInteger(midpoint) ? '' : ':30'}`;
  } catch (error) {
    if (!(error instanceof LeaveError)) throw error;
  }
  return { ...schedule, timezone: LEAVE_TIMEZONE, hourlyBalanceDeduction: HOURLY_BALANCE_DEDUCTION, balanceDayMinutes, halfDayBoundary };
}

/** Days use six decimal places; the original duration stays exact in integer minutes. */
export function roundLeaveDays(days: number): number {
  return Math.round((days + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export type LeaveInterval = {
  session: LeaveSession;
  startTime?: string | null;
  endTime?: string | null;
  workDayStartTime?: string | null;
  workDayEndTime?: string | null;
};

function interval(request: LeaveInterval, schedule: WorkSchedule): [number, number] {
  if (request.session === LeaveSession.full_day) return [0, 1440];
  if (request.session === LeaveSession.hourly) {
    if (!request.startTime || !request.endTime) throw new LeaveError(409, 'This hourly request is missing its time interval. Contact HR.');
    return [clockMinutes(request.startTime), clockMinutes(request.endTime)];
  }
  const [start, end] = workdayInterval({
    workStartTime: request.workDayStartTime ?? schedule.workStartTime,
    workEndTime: request.workDayEndTime ?? schedule.workEndTime,
  });
  const midpoint = (start + end) / 2;
  return request.session === LeaveSession.first_half ? [start, midpoint] : [midpoint, end];
}

/** Adjacent intervals can coexist. Legacy halves use the employee's current schedule. */
export function leaveTimesOverlap(left: LeaveInterval, right: LeaveInterval, schedule: WorkSchedule): boolean {
  if (left.session === LeaveSession.full_day || right.session === LeaveSession.full_day) return true;
  try {
    const [leftStart, leftEnd] = interval(left, schedule);
    const [rightStart, rightEnd] = interval(right, schedule);
    return leftStart < rightEnd && rightStart < leftEnd;
  } catch (error) {
    // Overnight schedules were supported as session labels before hourly leave existed.
    if (error instanceof LeaveError && left.session !== LeaveSession.hourly && right.session !== LeaveSession.hourly) {
      return left.session === right.session;
    }
    throw error;
  }
}
