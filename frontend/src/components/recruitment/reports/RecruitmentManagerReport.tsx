/**
 * Live Recruitment Manager report — GET /dashboard/recruitment-report.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calendar as CalendarIcon, Loader2 } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useStore } from '@/lib/store';
import {
  fetchRecruitmentReport,
  type ReportRangeDays,
} from '@/lib/recruitmentReportsApi';

const PIE_COLORS = ['#3b82f6', '#10b981', '#94a3b8', '#f59e0b', '#8b5cf6'];

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

const RANGE_OPTIONS: ReportRangeDays[] = [30, 90, 180];

export default function RecruitmentManagerReport() {
  const { currentSubCompany } = useStore();
  const [days, setDays] = useState<ReportRangeDays>(180);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['recruitment-report', 'team', days],
    queryFn: () => fetchRecruitmentReport({ days }),
    staleTime: 30_000,
  });

  const kpis = data
    ? [
        { label: 'Open Jobs', value: data.kpis.openJobs },
        {
          label: 'Positions Filled',
          value: `${data.kpis.filledPositions}/${data.kpis.totalPositions}`,
        },
        { label: 'Active Placements', value: data.kpis.activePlacements },
        {
          label: 'Approved in Period',
          value: data.kpis.placementsApprovedInRange,
        },
        { label: 'Available Masters', value: data.kpis.availableMasters },
        { label: 'With Matches', value: data.kpis.employeesWithMatches },
        { label: 'Jobs w/ 0 Matches', value: data.kpis.jobsWithZeroMatches },
        {
          label: 'Pending Approvals',
          value: data.kpis.pendingRequests + data.kpis.employeesPendingApproval,
        },
      ]
    : [];

  const jobsPie = (data?.jobsByStatus ?? []).map((s) => ({
    name: JOB_STATUS_LABEL[s.status] ?? s.status,
    value: s.count,
  }));

  const matchingBar = data
    ? [
        { stage: 'With matches', count: data.kpis.employeesWithMatches },
        { stage: 'Zero matches', count: data.kpis.employeesWithZeroMatches },
        { stage: 'Jobs needing fill', count: data.kpis.openJobsNeedingFill },
        { stage: 'Jobs w/ 0 matches', count: data.kpis.jobsWithZeroMatches },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between pt-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Recruitment Reports
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Team analytics
            {currentSubCompany?.name ? ` for ${currentSubCompany.name}` : ''}.
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
            {RANGE_OPTIONS.map((d) => (
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {kpis.map((kpi) => (
              <Card key={kpi.label} className="border-none shadow-sm">
                <CardContent className="p-5">
                  <p className="text-sm font-medium text-muted-foreground">{kpi.label}</p>
                  <p className="text-3xl font-bold mt-1">{kpi.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Jobs by status</CardTitle>
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
                <CardTitle className="text-base">Matching summary</CardTitle>
                <CardDescription>Available Masters vs open jobs</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={matchingBar}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="stage" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Monthly job orders</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
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
              <CardTitle className="text-base">Recruiter workload</CardTitle>
              <CardDescription>Pending client requests and active placements</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {data.recruiterWorkload.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No recruiter activity yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="pb-2 font-medium">Recruiter</th>
                      <th className="pb-2 font-medium">Pending requests</th>
                      <th className="pb-2 font-medium">Active placements</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recruiterWorkload.map((r) => (
                      <tr key={r.userId} className="border-b last:border-0">
                        <td className="py-3 font-medium">{r.name}</td>
                        <td className="py-3">{r.pendingRequests}</td>
                        <td className="py-3">{r.activePlacements}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
