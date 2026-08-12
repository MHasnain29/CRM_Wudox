import { useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DateRange } from 'react-day-picker';
import {
  type DatePeriodPreset,
  getDatePeriodLabel,
  isValidDatePeriodPreset,
  resolveDateRange,
} from '@/lib/dateRangeFilter';

export function useDateRangeFilter() {
  const [searchParams, setSearchParams] = useSearchParams();

  const rawPeriod = searchParams.get('datePeriod');
  const period: DatePeriodPreset = isValidDatePeriodPreset(rawPeriod) ? rawPeriod : 'all';

  const customFrom = searchParams.get('dateFrom');
  const customTo = searchParams.get('dateTo');

  const customRange = useMemo<DateRange | undefined>(() => {
    if (!customFrom) return undefined;
    const from = new Date(customFrom);
    if (isNaN(from.getTime())) return undefined;
    const to = customTo ? new Date(customTo) : undefined;
    if (to && isNaN(to.getTime())) return { from };
    return { from, to };
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
