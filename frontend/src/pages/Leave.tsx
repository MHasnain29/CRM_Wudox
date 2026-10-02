import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '@/lib/api';
import { announceLeaveChange, countLeaveDays, formatLeavePeriod, onLeaveDataRefresh, useLeaveScopeKey, type LeaveSession } from '@/lib/leave';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import LeaveDurationBadge from '@/components/LeaveDurationBadge';
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
  session?: LeaveSession;
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
  const scopeKey = useLeaveScopeKey();
  const activeScope = useRef(scopeKey);
  activeScope.current = scopeKey;
  const fetchVersion = useRef(0);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedScope, setLoadedScope] = useState('');

  const [showDialog, setShowDialog] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [form, setForm] = useState({
    leaveTypeId: '',
    startDate: '',
    endDate: '',
    duration: 'full_day',
    session: '' as LeaveSession | '',
    reason: '',
  });

  const fetchData = useCallback((showLoader = false) => {
    const version = ++fetchVersion.current;
    const isCurrent = () => activeScope.current === scopeKey && fetchVersion.current === version;
    if (showLoader) setLoading(true);
    Promise.all([
      apiFetch<any>('/leave/balances/me'),
      apiFetch<any>('/leave/requests?mine=true'),
      apiFetch<any>('/leave/types?mine=true'),
    ]).then(([balRes, reqRes, typRes]) => {
      if (!isCurrent()) return;
      setBalances(balRes.ok ? balRes.data?.data ?? [] : []);
      setRequests(reqRes.ok ? reqRes.data?.data ?? [] : []);
      setLeaveTypes(typRes.ok ? typRes.data?.data ?? [] : []);
      if (!balRes.ok || !reqRes.ok || !typRes.ok) toast.error('Failed to load leave data');
    }).catch(() => { if (isCurrent()) toast.error('Failed to load leave data'); })
      .finally(() => { if (isCurrent()) { setLoadedScope(scopeKey); setLoading(false); } });
  }, [scopeKey]);

  useEffect(() => {
    setBalances([]);
    setRequests([]);
    setLeaveTypes([]);
    setShowDialog(false);
    setSubmitting(false);
    setCancelling(null);
    setForm({ leaveTypeId: '', startDate: '', endDate: '', duration: 'full_day', session: '', reason: '' });
    fetchData(true);
    return () => { fetchVersion.current += 1; };
  }, [fetchData]);

  useEffect(() => {
    const unsub = onLeaveDataRefresh(() => fetchData());
    return () => { unsub(); };
  }, [fetchData]);

  const halfDay = form.duration === 'half_day';
  const days = countLeaveDays(form.startDate, form.endDate, halfDay);
  const datesReady = !!form.startDate && (halfDay || !!form.endDate);
  const dateError = !datesReady ? ''
    : !halfDay && form.endDate < form.startDate ? 'End date cannot be before start date.'
    : days <= 0 ? (halfDay
      ? 'This date is a weekend. Choose a working day (Monday–Friday).'
      : 'These dates contain only weekends. Choose a range with at least one working day (Monday–Friday).')
    : '';

  async function handleSubmit() {
    if (!form.leaveTypeId || !form.startDate || (halfDay ? !form.session : !form.endDate)) return;
    if (dateError) {
      toast.error(dateError);
      return;
    }
    setSubmitting(true);
    const res = await apiFetch<any>('/leave/requests', {
      method: 'POST',
      body: JSON.stringify({
        leaveTypeId: form.leaveTypeId,
        startDate: form.startDate,
        endDate: halfDay ? form.startDate : form.endDate,
        session: halfDay ? form.session : 'full_day',
        reason: form.reason || undefined,
      }),
    });
    if (activeScope.current !== scopeKey) return;
    if (res.ok === true) {
      setShowDialog(false);
      setForm({ leaveTypeId: '', startDate: '', endDate: '', duration: 'full_day', session: '', reason: '' });
      announceLeaveChange();
      toast.success('Leave request submitted');
    } else {
      toast.error((res as any).error ?? 'Failed to submit request');
    }
    setSubmitting(false);
  }

  async function handleCancel(reqId: string) {
    setCancelling(reqId);
    const res = await apiFetch<any>(`/leave/requests/${reqId}/cancel`, { method: 'PATCH' });
    if (activeScope.current !== scopeKey) return;
    if (res.ok === true) {
      setRequests((prev) =>
        prev.map((r) => (r.id === reqId ? { ...r, status: 'cancelled' } : r))
      );
      toast.success('Request cancelled');
      announceLeaveChange();
    } else {
      toast.error(res.error ?? 'Failed to cancel request');
    }
    setCancelling(null);
  }

  if (loading || loadedScope !== scopeKey) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="animate-spin mr-2" size={20} /> Loading leave data…
      </div>
    );
  }

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
            No leave balances set up yet. Contact your Super Admin to set up leave types.
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
                      <LeaveDurationBadge session={req.session} />
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

            <div className="space-y-1.5">
              <Label>Duration *</Label>
              <Select value={form.duration} onValueChange={(duration) => setForm((f) => ({ ...f, duration, session: '' }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_day">Full Day</SelectItem>
                  <SelectItem value="half_day">Half Day</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.duration === 'half_day' && (
              <div className="space-y-1.5">
                <Label htmlFor="leave-session">Which Half? *</Label>
                <Select value={form.session} onValueChange={(session: LeaveSession) => setForm((f) => ({ ...f, session }))}>
                  <SelectTrigger id="leave-session" aria-describedby={!form.session ? 'leave-session-hint' : undefined}><SelectValue placeholder="Select half…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="first_half">First Half</SelectItem>
                    <SelectItem value="second_half">Second Half</SelectItem>
                  </SelectContent>
                </Select>
                {!form.session && <p id="leave-session-hint" className="text-sm text-muted-foreground">Choose First Half or Second Half to submit a half-day request.</p>}
              </div>
            )}

            <div className={form.duration === 'half_day' ? '' : 'grid grid-cols-2 gap-3'}>
              <div className="space-y-1.5">
                <Label htmlFor="leave-start-date">{form.duration === 'half_day' ? 'Date *' : 'Start Date *'}</Label>
                <Input
                  id="leave-start-date"
                  type="date"
                  aria-invalid={!!dateError}
                  aria-describedby="leave-date-feedback"
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                />
              </div>
              {form.duration === 'full_day' && <div className="space-y-1.5">
                <Label htmlFor="leave-end-date">End Date *</Label>
                <Input
                  id="leave-end-date"
                  type="date"
                  aria-invalid={!!dateError}
                  aria-describedby="leave-date-feedback"
                  min={form.startDate || undefined}
                  value={form.endDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                />
              </div>}
            </div>

            <p id="leave-date-feedback" role={dateError ? 'alert' : undefined} className={`text-sm ${dateError ? 'text-destructive' : 'text-muted-foreground'}`}>
              {dateError || (days > 0
                ? `${days} working day(s) requested. Weekends are excluded.`
                : 'Leave is counted Monday–Friday. Weekends are excluded.')}
            </p>

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
              disabled={submitting || !form.leaveTypeId || !form.startDate || (form.duration === 'half_day' ? !form.session : !form.endDate) || days <= 0}
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
