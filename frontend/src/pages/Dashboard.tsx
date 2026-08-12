import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Users, ListChecks, Phone, Clock, Mail, MessageSquare,
  Plus, UserPlus, PhoneCall, CalendarPlus, ClipboardList, FileText,
  Eye, Calendar as CalendarIcon, AlertTriangle, Flame, Thermometer, Snowflake,
  CheckCircle2, RotateCcw, ExternalLink, Building2, Activity, Coffee, GraduationCap, Users2, Target
} from 'lucide-react';
import { useStore } from '@/lib/store';
import { fetchFollowUps, mapApiFollowUpToFollowUp, fetchDashboardTodayStats, fetchMeetings, ApiMeeting, fetchMyTimeLogs, fetchLeads, fetchTasks, mapApiTaskToTask, fetchLeadStatusOverTime, fetchMyActivityLogs, fetchMyPerformanceTarget, type PerformanceTargetValues } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import type { Meeting, Lead, Task, ActivityLog } from '@/lib/types';
import { format, isToday, isSameDay, startOfWeek, endOfWeek, isBefore, addDays, differenceInDays, formatDistanceToNow, startOfDay, endOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { TemperatureBadge } from '@/components/TemperatureBadge';
import { StageBadge } from '@/components/StageBadge';
import ManagerDashboard from '@/components/dashboard/ManagerDashboard';
import DirectorDashboard from '@/components/dashboard/DirectorDashboard';
import DatabaseManagerDashboard from '@/components/dashboard/DatabaseManagerDashboard';
import RecruitmentManagerDashboard from '@/components/dashboard/RecruitmentManagerDashboard';
import RecruiterDashboard from '@/components/dashboard/RecruiterDashboard';
import {
  useCanAccessMultipleAgencies,
  useCanViewPipeline,
  useHasPermission,
  useIsDatabaseManagerRole,
  useIsOwnScope,
  useIsAgencyScopedElevated,
  useIsTeamManagerOnly,
  useIsRecruitmentManagerRole,
  useIsSeniorRecruiterRole,
  useIsRecruiterRole,
} from '@/lib/access';
import { useActiveSide } from '@/workspaces';

const priorityColors = {
  high: 'bg-red-100 text-red-800 border-red-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  low: 'bg-green-100 text-green-800 border-green-200',
};

export default function Dashboard() {
  const { currentUser, currentSubCompany, calls, meetings, clients, followUps, setFollowUps, setMeetings, pipelineStages, activityLogs } = useStore();
  const isElevated = useCanAccessMultipleAgencies();
  const isAgencyScopedElevated = useIsAgencyScopedElevated();
  const hasAnalyticsRead = useHasPermission('analytics:read');
  const showDirectorDashboard = isElevated || (isAgencyScopedElevated && hasAnalyticsRead);
  /** Always own dashboard for Database Manager — independent of agency destination / extra perms. */
  const isDatabaseManager = useIsDatabaseManagerRole();
  const isRecruitmentManager = useIsRecruitmentManagerRole();
  const isSeniorRecruiter = useIsSeniorRecruiterRole();
  const isRecruiter = useIsRecruiterRole();
  const { side: activeWorkspaceSide, canSwitch: canSwitchWorkspaceSides } = useActiveSide();
  const isManagerLevel = useIsTeamManagerOnly();
  const isAssociate = useIsOwnScope();
  const canViewPipeline = useCanViewPipeline();
  const [localLeads, setLocalLeads] = useState<Lead[]>([]);
  const [localTasks, setLocalTasks] = useState<Task[]>([]);
  const [localActivityLogs, setLocalActivityLogs] = useState<ActivityLog[]>([]);
  const [chartData, setChartData] = useState<{ month: string; Won: number; Lost: number }[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [actionQueueTab, setActionQueueTab] = useState('overdue');
  const [callsTodayCount, setCallsTodayCount] = useState<number | null>(null);
  const [emailsTodayCount, setEmailsTodayCount] = useState<number | null>(null);
  const [idleTime, setIdleTime] = useState(0);
  const [coachingTime, setCoachingTime] = useState(0);
  const [meetingBreakTime, setMeetingBreakTime] = useState(0);
  const [myDailyTarget, setMyDailyTarget] = useState<PerformanceTargetValues | null>(null);
  const navigate = useNavigate();
  const agencyId = currentSubCompany?.id ?? currentUser.subCompanyId;

  const loadFollowUps = useCallback(() => {
    if (!agencyId) return;
    fetchFollowUps({ subCompanyId: agencyId, limit: 500 })
      .then((res) => setFollowUps(res.data.map(mapApiFollowUpToFollowUp)))
      .catch(() => {});
  }, [agencyId, setFollowUps]);

  const loadMeetings = useCallback(() => {
    fetchMeetings({ limit: 500 })
      .then((res) => setMeetings(res.data.map((m: ApiMeeting): Meeting => ({
        id: m.id,
        clientId: m.clientId,
        leadId: m.leadId ?? undefined,
        ownerId: m.ownerId,
        ownerName: m.ownerName ?? '',
        title: m.title,
        startTime: new Date(m.startTime),
        endTime: new Date(m.endTime),
        location: m.location ?? undefined,
        meetingLink: m.meetingLink ?? undefined,
        agenda: m.agenda ?? undefined,
        attendees: m.attendees.map(a => a.contactName || a.userId || ''),
        notes: m.notes ?? undefined,
        createdAt: new Date(m.createdAt),
      }))))
      .catch(() => {});
  }, [setMeetings]);

  useEffect(() => {
    loadFollowUps();
    loadMeetings();
  }, [loadFollowUps, loadMeetings]);

  // Load real leads, tasks, and chart data for this user
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchLeads({ ownerId: currentUser.id, limit: 500 }),
      fetchTasks({ scope: 'mine', limit: 500 }),
      fetchLeadStatusOverTime(),
      fetchMyActivityLogs({ limit: 20 }),
    ]).then(([leadsRes, tasksRes, chartRes, activityRes]) => {
      if (cancelled) return;
      setLocalActivityLogs(activityRes);
      setLocalLeads(leadsRes.data.map(l => ({
        id: l.id,
        clientId: l.clientId,
        ownerId: l.ownerId,
        ownerName: `${l.owner.firstName} ${l.owner.lastName}`.trim(),
        subCompanyId: l.subCompanyId,
        subCompanyName: currentSubCompany?.name ?? '',
        stage: l.stage,
        status: l.status as Lead['status'],
        temperature: (l.temperature as Lead['temperature']) ?? 'warm',
        lastActivity: l.lastActivity ? new Date(l.lastActivity) : undefined,
        nextFollowUp: l.nextFollowUp ? new Date(l.nextFollowUp) : undefined,
        createdAt: new Date(l.createdAt),
        updatedAt: new Date(l.updatedAt),
        notes: l.notes ?? undefined,
      })));
      setLocalTasks(tasksRes.data.map(mapApiTaskToTask));
      setChartData(chartRes);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentUser.id, currentSubCompany?.name]);

  // Re-fetch activity logs on socket events (call made, email sent, meeting scheduled, etc.)
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const refreshActivity = () => {
      fetchMyActivityLogs({ limit: 20 })
        .then(setLocalActivityLogs)
        .catch(() => {});
    };
    socket.on('call:refresh', refreshActivity);
    socket.on('email:refresh', refreshActivity);
    socket.on('meeting:refresh', refreshActivity);
    socket.on('followup:refresh', refreshActivity);
    socket.on('task:refresh', refreshActivity);
    return () => {
      socket.off('call:refresh', refreshActivity);
      socket.off('email:refresh', refreshActivity);
      socket.off('meeting:refresh', refreshActivity);
      socket.off('followup:refresh', refreshActivity);
      socket.off('task:refresh', refreshActivity);
    };
  }, [currentUser.id]);

  // Load today's calls and emails counts from server (avoids list pagination and timezone issues)
  useEffect(() => {
    let cancelled = false;
    setCallsTodayCount(null);
    setEmailsTodayCount(null);
    fetchDashboardTodayStats()
      .then(({ callsToday, emailsToday }) => {
        if (!cancelled) {
          setCallsTodayCount(callsToday);
          setEmailsTodayCount(emailsToday);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCallsTodayCount(0);
          setEmailsTodayCount(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load real idle & break time from API
  const refreshIdleTime = useCallback(() => {
    const now = new Date();
    fetchMyTimeLogs({ from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString(), limit: 500 })
      .then((logs) => {
        const idle = logs
          .filter(a => a.type === 'idle_detected')
          .reduce((acc, a) => acc + ((a.metadata as Record<string, number>)?.duration || 0), 0);
        const coaching = logs
          .filter(a => a.type === 'break_detected' && (a.metadata as Record<string, string>)?.breakType === 'coaching')
          .reduce((acc, a) => acc + ((a.metadata as Record<string, number>)?.duration || 0), 0);
        const mtg = logs
          .filter(a => a.type === 'break_detected' && (a.metadata as Record<string, string>)?.breakType === 'meeting')
          .reduce((acc, a) => acc + ((a.metadata as Record<string, number>)?.duration || 0), 0);
        setIdleTime(idle);
        setCoachingTime(coaching);
        setMeetingBreakTime(mtg);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshIdleTime();
  }, [refreshIdleTime]);

  // Re-fetch idle/break time when a completed idle or break period is logged (both emit call:refresh)
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.on('call:refresh', refreshIdleTime);
    return () => { socket.off('call:refresh', refreshIdleTime); };
  }, [refreshIdleTime]);

  // Fetch daily target for own-scope users (associates)
  useEffect(() => {
    if (!isAssociate) return;
    fetchMyPerformanceTarget().then(setMyDailyTarget).catch(() => {});
  }, [isAssociate]);

  // Super users viewing the Recruitment side see the recruitment manager dashboard
  if (canSwitchWorkspaceSides && activeWorkspaceSide === 'recruitment') {
    return <RecruitmentManagerDashboard />;
  }

  if (isDatabaseManager) {
    return <DatabaseManagerDashboard />;
  }

  if (showDirectorDashboard) {
    return <DirectorDashboard />;
  }

  if (isRecruitmentManager) {
    return <RecruitmentManagerDashboard />;
  }

  if (isSeniorRecruiter || isRecruiter) {
    return <RecruiterDashboard />;
  }

  if (isManagerLevel) {
    return <ManagerDashboard />;
  }
  
  // Stats calculations
  const myLeads = localLeads;
  const leadsSubmittedThisWeek = myLeads.filter(l => {
    const createdDate = new Date(l.createdAt);
    return createdDate >= startOfWeek(new Date()) && createdDate <= endOfWeek(new Date());
  }).length;
  
  const myTasks = localTasks;
  const tasksInProgress = myTasks.filter(t => t.status === 'in_progress').length;
  const tasksDueToday = myTasks.filter(t => t.status !== 'done' && isToday(new Date(t.dueDate))).length;
  const tasksOverdue = myTasks.filter(t => t.status !== 'done' && isBefore(new Date(t.dueDate), new Date()) && !isToday(new Date(t.dueDate))).length;
  const tasksUpcoming = myTasks.filter(t => t.status !== 'done' && !isBefore(new Date(t.dueDate), new Date()) && !isToday(new Date(t.dueDate))).length;
  
  const completedCalls = calls.filter(c => c.ownerId === currentUser.id && c.outcome === 'answered').length;
  // Use API-backed today counts when available; fallback to store-derived values
  const callsTodayDisplay = callsTodayCount !== null ? callsTodayCount : calls.filter(c => c.ownerId === currentUser.id && isToday(new Date(c.timestamp))).length;
  const emailsTodayDisplay = emailsTodayCount !== null ? emailsTodayCount : activityLogs.filter(a => a.type === 'email_sent' && isToday(new Date(a.timestamp))).length;

  const upcomingTasks = myTasks
    .filter(t => t.status !== 'done')
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    .slice(0, 3);


  // Today's meetings
  const todaysMeetings = meetings.filter(m => m.ownerId === currentUser.id && isToday(new Date(m.startTime)));
  const selectedDateMeetings = selectedDate
    ? meetings.filter(m => m.ownerId === currentUser.id && isSameDay(new Date(m.startTime), selectedDate))
    : [];
  const selectedDateTasks = selectedDate
    ? localTasks.filter(t => t.status !== 'done' && t.dueDate && isSameDay(new Date(t.dueDate), selectedDate))
    : [];
  const selectedDateFollowUps = selectedDate
    ? followUps.filter(f => f.ownerId === currentUser.id && !f.completed && isSameDay(new Date(f.dueDate), selectedDate))
    : [];
  const selectedDateEvents = [
    ...selectedDateMeetings.map(m => ({ id: m.id, type: 'meeting' as const, title: m.title, time: new Date(m.startTime) })),
    ...selectedDateTasks.map(t => ({ id: t.id, type: 'task' as const, title: t.title, time: new Date(t.dueDate) })),
    ...selectedDateFollowUps.map(f => ({ id: f.id, type: 'followup' as const, title: f.notes || f.clientName || 'Follow-up', time: new Date(f.dueDate) })),
  ].sort((a, b) => a.time.getTime() - b.time.getTime());

  // Calendar dot indicators: count events per date
  const calendarEventCounts: Record<string, number> = {};
  meetings.filter(m => m.ownerId === currentUser.id).forEach(m => {
    const key = format(new Date(m.startTime), 'yyyy-MM-dd');
    calendarEventCounts[key] = (calendarEventCounts[key] || 0) + 1;
  });
  localTasks.filter(t => t.status !== 'done' && t.dueDate).forEach(t => {
    const key = format(new Date(t.dueDate), 'yyyy-MM-dd');
    calendarEventCounts[key] = (calendarEventCounts[key] || 0) + 1;
  });
  followUps.filter(f => f.ownerId === currentUser.id && !f.completed).forEach(f => {
    const key = format(new Date(f.dueDate), 'yyyy-MM-dd');
    calendarEventCounts[key] = (calendarEventCounts[key] || 0) + 1;
  });

  // ===== NEW DATA CALCULATIONS =====
  
  // My Clients Snapshot
  const myClients = clients; // In real app, filter by ownership
  const activeClients = myClients.filter(c => c.status === 'active').length;
  const contactedClients = myClients.filter(c => c.status === 'contacted').length;
  const lostClients = myClients.filter(c => c.status === 'lost').length;

  // My Active Leads
  const activeLeads = myLeads.filter(l => l.status === 'open').length;
  const requestedLeads = myLeads.filter(l => l.stage === 'new_lead').length;
  const rejectedLeads = myLeads.filter(l => l.status === 'closed_lost').length;

  // My Overdue Work
  const myFollowUps = followUps.filter(f => f.ownerId === currentUser.id);
  const overdueTasks = myTasks.filter(t => t.status !== 'done' && isBefore(new Date(t.dueDate), new Date())).length;
  const overdueFollowUps = myFollowUps.filter(f => !f.completed && isBefore(new Date(f.dueDate), new Date())).length;

  // Today's Commitments
  const meetingsToday = todaysMeetings.length;
  const followUpsToday = myFollowUps.filter(f => !f.completed && isToday(new Date(f.dueDate))).length;
  const followUpsUpcoming = myFollowUps.filter(f => !f.completed && !isBefore(new Date(f.dueDate), new Date()) && !isToday(new Date(f.dueDate))).length;

  // Pipeline Summary Data
  const pipelineData = pipelineStages.map(stage => ({
    ...stage,
    count: myLeads.filter(l => l.stage === stage.id).length,
    leads: myLeads.filter(l => l.stage === stage.id).slice(0, 2)
  }));

  // Action Queue Data
  const now = new Date();
  const next7Days = addDays(now, 7);
  
  const overdueItems = [
    ...myTasks.filter(t => t.status !== 'done' && isBefore(new Date(t.dueDate), now)).map(t => ({ ...t, type: 'task' as const })),
    ...myFollowUps.filter(f => !f.completed && isBefore(new Date(f.dueDate), now)).map(f => ({ ...f, type: 'followup' as const }))
  ].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const dueTodayItems = [
    ...myTasks.filter(t => t.status !== 'done' && isToday(new Date(t.dueDate))).map(t => ({ ...t, type: 'task' as const })),
    ...myFollowUps.filter(f => !f.completed && isToday(new Date(f.dueDate))).map(f => ({ ...f, type: 'followup' as const }))
  ].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const next7DaysItems = [
    ...myTasks.filter(t => t.status !== 'done' && !isToday(new Date(t.dueDate)) && !isBefore(new Date(t.dueDate), now) && isBefore(new Date(t.dueDate), next7Days)).map(t => ({ ...t, type: 'task' as const })),
    ...myFollowUps.filter(f => !f.completed && !isToday(new Date(f.dueDate)) && !isBefore(new Date(f.dueDate), now) && isBefore(new Date(f.dueDate), next7Days)).map(f => ({ ...f, type: 'followup' as const }))
  ].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  // Recent Activity
  const myActivityLogs = activityLogs
    .filter(a => a.userId === currentUser.id)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10);

  // Recent Calls
  const myCalls = calls
    .filter(c => c.ownerId === currentUser.id)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);

  // Lead Temperature Breakdown
  const hotLeads = myLeads.filter(l => l.temperature === 'hot').length;
  const warmLeads = myLeads.filter(l => l.temperature === 'warm').length;
  const coldLeads = myLeads.filter(l => l.temperature === 'cold').length;
  
  const temperatureData = [
    { name: 'Hot', value: hotLeads, color: '#ef4444' },
    { name: 'Warm', value: warmLeads, color: '#f59e0b' },
    { name: 'Cold', value: coldLeads, color: '#3b82f6' },
  ];

  // At-Risk Leads (stale or overdue follow-ups)
  const atRiskLeads = myLeads.filter(l => {
    const daysSinceActivity = l.lastActivity ? differenceInDays(now, new Date(l.lastActivity)) : 999;
    const hasOverdueFollowUp = l.nextFollowUp && isBefore(new Date(l.nextFollowUp), now);
    return daysSinceActivity > 14 || hasOverdueFollowUp;
  }).slice(0, 5);

  // Client Follow-Up Gaps (active clients with no upcoming follow-up)
  const clientsWithGaps = myClients
    .filter(c => c.status === 'active')
    .filter(c => {
      const clientFollowUps = myFollowUps.filter(f => f.clientId === c.id && !f.completed);
      return clientFollowUps.length === 0;
    })
    .slice(0, 5);

  // Today's actuals for the associate progress card
  const tasksAssignedToday = myTasks.filter(t => isToday(new Date(t.dueDate))).length;
  const tasksCompletedToday = myTasks.filter(t => t.status === 'done' && t.completedAt && isToday(new Date(t.completedAt))).length;
  const followUpsAssignedToday = myFollowUps.filter(f => isToday(new Date(f.dueDate))).length;
  const followUpsCompletedToday = myFollowUps.filter(f => f.completed && f.completedAt && isToday(new Date(f.completedAt))).length;
  const meetingsScheduledToday = meetings.filter(
    m => m.ownerId === currentUser.id && m.createdAt && isToday(new Date(m.createdAt)),
  ).length;

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'call_made': return <Phone className="h-4 w-4" />;
      case 'email_sent': return <Mail className="h-4 w-4" />;
      case 'task_completed': return <CheckCircle2 className="h-4 w-4" />;
      case 'meeting_scheduled': return <CalendarIcon className="h-4 w-4" />;
      case 'follow_up_created': return <RotateCcw className="h-4 w-4" />;
      default: return <Activity className="h-4 w-4" />;
    }
  };

  return (
    <div className="space-y-6">

      {/* ── Today's Progress (associates only) ── */}
      {isAssociate && (() => {
        type TargetMetric = { kind: 'target'; label: string; actual: number; target: number; icon: React.ReactNode; color: string };
        type RatioMetric = { kind: 'ratio'; label: string; completed: number; assigned: number; icon: React.ReactNode; color: string };
        const targetMetrics: TargetMetric[] = myDailyTarget
          ? [
              { kind: 'target', label: 'Calls Made', actual: callsTodayDisplay, target: myDailyTarget.callsTarget, icon: <Phone className="h-4 w-4" />, color: 'text-blue-600' },
              { kind: 'target', label: 'Emails Sent', actual: emailsTodayDisplay, target: myDailyTarget.emailsTarget, icon: <Mail className="h-4 w-4" />, color: 'text-purple-600' },
              { kind: 'target', label: 'Meetings Scheduled', actual: meetingsScheduledToday, target: myDailyTarget.meetingScheduleCountTarget, icon: <CalendarIcon className="h-4 w-4" />, color: 'text-teal-600' },
            ].filter((m) => m.target > 0)
          : [];
        const ratioMetrics: RatioMetric[] = [
          { kind: 'ratio', label: 'Tasks', completed: tasksCompletedToday, assigned: tasksAssignedToday, icon: <CheckCircle2 className="h-4 w-4" />, color: 'text-green-600' },
          { kind: 'ratio', label: 'Follow-ups', completed: followUpsCompletedToday, assigned: followUpsAssignedToday, icon: <RotateCcw className="h-4 w-4" />, color: 'text-orange-600' },
        ];
        const metrics: Array<TargetMetric | RatioMetric> = [...targetMetrics, ...ratioMetrics];
        if (metrics.length === 0) return null;
        return (
          <Card className="border-none shadow-sm">
            <CardHeader className="pb-3 pt-5 px-6">
              <CardTitle className="flex items-center gap-2 text-base">
                <Target className="h-4 w-4 text-primary" />
                Today's Progress
              </CardTitle>
            </CardHeader>
            <CardContent className="px-6 pb-5">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                {metrics.map((m) => {
                  if (m.kind === 'target') {
                    const pct = m.target > 0 ? Math.min(Math.round((m.actual / m.target) * 100), 100) : 0;
                    const pctColor = pct >= 100 ? 'text-green-600' : pct >= 50 ? 'text-amber-600' : 'text-red-500';
                    const barColor = pct >= 100 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
                    return (
                      <div key={m.label} className="space-y-2">
                        <div className={`flex items-center gap-1.5 ${m.color}`}>
                          {m.icon}
                          <span className="text-xs font-medium text-muted-foreground">{m.label}</span>
                        </div>
                        <div className="flex items-end justify-between">
                          <span className="text-xl font-bold">{m.actual}</span>
                          <span className="text-sm text-muted-foreground mb-0.5">/ {m.target}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                        </div>
                        <p className={`text-xs font-medium ${pctColor}`}>{m.target > 0 ? `${pct}%` : '—'}</p>
                      </div>
                    );
                  }
                  const pct = m.assigned > 0 ? Math.min(Math.round((m.completed / m.assigned) * 100), 100) : 0;
                  const pctColor = m.assigned <= 0 ? 'text-muted-foreground' : pct >= 100 ? 'text-green-600' : pct >= 50 ? 'text-amber-600' : 'text-red-500';
                  const barColor = m.assigned <= 0 ? 'bg-muted' : pct >= 100 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
                  return (
                    <div key={m.label} className="space-y-2">
                      <div className={`flex items-center gap-1.5 ${m.color}`}>
                        {m.icon}
                        <span className="text-xs font-medium text-muted-foreground">{m.label}</span>
                      </div>
                      <div className="flex items-end justify-between">
                        <span className="text-xl font-bold">{m.completed}</span>
                        <span className="text-sm text-muted-foreground mb-0.5">/ {m.assigned}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                      </div>
                      <p className={`text-xs font-medium ${pctColor}`}>{m.assigned > 0 ? `${pct}% done` : '—'}</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">My Leads</p>
                <div className="flex items-center gap-4 mt-2">
                  <div>
                    <p className="text-2xl font-bold text-green-600">{activeLeads}</p>
                    <p className="text-xs text-muted-foreground">Active</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-yellow-600">{requestedLeads}</p>
                    <p className="text-xs text-muted-foreground">Requested</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-red-600">{rejectedLeads}</p>
                    <p className="text-xs text-muted-foreground">Rejected</p>
                  </div>
                </div>
              </div>
              <div className="w-12 h-12 bg-kpi-blue-bg rounded-lg flex items-center justify-center">
                <Users className="h-6 w-6 text-kpi-blue-icon" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">My Tasks</p>
                <div className="flex items-center gap-4 mt-2">
                  <div>
                    <p className="text-2xl font-bold text-red-600">{tasksOverdue}</p>
                    <p className="text-xs text-muted-foreground">Overdue</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-yellow-600">{tasksDueToday}</p>
                    <p className="text-xs text-muted-foreground">Due Today</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-green-600">{tasksUpcoming}</p>
                    <p className="text-xs text-muted-foreground">Upcoming</p>
                  </div>
                </div>
              </div>
              <div className="w-12 h-12 bg-kpi-yellow-bg rounded-lg flex items-center justify-center">
                <ListChecks className="h-6 w-6 text-kpi-yellow-icon" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">My Follow-ups</p>
                <div className="flex items-center gap-4 mt-2">
                  <div>
                    <p className="text-2xl font-bold text-red-600">{overdueFollowUps}</p>
                    <p className="text-xs text-muted-foreground">Overdue</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-yellow-600">{followUpsToday}</p>
                    <p className="text-xs text-muted-foreground">Due Today</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-green-600">{followUpsUpcoming}</p>
                    <p className="text-xs text-muted-foreground">Upcoming</p>
                  </div>
                </div>
              </div>
              <div className="w-12 h-12 bg-kpi-green-bg rounded-lg flex items-center justify-center">
                <RotateCcw className="h-6 w-6 text-kpi-green-icon" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Break & Idle Time Tracker */}
        {(() => {
          const totalBreakTime = coachingTime + meetingBreakTime;
          const totalTime = idleTime + totalBreakTime;
          const maxTime = Math.max(totalTime, 120);

          return (
            <Card className="border-none shadow-sm overflow-hidden">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-medium text-muted-foreground">Idle & Break Time Today</p>
                  <div className="w-10 h-10 bg-kpi-purple-bg rounded-lg flex items-center justify-center flex-shrink-0">
                    <Coffee className="h-5 w-5 text-kpi-purple-icon" />
                  </div>
                </div>

                <div className="mb-4">
                  <div className="h-3 bg-muted rounded-full overflow-hidden flex">
                    <div
                      className="bg-amber-500 h-full transition-all"
                      style={{ width: `${(idleTime / maxTime) * 100}%` }}
                    />
                    <div className="w-0.5 bg-background" />
                    <div
                      className="bg-purple-500 h-full transition-all"
                      style={{ width: `${(totalBreakTime / maxTime) * 100}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500 flex-shrink-0" />
                    <div>
                      <p className="text-lg font-bold">{idleTime}m</p>
                      <p className="text-xs text-muted-foreground">Idle</p>
                    </div>
                  </div>

                  <div className="w-px h-10 bg-border flex-shrink-0" />

                  <div className="min-w-0">
                    <div className="flex items-center gap-1 mb-1">
                      <div className="w-2.5 h-2.5 rounded-full bg-purple-500 flex-shrink-0" />
                      <p className="text-xs font-medium text-muted-foreground">Break Time</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <GraduationCap className="h-3.5 w-3.5 text-blue-600 flex-shrink-0" />
                        <span className="text-sm font-semibold">{coachingTime}m</span>
                        <span className="text-xs text-muted-foreground">Coaching</span>
                      </div>
                      <div className="w-px h-4 bg-border flex-shrink-0" />
                      <div className="flex items-center gap-1.5">
                        <Users2 className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                        <span className="text-sm font-semibold">{meetingBreakTime}m</span>
                        <span className="text-xs text-muted-foreground">Meeting</span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })()}
      </div>

      {/* Pipeline Summary + Activity Widget Row */}
      <div className={cn('grid grid-cols-1 gap-4', canViewPipeline ? 'lg:grid-cols-4' : 'lg:grid-cols-1')}>
        {canViewPipeline && (
        <Card className="border-none shadow-sm lg:col-span-3">
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6 flex-wrap">
                {pipelineData.map((stage) => (
                  <div 
                    key={stage.id} 
                    className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => navigate(`/pipeline?stage=${stage.id}`)}
                  >
                    <span 
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0" 
                      style={{ backgroundColor: stage.color }}
                    />
                    <span className="text-sm font-medium">{stage.label}</span>
                    <span className="text-sm font-bold text-muted-foreground">({stage.count})</span>
                  </div>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={() => navigate('/pipeline')} className="gap-1 text-xs">
                View Pipeline <ExternalLink className="h-3 w-3" />
              </Button>
            </div>
          </CardContent>
        </Card>
        )}

        <Card className="border-none shadow-sm">
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-around gap-4">
              <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => navigate('/calls')}>
                <div className="w-8 h-8 bg-kpi-blue-bg rounded-lg flex items-center justify-center">
                  <Phone className="h-4 w-4 text-kpi-blue-icon" />
                </div>
                <div>
                  <p className="text-lg font-bold">{callsTodayDisplay}</p>
                  <p className="text-xs text-muted-foreground">Calls Today</p>
                </div>
              </div>
              <div className="w-px h-8 bg-border" />
              <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => navigate('/emails')}>
                <div className="w-8 h-8 bg-kpi-green-bg rounded-lg flex items-center justify-center">
                  <Mail className="h-4 w-4 text-kpi-green-icon" />
                </div>
                <div>
                  <p className="text-lg font-bold">{emailsTodayDisplay}</p>
                  <p className="text-xs text-muted-foreground">Emails Today</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Calendar + Follow-ups + Recent Interactions - 3 Column Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Calendar Widget */}
        <Card className="border-none shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2 px-4 pt-4">
            <CardTitle className="text-sm font-semibold">Calendar</CardTitle>
            <Badge variant="outline" className="text-[10px] gap-1 bg-green-50 text-green-700 border-green-200 px-1.5 py-0.5">
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
              Synced
            </Badge>
          </CardHeader>
          <CardContent className="p-3">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => { if (date) setSelectedDate(date); }}
              className={cn("w-full rounded-md border-0 text-xs")}
              components={{
                DayContent: ({ date }) => {
                  const key = format(date, 'yyyy-MM-dd');
                  const count = calendarEventCounts[key] || 0;
                  return (
                    <>
                      {date.getDate()}
                      {count > 0 && (
                        <div className="absolute bottom-0.5 left-0 right-0 flex items-center justify-center gap-0.5">
                          {count <= 3 ? (
                            Array.from({ length: count }).map((_, i) => (
                              <div key={i} className="w-1 h-1 rounded-full bg-blue-500" />
                            ))
                          ) : (
                            <span className="text-[7px] leading-none font-medium text-blue-500">+{count}</span>
                          )}
                        </div>
                      )}
                    </>
                  );
                },
              }}
            />

            <div className="mt-2 pt-2 border-t">
              <p className="text-xs font-semibold mb-2">
                {selectedDate && isToday(selectedDate) ? "Today's Events" : selectedDate ? format(selectedDate, 'MMM d') + ' Events' : 'Events'}
              </p>
              <div className="space-y-1">
                {selectedDateEvents.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No events on this day</p>
                ) : (
                  selectedDateEvents.slice(0, 8).map(e => (
                    <div key={`${e.type}-${e.id}`} className="flex items-center gap-1.5 text-xs">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${e.type === 'meeting' ? 'bg-blue-500' : e.type === 'task' ? 'bg-orange-500' : 'bg-green-500'}`} />
                      <span className="font-medium truncate">{e.title}</span>
                      <span className="text-muted-foreground shrink-0">{format(e.time, 'h:mm a')}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-center gap-3 mt-2 pt-2 border-t">
                <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-blue-500" /><span className="text-[10px] text-muted-foreground">Meeting</span></div>
                <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-orange-500" /><span className="text-[10px] text-muted-foreground">Task</span></div>
                <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-green-500" /><span className="text-[10px] text-muted-foreground">Follow-Up</span></div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Follow-ups Widget - Compact */}
        <Card className="border-none shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2 px-4 pt-4">
            <CardTitle className="text-sm font-semibold">My Follow-ups</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/follow-ups')} className="gap-1 text-[10px] h-6 px-2">
              View All <ExternalLink className="h-2.5 w-2.5" />
            </Button>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            {/* Overdue Follow-ups */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3 text-red-500 flex-shrink-0" />
                <span className="text-xs font-medium text-red-600">Overdue ({myFollowUps.filter(f => !f.completed && isBefore(new Date(f.dueDate), now) && !isToday(new Date(f.dueDate))).length})</span>
              </div>
              <div className="space-y-1">
                {myFollowUps
                  .filter(f => !f.completed && isBefore(new Date(f.dueDate), now) && !isToday(new Date(f.dueDate)))
                  .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
                  .map(followUp => {
                    const client = clients.find(c => c.id === followUp.clientId);
                    const clientName = followUp.clientName ?? client?.name ?? 'Unknown';
                    return (
                      <div key={followUp.id} className="p-2 bg-red-50 border border-red-200 rounded text-xs">
                        <p className="font-medium">{followUp.notes || 'Follow-up'}</p>
                        <div className="flex items-center justify-between mt-0.5 gap-2">
                          <p className="text-muted-foreground">{clientName}</p>
                          <p className="text-red-600 flex-shrink-0">{format(new Date(followUp.dueDate), 'MMM d')}</p>
                        </div>
                      </div>
                    );
                  })}
                {myFollowUps.filter(f => !f.completed && isBefore(new Date(f.dueDate), now) && !isToday(new Date(f.dueDate))).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-1">No overdue</p>
                )}
              </div>
            </div>

            {/* Today's Follow-ups */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <CalendarIcon className="h-3 w-3 text-blue-500 flex-shrink-0" />
                <span className="text-xs font-medium text-blue-600">Due Today ({myFollowUps.filter(f => !f.completed && isToday(new Date(f.dueDate))).length})</span>
              </div>
              <div className="space-y-1">
                {myFollowUps
                  .filter(f => !f.completed && isToday(new Date(f.dueDate)))
                  .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
                  .map(followUp => {
                    const client = clients.find(c => c.id === followUp.clientId);
                    const clientName = followUp.clientName ?? client?.name ?? 'Unknown';
                    return (
                      <div key={followUp.id} className="p-2 bg-blue-50 border border-blue-200 rounded text-xs">
                        <p className="font-medium">{followUp.notes || 'Follow-up'}</p>
                        <div className="flex items-center justify-between mt-0.5 gap-2">
                          <p className="text-muted-foreground">{clientName}</p>
                          <p className="text-blue-600 flex-shrink-0">{format(new Date(followUp.dueDate), 'h:mm a')}</p>
                        </div>
                      </div>
                    );
                  })}
                {myFollowUps.filter(f => !f.completed && isToday(new Date(f.dueDate))).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-1">No follow-ups today</p>
                )}
              </div>
            </div>

            {/* Upcoming Follow-ups */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Clock className="h-3 w-3 text-green-500 flex-shrink-0" />
                <span className="text-xs font-medium text-green-600">Upcoming ({myFollowUps.filter(f => !f.completed && !isBefore(new Date(f.dueDate), now) && !isToday(new Date(f.dueDate))).length})</span>
              </div>
              <div className="space-y-1">
                {myFollowUps
                  .filter(f => !f.completed && !isBefore(new Date(f.dueDate), now) && !isToday(new Date(f.dueDate)))
                  .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
                  .map(followUp => {
                    const client = clients.find(c => c.id === followUp.clientId);
                    const clientName = followUp.clientName ?? client?.name ?? 'Unknown';
                    return (
                      <div key={followUp.id} className="p-2 bg-green-50 border border-green-200 rounded text-xs">
                        <p className="font-medium">{followUp.notes || 'Follow-up'}</p>
                        <div className="flex items-center justify-between mt-0.5 gap-2">
                          <p className="text-muted-foreground">{clientName}</p>
                          <p className="text-green-600 flex-shrink-0">{format(new Date(followUp.dueDate), 'MMM d')}</p>
                        </div>
                      </div>
                    );
                  })}
                {myFollowUps.filter(f => !f.completed && !isBefore(new Date(f.dueDate), now) && !isToday(new Date(f.dueDate))).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-1">No upcoming</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Task Summary */}
        <Card className="border-none shadow-sm">
          <CardHeader className="pb-2 px-4 pt-4">
            <CardTitle className="text-sm font-semibold">Task Summary</CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-2">
            {upcomingTasks.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No upcoming tasks</p>
            ) : (
              upcomingTasks.map(task => {
                const taskDate = new Date(task.dueDate);
                const isOverdue = isBefore(taskDate, now) && !isToday(taskDate);
                const isDueToday = isToday(taskDate);
                
                return (
                  <div key={task.id} className="p-2 rounded-lg border bg-card">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{task.title}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {isOverdue && (
                            <span className="text-[10px] text-red-600 font-medium flex items-center gap-0.5">
                              <AlertTriangle className="h-2.5 w-2.5" /> Overdue
                            </span>
                          )}
                          {isDueToday && (
                            <span className="text-[10px] text-blue-600 font-medium flex items-center gap-0.5">
                              <CalendarIcon className="h-2.5 w-2.5" /> Due Today
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            {format(taskDate, 'MMM d')} at {format(taskDate, 'h:mm a')}
                          </span>
                        </div>
                      </div>
                      <Badge 
                        className={cn(
                          "capitalize text-[10px] px-1.5 py-0.5",
                          task.priority === 'high' && "bg-red-100 text-red-800 border-red-200",
                          task.priority === 'medium' && "bg-yellow-100 text-yellow-800 border-yellow-200",
                          task.priority === 'low' && "bg-green-100 text-green-800 border-green-200"
                        )}
                      >
                        {task.priority}
                      </Badge>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Lead Status Chart + Recent Interactions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lead Status Chart */}
        <Card className="border-none shadow-sm lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Lead Status Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis 
                  dataKey="month" 
                  stroke="#6b7280" 
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  stroke="#6b7280" 
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'white', 
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '12px'
                  }}
                />
                <Legend 
                  wrapperStyle={{ fontSize: '12px' }}
                  iconType="circle"
                />
                <Line type="monotone" dataKey="Won" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981', strokeWidth: 2, r: 4 }} />
                <Line type="monotone" dataKey="Lost" stroke="#ef4444" strokeWidth={2} dot={{ fill: '#ef4444', strokeWidth: 2, r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Recent Interactions */}
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Recent Interactions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {localActivityLogs.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No recent activity</p>
            ) : (
              localActivityLogs.slice(0, 8).map(log => {
                const iconConfig: Record<string, { icon: React.ReactNode; bg: string }> = {
                  call_made: { icon: <Phone className="h-4 w-4 text-kpi-blue-icon" />, bg: 'bg-kpi-blue-bg' },
                  email_sent: { icon: <Mail className="h-4 w-4 text-kpi-green-icon" />, bg: 'bg-kpi-green-bg' },
                  meeting_scheduled: { icon: <CalendarIcon className="h-4 w-4 text-kpi-yellow-icon" />, bg: 'bg-kpi-yellow-bg' },
                  task_completed: { icon: <CheckCircle2 className="h-4 w-4 text-kpi-green-icon" />, bg: 'bg-kpi-green-bg' },
                  follow_up_created: { icon: <RotateCcw className="h-4 w-4 text-kpi-purple-icon" />, bg: 'bg-kpi-purple-bg' },
                  pipeline_moved: { icon: <Activity className="h-4 w-4 text-kpi-blue-icon" />, bg: 'bg-kpi-blue-bg' },
                };
                const config = iconConfig[log.type] ?? { icon: <Activity className="h-4 w-4 text-muted-foreground" />, bg: 'bg-muted' };
                return (
                  <div key={log.id} className="flex items-start gap-2">
                    <div className={`w-8 h-8 ${config.bg} rounded-full flex items-center justify-center flex-shrink-0`}>
                      {config.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{log.description}</p>
                      <p className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(log.timestamp), { addSuffix: true })}</p>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}