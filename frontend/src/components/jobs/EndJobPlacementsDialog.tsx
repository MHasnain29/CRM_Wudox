/**
 * Batch end all assignees when closing or marking a job filled.
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Star } from 'lucide-react';
import type { Job, JobStatus } from '@/lib/jobTypes';
import {
  PLACEMENT_END_REASON_LABELS,
  type PlacementEndReason,
} from '@/lib/employeeTypes';
import { endAllJobPlacements, updateJobStatus } from '@/lib/jobsApi';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type RowState = {
  employeeId: string;
  employeeName: string;
  endReason: PlacementEndReason | '';
  endNotes: string;
  rating: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job | null;
  finalStatus: Extract<JobStatus, 'closed' | 'filled'>;
  onCompleted?: () => void;
};

export function EndJobPlacementsDialog({
  open,
  onOpenChange,
  job: jobProp,
  finalStatus,
  onCompleted,
}: Props) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<RowState[]>([]);
  const [busy, setBusy] = useState(false);

  const job = jobProp;

  useEffect(() => {
    if (!open || !job) return;
    setRows(
      (job.assignments || []).map((a) => ({
        employeeId: a.employeeId,
        employeeName: a.employeeName,
        endReason: '' as const,
        endNotes: '',
        rating: 0,
      })),
    );
    setBusy(false);
  }, [open, job?.id, job?.assignments?.length]);

  if (!job) return null;

  const updateRow = (employeeId: string, patch: Partial<RowState>) => {
    setRows((prev) =>
      prev.map((r) => (r.employeeId === employeeId ? { ...r, ...patch } : r)),
    );
  };

  const allValid = rows.every((r) => {
    if (!r.endReason || r.rating < 1 || r.rating > 5) return false;
    if (r.endReason === 'other' && !r.endNotes.trim()) return false;
    return true;
  });

  const handleConfirm = async () => {
    if (!allValid) return;
    setBusy(true);
    try {
      if (rows.length === 0) {
        await updateJobStatus(job.id, finalStatus);
      } else {
        await endAllJobPlacements(job.id, {
          finalStatus,
          rows: rows.map((r) => ({
            employeeId: r.employeeId,
            endReason: r.endReason as PlacementEndReason,
            endNotes: r.endNotes.trim() || null,
            rating: r.rating,
          })),
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success(
        finalStatus === 'filled' ? 'Job marked filled' : 'Job closed',
      );
      onOpenChange(false);
      onCompleted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to end job');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>
            {finalStatus === 'filled' ? 'Mark job filled' : 'Close job'}
          </DialogTitle>
          <DialogDescription>
            {rows.length === 0
              ? `No employees assigned. Confirm to mark "${job.title}" as ${finalStatus}.`
              : `End each placement with a rating and reason before marking "${job.title}" as ${finalStatus}.`}
          </DialogDescription>
        </DialogHeader>

        {rows.length > 0 && (
          <ScrollArea className="max-h-[50vh] pr-3">
            <div className="space-y-4">
              {rows.map((r) => (
                <div key={r.employeeId} className="rounded border p-3 space-y-3">
                  <p className="text-sm font-medium">{r.employeeName}</p>
                  <div className="space-y-1.5">
                    <Label className="text-xs">End reason *</Label>
                    <Select
                      value={r.endReason}
                      onValueChange={(v) =>
                        updateRow(r.employeeId, { endReason: v as PlacementEndReason })
                      }
                      disabled={busy}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select reason" />
                      </SelectTrigger>
                      <SelectContent>
                        {(
                          Object.keys(PLACEMENT_END_REASON_LABELS) as PlacementEndReason[]
                        ).map((key) => (
                          <SelectItem key={key} value={key}>
                            {PLACEMENT_END_REASON_LABELS[key]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Rating *</Label>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          disabled={busy}
                          className="p-0.5"
                          onClick={() => updateRow(r.employeeId, { rating: n })}
                        >
                          <Star
                            className={cn(
                              'h-5 w-5',
                              n <= r.rating
                                ? 'fill-amber-400 text-amber-400'
                                : 'text-muted-foreground',
                            )}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      Notes{r.endReason === 'other' ? ' *' : ' (optional)'}
                    </Label>
                    <Textarea
                      rows={2}
                      value={r.endNotes}
                      disabled={busy}
                      onChange={(e) =>
                        updateRow(r.employeeId, { endNotes: e.target.value })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleConfirm()}
            disabled={busy || (rows.length > 0 && !allValid)}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
