/**
 * Multi-select skills picker for jobs — same SKILL_OPTIONS and combobox UX
 * as the employee form so job screening criteria match employee skills.
 */
import { useState } from 'react';
import { ChevronsUpDown, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SKILL_OPTIONS } from '@/components/employees/form/formTypes';

type JobSkillsPickerProps = {
  selected: string[];
  onChange: (skills: string[]) => void;
  badgeVariant?: 'default' | 'secondary';
  emptyLabel?: string;
};

export function JobSkillsPicker({
  selected,
  onChange,
  badgeVariant = 'secondary',
  emptyLabel = 'Search and select skills…',
}: JobSkillsPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const toggleSkill = (skill: string) => {
    const trimmed = skill.trim();
    if (!trimmed) return;
    onChange(
      selected.includes(trimmed)
        ? selected.filter((s) => s !== trimmed)
        : [...selected, trimmed],
    );
  };

  const showAddCustom =
    query.trim().length > 1 &&
    !SKILL_OPTIONS.some((s) => s.toLowerCase() === query.trim().toLowerCase()) &&
    !selected.some((s) => s.toLowerCase() === query.trim().toLowerCase());

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            className="w-full justify-between font-normal text-muted-foreground"
          >
            {selected.length > 0
              ? `${selected.length} skill${selected.length === 1 ? '' : 's'} selected`
              : emptyLabel}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput
              placeholder="Search skills…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>No matching skill.</CommandEmpty>
              <CommandGroup>
                {showAddCustom && (
                  <CommandItem
                    value={`add-${query}`}
                    onSelect={() => {
                      toggleSkill(query);
                      setQuery('');
                    }}
                  >
                    <Plus className="h-3.5 w-3.5 mr-2" />
                    Add “{query.trim()}”
                  </CommandItem>
                )}
                {SKILL_OPTIONS.map((skill) => (
                  <CommandItem key={skill} value={skill} onSelect={() => toggleSkill(skill)}>
                    <Checkbox
                      checked={selected.includes(skill)}
                      className="mr-2 pointer-events-none"
                    />
                    {skill}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((skill) => (
            <Badge key={skill} variant={badgeVariant} className="gap-1 pr-1 font-normal">
              {skill}
              <button
                type="button"
                onClick={() => toggleSkill(skill)}
                className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                aria-label={`Remove ${skill}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
