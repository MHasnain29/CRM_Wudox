import { useState, type ReactNode } from 'react';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type SearchableComboboxOption = {
  value: string;
  label: string;
  searchValue: string;
  renderOption?: ReactNode;
};

export type SearchableComboboxGroup = {
  heading: string;
  options: SearchableComboboxOption[];
};

type Props = {
  value: string;
  onValueChange: (value: string) => void;
  /** Flat list (used when `groups` is not provided). */
  options?: SearchableComboboxOption[];
  /** Optional sectioned list — search still filters across all groups. */
  groups?: SearchableComboboxGroup[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  className?: string;
};

function OptionItem({
  option,
  selected,
  onSelect,
}: {
  option: SearchableComboboxOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      // cmdk keys items by `value` — append stable id so duplicates in searchValue cannot collide
      value={`${option.searchValue} ${option.value}`}
      className="cursor-pointer"
      onSelect={onSelect}
    >
      <Check
        className={cn('mr-2 h-4 w-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')}
      />
      {option.renderOption ?? <span className="truncate">{option.label}</span>}
    </CommandItem>
  );
}

export function SearchableCombobox({
  value,
  onValueChange,
  options = [],
  groups,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyMessage = 'No results found.',
  disabled = false,
  loading = false,
  loadingLabel = 'Loading…',
  className,
}: Props) {
  const [open, setOpen] = useState(false);

  const flatOptions = groups?.length
    ? groups.flatMap((g) => g.options)
    : options;

  const selected = flatOptions.find((o) => o.value === value);
  const triggerLabel = loading ? loadingLabel : selected?.label ?? placeholder;
  const inactive = disabled || loading;

  const handleSelect = (next: string) => {
    onValueChange(next);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (inactive) return;
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={inactive}
          className={cn(
            'h-9 w-full justify-between font-normal',
            !value && !loading && 'text-muted-foreground',
            className,
          )}
        >
          <span className="truncate text-left">
            {loading && <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />}
            {triggerLabel}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0 bg-popover"
        align="start"
        // Dialog body also scrolls — stop wheel so the list can scroll instead.
        onWheel={(e) => e.stopPropagation()}
      >
        <Command shouldFilter>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="max-h-[280px] overflow-y-auto overscroll-contain">
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            {groups?.length ? (
              groups
                .filter((g) => g.options.length > 0)
                .map((group) => (
                  <CommandGroup key={group.heading} heading={group.heading}>
                    {group.options.map((option) => (
                      <OptionItem
                        key={option.value}
                        option={option}
                        selected={option.value === value}
                        onSelect={() => handleSelect(option.value)}
                      />
                    ))}
                  </CommandGroup>
                ))
            ) : (
              <CommandGroup>
                {options.map((option) => (
                  <OptionItem
                    key={option.value}
                    option={option}
                    selected={option.value === value}
                    onSelect={() => handleSelect(option.value)}
                  />
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
