import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { onLeaveRefresh } from '@/lib/socket';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Check, X, Loader2, Plus, Trash2, CalendarOff, Settings2, Users, AlertTriangle, History,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface LeaveRequest {
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
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [history, setHistory] = useState<LeaveRequest[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [loading, setLoading] = useState(true);

  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Carryover
  const [showCarryoverDialog, setShowCarryoverDialog] = useState(false);
  const [carryoverLoading, setCarryoverLoading] = useState(false);

  // New leave type dialog
  const [showTypeDialog, setShowTypeDialog] = useState(false);
  const [creatingType, setCreatingType] = useState(false);
  const [typeForm, setTypeForm] = useState({
    name: '',
    daysPerYear: 20,
    paid: true,
    maxCarryOver: 0,
  });

  const fetchData = useCallback((showLoader = false) => {
    if (showLoader) setLoading(true);
    Promise.all([
      apiFetch<any>('/leave/requests?status=pending'),
      apiFetch<any>('/leave/types'),
      apiFetch<any>('/leave/balances'),
      apiFetch<any>('/leave/requests'),
    ]).then(([reqRes, typRes, balRes, histRes]) => {
      if (reqRes.ok) setRequests(reqRes.data?.data ?? []);
      if (typRes.ok) setLeaveTypes(typRes.data?.data ?? []);
      if (balRes.ok) setBalances(balRes.data?.data ?? []);
      if (histRes.ok) {
        const all: LeaveRequest[] = histRes.data?.data ?? [];
        setHistory(all.filter((r) => r.status !== 'pending'));
      }
    }).catch(() => toast.error('Failed to load leave data')).finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(true); }, [fetchData]);

  useEffect(() => {
    const unsub = onLeaveRefresh(() => fetchData());
    return () => { unsub(); };
  }, [fetchData]);

  async function handleApprove(reqId: string) {
    setActionLoading(reqId + '_approve');
    const res = await apiFetch<any>(`/leave/requests/${reqId}/approve`, { method: 'PATCH' });
    if (res.ok) {
      setRequests((prev) => prev.filter((r) => r.id !== reqId));
      toast.success('Leave approved');
    } else {
      toast.error((res as any).error ?? 'Failed to approve');
    }
    setActionLoading(null);
  }

  async function handleReject(reqId: string) {
    setActionLoading(reqId + '_reject');
    const res = await apiFetch<any>(`/leave/requests/${reqId}/reject`, { method: 'PATCH' });
    if (res.ok) {
      setRequests((prev) => prev.filter((r) => r.id !== reqId));
      toast.success('Leave rejected');
    } else {
      toast.error('Failed to reject');
    }
    setActionLoading(null);
  }

  async function handleDeleteType(typeId: string) {
    const res = await apiFetch<any>(`/leave/types/${typeId}`, { method: 'DELETE' });
    if (res.ok) {
      setLeaveTypes((prev) => prev.filter((t) => t.id !== typeId));
      toast.success('Leave type deleted');
    } else {
      toast.error((res as any).error ?? 'Failed to delete');
    }
  }

  async function handleCarryover() {
    setCarryoverLoading(true);
    const res = await apiFetch<any>('/leave/carryover', { method: 'POST' });
    if (res.ok) {
      const d = res.data?.data ?? res.data;
      toast.success(d?.message ?? 'Year-end carryover complete');
      setShowCarryoverDialog(false);
    } else {
      toast.error('Carryover failed — check server logs');
    }
    setCarryoverLoading(false);
  }

  async function handleCreateType() {
    if (!typeForm.name.trim()) return;
    setCreatingType(true);
    const res = await apiFetch<any>('/leave/types', {
      method: 'POST',
      body: JSON.stringify(typeForm),
    });
    if (res.ok) {
      const created = res.data?.data ?? res.data;
      setLeaveTypes((prev) => [...prev, created]);
      setShowTypeDialog(false);
      setTypeForm({ name: '', daysPerYear: 20, paid: true, maxCarryOver: 0 });
      toast.success('Leave type created and balances set for all users');
    } else {
      toast.error((res as any).error ?? 'Failed to create leave type');
    }
    setCreatingType(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="animate-spin mr-2" size={20} /> Loading…
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <CalendarOff size={22} /> Leave Admin
      </h1>

      <Tabs defaultValue="pending">
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
                          <span className="text-sm text-muted-foreground">
                            {req.leaveType.name}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {format(new Date(req.startDate), 'dd MMM yyyy')} –{' '}
                          {format(new Date(req.endDate), 'dd MMM yyyy')} · {req.days} day(s)
                          {req.reason && ` · ${req.reason}`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Submitted {format(new Date(req.createdAt), 'dd MMM yyyy')}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-green-600 hover:text-green-700 hover:bg-green-50"
                          disabled={actionLoading !== null}
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
                          disabled={actionLoading !== null}
                          onClick={() => handleReject(req.id)}
                        >
                          {actionLoading === req.id + '_reject'
                            ? <Loader2 size={14} className="animate-spin" />
                            : <X size={14} />
                          }
                        </Button>
                      </div>
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
                          <span className="text-muted-foreground">{req.leaveType.name}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {format(new Date(req.startDate), 'dd MMM yyyy')} –{' '}
                          {format(new Date(req.endDate), 'dd MMM yyyy')} · {req.days} day(s)
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
                <Button size="sm" onClick={() => setShowTypeDialog(true)}>
                  <Plus size={14} className="mr-1" /> Add Type
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {leaveTypes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No leave types configured.</p>
              ) : (
                <div className="space-y-2">
                  {leaveTypes.map((lt) => (
                    <div key={lt.id} className="flex items-center justify-between border rounded p-3 text-sm">
                      <div>
                        <span className="font-medium">{lt.name}</span>
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
                      <button
                        onClick={() => handleDeleteType(lt.id)}
                        className="text-muted-foreground hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
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
              <Button
                variant="outline"
                size="sm"
                className="text-amber-600 border-amber-300 hover:bg-amber-50"
                onClick={() => setShowCarryoverDialog(true)}
              >
                <AlertTriangle size={14} className="mr-1.5" /> Year-End Carryover
              </Button>
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
      </Tabs>

      {/* Year-End Carryover Confirmation */}
      <Dialog open={showCarryoverDialog} onOpenChange={setShowCarryoverDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle size={18} /> Run Year-End Carryover?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            This will create leave balances for <strong>{new Date().getFullYear() + 1}</strong> for all
            staff, carrying over unused days up to each leave type's maximum. This action cannot be undone.
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
      <Dialog open={showTypeDialog} onOpenChange={setShowTypeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Leave Type</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
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
                  min={1}
                  max={365}
                  value={typeForm.daysPerYear}
                  onChange={(e) =>
                    setTypeForm((f) => ({ ...f, daysPerYear: parseInt(e.target.value) || 1 }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Max Carry-Over</Label>
                <Input
                  type="number"
                  min={0}
                  max={365}
                  value={typeForm.maxCarryOver}
                  onChange={(e) =>
                    setTypeForm((f) => ({ ...f, maxCarryOver: parseInt(e.target.value) || 0 }))
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
            <Button onClick={handleCreateType} disabled={creatingType || !typeForm.name.trim()}>
              {creatingType && <Loader2 size={14} className="animate-spin mr-1" />}
              Create Leave Type
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
