import { useState, useEffect, useMemo } from 'react';
import { NoticeBar } from './NoticeBar';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Users, Phone, Mail,
  Building2, TrendingUp, Target, Trophy, XCircle,
  BarChart3, PieChart, ArrowUpRight, ArrowDownRight, Minus, Calendar, CalendarIcon,
  Loader2,
} from 'lucide-react';
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth } from 'date-fns';
import { DateRange } from 'react-day-picker';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart as RechartsPieChart, Pie, Cell, LineChart, Line, LabelList,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { fetchDirectorStats, DirectorStatsPeriod, DirectorStatsDivision } from '@/lib/api';
import { getSocket } from '@/lib/socket';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
const QUERY_KEY = 'director-stats';

// ── Trend indicator ─────────────────────────────────────────────────────────
function TrendBadge({ trend, value }: { trend: DirectorStatsDivision['trend']; value: number }) {
  if (trend === 'neutral' || value === 0) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" />
        0% vs last month
      </span>
    );
  }
  if (trend === 'up') {
    return (
      <span className="flex items-center gap-1 text-xs text-green-600">
        <ArrowUpRight className="h-3 w-3" />
        +{value}% vs last month
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-red-600">
      <ArrowDownRight className="h-3 w-3" />
      {value}% vs last month
    </span>
  );
}

export default function DirectorDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [period, setPeriod] = useState<DirectorStatsPeriod>('month');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const now = new Date();
    return { from: startOfMonth(now), to: endOfMonth(now) };
  });

  // Stable query params — only include from/to when period=custom
  const queryParams = useMemo(() => {
    if (period === 'custom') {
      return {
        period,
        from: dateRange?.from ? startOfDay(dateRange.from).toISOString() : undefined,
        to: dateRange?.to ? endOfDay(dateRange.to).toISOString() : undefined,
      };
    }
    return { period };
  }, [period, dateRange]);

  // Stable query key — dateRange only participates when period=custom
  const queryKey = useMemo(() => {
    if (period === 'custom') {
      return [QUERY_KEY, period, dateRange?.from?.toISOString(), dateRange?.to?.toISOString()];
    }
    return [QUERY_KEY, period];
  }, [period, dateRange]);

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => fetchDirectorStats(queryParams),
    staleTime: 30_000,
    refetchInterval: 120_000,
  });

  // Real-time refresh on socket events
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const invalidate = () => queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    socket.on('lead:refresh', invalidate);
    socket.on('meeting:refresh', invalidate);
    socket.on('call:refresh', invalidate);
    socket.on('followup:refresh', invalidate);
    return () => {
      socket.off('lead:refresh', invalidate);
      socket.off('meeting:refresh', invalidate);
      socket.off('call:refresh', invalidate);
      socket.off('followup:refresh', invalidate);
    };
  }, [queryClient]);

  // ── Derived display data ─────────────────────────────────────────────────

  const subCompanies = data?.subCompanies ?? [];
  const globalOverview = data?.overview ?? {
    totalClients: 0, activeClients: 0,
    wonLeads: 0, lostLeads: 0,
    totalUsers: 0, activeUsers: 0,
    conversionRate: 0,
    periodWonLeads: 0, periodLostLeads: 0,
  };
  const allDivisions = data?.divisions ?? [];
  const allMonthlyTrend = data?.monthlyTrend ?? [];

  // ── Chart data — all scoped to allDivisions ──────────────────────────

  // "Deals Won vs Lost" uses PERIOD-FILTERED counts so it responds to Today/Month/Year
  const conversionsChartData = allDivisions.map((d) => ({
    name: d.name,
    won: d.periodWonLeads,
    lost: d.periodLostLeads,
  }));

  const conversionRateData = allDivisions.map((d) => ({
    name: d.name,
    rate: d.conversionRate,
  }));

  const activityChartData = allDivisions.map((d) => ({
    name: d.name,
    calls: d.calls,
    emails: d.emails,
    meetings: d.meetings,
  }));

  const leadDistributionData = allDivisions.map((d, i) => ({
    name: d.name,
    value: d.totalLeads,
    color: COLORS[i % COLORS.length],
  }));

  const teamPerformanceData = allDivisions.map((d) => ({
    name: d.name,
    teamSize: d.teamSize,
    leadsPerUser: d.teamSize > 0 ? Math.round(d.totalLeads / d.teamSize) : 0,
    callsPerUser: d.teamSize > 0 ? Math.round(d.calls / d.teamSize) : 0,
  }));

  // ── Loading / Error ──────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading dashboard…</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-destructive">
        <XCircle className="h-5 w-5" />
        <span>Failed to load dashboard data. Please refresh.</span>
      </div>
    );
  }

  const periodLabel = period === 'today' ? 'Today'
    : period === 'year' ? 'This Year'
    : period === 'custom' ? 'Custom Range'
    : 'This Month';

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={period} onValueChange={(v) => setPeriod(v as DirectorStatsPeriod)}>
            <TabsList>
              <TabsTrigger value="today">Today</TabsTrigger>
              <TabsTrigger value="month">This Month</TabsTrigger>
              <TabsTrigger value="year">This Year</TabsTrigger>
              <TabsTrigger value="custom">Custom</TabsTrigger>
            </TabsList>
          </Tabs>

          {period === 'custom' && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn('justify-start text-left font-normal', !dateRange && 'text-muted-foreground')}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange?.from
                    ? dateRange.to
                      ? <>{format(dateRange.from, 'LLL dd, y')} – {format(dateRange.to, 'LLL dd, y')}</>
                      : format(dateRange.from, 'LLL dd, y')
                    : <span>Pick dates</span>}
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
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          )}
        </div>

        <Button variant="outline" onClick={() => navigate('/reports')}>
          <BarChart3 className="h-4 w-4 mr-2" />
          View Reports
        </Button>
      </div>

      {/* ── KPI Summary Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyan-500/10">
                <Building2 className="h-5 w-5 text-cyan-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Clients</p>
                <div className="flex items-center gap-3 mt-1">
                  <div>
                    <p className="text-xl font-bold">{globalOverview.totalClients}</p>
                    <p className="text-[10px] text-muted-foreground">Total</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold text-green-600">{globalOverview.activeClients}</p>
                    <p className="text-[10px] text-muted-foreground">Active</p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <TrendingUp className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Leads ({ period === 'today' ? 'Today' : period === 'month' ? 'This Month' : period === 'year' ? 'This Year' : 'Custom' })</p>
                <div className="flex items-center gap-3 mt-1">
                  <div>
                    <p className="text-xl font-bold text-green-600">{globalOverview.periodWonLeads}</p>
                    <p className="text-[10px] text-muted-foreground">Won</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold text-red-600">{globalOverview.periodLostLeads}</p>
                    <p className="text-[10px] text-muted-foreground">Lost</p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <Target className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Conversion Rate</p>
                <p className="text-2xl font-bold">
                  {globalOverview.periodWonLeads + globalOverview.periodLostLeads > 0
                    ? Math.round((globalOverview.periodWonLeads / (globalOverview.periodWonLeads + globalOverview.periodLostLeads)) * 100)
                    : 0}%
                </p>
                <p className="text-[10px] text-muted-foreground">{ period === 'today' ? 'Today' : period === 'month' ? 'This Month' : period === 'year' ? 'This Year' : 'Custom range' }</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Users className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Users</p>
                <div className="flex items-center gap-3 mt-1">
                  <div>
                    <p className="text-xl font-bold">{globalOverview.totalUsers}</p>
                    <p className="text-[10px] text-muted-foreground">Total</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold text-green-600">{globalOverview.activeUsers}</p>
                    <p className="text-[10px] text-muted-foreground">Active</p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <NoticeBar />

      {/* ── Division Performance Cards ── */}
      {allDivisions.length > 0 && (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
          {allDivisions.map((div) => (
            <Card
              key={div.id}
              className="transition-shadow hover:shadow-md"
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    {div.name}
                  </CardTitle>
                  <TrendBadge trend={div.trend} value={div.trendValue} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 rounded-lg bg-green-500/10">
                    <p className="text-lg font-bold text-green-600">{div.wonLeads}</p>
                    <p className="text-[10px] text-muted-foreground">Won</p>
                  </div>
                  <div className="p-2 rounded-lg bg-red-500/10">
                    <p className="text-lg font-bold text-red-600">{div.lostLeads}</p>
                    <p className="text-[10px] text-muted-foreground">Lost</p>
                  </div>
                  <div className="p-2 rounded-lg bg-blue-500/10">
                    <p className="text-lg font-bold text-blue-600">{div.activeLeads}</p>
                    <p className="text-[10px] text-muted-foreground">Active</p>
                  </div>
                </div>

                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Conversion Rate</span>
                  <span className="font-medium">{div.conversionRate}%</span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="flex items-center gap-1">
                    <Phone className="h-3 w-3 text-blue-500" />
                    <span>{div.calls} calls</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Mail className="h-3 w-3 text-purple-500" />
                    <span>{div.emails} emails</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3 w-3 text-green-500" />
                    <span>{div.meetings} mtgs</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                  <span>{div.teamSize} active · {div.totalUsers} total members</span>
                  <Badge variant="outline">{div.totalLeads} total leads</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Charts Row 1: Deals Won/Lost + Conversion Rate ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="h-4 w-4 text-green-500" />
              Deals Won vs Lost
              <span className="text-xs font-normal text-muted-foreground ml-1">({periodLabel})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {conversionsChartData.every((d) => d.won === 0 && d.lost === 0) ? (
              <div className="flex items-center justify-center h-[250px] text-sm text-muted-foreground">
                No closed deals in this period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={conversionsChartData} margin={{ top: 18, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Bar dataKey="won" fill="#10b981" name="Won" radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="won" position="top" style={{ fontSize: 10, fill: '#10b981', fontWeight: 600 }} formatter={(v: number) => v > 0 ? v : ''} />
                  </Bar>
                  <Bar dataKey="lost" fill="#ef4444" name="Lost" radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="lost" position="top" style={{ fontSize: 10, fill: '#ef4444', fontWeight: 600 }} formatter={(v: number) => v > 0 ? v : ''} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}

            {/* Per-agency breakdown */}
            <div className="mt-3 space-y-1.5 border-t pt-3">
              {conversionsChartData.map((d) => (
                <div key={d.name} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground truncate max-w-[140px]" title={d.name}>{d.name}</span>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 text-green-600 font-medium">
                      <Trophy className="h-3 w-3" />{d.won} won
                    </span>
                    <span className="flex items-center gap-1 text-red-600 font-medium">
                      <XCircle className="h-3 w-3" />{d.lost} lost
                    </span>
                  </div>
                </div>
              ))}
              {conversionsChartData.length > 1 && (
                <div className="flex items-center justify-between text-xs font-semibold border-t pt-1.5 mt-1">
                  <span>Total</span>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 text-green-600">
                      <Trophy className="h-3 w-3" />{conversionsChartData.reduce((s, d) => s + d.won, 0)} won
                    </span>
                    <span className="flex items-center gap-1 text-red-600">
                      <XCircle className="h-3 w-3" />{conversionsChartData.reduce((s, d) => s + d.lost, 0)} lost
                    </span>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-purple-500" />
              Conversion Rate
              <span className="text-xs font-normal text-muted-foreground ml-1">(All Time)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={conversionRateData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} />
                <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }} formatter={(value: number) => [`${value}%`, 'Rate']} />
                <Bar dataKey="rate" fill="#8b5cf6" name="Conversion Rate" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* ── Charts Row 2: Activity + Lead Distribution + Team Performance ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Phone className="h-4 w-4 text-blue-500" />
              Activity
              <span className="text-xs font-normal text-muted-foreground ml-1">({periodLabel})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={activityChartData} margin={{ top: 18, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="calls" fill="#3b82f6" name="Calls" radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="calls" position="top" style={{ fontSize: 10, fill: '#3b82f6', fontWeight: 600 }} formatter={(v: number) => v > 0 ? v : ''} />
                </Bar>
                <Bar dataKey="emails" fill="#8b5cf6" name="Emails" radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="emails" position="top" style={{ fontSize: 10, fill: '#8b5cf6', fontWeight: 600 }} formatter={(v: number) => v > 0 ? v : ''} />
                </Bar>
                <Bar dataKey="meetings" fill="#22c55e" name="Meetings" radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="meetings" position="top" style={{ fontSize: 10, fill: '#22c55e', fontWeight: 600 }} formatter={(v: number) => v > 0 ? v : ''} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Per-agency breakdown */}
            <div className="mt-3 space-y-1.5 border-t pt-3">
              {activityChartData.map((d) => (
                <div key={d.name} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground truncate max-w-[110px]" title={d.name}>{d.name}</span>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 text-blue-600 font-medium">
                      <Phone className="h-3 w-3" />{d.calls}
                    </span>
                    <span className="flex items-center gap-1 text-purple-600 font-medium">
                      <Mail className="h-3 w-3" />{d.emails}
                    </span>
                    <span className="flex items-center gap-1 text-green-600 font-medium">
                      <Calendar className="h-3 w-3" />{d.meetings}
                    </span>
                  </div>
                </div>
              ))}
              {activityChartData.length > 1 && (
                <div className="flex items-center justify-between text-xs font-semibold border-t pt-1.5 mt-1">
                  <span>Total</span>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 text-blue-600">
                      <Phone className="h-3 w-3" />{activityChartData.reduce((s, d) => s + d.calls, 0)}
                    </span>
                    <span className="flex items-center gap-1 text-purple-600">
                      <Mail className="h-3 w-3" />{activityChartData.reduce((s, d) => s + d.emails, 0)}
                    </span>
                    <span className="flex items-center gap-1 text-green-600">
                      <Calendar className="h-3 w-3" />{activityChartData.reduce((s, d) => s + d.meetings, 0)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <PieChart className="h-4 w-4 text-cyan-500" />
              Lead Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {leadDistributionData.length === 0 ? (
              <div className="flex items-center justify-center h-[220px] text-sm text-muted-foreground">
                No lead data
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <RechartsPieChart>
                  <Pie
                    data={leadDistributionData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) =>
                      percent > 0.04 ? `${name} (${(percent * 100).toFixed(0)}%)` : ''
                    }
                    labelLine={false}
                  >
                    {leadDistributionData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </RechartsPieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-amber-500" />
              Team Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={teamPerformanceData} margin={{ top: 18, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="leadsPerUser" fill="#f59e0b" name="Leads/User" radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="leadsPerUser" position="top" style={{ fontSize: 10, fill: '#f59e0b', fontWeight: 600 }} formatter={(v: number) => v > 0 ? v : ''} />
                </Bar>
                <Bar dataKey="callsPerUser" fill="#06b6d4" name="Calls/User" radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="callsPerUser" position="top" style={{ fontSize: 10, fill: '#06b6d4', fontWeight: 600 }} formatter={(v: number) => v > 0 ? v : ''} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Per-agency breakdown */}
            <div className="mt-3 space-y-1.5 border-t pt-3">
              {teamPerformanceData.map((d) => (
                <div key={d.name} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground truncate max-w-[110px]" title={d.name}>{d.name}</span>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 text-amber-600 font-medium">
                      <TrendingUp className="h-3 w-3" />{d.leadsPerUser} leads/user
                    </span>
                    <span className="flex items-center gap-1 text-cyan-600 font-medium">
                      <Phone className="h-3 w-3" />{d.callsPerUser} calls/user
                    </span>
                  </div>
                </div>
              ))}
              {teamPerformanceData.length > 1 && (
                <div className="flex items-center justify-between text-xs font-semibold border-t pt-1.5 mt-1">
                  <span>Avg</span>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 text-amber-600">
                      <TrendingUp className="h-3 w-3" />
                      {Math.round(teamPerformanceData.reduce((s, d) => s + d.leadsPerUser, 0) / teamPerformanceData.length)} leads/user
                    </span>
                    <span className="flex items-center gap-1 text-cyan-600">
                      <Phone className="h-3 w-3" />
                      {Math.round(teamPerformanceData.reduce((s, d) => s + d.callsPerUser, 0) / teamPerformanceData.length)} calls/user
                    </span>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Wins Trend — Last 6 Months (always fixed window) ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-500" />
            Wins Trend
            <span className="text-xs font-normal text-muted-foreground ml-1">(Last 6 Months)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {subCompanies.length === 0 ? (
            <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
              No division data
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={allMonthlyTrend} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month" stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                {subCompanies.map((sc, index) => (
                  <Line
                    key={sc.id}
                    type="monotone"
                    dataKey={sc.name}
                    stroke={COLORS[index % COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
