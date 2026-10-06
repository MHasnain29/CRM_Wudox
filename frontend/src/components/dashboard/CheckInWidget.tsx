import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Clock, LogIn, LogOut, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface AttendanceRecord {
  id: string;
  checkInAt: string;
  checkOutAt: string | null;
  totalMinutes: number | null;
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function CheckInWidget({ onAttendanceChange }: { onAttendanceChange?: () => void } = {}) {
  const [record, setRecord] = useState<AttendanceRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const mounted = useRef(true);
  const statusVersion = useRef(0);

  const loadStatus = useCallback(async (): Promise<boolean> => {
    const version = ++statusVersion.current;
    const isCurrent = () => mounted.current && statusVersion.current === version;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const res = await apiFetch<{ data: AttendanceRecord | null }>('/attendance/status');
      if (!isCurrent()) return false;
      if (res.ok === true) {
        setRecord(res.data.data ?? null);
        return true;
      }
      setStatusError(res.error ?? 'Unable to load today’s attendance. Please retry.');
    } catch {
      if (isCurrent()) setStatusError('Unable to load today’s attendance. Please retry.');
    } finally {
      if (isCurrent()) setStatusLoading(false);
    }
    return false;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void loadStatus();
    return () => {
      mounted.current = false;
      statusVersion.current += 1;
    };
  }, [loadStatus]);

  async function changeAttendance(action: 'checkin' | 'checkout') {
    if (loading || statusLoading || statusError) return;
    setLoading(true);
    const errorMessage = action === 'checkin' ? 'Check-in failed. Please retry.' : 'Check-out failed. Please retry.';
    try {
      const res = await apiFetch<{ data: AttendanceRecord }>(`/attendance/${action}`, { method: 'POST' });
      if (!mounted.current) return;
      if (res.ok === true) {
        setRecord(res.data.data);
        toast.success(action === 'checkin' ? 'Checked in' : 'Checked out');
        onAttendanceChange?.();
      } else {
        toast.error(res.error ?? errorMessage);
        if (res.status === 409 && await loadStatus()) onAttendanceChange?.();
      }
    } catch {
      if (mounted.current) toast.error(errorMessage);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }

  const checkedIn = !!record;
  const checkedOut = !!record?.checkOutAt;

  return (
    <Card className="border-2 border-primary/10">
      <CardContent className="flex items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${checkedOut ? 'bg-green-100' : checkedIn ? 'bg-orange-100' : 'bg-blue-50'}`}>
            <Clock className={`h-4 w-4 ${checkedOut ? 'text-green-600' : checkedIn ? 'text-orange-500' : 'text-blue-500'}`} />
          </div>
          <div>
            {statusLoading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading today’s attendance…</p>}
            {!statusLoading && statusError && <p role="alert" className="text-sm text-destructive">{statusError}</p>}
            {!statusLoading && !statusError && !checkedIn && <p className="text-sm font-medium">Not checked in yet</p>}
            {!statusLoading && !statusError && checkedIn && !checkedOut && (
              <>
                <p className="text-sm font-medium">Checked in at {format(new Date(record!.checkInAt), 'h:mm a')}</p>
                <p className="text-xs text-muted-foreground">Remember to check out when you're done</p>
              </>
            )}
            {!statusLoading && !statusError && checkedOut && (
              <>
                <p className="text-sm font-medium text-green-700">Done for today — {record!.totalMinutes != null ? formatMinutes(record!.totalMinutes) : '—'} logged</p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(record!.checkInAt), 'h:mm a')} → {format(new Date(record!.checkOutAt!), 'h:mm a')}
                </p>
              </>
            )}
          </div>
        </div>
        {!statusLoading && statusError && <Button size="sm" variant="outline" onClick={() => void loadStatus()} disabled={loading} className="shrink-0">Retry</Button>}
        {!statusLoading && !statusError && !checkedIn && (
          <Button size="sm" onClick={() => void changeAttendance('checkin')} disabled={loading} className="shrink-0">
            <LogIn className="h-3.5 w-3.5 mr-1.5" /> Check In
          </Button>
        )}
        {!statusLoading && !statusError && checkedIn && !checkedOut && (
          <Button size="sm" variant="outline" onClick={() => void changeAttendance('checkout')} disabled={loading} className="shrink-0">
            <LogOut className="h-3.5 w-3.5 mr-1.5" /> Check Out
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
