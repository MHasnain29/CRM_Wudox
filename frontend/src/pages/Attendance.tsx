import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { apiFetch, fetchAccessibleAgencies } from '@/lib/api';
import { useAuthStore } from '@/lib/authStore';
import { useCanAccessMultipleAgencies, useHasPermission } from '@/lib/access';
import { useEffectiveUser } from '@/lib/effectiveUser';
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
import { Label } from '@/components/ui/label';
import { Clock, ChevronLeft, ChevronRight, Users, CalendarDays, Loader2, RefreshCw } from 'lucide-react';
import { format, parseISO, startOfMonth, addMonths, subMonths } from 'date-fns';

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

function MonthNav({ month, onChange }: { month: Date; onChange: (d: Date) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon" onClick={() => onChange(subMonths(month, 1))}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-sm font-medium w-28 text-center">{format(month, 'MMMM yyyy')}</span>
      <Button
        variant="outline"
        size="icon"
        onClick={() => onChange(addMonths(month, 1))}
        disabled={format(addMonths(month, 1), 'yyyy-MM') > format(new Date(), 'yyyy-MM')}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function RecordRow({ record }: { record: AttendanceRecord }) {
  const date = format(parseISO(record.date), 'EEE, MMM d');
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

function AllEmployeesTable({ records }: { records: AttendanceRecord[] }) {
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
        <p className="text-sm text-muted-foreground text-center py-8">No attendance records this month.</p>
      )}
    </div>
  );
}

export default function Attendance() {
  const queryClient = useQueryClient();
  const canViewAll = useHasPermission('attendance:view_all');
  const user = useAuthStore((state) => state.user);
  const userId = user?.id;
  const permissions = useAuthStore((state) => state.permissions);
  const canAccessMultipleAgencies = useCanAccessMultipleAgencies();
  const effectiveUser = useEffectiveUser();
  const [agencyId, setAgencyId] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const [month, setMonth] = useState<Date>(startOfMonth(new Date()));
  const [selectedView, setView] = useState<'mine' | 'all' | null>(null);
  const view = canViewAll ? selectedView ?? 'all' : 'mine';
  const showAgencyPicker = canViewAll && (user?.role === 'super_admin' || canAccessMultipleAgencies);
  const { data: accessibleAgencies = [], isLoading: agenciesLoading } = useQuery({
    queryKey: ['attendance-agencies', userId, user?.role, permissions, effectiveUser.isActingAs, effectiveUser.subCompanyId],
    queryFn: fetchAccessibleAgencies,
    enabled: showAgencyPicker,
  });
  const agencies = effectiveUser.isActingAs
    ? accessibleAgencies.filter((agency) => agency.id === effectiveUser.subCompanyId)
    : accessibleAgencies;
  const monthParam = format(month, 'yyyy-MM');
  const currentMonth = monthParam === format(new Date(), 'yyyy-MM');
  const { data: records = [], isLoading: loading, isFetching, isError, refetch } = useQuery({
    queryKey: ['attendance-records', userId, monthParam, view, agencyId, searchParams.get('linkedUserId'), permissions],
    queryFn: async () => {
      const path = view === 'mine' ? '/attendance/me' : '/attendance';
      const agencyQuery = view === 'all' && agencyId ? `subCompanyId=${encodeURIComponent(agencyId)}` : 'allAgencies=true';
      const res = await apiFetch<{ data: AttendanceRecord[] }>(`${path}?month=${monthParam}&${agencyQuery}`);
      if (res.ok === false) throw new Error(res.error ?? 'Failed to load attendance records');
      return res.data.data ?? [];
    },
    refetchInterval: view === 'all' && currentMonth ? 30_000 : false,
  });
  const myRecords = view === 'mine' ? records : [];

  const myTotalMins = myRecords.reduce((sum, r) => sum + (r.totalMinutes ?? 0), 0);

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
          <MonthNav month={month} onChange={setMonth} />
          <Button variant="outline" size="sm" onClick={() => { void refetch(); }} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      <section aria-label="My attendance today" className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">My Attendance — Today</h2>
        <CheckInWidget key={userId} onAttendanceChange={() => { void queryClient.invalidateQueries({ queryKey: ['attendance-records', userId] }); }} />
      </section>

      {view === 'all' && <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Employee Attendance — {format(month, 'MMMM yyyy')}</h2>
          {currentMonth && <p className="text-xs text-muted-foreground mt-1">Updates every 30 seconds.</p>}
        </div>
        {showAgencyPicker && <div className="space-y-1.5 w-full sm:w-72">
          <Label htmlFor="attendance-agency">Agency</Label>
          <Select value={agencyId ?? 'all'} onValueChange={(value) => setAgencyId(value === 'all' ? null : value)} disabled={agenciesLoading}>
            <SelectTrigger id="attendance-agency"><SelectValue placeholder="Select an agency" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accessible agencies</SelectItem>
              {agencies.map((agency) => <SelectItem key={agency.id} value={agency.id}>{agency.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>}
      </div>}

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
              <CardTitle className="text-sm font-medium text-muted-foreground">My Records — {format(month, 'MMMM yyyy')}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              {myRecords.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No attendance records this month.</p>
              ) : (
                myRecords.map((r) => <RecordRow key={r.id} record={r} />)
              )}
            </CardContent>
          </Card>
        </>
      )}

      {!loading && !isError && view === 'all' && (
        <AllEmployeesTable records={records} />
      )}
    </div>
  );
}
