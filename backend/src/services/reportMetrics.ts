import type { ReportProfile } from './dailyReportTypes';

export function defaultReportProfile(role: string): ReportProfile {
  if (['it', 'cto', 'project_manager', 'team_lead', 'developer', 'qa_engineer', 'ui_ux_designer', 'business_analyst', 'devops_engineer', 'dev_team'].includes(role)) return 'software';
  if (['sales_manager', 'sales_associate', 'sales_executive', 'marketing'].includes(role)) return 'marketing_sales';
  if (['recruitment_manager', 'recruiter', 'sr_recruiter'].includes(role)) return 'recruitment';
  return 'general';
}

/** Hubstaff's active state means open, not proof that someone started work. */
export function hubstaffTaskIsOpen(status: string | null): boolean | null {
  if (status === 'active') return true;
  if (['completed', 'deleted', 'archived', 'archived_native_active', 'archived_native_completed', 'archived_native_deleted'].includes(status ?? '')) return false;
  return null;
}

export function inputActivityPercent(overall: number, inputTracked: number): number | null {
  return inputTracked > 0 ? Math.max(0, Math.min(100, Math.round(overall / inputTracked * 100))) : null;
}

export function localDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map(key => parts.find(p => p.type === key)!.value).join('-');
}

export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) throw new Error('Invalid report date');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Find the calendar boundary itself; a local day can be 23 or 25 hours. */
function localDayStart(date: string, timezone: string): Date {
  shiftDate(date, 0);
  const reference = new Date(`${date}T00:00:00Z`).getTime() / 1000;
  let low = reference - 36 * 3600;
  let high = reference + 36 * 3600;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (localDateKey(new Date(mid * 1000), timezone) < date) low = mid + 1;
    else high = mid;
  }
  const result = new Date(low * 1000);
  if (localDateKey(result, timezone) !== date) throw new Error('This date does not exist in the selected timezone');
  return result;
}

export function reportDayBounds(date: string, timezone: string): { start: Date; end: Date } {
  return { start: localDayStart(date, timezone), end: localDayStart(shiftDate(date, 1), timezone) };
}

export function reportDue(policy: { sendHour: number; sendMinute: number; timezone: string }, now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: policy.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const hour = Number(parts.find(p => p.type === 'hour')!.value);
  const minute = Number(parts.find(p => p.type === 'minute')!.value);
  return hour * 60 + minute >= policy.sendHour * 60 + policy.sendMinute;
}

/** Count entities once in a period while retaining reopened/recompleted events as evidence. */
export function uniqueCompletedCount(events: { entityId: string; type: string }[]): number {
  return new Set(events.filter(e => e.type === 'completed').map(e => e.entityId)).size;
}
