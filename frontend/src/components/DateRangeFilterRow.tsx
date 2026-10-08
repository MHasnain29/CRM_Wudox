import { Calendar as CalendarIcon } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { DateRangePicker } from '@/components/DateRangePicker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { DateRange } from 'react-day-picker';
import {
  DATE_PERIOD_OPTIONS,
  type DatePeriodPreset,
} from '@/lib/dateRangeFilter';

interface Props {
  /** Dropdown entries. Defaults to DATE_PERIOD_OPTIONS so existing pages are unchanged. */
  options?: { value: DatePeriodPreset; label: string }[];
  period: DatePeriodPreset;
  customRange?: DateRange;
  onPeriodChange: (period: DatePeriodPreset) => void;
  onCustomRangeChange: (range: DateRange | undefined) => void;
  className?: string;
}

export function DateRangeFilterRow({
  options = DATE_PERIOD_OPTIONS,
  period,
  customRange,
  onPeriodChange,
  onCustomRangeChange,
  className,
}: Props) {
  return (
    <div className={cn('flex flex-wrap items-end gap-4', className)}>
      <div className="space-y-1.5">
        <Label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Date Range
        </Label>
        <Select value={period} onValueChange={(v) => onPeriodChange(v as DatePeriodPreset)}>
          <SelectTrigger className="w-[180px] h-10 bg-muted/40 border-border/60 hover:bg-muted/60 transition-colors">
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
              <SelectValue />
            </div>
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {period === 'custom' && (
        <div className="space-y-1.5">
          {/* Both captions are block: an inline <label> sat beside the button instead of above it and misaligned the two. */}
          <Label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Select Dates
          </Label>
          <DateRangePicker value={customRange} onApply={onCustomRangeChange} />
        </div>
      )}
    </div>
  );
}
