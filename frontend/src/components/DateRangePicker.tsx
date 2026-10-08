import { useId, useState } from 'react';
import { format } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { ArrowRight, Calendar as CalendarIcon } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  applyDayClick,
  describeDraft,
  draftFromRange,
  validateDraft,
  type RangeDraft,
} from '@/lib/dateRangeDraft';
import { PICKER_MAX_DATE, PICKER_MIN_DATE, parsePickerDate } from '@/lib/dateRangeFilter';
import { cn } from '@/lib/utils';

/**
 * Range styling: solid circles on the first/last day joined by one continuous soft band (the shared Calendar
 * paints every selected day as its own solid box with gaps between them). Passed per-instance, so every other
 * Calendar in the app is untouched. `!` wins over the base hover/today styles on the end days.
 */
const RANGE_CLASSNAMES = {
  months: 'flex flex-col gap-6 sm:flex-row',
  month: 'space-y-2',
  caption: 'relative flex h-8 items-center justify-center',
  caption_label: 'text-sm font-semibold',
  nav_button: cn(buttonVariants({ variant: 'outline' }), 'h-7 w-7 bg-transparent p-0 opacity-60 hover:opacity-100'),
  table: 'w-full border-collapse',
  head_row: 'flex',
  head_cell: 'w-9 text-[0.75rem] font-medium text-muted-foreground',
  row: 'mt-0.5 flex w-full',
  cell: cn(
    'relative h-9 w-9 p-0 text-center text-sm focus-within:relative focus-within:z-20',
    '[&:has([aria-selected])]:bg-primary/10',
    '[&:has(.day-range-start)]:rounded-l-full [&:has(.day-range-end)]:rounded-r-full',
    'first:[&:has([aria-selected])]:rounded-l-full last:[&:has([aria-selected])]:rounded-r-full',
  ),
  day: 'h-9 w-9 rounded-full p-0 text-sm font-normal transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 aria-selected:opacity-100',
  day_selected: '',
  day_range_start: 'day-range-start !bg-primary !text-primary-foreground hover:!bg-primary',
  day_range_end: 'day-range-end !bg-primary !text-primary-foreground hover:!bg-primary',
  day_range_middle: 'text-foreground',
  day_today: 'font-semibold text-primary',
  day_outside: 'invisible',
  day_hidden: 'invisible',
};

const FIELD_LABEL = 'block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

interface PanelProps {
  initialRange?: DateRange;
  onApply: (range: DateRange) => void;
  onCancel: () => void;
}

/** The popover body. Edits a draft; nothing is applied (or refetched) until Apply. */
export function DateRangePickerPanel({ initialRange, onApply, onCancel }: PanelProps) {
  const isMobile = useIsMobile();
  const id = useId();
  const [draft, setDraft] = useState<RangeDraft>(() => draftFromRange(initialRange));
  const [month, setMonth] = useState<Date>(() => initialRange?.from ?? new Date());

  const validation = validateDraft(draft);
  const from = parsePickerDate(draft.fromText) ?? undefined;
  const to = parsePickerDate(draft.toText) ?? undefined;
  const selected: DateRange | undefined = from ? { from, to } : undefined;
  const fromInvalid = draft.fromText !== '' && !from;
  const reversed = !!from && !!to && to.getTime() < from.getTime();
  const toInvalid = (draft.toText !== '' && !to) || reversed;

  const apply = () => {
    if (validation.ok) onApply({ from: validation.from, to: validation.to });
  };

  const onFromInput = (value: string) => {
    setDraft((d) => ({ ...d, fromText: value }));
    const parsed = parsePickerDate(value);
    if (parsed) setMonth(parsed); // jump the calendar to a typed start date
  };

  const enterToApply = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
  };

  return (
    <div className="max-w-[calc(100vw-1rem)]">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 border-b p-3">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-from`} className={FIELD_LABEL}>Start date</label>
          <Input
            id={`${id}-from`}
            type="date"
            min={PICKER_MIN_DATE}
            max={PICKER_MAX_DATE}
            value={draft.fromText}
            onChange={(e) => onFromInput(e.target.value)}
            onKeyDown={enterToApply}
            aria-invalid={fromInvalid}
            className={cn('h-9 text-sm', fromInvalid && 'border-destructive focus-visible:border-destructive')}
          />
        </div>
        <ArrowRight className="mb-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1.5">
          <label htmlFor={`${id}-to`} className={FIELD_LABEL}>End date</label>
          <Input
            id={`${id}-to`}
            type="date"
            min={PICKER_MIN_DATE}
            max={PICKER_MAX_DATE}
            value={draft.toText}
            onChange={(e) => setDraft((d) => ({ ...d, toText: e.target.value }))}
            onKeyDown={enterToApply}
            aria-invalid={toInvalid}
            className={cn('h-9 text-sm', toInvalid && 'border-destructive focus-visible:border-destructive')}
          />
        </div>
      </div>

      {!validation.ok && validation.error && (
        <p role="alert" className="px-3 pt-2 text-xs font-medium text-destructive">{validation.error}</p>
      )}

      <Calendar
        mode="range"
        numberOfMonths={isMobile ? 1 : 2}
        weekStartsOn={1}
        showOutsideDays={false}
        month={month}
        onMonthChange={setMonth}
        selected={selected}
        onSelect={(_range, day) => setDraft((d) => applyDayClick(d, day))}
        classNames={RANGE_CLASSNAMES}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2.5">
        <p className="text-xs text-muted-foreground" aria-live="polite">{describeDraft(validation)}</p>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button type="button" size="sm" onClick={apply} disabled={!validation.ok}>Apply</Button>
        </div>
      </div>
    </div>
  );
}

interface PopoverProps {
  value?: DateRange;
  onApply: (range: DateRange) => void;
  className?: string;
}

/** Trigger button showing the applied range; opens the picker panel. */
export function DateRangePicker({ value, onApply, className }: PopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            'h-10 w-[280px] justify-start border-border/60 bg-muted/40 text-left font-normal transition-colors hover:bg-muted/60',
            !value?.from && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
          {value?.from ? (
            <span className="truncate">
              {format(value.from, 'LLL dd, y')}
              {value.to && value.to.toDateString() !== value.from.toDateString() && ` – ${format(value.to, 'LLL dd, y')}`}
            </span>
          ) : (
            <span>Pick a date range</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={8}
        className="w-auto max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-0"
      >
        {/* Content unmounts on close, so every open starts from the applied range and Esc/outside-click discards edits. */}
        <DateRangePickerPanel
          initialRange={value}
          onApply={(range) => { onApply(range); setOpen(false); }}
          onCancel={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
