import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Clock, LogIn, LogOut } from 'lucide-react';
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

export function CheckInWidget() {
  const [record, setRecord] = useState<AttendanceRecord | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<{ data: AttendanceRecord | null }>('/attendance/status').then((r) => {
      if (r.ok) setRecord(r.data.data ?? null);
    });
  }, []);

  async function handleCheckin() {
    setLoading(true);
    const res = await apiFetch<{ data: AttendanceRecord }>('/attendance/checkin', { method: 'POST' }) as any;
    setLoading(false);
    if (res.ok) { setRecord(res.data.data); toast.success('Checked in'); }
    else toast.error(res.data?.error ?? 'Check-in failed');
  }

  async function handleCheckout() {
    setLoading(true);
    const res = await apiFetch<{ data: AttendanceRecord }>('/attendance/checkout', { method: 'POST' }) as any;
    setLoading(false);
    if (res.ok) { setRecord(res.data.data); toast.success('Checked out'); }
    else toast.error(res.data?.error ?? 'Check-out failed');
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
            {!checkedIn && <p className="text-sm font-medium">Not checked in yet</p>}
            {checkedIn && !checkedOut && (
              <>
                <p className="text-sm font-medium">Checked in at {format(new Date(record!.checkInAt), 'h:mm a')}</p>
                <p className="text-xs text-muted-foreground">Remember to check out when you're done</p>
              </>
            )}
            {checkedOut && (
              <>
                <p className="text-sm font-medium text-green-700">Done for today — {record!.totalMinutes ? formatMinutes(record!.totalMinutes) : '—'} logged</p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(record!.checkInAt), 'h:mm a')} → {format(new Date(record!.checkOutAt!), 'h:mm a')}
                </p>
              </>
            )}
          </div>
        </div>
        {!checkedIn && (
          <Button size="sm" onClick={handleCheckin} disabled={loading} className="shrink-0">
            <LogIn className="h-3.5 w-3.5 mr-1.5" /> Check In
          </Button>
        )}
        {checkedIn && !checkedOut && (
          <Button size="sm" variant="outline" onClick={handleCheckout} disabled={loading} className="shrink-0">
            <LogOut className="h-3.5 w-3.5 mr-1.5" /> Check Out
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
