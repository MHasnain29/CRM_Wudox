import { useCallback, useMemo } from 'react';
import { useDateRangeFilter } from '@/hooks/useDateRangeFilter';
import { useTodayKey } from '@/hooks/useTodayKey';
import { describeCampaignPeriod } from '@/lib/campaignDate';
import { dateRangeKey, toDateRangeQuery, EMAIL_ALLOWED_PRESETS } from '@/lib/dateRangeFilter';
import { resolveEmailDateRange } from '@/lib/emailDateRange';

/**
 * The Emails page's one date filter. The range lives in the URL (?datePeriod, dateFrom, dateTo), so it
 * survives a refresh, the Inbox/Sent/Drafts tabs and scope-chip changes (those only touch their own keys).
 * Call it once in the page and hand the result to every mailbox view (it is an EmailDateSummary plus the
 * picker state).
 */
export function useEmailDateFilter() {
  const { period, customRange, setPeriod, setCustomRange } = useDateRangeFilter({ allowedPresets: EMAIL_ALLOWED_PRESETS });
  // Resolved relative to todayKey, which flips once at local midnight, so "Today" / "Last 7 days" re-resolve
  // on a page left open without the range (and so the query key) changing on every render.
  const todayKey = useTodayKey();
  const dateRange = useMemo(
    () => resolveEmailDateRange(period, customRange, todayKey),
    [period, customRange, todayKey],
  );
  const dateKey = dateRangeKey(dateRange);
  const query = useMemo(() => toDateRangeQuery(dateRange), [dateRange]);
  const { label, caption } = useMemo(() => describeCampaignPeriod(period, dateRange), [period, dateRange]);
  const clear = useCallback(() => setPeriod('all'), [setPeriod]);

  return {
    period,
    customRange,
    setPeriod,
    setCustomRange,
    dateRange,
    dateKey,
    /** `from`/`to` ISO instants for GET /emails; undefined when no range is applied. */
    query,
    // Active means "a range is really applied": a 'custom' period without usable dates resolves to null.
    isActive: dateRange !== null,
    label,
    caption,
    clear,
  };
}
