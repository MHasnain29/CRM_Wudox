import { ArrowRight, Clock3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { formatLeaveMinutes, formatLeaveTime, leaveMinutesToTime, leaveTimeMinutes, type LeavePolicy } from '@/lib/leave';
import LeaveTimePicker from './LeaveTimePicker';

interface HourlyLeaveFieldsProps {
  startTime: string;
  endTime: string;
  durationMinutes: number;
  policy: LeavePolicy | null;
  error: string;
  onStartTimeChange: (value: string) => void;
  onEndTimeChange: (value: string) => void;
}

export default function HourlyLeaveFields({
  startTime, endTime, durationMinutes, policy, error,
  onStartTimeChange, onEndTimeChange,
}: HourlyLeaveFieldsProps) {
  const startMinutes = leaveTimeMinutes(startTime);
  const workStart = policy ? leaveTimeMinutes(policy.workStartTime) : null;
  const workEnd = policy ? leaveTimeMinutes(policy.workEndTime) : null;
  const scheduleReady = workStart !== null && workEnd !== null && workEnd > workStart;
  const startReady = scheduleReady && startMinutes !== null && startMinutes >= workStart && startMinutes < workEnd;
  const ready = durationMinutes > 0 && !error;

  function changeStart(value: string) {
    const minutes = leaveTimeMinutes(value);
    onStartTimeChange(value);
    // Moving the start preserves the chosen duration when it still fits the workday.
    onEndTimeChange(minutes !== null && workEnd !== null && durationMinutes > 0 && minutes + durationMinutes <= workEnd
      ? leaveMinutesToTime(minutes + durationMinutes) : '');
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="leave-start-time">Start Time *</Label>
          <LeaveTimePicker
            id="leave-start-time"
            label="Start Time"
            value={startTime}
            minMinutes={workStart ?? 0}
            maxMinutes={(workEnd ?? 1) - 1}
            disabled={!scheduleReady}
            invalid={!!error}
            onChange={changeStart}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="leave-end-time">End Time *</Label>
          <LeaveTimePicker
            id="leave-end-time"
            label="End Time"
            value={endTime}
            minMinutes={(startMinutes ?? workStart ?? 0) + 1}
            maxMinutes={workEnd ?? 0}
            disabled={!startReady}
            invalid={!!error}
            onChange={onEndTimeChange}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Quick duration">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Quick duration</span>
        {[30, 60, 120, 180].map((minutes) => (
          <Button
            key={minutes}
            type="button"
            size="sm"
            variant={ready && durationMinutes === minutes ? 'default' : 'outline'}
            className="h-8 rounded-full px-3 shadow-none"
            aria-pressed={ready && durationMinutes === minutes}
            disabled={!startReady || startMinutes + minutes > workEnd}
            onClick={() => { if (startMinutes !== null) onEndTimeChange(leaveMinutesToTime(startMinutes + minutes)); }}
          >
            {minutes === 30 ? '30 min' : formatLeaveMinutes(minutes)}
          </Button>
        ))}
      </div>
      <div id="leave-time-feedback" role={error ? 'alert' : 'status'} aria-live="polite">
        {error ? <p className="text-sm text-destructive">{error}</p> : ready ? (
          <div className="flex items-start gap-3 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Clock3 size={18} aria-hidden="true" /></div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">Total time away</p>
              <p className="mt-0.5 text-lg font-semibold leading-tight text-foreground">{formatLeaveMinutes(durationMinutes)}</p>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {formatLeaveTime(startTime)} <ArrowRight size={12} aria-label="to" /> {formatLeaveTime(endTime)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Recorded only. Your leave balance stays the same.</p>
            </div>
          </div>
        ) : <p className="text-xs text-muted-foreground">{startReady ? 'Choose an end time or a quick duration.' : 'Choose a start time, then an end time or quick duration.'}</p>}
      </div>
      {policy?.timezone && <p className="text-[11px] text-muted-foreground">
        {policy.timezone === 'America/Toronto' ? 'Toronto time' : policy.timezone} · Working hours {formatLeaveTime(policy.workStartTime)} – {formatLeaveTime(policy.workEndTime)}
      </p>}
    </div>
  );
}
