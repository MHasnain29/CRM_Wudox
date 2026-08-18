/**
 * Live Recruiter dashboard — personal view fed by
 * GET /dashboard/recruitment?mine=1 plus the jobs list for "My Jobs".
 */
import { useMemo } from 'react';
import { NoticeBar } from './NoticeBar';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow, parseISO } from 'date-fns';
import {
  Briefcase,
  Clock,
  UserCheck,
  Users,
  BarChart3,
  Loader2,
  Target,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useStore } from '@/lib/store';
import { fetchJobs } from '@/lib/jobsApi';
import { fetchRecruitmentDashboard } from '@/lib/recruitmentDashboardApi';
import { PendingSigningsWidget } from '@/components/dashboard/PendingSigningsWidget';

const JOB_STATUS_CLASS: Record<string, string> = {
  open: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  draft: 'bg-slate-50 text-slate-700 border-slate-200',
  closed: 'bg-gray-100 text-gray-600 border-gray-200',
  filled: 'bg-blue-50 text-blue-700 border-blue-200',
};

const ACTIVITY_LABEL: Record<string, string> = {
  submitted: 'requested',
  approved: 'approved',
  rejected: 'rejected',
  ended: 'ended',
};

export default function RecruiterDashboard() {
  const { currentUser, currentSubCompany } = useStore();
  const navigate = useNavigate();
  const name = currentUser?.firstName || currentUser?.name || 'Recruiter';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['recruitment-dashboard', 'mine'],
    queryFn: () => fetchRecruitmentDashboard({ mine: true }),
    staleTime: 30_000,
  });

  const { data: jobsResult } = useQuery({
    queryKey: ['recruiter-my-jobs'],
    queryFn: () => fetchJobs({ pageSize: 100 }),
    staleTime: 30_000,
  });

  const myJobs = useMemo(() => {
    if (!jobsResult || !currentUser?.id) return [];
    return jobsResult.data.filter((j) => j.createdById === currentUser.id);
  }, [jobsResult, currentUser?.id]);

  const kpiCards = data
    ? [
        { label: 'My Open Jobs', value: data.kpis.openJobs, icon: Briefcase, tone: 'bg-blue-500/10 text-blue-600' },
        { label: 'Pending Client Placements', value: data.kpis.pendingRequests, icon: Clock, tone: 'bg-amber-500/10 text-amber-600' },
        { label: 'Active Placements', value: data.kpis.activePlacements, icon: UserCheck, tone: 'bg-green-500/10 text-green-600' },
        {
          label: 'Positions Filled',
          value: `${data.kpis.filledPositions}/${data.kpis.totalPositions}`,
          icon: Users,
          tone: 'bg-emerald-500/10 text-emerald-600',
        },
        {
          label: 'Available Masters',
          value: data.kpis.availableMasters,
          icon: Users,
          tone: 'bg-slate-500/10 text-slate-600',
        },
        {
          label: 'With Matches',
          value: data.kpis.employeesWithMatches,
          icon: Target,
          tone: 'bg-teal-500/10 text-teal-600',
        },
      ]
    : [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading dashboard…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Recruiter Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Welcome back, {name}.{currentSubCompany ? ` Your desk at ${currentSubCompany.name}.` : ''}
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate('/reports')}>
          <BarChart3 className="h-4 w-4 mr-2" />
          View Reports
        </Button>
      </div>

      <NoticeBar />

      {isError && (
        <Card className="border-none shadow-sm">
          <CardContent className="p-5 text-sm text-destructive">
            Failed to load dashboard data. Please refresh the page.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {kpiCards.map((kpi) => (
          <Card key={kpi.label} className="border-none shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{kpi.label}</p>
                  <p className="text-3xl font-bold mt-1">{kpi.value}</p>
                </div>
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${kpi.tone}`}>
                  <kpi.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="border-none shadow-sm xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base">My Jobs</CardTitle>
              <CardDescription>Openings you created</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/jobs')}>
              View all
            </Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {myJobs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">You haven't created any jobs yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="pb-2 font-medium">Title</th>
                    <th className="pb-2 font-medium">Client</th>
                    <th className="pb-2 font-medium">Filled</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {myJobs.slice(0, 8).map((job) => (
                    <tr
                      key={job.id}
                      className="border-b last:border-0 cursor-pointer hover:bg-muted/40"
                      onClick={() => navigate('/jobs')}
                    >
                      <td className="py-3 font-medium">{job.title}</td>
                      <td className="py-3">{job.company}</td>
                      <td className="py-3">
                        {job.filledPositions}/{job.openPositions}
                      </td>
                      <td className="py-3">
                        <Badge variant="outline" className={JOB_STATUS_CLASS[job.status] ?? ''}>
                          {job.status}
                        </Badge>
                      </td>
                      <td className="py-3 text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(job.updatedAt, { addSuffix: true })}
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
            <CardTitle className="text-base">Recent Activity</CardTitle>
            <CardDescription>Your latest placement updates</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(data?.recentActivity ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent activity.</p>
            ) : (
              data!.recentActivity.map((a) => (
                <div
                  key={a.id}
                  className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5"
                >
                  <p className="text-sm">
                    <span className="font-medium">{a.employeeName}</span>{' '}
                    {ACTIVITY_LABEL[a.type] ?? a.type} — {a.targetLabel}
                  </p>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(parseISO(a.at), { addSuffix: true })}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-base">My Pending Requests</CardTitle>
            <CardDescription>Client placement requests awaiting manager approval</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/employees')}>
            Employees
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {(data?.pendingAssignmentRequests ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No pending requests.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="pb-2 font-medium">Employee</th>
                  <th className="pb-2 font-medium">Target</th>
                  <th className="pb-2 font-medium">Role</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {data!.pendingAssignmentRequests.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-3 font-medium">{r.employeeName}</td>
                    <td className="py-3">{r.jobTitle ?? r.clientName ?? '—'}</td>
                    <td className="py-3">
                      {r.targetType === 'job' ? (r.isBackup ? 'Backup' : 'Primary') : 'Client placement'}
                    </td>
                    <td className="py-3">
                      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                        pending
                      </Badge>
                    </td>
                    <td className="py-3 text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(parseISO(r.submittedAt), { addSuffix: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <PendingSigningsWidget items={data?.pendingSignings ?? []} />
    </div>
  );
}
