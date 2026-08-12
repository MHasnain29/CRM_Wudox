import { useState } from 'react';
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
import { useStore } from '@/lib/store';
import { toast } from 'sonner';
import { updateFollowUpApi, addFollowUpCommentApi, mapApiFollowUpToFollowUp } from '@/lib/api';

interface FollowUpDoneDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  followUpId: string;
  clientName: string;
  onSuccess?: () => void;
  actAsUserId?: string;
}

export function FollowUpDoneDialog({
  open,
  onOpenChange,
  followUpId,
  clientName,
  onSuccess,
  actAsUserId,
}: FollowUpDoneDialogProps) {
  const { updateFollowUp } = useStore();
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!note.trim()) {
      toast.error('Please add a completion note');
      return;
    }
    if (!followUpId) return;
    setSubmitting(true);
    try {
      await addFollowUpCommentApi(followUpId, note.trim(), actAsUserId);
      const updated = await updateFollowUpApi(followUpId, { completed: true }, actAsUserId);
      const mapped = mapApiFollowUpToFollowUp(updated);
      updateFollowUp(followUpId, { ...mapped });
      toast.success('Follow-up marked as complete');
      setNote('');
      onOpenChange(false);
      onSuccess?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to complete follow-up');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Complete Follow-Up</DialogTitle>
          <DialogDescription>
            Mark this follow-up for {clientName} as completed
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="note">Completion Note *</Label>
            <Textarea
              id="note"
              placeholder="Add notes about the outcome of this follow-up..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Saving...' : 'Mark as Done'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
