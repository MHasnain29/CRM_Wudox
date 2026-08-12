/**
 * Edit-employee entry point for training certificates.
 * Opens the shared EmployeeTrainingDialog (view / replace / resend).
 */
import { useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SectionCard } from './SectionCard';
import { EmployeeTrainingDialog } from '@/components/employees/EmployeeTrainingDialog';
import type { Employee } from '@/lib/employeeTypes';

type Props = {
  employee: Employee;
  /** Refresh parent employee after dialog changes (e.g. email). */
  onChanged?: () => void;
};

export function TrainingCertificatesCard({ employee, onChanged }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <SectionCard
        icon={GraduationCap}
        title="Training Certificates"
        description="View, upload, or replace certificates for required courses (e.g. Ontario 4 Steps, WHMIS)."
      >
        <p className="text-xs text-muted-foreground">
          Open the training manager to view certificates on file, upload new ones, or replace an
          existing certificate.
        </p>
        <Button
          type="button"
          variant="outline"
          className="w-full h-10"
          onClick={() => setOpen(true)}
        >
          <GraduationCap className="mr-2 h-4 w-4" />
          Manage training certificates
        </Button>
      </SectionCard>
      <EmployeeTrainingDialog
        employee={employee}
        open={open}
        onOpenChange={setOpen}
        onChanged={onChanged}
      />
    </>
  );
}
