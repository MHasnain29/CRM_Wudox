import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  subDays,
  subMonths,
  subYears,
  isWithinInterval,
  isValid,
  parseISO,
} from 'date-fns';
import type { DateRange } from 'react-day-picker';
import type { Lead } from '@/lib/types';

export type DatePeriodPreset =
  | 'all'
  | 'today'
  | 'this_week'
  | 'this_month'
  | 'this_year'
  | 'last_year'
  | 'last_month'
  | 'q1'
  | 'q2'
  | 'q3'
  | 'q4'
  | 'last_7_days'
  | 'last_30_days'
  | 'custom';

export const DATE_PERIOD_OPTIONS: { value: DatePeriodPreset; label: string }[] = [
  { value: 'all', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'this_year', label: 'This Year' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'last_year', label: 'Last Year' },
  { value: 'q1', label: 'First Quarter' },
  { value: 'q2', label: 'Second Quarter' },
  { value: 'q3', label: 'Third Quarter' },
  { value: 'q4', label: 'Fourth Quarter' },
  { value: 'custom', label: 'Custom Range' },
];

/**
 * Bulk Mail dropdown entries. Kept separate from DATE_PERIOD_OPTIONS so the Leads / Proposals / Pipeline
 * dropdowns are unchanged; labels use the same Title Case as those dropdowns.
 */
export const BULK_MAIL_PERIOD_OPTIONS: { value: DatePeriodPreset; label: string }[] = [
  { value: 'all', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'last_7_days', label: 'Last 7 Days' },
  { value: 'last_30_days', label: 'Last 30 Days' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'custom', label: 'Custom Range' },
];

/** Every ?datePeriod value Bulk Mail accepts. */
export const BULK_MAIL_ALLOWED_PRESETS: readonly DatePeriodPreset[] = BULK_MAIL_PERIOD_OPTIONS.map((o) => o.value);

/** Label exactly as shown in the Bulk Mail dropdown, so captions and empty states match what the user picked. */
export function getBulkMailPeriodLabel(preset: DatePeriodPreset): string {
  return BULK_MAIL_PERIOD_OPTIONS.find((o) => o.value === preset)?.label ?? getDatePeriodLabel(preset);
}

export function getDatePeriodLabel(preset: DatePeriodPreset): string {
  return (
    DATE_PERIOD_OPTIONS.find((o) => o.value === preset)?.label ??
    BULK_MAIL_PERIOD_OPTIONS.find((o) => o.value === preset)?.label ??
    'All Time'
  );
}

function quarterRange(year: number, quarter: 1 | 2 | 3 | 4): { from: Date; to: Date } {
  const startMonth = (quarter - 1) * 3;
  const from = startOfDay(new Date(year, startMonth, 1));
  const to = endOfDay(new Date(year, startMonth + 3, 0));
  return { from, to };
}

/** Resolve a preset (and optional custom range) into inclusive start/end dates. */
export function resolveDateRange(
  preset: DatePeriodPreset,
  customRange?: DateRange,
  refDate = new Date(),
): { from: Date; to: Date } | null {
  if (preset === 'all') return null;

  const now = refDate;

  if (preset === 'today') {
    return { from: startOfDay(now), to: endOfDay(now) };
  }
  if (preset === 'this_week') {
    return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
  }
  if (preset === 'this_month') {
    return { from: startOfMonth(now), to: endOfMonth(now) };
  }
  if (preset === 'this_year') {
    return { from: startOfYear(now), to: endOfYear(now) };
  }
  if (preset === 'last_month') {
    const prev = subMonths(now, 1);
    return { from: startOfMonth(prev), to: endOfMonth(prev) };
  }
  if (preset === 'last_year') {
    const prev = subYears(now, 1);
    return { from: startOfYear(prev), to: endOfYear(prev) };
  }
  // Calendar-day arithmetic (never 24h * n ms) so a DST change inside the window can't shift an edge.
  if (preset === 'last_7_days') {
    return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
  }
  if (preset === 'last_30_days') {
    return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
  }
  if (preset === 'q1') return quarterRange(now.getFullYear(), 1);
  if (preset === 'q2') return quarterRange(now.getFullYear(), 2);
  if (preset === 'q3') return quarterRange(now.getFullYear(), 3);
  if (preset === 'q4') return quarterRange(now.getFullYear(), 4);

  if (preset === 'custom' && customRange?.from) {
    const from = startOfDay(customRange.from);
    const to = endOfDay(customRange.to ?? customRange.from);
    return { from, to };
  }

  return null;
}

export function matchesDateRange(date: Date | undefined | null, range: { from: Date; to: Date } | null): boolean {
  if (!range) return true;
  if (!date) return false;
  return isWithinInterval(date, { start: range.from, end: range.to });
}

/** Closed leads use closedAt; open/active leads use createdAt. */
export function getLeadFilterDate(lead: Pick<Lead, 'status' | 'closedAt' | 'createdAt' | 'updatedAt'>): Date {
  const isTerminal =
    lead.status === 'closed_won' ||
    lead.status === 'closed_lost' ||
    lead.status === 'closed_won_pending';
  if (isTerminal) return lead.closedAt ?? lead.updatedAt ?? lead.createdAt;
  return lead.createdAt;
}

export function leadMatchesDateRange(
  lead: Pick<Lead, 'status' | 'closedAt' | 'createdAt' | 'updatedAt'>,
  range: { from: Date; to: Date } | null,
): boolean {
  return matchesDateRange(getLeadFilterDate(lead), range);
}

export function proposalMatchesDateRange(
  proposal: { createdAt: string | Date },
  range: { from: Date; to: Date } | null,
): boolean {
  const date = typeof proposal.createdAt === 'string' ? new Date(proposal.createdAt) : proposal.createdAt;
  return matchesDateRange(date, range);
}

/**
 * `allowed` defaults to the classic option list, so existing callers (and ?datePeriod=last_7_days on
 * Leads / Proposals / Pipeline) behave exactly as before.
 */
export function isValidDatePeriodPreset(
  value: string | null,
  allowed: readonly DatePeriodPreset[] = DATE_PERIOD_OPTIONS.map((o) => o.value),
): value is DatePeriodPreset {
  return value !== null && (allowed as readonly string[]).includes(value);
}

const MIN_YEAR = 1900;
const MAX_YEAR = 9999;

function isSaneDate(d: Date): boolean {
  if (!isValid(d)) return false;
  const y = d.getFullYear();
  return y >= MIN_YEAR && y <= MAX_YEAR;
}

// The campaigns API only accepts instants whose UTC year is 1970..2100 (backend/src/routes/campaigns.ts).
// A local day's UTC instant can land in the adjacent year (UTC-12..UTC+14), so stay one year inside that window.
const QUERY_MIN_YEAR = 1971;
const QUERY_MAX_YEAR = 2099;

function isQuerySafeDate(d: Date): boolean {
  return isValid(d) && d.getFullYear() >= QUERY_MIN_YEAR && d.getFullYear() <= QUERY_MAX_YEAR;
}

/** `min` / `max` for <input type="date">, matching what the campaigns API accepts. */
export const PICKER_MIN_DATE = `${QUERY_MIN_YEAR}-01-01`;
export const PICKER_MAX_DATE = `${QUERY_MAX_YEAR}-12-31`;

/**
 * Strict parser for the picker's text inputs: exactly yyyy-MM-dd, a real calendar day (no Feb 30 roll-over),
 * inside the supported years. Returns a LOCAL date at midnight, or null.
 */
export function parsePickerDate(text: string | null | undefined): Date | null {
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = parseISO(text);
  return isQuerySafeDate(d) ? d : null;
}

/**
 * Last line of defence before a range reaches a query key / request: drops Invalid Dates and years the
 * API would reject (a hand-edited URL), and re-orders a reversed range onto whole-day edges.
 */
export function normalizeRange(range: { from: Date; to: Date } | null): { from: Date; to: Date } | null {
  if (!range || !isQuerySafeDate(range.from) || !isQuerySafeDate(range.to)) return null;
  if (range.from.getTime() > range.to.getTime()) {
    return { from: startOfDay(range.to), to: endOfDay(range.from) };
  }
  return range;
}

/**
 * Parses a ?dateFrom / ?dateTo value. A bare yyyy-MM-dd is a LOCAL calendar day (new Date('2026-10-01')
 * would be UTC midnight, i.e. the previous evening west of UTC); anything else is parsed as an ISO instant.
 */
export function parseDateParam(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? parseISO(raw) : new Date(raw);
  return isSaneDate(d) ? d : null;
}

/** Stable primitive for react-query keys: 'all' or the two ISO instants. */
export function dateRangeKey(range: { from: Date; to: Date } | null): string {
  return range ? `${range.from.toISOString()}|${range.to.toISOString()}` : 'all';
}

/** API params for a resolved range (ISO instants of the viewer's local day edges); undefined when unfiltered. */
export function toDateRangeQuery(
  range: { from: Date; to: Date } | null,
): { from: string; to: string } | undefined {
  return range ? { from: range.from.toISOString(), to: range.to.toISOString() } : undefined;
}
