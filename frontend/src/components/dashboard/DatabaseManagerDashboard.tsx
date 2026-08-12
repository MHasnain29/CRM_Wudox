import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfMonth } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Database,
  Clock,
  CheckCircle2,
  UserPlus,
  BarChart3,
  Loader2,
  ArrowRight,
  FileSpreadsheet,
} from 'lucide-react';
import {
  fetchClients,
  fetchPendingClientSubmissions,
  fetchPendingImports,
  fetchDatabaseManagerReport,
  type PendingManualSubmissionRecord,
  type PendingImportRecord,
} from '@/lib/api';
import { useStore } from '@/lib/store';

async function loadDashboardData() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');

  const [clientsRes, pendingManual, pendingImports, report] = await Promise.all([
    fetchClients({ page: 1, limit: 1 }),
    fetchPendingClientSubmissions().catch(() => [] as PendingManualSubmissionRecord[]),
    fetchPendingImports({ scope: 'global' }).catch(() => [] as PendingImportRecord[]),
    fetchDatabaseManagerReport({ startDate: monthStart, endDate: today }).catch(() => ({
      startDate: monthStart,
      endDate: today,
      managers: [],
    })),
  ]);

  const myRow = report.managers[0];
  return {
    globalClientTotal: clientsRes.pagination.total,
    pendingManual,
    pendingImports,
    approvedThisMonth: myRow?.approvedCount ?? 0,
    pendingInReport: myRow?.pendingCount ?? 0,
  };
}

export default function DatabaseManagerDashboard() {
  const navigate = useNavigate();
  const { currentUser } = useStore();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['database-manager-dashboard'],
    queryFn: loadDashboardData,
    staleTime: 30_000,
  });

  const pendingItems = useMemo(() => {
    if (!data) return [];
    const manual = data.pendingManual.map((r) => ({
      id: r.id,
      kind: 'manual' as const,
      name: r.name,
      submittedAt: r.submittedAt,
    }));
    const imports = data.pendingImports.map((r) => ({
      id: r.id,
      kind: 'import' as const,
      name: r.name?.trim() || 'CSV import',
      submittedAt: r.importedAt,
    }));
    return [...manual, ...imports].sort(
      (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
    );
  }, [data]);

  const pendingTotal = pendingItems.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Global client database — org-wide scope
            {currentUser.firstName ? ` · ${currentUser.firstName}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2" onClick={() => navigate('/clients')}>
            <Database className="h-4 w-4" />
            Global DB Clients
          </Button>
          <Button className="gap-2" onClick={() => navigate('/clients?tab=pending')}>
            <UserPlus className="h-4 w-4" />
            Add / Pending
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : isError ? (
        <Card className="border-destructive/30">
          <CardContent className="py-8 text-center space-y-3">
            <p className="text-sm text-destructive">Failed to load dashboard.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-none shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Global DB Clients</p>
                    <p className="text-3xl font-bold mt-1">{data?.globalClientTotal ?? 0}</p>
                    <p className="text-xs text-muted-foreground mt-1">Approved org-wide</p>
                  </div>
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Database className="h-6 w-6 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Awaiting Approval</p>
                    <p className="text-3xl font-bold mt-1">{pendingTotal}</p>
                    <p className="text-xs text-muted-foreground mt-1">Your submissions in queue</p>
                  </div>
                  <div className="w-12 h-12 bg-amber-500/10 rounded-lg flex items-center justify-center">
                    <Clock className="h-6 w-6 text-amber-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Approved This Month</p>
                    <p className="text-3xl font-bold mt-1">{data?.approvedThisMonth ?? 0}</p>
                    <p className="text-xs text-muted-foreground mt-1">{format(new Date(), 'MMMM yyyy')}</p>
                  </div>
                  <div className="w-12 h-12 bg-green-500/10 rounded-lg flex items-center justify-center">
                    <CheckCircle2 className="h-6 w-6 text-green-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">In Approval Pipeline</p>
                    <p className="text-3xl font-bold mt-1">{data?.pendingInReport ?? pendingTotal}</p>
                    <p className="text-xs text-muted-foreground mt-1">Pending global DB entries</p>
                  </div>
                  <div className="w-12 h-12 bg-blue-500/10 rounded-lg flex items-center justify-center">
                    <BarChart3 className="h-6 w-6 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="border-none shadow-sm lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-base">My Pending Submissions</CardTitle>
                  <CardDescription>Clients you submitted for global database approval</CardDescription>
                </div>
                <Button variant="ghost" size="sm" className="gap-1" onClick={() => navigate('/clients?tab=pending')}>
                  View all
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {pendingItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    No pending submissions. Add a client to grow the global database.
                  </p>
                ) : (
                  pendingItems.slice(0, 8).map((item) => (
                    <div
                      key={`${item.kind}-${item.id}`}
                      className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 hover:bg-muted/40 cursor-pointer"
                      onClick={() => navigate('/clients?tab=pending')}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {item.kind === 'import' ? (
                          <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
                        ) : (
                          <UserPlus className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{item.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.kind === 'import' ? 'Import' : 'Manual add'} ·{' '}
                            {format(new Date(item.submittedAt), 'MMM d, yyyy')}
                          </p>
                        </div>
                      </div>
                      <Badge variant="secondary">Pending</Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Quick Actions</CardTitle>
                <CardDescription>Global database workflows</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 h-10"
                  onClick={() => navigate('/clients')}
                >
                  <Database className="h-4 w-4" />
                  Browse global clients
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 h-10"
                  onClick={() => navigate('/clients?tab=pending')}
                >
                  <Clock className="h-4 w-4" />
                  Track pending queue
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 h-10"
                  onClick={() => navigate('/reports')}
                >
                  <BarChart3 className="h-4 w-4" />
                  Productivity report
                </Button>
                <p className="text-xs text-muted-foreground pt-2 px-1">
                  Manual adds and imports go through org approval before clients appear in the global database.
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
