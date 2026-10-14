import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { fetchCrmTimeReport } from '@/lib/crmTimeApi';
import { hasCrmTimeAudience } from '@/lib/crmTimeReport';
import { useStore } from '@/lib/store';
import { useAuthStore } from '@/lib/authStore';

export interface CrmTimeReportParams {
  dateFrom: Date;
  dateTo: Date;
  scope?: 'mine' | 'team' | 'all';
  agencyIds?: string[];
  userIds?: string[];
  enabled?: boolean;
}

export function useCrmTimeReport({ dateFrom, dateTo, scope = 'all', agencyIds, userIds, enabled = true }: CrmTimeReportParams) {
  const currentUserId = useStore(state => state.currentUser.id);
  const authUserId = useAuthStore(state => state.user?.id);
  const [searchParams] = useSearchParams();
  const linkedAccountScope = searchParams.get('linkedUserId') ?? '';
  const refreshTrigger = useStore(state => state.refreshReportsTrigger);
  const lastBreak = useRef<string | null>(null);
  const from = dateFrom.toISOString();
  const to = dateTo.toISOString();
  const agencies = agencyIds ? [...new Set(agencyIds)].sort() : undefined;
  const users = userIds ? [...new Set(userIds)].sort() : undefined;
  const hasAudience = hasCrmTimeAudience(agencies, users);
  const query = useQuery({
    queryKey: ['crm-time-report', authUserId, currentUserId, linkedAccountScope, from, to, scope, agencies, users, refreshTrigger],
    queryFn: ({ signal }) => fetchCrmTimeReport({ from, to, scope, agencyIds: agencies, userIds: users }, signal),
    enabled: enabled && hasAudience,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: () => enabled && dateFrom.getTime() <= Date.now() && dateTo.getTime() > Date.now() ? 30_000 : false,
  });

  // A confirmed header transition should show up immediately in a visible report.
  const { refetch } = query;
  useEffect(() => {
    if (!enabled || !hasAudience) return;
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ onBreak: boolean; startedAt: string | null }>).detail;
      const key = `${detail.onBreak}:${detail.startedAt ?? ''}`;
      if (lastBreak.current !== key) void refetch();
      lastBreak.current = key;
    };
    window.addEventListener('activity:break_state', refresh);
    return () => window.removeEventListener('activity:break_state', refresh);
  }, [enabled, hasAudience, refetch]);

  return { ...query, hasAudience };
}
