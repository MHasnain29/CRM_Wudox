/**
 * Employee training dialog: Resend email / Upload certificate for Master courses
 * and client training. Action-focused (not a read-only training history browser).
 */
import { useCallback, useEffect, useState } from 'react';
import { GraduationCap, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { ensureEmployeeDefaultTrainings, fetchEmployeeTrainings } from '@/lib/api';
import { usePermission } from '@/hooks/usePermission';
import type { Employee, EmployeeTraining } from '@/lib/employeeTypes';
import { EmployeeTrainingForm } from './EmployeeTrainingForm';
import {
  ActiveClientTrainingPanel,
  ActiveClientTrainingSectionHeader,
} from '@/components/employees/ActiveClientTrainingPanel';

/** manage = staff list entry; certificates = detail-page Resend / Upload entry. */
export type EmployeeTrainingDialogVariant = 'manage' | 'certificates';

type Props = {
  employee: Employee | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
  /**
   * certificates — Resend / Upload only (no training history list).
   * manage — same actions; same UI for shared list entry points.
   */
  variant?: EmployeeTrainingDialogVariant;
};

export function EmployeeTrainingDialog({
  employee,
  open,
  onOpenChange,
  onChanged,
  variant = 'manage',
}: Props) {
  const canWrite = usePermission('employees:write');
  const [trainings, setTrainings] = useState<EmployeeTraining[]>([]);
  const [loading, setLoading] = useState(false);
  const [emailOverride, setEmailOverride] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setEmailOverride(null);
  }, [open, employee?.id]);

  const displayEmail = emailOverride ?? employee?.email ?? null;

  const refresh = useCallback(async () => {
    if (!employee || !open) return;
    setLoading(true);
    try {
      // Ensure Ontario 4 Steps + WHMIS rows exist so Resend / Upload always appear.
      let rows: EmployeeTraining[];
      if (canWrite) {
        rows = await ensureEmployeeDefaultTrainings(employee.id);
      } else {
        rows = await fetchEmployeeTrainings(employee.id);
      }
      setTrainings(rows);
    } catch (err) {
      try {
        const rows = await fetchEmployeeTrainings(employee.id);
        setTrainings(rows);
      } catch {
        toast.error(err instanceof Error ? err.message : 'Failed to load trainings');
        setTrainings([]);
      }
    } finally {
      setLoading(false);
    }
  }, [employee, open, canWrite]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!employee) return null;

  const name = `${employee.firstName} ${employee.lastName}`.trim() || 'Employee';
  const isApproved = employee.approvalStatus === 'approved';
  const clientTrainingFirst =
    variant === 'certificates' && (isApproved || Boolean(employee.clientTrainingPending));

  const upsertTraining = (updated: EmployeeTraining) => {
    setTrainings((prev) => {
      const idx = prev.findIndex((t) => t.id === updated.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = updated;
        return next;
      }
      return [updated, ...prev];
    });
    onChanged?.();
  };

  const title =
    variant === 'certificates' ? 'Resend / Upload certificates' : 'Employee training';

  const description =
    variant === 'certificates'
      ? isApproved
        ? `Resend training emails or upload certificates for ${name} (Master courses and client-required training).`
        : `Resend training emails or upload certificates for ${name}. Both Master courses need certificates before approval.`
      : `Required courses for ${name}. For each course: open the link, resend the email, or upload the certificate.`;

  const masterCoursesSection = (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Master courses</h3>
        <p className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Resend email</span> or{' '}
          <span className="font-medium text-foreground">Upload certificate</span> for each course.
        </p>
      </div>

      {trainings.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center">
          {canWrite
            ? 'Could not load default trainings. Try again or check the employee email.'
            : 'No training records yet.'}
        </p>
      ) : (
        <div className="space-y-3">
          {trainings
            .slice()
            .sort((a, b) => {
              const aOpen = a.sentAt && !a.completedAt ? 0 : 1;
              const bOpen = b.sentAt && !b.completedAt ? 0 : 1;
              if (aOpen !== bOpen) return aOpen - bOpen;
              return (a.title ?? '').localeCompare(b.title ?? '');
            })
            .map((t) => (
              <EmployeeTrainingForm
                key={t.id}
                employeeId={employee.id}
                training={t}
                canWrite={canWrite}
                employeeEmail={displayEmail}
                onEmailUpdated={(email) => {
                  setEmailOverride(email);
                  onChanged?.();
                }}
                onUpdated={upsertTraining}
              />
            ))}
        </div>
      )}
    </section>
  );

  const clientTrainingSection = (
    <section className="space-y-3">
      <ActiveClientTrainingSectionHeader />
      <ActiveClientTrainingPanel
        employeeId={employee.id}
        canWrite={canWrite}
        open={open}
        onChanged={onChanged}
      />
    </section>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-[min(100vw-1.5rem,40rem)] max-w-2xl h-[min(92vh,780px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-6 py-5 text-left space-y-1.5">
          <DialogTitle className="text-xl flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary shrink-0" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">{description}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {clientTrainingFirst ? (
            <>
              {clientTrainingSection}
              <Separator />
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading Master courses…
                </div>
              ) : (
                masterCoursesSection
              )}
            </>
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading training…
            </div>
          ) : (
            <>
              {masterCoursesSection}
              <Separator />
              {clientTrainingSection}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
