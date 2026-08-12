import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Job, JobAssignment } from '@/lib/jobTypes';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJobs, moveJobPlacement } from '@/lib/jobsApi';
import { toast } from 'sonner';
import { ArrowRight, Loader2, ShieldCheck, Users } from 'lucide-react';
import { JobLicenseGateDialog } from './JobLicenseGateDialog';

interface MoveToJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignments: JobAssignment[];
  currentJob: Job | null;
  onComplete?: () => void;
}

export function MoveToJobDialog({ open, onOpenChange, assignments, currentJob, onComplete }: MoveToJobDialogProps) {
  const queryClient = useQueryClient();

  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [assignAs, setAssignAs] = useState<'primary' | 'backup'>('primary');
  const [busy, setBusy] = useState(false);
  const [licenseGateOpen, setLicenseGateOpen] = useState(false);

  // Other open jobs with the same job type (and agency, when set)
  const { data: jobsResult } = useQuery({
    queryKey: ['jobs', 'move-targets', currentJob?.jobType, currentJob?.agencyId ?? 'scope'],
    queryFn: () =>
      fetchJobs({
        status: 'open',
        jobType: currentJob?.jobType,
        pageSize: 200,
        agencyIds: currentJob?.agencyId ? [currentJob.agencyId] : undefined,
      }),
    enabled: open && Boolean(currentJob),
  });

  const availableJobs = (jobsResult?.data ?? []).filter(
    (job) => job.id !== currentJob?.id,
  );

  const handleMove = async () => {
    if (assignments.length === 0 || !currentJob || !selectedJobId) return;

    const targetJob = availableJobs.find(j => j.id === selectedJobId);
    if (!targetJob) return;

    // Check limits
    const maxScheduled = Math.ceil(targetJob.openPositions * (1 + targetJob.backupPercentage / 100));
    const primaryLimit = targetJob.openPositions;
    const backupLimit = maxScheduled - primaryLimit;

    const currentPrimaryCount = targetJob.assignments?.filter(a => !a.isBackup).length || 0;
    const currentBackupCount = targetJob.assignments?.filter(a => a.isBackup).length || 0;

    if (assignAs === 'primary' && currentPrimaryCount + assignments.length > primaryLimit) {
      toast.error(`Not enough primary positions on ${targetJob.title} (need ${assignments.length}, have ${primaryLimit - currentPrimaryCount} available)`);
      return;
    }
    if (assignAs === 'backup' && currentBackupCount + assignments.length > backupLimit) {
      toast.error(`Not enough backup positions on ${targetJob.title} (need ${assignments.length}, have ${backupLimit - currentBackupCount} available)`);
      return;
    }

    // License-required target: verify (and allow uploading) licenses first.
    if (targetJob.licenseRequired && targetJob.requiredLicenseTypes.length > 0) {
      setLicenseGateOpen(true);
      return;
    }

    await performMove(targetJob.title);
  };

  const performMove = async (targetJobTitle: string) => {
    if (!currentJob) return;
    setBusy(true);
    try {
      for (const assignment of assignments) {
        await moveJobPlacement(currentJob.id, assignment.id, {
          targetJobId: selectedJobId,
          isBackup: assignAs === 'backup',
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast.success(`${assignments.length} employee(s) moved to ${targetJobTitle} as ${assignAs}`);
      setLicenseGateOpen(false);
      onOpenChange(false);
      setSelectedJobId('');
      setAssignAs('primary');
      onComplete?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to move employees');
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
    } finally {
      setBusy(false);
    }
  };

  if (assignments.length === 0 || !currentJob) return null;

  const isSingle = assignments.length === 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRight className="h-5 w-5" />
            {isSingle 
              ? `Move ${assignments[0].employeeName} to Another Job`
              : `Move ${assignments.length} Employees to Another Job`
            }
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Select Job</Label>
            {availableJobs.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-2">
                No other open {currentJob.jobType} jobs available
              </p>
            ) : (
              <ScrollArea className="h-[200px] mt-2 border rounded-md p-2">
                <RadioGroup value={selectedJobId} onValueChange={setSelectedJobId}>
                  {availableJobs.map((job) => {
                    const primaryCount = job.assignments?.filter(a => !a.isBackup).length || 0;
                    
                    return (
                      <div 
                        key={job.id} 
                        className="flex items-center space-x-2 p-2 rounded-md hover:bg-muted/50"
                      >
                        <RadioGroupItem value={job.id} id={job.id} />
                        <Label htmlFor={job.id} className="flex-1 cursor-pointer">
                          <div className="font-medium">{job.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {job.company} • {primaryCount}/{job.openPositions} primary
                          </div>
                        </Label>
                      </div>
                    );
                  })}
                </RadioGroup>
              </ScrollArea>
            )}
          </div>

          {selectedJobId && (
            <div>
              <Label className="text-sm font-medium">Assign As</Label>
              <RadioGroup 
                value={assignAs} 
                onValueChange={(v) => setAssignAs(v as 'primary' | 'backup')}
                className="mt-2"
              >
                <div className="flex items-center space-x-2 p-2 rounded-md hover:bg-muted/50">
                  <RadioGroupItem value="primary" id="assign-primary" />
                  <Label htmlFor="assign-primary" className="flex items-center gap-2 cursor-pointer">
                    <ShieldCheck className="h-4 w-4 text-blue-600" />
                    Primary
                  </Label>
                </div>
                <div className="flex items-center space-x-2 p-2 rounded-md hover:bg-muted/50">
                  <RadioGroupItem value="backup" id="assign-backup" />
                  <Label htmlFor="assign-backup" className="flex items-center gap-2 cursor-pointer">
                    <Users className="h-4 w-4 text-orange-500" />
                    Backup
                  </Label>
                </div>
              </RadioGroup>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleMove()}
            disabled={!selectedJobId || busy}
          >
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Move {isSingle ? 'Employee' : `${assignments.length} Employees`}
          </Button>
        </DialogFooter>
      </DialogContent>

      <JobLicenseGateDialog
        open={licenseGateOpen}
        onOpenChange={setLicenseGateOpen}
        jobId={selectedJobId}
        jobTitle={availableJobs.find((j) => j.id === selectedJobId)?.title ?? 'job'}
        employees={assignments.map((a) => ({ id: a.employeeId, name: a.employeeName }))}
        confirmLabel={`Move ${isSingle ? 'Employee' : `${assignments.length} Employees`}`}
        busy={busy}
        onConfirm={() => {
          const targetJob = availableJobs.find((j) => j.id === selectedJobId);
          void performMove(targetJob?.title ?? 'job');
        }}
      />
    </Dialog>
  );
}
