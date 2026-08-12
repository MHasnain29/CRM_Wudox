import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  subMonths,
  subYears,
  isWithinInterval,
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

export function getDatePeriodLabel(preset: DatePeriodPreset): string {
  return DATE_PERIOD_OPTIONS.find((o) => o.value === preset)?.label ?? 'All Time';
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

export function isValidDatePeriodPreset(value: string | null): value is DatePeriodPreset {
  return DATE_PERIOD_OPTIONS.some((o) => o.value === value);
}
