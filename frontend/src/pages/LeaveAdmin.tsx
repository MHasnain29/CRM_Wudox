import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, fetchAccessibleAgencies } from '@/lib/api';
import { useAuthStore } from '@/lib/authStore';
import { useStore } from '@/lib/store';
import { useCanAccessMultipleAgencies } from '@/lib/access';
import { useEffectiveUser } from '@/lib/effectiveUser';
import { announceLeaveChange, formatLeaveDays, onLeaveDataRefresh, useLeaveScopeKey, type LeaveTimingFields } from '@/lib/leave';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import LeaveAdminRequestCard from '@/components/leave/LeaveAdminRequestCard';
import LeaveRequestFilters from '@/components/leave/LeaveRequestFilters';
import { matchesLeaveRequestFilters, type LeaveDurationFilter, type LeaveStatusFilter } from '@/lib/leaveFilters';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Check, X, Loader2, Plus, Trash2, Pencil, CalendarOff, Settings2, Users, AlertTriangle, History, Clock3,
} from 'lucide-react';
import { toast } from 'sonner';

interface LeaveRequest extends LeaveTimingFields {
  id: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  createdAt: string;
  user: { id: string; firstName: string; lastName: string };
  leaveType: { id: string; name: string; paid: boolean };
  approver: { firstName: string; lastName: string } | null;
}

interface LeaveType {
  id: string;
  name: string;
  daysPerYear: number;
  paid: boolean;
  maxCarryOver: number;
  subCompanyId?: string | null;
}

interface LeaveBalance {
  id: string;
  entitled: number;
  used: number;
  carriedOver: number;
  user: { id: string; firstName: string; lastName: string };
  leaveType: { id: string; name: string; paid: boolean };
}

const TAB_CLASS_NAME = 'h-10 sm:h-9 gap-2 rounded-lg px-3 text-xs data-[state=active]:bg-card data-[state=active]:text-primary sm:px-4 sm:text-sm';

export default function LeaveAdmin() {
  const user = useAuthStore((state) => state.user);
  const permissions = useAuthStore((state) => state.permissions);
  const canApprove = permissions.includes('leave:approve');
  const effectiveUser = useEffectiveUser();
  const selectedAgencyId = useStore((state) => state.viewedSubCompanyId);
  const setSelectedAgencyId = useStore((state) => state.setViewedSubCompanyId);
  const canAccessMultipleAgencies = useCanAccessMultipleAgencies();
  const canConfigure = user?.role === 'super_admin';
  const showAgencyPicker = canConfigure || canAccessMultipleAgencies;
  const { data: accessibleAgencies = [], isLoading: agenciesLoading } = useQuery({
    queryKey: ['leave-admin-agencies', user?.id, user?.role, permissions, effectiveUser.isActingAs, effectiveUser.subCompanyId],
    queryFn: fetchAccessibleAgencies,
    enabled: showAgencyPicker,
  });
  const agencies = effectiveUser.isActingAs
    ? accessibleAgencies.filter((agency) => agency.id === effectiveUser.subCompanyId)
    : accessibleAgencies;
  const selectedAgency = agencies.find((agency) => agency.id === selectedAgencyId);
  const scopeKey = useLeaveScopeKey();
  const activeScope = useRef(scopeKey);
  activeScope.current = scopeKey;
  const fetchVersion = useRef(0);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [history, setHistory] = useState<LeaveRequest[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedScope, setLoadedScope] = useState('');
  const [activeTab, setActiveTab] = useState('pending');
  const [historyDuration, setHistoryDuration] = useState<LeaveDurationFilter>('all');
  const [historyStatus, setHistoryStatus] = useState<LeaveStatusFilter>('all');
  const [pendingDuration, setPendingDuration] = useState<LeaveDurationFilter>('all');
  const filteredHistory = history.filter((request) => matchesLeaveRequestFilters(request, historyDuration, historyStatus));
  const filteredPending = requests.filter((request) => matchesLeaveRequestFilters(request, pendingDuration));
  const dataLoading = loading || loadedScope !== scopeKey;
  const canSaveConfiguration = canConfigure && !!selectedAgency && !dataLoading;

  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Carryover
  const [showCarryoverDialog, setShowCarryoverDialog] = useState(false);
  const [carryoverLoading, setCarryoverLoading] = useState(false);

  // New leave type dialog
  const [showTypeDialog, setShowTypeDialog] = useState(false);
  const [creatingType, setCreatingType] = useState(false);
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [typeForm, setTypeForm] = useState({
    name: '',
    daysPerYear: 20,
    paid: true,
    maxCarryOver: 0,
  });

  const fetchData = useCallback((showLoader = false) => {
    const version = ++fetchVersion.current;
    const isCurrent = () => activeScope.current === scopeKey && fetchVersion.current === version;
    if (showLoader) setLoading(true);
    Promise.all([
      apiFetch<any>('/leave/requests?status=pending'),
      apiFetch<any>('/leave/types'),
      apiFetch<any>('/leave/balances'),
      apiFetch<any>('/leave/requests'),
    ]).then(([reqRes, typRes, balRes, histRes]) => {
      if (!isCurrent()) return;
      setRequests(reqRes.ok ? reqRes.data?.data ?? [] : []);
      setLeaveTypes(typRes.ok ? typRes.data?.data ?? [] : []);
      setBalances(balRes.ok ? balRes.data?.data ?? [] : []);
      if (histRes.ok) {
        const all: LeaveRequest[] = histRes.data?.data ?? [];
        setHistory(all.filter((r) => r.status !== 'pending'));
      } else {
        setHistory([]);
      }
      if (!reqRes.ok || !typRes.ok || !balRes.ok || !histRes.ok) toast.error('Failed to load leave data');
    }).catch(() => { if (isCurrent()) toast.error('Failed to load leave data'); })
      .finally(() => { if (isCurrent()) { setLoadedScope(scopeKey); setLoading(false); } });
  }, [scopeKey]);

  useEffect(() => {
    setRequests([]);
    setHistory([]);
    setHistoryDuration('all');
    setHistoryStatus('all');
    setPendingDuration('all');
    setLeaveTypes([]);
    setBalances([]);
    setShowTypeDialog(false);
    setShowCarryoverDialog(false);
    setEditingTypeId(null);
    setCreatingType(false);
    setCarryoverLoading(false);
    setActionLoading(null);
    fetchData(true);
    return () => { fetchVersion.current += 1; };
  }, [fetchData]);

  useEffect(() => {
    const unsub = onLeaveDataRefresh(() => fetchData());
    return () => { unsub(); };
  }, [fetchData]);

  async function handleApprove(reqId: string) {
    setActionLoading(reqId + '_approve');
    const res = await apiFetch<any>(`/leave/requests/${reqId}/approve`, { method: 'PATCH' });
    if (activeScope.current !== scopeKey) return;
    if (res.ok === true) {
      setRequests((prev) => prev.filter((r) => r.id !== reqId));
      toast.success('Leave approved');
      announceLeaveChange();
    } else {
      toast.error((res as any).error ?? 'Failed to approve');
    }
    setActionLoading(null);
  }

  async function handleReject(reqId: string) {
    setActionLoading(reqId + '_reject');
    const res = await apiFetch<any>(`/leave/requests/${reqId}/reject`, { method: 'PATCH' });
    if (activeScope.current !== scopeKey) return;
    if (res.ok === true) {
      setRequests((prev) => prev.filter((r) => r.id !== reqId));
      toast.success('Leave rejected');
      announceLeaveChange();
    } else {
      toast.error(res.error ?? 'Failed to reject');
    }
    setActionLoading(null);
  }

  async function handleDeleteType(typeId: string) {
    if (!canSaveConfiguration) return;
    const res = await apiFetch<any>(`/leave/types/${typeId}`, { method: 'DELETE' });
    if (activeScope.current !== scopeKey) return;
    if (res.ok === true) {
      setLeaveTypes((prev) => prev.filter((t) => t.id !== typeId));
      toast.success('Leave type deleted');
      announceLeaveChange();
    } else {
      toast.error((res as any).error ?? 'Failed to delete');
    }
  }

  async function handleCarryover() {
    if (!canSaveConfiguration) return;
    setCarryoverLoading(true);
    const res = await apiFetch<any>('/leave/carryover', { method: 'POST' });
    if (activeScope.current !== scopeKey) return;
    if (res.ok === true) {
      const d = res.data?.data ?? res.data;
      toast.success(d?.message ?? 'Year-end carryover complete');
      setShowCarryoverDialog(false);
      announceLeaveChange();
    } else {
      toast.error(res.error ?? 'Carryover failed');
    }
    setCarryoverLoading(false);
  }

  function openTypeDialog(type?: LeaveType) {
    setEditingTypeId(type?.id ?? null);
    setTypeForm(type ? {
      name: type.name, daysPerYear: type.daysPerYear, paid: type.paid, maxCarryOver: type.maxCarryOver,
    } : { name: '', daysPerYear: 20, paid: true, maxCarryOver: 0 });
    setShowTypeDialog(true);
  }

  async function handleSaveType() {
    if (!canSaveConfiguration || !typeForm.name.trim()) return;
    if ([typeForm.daysPerYear, typeForm.maxCarryOver].some((value) => !Number.isFinite(value) || value < 0 || value > 365 || !Number.isInteger(value * 2))) {
      toast.error('Enter days from 0 to 365 in half-day increments');
      return;
    }
    setCreatingType(true);
    const res = await apiFetch<any>(editingTypeId ? `/leave/types/${editingTypeId}` : '/leave/types', {
      method: editingTypeId ? 'PATCH' : 'POST',
      body: JSON.stringify(typeForm),
    });
    if (activeScope.current !== scopeKey) return;
    if (res.ok === true) {
      setShowTypeDialog(false);
      setTypeForm({ name: '', daysPerYear: 20, paid: true, maxCarryOver: 0 });
      toast.success(editingTypeId ? 'Leave type saved' : 'Leave type created and balances set for this agency');
      setEditingTypeId(null);
      announceLeaveChange();
    } else {
      toast.error(res.error ?? 'Failed to save leave type');
    }
    setCreatingType(false);
  }

  return (
    <div className="space-y-5 p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/10 bg-primary/10 text-primary">
            <CalendarOff size={23} aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Leave Admin</h1>
            <p className="text-sm text-muted-foreground">Review requests and manage your team’s leave.</p>
          </div>
        </div>
        {showAgencyPicker && <div className="w-full shrink-0 space-y-1.5 sm:w-72">
          <Label htmlFor="leave-admin-agency">Agency</Label>
          <Select
            value={selectedAgencyId ? selectedAgency?.id ?? '' : 'all'}
            onValueChange={(value) => setSelectedAgencyId(value === 'all' ? null : value)}
            disabled={agenciesLoading}
          >
            <SelectTrigger id="leave-admin-agency" className="h-10 rounded-xl bg-card">
              <SelectValue placeholder={agenciesLoading ? 'Loading agencies…' : 'Select an agency'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accessible agencies</SelectItem>
              {agencies.map((agency) => <SelectItem key={agency.id} value={agency.id}>{agency.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {!agenciesLoading && agencies.length === 0 && <p className="text-sm text-muted-foreground">No accessible agencies found.</p>}
        </div>}
      </div>

      {dataLoading ? (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          <Loader2 className="animate-spin mr-2" size={20} /> Loading…
        </div>
      ) : <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl border bg-muted/50 p-1 sm:inline-flex sm:w-auto">
          <TabsTrigger value="pending" className={TAB_CLASS_NAME}>
            <Clock3 size={16} className="hidden sm:block" aria-hidden="true" />
            Pending Requests
            {requests.length > 0 && (
              <Badge className="min-w-5 justify-center border-0 bg-primary/10 px-1.5 py-0 text-[11px] tabular-nums text-primary hover:bg-primary/10">
                {requests.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className={TAB_CLASS_NAME}>
            <History size={16} aria-hidden="true" /> History
          </TabsTrigger>
          <TabsTrigger value="types" className={TAB_CLASS_NAME}>
            <Settings2 size={16} aria-hidden="true" /> Leave Types
          </TabsTrigger>
          <TabsTrigger value="balances" className={TAB_CLASS_NAME}>
            <Users size={16} aria-hidden="true" /> Balances
          </TabsTrigger>
        </TabsList>

        {/* Pending Requests */}
        <TabsContent value="pending" className="space-y-2.5">
          <div className="space-y-1">
            <h2 className="text-base font-semibold">Pending requests</h2>
            <p className="text-sm text-muted-foreground">Leave and time away awaiting review.</p>
          </div>
          <LeaveRequestFilters duration={pendingDuration} onDurationChange={setPendingDuration} />
          {requests.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card px-6 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><Clock3 size={22} aria-hidden="true" /></div>
              <p className="text-sm text-muted-foreground">No pending leave requests.</p>
            </div>
          ) : filteredPending.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card px-6 py-10 text-center" role="status">
              <p className="text-sm text-muted-foreground">No pending requests match this duration.</p>
              <Button variant="outline" size="sm" onClick={() => setPendingDuration('all')}>Clear filters</Button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredPending.map((req) => (
                <LeaveAdminRequestCard
                  key={req.id}
                  request={req}
                  showSubmittedDate
                  actions={canApprove && <div className="flex w-full items-center gap-2 sm:w-auto">
                    <Button
                      size="sm"
                      className="h-10 flex-1 gap-1.5 rounded-lg px-3 sm:h-9 sm:flex-none"
                      disabled={actionLoading !== null || req.user.id === user?.id || req.user.id === effectiveUser.id}
                      aria-label="Approve leave"
                      onClick={() => handleApprove(req.id)}
                    >
                      {actionLoading === req.id + '_approve'
                        ? <Loader2 size={15} className="animate-spin" />
                        : <Check size={15} />
                      }
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-10 flex-1 gap-1.5 rounded-lg px-3 sm:h-9 text-destructive hover:bg-destructive/5 hover:text-destructive sm:flex-none"
                      disabled={actionLoading !== null || req.user.id === user?.id || req.user.id === effectiveUser.id}
                      aria-label="Reject leave"
                      onClick={() => handleReject(req.id)}
                    >
                      {actionLoading === req.id + '_reject'
                        ? <Loader2 size={15} className="animate-spin" />
                        : <X size={15} />
                      }
                      Reject
                    </Button>
                  </div>}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* History */}
        <TabsContent value="history" className="space-y-2.5">
          <div className="space-y-1">
            <h2 className="text-base font-semibold">Request history</h2>
            <p className="text-sm text-muted-foreground">Previously reviewed and cancelled requests.</p>
          </div>
          <LeaveRequestFilters
            duration={historyDuration}
            status={historyStatus}
            statuses={['approved', 'rejected', 'cancelled']}
            onDurationChange={setHistoryDuration}
            onStatusChange={setHistoryStatus}
          />
          {history.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card px-6 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><History size={22} aria-hidden="true" /></div>
              <p className="text-sm text-muted-foreground">No leave history yet.</p>
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card px-6 py-10 text-center" role="status">
              <p className="text-sm text-muted-foreground">No requests match these filters.</p>
              <Button variant="outline" size="sm" onClick={() => { setHistoryDuration('all'); setHistoryStatus('all'); }}>
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredHistory.map((req) => <LeaveAdminRequestCard key={req.id} request={req} />)}
            </div>
          )}
        </TabsContent>

        {/* Leave Types */}
        <TabsContent value="types">
          <Card className="overflow-hidden rounded-2xl">
            <CardHeader className="border-b bg-muted/20 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-base">Leave Types</CardTitle>
                {canConfigure && <Button size="sm" className="h-10 rounded-lg px-3 sm:h-9" disabled={!canSaveConfiguration} onClick={() => openTypeDialog()}>
                  <Plus size={14} className="mr-1" /> Add Type
                </Button>}
              </div>
            </CardHeader>
            <CardContent className="p-3 sm:p-4">
              {canConfigure && !selectedAgency && (
                <p className="mb-3 rounded-xl border border-primary/10 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">Select an agency above to manage leave types and allowances.</p>
              )}
              {leaveTypes.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No leave types configured.</p>
              ) : (
                <div className="space-y-2.5">
                  {leaveTypes.map((lt) => (
                    <div key={lt.id} className="flex flex-col gap-3 rounded-xl border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="break-words font-semibold">{lt.name}</span>
                          {lt.subCompanyId === null && <Badge variant="outline" className="text-xs">Shared</Badge>}
                          <Badge variant="outline" className="bg-muted/40 text-xs font-normal">
                            {lt.paid ? 'Paid' : 'Unpaid'}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>{lt.daysPerYear} days/year</span>
                          {lt.maxCarryOver > 0 && (
                            <span>Max carry-over: {lt.maxCarryOver}</span>
                          )}
                        </div>
                      </div>
                      {canConfigure && <div className="flex shrink-0 items-center gap-2 border-t pt-2 sm:border-0 sm:pt-0">
                        <Button size="sm" variant="outline" className="h-9 rounded-lg" disabled={!canSaveConfiguration} onClick={() => openTypeDialog(lt)}>
                          <Pencil size={14} className="mr-1" /> Edit
                        </Button>
                        <Button size="sm" variant="ghost" disabled={!canSaveConfiguration} onClick={() => handleDeleteType(lt.id)} aria-label={`Delete ${lt.name}`} className="h-9 w-9 rounded-lg px-0 text-muted-foreground hover:bg-destructive/5 hover:text-destructive">
                          <Trash2 size={14} />
                        </Button>
                      </div>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Balances */}
        <TabsContent value="balances">
          <Card className="overflow-hidden rounded-2xl">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 border-b bg-muted/20 px-4 py-3">
              <CardTitle className="text-base">All Leave Balances</CardTitle>
              {canConfigure && <Button
                variant="outline"
                size="sm"
                className="h-10 rounded-lg sm:h-9 border-amber-200 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950"
                onClick={() => setShowCarryoverDialog(true)}
                disabled={!canSaveConfiguration}
              >
                <AlertTriangle size={14} className="mr-1.5" /> Year-End Carryover
              </Button>}
            </CardHeader>
            <CardContent className="p-3 sm:p-4">
              {balances.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No balances found.</p>
              ) : (
                <div className="space-y-2.5">
                  {balances.map((b) => {
                    const available = b.entitled + b.carriedOver - b.used;
                    return (
                      <div key={b.id} className="flex flex-col gap-3 rounded-xl border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 space-y-1">
                          <p className="break-words font-semibold">
                            {b.user.firstName} {b.user.lastName}
                          </p>
                          <p className="break-words text-xs text-muted-foreground">{b.leaveType.name}</p>
                        </div>
                        <div className="space-y-1 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:min-w-56 sm:text-right">
                          <p className="text-foreground">
                            <span className="text-lg font-semibold tabular-nums">{formatLeaveDays(available)}</span>
                            <span className="ml-1.5 text-xs text-muted-foreground">days available</span>
                          </p>
                          <p>
                            {formatLeaveDays(b.used)} used / {b.entitled} entitled
                            {b.carriedOver > 0 && ` + ${b.carriedOver} carried`}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>}

      {/* Year-End Carryover Confirmation */}
      <Dialog open={canSaveConfiguration && showCarryoverDialog} onOpenChange={setShowCarryoverDialog}>
        <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-2xl bg-card p-0">
          <DialogHeader className="shrink-0 border-b px-5 py-5 pr-12 text-left sm:px-6 sm:pr-12">
            <DialogTitle className="flex items-center gap-2 text-base leading-snug text-amber-700 dark:text-amber-300">
              <AlertTriangle size={20} className="shrink-0" aria-hidden="true" /> Run Year-End Carryover?
            </DialogTitle>
          </DialogHeader>
          <DialogDescription className="min-h-0 overflow-y-auto px-5 py-5 text-sm leading-relaxed sm:px-6">
            This will create leave balances for <strong>{new Date().getFullYear() + 1}</strong> for all
            staff in the selected agency, carrying over unused days up to each leave type's maximum. This action cannot be undone.
          </DialogDescription>
          <DialogFooter className="shrink-0 flex-row flex-wrap justify-end gap-2 border-t bg-muted/20 px-5 py-4 sm:space-x-0 sm:px-6">
            <Button variant="outline" className="h-11 rounded-xl bg-card px-5" onClick={() => setShowCarryoverDialog(false)} disabled={carryoverLoading}>
              Cancel
            </Button>
            <Button
              className="h-11 rounded-xl bg-amber-600 px-5 text-white hover:bg-amber-700"
              onClick={handleCarryover}
              disabled={carryoverLoading}
            >
              {carryoverLoading ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              Yes, Run Carryover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Leave Type Dialog */}
      <Dialog open={canSaveConfiguration && showTypeDialog} onOpenChange={setShowTypeDialog}>
        <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-[560px] flex-col gap-0 overflow-hidden rounded-2xl bg-card p-0">
          <DialogHeader className="shrink-0 flex-row items-center gap-3 space-y-0 border-b px-5 py-5 pr-12 text-left sm:px-6 sm:pr-12">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Settings2 size={22} aria-hidden="true" /></div>
            <div className="space-y-1">
              <DialogTitle className="text-lg leading-snug">{editingTypeId ? 'Edit Leave Type' : 'Add Leave Type'}</DialogTitle>
              <DialogDescription className="text-xs leading-relaxed sm:text-sm">Configure the leave type and its allowance.</DialogDescription>
            </div>
          </DialogHeader>
          <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
            {editingTypeId && <p className="rounded-xl border border-primary/10 bg-primary/5 p-4 text-xs leading-relaxed text-muted-foreground">
              {leaveTypes.find((type) => type.id === editingTypeId)?.subCompanyId === null
                ? 'This type is shared: its name and default settings change for all agencies. Changing the yearly allowance updates current-year allowances only in the selected agency.'
                : 'Changing the yearly allowance updates current-year allowances in this agency.'}
              {' '}Leave already used and carried over stays unchanged.
            </p>}
            <div className="space-y-2">
              <Label htmlFor="leave-type-name">Name *</Label>
              <Input
                id="leave-type-name"
                className="h-11 rounded-xl bg-card"
                value={typeForm.name}
                onChange={(e) => setTypeForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Annual Leave, Sick Leave"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 rounded-xl border border-border/70 bg-muted/30 p-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="leave-type-days">Days per Year *</Label>
                <Input
                  id="leave-type-days"
                  className="h-11 rounded-lg bg-card"
                  type="number"
                  min={0}
                  max={365}
                  step={0.5}
                  value={typeForm.daysPerYear}
                  onChange={(e) =>
                    setTypeForm((f) => ({ ...f, daysPerYear: Number(e.target.value) }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="leave-type-carryover">Max Carry-Over</Label>
                <Input
                  id="leave-type-carryover"
                  className="h-11 rounded-lg bg-card"
                  type="number"
                  min={0}
                  max={365}
                  step={0.5}
                  value={typeForm.maxCarryOver}
                  onChange={(e) =>
                    setTypeForm((f) => ({ ...f, maxCarryOver: Number(e.target.value) }))
                  }
                />
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border px-4 py-3">
              <input
                type="checkbox"
                id="paid-check"
                checked={typeForm.paid}
                onChange={(e) => setTypeForm((f) => ({ ...f, paid: e.target.checked }))}
                className="h-4 w-4 accent-primary"
              />
              <Label htmlFor="paid-check">Paid leave</Label>
            </div>
          </div>
          <DialogFooter className="shrink-0 flex-row justify-end gap-2 border-t bg-muted/20 px-5 py-4 sm:space-x-0 sm:px-6">
            <Button variant="outline" className="h-11 rounded-xl bg-card px-5" onClick={() => setShowTypeDialog(false)}>Cancel</Button>
            <Button className="h-11 rounded-xl px-5" onClick={handleSaveType} disabled={creatingType || !typeForm.name.trim()}>
              {creatingType && <Loader2 size={14} className="animate-spin mr-1" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
