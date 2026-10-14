import { WORKING_HOURS_TIME_ZONE_LABEL } from '@/lib/workingHours';

export function WorkingHoursTimezoneNote() {
  return (
    <p className="text-xs text-muted-foreground">
      {WORKING_HOURS_TIME_ZONE_LABEL}. Daylight saving time adjusts automatically.
    </p>
  );
}
