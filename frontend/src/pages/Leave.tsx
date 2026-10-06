import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '@/lib/api';
import { useHasAllPermissions } from '@/hooks/usePermission';
import { matchesLeaveRequestFilters, type LeaveDurationFilter, type LeaveStatusFilter } from '@/lib/leaveFilters';
import {
  announceLeaveChange, countHourlyLeaveMinutes, countLeaveDays, formatLeaveDays,
  formatLeavePeriod, leaveTimeMinutes, onLeaveDataRefresh, useLeaveScopeKey,
  type LeavePolicy, type LeaveSession, type LeaveTimingFields,
} from '@/lib/leave';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import LeaveDurationBadge from '@/components/LeaveDurationBadge';
import HourlyLeaveFields from '@/components/leave/HourlyLeaveFields';
import LeaveRequestFilters from '@/components/leave/LeaveRequestFilters';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { CalendarClock, CalendarDays, CalendarOff, CalendarPlus, Clock3, Plus, Loader2, X } from 'lucide-react';
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

interface LeaveRequest extends LeaveTimingFields {
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

const EMPTY_LEAVE_FORM = {
  leaveTypeId: '',
  startDate: '',
  endDate: '',
  duration: 'full_day',
  session: '' as LeaveSession | '',
  startTime: '',
  endTime: '',
  reason: '',
};

export default function Leave() {
  const canWrite = useHasAllPermissions('leave:read', 'leave:write');
  const scopeKey = useLeaveScopeKey();
  const activeScope = useRef(scopeKey);
  activeScope.current = scopeKey;
  const fetchVersion = useRef(0);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [policy, setPolicy] = useState<LeavePolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedScope, setLoadedScope] = useState('');
  const [requestDuration, setRequestDuration] = useState<LeaveDurationFilter>('all');
  const [requestStatus, setRequestStatus] = useState<LeaveStatusFilter>('all');
  const filteredRequests = requests.filter((request) => matchesLeaveRequestFilters(request, requestDuration, requestStatus));

  const [showDialog, setShowDialog] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_LEAVE_FORM);

  const fetchData = useCallback((showLoader = false) => {
    const version = ++fetchVersion.current;
    const isCurrent = () => activeScope.current === scopeKey && fetchVersion.current === version;
    if (showLoader) setLoading(true);
    Promise.all([
      apiFetch<any>('/leave/balances/me'),
      apiFetch<any>('/leave/requests?mine=true'),
      apiFetch<any>('/leave/types?mine=true'),
      apiFetch<{ data: LeavePolicy }>('/leave/policy/me'),
    ]).then(([balRes, reqRes, typRes, policyRes]) => {
      if (!isCurrent()) return;
      setBalances(balRes.ok ? balRes.data?.data ?? [] : []);
      setRequests(reqRes.ok ? reqRes.data?.data ?? [] : []);
      setLeaveTypes(typRes.ok ? typRes.data?.data ?? [] : []);
      setPolicy(policyRes.ok ? policyRes.data?.data ?? null : null);
      if (!balRes.ok || !reqRes.ok || !typRes.ok) toast.error('Failed to load leave data');
    }).catch(() => { if (isCurrent()) toast.error('Failed to load leave data'); })
      .finally(() => { if (isCurrent()) { setLoadedScope(scopeKey); setLoading(false); } });
  }, [scopeKey]);

  useEffect(() => {
    setBalances([]);
    setRequests([]);
    setRequestDuration('all');
    setRequestStatus('all');
    setLeaveTypes([]);
    setPolicy(null);
    setShowDialog(false);
    setSubmitting(false);
    setCancelling(null);
    setForm(EMPTY_LEAVE_FORM);
    fetchData(true);
    return () => { fetchVersion.current += 1; };
  }, [fetchData]);

  useEffect(() => {
    const unsub = onLeaveDataRefresh(() => fetchData());
    return () => { unsub(); };
  }, [fetchData]);

  const halfDay = form.duration === 'half_day';
  const hourly = form.duration === 'hourly';
  const singleDay = halfDay || hourly;
  const timezone = policy?.timezone;
  const startTime = form.startTime;
  const durationMinutes = countHourlyLeaveMinutes(startTime, form.endTime);
  const days = countLeaveDays(form.startDate, form.endDate, singleDay);
  const datesReady = !!form.startDate && (singleDay || !!form.endDate);
  const dateError = !datesReady ? ''
    : !singleDay && form.endDate < form.startDate ? 'End date cannot be before start date.'
    : days <= 0 ? (singleDay
      ? 'This date is a weekend. Choose a working day (Monday–Friday).'
      : 'These dates contain only weekends. Choose a range with at least one working day (Monday–Friday).')
    : '';
  const workStart = policy ? leaveTimeMinutes(policy.workStartTime) : null;
  const workEnd = policy ? leaveTimeMinutes(policy.workEndTime) : null;
  const timeError = !hourly ? ''
    : !policy ? 'Hourly leave settings are unavailable. Please try again or contact your administrator.'
    : !timezone ? 'A timezone must be configured before requesting hourly leave.'
    : workStart === null || workEnd === null || workEnd <= workStart ? 'Hourly leave requires a work schedule that starts and ends on the same day. Contact your administrator.'
    : !startTime || !form.endTime ? ''
    : durationMinutes <= 0 ? 'End time must be after start time on the same date.'
    : startTime < policy.workStartTime || form.endTime > policy.workEndTime ? `Choose times within your working hours (${policy.workStartTime}–${policy.workEndTime}).`
    : '';
  const canSubmit = !!form.leaveTypeId && datesReady && !dateError && !timeError && days > 0
    && (hourly ? durationMinutes > 0 : !halfDay || !!form.session);

  async function handleSubmit() {
    if (!canWrite || submitting || !canSubmit) return;
    setSubmitting(true);
    const res = await apiFetch<any>('/leave/requests', {
      method: 'POST',
      body: JSON.stringify({
        leaveTypeId: form.leaveTypeId,
        startDate: form.startDate,
        endDate: singleDay ? form.startDate : form.endDate,
        session: hourly ? 'hourly' : halfDay ? form.session : 'full_day',
        ...(hourly ? {
          hourlyCategory: 'time_away',
          startTime,
          endTime: form.endTime,
          timezone,
        } : {}),
        reason: form.reason || undefined,
      }),
    });
    if (activeScope.current !== scopeKey) return;
    if (res.ok === true) {
      setShowDialog(false);
      setForm(EMPTY_LEAVE_FORM);
      announceLeaveChange();
      toast.success('Leave request submitted');
    } else {
      toast.error((res as any).error ?? 'Failed to submit request');
    }
    setSubmitting(false);
  }

  async function handleCancel(reqId: string) {
    if (!canWrite) return;
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
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <CalendarOff size={22} /> My Leave
        </h1>
        {canWrite && <Button onClick={() => setShowDialog(true)}>
          <Plus size={16} className="mr-1" /> Request Leave
        </Button>}
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
                    <p className="text-2xl font-bold mt-1">{formatLeaveDays(available)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatLeaveDays(b.used)} used / {b.entitled} entitled
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
            {leaveTypes.length > 0
              ? canWrite
                ? 'No leave balances are set up yet. Hourly Time Away can still be recorded.'
                : 'No leave balances are set up yet.'
              : 'No leave types are set up yet. Contact your Super Admin to set up leave types.'}
          </CardContent>
        </Card>
      )}

      {/* Leave Requests */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">My Requests</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <LeaveRequestFilters
            duration={requestDuration}
            status={requestStatus}
            onDurationChange={setRequestDuration}
            onStatusChange={setRequestStatus}
          />
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leave requests yet.</p>
          ) : filteredRequests.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-8 text-center" role="status">
              <p className="text-sm text-muted-foreground">No requests match these filters.</p>
              <Button variant="outline" size="sm" onClick={() => { setRequestDuration('all'); setRequestStatus('all'); }}>Clear filters</Button>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredRequests.map((req) => (
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
                      <LeaveDurationBadge session={req.session} hourlyCategory={req.hourlyCategory} />
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {formatLeavePeriod(req)}{req.session !== 'hourly' && ` · ${req.days} day(s)`}
                      {req.reason && ` · ${req.reason}`}
                    </div>
                    {req.approver && (
                      <div className="text-xs text-muted-foreground">
                        {req.status === 'approved' ? 'Approved' : 'Reviewed'} by{' '}
                        {req.approver.firstName} {req.approver.lastName}
                      </div>
                    )}
                  </div>
                  {canWrite && req.status === 'pending' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-red-500 shrink-0"
                      disabled={cancelling === req.id}
                      aria-label="Cancel leave request"
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
      <Dialog open={canWrite && showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-[560px] flex-col gap-0 overflow-hidden rounded-2xl bg-card p-0">
          <DialogHeader className="shrink-0 flex-row items-center gap-3 space-y-0 border-b px-5 py-5 pr-12 text-left sm:px-6 sm:pr-12">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <CalendarPlus size={22} aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <DialogTitle className="text-lg leading-snug">Request Leave</DialogTitle>
              <DialogDescription className="text-xs leading-relaxed sm:text-sm">Plan your time off or record time away.</DialogDescription>
            </div>
          </DialogHeader>
          <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
            <div className="space-y-2">
              <Label htmlFor="leave-type">Leave Type *</Label>
              <Select
                value={form.leaveTypeId}
                onValueChange={(v) => setForm((f) => ({ ...f, leaveTypeId: v }))}
              >
                <SelectTrigger id="leave-type" className="h-11 rounded-xl bg-card">
                  <SelectValue placeholder="Select type…" />
                </SelectTrigger>
                <SelectContent>
                  {leaveTypes.map((lt) => {
                    const bal = balances.find((b) => b.leaveType.id === lt.id);
                    const available = bal ? bal.entitled + bal.carriedOver - bal.used : 0;
                    return (
                      <SelectItem key={lt.id} value={lt.id}>
                        {lt.name}
                        {bal && !hourly && (
                          <span className="text-muted-foreground ml-1 text-xs">
                            ({formatLeaveDays(available)} days left)
                          </span>
                        )}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label id="leave-duration-label">Duration *</Label>
              <RadioGroup id="leave-duration" aria-labelledby="leave-duration-label" orientation="horizontal" className="grid grid-cols-3 gap-2" value={form.duration} onValueChange={(duration) => setForm((f) => ({
                ...f, duration, session: '', startTime: '', endTime: '',
              }))}>
                {[
                  { value: 'full_day', label: 'Full Day', icon: CalendarDays },
                  { value: 'half_day', label: 'Half Day', icon: CalendarClock },
                  { value: 'hourly', label: 'Hourly', icon: Clock3 },
                ].map(({ value, label, icon: Icon }) => (
                  <div key={value} className="relative">
                    <RadioGroupItem id={`leave-duration-${value}`} value={value} className="peer sr-only" />
                    <Label htmlFor={`leave-duration-${value}`} className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border bg-card px-2 py-3 text-xs text-muted-foreground transition-colors hover:bg-muted/50 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 sm:text-sm">
                      <Icon size={16} className="shrink-0" aria-hidden="true" />
                      {label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            {form.duration === 'half_day' && (
              <div className="space-y-2">
                <Label htmlFor="leave-session">Which Half? *</Label>
                <Select value={form.session} onValueChange={(session: LeaveSession) => setForm((f) => ({ ...f, session }))}>
                  <SelectTrigger id="leave-session" className="h-11 rounded-xl bg-card" aria-describedby={!form.session ? 'leave-session-hint' : undefined}><SelectValue placeholder="Select half…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="first_half">First Half</SelectItem>
                    <SelectItem value="second_half">Second Half</SelectItem>
                  </SelectContent>
                </Select>
                {!form.session && <p id="leave-session-hint" className="text-xs leading-relaxed text-muted-foreground">Choose First Half or Second Half to submit a half-day request.</p>}
              </div>
            )}

            <div className="space-y-4 rounded-xl border border-border/70 bg-muted/30 p-4">
              <div className={singleDay ? '' : 'grid grid-cols-1 gap-3 sm:grid-cols-2'}>
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="leave-start-date">{singleDay ? 'Date *' : 'Start Date *'}</Label>
                  <Input
                    id="leave-start-date"
                    type="date"
                    className="h-11 min-w-0 rounded-lg bg-card"
                    aria-invalid={!!dateError}
                    aria-describedby="leave-date-feedback"
                    value={form.startDate}
                    onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                  />
                </div>
                {form.duration === 'full_day' && <div className="min-w-0 space-y-2">
                  <Label htmlFor="leave-end-date">End Date *</Label>
                  <Input
                    id="leave-end-date"
                    type="date"
                    className="h-11 min-w-0 rounded-lg bg-card"
                    aria-invalid={!!dateError}
                    aria-describedby="leave-date-feedback"
                    min={form.startDate || undefined}
                    value={form.endDate}
                    onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                  />
                </div>}
              </div>

              <p id="leave-date-feedback" role={dateError ? 'alert' : undefined} className={`text-xs leading-relaxed ${dateError ? 'text-destructive' : 'text-muted-foreground'}`}>
                {dateError || (hourly ? 'Choose a working day (Monday–Friday).' : days > 0
                  ? `${days} working day(s) requested. Weekends are excluded.`
                  : 'Leave is counted Monday–Friday. Weekends are excluded.')}
              </p>

              {hourly && (
                <HourlyLeaveFields
                  startTime={startTime}
                  endTime={form.endTime}
                  durationMinutes={durationMinutes}
                  policy={policy}
                  error={timeError}
                  onStartTimeChange={(value) => setForm((f) => ({ ...f, startTime: value }))}
                  onEndTimeChange={(value) => setForm((f) => ({ ...f, endTime: value }))}
                />
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="leave-reason" className="flex items-center justify-between">Reason <span className="text-xs font-normal text-muted-foreground">Optional</span></Label>
              <Textarea
                id="leave-reason"
                className="min-h-[88px] resize-y rounded-xl bg-card"
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="Add a note about your request…"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter className="shrink-0 flex-row justify-end gap-2 border-t bg-muted/20 px-5 py-4 sm:space-x-0 sm:px-6">
            <Button variant="outline" className="h-11 rounded-xl bg-card px-5" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button
              className="h-11 rounded-xl px-5"
              onClick={handleSubmit}
              disabled={submitting || !canSubmit}
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
