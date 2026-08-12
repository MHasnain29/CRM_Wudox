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
import { toast } from 'sonner';
import { createFollowUp } from '@/lib/api';
import { useWriteAgencyId } from '@/hooks/useWriteAgencyId';

interface EmployeeFollowUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  employeeName: string;
  subCompanyId?: string;
  onFollowUpCreated?: () => void;
}

export function EmployeeFollowUpDialog({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  subCompanyId,
  onFollowUpCreated,
}: EmployeeFollowUpDialogProps) {
  const writeAgencyId = useWriteAgencyId(subCompanyId);
  const [date, setDate] = useState<Date | undefined>();
  const [time, setTime] = useState('09:00');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const generateTimeOptions = () => {
    const options: { value: string; label: string }[] = [];
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
    dueDate.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);

    setSubmitting(true);
    try {
      await createFollowUp({
        employeeId,
        dueDate: dueDate.toISOString(),
        notes: comment.trim(),
        subCompanyId: writeAgencyId,
      });
      toast.success('Follow-up scheduled');
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Follow-Up</DialogTitle>
          <DialogDescription>Schedule a follow-up for {employeeName}</DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border p-4 mt-2">
          <div className="font-medium text-lg">{employeeName}</div>
          <p className="text-sm text-muted-foreground mt-1">Employee</p>
        </div>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="employee-fu-date">Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  id="employee-fu-date"
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !date && 'text-muted-foreground',
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, 'PPP') : 'Pick a date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={date} onSelect={setDate} initialFocus />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label htmlFor="employee-fu-time">Time</Label>
            <Select value={time} onValueChange={setTime}>
              <SelectTrigger id="employee-fu-time" className="w-full">
                <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
                <SelectValue placeholder="Select time" />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                <ScrollArea className="h-60">
                  {generateTimeOptions().map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </ScrollArea>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="employee-fu-notes">Notes</Label>
            <Textarea
              id="employee-fu-notes"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What should you follow up about?"
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Saving…' : 'Create Follow-Up'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
