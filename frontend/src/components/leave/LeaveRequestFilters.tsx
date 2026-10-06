import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import type { LeaveDurationFilter, LeaveRequestStatus, LeaveStatusFilter } from '@/lib/leaveFilters';

const STATUS_LABELS: Record<LeaveRequestStatus, string> = {
  pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled',
};
const ALL_STATUSES: readonly LeaveRequestStatus[] = ['pending', 'approved', 'rejected', 'cancelled'];

interface LeaveRequestFiltersProps {
  duration: LeaveDurationFilter;
  status?: LeaveStatusFilter;
  statuses?: readonly LeaveRequestStatus[];
  onDurationChange: (value: LeaveDurationFilter) => void;
  onStatusChange?: (value: LeaveStatusFilter) => void;
}

export default function LeaveRequestFilters({
  duration, status, statuses = ALL_STATUSES, onDurationChange, onStatusChange,
}: LeaveRequestFiltersProps) {
  const id = useId();
  const durationLabelId = `${id}-duration-label`;
  const statusId = `${id}-status`;
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="min-w-0 space-y-1.5">
        <Label id={durationLabelId} className="text-xs text-muted-foreground">Duration</Label>
        <ToggleGroup
          type="single"
          value={duration}
          onValueChange={(value) => {
            if (value === 'all' || value === 'hourly' || value === 'half_day' || value === 'full_day') onDurationChange(value);
          }}
          aria-labelledby={durationLabelId}
          className="grid grid-cols-4 gap-1 rounded-lg bg-muted/50 p-1"
        >
          {([
            ['all', 'All'], ['hourly', 'Hourly'], ['half_day', 'Half Day'], ['full_day', 'Full Day'],
          ] as const).map(([value, label]) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className="h-9 whitespace-nowrap rounded-md px-2 text-xs data-[state=on]:bg-card data-[state=on]:text-primary data-[state=on]:shadow-sm sm:px-4"
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {status !== undefined && onStatusChange && <div className="w-full space-y-1.5 sm:w-44">
        <Label htmlFor={statusId} className="text-xs text-muted-foreground">Status</Label>
        <Select value={status} onValueChange={(value) => {
          if (value === 'all' || value === 'pending' || value === 'approved' || value === 'rejected' || value === 'cancelled') onStatusChange(value);
        }}>
          <SelectTrigger id={statusId} className="h-11 rounded-lg bg-card"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {statuses.map((value) => <SelectItem key={value} value={value}>{STATUS_LABELS[value]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>}
    </div>
  );
}
