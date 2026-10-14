import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/authStore';
import { useHasPermission } from '@/lib/access';
import { CheckInWidget } from '@/components/dashboard/CheckInWidget';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { DateRangeFilterRow } from '@/components/DateRangeFilterRow';
import { ScopeFilterBar } from '@/components/ScopeFilterBar';
import { StickyHeader } from '@/components/StickyHeader';
import { useAttendanceDateFilter } from '@/hooks/useAttendanceDateFilter';
import { useScopeFilter } from '@/hooks/useElevatedScopeFilter';
import { useScopeQueryParams } from '@/hooks/useScopeQueryParams';
import { attendanceEmptyMessage } from '@/lib/attendanceDateRange';
import { ATTENDANCE_PERIOD_OPTIONS } from '@/lib/dateRangeFilter';
import { Clock, Users, CalendarDays, Loader2, RefreshCw } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface AttendanceRecord {
  id: string;
  userId: string;
  date: string;
  checkInAt: string;
  checkOutAt: string | null;
  totalMinutes: number | null;
  user?: { id: string; firstName: string; lastName: string; role: string };
  subCompany?: { id: string; name: string };
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatTime(iso: string): string {
  return format(parseISO(iso), 'h:mm a');
}

const NO_RECORDS: AttendanceRecord[] = [];

function RecordRow({ record }: { record: AttendanceRecord }) {
  // `date` is a DATE column serialised as midnight UTC; parsing the whole instant would show the previous
  // day to anyone west of UTC, so read just the calendar day.
  const date = format(parseISO(record.date.slice(0, 10)), 'EEE, MMM d');
  const checkIn = formatTime(record.checkInAt);
  const checkOut = record.checkOutAt ? formatTime(record.checkOutAt) : null;
  const duration = record.totalMinutes != null ? formatMinutes(record.totalMinutes) : null;

  return (
    <div className="flex items-center justify-between py-3 border-b last:border-0">
      <div className="flex items-center gap-3">
        <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium w-28">{date}</span>
        <span className="text-sm text-muted-foreground">In: {checkIn}</span>
        {checkOut && <span className="text-sm text-muted-foreground">Out: {checkOut}</span>}
      </div>
      <div>
        {duration ? (
          <Badge variant="secondary">{duration}</Badge>
        ) : (
          <Badge variant="outline" className="text-orange-500 border-orange-200">Active</Badge>
        )}
      </div>
    </div>
  );
}

function AllEmployeesTable({ records, emptyMessage }: { records: AttendanceRecord[]; emptyMessage: string }) {
  const byUser: Record<string, AttendanceRecord[]> = {};
  for (const r of records) {
    if (!byUser[r.userId]) byUser[r.userId] = [];
    byUser[r.userId].push(r);
  }

  return (
    <div className="space-y-4">
      {Object.entries(byUser).map(([userId, recs]) => {
        const user = recs[0].user;
        const name = user ? `${user.firstName} ${user.lastName}` : userId;
        const totalMins = recs.reduce((sum, r) => sum + (r.totalMinutes ?? 0), 0);
        const daysPresent = recs.length;
        return (
          <Card key={userId}>
            <CardHeader className="py-3 px-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">{name}</span>
                  {user && <Badge variant="outline" className="text-xs">{user.role.replace(/_/g, ' ')}</Badge>}
                  {recs[0].subCompany && <span className="text-xs text-muted-foreground">{recs[0].subCompany.name}</span>}
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span>{daysPresent} day{daysPresent !== 1 ? 's' : ''}</span>
                  {totalMins > 0 && <span>{formatMinutes(totalMins)} total</span>}
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-4 pt-0 pb-3">
              {recs.map((r) => <RecordRow key={r.id} record={r} />)}
            </CardContent>
          </Card>
        );
      })}
      {Object.keys(byUser).length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">{emptyMessage}</p>
      )}
    </div>
  );
}

export default function Attendance() {
  const queryClient = useQueryClient();
  const canViewAll = useHasPermission('attendance:view_all');
  const userId = useAuthStore((state) => state.user?.id);
  const permissions = useAuthStore((state) => state.permissions);
  const [searchParams] = useSearchParams();
  const dateFilter = useAttendanceDateFilter();
  const [selectedView, setView] = useState<'mine' | 'all' | null>(null);
  const view = canViewAll ? selectedView ?? 'all' : 'mine';

  // The same agency / authority / manager / team chips as Clients, Tasks and Bulk Mail. They only appear for
  // roles that have them (and only in the All Employees view); everyone else keeps the plain agency-wide list.
  const scopeFilter = useScopeFilter();
  const { showHierarchyFilters, filterRowProps, agenciesLoading, agencyUsersLoading } = scopeFilter;
  const { agencyId: scopeAgencyId, ownerIds, scopeKey } = useScopeQueryParams(scopeFilter);
  const showScopeChips = view === 'all' && showHierarchyFilters;
  // undefined = nobody is narrowed out. With the chips, nothing selected resolves to the viewer's own record.
  const chipOwnerIds = showScopeChips ? ownerIds : undefined;
  const chipAgencyId = showScopeChips ? scopeAgencyId : undefined;
  // Chip state needs the agency and people lists before it can name owners; don't request with a half-built scope.
  const scopeLoading = showScopeChips && (agenciesLoading || agencyUsersLoading);

  const { data, isLoading: recordsLoading, isFetching, isError, refetch } = useQuery({
    queryKey: [
      'attendance-records', userId, dateFilter.key, view,
      showScopeChips ? scopeKey : '', chipAgencyId ?? '', chipOwnerIds?.join(',') ?? '',
      searchParams.get('linkedUserId'), permissions,
    ],
    queryFn: async () => {
      const path = view === 'mine' ? '/attendance/me' : '/attendance';
      const params = new URLSearchParams({ from: dateFilter.query.from, to: dateFilter.query.to });
      if (view === 'all') {
        // apiFetch adds the viewed agency unless subCompanyId= / allAgencies= is already in the URL.
        if (chipAgencyId) params.set('subCompanyId', chipAgencyId);
        else params.set('allAgencies', 'true');
        if (chipOwnerIds && chipOwnerIds.length > 0) params.set('ownerIds', chipOwnerIds.join(','));
      }
      const res = await apiFetch<{ data: AttendanceRecord[]; truncated?: boolean }>(`${path}?${params.toString()}`);
      if (res.ok === false) throw new Error(res.error ?? 'Failed to load attendance records');
      return { records: res.data.data ?? [], truncated: res.data.truncated === true };
    },
    enabled: !scopeLoading,
    // Live view only while the range includes today; a past range can't change.
    refetchInterval: view === 'all' && dateFilter.includesToday ? 30_000 : false,
  });
  // A disabled query (scope still loading) is not "loading" to React Query, but the page still has nothing to show.
  const loading = recordsLoading || scopeLoading;
  const records = data?.records ?? NO_RECORDS;
  const truncated = data?.truncated === true;
  const myRecords = view === 'mine' ? records : [];

  const myTotalMins = myRecords.reduce((sum, r) => sum + (r.totalMinutes ?? 0), 0);
  const emptyMessage = attendanceEmptyMessage(dateFilter.label);

  return (
    <div className="flex flex-col min-h-full p-6 gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-[#6366f1]" />
          <h1 className="text-2xl font-semibold">Attendance</h1>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {canViewAll && (
            <Select value={view} onValueChange={(v) => setView(v as 'mine' | 'all')}>
              <SelectTrigger className="w-40" aria-label="Attendance view">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mine">My Attendance</SelectItem>
                <SelectItem value="all">All Employees</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={() => { void refetch(); }} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      <section aria-label="My attendance today" className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">My Attendance — Today</h2>
        <CheckInWidget key={userId} onAttendanceChange={() => { void queryClient.invalidateQueries({ queryKey: ['attendance-records', userId] }); }} />
      </section>

      <StickyHeader zIndex={40}>
        {showScopeChips && <ScopeFilterBar show={showHierarchyFilters} filterRowProps={filterRowProps} />}
        {/* mt-4: the chip rows sit 8px apart, so the same gap here read as a fifth chip row */}
        <DateRangeFilterRow
          className={showScopeChips ? 'mt-4' : undefined}
          options={ATTENDANCE_PERIOD_OPTIONS}
          period={dateFilter.period}
          customRange={dateFilter.customRange}
          onPeriodChange={dateFilter.setPeriod}
          onCustomRangeChange={dateFilter.setCustomRange}
        />
      </StickyHeader>

      {view === 'all' && <div>
        <h2 className="text-sm font-medium">Employee Attendance — {dateFilter.caption}</h2>
        {dateFilter.includesToday && <p className="text-xs text-muted-foreground mt-1">Updates every 30 seconds.</p>}
      </div>}

      {!loading && !isError && truncated && (
        <p role="status" className="text-xs text-amber-600">
          Showing only the most recent records. Narrow the date range{view === 'all' ? ' or the people selected above' : ''} to see the rest.
        </p>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Could not load attendance records.</p>
          <Button size="sm" variant="outline" onClick={() => { void refetch(); }}>Retry</Button>
        </div>
      )}

      {!loading && !isError && view === 'mine' && (
        <>
          {myRecords.length > 0 && (
            <div className="flex gap-4">
              <Card className="flex-1">
                <CardContent className="pt-4 pb-3 px-4">
                  <p className="text-xs text-muted-foreground mb-1">Days Present</p>
                  <p className="text-2xl font-semibold">{myRecords.length}</p>
                </CardContent>
              </Card>
              <Card className="flex-1">
                <CardContent className="pt-4 pb-3 px-4">
                  <p className="text-xs text-muted-foreground mb-1">Total Hours</p>
                  <p className="text-2xl font-semibold">{myTotalMins > 0 ? formatMinutes(myTotalMins) : '—'}</p>
                </CardContent>
              </Card>
            </div>
          )}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm font-medium text-muted-foreground">My Records — {dateFilter.caption}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              {myRecords.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">{emptyMessage}</p>
              ) : (
                myRecords.map((r) => <RecordRow key={r.id} record={r} />)
              )}
            </CardContent>
          </Card>
        </>
      )}

      {!loading && !isError && view === 'all' && (
        <AllEmployeesTable records={records} emptyMessage={emptyMessage} />
      )}
    </div>
  );
}
