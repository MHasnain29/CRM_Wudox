/**
 * useReportData — fetches all data the Reports page needs from the API.
 * Re-fetches when selectedUserIds, date range, subCompanyId, or refreshReportsTrigger changes.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useStore } from '@/lib/store';
import {
  fetchCalls,
  fetchMeetings,
  fetchTasks,
  fetchFollowUps,
  fetchLeads,
  fetchActivityLogs,
  fetchMyActivityLogs,
  fetchMyTimeLogs,
  fetchUserPositions,
  type ApiCall,
  type ApiMeeting,
  type ApiTask,
  type ApiFollowUp,
  type ApiLead,
} from '@/lib/api';
import type { ActivityLog } from '@/lib/types';

export interface ReportRawData {
  calls: ApiCall[];
  meetings: ApiMeeting[];
  tasks: ApiTask[];
  followUps: ApiFollowUp[];
  leadsWon: ApiLead[];
  leadsLost: ApiLead[];
  emailLogs: ActivityLog[];
  pipelineLogs: ActivityLog[];
  breakLogs: ActivityLog[];
  idleLogs: ActivityLog[];
  /** userId → total positions closed for Closed Won leads in the report date range. */
  positionsClosedByUser: Record<string, number>;
}

interface UseReportDataParams {
  dateFrom: Date;
  dateTo: Date;
  subCompanyId: string | undefined;
  scope: 'mine' | 'team' | 'all';
  agencyId?: string;    // explicit agency override from Reports in-page tab
  ownerIds?: string[];  // specific user filter from Reports in-page tab
  /** Sales/recruitment managers: GET /activity-logs is per-user — merge these fetches for team reports. */
  activityLogSubjectIds?: string[];
  /** When false, skip fetch (e.g. Database Manager — org-wide, no agency activity report). */
  enabled?: boolean;
}

interface UseReportDataReturn {
  data: ReportRawData | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetch all pages of a paginated calls endpoint.
 * Calls are capped at 100/page by the backend — this loops until all pages are fetched.
 */
async function fetchAllCallPages(
  params: Omit<Parameters<typeof fetchCalls>[0], 'page' | 'limit'>
): Promise<{ data: ApiCall[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  const first = await fetchCalls({ ...params, page: 1, limit: 100 });
  if (first.pagination.totalPages <= 1) return first;
  const rest = await Promise.all(
    Array.from({ length: first.pagination.totalPages - 1 }, (_, i) =>
      fetchCalls({ ...params, page: i + 2, limit: 100 })
    )
  );
  const allData = [first.data, ...rest.map(r => r.data)].flat();
  return { data: allData, pagination: { page: 1, limit: allData.length, total: allData.length, totalPages: 1 } };
}

/** Activity logs for Reports: one agency-wide request, or per-user requests merged (manager team scope). */
async function fetchActivityLogsForReports(params: {
  type: string;
  from: string;
  to: string;
  limit: number;
  subCompanyId?: string;
  subjectIds?: string[];
}): Promise<ActivityLog[]> {
  const { subjectIds, ...base } = params;
  if (!subjectIds?.length) {
    return fetchActivityLogs(base);
  }
  if (subjectIds.length === 1) {
    return fetchActivityLogs({ ...base, userId: subjectIds[0] });
  }
  const perUserLimit = Math.max(100, Math.ceil(params.limit / subjectIds.length));
  const chunks = await Promise.all(
    subjectIds.map((userId) => fetchActivityLogs({ ...base, userId, limit: perUserLimit })),
  );
  const merged = chunks.flat();
  merged.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return merged.slice(0, params.limit);
}

export function useReportData({
  dateFrom,
  dateTo,
  subCompanyId,
  scope,
  agencyId,
  ownerIds,
  activityLogSubjectIds,
  enabled = true,
}: UseReportDataParams): UseReportDataReturn {
  const [data, setData] = useState<ReportRawData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshReportsTrigger = useStore((s) => s.refreshReportsTrigger);
  const abortRef = useRef(0);

  const doFetch = useCallback(async (isRefresh: boolean) => {
    if (!enabled || !subCompanyId) {
      setData(null);
      setError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const fetchId = ++abortRef.current;

    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    const from = dateFrom.toISOString();
    const to = dateTo.toISOString();

    const agencyIds = agencyId ? [agencyId] : undefined;
    const effectiveSubCompanyId = agencyId ?? subCompanyId;

    // scope='mine' — use /mine. Otherwise use GET /activity-logs (agency-wide for directors, merged per-user for sales/recruitment managers).
    const emailLogFetch =
      scope === 'mine'
        ? fetchMyActivityLogs({ type: 'email_sent', from, to, limit: 500 })
        : fetchActivityLogsForReports({
            type: 'email_sent',
            from,
            to,
            limit: 500,
            subCompanyId: effectiveSubCompanyId,
            subjectIds: activityLogSubjectIds,
          });

    const pipelineLogFetch =
      scope === 'mine'
        ? fetchMyActivityLogs({ type: 'pipeline_moved', from, to, limit: 500 })
        : fetchActivityLogsForReports({
            type: 'pipeline_moved',
            from,
            to,
            limit: 500,
            subCompanyId: effectiveSubCompanyId,
            subjectIds: activityLogSubjectIds,
          });

    const startDate = dateFrom.toISOString().slice(0, 10);
    const endDate   = dateTo.toISOString().slice(0, 10);

    try {
      const results = await Promise.allSettled([
        // 0: Calls — paginate all pages (backend max 100/page, server-side date filter via from/to)
        // Voice calls API only accepts 'mine'|'all'; map 'team' → 'all' so Zod doesn't reject the
        // entire query (which would silently drop the from/to date params and return all-time data).
        fetchAllCallPages({ scope: scope === 'mine' ? 'mine' : 'all', agencyIds, ownerIds, from, to }),
        // 1: Meetings — server-side date filter via from/to
        fetchMeetings({ scope, from, to, limit: 200, agencyIds, ownerIds }),
        // 2: Tasks — no server-side date filter; client-side filtered in Reports
        fetchTasks({ scope, limit: 500, subCompanyId: effectiveSubCompanyId, agencyIds, ownerIds }),
        // 3: Follow-ups — no server-side date filter; client-side filtered in Reports
        fetchFollowUps({ subCompanyId: effectiveSubCompanyId, limit: 200, agencyIds, ownerIds }),
        // 4: Leads won — increased limit; date-filtered client-side by closedAt
        fetchLeads({ status: 'won', subCompanyId: effectiveSubCompanyId, limit: 1000, agencyIds, ownerIds }),
        // 5: Leads lost — increased limit; date-filtered client-side by closedAt
        fetchLeads({ status: 'lost', subCompanyId: effectiveSubCompanyId, limit: 1000, agencyIds, ownerIds }),
        // 6: Email sent logs — server-side date filter; /mine for regular users, full endpoint for managers+
        emailLogFetch,
        // 7: Pipeline movement logs — same pattern as emails
        pipelineLogFetch,
        // 8: Break & idle logs — /my-time requires no settings:read; managers see all agency users
        fetchMyTimeLogs({ from, to, limit: 500, subCompanyId: effectiveSubCompanyId }),
        // 9: Positions closed per user — server-side date filter via closedAt on closed_won leads
        fetchUserPositions({ startDate, endDate, agencyIds }),
      ]);

      // Abort if a newer fetch started
      if (fetchId !== abortRef.current) return;

      const extract = <T,>(r: PromiseSettledResult<T>, fallback: T): T =>
        r.status === 'fulfilled' ? r.value : fallback;

      const paginatedFallback = { data: [] as any[], pagination: { page: 1, limit: 0, total: 0, totalPages: 0 } };

      const timeLogs: ActivityLog[] = extract(results[8], []);

      setData({
        calls:        extract(results[0], paginatedFallback).data,
        meetings:     extract(results[1], paginatedFallback).data,
        tasks:        extract(results[2], paginatedFallback).data,
        followUps:    extract(results[3], paginatedFallback).data,
        leadsWon:     extract(results[4], paginatedFallback).data,
        leadsLost:    extract(results[5], paginatedFallback).data,
        emailLogs:    extract(results[6], []),
        pipelineLogs: extract(results[7], []),
        breakLogs:    timeLogs.filter(l => l.type === 'break_detected'),
        idleLogs:     timeLogs.filter(l => l.type === 'idle_detected'),
        positionsClosedByUser: extract(results[9], {}),
      });

      // Check if any critical fetches failed
      const failedCount = results.filter((r) => r.status === 'rejected').length;
      if (failedCount > 0) {
        setError(`${failedCount} data source(s) failed to load`);
      }
    } catch (e) {
      if (fetchId !== abortRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load report data');
    } finally {
      if (fetchId === abortRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [enabled, subCompanyId, dateFrom, dateTo, scope, agencyId, ownerIds, activityLogSubjectIds]);

  // Initial fetch + re-fetch when params change
  useEffect(() => {
    doFetch(false);
  }, [doFetch]);

  // Re-fetch on socket-triggered refresh
  useEffect(() => {
    if (refreshReportsTrigger === 0) return;
    doFetch(true);
  }, [refreshReportsTrigger, doFetch]);

  const refetch = useCallback(() => doFetch(true), [doFetch]);

  return { data, loading, refreshing, error, refetch };
}
