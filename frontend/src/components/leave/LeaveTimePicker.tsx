import { useState } from 'react';
import { Check, ChevronDown, Clock3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { leaveTimeMinutes, formatLeaveTime, leaveMinutesToTime } from '@/lib/leave';
import { cn } from '@/lib/utils';

/** Exact times remain available alongside the fifteen-minute suggestions. */
function typedTimes(query: string): number[] {
  const match = query.trim().match(/^(\d{1,2})(?::(\d{1,2}))?\s*(am|pm|a|p)?$/i);
  if (!match) return [];
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const period = match[3]?.toLowerCase()[0];
  if (minute > 59 || hour > 23 || (period && (hour < 1 || hour > 12))) return [];
  if (period) return [(hour % 12 + (period === 'p' ? 12 : 0)) * 60 + minute];
  if (hour === 0 || hour > 12) return [hour * 60 + minute];
  return [(hour % 12) * 60 + minute, (hour % 12 + 12) * 60 + minute];
}

interface LeaveTimePickerProps {
  id: string;
  label: string;
  value: string;
  minMinutes: number;
  maxMinutes: number;
  disabled?: boolean;
  invalid?: boolean;
  onChange: (value: string) => void;
}

export default function LeaveTimePicker({
  id, label, value, minMinutes, maxMinutes, disabled, invalid, onChange,
}: LeaveTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const current = leaveTimeMinutes(value);
  const exact = typedTimes(query);
  const slots = new Set([minMinutes, maxMinutes, ...exact]);
  for (let minute = Math.ceil(minMinutes / 15) * 15; minute <= maxMinutes; minute += 15) slots.add(minute);
  if (current !== null) slots.add(current);
  const normalizedQuery = query.replace(/\s/g, '').toLowerCase();
  const options = [...slots].filter((minute) => minute >= 0 && minute < 1440 && minute >= minMinutes && minute <= maxMinutes)
    .sort((left, right) => Number(exact.includes(right)) - Number(exact.includes(left)) || left - right)
    .filter((minute) => !normalizedQuery || exact.includes(minute)
      || formatLeaveTime(leaveMinutesToTime(minute)).replace(/\s/g, '').toLowerCase().includes(normalizedQuery));

  return (
    <Popover open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); setQuery(''); }}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          aria-describedby="leave-time-feedback"
          disabled={disabled}
          className={cn('h-12 w-full justify-between gap-2 rounded-xl bg-background px-3 text-sm shadow-none hover:border-primary/50 hover:bg-background', invalid && 'border-destructive')}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <Clock3 className="text-muted-foreground" aria-hidden="true" />
            <span className={cn('truncate tabular-nums', !value && 'font-normal text-muted-foreground')}>
              {formatLeaveTime(value) || 'Select time'}
            </span>
          </span>
          <ChevronDown className="text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        collisionPadding={12}
        className="w-[var(--radix-popover-trigger-width)] min-w-[240px] rounded-xl p-0 shadow-lg"
        // Keep the parent dialog's scroll lock from cancelling events in this portal.
        onWheel={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
      >
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Type a time, e.g. 2:30 PM" aria-label={`${label}: search or enter a time`} className="text-sm" />
          <CommandList className="max-h-[216px] overflow-y-auto overscroll-contain touch-pan-y">
            <CommandEmpty className="px-4 py-5 text-sm text-muted-foreground">
              Choose a time between {formatLeaveTime(leaveMinutesToTime(minMinutes))} and {formatLeaveTime(leaveMinutesToTime(maxMinutes))}.
            </CommandEmpty>
            <CommandGroup heading={query ? 'Matching times' : 'Suggested times'}>
              {options.map((minute) => {
                const time = leaveMinutesToTime(minute);
                return (
                  <CommandItem
                    key={time}
                    value={time}
                    className="cursor-pointer justify-between rounded-lg px-3 py-2.5 tabular-nums"
                    onSelect={() => { onChange(time); setOpen(false); setQuery(''); }}
                  >
                    {formatLeaveTime(time)}
                    {value === time && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">Select a suggestion or type an exact time.</p>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
