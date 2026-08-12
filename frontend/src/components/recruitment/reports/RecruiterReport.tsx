/**
 * Live Recruiter / Senior Recruiter report — GET /dashboard/recruitment-report?mine=1.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Briefcase,
  Users,
  UserCheck,
  Clock,
  Target,
  Calendar as CalendarIcon,
  Loader2,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  fetchRecruitmentReport,
  type ReportRangeDays,
} from '@/lib/recruitmentReportsApi';

const PIE_COLORS = ['#3b82f6', '#10b981', '#94a3b8', '#f59e0b'];

const JOB_STATUS_CLASS: Record<string, string> = {
  open: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  draft: 'bg-slate-50 text-slate-700 border-slate-200',
  closed: 'bg-gray-100 text-gray-600 border-gray-200',
  filled: 'bg-blue-50 text-blue-700 border-blue-200',
};

const JOB_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  closed: 'Closed',
  filled: 'Filled',
};

const RANGE_LABEL: Record<ReportRangeDays, string> = {
  30: 'Last 30 days',
  90: 'Last 90 days',
  180: 'Last 180 days',
};

const KPI_ICONS = [Briefcase, Clock, UserCheck, Users, Target] as const;

type Props = { senior?: boolean };

export default function RecruiterReport({ senior = false }: Props) {
  const [days, setDays] = useState<ReportRangeDays>(180);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['recruitment-report', 'mine', days],
    queryFn: () => fetchRecruitmentReport({ mine: true, days }),
    staleTime: 30_000,
  });

  const title = senior ? 'Senior Recruiter Reports' : 'Recruiter Reports';

  const kpiCards = data
    ? [
        { label: 'My Open Jobs', value: data.kpis.openJobs, hint: 'Currently open' },
        {
          label: 'Pending Requests',
          value: data.kpis.pendingRequests,
          hint: 'Client placements awaiting approval',
        },
        {
          label: 'Active Placements',
          value: data.kpis.activePlacements,
          hint: 'Live assignments',
        },
        {
          label: 'Approved in Period',
          value: data.kpis.placementsApprovedInRange,
          hint: RANGE_LABEL[days],
        },
        {
          label: 'With Matches',
          value: data.kpis.employeesWithMatches,
          hint: `${data.kpis.availableMasters} available Masters`,
        },
      ]
    : [];

  const jobsPie = (data?.jobsByStatus ?? []).map((s) => ({
    name: JOB_STATUS_LABEL[s.status] ?? s.status,
    value: s.count,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between pt-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Personal recruitment analytics for {RANGE_LABEL[days].toLowerCase()}.
          </p>
        </div>
        <Select
          value={String(days)}
          onValueChange={(v) => setDays(Number(v) as ReportRangeDays)}
        >
          <SelectTrigger className="w-[180px] h-9">
            <CalendarIcon className="h-4 w-4 mr-2 shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {([30, 90, 180] as ReportRangeDays[]).map((d) => (
              <SelectItem key={d} value={String(d)}>
                {RANGE_LABEL[d]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading report…
        </div>
      )}

      {isError && (
        <Card className="border-none shadow-sm">
          <CardContent className="p-5 text-sm text-destructive">
            Failed to load recruitment report. Please try again.
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {kpiCards.map((kpi, i) => {
              const Icon = KPI_ICONS[i] ?? Briefcase;
              return (
                <Card key={kpi.label} className="border-none shadow-sm">
                  <CardContent className="p-5 flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">{kpi.label}</p>
                      <p className="text-3xl font-bold mt-1">{kpi.value}</p>
                      <p className="text-xs text-muted-foreground mt-1">{kpi.hint}</p>
                    </div>
                    <Icon className="h-5 w-5 text-muted-foreground" />
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Jobs by status</CardTitle>
                <CardDescription>Your job orders</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={jobsPie}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={48}
                        outerRadius={80}
                        paddingAngle={2}
                      >
                        {jobsPie.map((_, i) => (
                          <Cell
                            key={jobsPie[i]!.name}
                            fill={PIE_COLORS[i % PIE_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Placements in period</CardTitle>
                <CardDescription>Approved vs ended</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.monthlyPlacements}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="approved"
                        stroke="#10b981"
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="ended"
                        stroke="#f59e0b"
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Jobs performance</CardTitle>
              <CardDescription>Open reqs on your desk</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {data.myJobs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No jobs on your desk yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="pb-2 font-medium">Title</th>
                      <th className="pb-2 font-medium">Client</th>
                      <th className="pb-2 font-medium">Open seats</th>
                      <th className="pb-2 font-medium">Filled</th>
                      <th className="pb-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.myJobs.map((job) => (
                      <tr key={job.id} className="border-b last:border-0">
                        <td className="py-3 font-medium">{job.title}</td>
                        <td className="py-3">{job.company}</td>
                        <td className="py-3">{job.openPositions}</td>
                        <td className="py-3">{job.filledPositions}</td>
                        <td className="py-3">
                          <Badge
                            variant="outline"
                            className={JOB_STATUS_CLASS[job.status] ?? ''}
                          >
                            {job.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Monthly job orders</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.monthlyJobOrders}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="opened" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="closed" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
