import { useMemo } from 'react';
import { useDateRangeFilter } from '@/hooks/useDateRangeFilter';
import { useTodayKey } from '@/hooks/useTodayKey';
import { describeCampaignPeriod } from '@/lib/campaignDate';
import { ATTENDANCE_ALLOWED_PRESETS, ATTENDANCE_DEFAULT_PERIOD } from '@/lib/dateRangeFilter';
import {
  attendanceDayKey,
  attendanceRangeIncludesToday,
  resolveAttendanceDateRange,
  toAttendanceDayQuery,
} from '@/lib/attendanceDateRange';

/**
 * The Attendance page's one date filter. The range lives in the URL (?datePeriod, dateFrom, dateTo), so it
 * survives a refresh and the view / agency / user changes (those only touch their own keys). No ?datePeriod
 * means This Month, which is what the page always opened on.
 */
export function useAttendanceDateFilter() {
  const { period, customRange, setPeriod, setCustomRange } = useDateRangeFilter({
    allowedPresets: ATTENDANCE_ALLOWED_PRESETS,
    defaultPeriod: ATTENDANCE_DEFAULT_PERIOD,
  });
  // Resolved relative to todayKey, which flips once at local midnight, so "Today" / "Last 7 Days" re-resolve
  // on a page left open without the range (and so the query key) changing on every render.
  const todayKey = useTodayKey();
  const dateRange = useMemo(
    () => resolveAttendanceDateRange(period, customRange, todayKey),
    [period, customRange, todayKey],
  );
  const query = useMemo(() => toAttendanceDayQuery(dateRange), [dateRange]);
  const key = attendanceDayKey(query);
  const { label, caption } = useMemo(() => describeCampaignPeriod(period, dateRange), [period, dateRange]);
  const includesToday = attendanceRangeIncludesToday(query, todayKey);

  return {
    period,
    customRange,
    setPeriod,
    setCustomRange,
    /** `from`/`to` as local `yyyy-MM-dd` days for GET /attendance and /attendance/me. */
    query,
    /** Stable primitive for react-query keys. */
    key,
    /** Short name for sentences: "Last 7 Days", "Oct 2 – Oct 8, 2026". */
    label,
    /** Longer text for a heading: "This Month · Oct 1 – Oct 31, 2026". */
    caption,
    includesToday,
  };
}
