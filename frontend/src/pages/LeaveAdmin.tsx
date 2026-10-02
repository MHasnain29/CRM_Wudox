import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, fetchAccessibleAgencies } from '@/lib/api';
import { useAuthStore } from '@/lib/authStore';
import { useStore } from '@/lib/store';
import { useCanAccessMultipleAgencies } from '@/lib/access';
import { useEffectiveUser } from '@/lib/effectiveUser';
import { announceLeaveChange, formatLeavePeriod, onLeaveDataRefresh, useLeaveScopeKey, type LeaveSession } from '@/lib/leave';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import LeaveDurationBadge from '@/components/LeaveDurationBadge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Check, X, Loader2, Plus, Trash2, Pencil, CalendarOff, Settings2, Users, AlertTriangle, History,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface LeaveRequest {
  id: string;
  startDate: string;
  endDate: string;
  days: number;
  session?: LeaveSession;
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

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

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
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <CalendarOff size={22} /> Leave Admin
        </h1>
        {showAgencyPicker && <div className="space-y-1.5 w-full sm:w-72">
          <Label htmlFor="leave-admin-agency">Agency</Label>
          <Select
            value={selectedAgencyId ? selectedAgency?.id ?? '' : 'all'}
            onValueChange={(value) => setSelectedAgencyId(value === 'all' ? null : value)}
            disabled={agenciesLoading}
          >
            <SelectTrigger id="leave-admin-agency">
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
      ) : <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pending">
            Pending Requests
            {requests.length > 0 && (
              <Badge className="ml-2 bg-orange-100 text-orange-700 border-0 text-xs">
                {requests.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">
            <History size={14} className="mr-1" /> History
          </TabsTrigger>
          <TabsTrigger value="types">
            <Settings2 size={14} className="mr-1" /> Leave Types
          </TabsTrigger>
          <TabsTrigger value="balances">
            <Users size={14} className="mr-1" /> Balances
          </TabsTrigger>
        </TabsList>

        {/* Pending Requests */}
        <TabsContent value="pending" className="mt-4">
          <Card>
            <CardContent className="pt-4">
              {requests.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No pending leave requests.
                </p>
              ) : (
                <div className="space-y-3">
                  {requests.map((req) => (
                    <div
                      key={req.id}
                      className="flex items-center justify-between border rounded p-3 gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">
                            {req.user.firstName} {req.user.lastName}
                          </span>
                          <Badge className={`text-xs border-0 ${STATUS_COLOR[req.status]}`}>
                            {req.status}
                          </Badge>
                          <LeaveDurationBadge session={req.session} />
                          <span className="text-sm text-muted-foreground">
                            {req.leaveType.name}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {formatLeavePeriod(req)} · {req.days} day(s)
                          {req.reason && ` · ${req.reason}`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Submitted {format(new Date(req.createdAt), 'dd MMM yyyy')}
                        </div>
                      </div>
                      {canApprove && <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-green-600 hover:text-green-700 hover:bg-green-50"
                          disabled={actionLoading !== null || req.user.id === user?.id || req.user.id === effectiveUser.id}
                          aria-label="Approve leave"
                          onClick={() => handleApprove(req.id)}
                        >
                          {actionLoading === req.id + '_approve'
                            ? <Loader2 size={14} className="animate-spin" />
                            : <Check size={14} />
                          }
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          disabled={actionLoading !== null || req.user.id === user?.id || req.user.id === effectiveUser.id}
                          aria-label="Reject leave"
                          onClick={() => handleReject(req.id)}
                        >
                          {actionLoading === req.id + '_reject'
                            ? <Loader2 size={14} className="animate-spin" />
                            : <X size={14} />
                          }
                        </Button>
                      </div>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* History */}
        <TabsContent value="history" className="mt-4">
          <Card>
            <CardContent className="pt-4">
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No leave history yet.</p>
              ) : (
                <div className="space-y-2">
                  {history.map((req) => (
                    <div key={req.id} className="flex items-center justify-between border rounded p-3 text-sm gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{req.user.firstName} {req.user.lastName}</span>
                          <Badge className={`text-xs border-0 ${STATUS_COLOR[req.status]}`}>
                            {req.status}
                          </Badge>
                          <LeaveDurationBadge session={req.session} />
                          <span className="text-muted-foreground">{req.leaveType.name}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {formatLeavePeriod(req)} · {req.days} day(s)
                          {req.reason && ` · ${req.reason}`}
                        </div>
                        {req.approver && (
                          <div className="text-xs text-muted-foreground">
                            {req.status === 'approved' ? 'Approved' : 'Reviewed'} by{' '}
                            {req.approver.firstName} {req.approver.lastName}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Leave Types */}
        <TabsContent value="types" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Leave Types</CardTitle>
                {canConfigure && <Button size="sm" disabled={!canSaveConfiguration} onClick={() => openTypeDialog()}>
                  <Plus size={14} className="mr-1" /> Add Type
                </Button>}
              </div>
            </CardHeader>
            <CardContent>
              {canConfigure && !selectedAgency && (
                <p className="text-sm text-muted-foreground mb-3">Select an agency above to manage leave types and allowances.</p>
              )}
              {leaveTypes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No leave types configured.</p>
              ) : (
                <div className="space-y-2">
                  {leaveTypes.map((lt) => (
                    <div key={lt.id} className="flex items-center justify-between border rounded p-3 text-sm">
                      <div>
                        <span className="font-medium">{lt.name}</span>
                        {lt.subCompanyId === null && <Badge variant="outline" className="ml-2 text-xs">Shared</Badge>}
                        <span className="text-muted-foreground ml-3">
                          {lt.daysPerYear} days/year
                        </span>
                        <span className="ml-3">
                          <Badge variant="outline" className="text-xs">
                            {lt.paid ? 'Paid' : 'Unpaid'}
                          </Badge>
                        </span>
                        {lt.maxCarryOver > 0 && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            Max carry-over: {lt.maxCarryOver}
                          </span>
                        )}
                      </div>
                      {canConfigure && <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" disabled={!canSaveConfiguration} onClick={() => openTypeDialog(lt)}>
                          <Pencil size={14} className="mr-1" /> Edit
                        </Button>
                        <Button size="sm" variant="ghost" disabled={!canSaveConfiguration} onClick={() => handleDeleteType(lt.id)} aria-label={`Delete ${lt.name}`} className="text-muted-foreground hover:text-red-500">
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
        <TabsContent value="balances" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">All Leave Balances</CardTitle>
              {canConfigure && <Button
                variant="outline"
                size="sm"
                className="text-amber-600 border-amber-300 hover:bg-amber-50"
                onClick={() => setShowCarryoverDialog(true)}
                disabled={!canSaveConfiguration}
              >
                <AlertTriangle size={14} className="mr-1.5" /> Year-End Carryover
              </Button>}
            </CardHeader>
            <CardContent>
              {balances.length === 0 ? (
                <p className="text-sm text-muted-foreground">No balances found.</p>
              ) : (
                <div className="space-y-2">
                  {balances.map((b) => {
                    const available = b.entitled + b.carriedOver - b.used;
                    return (
                      <div key={b.id} className="flex items-center justify-between border rounded p-3 text-sm">
                        <div>
                          <span className="font-medium">
                            {b.user.firstName} {b.user.lastName}
                          </span>
                          <span className="text-muted-foreground ml-3">{b.leaveType.name}</span>
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          <span className="text-sm font-semibold text-foreground mr-2">
                            {available} avail.
                          </span>
                          {b.used} used / {b.entitled} entitled
                          {b.carriedOver > 0 && ` + ${b.carriedOver} carried`}
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle size={18} /> Run Year-End Carryover?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            This will create leave balances for <strong>{new Date().getFullYear() + 1}</strong> for all
            staff in the selected agency, carrying over unused days up to each leave type's maximum. This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCarryoverDialog(false)} disabled={carryoverLoading}>
              Cancel
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTypeId ? 'Edit Leave Type' : 'Add Leave Type'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {editingTypeId && <p className="text-sm text-muted-foreground">
              {leaveTypes.find((type) => type.id === editingTypeId)?.subCompanyId === null
                ? 'This type is shared: its name and default settings change for all agencies. Changing the yearly allowance updates current-year allowances only in the selected agency.'
                : 'Changing the yearly allowance updates current-year allowances in this agency.'}
              {' '}Leave already used and carried over stays unchanged.
            </p>}
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input
                value={typeForm.name}
                onChange={(e) => setTypeForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Annual Leave, Sick Leave"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Days per Year *</Label>
                <Input
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
              <div className="space-y-1.5">
                <Label>Max Carry-Over</Label>
                <Input
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
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="paid-check"
                checked={typeForm.paid}
                onChange={(e) => setTypeForm((f) => ({ ...f, paid: e.target.checked }))}
                className="w-4 h-4"
              />
              <Label htmlFor="paid-check">Paid leave</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTypeDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveType} disabled={creatingType || !typeForm.name.trim()}>
              {creatingType && <Loader2 size={14} className="animate-spin mr-1" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
