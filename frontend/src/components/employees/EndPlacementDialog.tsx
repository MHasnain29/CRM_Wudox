/**
 * End a single employee job placement with rating, reason, and notes.
 */
import { useEffect, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Star } from 'lucide-react';
import {
  PLACEMENT_END_REASON_LABELS,
  type PlacementEndReason,
} from '@/lib/employeeTypes';
import { endEmployeeAssignment } from '@/lib/api';
import { endJobPlacement } from '@/lib/jobsApi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export type EndPlacementTarget = {
  employeeId: string;
  employeeName: string;
  /** Employee assignment id (required to end via the employees API). */
  assignmentId?: string | null;
  jobId?: string | null;
  /** Job-side assignment id (used with jobId for the jobs end endpoint). */
  jobAssignmentId?: string | null;
  jobTitle?: string | null;
  clientName?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: EndPlacementTarget | null;
  onEnded?: () => void;
};

export function EndPlacementDialog({ open, onOpenChange, target, onEnded }: Props) {
  const [endReason, setEndReason] = useState<PlacementEndReason | ''>('');
  const [endNotes, setEndNotes] = useState('');
  const [rating, setRating] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setEndReason('');
      setEndNotes('');
      setRating(0);
      setBusy(false);
    }
  }, [open, target?.employeeId]);

  if (!target) return null;

  const notesRequired = endReason === 'other';
  const canSubmit =
    Boolean(endReason) &&
    rating >= 1 &&
    rating <= 5 &&
    (!notesRequired || endNotes.trim().length > 0);

  const handleConfirm = async () => {
    if (!canSubmit || !endReason) return;
    setBusy(true);
    try {
      const body = {
        endReason,
        endNotes: endNotes.trim() || null,
        rating,
      };
      if (target.jobId && target.jobAssignmentId) {
        await endJobPlacement(target.jobId, target.jobAssignmentId, body);
      } else if (target.assignmentId) {
        await endEmployeeAssignment(target.employeeId, target.assignmentId, body);
      } else {
        throw new Error('No assignment reference for this placement');
      }
      toast.success(`Ended placement for ${target.employeeName}`);
      onEnded?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to end placement');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>End job placement</DialogTitle>
          <DialogDescription>
            {target.employeeName}
            {target.jobTitle ? ` · ${target.jobTitle}` : ''}
            {target.clientName ? ` at ${target.clientName}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>
              Why did this job end? <span className="text-destructive">*</span>
            </Label>
            <Select
              value={endReason}
              onValueChange={(v) => setEndReason(v as PlacementEndReason)}
              disabled={busy}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select reason" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PLACEMENT_END_REASON_LABELS) as PlacementEndReason[]).map(
                  (key) => (
                    <SelectItem key={key} value={key}>
                      {PLACEMENT_END_REASON_LABELS[key]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>
              Performance rating <span className="text-destructive">*</span>
            </Label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={busy}
                  aria-label={`${n} star${n === 1 ? '' : 's'}`}
                  className="p-1 rounded hover:bg-muted"
                  onClick={() => setRating(n)}
                >
                  <Star
                    className={cn(
                      'h-6 w-6',
                      n <= rating
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-muted-foreground',
                    )}
                  />
                </button>
              ))}
              {rating > 0 && (
                <span className="text-sm text-muted-foreground ml-2">{rating}/5</span>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>
              Notes{notesRequired ? <span className="text-destructive"> *</span> : ' (optional)'}
            </Label>
            <Textarea
              value={endNotes}
              onChange={(e) => setEndNotes(e.target.value)}
              disabled={busy}
              placeholder={
                notesRequired
                  ? 'Explain why the placement ended…'
                  : 'Optional notes about this placement end'
              }
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={!canSubmit || busy}>
            End placement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
