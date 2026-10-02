import { Badge } from '@/components/ui/badge';
import { LEAVE_SESSION_LABELS, type LeaveSession } from '@/lib/leave';

export default function LeaveDurationBadge({ session = 'full_day' }: { session?: LeaveSession }) {
  const halfDay = session === 'first_half' || session === 'second_half';

  return (
    <Badge
      variant={halfDay ? 'info' : 'muted'}
      className="px-2 py-0 text-[10px] leading-5 whitespace-nowrap"
      title={LEAVE_SESSION_LABELS[session]}
    >
      {halfDay ? 'Half Day' : 'Full Day'}
    </Badge>
  );
}
