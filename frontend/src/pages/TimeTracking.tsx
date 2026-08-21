import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { Timer, ChevronLeft, ChevronRight, Users, CalendarDays, Loader2, FolderKanban } from 'lucide-react';
import { format, parseISO, startOfMonth, addMonths, subMonths } from 'date-fns';

interface TimeEntry {
  id: string;
  userId: string | null;
  hubstaffUserId: number;
  date: string;
  hubstaffProjectId: number;
  projectName: string | null;
  trackedSeconds: number;
  overallSeconds: number;
  idleSeconds: number;
  manualSeconds: number;
  user?: { id: string; firstName: string; lastName: string; role: string } | null;
}

/** One user's day, aggregated across projects. */
interface DayAggregate {
  key: string;
  userId: string | null;
  date: string;
  trackedSeconds: number;
  overallSeconds: number;
  idleSeconds: number;
  projects: { name: string; trackedSeconds: number }[];
  user?: TimeEntry['user'];
}

function formatSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Hubstaff activity %: active (overall) time relative to tracked time. */
function activityPct(overall: number, tracked: number): number | null {
  if (tracked <= 0) return null;
  return Math.round((overall / tracked) * 100);
}

function activityBadgeClass(pct: number): string {
  if (pct >= 60) return 'text-green-600 border-green-200';
  if (pct >= 35) return 'text-amber-600 border-amber-200';
  return 'text-red-600 border-red-200';
}

function aggregateByUserDay(entries: TimeEntry[]): DayAggregate[] {
  const byKey = new Map<string, DayAggregate>();
  for (const e of entries) {
    const key = `${e.userId ?? e.hubstaffUserId}|${e.date}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = {
        key,
        userId: e.userId,
        date: e.date,
        trackedSeconds: 0,
        overallSeconds: 0,
        idleSeconds: 0,
        projects: [],
        user: e.user,
      };
      byKey.set(key, agg);
    }
    agg.trackedSeconds += e.trackedSeconds;
    agg.overallSeconds += e.overallSeconds;
    agg.idleSeconds += e.idleSeconds;
    if (e.trackedSeconds > 0) {
      agg.projects.push({
        name: e.projectName ?? (e.hubstaffProjectId === 0 ? 'No project' : `Project #${e.hubstaffProjectId}`),
        trackedSeconds: e.trackedSeconds,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => b.date.localeCompare(a.date));
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

function DayRow({ day }: { day: DayAggregate }) {
  const pct = activityPct(day.overallSeconds, day.trackedSeconds);
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b last:border-0">
      <div className="flex items-center gap-3 min-w-0">
        <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium w-28 shrink-0">{format(parseISO(day.date), 'EEE, MMM d')}</span>
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {day.projects.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-accent/60 rounded-md px-2 py-0.5">
              <FolderKanban className="h-3 w-3" />
              {p.name} · {formatSeconds(p.trackedSeconds)}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {pct !== null && (
          <Badge variant="outline" className={activityBadgeClass(pct)}>
            {pct}% active
          </Badge>
        )}
        <Badge variant="secondary">{formatSeconds(day.trackedSeconds)}</Badge>
      </div>
    </div>
  );
}

function SummaryCards({ days }: { days: DayAggregate[] }) {
  const totalTracked = days.reduce((s, d) => s + d.trackedSeconds, 0);
  const totalOverall = days.reduce((s, d) => s + d.overallSeconds, 0);
  const avgPct = activityPct(totalOverall, totalTracked);
  return (
    <div className="flex gap-4 flex-wrap">
      <Card className="flex-1 min-w-36">
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-xs text-muted-foreground mb-1">Days Tracked</p>
          <p className="text-2xl font-semibold">{days.filter((d) => d.trackedSeconds > 0).length}</p>
        </CardContent>
      </Card>
      <Card className="flex-1 min-w-36">
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-xs text-muted-foreground mb-1">Total Hours</p>
          <p className="text-2xl font-semibold">{totalTracked > 0 ? formatSeconds(totalTracked) : '—'}</p>
        </CardContent>
      </Card>
      <Card className="flex-1 min-w-36">
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-xs text-muted-foreground mb-1">Avg Activity</p>
          <p className="text-2xl font-semibold">{avgPct !== null ? `${avgPct}%` : '—'}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function AllUsersView({ days }: { days: DayAggregate[] }) {
  const byUser = useMemo(() => {
    const map = new Map<string, DayAggregate[]>();
    for (const d of days) {
      const key = d.userId ?? 'unknown';
      const list = map.get(key) ?? [];
      list.push(d);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [days]);

  if (byUser.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No tracked time this month.</p>;
  }

  return (
    <div className="space-y-4">
      {byUser.map(([userId, userDays]) => {
        const user = userDays[0].user;
        const name = user ? `${user.firstName} ${user.lastName}` : 'Unmapped user';
        const totalTracked = userDays.reduce((s, d) => s + d.trackedSeconds, 0);
        const totalOverall = userDays.reduce((s, d) => s + d.overallSeconds, 0);
        const pct = activityPct(totalOverall, totalTracked);
        return (
          <Card key={userId}>
            <CardHeader className="py-3 px-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">{name}</span>
                  {user && <Badge variant="outline" className="text-xs">{user.role.replace(/_/g, ' ')}</Badge>}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {pct !== null && (
                    <Badge variant="outline" className={activityBadgeClass(pct)}>{pct}% active</Badge>
                  )}
                  <span>{formatSeconds(totalTracked)} total</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-4 pt-0 pb-3">
              {userDays.map((d) => <DayRow key={d.key} day={d} />)}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default function TimeTracking() {
  const canViewAll = usePermission('hubstaff:view_all');
  const [month, setMonth] = useState<Date>(startOfMonth(new Date()));
  const [view, setView] = useState<'mine' | 'all'>('mine');
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const monthParam = format(month, 'yyyy-MM');

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const scope = view === 'all' ? '&scope=all' : '';
    const res = await apiFetch<{ data: TimeEntry[] }>(`/hubstaff/time-entries?month=${monthParam}${scope}`);
    if (res.ok) setEntries(res.data.data ?? []);
    setLoading(false);
  }, [monthParam, view]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const days = useMemo(() => aggregateByUserDay(entries), [entries]);

  return (
    <div className="flex flex-col min-h-full p-6 gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Timer className="h-5 w-5 text-[#0ea5e9]" />
          <h1 className="text-2xl font-semibold">Time Tracking</h1>
          <Badge variant="outline" className="text-xs text-muted-foreground">Hubstaff</Badge>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {canViewAll && (
            <Select value={view} onValueChange={(v) => setView(v as 'mine' | 'all')}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mine">My Time</SelectItem>
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
          {days.length > 0 && <SummaryCards days={days} />}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                My Tracked Time — {format(month, 'MMMM yyyy')}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              {days.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No tracked time this month. Time appears here once your Hubstaff account is mapped
                  and the tracker has synced.
                </p>
              ) : (
                days.map((d) => <DayRow key={d.key} day={d} />)
              )}
            </CardContent>
          </Card>
        </>
      )}

      {!loading && view === 'all' && <AllUsersView days={days} />}
    </div>
  );
}
