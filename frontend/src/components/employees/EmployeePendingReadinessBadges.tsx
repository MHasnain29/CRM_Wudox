/**
 * Pending-tab readiness: stacked Agreement / Training / Upload (uniform width).
 */
import { Check, GraduationCap, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Employee } from '@/lib/employeeTypes';

/** Shared width so Pending Approval + readiness chips align as one column. */
export const EMPLOYEE_PENDING_STATUS_CHIP_WIDTH = 'w-[148px]';

type Props = {
  employee: Pick<
    Employee,
    'agreementStatus' | 'trainingCompletedCount' | 'trainingRequiredCount'
  >;
  className?: string;
  /** Opens the training dialog (resend / upload). */
  onOpenTraining?: () => void;
};

function ReadinessChip({
  complete,
  label,
}: {
  complete: boolean;
  label: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 w-full shrink-0 items-center justify-start gap-1 rounded-md border px-2 text-[11px] font-medium leading-none whitespace-nowrap',
        complete
          ? 'border-emerald-200/80 bg-emerald-50 text-emerald-700'
          : 'border-border/80 bg-background text-muted-foreground',
      )}
    >
      {complete ? (
        <Check className="h-3 w-3 shrink-0 text-emerald-600" strokeWidth={2.5} />
      ) : (
        <Minus className="h-3 w-3 shrink-0 opacity-50" strokeWidth={2} />
      )}
      {label}
    </span>
  );
}

export function EmployeePendingReadinessBadges({
  employee,
  className,
  onOpenTraining,
}: Props) {
  const agreementComplete = employee.agreementStatus === 'complete';
  const required = employee.trainingRequiredCount ?? 2;
  const completed = employee.trainingCompletedCount ?? 0;
  const trainingComplete = completed >= required;
  const showUpload = Boolean(onOpenTraining) && !trainingComplete;

  return (
    <div className={cn('flex w-full flex-col items-stretch gap-1', className)}>
      <ReadinessChip complete={agreementComplete} label="Agreement" />
      <ReadinessChip
        complete={trainingComplete}
        label={`Training ${completed}/${required}`}
      />
      {showUpload && (
        <button
          type="button"
          className="inline-flex h-6 w-full shrink-0 items-center justify-start gap-1 rounded-md border border-border/80 bg-muted/40 px-2 text-[11px] font-medium leading-none text-foreground/80 whitespace-nowrap transition-colors hover:border-blue-600 hover:bg-blue-600 hover:text-white"
          title="Resend / Upload training"
          onClick={(e) => {
            e.stopPropagation();
            onOpenTraining?.();
          }}
        >
          <GraduationCap className="h-3 w-3 shrink-0" strokeWidth={2} />
          Upload
        </button>
      )}
    </div>
  );
}
