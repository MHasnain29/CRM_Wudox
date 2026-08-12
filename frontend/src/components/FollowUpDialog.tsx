import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { CalendarIcon, Clock, Building2, MapPin } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { FollowUp, Client } from '@/lib/types';
import { useStore } from '@/lib/store';
import { toast } from 'sonner';
import { createFollowUp, addFollowUpCommentApi, mapApiFollowUpToFollowUp } from '@/lib/api';
import { useWriteAgencyId } from '@/hooks/useWriteAgencyId';

interface FollowUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  leadId?: string;
  subCompanyId?: string;
  followUp?: FollowUp | null;
  client?: Client;
  onFollowUpCreated?: () => void;
}

export function FollowUpDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
  leadId,
  subCompanyId,
  followUp,
  client,
  onFollowUpCreated,
}: FollowUpDialogProps) {
  const writeAgencyId = useWriteAgencyId(subCompanyId);
  const { currentUser, addFollowUp, updateFollowUp } = useStore();
  const [date, setDate] = useState<Date | undefined>(
    followUp ? new Date(followUp.dueDate) : undefined
  );
  const [time, setTime] = useState<string>(
    followUp ? format(new Date(followUp.dueDate), 'HH:mm') : '09:00'
  );
  const [comment, setComment] = useState('');
  const [selectedContactId, setSelectedContactId] = useState<string>(() => {
    if (followUp?.contactId) return followUp.contactId;
    if (client) {
      const primaryContact = client.contacts.find(c => c.isPrimary);
      return primaryContact?.id || client.contacts[0]?.id || '';
    }
    return '';
  });
  const [submitting, setSubmitting] = useState(false);

  // When dialog opens with a client, pre-select primary contact
  useEffect(() => {
    if (open && client?.contacts?.length) {
      const primary = client.contacts.find((c) => c.isPrimary);
      setSelectedContactId(primary?.id ?? client.contacts[0]?.id ?? '');
    }
  }, [open, client?.id]);

  const handleSubmit = async () => {
    if (!date) {
      toast.error('Please select a date');
      return;
    }
    if (!comment.trim()) {
      toast.error('Please add a comment');
      return;
    }
    const [hours, minutes] = time.split(':');
    const dueDate = new Date(date);
    dueDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    const dueDateIso = dueDate.toISOString();

    if (followUp) {
      setSubmitting(true);
      try {
        const updated = await addFollowUpCommentApi(followUp.id, comment.trim());
        const mapped = mapApiFollowUpToFollowUp(updated);
        updateFollowUp(followUp.id, { ...mapped });
        toast.success('Comment added to follow-up');
        setComment('');
        onOpenChange(false);
        onFollowUpCreated?.();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to add comment');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setSubmitting(true);
    try {
      const created = await createFollowUp({
        clientId,
        leadId: leadId ?? null,
        contactId: selectedContactId || null,
        dueDate: dueDateIso,
        notes: comment.trim(),
        subCompanyId: writeAgencyId,
      });
      const mapped = mapApiFollowUpToFollowUp(created);
      addFollowUp(mapped);
      setComment('');
      setDate(undefined);
      setTime('09:00');
      onOpenChange(false);
      onFollowUpCreated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create follow-up');
    } finally {
      setSubmitting(false);
    }
  };

  const generateTimeOptions = () => {
    const options = [];
    for (let hour = 0; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        const displayStr = format(new Date(2000, 0, 1, hour, minute), 'h:mm a');
        options.push({ value: timeStr, label: displayStr });
      }
    }
    return options;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {followUp ? 'Update Follow-Up' : 'Create Follow-Up'}
          </DialogTitle>
          <DialogDescription>
            {followUp ? `Add a comment to track progress on this follow-up for ${clientName}` : `Schedule a follow-up for ${clientName}`}
          </DialogDescription>
        </DialogHeader>

        {/* Client Info */}
        {client && (
          <Card className="mt-4">
            <CardContent className="p-4">
              <div className="space-y-3">
                <div className="font-medium text-lg">{clientName}</div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Building2 className="h-4 w-4" />
                  <span>{client.industry}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  <span>{client.location}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-4 py-4">
          {/* Contact Person Selection */}
          {client && client.contacts.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="contact">Contact Person</Label>
              <Select value={selectedContactId} onValueChange={setSelectedContactId} disabled={!!followUp}>
                <SelectTrigger id="contact" className="w-full">
                  <SelectValue placeholder="Select contact" />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  {client.contacts.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.name}{contact.isPrimary ? ' (Primary)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Date Picker */}
          <div className="space-y-2">
            <Label htmlFor="date">Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  id="date"
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !date && 'text-muted-foreground'
                  )}
                  disabled={!!followUp}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, 'PPP') : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  initialFocus
                  disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Time Picker */}
          <div className="space-y-2">
            <Label htmlFor="time">Time</Label>
            <Select value={time} onValueChange={setTime} disabled={!!followUp}>
              <SelectTrigger id="time" className="w-full">
                <Clock className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Select time" />
              </SelectTrigger>
              <SelectContent>
                <ScrollArea className="h-60">
                  {generateTimeOptions().map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </ScrollArea>
              </SelectContent>
            </Select>
          </div>

          {/* Comment */}
          <div className="space-y-2">
            <Label htmlFor="comment">
              {followUp ? 'Add Comment' : 'Initial Comment'}
            </Label>
            <Textarea
              id="comment"
              placeholder={followUp ? "Add update or notes..." : "Add notes about this follow-up..."}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
            />
          </div>

          {/* Comment History */}
          {followUp && followUp.comments.length > 0 && (
            <div className="space-y-2">
              <Label>History</Label>
              <ScrollArea className="h-40 rounded-md border">
                <div className="p-3 space-y-3">
                  {followUp.comments.map((c) => (
                    <Card key={c.id}>
                      <CardContent className="p-3">
                        <div className="flex justify-between items-start mb-1">
                          <span className="text-sm font-medium">{c.userName}</span>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(c.createdAt), 'MMM d, h:mm a')}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">{c.content}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Saving...' : followUp ? 'Add Comment' : 'Create Follow-Up'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
