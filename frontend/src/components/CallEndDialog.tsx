import { useState } from 'react';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ThumbsUp, ThumbsDown, Send, CalendarIcon, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { ClientContact } from '@/lib/types';

interface FollowUpData {
  date: Date;
  time: string;
  contactId: string;
  notes: string;
}

interface CallEndDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientName: string;
  contactName: string;
  duration: number;
  contacts?: ClientContact[];
  onSubmit: (response: 'positive' | 'negative', comment: string, followUp?: FollowUpData) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function CallEndDialog({
  open,
  onOpenChange,
  clientName,
  contactName,
  duration,
  contacts = [],
  onSubmit,
  isSubmitting = false,
}: CallEndDialogProps) {
  const { toast } = useToast();
  const [response, setResponse] = useState<'positive' | 'negative' | null>(null);
  const [comment, setComment] = useState('');
  const [needsFollowUp, setNeedsFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState<Date | undefined>(undefined);
  const [followUpTime, setFollowUpTime] = useState('09:00');
  const [followUpContactId, setFollowUpContactId] = useState<string>(() => {
    const primaryContact = contacts.find(c => c.isPrimary);
    return primaryContact?.id || contacts[0]?.id || '';
  });
  const [followUpNotes, setFollowUpNotes] = useState('');

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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

  const handleSubmit = async () => {
    if (!response) {
      toast({
        title: "Please select a response",
        description: "Choose whether the call response was positive or negative",
        variant: "destructive",
      });
      return;
    }

    if (needsFollowUp && !followUpDate) {
      toast({
        title: "Please select a follow-up date",
        description: "Choose when you want to follow up",
        variant: "destructive",
      });
      return;
    }

    let followUpData: FollowUpData | undefined;
    if (needsFollowUp && followUpDate) {
      const [hours, minutes] = followUpTime.split(':');
      const dueDate = new Date(followUpDate);
      dueDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);

      followUpData = {
        date: dueDate,
        time: followUpTime,
        contactId: followUpContactId,
        notes: followUpNotes || comment,
      };
    }

    await onSubmit(response, comment, followUpData);

    // Reset state and close (parent may have already closed on success)
    setResponse(null);
    setComment('');
    setNeedsFollowUp(false);
    setFollowUpDate(undefined);
    setFollowUpTime('09:00');
    setFollowUpNotes('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Call Summary</DialogTitle>
          <DialogDescription>
            Record the outcome of your call with {contactName} from {clientName}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          {/* Call Duration */}
          <div className="flex items-center justify-center">
            <div className="bg-muted rounded-lg px-4 py-2">
              <span className="text-sm text-muted-foreground">Call Duration: </span>
              <span className="font-mono font-semibold">{formatDuration(duration)}</span>
            </div>
          </div>

          {/* Response Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">How was the response?</Label>
            <div className="grid grid-cols-2 gap-3">
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "h-20 flex flex-col gap-2 transition-all",
                  response === 'positive' && "border-2 border-green-500 bg-green-500/10 text-green-600"
                )}
                onClick={() => setResponse('positive')}
              >
                <ThumbsUp className={cn(
                  "h-6 w-6",
                  response === 'positive' ? "text-green-500" : "text-muted-foreground"
                )} />
                <span className="text-sm font-medium">Positive</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "h-20 flex flex-col gap-2 transition-all",
                  response === 'negative' && "border-2 border-red-500 bg-red-500/10 text-red-600"
                )}
                onClick={() => setResponse('negative')}
              >
                <ThumbsDown className={cn(
                  "h-6 w-6",
                  response === 'negative' ? "text-red-500" : "text-muted-foreground"
                )} />
                <span className="text-sm font-medium">Negative</span>
              </Button>
            </div>
          </div>

          {/* End of Call Comment */}
          <div className="space-y-2">
            <Label htmlFor="call-comment" className="text-sm font-medium">
              End of Call Notes
            </Label>
            <Textarea
              id="call-comment"
              placeholder="Add notes about the call outcome, next steps, or any important details..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="min-h-[80px] resize-none"
            />
          </div>

          {/* Follow-up Checkbox */}
          <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-lg">
            <Checkbox
              id="needs-followup"
              checked={needsFollowUp}
              onCheckedChange={(checked) => setNeedsFollowUp(checked === true)}
            />
            <Label
              htmlFor="needs-followup"
              className="text-sm font-medium cursor-pointer"
            >
              Schedule a follow-up for this call?
            </Label>
          </div>

          {/* Follow-up Fields */}
          {needsFollowUp && (
            <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Follow-up Details
              </h4>

              {/* Contact Person Selection */}
              {contacts.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="followup-contact">Contact Person</Label>
                  <Select value={followUpContactId} onValueChange={setFollowUpContactId}>
                    <SelectTrigger id="followup-contact" className="w-full bg-background">
                      <SelectValue placeholder="Select contact" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover">
                      {contacts.map((contact) => (
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
                <Label htmlFor="followup-date">Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="followup-date"
                      variant="outline"
                      className={cn(
                        'w-full justify-start text-left font-normal bg-background',
                        !followUpDate && 'text-muted-foreground'
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {followUpDate ? format(followUpDate, 'PPP') : <span>Pick a date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={followUpDate}
                      onSelect={setFollowUpDate}
                      initialFocus
                      disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Time Picker */}
              <div className="space-y-2">
                <Label htmlFor="followup-time">Time</Label>
                <Select value={followUpTime} onValueChange={setFollowUpTime}>
                  <SelectTrigger id="followup-time" className="w-full bg-background">
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

              {/* Follow-up Notes */}
              <div className="space-y-2">
                <Label htmlFor="followup-notes">Follow-up Notes (optional)</Label>
                <Textarea
                  id="followup-notes"
                  placeholder="Additional notes for the follow-up..."
                  value={followUpNotes}
                  onChange={(e) => setFollowUpNotes(e.target.value)}
                  className="min-h-[60px] resize-none bg-background"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} className="gap-2 w-full" disabled={isSubmitting}>
            <Send className="h-4 w-4" />
            {isSubmitting ? 'Saving...' : needsFollowUp ? 'Submit & Create Follow-up' : 'Submit Summary'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
