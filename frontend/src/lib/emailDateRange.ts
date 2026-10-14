import { parseISO } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { normalizeRange, resolveDateRange, type DatePeriodPreset } from './dateRangeFilter';

/**
 * What a mailbox section needs to describe and clear the active date range. `useEmailDateFilter` returns
 * a superset of this, so the page hands the whole object to every section.
 */
export interface EmailDateSummary {
  /** 'all' or the two ISO instants; part of every list's scroll/selection key. */
  dateKey: string;
  isActive: boolean;
  /** Short name for sentences: "Last 7 Days", "Oct 2 – Oct 8, 2026". */
  label: string;
  /** Longer text for a header line: "Last 7 Days · Oct 2 – Oct 8, 2026". */
  caption: string;
  clear: () => void;
}

/**
 * The range sent to GET /emails: the viewer's LOCAL day edges, resolved relative to `todayKey` (their local
 * "yyyy-MM-dd") so a rolling preset flips once at local midnight rather than on every render. null means
 * All Time, including a hand-edited URL the API would reject (Invalid Date, years outside the supported
 * window); a reversed custom range is swapped onto whole-day edges.
 */
export function resolveEmailDateRange(
  period: DatePeriodPreset,
  customRange: DateRange | undefined,
  todayKey: string,
): { from: Date; to: Date } | null {
  return normalizeRange(resolveDateRange(period, customRange, parseISO(todayKey)));
}

/**
 * Stable primitive for query / view keys, derived from the request params themselves so the mailbox hook
 * needs no extra input. Matches dateRangeKey() for a full range; 'all' when neither bound is set.
 */
export function emailDateKey(range: { from?: string; to?: string } | undefined): string {
  if (!range?.from && !range?.to) return 'all';
  return `${range.from ?? ''}|${range.to ?? ''}`;
}

/**
 * Empty-list copy. A search wins: it can only narrow the loaded rows, so it must not read as "nothing in
 * this period". `periodLabel` is only used while a range is active.
 */
export function emailListEmptyMessage(opts: {
  folder: string;
  searchQuery: string;
  hasNextPage: boolean;
  isDateActive: boolean;
  periodLabel: string;
}): string {
  const { folder, searchQuery, hasNextPage, isDateActive, periodLabel } = opts;
  if (searchQuery) return hasNextPage ? 'No matching emails loaded yet' : 'No matching emails';
  return isDateActive ? `No emails in ${folder} for ${periodLabel}` : `No emails in ${folder}`;
}
