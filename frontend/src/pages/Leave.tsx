import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { onLeaveRefresh } from '@/lib/socket';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { CalendarOff, Plus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { format, differenceInBusinessDays, addDays } from 'date-fns';

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
  leaveType: { id: string; name: string; paid: boolean };
}

interface LeaveRequest {
  id: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  createdAt: string;
  leaveType: { id: string; name: string };
  approver: { firstName: string; lastName: string } | null;
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

export default function Leave() {
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);

  const [showDialog, setShowDialog] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [form, setForm] = useState({
    leaveTypeId: '',
    startDate: '',
    endDate: '',
    reason: '',
  });

  const fetchData = useCallback((showLoader = false) => {
    if (showLoader) setLoading(true);
    Promise.all([
      apiFetch<any>('/leave/balances/me'),
      apiFetch<any>('/leave/requests'),
      apiFetch<any>('/leave/types'),
    ]).then(([balRes, reqRes, typRes]) => {
      if (balRes.ok) setBalances(balRes.data?.data ?? []);
      if (reqRes.ok) setRequests(reqRes.data?.data ?? []);
      if (typRes.ok) setLeaveTypes(typRes.data?.data ?? []);
    }).catch(() => toast.error('Failed to load leave data')).finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(true); }, [fetchData]);

  useEffect(() => {
    const unsub = onLeaveRefresh(() => fetchData());
    return () => { unsub(); };
  }, [fetchData]);

  function calcDays(): number {
    if (!form.startDate || !form.endDate) return 0;
    const start = new Date(form.startDate);
    const end = new Date(form.endDate);
    if (end < start) return 0;
    // Business days (Mon–Fri), inclusive
    return differenceInBusinessDays(addDays(end, 1), start);
  }

  async function handleSubmit() {
    if (!form.leaveTypeId || !form.startDate || !form.endDate) return;
    const days = calcDays();
    if (days <= 0) {
      toast.error('End date must be after start date');
      return;
    }
    setSubmitting(true);
    const res = await apiFetch<any>('/leave/requests', {
      method: 'POST',
      body: JSON.stringify({
        leaveTypeId: form.leaveTypeId,
        startDate: new Date(form.startDate).toISOString(),
        endDate: new Date(form.endDate).toISOString(),
        days,
        reason: form.reason || undefined,
      }),
    });
    if (res.ok) {
      const created = res.data?.data ?? res.data;
      setRequests((prev) => [created, ...prev]);
      setShowDialog(false);
      setForm({ leaveTypeId: '', startDate: '', endDate: '', reason: '' });
      toast.success('Leave request submitted');
    } else {
      toast.error((res as any).error ?? 'Failed to submit request');
    }
    setSubmitting(false);
  }

  async function handleCancel(reqId: string) {
    setCancelling(reqId);
    const res = await apiFetch<any>(`/leave/requests/${reqId}/cancel`, { method: 'PATCH' });
    if (res.ok) {
      setRequests((prev) =>
        prev.map((r) => (r.id === reqId ? { ...r, status: 'cancelled' } : r))
      );
      toast.success('Request cancelled');
    } else {
      toast.error('Failed to cancel request');
    }
    setCancelling(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="animate-spin mr-2" size={20} /> Loading leave data…
      </div>
    );
  }

  const days = calcDays();

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <CalendarOff size={22} /> My Leave
        </h1>
        <Button onClick={() => setShowDialog(true)}>
          <Plus size={16} className="mr-1" /> Request Leave
        </Button>
      </div>

      {/* Leave Balances */}
      {balances.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Leave Balances</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {balances.map((b) => {
              const available = b.entitled + b.carriedOver - b.used;
              return (
                <Card key={b.id}>
                  <CardContent className="pt-4 pb-4">
                    <p className="text-xs font-medium text-muted-foreground">
                      {b.leaveType.name}
                      {!b.leaveType.paid && (
                        <span className="ml-1 text-orange-500">(unpaid)</span>
                      )}
                    </p>
                    <p className="text-2xl font-bold mt-1">{available}</p>
                    <p className="text-xs text-muted-foreground">
                      {b.used} used / {b.entitled} entitled
                      {b.carriedOver > 0 && ` + ${b.carriedOver} carried`}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {balances.length === 0 && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground text-center">
            No leave balances set up yet. Contact HR to set up leave types.
          </CardContent>
        </Card>
      )}

      {/* Leave Requests */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">My Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leave requests yet.</p>
          ) : (
            <div className="space-y-2">
              {requests.map((req) => (
                <div
                  key={req.id}
                  className="flex items-center justify-between border rounded p-3 text-sm gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{req.leaveType.name}</span>
                      <Badge className={`text-xs border-0 ${STATUS_COLOR[req.status]}`}>
                        {req.status}
                      </Badge>
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
                  {req.status === 'pending' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-red-500 shrink-0"
                      disabled={cancelling === req.id}
                      onClick={() => handleCancel(req.id)}
                    >
                      {cancelling === req.id
                        ? <Loader2 size={13} className="animate-spin" />
                        : <X size={14} />
                      }
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Request Leave Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Leave</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Leave Type *</Label>
              <Select
                value={form.leaveTypeId}
                onValueChange={(v) => setForm((f) => ({ ...f, leaveTypeId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type…" />
                </SelectTrigger>
                <SelectContent>
                  {leaveTypes.map((lt) => {
                    const bal = balances.find((b) => b.leaveType.id === lt.id);
                    const available = bal ? bal.entitled + bal.carriedOver - bal.used : 0;
                    return (
                      <SelectItem key={lt.id} value={lt.id}>
                        {lt.name}
                        {bal && (
                          <span className="text-muted-foreground ml-1 text-xs">
                            ({available} days left)
                          </span>
                        )}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start Date *</Label>
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>End Date *</Label>
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                />
              </div>
            </div>

            {days > 0 && (
              <p className="text-sm text-muted-foreground">
                {days} business day(s) requested
              </p>
            )}

            <div className="space-y-1.5">
              <Label>Reason (optional)</Label>
              <Textarea
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="Brief reason…"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !form.leaveTypeId || !form.startDate || !form.endDate}
            >
              {submitting && <Loader2 size={14} className="animate-spin mr-1" />}
              Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
