/**
 * License gate shown before placing employee(s) on a license-required job
 * from the job-side dialogs (Manage Employees, Move to Job).
 *
 * Reuses JobLicenseRequirementPanel per employee: shows Valid / Expired /
 * Missing per required license type with inline upload (license copy +
 * expiry date). The confirm button stays disabled until every employee has
 * a valid license for every required type.
 */
import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, ShieldAlert } from 'lucide-react';
import { JobLicenseRequirementPanel } from '@/components/employees/JobLicenseRequirementPanel';

export type LicenseGateEmployee = { id: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobTitle: string;
  employees: LicenseGateEmployee[];
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
};

export function JobLicenseGateDialog({
  open,
  onOpenChange,
  jobId,
  jobTitle,
  employees,
  confirmLabel,
  busy,
  onConfirm,
}: Props) {
  const [validity, setValidity] = useState<Record<string, boolean>>({});

  // Start pessimistic for each employee until their panel reports back.
  // Keyed on a stable id signature — callers pass a fresh array each render.
  const employeeIdSignature = employees.map((e) => e.id).join(',');
  useEffect(() => {
    if (!open) return;
    setValidity(
      Object.fromEntries(
        employeeIdSignature
          .split(',')
          .filter(Boolean)
          .map((id) => [id, false]),
      ),
    );
  }, [open, employeeIdSignature]);

  const allValid = employees.length > 0 && employees.every((e) => validity[e.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-600" />
            License required — {jobTitle}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-2">
          <div className="space-y-4">
            {employees.map((emp) => (
              <div key={emp.id} className="space-y-1.5">
                {employees.length > 1 && (
                  <p className="text-sm font-medium">{emp.name}</p>
                )}
                <JobLicenseRequirementPanel
                  employeeId={emp.id}
                  jobId={jobId}
                  disabled={busy}
                  onValidityChange={(valid) =>
                    setValidity((prev) =>
                      prev[emp.id] === valid ? prev : { ...prev, [emp.id]: valid },
                    )
                  }
                />
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy || !allValid}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
