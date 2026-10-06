import { Badge } from '@/components/ui/badge';
import { HOURLY_LEAVE_CATEGORY_LABELS, LEAVE_SESSION_LABELS, type LeaveTimingFields } from '@/lib/leave';

export default function LeaveDurationBadge({ session = 'full_day', hourlyCategory }: LeaveTimingFields) {
  const halfDay = session === 'first_half' || session === 'second_half';
  const hourly = session === 'hourly';

  return (
    <Badge
      variant={halfDay || hourly ? 'info' : 'muted'}
      className="px-2 py-0 text-[10px] leading-5 whitespace-nowrap"
      title={hourly && hourlyCategory ? HOURLY_LEAVE_CATEGORY_LABELS[hourlyCategory] : LEAVE_SESSION_LABELS[session ?? 'full_day']}
    >
      {hourly ? 'Hourly' : halfDay ? 'Half Day' : 'Full Day'}
    </Badge>
  );
}
