import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { usePermission } from '@/hooks/usePermission';
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
import { Clock, ChevronLeft, ChevronRight, Users, CalendarDays, Loader2 } from 'lucide-react';
import { format, parseISO, startOfMonth, addMonths, subMonths } from 'date-fns';

interface AttendanceRecord {
  id: string;
  userId: string;
  date: string;
  checkInAt: string;
  checkOutAt: string | null;
  totalMinutes: number | null;
  user?: { id: string; firstName: string; lastName: string; role: string };
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
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">{name}</span>
                  {user && <Badge variant="outline" className="text-xs">{user.role.replace(/_/g, ' ')}</Badge>}
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
  const canViewAll = usePermission('attendance:view_all');
  const [month, setMonth] = useState<Date>(startOfMonth(new Date()));
  const [view, setView] = useState<'mine' | 'all'>('mine');
  const [myRecords, setMyRecords] = useState<AttendanceRecord[]>([]);
  const [allRecords, setAllRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const monthParam = format(month, 'yyyy-MM');

  const fetchMine = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch<{ data: AttendanceRecord[] }>(`/attendance/me?month=${monthParam}`);
    if (res.ok) setMyRecords(res.data.data ?? []);
    setLoading(false);
  }, [monthParam]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch<{ data: AttendanceRecord[] }>(`/attendance?month=${monthParam}`);
    if (res.ok) setAllRecords(res.data.data ?? []);
    setLoading(false);
  }, [monthParam]);

  useEffect(() => {
    if (view === 'mine') fetchMine();
    else fetchAll();
  }, [view, fetchMine, fetchAll]);

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
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mine">My Attendance</SelectItem>
                <SelectItem value="all">All Employees</SelectItem>
              </SelectContent>
            </Select>
          )}
          <MonthNav month={month} onChange={setMonth} />
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && view === 'mine' && (
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

      {!loading && view === 'all' && (
        <AllEmployeesTable records={allRecords} />
      )}
    </div>
  );
}
