/**
 * VisibilityPicker — reusable 4-option visibility selector + user picker.
 *
 * One canonical model:
 *   only_me        → Private (only the author)
 *   public         → My agency (everyone in the author's agency)
 *   public_global  → All agencies (everyone, every agency)
 *   shared         → Specific people (hand-picked users)
 *
 * Consumers (Notes, Remarks, future features) pass the value + change handlers
 * and capability flags. Mapping to backend shape (e.g. Remarks splits this into
 * `visibility + scope`) is the consumer's job — see toRemarkPayload / fromRemark
 * helpers at the bottom of this file.
 */
import { useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getUserRoleTitle } from '@/lib/roleLabels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command';

export type Visibility = 'only_me' | 'public' | 'public_global' | 'shared';

export interface VisibilityShareableUser {
  id: string;
  name: string;
  role: string;
}

interface Props {
  visibility: Visibility;
  sharedWith: string[];
  onVisibilityChange: (v: Visibility) => void;
  onSharedWithChange: (ids: string[]) => void;
  /** Show the "My agency" option. */
  canPostPublic: boolean;
  /** Show the "All agencies" option. */
  canPostGlobal: boolean;
  /** Users selectable when "Specific people" is chosen. */
  shareableUsers: VisibilityShareableUser[];
  /** Called when the user switches to 'shared' so the parent can lazy-load users. */
  onRequestShareableUsers?: () => void;
  /** Keep accessible IDs unique when multiple pickers live on the same screen. */
  idPrefix?: string;
  /** Hide the "Visibility" label (e.g. when the parent renders its own heading). */
  hideLabel?: boolean;
  /** Compact mode — narrower trigger, useful in inline forms. */
  compact?: boolean;
  className?: string;
}

interface OptionRow {
  value: Visibility;
  title: string;
  description: string;
  enabled: boolean;
}

export function VisibilityPicker({
  visibility,
  sharedWith,
  onVisibilityChange,
  onSharedWithChange,
  canPostPublic,
  canPostGlobal,
  shareableUsers,
  onRequestShareableUsers,
  idPrefix = 'visibility',
  hideLabel,
  compact,
  className,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const options: OptionRow[] = [
    { value: 'only_me',       title: 'Private',         description: 'Only you can see this',        enabled: true },
    { value: 'public',        title: 'My agency',       description: 'Everyone in your agency',      enabled: canPostPublic },
    { value: 'public_global', title: 'All agencies',    description: 'Visible to every agency',      enabled: canPostGlobal },
    { value: 'shared',        title: 'Specific people', description: 'Only the users you pick',      enabled: true },
  ];

  const handleVisibilityChange = (next: Visibility) => {
    onVisibilityChange(next);
    if (next === 'shared') {
      onRequestShareableUsers?.();
    } else {
      onSharedWithChange([]);
    }
  };

  const toggleUser = (userId: string) => {
    onSharedWithChange(
      sharedWith.includes(userId)
        ? sharedWith.filter((id) => id !== userId)
        : [...sharedWith, userId],
    );
  };

  return (
    <div className={cn('space-y-2', className)}>
      {!hideLabel && <Label htmlFor={`${idPrefix}-picker`}>Visibility</Label>}
      <Select value={visibility} onValueChange={(v) => handleVisibilityChange(v as Visibility)}>
        <SelectTrigger
          id={`${idPrefix}-picker`}
          className={cn(
            // Auto-grow to fit the two-line "title + description" content.
            // Default Select trigger is h-10 with line-clamp-1; override both.
            'w-full h-auto py-2 [&>span]:line-clamp-none [&>span]:text-left',
            compact ? 'min-h-[44px] text-sm' : 'min-h-[52px]',
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.filter((o) => o.enabled).map((o) => (
            <SelectItem key={o.value} value={o.value}>
              <span className="flex flex-col items-start py-0.5">
                <span className="text-sm font-medium">{o.title}</span>
                <span className="text-xs text-muted-foreground">{o.description}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {visibility === 'shared' && (
        <div className="space-y-2">
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn('w-full justify-between text-sm', compact ? 'h-8' : 'h-9')}
              >
                {sharedWith.length === 0
                  ? 'Select users to share with…'
                  : `${sharedWith.length} user${sharedWith.length > 1 ? 's' : ''} selected`}
                <ChevronsUpDown className="ml-2 h-3 w-3 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0 bg-popover" align="start">
              <Command>
                <CommandInput placeholder="Search users…" />
                <CommandEmpty>No users found.</CommandEmpty>
                <CommandGroup className="max-h-52 overflow-y-auto">
                  {shareableUsers.map((u) => (
                    <CommandItem
                      key={u.id}
                      value={u.name}
                      onSelect={() => toggleUser(u.id)}
                    >
                      <Check className={cn('mr-2 h-4 w-4', sharedWith.includes(u.id) ? 'opacity-100' : 'opacity-0')} />
                      <div className="flex-1">
                        <span className="text-sm font-medium">{u.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{getUserRoleTitle(u)}</span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </Command>
            </PopoverContent>
          </Popover>
          {sharedWith.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {sharedWith.map((uid) => {
                const u = shareableUsers.find((x) => x.id === uid);
                if (!u) return null;
                return (
                  <Badge key={uid} variant="secondary" className="text-xs gap-1">
                    {u.name}
                    <button
                      type="button"
                      onClick={() => onSharedWithChange(sharedWith.filter((id) => id !== uid))}
                      className="hover:text-destructive"
                      aria-label={`Remove ${u.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Adapters for the Remark shape (visibility + scope split) ───────────────
// Remarks predate the unified model and use { visibility, scope }. These helpers
// keep consumers honest: convert in both directions in ONE place.

export type RemarkBackendVisibility = 'only_me' | 'public' | 'shared';
export type RemarkBackendScope = 'agency' | 'global';

/** UI 4-value visibility → backend Remark payload fragment. */
export function toRemarkPayload(
  visibility: Visibility,
  sharedWith: string[],
): {
  visibility: RemarkBackendVisibility;
  scope?: RemarkBackendScope;
  sharedWith?: string[];
} {
  if (visibility === 'public_global') {
    return { visibility: 'public', scope: 'global' };
  }
  if (visibility === 'public') {
    return { visibility: 'public', scope: 'agency' };
  }
  if (visibility === 'shared') {
    return { visibility: 'shared', sharedWith };
  }
  return { visibility: 'only_me' };
}

/** Backend remark → UI 4-value visibility. */
export function fromRemark(
  visibility: RemarkBackendVisibility,
  scope: RemarkBackendScope | null | undefined,
): Visibility {
  if (visibility === 'public') {
    return scope === 'global' ? 'public_global' : 'public';
  }
  return visibility;
}
