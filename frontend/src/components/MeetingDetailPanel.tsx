import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  X, Clock, Building2, User, Video, MapPin, Pencil, Trash2, Loader2,
  Calendar as CalendarIcon, FileText, StickyNote, Users, ExternalLink, Mail, Briefcase,
  CheckCircle2,
} from 'lucide-react';
import {
  ApiMeeting,
  ApiBookedMeeting,
  fetchMeeting,
  fetchBookedMeetings,
  updateMeeting,
  deleteMeeting,
  cancelBookedMeeting,
  completeMeeting,
  completeBookedMeeting,
  checkMeetingParticipantsAvailability,
} from '@/lib/api';
import { format, isPast } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { StickyHeader } from '@/components/StickyHeader';
import { useCanWriteMeetings, useCanAddMeetingParticipants } from '@/lib/access';
import { ForwardedChip } from '@/components/offboarding/ForwardedChip';
import { MeetingStaffParticipantsPicker } from '@/components/meetings/MeetingStaffParticipantsPicker';
import { useAuthStore } from '@/lib/authStore';

interface MeetingDetailPanelProps {
  meetingId: string;
  meetingType: 'meeting' | 'booked';
  onClose: () => void;
  onUpdated: () => void;
}

export function MeetingDetailPanel({ meetingId, meetingType, onClose, onUpdated }: MeetingDetailPanelProps) {
  const canWriteMeetings = useCanWriteMeetings();
  const canAddParticipants = useCanAddMeetingParticipants();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [meeting, setMeeting] = useState<ApiMeeting | null>(null);
  const [bookedMeeting, setBookedMeeting] = useState<ApiBookedMeeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [editTitle, setEditTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editAgenda, setEditAgenda] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editMeetingLink, setEditMeetingLink] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');
  const [editAttendeeUserIds, setEditAttendeeUserIds] = useState<string[]>([]);

  const hydrateEditFields = (m: ApiMeeting) => {
    setEditTitle(m.title);
    setEditNotes(m.notes || '');
    setEditAgenda(m.agenda || '');
    setEditLocation(m.location || '');
    setEditMeetingLink(m.meetingLink || '');
    setEditDate(format(new Date(m.startTime), 'yyyy-MM-dd'));
    setEditStartTime(format(new Date(m.startTime), 'HH:mm'));
    setEditEndTime(format(new Date(m.endTime), 'HH:mm'));
    setEditAttendeeUserIds(
      m.attendees.map((a) => a.userId).filter((id): id is string => Boolean(id)),
    );
  };

  useEffect(() => {
    setLoading(true);
    setEditing(false);
    if (meetingType === 'meeting') {
      fetchMeeting(meetingId).then((m) => {
        setMeeting(m);
        if (m) hydrateEditFields(m);
        setLoading(false);
      });
    } else {
      fetchBookedMeetings({ limit: 200 }).then((res) => {
        const found = res.data.find((m) => m.id === meetingId);
        setBookedMeeting(found || null);
        setLoading(false);
      });
    }
  }, [meetingId, meetingType]);

  const handleSave = async () => {
    if (!meeting) return;
    const startISO = new Date(`${editDate}T${editStartTime}:00`).toISOString();
    const endISO = new Date(`${editDate}T${editEndTime}:00`).toISOString();
    if (!(new Date(endISO) > new Date(startISO))) {
      toast.error('End time must be after start time');
      return;
    }

    const staffIds = canAddParticipants ? editAttendeeUserIds : undefined;
    const checkIds = [
      meeting.ownerId,
      ...(staffIds ?? meeting.attendees.map((a) => a.userId).filter(Boolean) as string[]),
    ];
    const avail = await checkMeetingParticipantsAvailability({
      startTime: startISO,
      endTime: endISO,
      userIds: [...new Set(checkIds)],
      excludeMeetingId: meeting.id,
      subCompanyId: meeting.subCompanyId,
    });
    const crmBusy = avail?.results.filter((r) => !r.available) ?? [];
    if (crmBusy.length > 0) {
      const conflict = crmBusy[0]?.conflicts[0];
      toast.error(
        conflict
          ? `Time conflict with "${conflict.title}"${conflict.subCompanyName ? ` (${conflict.subCompanyName})` : ''}`
          : 'Time conflict with an existing meeting',
      );
      return;
    }

    setSaving(true);
    const result = await updateMeeting(meeting.id, {
      title: editTitle.trim() || undefined,
      notes: editNotes.trim() || null,
      agenda: editAgenda.trim() || null,
      location: editLocation.trim() || null,
      meetingLink: editMeetingLink.trim() || null,
      startTime: startISO,
      endTime: endISO,
      ...(staffIds !== undefined ? { attendeeUserIds: staffIds } : {}),
    });
    setSaving(false);
    if (result) {
      setMeeting(result);
      hydrateEditFields(result);
      setEditing(false);
      toast.success('Meeting updated');
      onUpdated();
    } else {
      toast.error('Failed to update meeting');
    }
  };

  const handleDelete = async () => {
    if (!meeting) return;
    setDeleting(true);
    const ok = await deleteMeeting(meeting.id);
    setDeleting(false);
    if (ok) {
      toast.success('Meeting deleted');
      onClose();
      onUpdated();
    } else {
      toast.error('Failed to delete meeting');
    }
  };

  const handleCancel = async () => {
    if (!bookedMeeting) return;
    setDeleting(true);
    const ok = await cancelBookedMeeting(bookedMeeting.id);
    setDeleting(false);
    if (ok) {
      toast.success('Meeting cancelled');
      onClose();
      onUpdated();
    } else {
      toast.error('Failed to cancel meeting');
    }
  };

  const handleCompleteMeeting = () => {
    if (!meeting) return;
    setMeeting({ ...meeting, status: 'completed' });
    toast.success('Meeting marked as completed');
    onUpdated();
    completeMeeting(meeting.id).then((result) => {
      if (!result) {
        setMeeting(meeting);
        toast.error('Failed to complete meeting');
        onUpdated();
      }
    });
  };

  const handleCompleteBooked = () => {
    if (!bookedMeeting) return;
    setBookedMeeting({ ...bookedMeeting, status: 'completed' });
    toast.success('Meeting marked as completed');
    onUpdated();
    completeBookedMeeting(bookedMeeting.id).then((ok) => {
      if (!ok) {
        setBookedMeeting(bookedMeeting);
        toast.error('Failed to complete meeting');
        onUpdated();
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md bg-background border-l shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-200">
        {/* Header */}
        <StickyHeader
          zIndex={10}
          bleed={false}
          className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
        >
          <div className="px-5 py-4 flex items-center justify-between">
            <h2 className="font-semibold text-lg">Meeting Details</h2>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </StickyHeader>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : meetingType === 'meeting' && meeting ? (
          <div className="p-5 space-y-5">
            {editing ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Start</Label>
                      <Input type="time" value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>End</Label>
                      <Input type="time" value={editEndTime} onChange={(e) => setEditEndTime(e.target.value)} />
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Location</Label>
                  <Input value={editLocation} onChange={(e) => setEditLocation(e.target.value)} placeholder="Location" />
                </div>
                <div className="space-y-2">
                  <Label>Meeting Link</Label>
                  <Input value={editMeetingLink} onChange={(e) => setEditMeetingLink(e.target.value)} placeholder="https://..." />
                </div>
                <div className="space-y-2">
                  <Label>Agenda</Label>
                  <Textarea value={editAgenda} onChange={(e) => setEditAgenda(e.target.value)} rows={3} />
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3} />
                </div>
                {canAddParticipants && (
                  <MeetingStaffParticipantsPicker
                    subCompanyId={meeting.subCompanyId}
                    value={editAttendeeUserIds}
                    onChange={setEditAttendeeUserIds}
                    excludeUserIds={[meeting.ownerId, currentUserId].filter(Boolean) as string[]}
                    startTimeISO={editDate && editStartTime ? new Date(`${editDate}T${editStartTime}:00`).toISOString() : null}
                    endTimeISO={editDate && editEndTime ? new Date(`${editDate}T${editEndTime}:00`).toISOString() : null}
                    excludeMeetingId={meeting.id}
                  />
                )}
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => { setEditing(false); if (meeting) hydrateEditFields(meeting); }}>Cancel</Button>
                  <Button className="flex-1" onClick={handleSave} disabled={saving}>
                    {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Save Changes
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {/* Title + Type Badge + Status */}
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-xl font-bold leading-tight">{meeting.title}</h3>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {meeting.status === 'completed' && (
                        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 font-semibold text-[10px] uppercase tracking-wider px-2.5 py-0.5 gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Completed
                        </Badge>
                      )}
                      <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 border-blue-200 dark:border-blue-800 font-semibold text-[10px] uppercase tracking-wider px-2.5 py-0.5">
                        Client Meeting
                      </Badge>
                    </div>
                  </div>
                  {meeting.forwardedFromName && (
                    <ForwardedChip name={meeting.forwardedFromName} className="mt-0.5" />
                  )}
                  {meeting.ownerName && (
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <User className="h-3.5 w-3.5" />
                      <span>Organized by <span className="font-medium text-foreground/80">{meeting.ownerName}</span></span>
                    </div>
                  )}
                </div>

                {/* Date & Time Card */}
                <div className="rounded-xl border bg-gradient-to-br from-violet-50/80 via-white to-blue-50/50 dark:from-violet-950/20 dark:via-background dark:to-blue-950/10 overflow-hidden">
                  <div className="px-4 py-2.5 bg-violet-100/50 dark:bg-violet-900/20 border-b border-violet-200/50 dark:border-violet-800/30 flex items-center gap-2">
                    <div className="h-6 w-6 rounded-md bg-violet-500 dark:bg-violet-600 flex items-center justify-center">
                      <CalendarIcon className="h-3.5 w-3.5 text-white" />
                    </div>
                    <span className="text-xs font-semibold text-violet-700 dark:text-violet-300 uppercase tracking-wider">Schedule</span>
                  </div>
                  <div className="p-4 space-y-2.5">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center shrink-0">
                        <CalendarIcon className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                      </div>
                      <span className="text-sm font-medium">{format(new Date(meeting.startTime), 'EEEE, MMMM d, yyyy')}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center shrink-0">
                        <Clock className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                      </div>
                      <span className="text-sm font-medium">{format(new Date(meeting.startTime), 'h:mm a')} - {format(new Date(meeting.endTime), 'h:mm a')}</span>
                    </div>
                  </div>
                </div>

                {/* Details Card */}
                <div className="rounded-xl border bg-gradient-to-br from-blue-50/80 via-white to-indigo-50/50 dark:from-blue-950/20 dark:via-background dark:to-indigo-950/10 overflow-hidden">
                  <div className="px-4 py-2.5 bg-blue-100/50 dark:bg-blue-900/20 border-b border-blue-200/50 dark:border-blue-800/30 flex items-center gap-2">
                    <div className="h-6 w-6 rounded-md bg-blue-500 dark:bg-blue-600 flex items-center justify-center">
                      <Building2 className="h-3.5 w-3.5 text-white" />
                    </div>
                    <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wider">Details</span>
                  </div>
                  <div className="p-4 space-y-2.5">
                    {meeting.clientName && (
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
                          <Building2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Client</p>
                          <p className="text-sm font-medium">{meeting.clientName}</p>
                        </div>
                      </div>
                    )}
                    {meeting.location && (
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
                          <MapPin className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Location</p>
                          <p className="text-sm font-medium">{meeting.location}</p>
                        </div>
                      </div>
                    )}
                    {meeting.meetingLink && (
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
                          <Video className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        </div>
                        <a
                          href={meeting.meetingLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                        >
                          Join Meeting
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                {/* Agenda */}
                {meeting.agenda && (
                  <div className="rounded-xl border overflow-hidden">
                    <div className="px-4 py-2.5 bg-amber-50/60 dark:bg-amber-900/15 border-b border-amber-200/50 dark:border-amber-800/30 flex items-center gap-2">
                      <div className="h-6 w-6 rounded-md bg-amber-500 dark:bg-amber-600 flex items-center justify-center">
                        <FileText className="h-3.5 w-3.5 text-white" />
                      </div>
                      <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wider">Agenda</span>
                    </div>
                    <div className="p-4">
                      <p className="text-sm whitespace-pre-wrap leading-relaxed text-foreground/80">{meeting.agenda}</p>
                    </div>
                  </div>
                )}

                {/* Notes */}
                {meeting.notes && (
                  <div className="rounded-xl border overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-50/60 dark:bg-slate-900/15 border-b border-slate-200/50 dark:border-slate-800/30 flex items-center gap-2">
                      <div className="h-6 w-6 rounded-md bg-slate-500 dark:bg-slate-600 flex items-center justify-center">
                        <StickyNote className="h-3.5 w-3.5 text-white" />
                      </div>
                      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Notes</span>
                    </div>
                    <div className="p-4">
                      <p className="text-sm whitespace-pre-wrap leading-relaxed text-foreground/80">{meeting.notes}</p>
                    </div>
                  </div>
                )}

                {/* Attendees */}
                {(meeting.attendees.length > 0 || (canWriteMeetings && canAddParticipants)) && (
                  <div className="rounded-xl border overflow-hidden">
                    <div className="px-4 py-2.5 bg-emerald-50/60 dark:bg-emerald-900/15 border-b border-emerald-200/50 dark:border-emerald-800/30 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-md bg-emerald-500 dark:bg-emerald-600 flex items-center justify-center">
                          <Users className="h-3.5 w-3.5 text-white" />
                        </div>
                        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">Attendees</span>
                      </div>
                      <span className="text-xs text-muted-foreground font-medium">{meeting.attendees.length}</span>
                    </div>
                    <div className="p-3">
                      {meeting.attendees.length === 0 ? (
                        <p className="text-xs text-muted-foreground px-2 py-1">No staff participants yet. Use Edit to add ops managers or linked users.</p>
                      ) : (
                      <div className="space-y-1">
                        {meeting.attendees.map((a) => {
                          const name = a.displayName || a.contactName || a.userName || 'Unknown';
                          const email = a.displayEmail || a.contactEmail || a.userEmail || null;
                          return (
                          <div key={a.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-muted/50 transition-colors">
                            <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
                              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                {name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{name}</p>
                              {email && (
                                <p className="text-xs text-muted-foreground truncate">{email}</p>
                              )}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Actions */}
                {canWriteMeetings && (
                <div className="space-y-2.5 pt-2">
                  {meeting.status !== 'completed' && (
                    <Button
                      className="w-full h-10 bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={handleCompleteMeeting}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Mark as Complete
                    </Button>
                  )}
                  <div className="flex gap-2.5">
                    <Button variant="outline" className="flex-1 h-10" onClick={() => setEditing(true)}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit
                    </Button>
                    <Button variant="destructive" className="h-10 px-5" onClick={handleDelete} disabled={deleting}>
                      {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
                      Delete
                    </Button>
                  </div>
                </div>
                )}
              </>
            )}
          </div>
        ) : meetingType === 'booked' && bookedMeeting ? (
          <div className="p-5 space-y-5">
            {/* Title + Status */}
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-xl font-bold leading-tight">Meeting with {bookedMeeting.guestName}</h3>
                <Badge
                  className={cn(
                    'shrink-0 font-semibold text-[10px] uppercase tracking-wider px-2.5 py-0.5 border',
                    bookedMeeting.status === 'scheduled' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
                    bookedMeeting.status === 'cancelled' && 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300 border-red-200 dark:border-red-800',
                    bookedMeeting.status === 'completed' && 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 border-blue-200 dark:border-blue-800',
                  )}
                >
                  {bookedMeeting.status}
                </Badge>
              </div>
            </div>

            {/* Date & Time Card */}
            <div className="rounded-xl border bg-gradient-to-br from-violet-50/80 via-white to-blue-50/50 dark:from-violet-950/20 dark:via-background dark:to-blue-950/10 overflow-hidden">
              <div className="px-4 py-2.5 bg-violet-100/50 dark:bg-violet-900/20 border-b border-violet-200/50 dark:border-violet-800/30 flex items-center gap-2">
                <div className="h-6 w-6 rounded-md bg-violet-500 dark:bg-violet-600 flex items-center justify-center">
                  <CalendarIcon className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="text-xs font-semibold text-violet-700 dark:text-violet-300 uppercase tracking-wider">Schedule</span>
              </div>
              <div className="p-4 space-y-2.5">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center shrink-0">
                    <CalendarIcon className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  </div>
                  <span className="text-sm font-medium">{format(new Date(bookedMeeting.startTime), 'EEEE, MMMM d, yyyy')}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center shrink-0">
                    <Clock className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  </div>
                  <span className="text-sm font-medium">{format(new Date(bookedMeeting.startTime), 'h:mm a')} - {format(new Date(bookedMeeting.endTime), 'h:mm a')}</span>
                </div>
              </div>
            </div>

            {/* Guest Details Card */}
            <div className="rounded-xl border bg-gradient-to-br from-emerald-50/80 via-white to-teal-50/50 dark:from-emerald-950/20 dark:via-background dark:to-teal-950/10 overflow-hidden">
              <div className="px-4 py-2.5 bg-emerald-100/50 dark:bg-emerald-900/20 border-b border-emerald-200/50 dark:border-emerald-800/30 flex items-center gap-2">
                <div className="h-6 w-6 rounded-md bg-emerald-500 dark:bg-emerald-600 flex items-center justify-center">
                  <User className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">Guest</span>
              </div>
              <div className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                      {bookedMeeting.guestName.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{bookedMeeting.guestName}</p>
                    {bookedMeeting.guestCompany && (
                      <p className="text-xs text-muted-foreground truncate">{bookedMeeting.guestCompany}</p>
                    )}
                  </div>
                </div>
                <div className="space-y-2 pl-0.5">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Mail className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400 shrink-0" />
                    <span className="truncate">{bookedMeeting.guestEmail}</span>
                  </div>
                  {bookedMeeting.guestCompany && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Briefcase className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400 shrink-0" />
                      <span>{bookedMeeting.guestCompany}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Meeting Link */}
            {bookedMeeting.meetingLink && (
              <div className="rounded-xl border overflow-hidden">
                <div className="px-4 py-2.5 bg-blue-50/60 dark:bg-blue-900/15 border-b border-blue-200/50 dark:border-blue-800/30 flex items-center gap-2">
                  <div className="h-6 w-6 rounded-md bg-blue-500 dark:bg-blue-600 flex items-center justify-center">
                    <Video className="h-3.5 w-3.5 text-white" />
                  </div>
                  <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wider">Meeting Link</span>
                </div>
                <div className="p-4">
                  <a
                    href={bookedMeeting.meetingLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                  >
                    Join Meeting
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            )}

            {/* Notes */}
            {bookedMeeting.notes && (
              <div className="rounded-xl border overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50/60 dark:bg-slate-900/15 border-b border-slate-200/50 dark:border-slate-800/30 flex items-center gap-2">
                  <div className="h-6 w-6 rounded-md bg-slate-500 dark:bg-slate-600 flex items-center justify-center">
                    <StickyNote className="h-3.5 w-3.5 text-white" />
                  </div>
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Notes</span>
                </div>
                <div className="p-4">
                  <p className="text-sm whitespace-pre-wrap leading-relaxed text-foreground/80">{bookedMeeting.notes}</p>
                </div>
              </div>
            )}

            {/* Actions */}
            {canWriteMeetings && bookedMeeting.status === 'scheduled' && (
              <div className="space-y-2.5 pt-2">
                <Button
                  className="w-full h-10 bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={handleCompleteBooked}
                  disabled={completing}
                >
                  {completing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                  Mark as Complete
                </Button>
                {!isPast(new Date(bookedMeeting.endTime)) && (
                  <div className="flex gap-2.5">
                    {bookedMeeting.meetingLink && (
                      <Button className="flex-1 h-10 bg-primary" asChild>
                        <a href={bookedMeeting.meetingLink} target="_blank" rel="noopener noreferrer">
                          <Video className="h-4 w-4 mr-2" />
                          Join Meeting
                        </a>
                      </Button>
                    )}
                    <Button variant="destructive" className="h-10 px-5" onClick={handleCancel} disabled={deleting}>
                      {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <X className="h-4 w-4 mr-2" />}
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
            <CalendarIcon className="h-8 w-8 text-muted-foreground/50" />
            <span>Meeting not found</span>
          </div>
        )}
      </div>
    </div>
  );
}
