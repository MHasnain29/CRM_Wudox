import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/authStore';
import { useStore } from '@/lib/store';
import { formatLeaveDays, formatLeavePeriod, onLeaveDataRefresh, useLeaveScopeKey, type LeaveTimingFields } from '@/lib/leave';
import { format, isToday, isPast } from 'date-fns';
import {
  FolderKanban, CheckSquare, CalendarOff, Clock, Users,
  AlertTriangle, CheckCircle2, Circle, TrendingUp, Inbox,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { NoticeBar } from './NoticeBar';
import { CheckInWidget } from './CheckInWidget';

const IC_ROLES = new Set([
  'developer', 'qa_engineer', 'ui_ux_designer',
  'business_analyst', 'devops_engineer',
]);

interface Project {
  id: string;
  name: string;
  status: string;
  _count: { tasks: number; milestones: number };
  members: { userId: string }[];
  milestones: { id: string; title: string; dueDate: string; done: boolean }[];
}

interface LeaveRequest extends LeaveTimingFields {
  id: string;
  user: { id?: string; firstName: string; lastName: string };
  leaveType: { name: string };
  startDate: string;
  endDate: string;
  days: number;
  status: string;
}

interface LeaveBalance {
  id: string;
  leaveType: { name: string };
  entitled: number;
  used: number;
  carriedOver: number;
}

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string;
  owner?: { firstName: string; lastName: string };
}

const statusColor: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  on_hold: 'bg-yellow-100 text-yellow-700',
  done: 'bg-gray-100 text-gray-600',
};

const priorityColor: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-green-100 text-green-600',
};

export default function SoftwareDashboard() {
  const user = useAuthStore((s) => s.user);
  const { tasks } = useStore();
  const navigate = useNavigate();
  const role = user?.role ?? '';
  const canApproveLeave = useAuthStore((state) => state.permissions.includes('leave:approve'));
  const leaveScopeKey = useLeaveScopeKey();

  const [projects, setProjects] = useState<Project[]>([]);
  const [pendingLeave, setPendingLeave] = useState<LeaveRequest[]>([]);
  const [myBalances, setMyBalances] = useState<LeaveBalance[]>([]);
  const [allBalances, setAllBalances] = useState<LeaveBalance[]>([]);
  const [upcomingLeaves, setUpcomingLeaves] = useState<LeaveRequest[]>([]);
  const [teamLeaveThisWeek, setTeamLeaveThisWeek] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedLeaveScope, setLoadedLeaveScope] = useState('');

  useEffect(() => {
    let active = true;
    let version = 0;
    setLoading(true);
    setProjects([]);
    setPendingLeave([]);
    setMyBalances([]);
    setAllBalances([]);
    setUpcomingLeaves([]);
    setTeamLeaveThisWeek([]);
    async function load(includeProjects = false) {
      const requestVersion = ++version;
      try {
        const now = new Date();
        const calendarEnd = new Date(now.getTime() + (role === 'finance' ? 30 : 7) * 86400000);
        const needsBalances = role === 'hr' || role === 'finance';
        const calendarPath = `/leave/calendar?from=${format(now, 'yyyy-MM-dd')}&to=${format(calendarEnd, 'yyyy-MM-dd')}`;
        const request = (path: string) => apiFetch<any>(path).catch(() => null);
        const [projRes, leaveRes, balRes, calRes] = await Promise.all([
          includeProjects ? request('/projects') : Promise.resolve(null),
          request(canApproveLeave ? '/leave/requests?status=pending' : '/leave/balances/me'),
          needsBalances ? request('/leave/balances') : Promise.resolve(null),
          !IC_ROLES.has(role) ? request(calendarPath) : Promise.resolve(null),
        ]);
        if (!active) return;
        if (projRes?.data) setProjects((projRes.data as any).data ?? projRes.data);
        if (version !== requestVersion) return;
        if (leaveRes?.data) {
          const leaveData = (leaveRes.data as any).data ?? leaveRes.data;
          if (canApproveLeave) {
            setPendingLeave(Array.isArray(leaveData) ? leaveData : []);
          } else {
            setMyBalances(Array.isArray(leaveData) ? leaveData : []);
          }
        }
        if (balRes?.data) setAllBalances((balRes.data as any).data ?? []);
        if (calRes?.data) {
          const calData = (calRes.data as any).data ?? [];
          if (role === 'hr' || role === 'finance') {
            setUpcomingLeaves(calData);
          } else {
            setTeamLeaveThisWeek(calData);
          }
        }
      } finally {
        if (active && version === requestVersion) {
          setLoadedLeaveScope(leaveScopeKey);
          setLoading(false);
        }
      }
    }
    void load(true);
    const unsubscribe = onLeaveDataRefresh(() => { void load(); });
    return () => { active = false; unsubscribe(); };
  }, [role, canApproveLeave, leaveScopeKey]);

  const myTasks = tasks.filter((t) => t.status !== 'done');
  const overdueTasks = myTasks.filter(
    (t) => t.dueDate && isPast(new Date(t.dueDate)) && !isToday(new Date(t.dueDate))
  );
  const dueTodayTasks = myTasks.filter(
    (t) => t.dueDate && isToday(new Date(t.dueDate))
  );
  const activeProjects = projects.filter((p) => p.status === 'active');

  if (loading || loadedLeaveScope !== leaveScopeKey) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Loading dashboard…
      </div>
    );
  }

  // ── HR Dashboard ───────────────────────────────────────────────────────────
  if (role === 'hr') {
    const onLeaveToday = upcomingLeaves.filter(r =>
      r.startDate.slice(0, 10) <= format(new Date(), 'yyyy-MM-dd') && r.endDate.slice(0, 10) >= format(new Date(), 'yyyy-MM-dd')
    );

    // Balance summary by leave type across all users
    const balanceByType = new Map<string, { name: string; totalEntitled: number; totalUsed: number }>();
    allBalances.forEach((b) => {
      const key = b.leaveType.name;
      if (!balanceByType.has(key)) balanceByType.set(key, { name: key, totalEntitled: 0, totalUsed: 0 });
      const entry = balanceByType.get(key)!;
      entry.totalEntitled += b.entitled + b.carriedOver;
      entry.totalUsed += b.used;
    });

    return (
      <div className="flex flex-col min-h-full p-6 gap-6">
        <h1 className="text-2xl font-semibold">HR Dashboard</h1>
        <NoticeBar />
        <CheckInWidget />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={<Inbox className="text-orange-500" />} label="Pending Approvals" value={pendingLeave.length} />
          <StatCard icon={<CalendarOff className="text-blue-500" />} label="On Leave Today" value={new Set(onLeaveToday.map((request) => request.user.id ?? request.id)).size} />
          <StatCard icon={<Users className="text-purple-500" />} label="On Leave This Week" value={new Set(upcomingLeaves.map((request) => request.user.id ?? request.id)).size} />
          <StatCard icon={<CheckCircle2 className="text-green-500" />} label="Leave Types" value={balanceByType.size} />
        </div>

        <div className="flex-1 grid md:grid-cols-2 auto-rows-fr gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Pending Leave Requests</CardTitle>
              {canApproveLeave && <Button size="sm" variant="outline" onClick={() => navigate('/leave/admin')}>Manage All</Button>}
            </CardHeader>
            <CardContent>
              {pendingLeave.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pending requests.</p>
              ) : (
                <div className="space-y-2">
                  {pendingLeave.slice(0, 6).map((req) => (
                    <div key={req.id} className="flex flex-wrap items-center justify-between gap-2 border rounded p-3 text-sm">
                      <div>
                        <span className="font-medium">{req.user.firstName} {req.user.lastName}</span>
                        <span className="text-muted-foreground ml-2">· {req.leaveType.name}{req.session !== 'hourly' && ` · ${req.days}d`}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{formatLeavePeriod(req, 'dd MMM')}</span>
                    </div>
                  ))}
                  {pendingLeave.length > 6 && (
                    <p className="text-xs text-muted-foreground text-center pt-1">+{pendingLeave.length - 6} more — go to Leave Admin</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><CalendarOff size={16} /> On Leave This Week</CardTitle></CardHeader>
            <CardContent>
              {upcomingLeaves.length === 0 ? (
                <p className="text-sm text-muted-foreground">No one on leave this week.</p>
              ) : (
                <div className="space-y-2">
                  {upcomingLeaves.map((r: any) => (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border rounded p-2.5 text-sm">
                      <div>
                        <span className="font-medium">{r.user?.firstName} {r.user?.lastName}</span>
                        <span className="text-muted-foreground ml-2 text-xs">· {r.leaveType?.name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatLeavePeriod(r, 'dd MMM')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {balanceByType.size > 0 && (
            <Card className="md:col-span-2">
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users size={16} /> Leave Balance Summary by Type</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {Array.from(balanceByType.values()).map(({ name, totalEntitled, totalUsed }) => (
                    <div key={name} className="border rounded p-3">
                      <p className="text-xs font-medium text-muted-foreground">{name}</p>
                      <p className="text-lg font-bold">{formatLeaveDays(totalUsed)} <span className="text-sm font-normal text-muted-foreground">/ {totalEntitled}</span></p>
                      <p className="text-xs text-muted-foreground">used / entitled</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  }

  // ── Finance Dashboard ──────────────────────────────────────────────────────
  if (role === 'finance') {
    const onLeaveToday = upcomingLeaves.filter(r =>
      r.startDate.slice(0, 10) <= format(new Date(), 'yyyy-MM-dd') && r.endDate.slice(0, 10) >= format(new Date(), 'yyyy-MM-dd')
    );
    // Monthly summary: group balances by user
    const userMap = new Map<string, { name: string; rows: LeaveBalance[] }>();
    allBalances.forEach((b) => {
      const uid = (b as any).user?.id ?? '';
      const name = `${(b as any).user?.firstName ?? ''} ${(b as any).user?.lastName ?? ''}`.trim();
      if (!userMap.has(uid)) userMap.set(uid, { name, rows: [] });
      userMap.get(uid)!.rows.push(b);
    });

    return (
      <div className="flex flex-col min-h-full p-6 gap-6">
        <h1 className="text-2xl font-semibold">Finance Dashboard</h1>
        <NoticeBar />
        <CheckInWidget />

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard icon={<CalendarOff className="text-blue-500" />} label="On Leave Today" value={new Set(onLeaveToday.map((request) => request.user.id ?? request.id)).size} />
          <StatCard icon={<Users className="text-purple-500" />} label="Staff Tracked" value={userMap.size} />
          <StatCard icon={<TrendingUp className="text-green-500" />} label="Leaves Next 30 Days" value={upcomingLeaves.length} />
        </div>

        <div className="flex-1 grid md:grid-cols-2 auto-rows-fr gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><CalendarOff size={16} /> Upcoming Approved Leaves</CardTitle></CardHeader>
            <CardContent>
              {upcomingLeaves.length === 0 ? (
                <p className="text-sm text-muted-foreground">No upcoming leaves in the next 30 days.</p>
              ) : (
                <div className="space-y-2">
                  {upcomingLeaves.map((r: any) => (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border rounded p-2.5 text-sm">
                      <div>
                        <span className="font-medium">{r.user?.firstName} {r.user?.lastName}</span>
                        <span className="text-muted-foreground ml-2 text-xs">· {r.leaveType?.name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatLeavePeriod(r, 'dd MMM')}{r.session !== 'hourly' && ` · ${r.days}d`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users size={16} /> Monthly Leave Summary</CardTitle></CardHeader>
            <CardContent>
              {userMap.size === 0 ? (
                <p className="text-sm text-muted-foreground">No balance data yet.</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {Array.from(userMap.values()).map(({ name, rows }) => {
                    const totalUsed = rows.reduce((s, b) => s + b.used, 0);
                    const totalEntitled = rows.reduce((s, b) => s + b.entitled + b.carriedOver, 0);
                    return (
                      <div key={name} className="flex items-center justify-between border rounded p-2.5 text-sm">
                        <span className="font-medium">{name}</span>
                        <div className="text-xs text-right text-muted-foreground">
                          <span className="text-foreground font-semibold">{formatLeaveDays(totalUsed)}</span> used
                          <span className="ml-2">{formatLeaveDays(totalEntitled - totalUsed)} remaining</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ── IC Dashboard (developer, qa, designer, ba, devops) ────────────────────
  if (IC_ROLES.has(role)) {
    return (
      <div className="flex flex-col min-h-full p-6 gap-6">
        <h1 className="text-2xl font-semibold">My Dashboard</h1>
        <NoticeBar />
        <CheckInWidget />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={<FolderKanban className="text-blue-500" />} label="Active Projects" value={activeProjects.length} onClick={() => navigate('/projects')} />
          <StatCard icon={<CheckSquare className="text-purple-500" />} label="Open Tasks" value={myTasks.length} />
          <StatCard icon={<AlertTriangle className="text-red-500" />} label="Overdue" value={overdueTasks.length} />
          <StatCard icon={<Clock className="text-orange-500" />} label="Due Today" value={dueTodayTasks.length} />
        </div>

        <div className="flex-1 grid md:grid-cols-2 auto-rows-fr gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><FolderKanban size={16} /> My Projects</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {activeProjects.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active projects.</p>
              ) : activeProjects.map((p) => (
                <div key={p.id} className="flex items-center justify-between cursor-pointer hover:bg-accent rounded p-2" onClick={() => navigate(`/projects/${p.id}`)}>
                  <span className="text-sm font-medium">{p.name}</span>
                  <div className="flex gap-2 items-center">
                    <span className="text-xs text-muted-foreground">{p._count.tasks} tasks</span>
                    <Badge className={`text-xs ${statusColor[p.status]}`}>{p.status}</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><CheckSquare size={16} /> My Tasks by Priority</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {myTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open tasks.</p>
              ) : (['urgent', 'high', 'medium', 'low'] as const).map((p) => {
                const count = myTasks.filter((t: Task) => t.priority === p).length;
                if (!count) return null;
                return (
                  <div key={p} className="flex items-center justify-between">
                    <Badge className={`text-xs ${priorityColor[p]}`}>{p}</Badge>
                    <span className="text-sm font-medium">{count}</span>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><CalendarOff size={16} /> My Leave Balances</CardTitle></CardHeader>
            <CardContent>
              {myBalances.length === 0 ? (
                <p className="text-sm text-muted-foreground">No leave types set up yet. Contact your Super Admin.</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {myBalances.map((b) => {
                    const available = b.entitled + b.carriedOver - b.used;
                    return (
                      <div key={b.id} className="border rounded p-3">
                        <p className="text-xs font-medium text-muted-foreground">{b.leaveType.name}</p>
                        <p className="text-xl font-bold">{formatLeaveDays(available)}</p>
                        <p className="text-xs text-muted-foreground">{formatLeaveDays(b.used)} used / {b.entitled} entitled</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ── Management Dashboard (cto, project_manager, team_lead) ─────────────────
  return (
    <div className="flex flex-col min-h-full p-6 gap-6">
      <h1 className="text-2xl font-semibold">
        {role === 'cto' ? 'CTO Dashboard' : role === 'project_manager' ? 'Project Manager Dashboard' : 'Team Lead Dashboard'}
      </h1>
      <NoticeBar />
      <CheckInWidget />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={<FolderKanban className="text-blue-500" />} label="Active Projects" value={activeProjects.length} onClick={() => navigate('/projects')} />
        <StatCard icon={<CheckSquare className="text-purple-500" />} label="Open Tasks" value={myTasks.length} />
        <StatCard icon={<AlertTriangle className="text-red-500" />} label="Overdue Tasks" value={overdueTasks.length} />
        <StatCard icon={<Inbox className="text-orange-500" />} label="Pending Leave" value={pendingLeave.length} />
      </div>

      <div className="flex-1 grid md:grid-cols-2 auto-rows-fr gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><FolderKanban size={16} /> Project Health</CardTitle>
              <Button size="sm" variant="outline" onClick={() => navigate('/projects')}>View All</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">No projects yet.</p>
            ) : projects.slice(0, 5).map((p) => (
              <div key={p.id} className="flex items-center justify-between cursor-pointer hover:bg-accent rounded p-2" onClick={() => navigate(`/projects/${p.id}`)}>
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p._count.tasks} tasks · {p._count.milestones} milestones</p>
                </div>
                <Badge className={`text-xs ${statusColor[p.status]}`}>{p.status.replace('_', ' ')}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingUp size={16} /> Milestones Due This Week</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {projects.flatMap(p => p.milestones.filter(m => !m.done && new Date(m.dueDate) <= new Date(Date.now() + 7 * 86400000))).length === 0 ? (
              <p className="text-sm text-muted-foreground">No milestones due this week.</p>
            ) : projects.flatMap(p =>
              p.milestones
                .filter(m => !m.done && new Date(m.dueDate) <= new Date(Date.now() + 7 * 86400000))
                .map(m => ({ ...m, projectName: p.name }))
            ).map((m) => (
              <div key={m.id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium">{m.title}</p>
                  <p className="text-xs text-muted-foreground">{m.projectName}</p>
                </div>
                <span className={`text-xs ${isPast(new Date(m.dueDate)) ? 'text-red-500' : 'text-muted-foreground'}`}>
                  {format(new Date(m.dueDate), 'dd MMM')}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        {pendingLeave.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><CalendarOff size={16} /> Pending Leave Approvals</CardTitle>
              {canApproveLeave && <Button size="sm" variant="outline" onClick={() => navigate('/leave/admin')}>Manage All</Button>}
            </CardHeader>
            <CardContent className="space-y-2">
              {pendingLeave.slice(0, 5).map((req) => (
                <div key={req.id} className="flex flex-wrap items-center justify-between gap-2 border rounded p-3 text-sm">
                  <div>
                    <span className="font-medium">{req.user.firstName} {req.user.lastName}</span>
                    <span className="text-muted-foreground ml-2">· {req.leaveType.name}{req.session !== 'hourly' && ` · ${req.days} day(s)`}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatLeavePeriod(req, 'dd MMM')}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card className={pendingLeave.length > 0 ? '' : 'md:col-span-2'}>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><CalendarOff size={16} /> Team on Leave This Week</CardTitle></CardHeader>
          <CardContent>
            {teamLeaveThisWeek.length === 0 ? (
              <p className="text-sm text-muted-foreground">No one on leave this week.</p>
            ) : (
              <div className="space-y-2">
                {teamLeaveThisWeek.map((r: any) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border rounded p-2.5 text-sm">
                    <div>
                      <span className="font-medium">{r.user?.firstName} {r.user?.lastName}</span>
                      <span className="text-muted-foreground ml-2 text-xs">· {r.leaveType?.name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatLeavePeriod(r, 'dd MMM')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, onClick }: { icon: React.ReactNode; label: string; value: number; onClick?: () => void }) {
  return (
    <Card className={onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''} onClick={onClick}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
          </div>
          <div className="opacity-70">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}
