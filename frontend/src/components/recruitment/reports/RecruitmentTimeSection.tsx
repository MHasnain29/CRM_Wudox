import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { AgencyManagerUserFilterRows } from '@/components/AgencyManagerUserFilterRows';
import { CrmTimeReportCard } from '@/components/reports/CrmTimeReportCard';
import { useScopeFilter } from '@/hooks/useElevatedScopeFilter';
import { useScopeQueryParams } from '@/hooks/useScopeQueryParams';
import { useCanViewAgencyScope, useCanViewTeamScope } from '@/lib/access';
import type { ReportRangeDays } from '@/lib/recruitmentReportsApi';
import { useStore } from '@/lib/store';

/** The time filters apply only to measured CRM time, not recruitment outcome charts. */
export default function RecruitmentTimeSection({ days, mine = false }: { days: ReportRangeDays; mine?: boolean }) {
  const { currentUser } = useStore();
  const filters = useScopeFilter({ domain: 'recruitment' });
  const { agencyId, ownerIds } = useScopeQueryParams(filters);
  const canViewAgency = useCanViewAgencyScope();
  const canViewTeam = useCanViewTeamScope();
  const scope = mine ? 'mine' : canViewAgency ? 'all' : canViewTeam ? 'team' : 'mine';
  const showFilters = !mine && filters.showAgencyFilterBar;
  const filtersLoading = showFilters && (filters.agenciesLoading || filters.agencyUsersLoading);
  const filtersFailed = showFilters && filters.agencyUsersError;

  const { dateFrom, dateTo } = useMemo(() => {
    // Keep the current calendar day open for polling; the API clips it to its asOf time.
    const end = new Date();
    end.setHours(24, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - days);
    return { dateFrom: start, dateTo: end };
  }, [days]);

  const names = useMemo(() => Object.fromEntries([
    ...filters.agencyUsers,
    ...filters.managers,
    ...filters.associates,
    currentUser,
  ].map(user => [user.id, `${user.firstName} ${user.lastName}`.trim()])), [
    filters.agencyUsers, filters.managers, filters.associates, currentUser,
  ]);

  return (
    <section className="space-y-3" aria-label="Measured CRM time">
      {showFilters && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <p className="text-sm text-muted-foreground">Filter the people shown in measured CRM time below.</p>
          <AgencyManagerUserFilterRows {...filters.filterRowProps} />
        </div>
      )}
      {filtersLoading ? (
        <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading time report filters…
        </p>
      ) : filtersFailed ? (
        <p className="rounded-lg border p-4 text-sm text-destructive" role="alert">
          Could not load the selected people. Refresh the page to retry the time report.
        </p>
      ) : (
        <CrmTimeReportCard
          dateFrom={dateFrom}
          dateTo={dateTo}
          scope={scope}
          agencyIds={agencyId ? [agencyId] : undefined}
          userIds={mine ? undefined : ownerIds}
          names={names}
          title={mine ? 'My measured CRM time' : 'Measured CRM time'}
        />
      )}
    </section>
  );
}
