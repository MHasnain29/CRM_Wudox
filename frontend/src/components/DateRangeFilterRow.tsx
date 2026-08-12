import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { DateRange } from 'react-day-picker';
import {
  DATE_PERIOD_OPTIONS,
  type DatePeriodPreset,
} from '@/lib/dateRangeFilter';

interface Props {
  period: DatePeriodPreset;
  customRange?: DateRange;
  onPeriodChange: (period: DatePeriodPreset) => void;
  onCustomRangeChange: (range: DateRange | undefined) => void;
  className?: string;
}

export function DateRangeFilterRow({
  period,
  customRange,
  onPeriodChange,
  onCustomRangeChange,
  className,
}: Props) {
  return (
    <div className={cn('flex flex-wrap items-end gap-4', className)}>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
            {DATE_PERIOD_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {period === 'custom' && (
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Select Dates
          </Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  'w-[280px] h-10 justify-start text-left font-normal bg-muted/40 border-border/60 hover:bg-muted/60 transition-colors',
                  !customRange?.from && 'text-muted-foreground',
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                {customRange?.from ? (
                  customRange.to ? (
                    <>
                      {format(customRange.from, 'LLL dd, y')} – {format(customRange.to, 'LLL dd, y')}
                    </>
                  ) : (
                    format(customRange.from, 'LLL dd, y')
                  )
                ) : (
                  <span>Pick a date range</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarComponent
                initialFocus
                mode="range"
                defaultMonth={customRange?.from}
                selected={customRange}
                onSelect={onCustomRangeChange}
                numberOfMonths={2}
              />
            </PopoverContent>
          </Popover>
        </div>
      )}
    </div>
  );
}
