import { useState, useMemo, useEffect, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, FileText, Calendar as CalendarIcon, Users, Phone, Mail, Calendar, CheckSquare, TrendingUp, Clock, Target, UserCheck, X, User, Coffee, Timer, Loader2, AlertCircle, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useStore } from '@/lib/store';
import { fetchUsers, fetchPerformanceReport, fetchMyPerformanceReport, fetchConversionRates, fetchMyLinkedAccounts, type ApiUser, type LinkedAccount, type PerformanceReportUserResult, type MyPerformanceResult, type ConversionRateUserResult } from '@/lib/api';
import { DatabaseManagerReportSection } from '@/components/DatabaseManagerReportSection';
import { AgencyBulkEmailConversionCard } from '@/components/AgencyBulkEmailConversionCard';
import { MyConversionRateCard } from '@/components/MyConversionRateCard';
import { useReportData, type ReportRawData } from '@/hooks/useReportData';
import { ScopeFilterBar } from '@/components/ScopeFilterBar';
import { PersonCardIdentity } from '@/components/PersonSectionHeader';
import { StickyHeader } from '@/components/StickyHeader';
import { useScopeFilter } from '@/hooks/useElevatedScopeFilter';
import { useScopeQueryParams } from '@/hooks/useScopeQueryParams';
import { format, isToday, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { DateRange } from 'react-day-picker';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { User as UserType } from '@/lib/types';
import { useAssignableRoles } from '@/hooks/useAssignableRoles';
import { getOwnScopeRoleKeys, getUserRoleTitle } from '@/lib/roleLabels';
import {
  useCanViewAgencyScope,
  useCanViewDatabaseManagerReport,
  useCanViewTeamScope,
  useHasPermission,
  useIsDatabaseManagerRole,
  useIsOwnScope,
  useIsRecruitmentManagerRole,
  useIsSeniorRecruiterRole,
  useIsRecruiterRole,
} from '@/lib/access';
import { useActiveSide } from '@/workspaces';
import RecruitmentManagerReport from '@/components/recruitment/reports/RecruitmentManagerReport';
import RecruiterReport from '@/components/recruitment/reports/RecruiterReport';

interface UserReportData {
  user: UserType;
  calls: {
    total: number;
    answered: number;
    voicemail: number;
    noAnswer: number;
    busy: number;
    answerRate: number;
    avgDuration: number;
    totalDuration: number;
  };
  emails: number;
  meetings: {
    total: number;
    completed: number;
  };
  tasks: {
    completed: number;
    due: number;
  };
  followUps: {
    completed: number;
    due: number;
    outcomes: {
      closedWon: number;
      nextFollowUp: number;
      noResponse: number;
      closedLost: number;
    };
  };
  pipeline: {
    movements: number;
    won: number;
    lost: number;
  };
  breakTime: {
    total: number;
    coaching: number;
    meeting: number;
  };
  idleTime: number;
  positionsClosed: number;
}

// ─── Palette: one colour per agency section (cycles) ────────────────────────
const AGENCY_PALETTE = [
  { bg: 'bg-blue-500/10',    border: 'border-blue-500/20',    text: 'text-blue-600',    accent: 'bg-blue-500'    },
  { bg: 'bg-purple-500/10',  border: 'border-purple-500/20',  text: 'text-purple-600',  accent: 'bg-purple-500'  },
  { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-600', accent: 'bg-emerald-500' },
  { bg: 'bg-orange-500/10',  border: 'border-orange-500/20',  text: 'text-orange-600',  accent: 'bg-orange-500'  },
  { bg: 'bg-cyan-500/10',    border: 'border-cyan-500/20',    text: 'text-cyan-600',    accent: 'bg-cyan-500'    },
  { bg: 'bg-rose-500/10',    border: 'border-rose-500/20',    text: 'text-rose-600',    accent: 'bg-rose-500'    },
];

// ─── Pure utility: compute one user's report from raw data ──────────────────
function computeSingleUserReport(
  user: UserType,
  reportData: ReportRawData,
  dateFrom: Date,
  dateTo: Date,
): UserReportData {
  const inRange = (d: string | Date | null | undefined) => {
    if (!d) return false;
    const dt = typeof d === 'string' ? new Date(d) : d;
    if (isNaN(dt.getTime())) return false;
    return isWithinInterval(dt, { start: dateFrom, end: dateTo });
  };

  const userCalls    = reportData.calls.filter(c => c.ownerId === user.id && inRange(c.timestamp));
  const answered     = userCalls.filter(c => c.outcome === 'answered').length;
  const totalDur     = userCalls.reduce((s, c) => s + (c.duration || 0), 0);
  const userMeetings = reportData.meetings.filter(m =>
    inRange(m.startTime) &&
    (m.ownerId === user.id || m.attendees?.some(a => a.userId === user.id))
  );
  const doneFU       = reportData.followUps.filter(f => f.ownerId === user.id && f.completed && inRange(f.completedAt ?? f.updatedAt));
  const dueFU        = reportData.followUps.filter(f => f.ownerId === user.id && !f.completed && inRange(f.dueDate));
  const doneTasks    = reportData.tasks.filter(t => t.ownerId === user.id && t.status === 'done' && inRange(t.completedAt ?? t.updatedAt));
  const dueTasks     = reportData.tasks.filter(t => t.ownerId === user.id && t.status !== 'done' && inRange(t.dueDate));
  const userEmails   = reportData.emailLogs.filter(l => l.userId === user.id);
  const wonLeads     = reportData.leadsWon.filter(l => l.ownerId === user.id && l.closedAt && inRange(l.closedAt));
  const lostLeads    = reportData.leadsLost.filter(l => l.ownerId === user.id && l.closedAt && inRange(l.closedAt));
  const pipeMoves    = reportData.pipelineLogs.filter(l => l.userId === user.id);
  const idleTime     = reportData.idleLogs.filter(l => l.userId === user.id).reduce((s, l) => s + (l.metadata?.duration || 0), 0);
  const coaching     = reportData.breakLogs.filter(l => l.userId === user.id && l.metadata?.breakType === 'coaching').reduce((s, l) => s + (l.metadata?.duration || 0), 0);
  const meetBrk      = reportData.breakLogs.filter(l => l.userId === user.id && l.metadata?.breakType === 'meeting').reduce((s, l) => s + (l.metadata?.duration || 0), 0);

  return {
    user,
    calls: {
      total: userCalls.length, answered,
      voicemail: userCalls.filter(c => c.outcome === 'voicemail').length,
      noAnswer:  userCalls.filter(c => c.outcome === 'no_answer').length,
      busy:      userCalls.filter(c => c.outcome === 'busy').length,
      answerRate: userCalls.length > 0 ? Math.round((answered / userCalls.length) * 100) : 0,
      avgDuration: userCalls.length > 0 ? Math.round(totalDur / userCalls.length) : 0,
      totalDuration: totalDur,
    },
    emails: userEmails.length,
    meetings: { total: userMeetings.length, completed: userMeetings.filter(m => m.status === 'completed').length },
    tasks:    { completed: doneTasks.length, due: dueTasks.length },
    followUps: {
      completed: doneFU.length, due: dueFU.length,
      outcomes: {
        closedWon:    doneFU.filter(f => f.outcome === 'closed_won').length,
        nextFollowUp: doneFU.filter(f => f.outcome === 'next_follow_up').length,
        noResponse:   doneFU.filter(f => f.outcome === 'no_response').length,
        closedLost:   doneFU.filter(f => f.outcome === 'closed_lost').length,
      },
    },
    pipeline: { movements: pipeMoves.length, won: wonLeads.length, lost: lostLeads.length },
    breakTime: { total: coaching + meetBrk, coaching, meeting: meetBrk },
    idleTime,
    positionsClosed: reportData.positionsClosedByUser?.[user.id] ?? 0,
  };
}

/** Full single-user report block (same detail depth as selecting one person on Reports). */
function UserFullReportSection({
  user,
  colorIndex,
  dateFrom,
  dateTo,
  onView,
}: {
  user: ApiUser;
  colorIndex: number;
  dateFrom: Date;
  dateTo: Date;
  onView: () => void;
}) {
  const color = AGENCY_PALETTE[colorIndex % AGENCY_PALETTE.length];
  const fullName = `${user.firstName} ${user.lastName}`.trim();
  const initials = fullName.split(' ').map((w) => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase();
  const mappedUser = useMemo<UserType>(
    () => ({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      name: fullName,
      phone: user.phone ?? '',
      country: user.country as UserType['country'],
      userType: user.userType as UserType['userType'],
      isActive: user.isActive,
      role: user.role as UserType['role'],
      subCompanyId: user.subCompanyId,
      locationId: user.locationId ?? '',
      reportingManagerIds: user.reportingManagerIds ?? [],
    }),
    [user, fullName],
  );

  const agencyId = user.subCompanyId || undefined;
  const { data: reportData, loading } = useReportData({
    dateFrom,
    dateTo,
    subCompanyId: agencyId,
    scope: 'all',
    agencyId,
    ownerIds: [user.id],
  });

  const report = useMemo(() => {
    if (!reportData) return null;
    return computeSingleUserReport(mappedUser, reportData, dateFrom, dateTo);
  }, [reportData, mappedUser, dateFrom, dateTo]);

  return (
    <Card className={cn('border overflow-hidden', color.border)}>
      <div className={cn('flex items-center justify-between px-5 py-4', color.bg)}>
        <PersonCardIdentity
          user={user}
          roleTitle={getUserRoleTitle(user)}
          accentClassName={color.accent}
        />
        <Button size="sm" variant="outline" className={cn('gap-1.5 text-xs shrink-0', color.border)} onClick={onView}>
          View <TrendingUp className="h-3 w-3" />
        </Button>
      </div>

      <CardContent className="pt-4 space-y-4">
        {loading || !report ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading report...</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Calls</p>
                <p className="text-2xl font-bold">{report.calls.total}</p>
                <p className="text-[10px] text-muted-foreground">{report.calls.answerRate}% answered</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Emails</p>
                <p className="text-2xl font-bold">{report.emails}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Meetings</p>
                <p className="text-2xl font-bold">{report.meetings.completed}</p>
                <p className="text-[10px] text-muted-foreground">{report.meetings.total} total</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Tasks Done</p>
                <p className="text-2xl font-bold">{report.tasks.completed}</p>
                <p className="text-[10px] text-muted-foreground">{report.tasks.due} due</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Follow-Ups</p>
                <p className="text-2xl font-bold">{report.followUps.completed}</p>
                <p className="text-[10px] text-muted-foreground">{report.followUps.due} due</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Positions</p>
                <p className="text-2xl font-bold">{report.positionsClosed}</p>
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Phone className="h-5 w-5 text-blue-500" />
                  Call Performance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="p-4 rounded-lg bg-muted/50">
                    <p className="text-sm text-muted-foreground mb-1">Total Calls</p>
                    <p className="text-3xl font-bold">{report.calls.total}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50">
                    <p className="text-sm text-muted-foreground mb-1">Answer Rate</p>
                    <p className="text-3xl font-bold">{report.calls.answerRate}%</p>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50">
                    <p className="text-sm text-muted-foreground mb-1">Avg Duration</p>
                    <p className="text-3xl font-bold">{Math.round(report.calls.avgDuration / 60)}m</p>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50">
                    <p className="text-sm text-muted-foreground mb-1">Total Talk Time</p>
                    <p className="text-3xl font-bold">{Math.round(report.calls.totalDuration / 60)}m</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Call Outcomes</h4>
                  <div className="grid grid-cols-4 gap-2">
                    <div className="text-center p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                      <p className="text-2xl font-bold text-green-600">{report.calls.answered}</p>
                      <p className="text-xs text-muted-foreground">Answered</p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                      <p className="text-2xl font-bold text-yellow-600">{report.calls.voicemail}</p>
                      <p className="text-xs text-muted-foreground">Voicemail</p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-gray-500/10 border border-gray-500/20">
                      <p className="text-2xl font-bold text-gray-600">{report.calls.noAnswer}</p>
                      <p className="text-xs text-muted-foreground">No Answer</p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
                      <p className="text-2xl font-bold text-orange-600">{report.calls.busy}</p>
                      <p className="text-xs text-muted-foreground">Busy</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Coffee className="h-5 w-5 text-purple-500" />
                  Break & Idle Time
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 text-center">
                    <p className="text-sm text-muted-foreground mb-1">Coaching</p>
                    <p className="text-3xl font-bold text-blue-600">{report.breakTime.coaching}m</p>
                  </div>
                  <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20 text-center">
                    <p className="text-sm text-muted-foreground mb-1">Meeting</p>
                    <p className="text-3xl font-bold text-green-600">{report.breakTime.meeting}m</p>
                  </div>
                  <div className="p-4 rounded-lg bg-purple-500/10 border border-purple-500/20 text-center">
                    <p className="text-sm text-muted-foreground mb-1">Total Break</p>
                    <p className="text-3xl font-bold text-purple-600">{report.breakTime.total}m</p>
                  </div>
                  <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-center">
                    <p className="text-sm text-muted-foreground mb-1">Idle Time</p>
                    <p className="text-3xl font-bold text-amber-600">{report.idleTime}m</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="h-5 w-5 text-emerald-500" />
                  Pipeline Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 text-center">
                    <p className="text-sm text-muted-foreground mb-1">Stage Movements</p>
                    <p className="text-3xl font-bold text-blue-600">{report.pipeline.movements}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20 text-center">
                    <p className="text-sm text-muted-foreground mb-1">Deals Won</p>
                    <p className="text-3xl font-bold text-green-600">{report.pipeline.won}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-center">
                    <p className="text-sm text-muted-foreground mb-1">Deals Lost</p>
                    <p className="text-3xl font-bold text-red-600">{report.pipeline.lost}</p>
                  </div>
                </div>
                {report.pipeline.won + report.pipeline.lost > 0 && (
                  <div className="mt-4 p-4 rounded-lg bg-muted/50">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Win Rate</span>
                      <span className="text-2xl font-bold">
                        {Math.round(
                          (report.pipeline.won / (report.pipeline.won + report.pipeline.lost)) * 100,
                        )}
                        %
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CheckSquare className="h-5 w-5 text-orange-500" />
                    Tasks
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-muted/50 text-center">
                    <p className="text-2xl font-bold text-green-600">{report.tasks.completed}</p>
                    <p className="text-xs text-muted-foreground">Completed</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 text-center">
                    <p className="text-2xl font-bold text-orange-600">{report.tasks.due}</p>
                    <p className="text-xs text-muted-foreground">Due</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <UserCheck className="h-5 w-5 text-cyan-500" />
                    Follow-Ups
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg bg-muted/50 text-center">
                      <p className="text-2xl font-bold text-green-600">{report.followUps.completed}</p>
                      <p className="text-xs text-muted-foreground">Completed</p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50 text-center">
                      <p className="text-2xl font-bold text-orange-600">{report.followUps.due}</p>
                      <p className="text-xs text-muted-foreground">Due</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex justify-between rounded border px-2 py-1.5">
                      <span className="text-muted-foreground">Closed Won</span>
                      <span className="font-medium">{report.followUps.outcomes.closedWon}</span>
                    </div>
                    <div className="flex justify-between rounded border px-2 py-1.5">
                      <span className="text-muted-foreground">Next FU</span>
                      <span className="font-medium">{report.followUps.outcomes.nextFollowUp}</span>
                    </div>
                    <div className="flex justify-between rounded border px-2 py-1.5">
                      <span className="text-muted-foreground">No Response</span>
                      <span className="font-medium">{report.followUps.outcomes.noResponse}</span>
                    </div>
                    <div className="flex justify-between rounded border px-2 py-1.5">
                      <span className="text-muted-foreground">Closed Lost</span>
                      <span className="font-medium">{report.followUps.outcomes.closedLost}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Per-agency section card (rendered for each agency in the "All" view) ───
interface AgencyReportSectionProps {
  agency: { id: string; name: string };
  colorIndex: number;
  dateFrom: Date;
  dateTo: Date;
  subCompanyId: string;
  onViewDetails: () => void;
  initialExpanded?: boolean;
  ownerIds?: string[];
  scopeKey: string;
}

function AgencyReportSection({
  agency,
  colorIndex,
  dateFrom,
  dateTo,
  subCompanyId,
  onViewDetails,
  initialExpanded,
  ownerIds,
  scopeKey,
}: AgencyReportSectionProps) {
  const color = AGENCY_PALETTE[colorIndex % AGENCY_PALETTE.length];
  const initials = agency.name.split(' ').map(w => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase();

  const { data: rawUsers = [], isLoading: usersLoading } = useQuery<ApiUser[]>({
    queryKey: ['agency-users-for-report', agency.id, scopeKey],
    queryFn: () => fetchUsers({ subCompanyId: agency.id }),
    staleTime: 0,
  });

  const users = useMemo<UserType[]>(() => {
    const ownerSet = ownerIds?.length ? new Set(ownerIds) : null;
    return rawUsers
      .filter((u) => u.isActive && (!ownerSet || ownerSet.has(u.id)))
      .map((u) => ({
      id: u.id, email: u.email,
      firstName: u.firstName, lastName: u.lastName,
      name: `${u.firstName} ${u.lastName}`.trim(),
      phone: u.phone ?? '',
      country: u.country as UserType['country'],
      userType: u.userType as UserType['userType'],
      isActive: u.isActive,
      role: u.role as UserType['role'],
      subCompanyId: u.subCompanyId,
      locationId: u.locationId ?? '',
      reportingManagerIds: u.reportingManagerIds ?? [],
    }));
  }, [rawUsers, ownerIds]);

  const { data: reportData, loading: reportLoading } = useReportData({
    dateFrom, dateTo, subCompanyId, scope: 'all', agencyId: agency.id, ownerIds,
  });

  const userReports = useMemo<UserReportData[]>(() => {
    if (!reportData) return [];
    return users.map(u => computeSingleUserReport(u, reportData, dateFrom, dateTo));
  }, [users, reportData, dateFrom, dateTo]);

  const totals = useMemo(() => userReports.reduce((acc, r) => ({
    calls:     acc.calls     + r.calls.total,
    answered:  acc.answered  + r.calls.answered,
    emails:    acc.emails    + r.emails,
    meetings:  acc.meetings  + r.meetings.completed,
    tasks:     acc.tasks     + r.tasks.completed,
    followUps: acc.followUps + r.followUps.completed,
    won:       acc.won       + r.pipeline.won,
    lost:      acc.lost      + r.pipeline.lost,
    positions: acc.positions + r.positionsClosed,
  }), { calls: 0, answered: 0, emails: 0, meetings: 0, tasks: 0, followUps: 0, won: 0, lost: 0, positions: 0 }),
  [userReports]);

  const [expanded, setExpanded] = useState(initialExpanded ?? false);

  const answerRate = totals.calls > 0 ? Math.round((totals.answered / totals.calls) * 100) : 0;
  const winRate    = totals.won + totals.lost > 0 ? Math.round(totals.won / (totals.won + totals.lost) * 100) : 0;

  // Top 3 performers by total activity score
  const topPerformers = useMemo(() =>
    [...userReports]
      .sort((a, b) =>
        (b.calls.total + b.emails + b.meetings.completed + b.tasks.completed + b.followUps.completed) -
        (a.calls.total + a.emails + a.meetings.completed + a.tasks.completed + a.followUps.completed)
      )
      .slice(0, 3),
    [userReports]
  );

  const kpiItems = [
    { Icon: Phone,       iconClass: 'text-blue-500',    value: totals.calls,     label: 'Calls',      sub: totals.calls > 0 ? `${answerRate}% answered` : null, barPct: answerRate, barColor: 'bg-blue-500'    },
    { Icon: Mail,        iconClass: 'text-purple-500',  value: totals.emails,    label: 'Emails',     sub: null,                                                 barPct: 0,          barColor: ''               },
    { Icon: Calendar,    iconClass: 'text-green-500',   value: totals.meetings,  label: 'Meetings',   sub: null,                                                 barPct: 0,          barColor: ''               },
    { Icon: CheckSquare, iconClass: 'text-orange-500',  value: totals.tasks,     label: 'Tasks Done', sub: null,                                                 barPct: 0,          barColor: ''               },
    { Icon: UserCheck,   iconClass: 'text-cyan-500',    value: totals.followUps, label: 'Follow-Ups', sub: null,                                                 barPct: 0,          barColor: ''               },
    { Icon: TrendingUp,  iconClass: 'text-emerald-500', value: totals.won,       label: 'Won',        sub: totals.lost > 0 ? `${totals.lost} lost` : null,       barPct: winRate,    barColor: 'bg-emerald-500' },
    { Icon: Target,      iconClass: 'text-teal-500',    value: totals.positions, label: 'Positions',  sub: null,                                                 barPct: 0,          barColor: ''               },
  ];

  return (
    <Card className={cn('border overflow-hidden', color.border)}>
      {/* Header */}
      <div className={cn('flex items-center justify-between px-5 py-4', color.bg)}>
        <div className="flex items-center gap-3">
          <div className={cn('h-10 w-10 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0', color.accent)}>
            {initials}
          </div>
          <div>
            <h3 className="font-semibold text-base leading-tight">{agency.name}</h3>
            <p className="text-xs text-muted-foreground">{users.length} active user{users.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 text-xs">
            <span className={cn('px-2 py-1 rounded-full font-medium border', color.bg, color.text, color.border)}>{totals.calls} calls</span>
            <span className="px-2 py-1 rounded-full font-medium bg-purple-500/10 text-purple-600 border border-purple-500/20">{totals.emails} emails</span>
            <span className="px-2 py-1 rounded-full font-medium bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">{totals.won} won</span>
          </div>
          {!initialExpanded && (
            <Button size="sm" variant="outline" className={cn('gap-1.5 text-xs shrink-0', color.border)} onClick={onViewDetails}>
              View Details <TrendingUp className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      <CardContent className="pt-4 space-y-3">
        {(reportLoading || usersLoading) ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading agency data...</span>
          </div>
        ) : (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
              {kpiItems.map(({ Icon, iconClass, value, label, sub, barPct, barColor }) => (
                <div key={label} className="bg-muted/40 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Icon className={cn('h-4 w-4 shrink-0', iconClass)} />
                    <span className="text-[11px] text-muted-foreground leading-tight">{label}</span>
                  </div>
                  <p className="text-xl font-bold leading-none">{value}</p>
                  {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
                  {barPct > 0 && (
                    <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full', barColor)} style={{ width: `${barPct}%` }} />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {userReports.length > 0 ? (
              <>
                {/* Top 3 performers — always visible, compact preview */}
                {topPerformers.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Top Performers</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {topPerformers.map((r, i) => {
                        const rankColor = i === 0 ? 'text-yellow-500' : i === 1 ? 'text-slate-400' : 'text-amber-600';
                        return (
                          <div key={r.user.id} className="flex items-center gap-2.5 bg-muted/30 rounded-lg px-3 py-2.5 border border-border/30">
                            <span className={cn('text-sm font-black shrink-0 w-4 leading-none', rankColor)}>#{i + 1}</span>
                            <div className={cn('h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0', color.accent)}>
                              {(r.user.firstName?.[0] || r.user.name[0] || '?').toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold truncate leading-tight">{r.user.name}</p>
                              <p className="text-[10px] text-muted-foreground leading-tight">{getUserRoleTitle(r.user)}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-xs font-bold text-blue-500 leading-tight">{r.calls.total} calls</p>
                              <p className={cn('text-[10px] font-medium leading-tight',
                                r.calls.answerRate >= 70 ? 'text-green-500' :
                                r.calls.answerRate >= 50 ? 'text-amber-500' : 'text-red-400'
                              )}>{r.calls.answerRate}% ans</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Expand / collapse toggle */}
                <button
                  onClick={() => setExpanded(e => !e)}
                  className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-lg transition-colors border border-dashed border-border/40"
                >
                  {expanded ? (
                    <><ChevronUp className="h-3.5 w-3.5" />Hide all {userReports.length} users</>
                  ) : (
                    <><ChevronDown className="h-3.5 w-3.5" />Show all {userReports.length} users</>
                  )}
                </button>

                {/* Full breakdown table — only when expanded */}
                {expanded && (
                  <div className="overflow-x-auto rounded-lg border border-border/40">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/50 bg-muted/30">
                          {['User', 'Calls', 'Ans%', 'Emails', 'Meetings', 'Tasks', 'F/U', 'Won', 'Pos', 'Idle'].map(h => (
                            <th key={h} className={cn('py-2.5 px-2 font-medium text-xs text-muted-foreground uppercase tracking-wider', h === 'User' ? 'text-left px-3' : 'text-center')}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {userReports.map(r => {
                          const ar = r.calls.answerRate;
                          const arCls = ar >= 70
                            ? 'bg-green-500/15 text-green-700 border-green-300 dark:text-green-400 dark:border-green-700'
                            : ar >= 50
                            ? 'bg-amber-500/15 text-amber-700 border-amber-300 dark:text-amber-400 dark:border-amber-700'
                            : 'bg-red-500/15 text-red-700 border-red-300 dark:text-red-400 dark:border-red-700';
                          return (
                            <tr key={r.user.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                              <td className="py-2.5 px-3">
                                <div className="flex items-center gap-2">
                                  <div className={cn('h-7 w-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0', color.accent)}>
                                    {(r.user.firstName?.[0] || r.user.name[0] || '?').toUpperCase()}
                                  </div>
                                  <div>
                                    <p className="font-medium text-sm leading-tight">{r.user.name}</p>
                                    <p className="text-[10px] text-muted-foreground leading-tight">{getUserRoleTitle(r.user)}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="text-center py-2.5 px-2 font-bold text-blue-500">{r.calls.total}</td>
                              <td className="text-center py-2.5 px-2">
                                <span className={cn('text-[11px] font-medium px-1.5 py-0.5 rounded border', arCls)}>{ar}%</span>
                              </td>
                              <td className="text-center py-2.5 px-2 font-bold text-purple-500">{r.emails}</td>
                              <td className="text-center py-2.5 px-2 font-bold text-green-500">{r.meetings.completed}</td>
                              <td className="text-center py-2.5 px-2">
                                <span className="text-green-500 font-medium">{r.tasks.completed}</span>
                                <span className="text-muted-foreground mx-0.5 text-xs">/</span>
                                <span className="text-orange-400 text-xs">{r.tasks.due}d</span>
                              </td>
                              <td className="text-center py-2.5 px-2">
                                <span className="text-green-500 font-medium">{r.followUps.completed}</span>
                                <span className="text-muted-foreground mx-0.5 text-xs">/</span>
                                <span className="text-orange-400 text-xs">{r.followUps.due}d</span>
                              </td>
                              <td className="text-center py-2.5 px-2">
                                <span className="font-bold text-emerald-500">{r.pipeline.won}</span>
                                {r.pipeline.lost > 0 && <span className="text-red-400 text-xs ml-1">-{r.pipeline.lost}</span>}
                              </td>
                              <td className="text-center py-2.5 px-2 font-bold text-teal-600">{r.positionsClosed}</td>
                              <td className="text-center py-2.5 px-2 text-amber-500 text-xs font-medium">{r.idleTime}m</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <p className="text-center text-sm text-muted-foreground py-6">No active users found for this agency</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Conversion Rates view component ─────────────────────────────────────────

interface ConversionRatesViewProps {
  loading: boolean;
  error: string | null;
  results: ConversionRateUserResult[];
  onRetry: () => void;
}

function ConversionRateCell({ count, conversions, rate }: { count: number; conversions: number; rate: number | null }) {
  const rateStr = rate === null ? '—' : rate === 100 && conversions > count ? '100%*' : `${rate}%`;
  const rateColor =
    rate === null ? 'text-muted-foreground' :
    rate >= 15    ? 'text-green-600' :
    rate >= 7     ? 'text-yellow-600' :
    'text-red-500';

  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`text-base font-bold tabular-nums ${rateColor}`} title={rate !== null && conversions > count ? 'Exceeds 100% — data quality flag' : undefined}>
        {rateStr}
      </span>
      <span className="text-[10px] text-muted-foreground tabular-nums">{conversions} / {count}</span>
    </div>
  );
}

function ConversionRatesView({ loading, error, results, onRetry }: ConversionRatesViewProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Loading conversion rates...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
            <p className="text-sm text-destructive flex-1">{error}</p>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onRetry}>
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (results.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <p className="text-muted-foreground text-sm">No activity data for this period.</p>
        </CardContent>
      </Card>
    );
  }

  const renderSection = (
    title: string,
    icon: ReactNode,
    iconColor: string,
    pick: (r: ConversionRateUserResult) => { count: number; conversions: number; rate: number | null },
    activityLabel: string,
  ) => (
    <div className="space-y-3">
      <div className={`flex items-center gap-2 ${iconColor}`}>
        {icon}
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {results.map((r) => {
          const name     = `${r.firstName} ${r.lastName}`;
          const initials = (r.firstName[0] ?? '') + (r.lastName[0] ?? '');
          const cell     = pick(r);
          return (
            <Card key={r.userId} className="overflow-hidden">
              <CardHeader className="pb-3 pt-4 px-4">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-semibold text-primary uppercase">{initials}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{name}</p>
                    <p className="text-xs text-muted-foreground">{getUserRoleTitle(r)}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="border rounded-lg py-3 px-2 flex flex-col items-center gap-1">
                  <div className={`flex items-center gap-1 text-xs text-muted-foreground mb-1`}>
                    {icon}
                    {activityLabel}
                  </div>
                  <ConversionRateCell {...cell} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Conversion rate = distinct closed-won leads with a causal linked activity ÷ total activities in the period.
        Sub-line shows <span className="font-medium">wins&nbsp;/&nbsp;activities</span>.
        "—" means zero activities.
      </p>

      {renderSection('Call Conversion Rate',  <Phone className="h-4 w-4" />, 'text-blue-600',   (r) => r.calls,  'Calls')}
      {renderSection('Email Conversion Rate', <Mail  className="h-4 w-4" />, 'text-purple-600', (r) => r.emails, 'Emails')}
    </div>
  );
}

// ─── Performance vs Targets view component ───────────────────────────────────

function pctColor(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return 'text-muted-foreground';
  if (pct >= 80) return 'text-green-600';
  if (pct >= 50) return 'text-yellow-600';
  return 'text-red-500';
}

function pctBarColor(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return 'bg-muted';
  if (pct >= 80) return 'bg-green-500';
  if (pct >= 50) return 'bg-yellow-500';
  return 'bg-red-500';
}

interface PerformanceMetricRowProps {
  icon: ReactNode;
  label: string;
  actual: number;
  target: number | null | undefined;
  pct: number | null | undefined;
}

interface PerformanceRatioRowProps {
  icon: ReactNode;
  label: string;
  completed: number;
  assigned: number;
  pct: number | null | undefined;
}

function PerformanceRatioRow({ icon, label, completed, assigned, pct }: PerformanceRatioRowProps) {
  const noWorkload = assigned <= 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className="flex items-center gap-2">
          <span className="font-semibold text-foreground">{completed}</span>
          <span className="text-muted-foreground text-xs">/ {assigned}</span>
          <span className={`text-xs font-medium w-10 text-right ${pctColor(pct)}`}>
            {!noWorkload && pct !== null && pct !== undefined ? `${pct}%` : '—'}
          </span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pctBarColor(pct)}`}
          style={{ width: `${noWorkload ? 0 : Math.min(pct ?? 0, 100)}%` }}
        />
      </div>
    </div>
  );
}

function PerformanceMetricRow({ icon, label, actual, target, pct }: PerformanceMetricRowProps) {
  const noTarget = target === null || target === undefined || target === 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className="flex items-center gap-2">
          <span className="font-semibold text-foreground">{actual}</span>
          {!noTarget && (
            <>
              <span className="text-muted-foreground text-xs">/ {target}</span>
              <span className={`text-xs font-medium w-10 text-right ${pctColor(pct)}`}>
                {pct !== null && pct !== undefined ? `${pct}%` : '—'}
              </span>
            </>
          )}
          {noTarget && <span className="text-xs text-muted-foreground italic">no target</span>}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pctBarColor(pct)}`}
          style={{ width: noTarget ? '0%' : `${Math.min(pct ?? 0, 100)}%` }}
        />
      </div>
    </div>
  );
}

interface PerformanceReportViewProps {
  loading: boolean;
  error: string | null;
  results: PerformanceReportUserResult[];
  onRetry: () => void;
}

function PerformanceReportView({ loading, error, results, onRetry }: PerformanceReportViewProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Loading performance report...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
            <p className="text-sm text-destructive flex-1">{error}</p>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onRetry}>
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const unconfigured = results.filter((r) => !r.targetConfigured).length;

  return (
    <div className="space-y-4">
      {unconfigured > 0 && (
        <Card className="border-amber-400/40 bg-amber-50/60 dark:bg-amber-900/10">
          <CardContent className="py-3 px-4">
            <p className="text-sm text-amber-700 dark:text-amber-400">
              <Target className="h-4 w-4 inline mr-1.5 align-middle" />
              {unconfigured === results.length
                ? 'No performance targets configured. Go to Settings → Targets to set them.'
                : `${unconfigured} user${unconfigured > 1 ? 's have' : ' has'} no configured target — showing actual counts only.`}
            </p>
          </CardContent>
        </Card>
      )}

      {results.length === 0 && !loading && (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-muted-foreground text-sm">No users found for the selected scope.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {results.map((r) => {
          const name = `${r.firstName} ${r.lastName}`;
          const initials = (r.firstName[0] ?? '') + (r.lastName[0] ?? '');
          return (
            <Card key={r.userId} className="overflow-hidden">
              <CardHeader className="pb-3 pt-4 px-4">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-semibold text-primary uppercase">{initials}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{name}</p>
                    <p className="text-xs text-muted-foreground">{getUserRoleTitle(r)}</p>
                  </div>
                  {!r.targetConfigured && (
                    <Badge variant="outline" className="text-xs shrink-0 border-amber-400/50 text-amber-600">No target</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <PerformanceMetricRow
                  icon={<Mail className="h-3.5 w-3.5" />}
                  label="Emails Sent"
                  actual={r.actual.emails}
                  target={r.target?.emailsTarget}
                  pct={r.percentages?.emails}
                />
                <PerformanceMetricRow
                  icon={<Phone className="h-3.5 w-3.5" />}
                  label="Calls Made"
                  actual={r.actual.calls}
                  target={r.target?.callsTarget}
                  pct={r.percentages?.calls}
                />
                <PerformanceRatioRow
                  icon={<CheckSquare className="h-3.5 w-3.5" />}
                  label="Tasks (completed / assigned)"
                  completed={r.actual.tasks.completed}
                  assigned={r.actual.tasks.assigned}
                  pct={r.percentages?.tasks}
                />
                <PerformanceRatioRow
                  icon={<TrendingUp className="h-3.5 w-3.5" />}
                  label="Follow-ups (completed / assigned)"
                  completed={r.actual.followUps.completed}
                  assigned={r.actual.followUps.assigned}
                  pct={r.percentages?.followUps}
                />
                <PerformanceMetricRow
                  icon={<CalendarIcon className="h-3.5 w-3.5" />}
                  label="Meetings Scheduled"
                  actual={r.actual.meetingsScheduled}
                  target={r.target?.meetingScheduleCountTarget}
                  pct={r.percentages?.meetings}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function SalesReports() {
  const { currentUser, currentSubCompany } = useStore();
  const [apiUsers, setApiUsers] = useState<UserType[]>([]);
  const [dateMode, setDateMode] = useState<'today' | 'custom'>('today');
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(),
    to: new Date(),
  });
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([currentUser.id]);
  const [viewMode, setViewMode] = useState<'combined' | 'individual'>('combined');
  const [reportView, setReportView] = useState<'activity' | 'performance' | 'conversion' | 'database_managers'>('activity');
  const [perfReport, setPerfReport] = useState<PerformanceReportUserResult[]>([]);
  const [perfReportLoading, setPerfReportLoading] = useState(false);
  const [perfReportError, setPerfReportError] = useState<string | null>(null);
  const [convReport, setConvReport] = useState<ConversionRateUserResult[]>([]);
  const [convReportLoading, setConvReportLoading] = useState(false);
  const [convReportError, setConvReportError] = useState<string | null>(null);
  const [myPerfResult, setMyPerfResult] = useState<MyPerformanceResult | null>(null);
  const [myPerfLoading, setMyPerfLoading] = useState(false);

  const canViewAgencyUsers = useCanViewAgencyScope();
  const canViewTeam = useCanViewTeamScope();
  const canViewUsers = useHasPermission('users:read');
  const { assignableRoles } = useAssignableRoles();
  const ownScopeRoleKeys = useMemo(() => getOwnScopeRoleKeys(assignableRoles), [assignableRoles]);
  const [reportsSearchParams] = useSearchParams();
  const linkedUserIdParam = reportsSearchParams.get('linkedUserId') ?? '';
  const linkedUserIdsFromUrl = useMemo(
    () => (linkedUserIdParam ? linkedUserIdParam.split(',').filter(Boolean) : []),
    [linkedUserIdParam],
  );

  useEffect(() => {
    if (linkedUserIdsFromUrl.length > 0) {
      setSelectedUserIds([...new Set([...linkedUserIdsFromUrl])]);
    } else {
      setSelectedUserIds([currentUser.id]);
    }
  }, [linkedUserIdParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: linkedAccounts = [] } = useQuery<LinkedAccount[]>({
    queryKey: ['my-linked-accounts'],
    queryFn: fetchMyLinkedAccounts,
    staleTime: 5 * 60 * 1000,
    enabled: !!linkedUserIdParam,
  });

  // On the Recruitment workspace side, scope chips + report ownerIds to recruiters only.
  // Marketing side is left unchanged (undefined domain = current mixed behavior).
  const { side: reportsWorkspaceSide } = useActiveSide();
  const scopeFilter = useScopeFilter(
    reportsWorkspaceSide === 'recruitment' ? { domain: 'recruitment' } : undefined,
  );
  const {
    isElevated,
    showHierarchyFilters,
    isAgencyHierarchyViewer,
    isPureManager,
    agencies,
    agenciesLoading,
    agencyUsers,
    agencyUsersLoading,
    selectedAgencyId,
    selectedLeaderId,
    selectedManagerId,
    selectedUserId,
    setSelectedAgencyId,
    setSelectedUserId,
    setSelectedManagerId,
    onlyMe,
    getAssociatesForManager,
    getUsersForLeader,
    teamUsers: managerTeamUsers,
    sectionUsers,
    showAllTeamView,
    showAgencySections,
    showManagerSections,
    filterRowProps,
    leaderParamInUrl,
    managerParamInUrl,
    userParamInUrl,
    scopeKey,
  } = scopeFilter;
  const canViewDbManagerReport = useCanViewDatabaseManagerReport();
  /** Always DB Manager report for that role — independent of agency destination / extra perms. */
  const useGlobalDbReports = useIsDatabaseManagerRole();
  const isAssociate = useIsOwnScope();

  useEffect(() => {
    if (useGlobalDbReports) setReportView('database_managers');
  }, [useGlobalDbReports]);

  // Fetch users from API for managers/directors
  useEffect(() => {
    if (!canViewUsers) return;
    const subCompanyId = currentSubCompany?.id;
    fetchUsers({ subCompanyId }).then((list) => {
      const mapped: UserType[] = list.map((u) => ({
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        name: `${u.firstName} ${u.lastName}`.trim(),
        phone: u.phone ?? '',
        country: u.country as UserType['country'],
        userType: u.userType as UserType['userType'],
        isActive: u.isActive,
        role: u.role as UserType['role'],
        subCompanyId: u.subCompanyId,
        locationId: u.locationId ?? '',
        reportingManagerIds: u.reportingManagerIds ?? [],
      }));
      setApiUsers(mapped);
    });
  }, [canViewUsers, currentSubCompany?.id]);

  const linkedViewableUsers = useMemo<UserType[]>(() => {
    if (!linkedUserIdParam || isElevated) return [];
    return linkedAccounts
      .filter(a => linkedUserIdsFromUrl.includes(a.userId) && a.userId !== currentUser.id && a.isActive)
      .map(a => ({
        id: a.userId,
        email: a.email,
        firstName: a.firstName,
        lastName: a.lastName,
        name: `${a.firstName} ${a.lastName}`.trim(),
        phone: '',
        country: currentUser.country,
        userType: 'internal' as UserType['userType'],
        isActive: true,
        role: a.role as UserType['role'],
        subCompanyId: a.subCompanyId,
        locationId: '',
        reportingManagerIds: [],
      }));
  }, [linkedUserIdParam, isElevated, linkedAccounts, linkedUserIdsFromUrl, currentUser]);

  const viewableUsers = useMemo(() => {
    let base: UserType[];
    if (canViewAgencyUsers) {
      base = apiUsers.filter(u => u.isActive);
    } else if (canViewTeam) {
      // First try direct reports via reportingManagerIds
      const reportingUsers = apiUsers.filter(u =>
        u.isActive && u.id !== currentUser.id && u.reportingManagerIds?.includes(currentUser.id)
      );
      // Fallback: if no direct reports found, show all active own-scope users in same subCompany
      const teamUsers = reportingUsers.length > 0
        ? reportingUsers
        : apiUsers.filter(u =>
            u.isActive && u.id !== currentUser.id &&
            ownScopeRoleKeys.has(u.role)
          );
      base = [currentUser, ...teamUsers];
    } else {
      base = [currentUser];
    }
    if (linkedViewableUsers.length === 0) return base;
    const baseIds = new Set(base.map(u => u.id));
    return [...base, ...linkedViewableUsers.filter(u => !baseIds.has(u.id))];
  }, [currentUser, apiUsers, canViewAgencyUsers, canViewTeam, ownScopeRoleKeys, linkedViewableUsers]);

  // Compute effective date range for API
  const effectiveDateFrom = useMemo(() => {
    if (dateMode === 'today') return startOfDay(new Date());
    return dateRange?.from ? startOfDay(dateRange.from) : startOfDay(new Date());
  }, [dateMode, dateRange?.from]);

  const effectiveDateTo = useMemo(() => {
    if (dateMode === 'today') return endOfDay(new Date());
    return dateRange?.to ? endOfDay(dateRange.to) : endOfDay(new Date());
  }, [dateMode, dateRange?.to]);

  // When an elevated user has a specific agency tab selected, always use scope:'all' for that agency
  const reportScope = (canViewAgencyUsers || (isElevated && selectedAgencyId !== 'all')) ? 'all' as const : canViewTeam ? 'team' as const : 'mine' as const;
  const reportAgencyId = isElevated && selectedAgencyId !== 'all' ? selectedAgencyId : undefined;
  const { ownerIds: reportOwnerIds } = useScopeQueryParams(scopeFilter);

  const activityLogSubjectIds = useMemo(() => {
    if (reportScope === 'mine') return undefined;
    if (!isPureManager) return undefined;
    if (selectedUserId === 'all') {
      return viewableUsers.filter((u) => u.isActive).map((u) => u.id);
    }
    return [selectedUserId];
  }, [reportScope, isPureManager, selectedUserId, viewableUsers]);

  const { data: reportData, loading: reportLoading, refreshing, error: reportError, refetch } = useReportData({
    dateFrom: effectiveDateFrom,
    dateTo: effectiveDateTo,
    subCompanyId: currentSubCompany?.id,
    scope: reportScope,
    agencyId: reportAgencyId,
    ownerIds: reportOwnerIds,
    activityLogSubjectIds,
    enabled: !useGlobalDbReports,
  });

  // Fetch performance report when that view is active
  const perfStartDate = effectiveDateFrom.toISOString().slice(0, 10);
  const perfEndDate   = effectiveDateTo.toISOString().slice(0, 10);
  useEffect(() => {
    if (!isElevated) return;
    if (reportView !== 'performance') return;
    setPerfReportLoading(true);
    setPerfReportError(null);
    const agencyIds = isElevated && selectedAgencyId !== 'all' ? [selectedAgencyId] : undefined;
    fetchPerformanceReport({
      startDate: perfStartDate,
      endDate: perfEndDate,
      agencyIds,
      userIds: reportOwnerIds,
    })
      .then(setPerfReport)
      .catch((err: Error) => setPerfReportError(err.message ?? 'Failed to load performance report'))
      .finally(() => setPerfReportLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isElevated, reportView, perfStartDate, perfEndDate, selectedAgencyId, scopeKey, reportOwnerIds]);

  // Conversion rate report: fetch when view is active (elevated roles and managers)
  useEffect(() => {
    if (!isElevated && !canViewTeam) return;
    if (reportView !== 'conversion') return;
    setConvReportLoading(true);
    setConvReportError(null);
    const agencyIds = isElevated && selectedAgencyId !== 'all' ? [selectedAgencyId] : undefined;
    const userIds = reportOwnerIds;
    fetchConversionRates({ startDate: perfStartDate, endDate: perfEndDate, agencyIds, userIds })
      .then(setConvReport)
      .catch((err: Error) => setConvReportError(err.message ?? 'Failed to load conversion report'))
      .finally(() => setConvReportLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isElevated, canViewTeam, isPureManager, reportView, perfStartDate, perfEndDate, selectedAgencyId, scopeKey]);

  // Associate self-report: fetch whenever dates change (no role restriction)
  useEffect(() => {
    if (!isAssociate) return;
    setMyPerfLoading(true);
    fetchMyPerformanceReport({ startDate: perfStartDate, endDate: perfEndDate })
      .then(setMyPerfResult)
      .catch(() => setMyPerfResult(null))
      .finally(() => setMyPerfLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAssociate, perfStartDate, perfEndDate]);

  const canSelectMultiple = canViewAgencyUsers || canViewTeam;

  const toggleUserSelection = (userId: string) => {
    if (!canSelectMultiple) return;
    setSelectedUserIds(prev => {
      if (prev.includes(userId)) {
        if (prev.length === 1) return prev;
        return prev.filter(id => id !== userId);
      } else {
        // If only self (currentUser) is selected, replace instead of adding
        if (prev.length === 1 && prev[0] === currentUser.id) {
          return [userId];
        }
        return [...prev, userId];
      }
    });
  };

  const selectAllUsers = () => setSelectedUserIds(viewableUsers.map(u => u.id));
  const clearUserSelection = () => setSelectedUserIds([currentUser.id]);

  const selectedUsers = viewableUsers.filter(u => selectedUserIds.includes(u.id));

  // Map ApiUser[] from the agency query to UserType (same shape as the existing apiUsers mapping)
  const agencyUsersMapped = useMemo<UserType[]>(() => {
    if (!isElevated || selectedAgencyId === 'all') return [];
    return agencyUsers.filter((u) => u.isActive).map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      name: `${u.firstName} ${u.lastName}`.trim(),
      phone: u.phone ?? '',
      country: u.country as UserType['country'],
      userType: u.userType as UserType['userType'],
      isActive: u.isActive,
      role: u.role as UserType['role'],
      subCompanyId: u.subCompanyId,
      locationId: u.locationId ?? '',
      reportingManagerIds: u.reportingManagerIds ?? [],
    }));
  }, [isElevated, selectedAgencyId, agencyUsers]);

  // Resolve whose data to display: tabs take over for elevated users with a specific agency selected
  const activeSelectedUsers = useMemo<UserType[]>(() => {
    if (isElevated && selectedAgencyId !== 'all') {
      if (selectedUserId !== 'all' && selectedUserId !== 'me') {
        const u = agencyUsersMapped.find((u) => u.id === selectedUserId);
        return u ? [u] : [];
      }
      if (selectedManagerId !== 'all') {
        const ids = new Set(getAssociatesForManager(selectedManagerId).map(a => a.id));
        return agencyUsersMapped.filter(u => ids.has(u.id));
      }
      if (selectedLeaderId !== 'all') {
        const ids = new Set(getUsersForLeader(selectedLeaderId).map((u) => u.id));
        return agencyUsersMapped.filter((u) => ids.has(u.id));
      }
      return agencyUsersMapped;
    }
    return selectedUsers;
  }, [isElevated, selectedAgencyId, selectedUserId, selectedManagerId, selectedLeaderId, agencyUsersMapped, getAssociatesForManager, getUsersForLeader, selectedUsers]);

  // Helper: check if a date string falls within the effective range (for endpoints without server-side date filtering)
  const isInDateRange = (dateStr: string | Date | null | undefined): boolean => {
    if (!dateStr) return false;
    const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
    if (isNaN(date.getTime())) return false;
    return isWithinInterval(date, { start: effectiveDateFrom, end: effectiveDateTo });
  };

  // Generate report data for each user from API data
  const userReports: UserReportData[] = useMemo(() => {
    if (!reportData) return [];

    return activeSelectedUsers.map(user => {
      // Calls — filter by date client-side (API has no date param)
      const userCalls = reportData.calls.filter(c => c.ownerId === user.id && isInDateRange(c.timestamp));
      const answeredCalls = userCalls.filter(c => c.outcome === 'answered').length;
      const totalDuration = userCalls.reduce((acc, c) => acc + (c.duration || 0), 0);

      // Meetings — date-filtered by startTime; include both organizer and attendee
      const userMeetings = reportData.meetings.filter(m =>
        isInDateRange(m.startTime) &&
        (m.ownerId === user.id || m.attendees?.some(a => a.userId === user.id))
      );
      const completedMeetings = userMeetings.filter(m => m.status === 'completed').length;

      // Follow-ups — filter by date client-side
      const userCompletedFollowUps = reportData.followUps.filter(f =>
        f.ownerId === user.id && f.completed && isInDateRange(f.completedAt ?? f.updatedAt)
      );
      const userDueFollowUps = reportData.followUps.filter(f =>
        f.ownerId === user.id && !f.completed && isInDateRange(f.dueDate)
      );

      // Tasks — filter by date client-side
      const userCompletedTasks = reportData.tasks.filter(t =>
        t.ownerId === user.id && t.status === 'done' && isInDateRange(t.completedAt ?? t.updatedAt)
      );
      const userDueTasks = reportData.tasks.filter(t =>
        t.ownerId === user.id && t.status !== 'done' && isInDateRange(t.dueDate)
      );

      // Emails — already date-filtered server-side via activity logs
      const userEmails = reportData.emailLogs.filter(log => log.userId === user.id);

      // Leads won/lost — filter by date client-side
      const userWonLeads = reportData.leadsWon.filter(l =>
        l.ownerId === user.id && l.closedAt && isInDateRange(l.closedAt)
      );
      const userLostLeads = reportData.leadsLost.filter(l =>
        l.ownerId === user.id && l.closedAt && isInDateRange(l.closedAt)
      );

      // Pipeline movements — already date-filtered server-side
      const userPipelineMovements = reportData.pipelineLogs.filter(log => log.userId === user.id);

      // Break and idle time — already date-filtered server-side
      const userIdleTime = reportData.idleLogs
        .filter(log => log.userId === user.id)
        .reduce((acc, log) => acc + (log.metadata?.duration || 0), 0);

      const coachingTime = reportData.breakLogs
        .filter(log => log.metadata?.breakType === 'coaching' && log.userId === user.id)
        .reduce((acc, log) => acc + (log.metadata?.duration || 0), 0);

      const meetingBreakTime = reportData.breakLogs
        .filter(log => log.metadata?.breakType === 'meeting' && log.userId === user.id)
        .reduce((acc, log) => acc + (log.metadata?.duration || 0), 0);
      const totalBreak = coachingTime + meetingBreakTime;

      return {
        user,
        calls: {
          total: userCalls.length,
          answered: answeredCalls,
          voicemail: userCalls.filter(c => c.outcome === 'voicemail').length,
          noAnswer: userCalls.filter(c => c.outcome === 'no_answer').length,
          busy: userCalls.filter(c => c.outcome === 'busy').length,
          answerRate: userCalls.length > 0 ? Math.round((answeredCalls / userCalls.length) * 100) : 0,
          avgDuration: userCalls.length > 0 ? Math.round(totalDuration / userCalls.length) : 0,
          totalDuration,
        },
        emails: userEmails.length,
        meetings: {
          total: userMeetings.length,
          completed: completedMeetings,
        },
        tasks: {
          completed: userCompletedTasks.length,
          due: userDueTasks.length,
        },
        followUps: {
          completed: userCompletedFollowUps.length,
          due: userDueFollowUps.length,
          outcomes: {
            closedWon: userCompletedFollowUps.filter(f => f.outcome === 'closed_won').length,
            nextFollowUp: userCompletedFollowUps.filter(f => f.outcome === 'next_follow_up').length,
            noResponse: userCompletedFollowUps.filter(f => f.outcome === 'no_response').length,
            closedLost: userCompletedFollowUps.filter(f => f.outcome === 'closed_lost').length,
          },
        },
        pipeline: {
          movements: userPipelineMovements.length,
          won: userWonLeads.length,
          lost: userLostLeads.length,
        },
        breakTime: {
          total: totalBreak,
          coaching: coachingTime,
          meeting: meetingBreakTime,
        },
        idleTime: userIdleTime,
        positionsClosed: reportData.positionsClosedByUser?.[user.id] ?? 0,
      };
    });
  }, [activeSelectedUsers, reportData, effectiveDateFrom, effectiveDateTo]);
  
  // Combined totals
  const combinedTotals = useMemo(() => {
    return userReports.reduce((acc, report) => ({
      calls: acc.calls + report.calls.total,
      answered: acc.answered + report.calls.answered,
      emails: acc.emails + report.emails,
      meetingsCompleted: acc.meetingsCompleted + report.meetings.completed,
      tasksCompleted: acc.tasksCompleted + report.tasks.completed,
      followUpsCompleted: acc.followUpsCompleted + report.followUps.completed,
      won: acc.won + report.pipeline.won,
      lost: acc.lost + report.pipeline.lost,
      positions: acc.positions + report.positionsClosed,
    }), { calls: 0, answered: 0, emails: 0, meetingsCompleted: 0, tasksCompleted: 0, followUpsCompleted: 0, won: 0, lost: 0, positions: 0 });
  }, [userReports]);
  
  const getDateRangeText = () => {
    if (dateMode === 'today') return format(new Date(), 'EEEE, MMMM d, yyyy');
    if (dateRange?.from && dateRange?.to) {
      if (format(dateRange.from, 'yyyy-MM-dd') === format(dateRange.to, 'yyyy-MM-dd')) {
        return format(dateRange.from, 'EEEE, MMMM d, yyyy');
      }
      return `${format(dateRange.from, 'MMM d, yyyy')} - ${format(dateRange.to, 'MMM d, yyyy')}`;
    }
    if (dateRange?.from) return format(dateRange.from, 'EEEE, MMMM d, yyyy');
    return format(new Date(), 'EEEE, MMMM d, yyyy');
  };
  
  const getSelectedUsersLabel = () => {
    if (selectedUserIds.length === 1) return selectedUsers[0]?.name || 'Unknown';
    if (selectedUserIds.length === viewableUsers.length) return 'All Users';
    return `${selectedUserIds.length} Users Selected`;
  };

  const UserReportCard = ({ report }: { report: UserReportData }) => (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base">{report.user.name}</CardTitle>
            <p className="text-xs text-muted-foreground">{report.user.userType}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Activity Summary */}
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center p-2 rounded-lg bg-blue-500/10">
            <Phone className="h-4 w-4 mx-auto mb-1 text-blue-500" />
            <p className="text-lg font-bold">{report.calls.total}</p>
            <p className="text-[10px] text-muted-foreground">Calls</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-purple-500/10">
            <Mail className="h-4 w-4 mx-auto mb-1 text-purple-500" />
            <p className="text-lg font-bold">{report.emails}</p>
            <p className="text-[10px] text-muted-foreground">Emails</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-green-500/10">
            <Calendar className="h-4 w-4 mx-auto mb-1 text-green-500" />
            <p className="text-lg font-bold">{report.meetings.completed}</p>
            <p className="text-[10px] text-muted-foreground">Meetings</p>
          </div>
        </div>
        
        {/* Call Details */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Call Performance</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Answer Rate</span>
              <span className="font-medium">{report.calls.answerRate}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Avg Duration</span>
              <span className="font-medium">{Math.round(report.calls.avgDuration / 60)}m</span>
            </div>
          </div>
          <div className="flex gap-1 text-xs">
            <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-200">{report.calls.answered} ans</Badge>
            <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-200">{report.calls.voicemail} vm</Badge>
            <Badge variant="outline" className="bg-gray-500/10 text-gray-600 border-gray-200">{report.calls.noAnswer} na</Badge>
          </div>
        </div>
        
        {/* Tasks & Follow-ups */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tasks & Follow-Ups</h4>
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 rounded-lg bg-muted/50">
              <div className="flex items-center gap-1 mb-1">
                <CheckSquare className="h-3 w-3 text-orange-500" />
                <span className="text-xs text-muted-foreground">Tasks</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-sm font-bold text-green-500">{report.tasks.completed}</span>
                <span className="text-xs text-muted-foreground">/</span>
                <span className="text-xs text-orange-500">{report.tasks.due} due</span>
              </div>
            </div>
            <div className="p-2 rounded-lg bg-muted/50">
              <div className="flex items-center gap-1 mb-1">
                <UserCheck className="h-3 w-3 text-cyan-500" />
                <span className="text-xs text-muted-foreground">Follow-Ups</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-sm font-bold text-green-500">{report.followUps.completed}</span>
                <span className="text-xs text-muted-foreground">/</span>
                <span className="text-xs text-orange-500">{report.followUps.due} due</span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Break & Idle Time */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Break & Idle Time</h4>
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 rounded-lg bg-muted/50">
              <div className="flex items-center gap-1 mb-1">
                <Coffee className="h-3 w-3 text-purple-500" />
                <span className="text-xs text-muted-foreground">Break</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-sm font-bold">{report.breakTime.total}m</span>
                <span className="text-[10px] text-muted-foreground">({report.breakTime.coaching}m coaching, {report.breakTime.meeting}m meeting)</span>
              </div>
            </div>
            <div className="p-2 rounded-lg bg-muted/50">
              <div className="flex items-center gap-1 mb-1">
                <Timer className="h-3 w-3 text-amber-500" />
                <span className="text-xs text-muted-foreground">Idle</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-sm font-bold">{report.idleTime}m</span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Pipeline */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pipeline</h4>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <TrendingUp className="h-4 w-4 text-blue-500" />
              <span className="text-sm">{report.pipeline.movements} moves</span>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <Badge className="bg-green-500 hover:bg-green-500">{report.pipeline.won} won</Badge>
              <Badge variant="destructive">{report.pipeline.lost} lost</Badge>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
  
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between pt-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {dateMode === 'today' ? 'Daily summary' : 'Report'} - {getDateRangeText()}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-2 h-9">
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" className="gap-2 h-9">
            <FileText className="h-4 w-4" />
            Export PDF
          </Button>
        </div>
      </div>
      
      {/* View toggle: Activity Report | Performance vs Targets (elevated roles only) */}
      {isElevated && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={reportView === 'activity' ? 'default' : 'outline'}
            onClick={() => setReportView('activity')}
          >
            Activity Report
          </Button>
          <Button
            size="sm"
            variant={reportView === 'performance' ? 'default' : 'outline'}
            onClick={() => setReportView('performance')}
          >
            <Target className="h-4 w-4 mr-1.5" />
            Performance vs Targets
          </Button>
          {canViewDbManagerReport && (
            <Button
              size="sm"
              variant={reportView === 'database_managers' ? 'default' : 'outline'}
              onClick={() => setReportView('database_managers')}
            >
              <Users className="h-4 w-4 mr-1.5" />
              Database Managers
            </Button>
          )}
        </div>
      )}

      {useGlobalDbReports && canViewDbManagerReport && (
        <p className="text-sm text-muted-foreground">
          Your global database productivity for the selected date range.
        </p>
      )}

      {/* ── Associate: My Performance vs Target ──────────────────────────── */}
      {isAssociate && (
        <Card className="border-none shadow-sm">
          <CardHeader className="pb-3 pt-5 px-6">
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-4 w-4 text-primary" />
              My Performance vs Target
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-5">
            {myPerfLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !myPerfResult ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Unable to load performance data.</p>
            ) : (() => {
              const { actual, target, percentages } = myPerfResult;
              const targetMetrics = myPerfResult.targetConfigured && target
                ? [
                    { label: 'Calls Made', actual: actual.calls, target: target.callsTarget, pct: percentages?.calls, icon: <Phone className="h-4 w-4" />, color: 'text-blue-600', barBase: 'bg-blue-500' },
                    { label: 'Emails Sent', actual: actual.emails, target: target.emailsTarget, pct: percentages?.emails, icon: <Mail className="h-4 w-4" />, color: 'text-purple-600', barBase: 'bg-purple-500' },
                    { label: 'Meetings Scheduled', actual: actual.meetingsScheduled, target: target.meetingScheduleCountTarget, pct: percentages?.meetings, icon: <CalendarIcon className="h-4 w-4" />, color: 'text-teal-600', barBase: 'bg-teal-500' },
                  ].filter((m) => m.target > 0)
                : [];
              const ratioMetrics = [
                { label: 'Tasks', completed: actual.tasks.completed, assigned: actual.tasks.assigned, pct: percentages?.tasks, icon: <CheckSquare className="h-4 w-4" />, color: 'text-green-600', barBase: 'bg-green-500' },
                { label: 'Follow-ups', completed: actual.followUps.completed, assigned: actual.followUps.assigned, pct: percentages?.followUps, icon: <TrendingUp className="h-4 w-4" />, color: 'text-orange-600', barBase: 'bg-orange-500' },
              ];
              if (targetMetrics.length === 0 && ratioMetrics.length === 0) {
                return <p className="text-sm text-muted-foreground py-4 text-center">No activity for this period.</p>;
              }
              return (
                <div className={`grid grid-cols-2 gap-4 ${targetMetrics.length + ratioMetrics.length >= 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
                  {!myPerfResult.targetConfigured && (
                    <p className="col-span-full text-xs text-muted-foreground">Calls, emails, and meeting targets are not configured for your role yet.</p>
                  )}
                  {targetMetrics.map(({ label, actual: a, target: t, pct: p, icon, color }) => {
                    const pctVal = p ?? 0;
                    const pctColorCls = pctVal >= 100 ? 'text-green-600' : pctVal >= 50 ? 'text-amber-600' : 'text-red-500';
                    const barColor = pctVal >= 100 ? 'bg-green-500' : pctVal >= 50 ? 'bg-amber-500' : 'bg-red-500';
                    const fillPct = Math.min(pctVal, 100);
                    return (
                      <div key={label} className="space-y-2">
                        <div className={`flex items-center gap-1.5 ${color}`}>
                          {icon}
                          <span className="text-xs font-medium text-muted-foreground">{label}</span>
                        </div>
                        <div className="flex items-end justify-between">
                          <span className="text-xl font-bold">{a}</span>
                          <span className="text-sm text-muted-foreground mb-0.5">/ {t}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${fillPct}%` }} />
                        </div>
                        <p className={`text-xs font-medium ${pctColorCls}`}>{p !== null ? `${p}%` : '—'}</p>
                      </div>
                    );
                  })}
                  {ratioMetrics.map(({ label, completed, assigned, pct: p, icon, color }) => {
                    const pctVal = p ?? 0;
                    const pctColorCls = assigned <= 0 ? 'text-muted-foreground' : pctVal >= 100 ? 'text-green-600' : pctVal >= 50 ? 'text-amber-600' : 'text-red-500';
                    const barColor = assigned <= 0 ? 'bg-muted' : pctVal >= 100 ? 'bg-green-500' : pctVal >= 50 ? 'bg-amber-500' : 'bg-red-500';
                    const fillPct = Math.min(pctVal, 100);
                    return (
                      <div key={label} className="space-y-2">
                        <div className={`flex items-center gap-1.5 ${color}`}>
                          {icon}
                          <span className="text-xs font-medium text-muted-foreground">{label}</span>
                        </div>
                        <div className="flex items-end justify-between">
                          <span className="text-xl font-bold">{completed}</span>
                          <span className="text-sm text-muted-foreground mb-0.5">/ {assigned}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${fillPct}%` }} />
                        </div>
                        <p className={`text-xs font-medium ${pctColorCls}`}>{assigned > 0 && p !== null ? `${p}%` : '—'}</p>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* ── Conversion Rate summary cards — not for Database Manager (no agency scope) ── */}
      {!useGlobalDbReports && (() => {
        let conversionProps: {
          mode: 'self' | 'user' | 'team';
          userId?: string;
          userName?: string;
          agencyId?: string;
        };

        if (isElevated && selectedAgencyId !== 'all' && selectedUserId !== 'all') {
          const u = agencyUsersMapped.find((x) => x.id === selectedUserId);
          conversionProps = { mode: 'user', userId: selectedUserId, userName: u?.name };
        } else if (isElevated && selectedAgencyId !== 'all') {
          conversionProps = { mode: 'team', agencyId: selectedAgencyId };
        } else if (isElevated) {
          conversionProps = { mode: 'self' };
        } else if (isPureManager && selectedUserId !== 'all') {
          const u = managerTeamUsers.find((x) => x.id === selectedUserId);
          const name = u ? `${u.firstName} ${u.lastName}`.trim() : undefined;
          conversionProps = { mode: 'user', userId: selectedUserId, userName: name };
        } else if (isPureManager) {
          conversionProps = { mode: 'team' };
        } else {
          conversionProps = { mode: 'self' };
        }

        // Bulk email conversion is agency-level only — render it when an
        // agency is selected (single agency view) or for pure managers (who
        // are always scoped to their own agency). In the "All Agencies" /
        // elevated self view, omit it since it would mix agencies.
        const bulkEmailAgencyId =
          isElevated && selectedAgencyId !== 'all' ? selectedAgencyId : undefined;
        const showBulkEmailCard =
          (isElevated && selectedAgencyId !== 'all') || isPureManager || !isElevated;

        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MyConversionRateCard activity="calls" {...conversionProps} startDate={perfStartDate} endDate={perfEndDate} />
            {showBulkEmailCard && (
              <AgencyBulkEmailConversionCard
                agencyId={bulkEmailAgencyId}
                startDate={perfStartDate}
                endDate={perfEndDate}
              />
            )}
          </div>
        );
      })()}

      {/* Agency / Manager / User Tab Bars (elevated roles only) */}
      <StickyHeader zIndex={40}>
        <ScopeFilterBar show={showHierarchyFilters} filterRowProps={filterRowProps} />
      </StickyHeader>

      {/* Filters */}
      <Card className="border-border/60 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-6 items-start">
            {/* Date Range */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Date Range</Label>
              <Select value={dateMode} onValueChange={(v: 'today' | 'custom') => setDateMode(v)}>
                <SelectTrigger className="w-[160px] h-10 bg-muted/40 border-border/60 hover:bg-muted/60 transition-colors">
                  <div className="flex items-center gap-2">
                    <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {dateMode === 'custom' && (
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">Select Dates</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-[280px] h-10 justify-start text-left font-normal bg-muted/40 border-border/60 hover:bg-muted/60 hover:text-foreground transition-colors", !dateRange && "text-muted-foreground")}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                      {dateRange?.from ? (
                        dateRange.to ? (
                          <>{format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}</>
                        ) : format(dateRange.from, "LLL dd, y")
                      ) : <span>Pick a date range</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      initialFocus
                      mode="range"
                      defaultMonth={dateRange?.from}
                      selected={dateRange}
                      onSelect={setDateRange}
                      numberOfMonths={2}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            )}

            {/* Divider */}
            {!isElevated && !useGlobalDbReports && viewableUsers.length > 1 && (
              <div className="hidden sm:block w-px h-10 mt-6 bg-border/60" />
            )}

            {!isElevated && !useGlobalDbReports && viewableUsers.length > 1 && (
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">Users</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[250px] h-10 justify-start text-left font-normal bg-muted/40 border-border/60 hover:bg-muted/60 hover:text-foreground transition-colors">
                      <Users className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span className="truncate">{getSelectedUsersLabel()}</span>
                      {selectedUserIds.length > 1 && (
                        <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px] font-bold rounded-full">
                          {selectedUserIds.length}
                        </Badge>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0" align="start">
                    <div className="px-3 py-2.5 border-b border-border bg-muted/30">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">Select Users</span>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs font-medium text-primary hover:bg-primary/10 hover:text-primary" onClick={selectAllUsers}>Select All</Button>
                          <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs font-medium text-destructive/70 hover:bg-destructive/10 hover:text-destructive" onClick={clearUserSelection}>Clear</Button>
                        </div>
                      </div>
                    </div>
                    <ScrollArea className="h-[260px]">
                      <div className="p-2 space-y-1">
                        {viewableUsers.map(user => (
                          <div
                            key={user.id}
                            className={cn(
                              "flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors",
                              selectedUserIds.includes(user.id)
                                ? "bg-primary/5 hover:bg-primary/10"
                                : "hover:bg-muted/80"
                            )}
                            onClick={() => toggleUserSelection(user.id)}
                          >
                            <Checkbox checked={selectedUserIds.includes(user.id)} className="data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-semibold text-primary">
                                {user.firstName?.[0] || user.name?.[0] || '?'}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate text-foreground">{user.name}</p>
                              <p className="text-[11px] text-muted-foreground">{user.userType}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
              </div>
            )}

            {activeSelectedUsers.length > 1 && !useGlobalDbReports && (
              <>
                <div className="hidden sm:block w-px h-10 mt-6 bg-border/60" />
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">View Mode</Label>
                  <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'combined' | 'individual')}>
                    <TabsList className="h-10 p-1 bg-muted/60">
                      <TabsTrigger value="combined" className="text-xs px-4">Combined</TabsTrigger>
                      <TabsTrigger value="individual" className="text-xs px-4">Per User</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </>
            )}
          </div>

          {!isElevated && !useGlobalDbReports && selectedUserIds.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-border/40">
              <span className="text-xs font-medium text-muted-foreground mr-1">Viewing:</span>
              {selectedUsers.map(user => (
                <Badge key={user.id} variant="secondary" className="gap-1.5 py-1 px-2.5 bg-primary/5 text-primary border border-primary/15 hover:bg-primary/10 transition-colors">
                  <span className="h-4 w-4 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                    <span className="text-[9px] font-bold">{user.firstName?.[0] || user.name?.[0] || '?'}</span>
                  </span>
                  {user.name}
                  <X
                    className="h-3 w-3 cursor-pointer opacity-50 hover:opacity-100 hover:text-destructive transition-opacity"
                    onClick={() => selectedUserIds.length > 1 && setSelectedUserIds(prev => prev.filter(id => id !== user.id))}
                  />
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {canViewDbManagerReport && (useGlobalDbReports || reportView === 'database_managers') && (
        <DatabaseManagerReportSection startDate={perfStartDate} endDate={perfEndDate} />
      )}
      
      {/* ── Activity Report content (agency-scoped roles only) ───────────────── */}
      {reportView === 'activity' && !useGlobalDbReports && (<>

      {/* Loading State — hidden in "All agencies" mode (each section has its own loader) */}
      {reportLoading && !showAgencySections && !showAllTeamView && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-3 text-muted-foreground">Loading report data...</span>
        </div>
      )}

      {/* Error State */}
      {reportError && !reportLoading && !showAllTeamView && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
              <p className="text-sm text-destructive flex-1">{reportError}</p>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={refetch}>
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Refreshing indicator */}
      {refreshing && !showAgencySections && !showAllTeamView && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Updating...
        </div>
      )}

      {/* People sections (All Managers / All Team) */}
      {showAllTeamView && (
        sectionUsers.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-12">
            {showManagerSections
              ? 'No managers / team in this agency'
              : 'No team members in this scope'}
          </p>
        ) : (
          <div className="space-y-5">
            {sectionUsers.map((user, i) => (
              <UserFullReportSection
                key={user.id}
                user={user}
                colorIndex={i}
                dateFrom={effectiveDateFrom}
                dateTo={effectiveDateTo}
                onView={() =>
                  showManagerSections
                    ? setSelectedManagerId(user.id)
                    : setSelectedUserId(user.id)
                }
              />
            ))}
          </div>
        )
      )}

      {/* All-Agencies Sectioned View */}
      {showAgencySections && (
        agenciesLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-3 text-muted-foreground">Loading agencies...</span>
          </div>
        ) : agencies.length === 0 ? (
          <Card className="border-border/40">
            <CardContent className="flex items-center justify-center py-12">
              <p className="text-muted-foreground text-sm">No agencies found</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-5">
            {agencies.map((agency, i) => (
              <AgencyReportSection
                key={agency.id}
                agency={agency}
                colorIndex={i}
                dateFrom={effectiveDateFrom}
                dateTo={effectiveDateTo}
                subCompanyId={currentSubCompany?.id ?? ''}
                onViewDetails={() => setSelectedAgencyId(agency.id)}
                ownerIds={reportOwnerIds}
                scopeKey={`${scopeKey}|${reportOwnerIds?.join(',') ?? ''}`}
              />
            ))}
          </div>
        )
      )}

      {/* Combined View */}
      {!reportLoading && (viewMode === 'combined' || activeSelectedUsers.length === 1) && !showAgencySections && !showAllTeamView && (
        <>
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card>
              <CardContent className="py-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/10">
                    <Phone className="h-5 w-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold leading-none">{combinedTotals.calls}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">Calls Made</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="py-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-500/10">
                    <Mail className="h-5 w-5 text-purple-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold leading-none">{combinedTotals.emails}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">Emails Sent</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="py-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-500/10">
                    <Calendar className="h-5 w-5 text-green-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold leading-none">{combinedTotals.meetingsCompleted}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">Meetings Done</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="py-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-orange-500/10">
                    <CheckSquare className="h-5 w-5 text-orange-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold leading-none">{combinedTotals.tasksCompleted}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">Tasks Done</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="py-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-cyan-500/10">
                    <UserCheck className="h-5 w-5 text-cyan-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold leading-none">{combinedTotals.followUpsCompleted}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">Follow-Ups Done</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="py-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-500/10">
                    <TrendingUp className="h-5 w-5 text-emerald-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold leading-none">{combinedTotals.won}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">Deals Won</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="py-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-teal-500/10">
                    <Target className="h-5 w-5 text-teal-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold leading-none">{combinedTotals.positions}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">Positions Closed</p>
                  </div>
                </div>
              </CardContent>
            </Card>

          </div>
          
          {/* Per-Associate Charts - Show when multiple users selected */}
          {activeSelectedUsers.length > 1 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Calls Chart */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Phone className="h-4 w-4 text-blue-500" />
                    Calls
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                  <div style={{ minWidth: Math.max(480, userReports.length * 65) }}>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      data={userReports.map(r => ({
                        name: r.user.firstName || r.user.name.split(' ')[0],
                        calls: r.calls.total,
                        answered: r.calls.answered,
                      }))}
                      margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis 
                        dataKey="name" 
                        stroke="#6b7280" 
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis 
                        stroke="#6b7280" 
                        fontSize={11}
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
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Bar dataKey="calls" fill="#3b82f6" name="Total Calls" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="answered" fill="#10b981" name="Answered" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  </div></div>
                </CardContent>
              </Card>

              {/* Emails Chart */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Mail className="h-4 w-4 text-purple-500" />
                    Emails
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                  <div style={{ minWidth: Math.max(480, userReports.length * 65) }}>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      data={userReports.map(r => ({
                        name: r.user.firstName || r.user.name.split(' ')[0],
                        emails: r.emails,
                      }))}
                      margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis 
                        dataKey="name" 
                        stroke="#6b7280" 
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis 
                        stroke="#6b7280" 
                        fontSize={11}
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
                      <Bar dataKey="emails" fill="#8b5cf6" name="Emails Sent" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  </div></div>
                </CardContent>
              </Card>

              {/* Meetings Chart */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-green-500" />
                    Meetings
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                  <div style={{ minWidth: Math.max(480, userReports.length * 65) }}>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      data={userReports.map(r => ({
                        name: r.user.firstName || r.user.name.split(' ')[0],
                        total: r.meetings.total,
                        completed: r.meetings.completed,
                      }))}
                      margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis 
                        dataKey="name" 
                        stroke="#6b7280" 
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis 
                        stroke="#6b7280" 
                        fontSize={11}
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
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Bar dataKey="total" fill="#22c55e" name="Scheduled" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="completed" fill="#16a34a" name="Completed" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  </div></div>
                </CardContent>
              </Card>

              {/* Tasks Chart */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <CheckSquare className="h-4 w-4 text-orange-500" />
                    Tasks
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                  <div style={{ minWidth: Math.max(480, userReports.length * 65) }}>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      data={userReports.map(r => ({
                        name: r.user.firstName || r.user.name.split(' ')[0],
                        completed: r.tasks.completed,
                        due: r.tasks.due,
                      }))}
                      margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis 
                        dataKey="name" 
                        stroke="#6b7280" 
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis 
                        stroke="#6b7280" 
                        fontSize={11}
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
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Bar dataKey="completed" fill="#22c55e" name="Completed" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="due" fill="#f97316" name="Due" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  </div></div>
                </CardContent>
              </Card>

              {/* Follow-ups Chart */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-cyan-500" />
                    Follow-Ups
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                  <div style={{ minWidth: Math.max(480, userReports.length * 65) }}>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      data={userReports.map(r => ({
                        name: r.user.firstName || r.user.name.split(' ')[0],
                        completed: r.followUps.completed,
                        due: r.followUps.due,
                      }))}
                      margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis 
                        dataKey="name" 
                        stroke="#6b7280" 
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis 
                        stroke="#6b7280" 
                        fontSize={11}
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
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Bar dataKey="completed" fill="#06b6d4" name="Completed" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="due" fill="#f97316" name="Due" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  </div></div>
                </CardContent>
              </Card>

              {/* Deals Won/Lost Chart */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Target className="h-4 w-4 text-emerald-500" />
                    Deals
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                  <div style={{ minWidth: Math.max(480, userReports.length * 65) }}>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      data={userReports.map(r => ({
                        name: r.user.firstName || r.user.name.split(' ')[0],
                        won: r.pipeline.won,
                        lost: r.pipeline.lost,
                      }))}
                      margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis 
                        dataKey="name" 
                        stroke="#6b7280" 
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis 
                        stroke="#6b7280" 
                        fontSize={11}
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
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Bar dataKey="won" fill="#10b981" name="Won" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="lost" fill="#ef4444" name="Lost" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  </div></div>
                </CardContent>
              </Card>

              {/* Break & Idle Time Chart */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Coffee className="h-4 w-4 text-purple-500" />
                    Break & Idle Time
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                  <div style={{ minWidth: Math.max(480, userReports.length * 65) }}>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      data={userReports.map(r => ({
                        name: r.user.firstName || r.user.name.split(' ')[0],
                        coaching: r.breakTime.coaching,
                        meeting: r.breakTime.meeting,
                        idle: r.idleTime,
                      }))}
                      margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis 
                        dataKey="name" 
                        stroke="#6b7280" 
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis 
                        stroke="#6b7280" 
                        fontSize={11}
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
                        formatter={(value: number) => [`${value}m`, '']}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Bar dataKey="coaching" fill="#8b5cf6" name="Coaching" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="meeting" fill="#22c55e" name="Meeting" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="idle" fill="#f59e0b" name="Idle" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  </div></div>
                </CardContent>
              </Card>
            </div>
          )}
          
          {/* Single User Detail or Comparison Table */}
          {activeSelectedUsers.length === 1 && userReports[0] ? (
            <>
              {/* Detailed Call Performance */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Phone className="h-5 w-5 text-blue-500" />
                    Call Performance
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="p-4 rounded-lg bg-muted/50">
                      <p className="text-sm text-muted-foreground mb-1">Total Calls</p>
                      <p className="text-3xl font-bold">{userReports[0].calls.total}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/50">
                      <p className="text-sm text-muted-foreground mb-1">Answer Rate</p>
                      <p className="text-3xl font-bold">{userReports[0].calls.answerRate}%</p>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/50">
                      <p className="text-sm text-muted-foreground mb-1">Avg Duration</p>
                      <p className="text-3xl font-bold">{Math.round(userReports[0].calls.avgDuration / 60)}m</p>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/50">
                      <p className="text-sm text-muted-foreground mb-1">Total Talk Time</p>
                      <p className="text-3xl font-bold">{Math.round(userReports[0].calls.totalDuration / 60)}m</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">Call Outcomes</h4>
                    <div className="grid grid-cols-4 gap-2">
                      <div className="text-center p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                        <p className="text-2xl font-bold text-green-600">{userReports[0].calls.answered}</p>
                        <p className="text-xs text-muted-foreground">Answered</p>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                        <p className="text-2xl font-bold text-yellow-600">{userReports[0].calls.voicemail}</p>
                        <p className="text-xs text-muted-foreground">Voicemail</p>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-gray-500/10 border border-gray-500/20">
                        <p className="text-2xl font-bold text-gray-600">{userReports[0].calls.noAnswer}</p>
                        <p className="text-xs text-muted-foreground">No Answer</p>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
                        <p className="text-2xl font-bold text-orange-600">{userReports[0].calls.busy}</p>
                        <p className="text-xs text-muted-foreground">Busy</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              {/* Break & Idle Time */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Coffee className="h-5 w-5 text-purple-500" />
                    Break & Idle Time
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 text-center">
                      <p className="text-sm text-muted-foreground mb-1">Coaching</p>
                      <p className="text-3xl font-bold text-blue-600">{userReports[0].breakTime.coaching}m</p>
                    </div>
                    <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20 text-center">
                      <p className="text-sm text-muted-foreground mb-1">Meeting</p>
                      <p className="text-3xl font-bold text-green-600">{userReports[0].breakTime.meeting}m</p>
                    </div>
                    <div className="p-4 rounded-lg bg-purple-500/10 border border-purple-500/20 text-center">
                      <p className="text-sm text-muted-foreground mb-1">Total Break</p>
                      <p className="text-3xl font-bold text-purple-600">{userReports[0].breakTime.total}m</p>
                    </div>
                    <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-center">
                      <p className="text-sm text-muted-foreground mb-1">Idle Time</p>
                      <p className="text-3xl font-bold text-amber-600">{userReports[0].idleTime}m</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              {/* Pipeline Activity */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-emerald-500" />
                    Pipeline Activity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 text-center">
                      <p className="text-sm text-muted-foreground mb-1">Stage Movements</p>
                      <p className="text-3xl font-bold text-blue-600">{userReports[0].pipeline.movements}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20 text-center">
                      <p className="text-sm text-muted-foreground mb-1">Deals Won</p>
                      <p className="text-3xl font-bold text-green-600">{userReports[0].pipeline.won}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-center">
                      <p className="text-sm text-muted-foreground mb-1">Deals Lost</p>
                      <p className="text-3xl font-bold text-red-600">{userReports[0].pipeline.lost}</p>
                    </div>
                  </div>
                  {(userReports[0].pipeline.won + userReports[0].pipeline.lost) > 0 && (
                    <div className="mt-4 p-4 rounded-lg bg-muted/50">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Win Rate</span>
                        <span className="text-2xl font-bold">
                          {Math.round((userReports[0].pipeline.won / (userReports[0].pipeline.won + userReports[0].pipeline.lost)) * 100)}%
                        </span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            /* Comparison Table for Combined View with Multiple Users */
            <Card>
              <CardHeader>
                <CardTitle>Team Comparison</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-3 px-2 font-medium">User</th>
                        <th className="text-center py-3 px-2 font-medium">Calls</th>
                        <th className="text-center py-3 px-2 font-medium">Answer %</th>
                        <th className="text-center py-3 px-2 font-medium">Emails</th>
                        <th className="text-center py-3 px-2 font-medium">Meetings</th>
                        <th className="text-center py-3 px-2 font-medium">Tasks</th>
                        <th className="text-center py-3 px-2 font-medium">Follow-Ups</th>
                        <th className="text-center py-3 px-2 font-medium">Won/Lost</th>
                        <th className="text-center py-3 px-2 font-medium">Positions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userReports.map(report => (
                        <tr key={report.user.id} className="border-b border-border/50 hover:bg-muted/50">
                          <td className="py-3 px-2">
                            <div>
                              <p className="font-medium">{report.user.name}</p>
                              <p className="text-xs text-muted-foreground">{report.user.userType}</p>
                            </div>
                          </td>
                          <td className="text-center py-3 px-2">
                            <span className="font-bold text-blue-500">{report.calls.total}</span>
                          </td>
                          <td className="text-center py-3 px-2">
                            <Badge variant={report.calls.answerRate >= 50 ? "default" : "secondary"}>
                              {report.calls.answerRate}%
                            </Badge>
                          </td>
                          <td className="text-center py-3 px-2">
                            <span className="font-bold text-purple-500">{report.emails}</span>
                          </td>
                          <td className="text-center py-3 px-2">
                            <span className="font-bold text-green-500">{report.meetings.completed}</span>
                          </td>
                          <td className="text-center py-3 px-2">
                            <span className="text-green-500">{report.tasks.completed}</span>
                            <span className="text-muted-foreground mx-1">/</span>
                            <span className="text-orange-500">{report.tasks.due}</span>
                          </td>
                          <td className="text-center py-3 px-2">
                            <span className="text-green-500">{report.followUps.completed}</span>
                            <span className="text-muted-foreground mx-1">/</span>
                            <span className="text-orange-500">{report.followUps.due}</span>
                          </td>
                          <td className="text-center py-3 px-2">
                            <Badge className="bg-green-500 hover:bg-green-500 mr-1">{report.pipeline.won}</Badge>
                            <Badge variant="destructive">{report.pipeline.lost}</Badge>
                          </td>
                          <td className="text-center py-3 px-2 font-bold text-teal-600">{report.positionsClosed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
      
      {/* Individual User Cards View */}
      {!reportLoading && viewMode === 'individual' && activeSelectedUsers.length > 1 && !showAgencySections && !showAllTeamView && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {userReports.map(report => (
            <UserReportCard key={report.user.id} report={report} />
          ))}
        </div>
      )}

      </>)} {/* end reportView === 'activity' */}

      {/* ── Performance vs Targets view ───────────────────────────────────── */}
      {reportView === 'performance' && isElevated && (
        <PerformanceReportView
          loading={perfReportLoading}
          error={perfReportError}
          results={perfReport}
          onRetry={() => {
            setPerfReportLoading(true);
            setPerfReportError(null);
            const agencyIds = selectedAgencyId !== 'all' ? [selectedAgencyId] : undefined;
            fetchPerformanceReport({
              startDate: perfStartDate,
              endDate: perfEndDate,
              agencyIds,
              userIds: reportOwnerIds,
            })
              .then(setPerfReport)
              .catch((err: Error) => setPerfReportError(err.message ?? 'Failed to load'))
              .finally(() => setPerfReportLoading(false));
          }}
        />
      )}

      {/* ── Conversion Rates view ──────────────────────────────────────────── */}
      {reportView === 'conversion' && (isElevated || canViewTeam) && (
        <ConversionRatesView
          loading={convReportLoading}
          error={convReportError}
          results={convReport}
          onRetry={() => {
            setConvReportLoading(true);
            setConvReportError(null);
            const agencyIds = isElevated && selectedAgencyId !== 'all' ? [selectedAgencyId] : undefined;
            fetchConversionRates({
              startDate: perfStartDate,
              endDate: perfEndDate,
              agencyIds,
              userIds: reportOwnerIds,
            })
              .then(setConvReport)
              .catch((err: Error) => setConvReportError(err.message ?? 'Failed to load'))
              .finally(() => setConvReportLoading(false));
          }}
        />
      )}

    </div>
  );
}

/** Routes recruitment roles / recruitment workspace to live reports; otherwise sales. */
export default function Reports() {
  const isRecruitmentManager = useIsRecruitmentManagerRole();
  const isSeniorRecruiter = useIsSeniorRecruiterRole();
  const isRecruiter = useIsRecruiterRole();
  const { side: activeWorkspaceSide, canSwitch: canSwitchWorkspaceSides } = useActiveSide();

  const isRecruitmentContext =
    isRecruitmentManager ||
    isSeniorRecruiter ||
    isRecruiter ||
    (canSwitchWorkspaceSides && activeWorkspaceSide === 'recruitment');

  if (!isRecruitmentContext) {
    return <SalesReports />;
  }

  if (isRecruiter) {
    return <RecruiterReport />;
  }
  if (isSeniorRecruiter) {
    return <RecruiterReport senior />;
  }
  return <RecruitmentManagerReport />;
}
