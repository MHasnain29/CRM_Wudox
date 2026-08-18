/**
 * Live Recruitment Manager dashboard — fed by GET /dashboard/recruitment.
 * Same layout as the demo dashboard, but with real KPIs, working
 * approve/reject actions and live charts.
 */
import { useMemo, useState } from 'react';
import { NoticeBar } from './NoticeBar';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatDistanceToNow, parseISO } from 'date-fns';
import {
  Briefcase,
  FolderOpen,
  Users,
  Building2,
  UserCheck,
  Clock,
  CheckCircle2,
  XCircle,
  Eye,
  BarChart3,
  Loader2,
  Target,
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
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useStore } from '@/lib/store';
import { useHasPermission } from '@/lib/access';
import { postApprovalAction, approveEmployee, rejectEmployee } from '@/lib/api';
import {
  fetchRecruitmentDashboard,
  type PendingAssignmentRequest,
  type PendingEmployeeApproval,
} from '@/lib/recruitmentDashboardApi';
import { ExpiringDocumentsWidget } from '@/components/dashboard/ExpiringDocumentsWidget';
import { PendingSigningsWidget } from '@/components/dashboard/PendingSigningsWidget';

const PIE_COLORS = ['#3b82f6', '#94a3b8', '#10b981', '#f59e0b'];

const JOB_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  closed: 'Closed',
  filled: 'Filled',
};

const ACTIVITY_LABEL: Record<string, string> = {
  submitted: 'requested',
  approved: 'approved',
  rejected: 'rejected',
  ended: 'ended',
};

type PendingRow =
  | { kind: 'assignment'; row: PendingAssignmentRequest }
  | { kind: 'employee'; row: PendingEmployeeApproval };

export default function RecruitmentManagerDashboard() {
  const { currentUser, currentSubCompany } = useStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canApprove = useHasPermission('employees:approve');
  const [busyId, setBusyId] = useState<string | null>(null);

  const name = currentUser?.firstName || currentUser?.name || 'Recruitment Manager';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['recruitment-dashboard'],
    queryFn: () => fetchRecruitmentDashboard(),
    staleTime: 30_000,
  });

  const pendingRows = useMemo<PendingRow[]>(() => {
    if (!data) return [];
    return [
      ...data.pendingAssignmentRequests.map(
        (row): PendingRow => ({ kind: 'assignment', row }),
      ),
      ...data.pendingEmployeeApprovals.map(
        (row): PendingRow => ({ kind: 'employee', row }),
      ),
    ].sort((a, b) => b.row.submittedAt.localeCompare(a.row.submittedAt));
  }, [data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['recruitment-dashboard'] });

  const handleAction = async (item: PendingRow, action: 'approve' | 'reject') => {
    setBusyId(item.row.id);
    try {
      if (item.kind === 'assignment') {
        await postApprovalAction('employee_assignment', item.row.id, action, {
          subCompanyId: item.row.subCompanyId ?? undefined,
          remarks: action === 'reject' ? 'Rejected from dashboard' : undefined,
        });
      } else if (item.row.submitterRole) {
        await postApprovalAction('employee_add', item.row.id, action, {
          subCompanyId: item.row.subCompanyId ?? undefined,
          remarks: action === 'reject' ? 'Rejected from dashboard' : undefined,
        });
      } else if (action === 'approve') {
        await approveEmployee(item.row.id);
      } else {
        await rejectEmployee(item.row.id, 'Rejected from dashboard');
      }
      toast.success(action === 'approve' ? 'Approved' : 'Rejected');
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  };

  const kpiCards = data
    ? [
        { label: 'Total Jobs', value: data.kpis.totalJobs, icon: Briefcase, tone: 'bg-blue-500/10 text-blue-600' },
        { label: 'Open Jobs', value: data.kpis.openJobs, icon: FolderOpen, tone: 'bg-amber-500/10 text-amber-600' },
        {
          label: 'Positions Filled',
          value: `${data.kpis.filledPositions}/${data.kpis.totalPositions}`,
          icon: Users,
          tone: 'bg-emerald-500/10 text-emerald-600',
        },
        { label: 'Active Clients', value: data.kpis.activeClients, icon: Building2, tone: 'bg-indigo-500/10 text-indigo-600' },
        { label: 'Active Placements', value: data.kpis.activePlacements, icon: UserCheck, tone: 'bg-green-500/10 text-green-600' },
        {
          label: 'Pending Approvals',
          value: data.kpis.pendingRequests + data.kpis.employeesPendingApproval,
          icon: Clock,
          tone: 'bg-red-500/10 text-red-600',
        },
        {
          label: 'Available Masters',
          value: data.kpis.availableMasters,
          icon: Users,
          tone: 'bg-slate-500/10 text-slate-600',
        },
        {
          label: 'With Job Matches',
          value: data.kpis.employeesWithMatches,
          icon: Target,
          tone: 'bg-teal-500/10 text-teal-600',
        },
        {
          label: 'Jobs with 0 Matches',
          value: data.kpis.jobsWithZeroMatches,
          icon: FolderOpen,
          tone: 'bg-orange-500/10 text-orange-600',
        },
      ]
    : [];

  const jobsPie = (data?.jobsByStatus ?? []).map((s) => ({
    name: JOB_STATUS_LABEL[s.status] ?? s.status,
    value: s.count,
  }));

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
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Recruitment Manager Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Welcome back, {name}.{currentSubCompany ? ` Team view for ${currentSubCompany.name}.` : ''}
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4">
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
              <CardTitle className="text-base">Pending Approvals</CardTitle>
              <CardDescription>
                New employees and client placement requests (job roster adds need no approval)
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/employees')}>
              Employees
            </Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {pendingRows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Nothing awaiting approval.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="pb-2 font-medium">Type</th>
                    <th className="pb-2 font-medium">Employee</th>
                    <th className="pb-2 font-medium">Target</th>
                    <th className="pb-2 font-medium">By</th>
                    <th className="pb-2 font-medium">Submitted</th>
                    <th className="pb-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {pendingRows.slice(0, 8).map((item) => {
                    const busy = busyId === item.row.id;
                    return (
                      <tr key={`${item.kind}-${item.row.id}`} className="border-b last:border-0">
                        <td className="py-3">
                          {item.kind === 'assignment' ? (
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                              {item.row.targetType === 'job' ? 'Job request (legacy)' : 'Client placement'}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200">
                              New employee
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 font-medium">
                          {item.kind === 'assignment' ? item.row.employeeName : item.row.name}
                        </td>
                        <td className="py-3">
                          {item.kind === 'assignment'
                            ? item.row.jobTitle ?? item.row.clientName ?? '—'
                            : 'Employee approval'}
                          {item.kind === 'assignment' && item.row.isBackup && (
                            <Badge variant="secondary" className="ml-2 text-[10px]">
                              Backup
                            </Badge>
                          )}
                        </td>
                        <td className="py-3">{item.row.submittedByName}</td>
                        <td className="py-3 text-muted-foreground whitespace-nowrap">
                          {formatDistanceToNow(parseISO(item.row.submittedAt), { addSuffix: true })}
                        </td>
                        <td className="py-3">
                          <div className="flex gap-1 justify-end">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              title="Open"
                              onClick={() =>
                                navigate(
                                  item.kind === 'assignment' && item.row.targetType === 'job'
                                    ? '/jobs'
                                    : '/employees',
                                )
                              }
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-green-600"
                              title="Approve"
                              disabled={!canApprove || busy}
                              onClick={() => handleAction(item, 'approve')}
                            >
                              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-red-600"
                              title="Reject"
                              disabled={!canApprove || busy}
                              onClick={() => handleAction(item, 'reject')}
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Recruiter Workload</CardTitle>
            <CardDescription>Placements and open requests per recruiter</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(data?.recruiterWorkload ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No recruiter activity yet.</p>
            ) : (
              data!.recruiterWorkload.slice(0, 6).map((r) => {
                const total = r.activePlacements + r.pendingRequests;
                const max = Math.max(
                  ...data!.recruiterWorkload.map((w) => w.activePlacements + w.pendingRequests),
                  1,
                );
                return (
                  <div key={r.userId} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{r.name}</span>
                      <span className="text-muted-foreground">{total}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.round((total / max) * 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {r.activePlacements} active placements · {r.pendingRequests} pending requests
                    </p>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Jobs by Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              {jobsPie.length === 0 ? (
                <p className="text-sm text-muted-foreground">No jobs yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={jobsPie}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={48}
                      outerRadius={72}
                      paddingAngle={2}
                    >
                      {jobsPie.map((entry, i) => (
                        <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Monthly Job Orders</CardTitle>
            <CardDescription>Opened vs closed, last 6 months</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.monthlyJobOrders ?? []}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="opened" name="Opened" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="closed" name="Closed" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Recent Activity</CardTitle>
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

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <PendingSigningsWidget items={data?.pendingSignings ?? []} />
        </div>
        <ExpiringDocumentsWidget />
      </div>
    </div>
  );
}
