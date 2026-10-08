import { useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DateRange } from 'react-day-picker';
import {
  type DatePeriodPreset,
  getDatePeriodLabel,
  isValidDatePeriodPreset,
  parseDateParam,
  resolveDateRange,
} from '@/lib/dateRangeFilter';

/**
 * `allowedPresets` lets a page accept extra ?datePeriod values (Bulk Mail adds last_7_days /
 * last_30_days). Omitted, behaviour is identical to before, so existing pages are unaffected.
 */
export function useDateRangeFilter(opts?: { allowedPresets?: readonly DatePeriodPreset[] }) {
  const allowedPresets = opts?.allowedPresets;
  const [searchParams, setSearchParams] = useSearchParams();

  const rawPeriod = searchParams.get('datePeriod');
  const period: DatePeriodPreset = isValidDatePeriodPreset(rawPeriod, allowedPresets) ? rawPeriod : 'all';

  const customFrom = searchParams.get('dateFrom');
  const customTo = searchParams.get('dateTo');

  const customRange = useMemo<DateRange | undefined>(() => {
    const from = parseDateParam(customFrom);
    if (!from) return undefined;
    const to = parseDateParam(customTo);
    // No usable end date: a one-day range on `from`.
    if (!to) return { from };
    // A hand-edited URL can put the end before the start; swap rather than silently match nothing.
    return to.getTime() < from.getTime() ? { from: to, to: from } : { from, to };
  }, [customFrom, customTo]);

  const effectiveRange = useMemo(
    () => resolveDateRange(period, customRange),
    [period, customRange],
  );

  const setPeriod = useCallback((next: DatePeriodPreset) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === 'all') {
        params.delete('datePeriod');
        params.delete('dateFrom');
        params.delete('dateTo');
      } else {
        params.set('datePeriod', next);
        if (next !== 'custom') {
          params.delete('dateFrom');
          params.delete('dateTo');
        }
      }
      return params;
    }, { replace: true });
  }, [setSearchParams]);

  const setCustomRange = useCallback((range: DateRange | undefined) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('datePeriod', 'custom');
      if (range?.from) {
        params.set('dateFrom', range.from.toISOString());
        params.set('dateTo', (range.to ?? range.from).toISOString());
      } else {
        params.delete('dateFrom');
        params.delete('dateTo');
      }
      return params;
    }, { replace: true });
  }, [setSearchParams]);

  const periodLabel = getDatePeriodLabel(period);
  const isActive = period !== 'all';

  return {
    period,
    customRange,
    effectiveRange,
    periodLabel,
    isActive,
    setPeriod,
    setCustomRange,
  };
}
