/**
 * AgencyMultiSelect — multi-select dropdown for elevated roles to filter by agency.
 * Only rendered when isElevated=true. Matches the Reports page user-filter style.
 */
import { Building2, ChevronDown, Check } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { ScrollArea } from './ui/scroll-area';
import { Skeleton } from './ui/skeleton';
import { cn } from '../lib/utils';
import type { Agency } from '../hooks/useAgencyFilter';

interface AgencyMultiSelectProps {
  agencies: Agency[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  isLoading?: boolean;
  placeholder?: string;
}

export function AgencyMultiSelect({
  agencies,
  selectedIds,
  onChange,
  isLoading,
  placeholder = 'All Agencies',
}: AgencyMultiSelectProps) {
  if (isLoading) {
    return <Skeleton className="h-9 w-44" />;
  }

  if (!agencies.length) return null;

  const allSelected = selectedIds.length === 0;
  const label = allSelected
    ? placeholder
    : selectedIds.length === 1
      ? (agencies.find((a) => a.id === selectedIds[0])?.name ?? '1 agency')
      : `${selectedIds.length} agencies`;

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-9 gap-1.5 pl-3 pr-2 text-sm font-normal',
            selectedIds.length > 0 && 'border-primary/60 bg-primary/5 text-primary'
          )}
        >
          <Building2 className="h-4 w-4 shrink-0" />
          <span className="max-w-[140px] truncate">{label}</span>
          {selectedIds.length > 0 && (
            <Badge variant="secondary" className="h-5 min-w-5 rounded-full px-1 text-xs">
              {selectedIds.length}
            </Badge>
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="p-0 w-64">
        {/* Header actions */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b">
          <span className="text-sm font-semibold">Filter by Agency</span>
          <div className="flex gap-1">
            <button
              className="text-xs text-muted-foreground hover:text-accent-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-accent"
              onClick={() => onChange([])}
            >
              All
            </button>
            <button
              className="text-xs text-primary hover:text-primary/80 transition-colors px-1.5 py-0.5 rounded hover:bg-primary/10"
              onClick={() => onChange(agencies.map((a) => a.id))}
            >
              Select all
            </button>
          </div>
        </div>
        {/* Agency list */}
        <ScrollArea className="max-h-64">
          <div className="py-1">
            {agencies.map((agency) => {
              const checked = selectedIds.includes(agency.id);
              return (
                <button
                  key={agency.id}
                  onClick={() => toggle(agency.id)}
                  className={cn(
                    'group flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground',
                    checked && 'bg-primary/5'
                  )}
                >
                  <div className={cn(
                    'h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                    checked ? 'bg-primary border-primary text-primary-foreground' : 'border-input'
                  )}>
                    {checked && <Check className="h-3 w-3" />}
                  </div>
                  <span className="flex-1 truncate text-sm">{agency.name}</span>
                </button>
              );
            })}
          </div>
        </ScrollArea>
        {/* Footer */}
        {selectedIds.length > 0 && (
          <div className="border-t px-3 py-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{selectedIds.length} selected</span>
            <button
              className="text-xs text-destructive hover:text-destructive/80 transition-colors"
              onClick={() => onChange([])}
            >
              Clear
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
