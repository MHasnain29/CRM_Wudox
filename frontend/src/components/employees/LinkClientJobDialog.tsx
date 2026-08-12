/**
 * Modal: Link to Client & Job (opened from Master employee list / Job Matches).
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Link2 } from 'lucide-react';
import type { Employee } from '@/lib/employeeTypes';
import { EmployeeAssignmentRequest } from './EmployeeAssignmentRequest';

type Props = {
  employee: Employee | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
  initialClientId?: string;
  initialJobId?: string;
};

export function LinkClientJobDialog({
  employee,
  open,
  onOpenChange,
  onChanged,
  initialClientId,
  initialJobId,
}: Props) {
  if (!employee) return null;

  const name = `${employee.firstName} ${employee.lastName}`.trim() || 'Employee';
  // One active placement max — workStatus covers job roster even without client map.
  const isPlaced = Boolean(
    employee.activeClientId ||
      employee.activeAssignmentId ||
      employee.workStatus === 'active' ||
      employee.workStatus === 'scheduled',
  );
  const blacklisted = employee.specialTags?.includes('blacklisted');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-[min(100vw-1.5rem,56rem)] max-w-4xl h-[min(92vh,820px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 border-b px-6 py-5 text-left space-y-1.5">
          <DialogTitle className="text-xl flex items-center gap-2">
            <Link2 className="h-5 w-5 text-muted-foreground shrink-0" />
            Link to Client & Job
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            Place <span className="font-medium text-foreground">{name}</span> on an Active Client job.
            Skill matches appear first; you can also pick any other client.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {blacklisted ? (
            <div className="rounded-xl border border-dashed px-6 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                This employee is blacklisted and cannot be linked to a client.
              </p>
            </div>
          ) : employee.approvalStatus !== 'approved' ? (
            <div className="rounded-xl border border-dashed px-6 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                Employee must be approved (Master) before linking to a client.
              </p>
            </div>
          ) : (
            <EmployeeAssignmentRequest
              employeeId={employee.id}
              enabled
              allowCreate={!isPlaced}
              placedMessage={
                isPlaced
                  ? 'This employee already has an active placement. End that placement or use Move to Job before linking again.'
                  : null
              }
              embedded
              subCompanyId={employee.addedBySubCompanyId}
              onChanged={onChanged}
              initialClientId={initialClientId}
              initialJobId={initialJobId}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
