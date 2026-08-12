import { useEffect, useState } from 'react';
import { Check, ChevronsUpDown, Loader2, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  fetchMeetingParticipantCandidates,
  checkMeetingParticipantsAvailability,
  type MeetingAvailabilityResult,
} from '@/lib/api';
import { useAuthStore } from '@/lib/authStore';
import { useCanAccessMultipleAgencies } from '@/lib/access';
import { useEffectiveUser } from '@/lib/effectiveUser';
import { useWriteAgencyId } from '@/hooks/useWriteAgencyId';
import { format } from 'date-fns';

type StaffOption = {
  id: string;
  name: string;
  email: string;
  designation: string;
  subCompanyName?: string | null;
};

interface MeetingStaffParticipantsPickerProps {
  subCompanyId?: string;
  value: string[];
  onChange: (ids: string[]) => void;
  excludeUserIds?: string[];
  startTimeISO?: string | null;
  endTimeISO?: string | null;
  /** Exclude this meeting from CRM conflict checks (edit mode). */
  excludeMeetingId?: string;
}

export function MeetingStaffParticipantsPicker({
  subCompanyId,
  value,
  onChange,
  excludeUserIds = [],
  startTimeISO,
  endTimeISO,
  excludeMeetingId,
}: MeetingStaffParticipantsPickerProps) {
  const { id: effectiveSelfId } = useEffectiveUser();
  const homeAgencyId = useAuthStore((s) => s.user?.subCompanyId ?? null);
  const multiAgency = useCanAccessMultipleAgencies();
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const actAsOrPropAgency = useWriteAgencyId(
    subCompanyId && uuidRe.test(subCompanyId) ? subCompanyId : undefined,
  );
  // Explicit real agency (incl. act-as), else home for field staff. Elevated with no filter → all agencies.
  const agencyFilter =
    actAsOrPropAgency ||
    (!multiAgency && homeAgencyId && uuidRe.test(homeAgencyId) ? homeAgencyId : undefined);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<StaffOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [availabilityByUser, setAvailabilityByUser] = useState<Record<string, MeetingAvailabilityResult>>({});
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [googleChecked, setGoogleChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchMeetingParticipantCandidates(
      agencyFilter ? { subCompanyId: agencyFilter } : undefined,
    )
      .then((list) => {
        if (cancelled) return;
        const exclude = new Set([...(excludeUserIds ?? []), effectiveSelfId].filter(Boolean) as string[]);
        const mapped = list
          .filter((u) => !exclude.has(u.id))
          .map((u) => ({
            id: u.id,
            name: `${u.firstName} ${u.lastName}`.trim(),
            email: u.email ?? '',
            designation: u.userType ?? u.role ?? '',
            subCompanyName: u.subCompanyName,
          }));
        setUsers(mapped);
        if (mapped.length === 0) {
          setLoadError('No ops managers or multi-agency linked users in scope.');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUsers([]);
          setLoadError('Failed to load participants.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agencyFilter, multiAgency, effectiveSelfId, excludeUserIds.join(',')]);

  useEffect(() => {
    if (!value.length || !startTimeISO || !endTimeISO) {
      setAvailabilityByUser({});
      setGoogleChecked(false);
      return;
    }
    const start = new Date(startTimeISO);
    const end = new Date(endTimeISO);
    if (!(end > start)) {
      setAvailabilityByUser({});
      setGoogleChecked(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setCheckingAvailability(true);
      checkMeetingParticipantsAvailability({
        startTime: startTimeISO,
        endTime: endTimeISO,
        userIds: value,
        excludeMeetingId,
        subCompanyId: agencyFilter,
      })
        .then((res) => {
          if (cancelled || !res) {
            if (!cancelled) {
              setAvailabilityByUser({});
              setGoogleChecked(false);
            }
            return;
          }
          const map: Record<string, MeetingAvailabilityResult> = {};
          for (const r of res.results) map[r.userId] = r;
          setAvailabilityByUser(map);
          setGoogleChecked(Boolean(res.googleChecked));
        })
        .catch(() => {
          if (!cancelled) {
            setAvailabilityByUser({});
            setGoogleChecked(false);
          }
        })
        .finally(() => {
          if (!cancelled) setCheckingAvailability(false);
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [value.join(','), startTimeISO, endTimeISO, excludeMeetingId, agencyFilter]);

  const isSoftBusy = (avail?: MeetingAvailabilityResult) =>
    Boolean(avail && (!avail.available || avail.googleBusy));

  const busyLabel = (avail?: MeetingAvailabilityResult) => {
    if (!avail) return null;
    if (!avail.available) return 'Busy';
    if (avail.googleBusy) return 'GCal busy';
    return 'Free';
  };

  const selectedOrdered = value
    .map((id) => users.find((u) => u.id === id) ?? { id, name: id.slice(0, 8), email: '', designation: '' })
    .filter(Boolean);

  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  };

  const remove = (id: string) => onChange(value.filter((x) => x !== id));

  const crmBusySelected = selectedOrdered.filter((u) => availabilityByUser[u.id]?.available === false);
  const gcalOnlyBusy = selectedOrdered.filter(
    (u) => availabilityByUser[u.id]?.available !== false && availabilityByUser[u.id]?.googleBusy,
  );

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1">
        <Users className="h-3.5 w-3.5" /> Participants
        {checkingAvailability && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-1" />}
      </Label>
      <p className="text-xs text-muted-foreground">
        Ops managers and multi-agency linked accounts only. CRM availability is checked across their agencies
        {googleChecked ? '; Google FreeBusy checked when connected.' : '.'}
      </p>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading users...
        </div>
      ) : (
        <>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                className={cn(
                  'w-full justify-between font-normal h-auto min-h-10 py-2',
                  value.length === 0 && 'text-muted-foreground',
                )}
              >
                <span className="truncate">
                  {value.length === 0
                    ? 'Add staff participants…'
                    : `${value.length} participant${value.length === 1 ? '' : 's'} selected`}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start" onWheel={(e) => e.stopPropagation()}>
              <Command shouldFilter>
                <CommandInput placeholder="Search staff…" />
                <CommandList className="max-h-[220px]">
                  <CommandEmpty>{loadError ?? 'No users found.'}</CommandEmpty>
                  <CommandGroup>
                    {users.map((u) => {
                      const checked = value.includes(u.id);
                      const avail = availabilityByUser[u.id];
                      const label = busyLabel(avail);
                      return (
                        <CommandItem
                          key={u.id}
                          value={`${u.name} ${u.email} ${u.designation} ${u.subCompanyName ?? ''}`}
                          onSelect={() => toggle(u.id)}
                        >
                          <Check className={cn('mr-2 h-4 w-4 shrink-0', checked ? 'opacity-100' : 'opacity-0')} />
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="truncate font-medium">{u.name}</span>
                            <span className="text-xs text-muted-foreground truncate">
                              {[u.designation, u.email, u.subCompanyName].filter(Boolean).join(' · ')}
                            </span>
                          </div>
                          {checked && label && (
                            <span
                              className={cn(
                                'ml-2 text-[10px] font-medium shrink-0',
                                isSoftBusy(avail) ? 'text-amber-600' : 'text-emerald-600',
                              )}
                            >
                              {label}
                            </span>
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {selectedOrdered.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {selectedOrdered.map((u) => {
                const avail = availabilityByUser[u.id];
                const busy = isSoftBusy(avail);
                const tip = !avail?.available && avail?.conflicts[0]
                  ? `${avail.conflicts[0].title} (${format(new Date(avail.conflicts[0].startTime), 'MMM d h:mm a')}${avail.conflicts[0].subCompanyName ? ` · ${avail.conflicts[0].subCompanyName}` : ''})`
                  : avail?.googleBusy
                    ? 'Busy on Google Calendar (soft warning)'
                    : undefined;
                return (
                  <Badge
                    key={u.id}
                    variant="secondary"
                    title={tip}
                    className={cn(
                      'gap-1 pr-1 font-normal',
                      busy && 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300',
                      avail && !busy && 'border-emerald-500/30 bg-emerald-500/10',
                    )}
                  >
                    {u.name}
                    {avail && (
                      <span className="text-[10px] opacity-80">{busyLabel(avail)?.toLowerCase()}</span>
                    )}
                    <button
                      type="button"
                      className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                      onClick={() => remove(u.id)}
                      aria-label={`Remove ${u.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
            </div>
          )}

          {crmBusySelected.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {crmBusySelected.length === 1
                ? `${crmBusySelected[0].name} has an overlapping CRM meeting (blocks schedule).`
                : `${crmBusySelected.length} participants have overlapping CRM meetings (blocks schedule).`}
            </p>
          )}
          {gcalOnlyBusy.length > 0 && crmBusySelected.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Google Calendar shows busy for {gcalOnlyBusy.map((u) => u.name).join(', ')} — advisory only; CRM has no conflict.
            </p>
          )}
        </>
      )}
    </div>
  );
}
