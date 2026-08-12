import { useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon, Clock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useStore } from '@/lib/store';
import { toast } from 'sonner';
import { updateFollowUpApi, addFollowUpCommentApi, mapApiFollowUpToFollowUp } from '@/lib/api';

interface FollowUpRescheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  followUpId: string;
  clientName: string;
  currentDate: Date;
  onSuccess?: () => void;
  actAsUserId?: string;
}

export function FollowUpRescheduleDialog({
  open,
  onOpenChange,
  followUpId,
  clientName,
  currentDate,
  onSuccess,
  actAsUserId,
}: FollowUpRescheduleDialogProps) {
  const { updateFollowUp } = useStore();
  const [date, setDate] = useState<Date | undefined>(new Date(currentDate));
  const [time, setTime] = useState<string>(format(new Date(currentDate), 'HH:mm'));
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!date) {
      toast.error('Please select a date');
      return;
    }
    if (!reason.trim()) {
      toast.error('Please add a reason for rescheduling');
      return;
    }
    if (!followUpId) return;
    const [hours, minutes] = time.split(':');
    const newDate = new Date(date);
    newDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    const dueDateIso = newDate.toISOString();

    setSubmitting(true);
    try {
      await addFollowUpCommentApi(followUpId, `Rescheduled: ${reason.trim()}`, actAsUserId);
      const updated = await updateFollowUpApi(followUpId, { dueDate: dueDateIso }, actAsUserId);
      const mapped = mapApiFollowUpToFollowUp(updated);
      updateFollowUp(followUpId, { ...mapped });
      toast.success('Follow-up rescheduled successfully');
      setReason('');
      onOpenChange(false);
      onSuccess?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to reschedule');
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
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reschedule Follow-Up</DialogTitle>
          <DialogDescription>
            Reschedule this follow-up for {clientName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Date Picker */}
          <div className="space-y-2">
            <Label htmlFor="date">New Date *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  id="date"
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !date && 'text-muted-foreground'
                  )}
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
            <Label htmlFor="time">New Time *</Label>
            <Select value={time} onValueChange={setTime}>
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

          {/* Reason */}
          <div className="space-y-2">
            <Label htmlFor="reason">Reason for Rescheduling *</Label>
            <Textarea
              id="reason"
              placeholder="Explain why this follow-up is being rescheduled..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Saving...' : 'Reschedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
