import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { fetchEmailActivityReport } from '@/lib/emailActivityReport';
import { hasCrmTimeAudience } from '@/lib/crmTimeReport';
import { useStore } from '@/lib/store';
import { useAuthStore } from '@/lib/authStore';

export interface EmailActivityReportParams {
  dateFrom: Date;
  dateTo: Date;
  scope?: 'mine' | 'team' | 'all';
  agencyIds?: string[];
  userIds?: string[];
  enabled?: boolean;
}

export function useEmailActivityReport({ dateFrom, dateTo, scope = 'all', agencyIds, userIds, enabled = true }: EmailActivityReportParams) {
  const currentUserId = useStore(state => state.currentUser.id);
  const authUserId = useAuthStore(state => state.user?.id);
  const [searchParams] = useSearchParams();
  const linkedAccountScope = searchParams.get('linkedUserId') ?? '';
  const refreshTrigger = useStore(state => state.refreshReportsTrigger);
  const from = dateFrom.toISOString();
  const to = dateTo.toISOString();
  const agencies = agencyIds ? [...new Set(agencyIds)].sort() : undefined;
  const users = userIds ? [...new Set(userIds)].sort() : undefined;
  // An empty explicit selection must never widen into an unfiltered audience.
  const hasAudience = hasCrmTimeAudience(agencies, users);
  const query = useQuery({
    queryKey: ['email-activity-report', authUserId, currentUserId, linkedAccountScope, from, to, scope, agencies, users, refreshTrigger],
    queryFn: ({ signal }) => fetchEmailActivityReport({ from, to, scope, agencyIds: agencies, userIds: users }, signal),
    enabled: enabled && hasAudience,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    // Sends keep landing during the current period; a finished period no longer changes.
    refetchInterval: () => enabled && dateFrom.getTime() <= Date.now() && dateTo.getTime() > Date.now() ? 60_000 : false,
  });

  return { ...query, hasAudience };
}
