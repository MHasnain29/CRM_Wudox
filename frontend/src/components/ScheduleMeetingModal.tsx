import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { Loader2, Calendar, Clock, MapPin, FileText, Check, ChevronsUpDown, User, Star, Video } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { createMeetingWithError, fetchClients, fetchClient, checkMeetingParticipantsAvailability } from '@/lib/api';
import { useAuthStore } from '@/lib/authStore';
import { useCanAddMeetingParticipants } from '@/lib/access';
import { useWriteAgencyId } from '@/hooks/useWriteAgencyId';
import { MeetingStaffParticipantsPicker } from '@/components/meetings/MeetingStaffParticipantsPicker';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface ScheduleMeetingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  subCompanyId?: string;
}

export function ScheduleMeetingModal({ open, onOpenChange, onCreated, subCompanyId }: ScheduleMeetingModalProps) {
  const user = useAuthStore((s) => s.user);
  const canAddParticipants = useCanAddMeetingParticipants();
  // Act-as → linked agency; else prop / login JWT agency (never mock store ids).
  const resolvedAgencyId = useWriteAgencyId(
    subCompanyId && /^[0-9a-f-]{36}$/i.test(subCompanyId) ? subCompanyId : undefined,
  );
  const googleConnected = user?.googleCalendarConnected ?? false;
  const googleConnectedEmail = user?.googleConnectedEmail ?? null;
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [location, setLocation] = useState('');
  const [agenda, setAgenda] = useState('');
  const [googleAutoMeetLink, setGoogleAutoMeetLink] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [clients, setClients] = useState<{ id: string; name: string; location: string | null; industry: string | null; corporateCode: string | null }[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const [contactId, setContactId] = useState('');
  const [contacts, setContacts] = useState<{ id: string; name: string; title: string | null; email: string | null; isPrimary: boolean }[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [attendeeUserIds, setAttendeeUserIds] = useState<string[]>([]);

  const startISO =
    date && startTime ? new Date(`${date}T${startTime}:00`).toISOString() : null;
  const endISO =
    date && endTime ? new Date(`${date}T${endTime}:00`).toISOString() : null;

  useEffect(() => {
    if (!open) return;
    setLoadingClients(true);
    fetchClients({ limit: 500, ...(resolvedAgencyId ? { subCompanyId: resolvedAgencyId } : {}) })
      .then((res) => {
        const list = (res as any)?.data ?? res;
        if (Array.isArray(list)) {
          setClients(list.map((c: any) => ({ id: c.id, name: c.name, location: c.location ?? null, industry: c.industry ?? null, corporateCode: c.corporateCode ?? null })));
        }
      })
      .catch(() => {})
      .finally(() => setLoadingClients(false));
  }, [open, resolvedAgencyId]);

  useEffect(() => {
    if (!clientId) {
      setContacts([]);
      setContactId('');
      return;
    }
    setLoadingContacts(true);
    setContactId('');
    fetchClient(clientId)
      .then((client) => {
        if (client?.contacts) {
          const mapped = client.contacts.map((c) => ({ id: c.id, name: c.name, title: c.title, email: c.email, isPrimary: c.isPrimary }));
          setContacts(mapped);
          if (mapped.length === 1) {
            setContactId(mapped[0].id);
          } else if (mapped.length > 1) {
            const primary = mapped.find((c) => c.isPrimary);
            if (primary) setContactId(primary.id);
          }
        }
      })
      .catch(() => setContacts([]))
      .finally(() => setLoadingContacts(false));
  }, [clientId]);

  const resetForm = () => {
    setTitle('');
    setClientId('');
    setContactId('');
    setContacts([]);
    setAttendeeUserIds([]);
    setDate(format(new Date(), 'yyyy-MM-dd'));
    setStartTime('09:00');
    setEndTime('10:00');
    setLocation('');
    setAgenda('');
    setGoogleAutoMeetLink(true);
  };

  const handleSubmit = async () => {
    if (!title.trim()) return toast.error('Title is required');
    if (!clientId) return toast.error('Please select a client');

    const startISOSubmit = new Date(`${date}T${startTime}:00`).toISOString();
    const endISOSubmit = new Date(`${date}T${endTime}:00`).toISOString();

    if (new Date(endISOSubmit) <= new Date(startISOSubmit)) {
      return toast.error('End time must be after start time');
    }

    // Hard-block only on CRM conflicts; Google FreeBusy is advisory
    const checkIds = [
      ...(user?.id ? [user.id] : []),
      ...(canAddParticipants ? attendeeUserIds : []),
    ];
    if (checkIds.length > 0) {
      const avail = await checkMeetingParticipantsAvailability({
        startTime: startISOSubmit,
        endTime: endISOSubmit,
        userIds: [...new Set(checkIds)],
        subCompanyId: resolvedAgencyId,
      });
      const crmBusy = avail?.results.filter((r) => !r.available) ?? [];
      if (crmBusy.length > 0) {
        const youBusy = user?.id && crmBusy.some((r) => r.userId === user.id);
        const conflict = crmBusy[0]?.conflicts[0];
        const detail = conflict
          ? ` Conflicts with "${conflict.title}"${conflict.subCompanyName ? ` (${conflict.subCompanyName})` : ''}.`
          : '';
        return toast.error(
          youBusy
            ? `You already have a meeting at this time.${detail}`
            : `${crmBusy.length} participant${crmBusy.length === 1 ? ' is' : 's are'} busy at this time.${detail}`,
        );
      }
      const gcalBusy = avail?.results.filter((r) => r.available && r.googleBusy) ?? [];
      if (gcalBusy.length > 0) {
        toast.message('Google Calendar shows someone as busy — CRM has no conflict; continuing…');
      }
    }

    setSubmitting(true);
    const result = await createMeetingWithError({
      clientId,
      title: title.trim(),
      startTime: startISOSubmit,
      endTime: endISOSubmit,
      location: location.trim() || undefined,
      meetingLink: undefined,
      agenda: agenda.trim() || undefined,
      attendeeContactIds: contactId ? [contactId] : undefined,
      attendeeUserIds: canAddParticipants && attendeeUserIds.length > 0 ? attendeeUserIds : undefined,
      googleAutoMeetLink: googleConnected ? googleAutoMeetLink : false,
      subCompanyId: resolvedAgencyId,
    });
    setSubmitting(false);

    if ('meeting' in result) {
      resetForm();
      onOpenChange(false);
      onCreated();
      toast.success('Meeting scheduled — email sent to participants and client contact');
    } else {
      toast.error(result.error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">Schedule Meeting</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="meeting-title">Title *</Label>
            <Input
              id="meeting-title"
              placeholder="e.g. IT Staffing Requirements Discussion"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Client *</Label>
            {loadingClients ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading clients...
              </div>
            ) : (
              <Popover open={clientOpen} onOpenChange={setClientOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className={cn(
                      'w-full justify-between font-normal',
                      !clientId && 'text-muted-foreground'
                    )}
                  >
                    {clientId
                      ? clients.find((c) => c.id === clientId)?.name ?? 'Select a client'
                      : 'Select a client'}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start" onWheel={(e) => e.stopPropagation()}>
                  <Command>
                    <CommandInput placeholder="Search clients..." />
                    <CommandList className="max-h-[240px]">
                      <CommandEmpty>No client found.</CommandEmpty>
                      <CommandGroup>
                        {clients.map((c) => {
                          const details = [c.location, c.industry, c.corporateCode].filter(Boolean).join(' · ');
                          return (
                            <CommandItem
                              key={c.id}
                              value={`${c.name} ${c.location ?? ''} ${c.industry ?? ''} ${c.corporateCode ?? ''}`.trim()}
                              onSelect={() => {
                                setClientId(c.id);
                                setClientOpen(false);
                              }}
                            >
                              <Check className={cn('mr-2 h-4 w-4 shrink-0', c.id === clientId ? 'opacity-100' : 'opacity-0')} />
                              <div className="flex flex-col min-w-0">
                                <span className="truncate font-medium">{c.name}</span>
                                {details && (
                                  <span className="text-xs text-muted-foreground group-data-[selected=true]:text-accent-foreground truncate">{details}</span>
                                )}
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </div>

          {clientId && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <User className="h-3.5 w-3.5" /> Contact
              </Label>
              {loadingContacts ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading contacts...
                </div>
              ) : contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No contacts found for this client</p>
              ) : contacts.length === 1 ? (
                <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5 bg-muted/30">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-semibold shrink-0">
                    {contacts[0].name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium flex items-center gap-1">
                      {contacts[0].name}
                      {contacts[0].isPrimary && <Star className="h-3 w-3 fill-yellow-400 text-yellow-400 shrink-0" />}
                    </span>
                    {(contacts[0].title || contacts[0].email) && (
                      <span className="text-xs text-muted-foreground truncate">
                        {contacts[0].title}{contacts[0].title && contacts[0].email && ' · '}{contacts[0].email}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <Popover open={contactOpen} onOpenChange={setContactOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className={cn('w-full justify-between font-normal h-auto py-2', !contactId && 'text-muted-foreground')}
                    >
                      {contactId ? (() => {
                        const c = contacts.find((c) => c.id === contactId);
                        return c ? (
                          <div className="flex items-center gap-2 text-left">
                            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-semibold shrink-0">
                              {c.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="text-sm font-medium flex items-center gap-1">
                                {c.name}
                                {c.isPrimary && <Star className="h-3 w-3 fill-yellow-400 text-yellow-400 shrink-0" />}
                              </span>
                              {(c.title || c.email) && (
                                <span className="text-xs text-muted-foreground truncate">
                                  {c.title}{c.title && c.email && ' · '}{c.email}
                                </span>
                              )}
                            </div>
                          </div>
                        ) : 'Select a contact';
                      })() : 'Select a contact'}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start" onWheel={(e) => e.stopPropagation()}>
                    <Command>
                      <CommandInput placeholder="Search contacts..." />
                      <CommandList className="max-h-[200px]">
                        <CommandEmpty>No contact found.</CommandEmpty>
                        <CommandGroup>
                          {contacts.map((c) => (
                            <CommandItem
                              key={c.id}
                              value={`${c.name} ${c.title ?? ''} ${c.email ?? ''}`.trim()}
                              onSelect={() => {
                                setContactId(c.id);
                                setContactOpen(false);
                              }}
                            >
                              <Check className={cn('mr-2 h-4 w-4 shrink-0', c.id === contactId ? 'opacity-100' : 'opacity-0')} />
                              <div className="flex flex-col min-w-0">
                                <span className="truncate font-medium flex items-center gap-1">
                                  {c.name}
                                  {c.isPrimary && <Star className="h-3 w-3 fill-yellow-400 text-yellow-400 shrink-0" />}
                                </span>
                                {(c.title || c.email) && (
                                  <span className="text-xs text-muted-foreground group-data-[selected=true]:text-accent-foreground truncate">
                                    {c.title && `${c.title}`}{c.title && c.email && ' · '}{c.email}
                                  </span>
                                )}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          )}

          {canAddParticipants && (
            <MeetingStaffParticipantsPicker
              subCompanyId={resolvedAgencyId}
              value={attendeeUserIds}
              onChange={setAttendeeUserIds}
              startTimeISO={startISO}
              endTimeISO={endISO}
            />
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="meeting-date" className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" /> Date *
              </Label>
              <Input id="meeting-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="meeting-start" className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> Start *
              </Label>
              <Input id="meeting-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="meeting-end" className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> End *
              </Label>
              <Input id="meeting-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="meeting-location" className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> Location
            </Label>
            <Input id="meeting-location" placeholder="e.g. Conference Room B" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>

          {googleConnected ? (
            <div className="flex items-center justify-between rounded-lg border px-3 py-2.5 bg-muted/30">
              <div className="flex items-center gap-2">
                <Video className="h-4 w-4 text-blue-500" />
                <div>
                  <p className="text-sm font-medium leading-none">Auto-generate Google Meet link</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Event will be created on agency calendar{googleConnectedEmail ? ` (${googleConnectedEmail})` : ''}; you and the client are added as guests.
                  </p>
                </div>
              </div>
              <Switch checked={googleAutoMeetLink} onCheckedChange={setGoogleAutoMeetLink} />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="meeting-agenda" className="flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" /> Agenda
            </Label>
            <Textarea id="meeting-agenda" placeholder="Meeting agenda..." value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={3} />
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="flex-1" onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Schedule Meeting
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
