import { Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { EmployeeApprovalStatus } from '@/lib/employeeTypes';

interface EmployeeStatusBadgeProps {
  approvalStatus: EmployeeApprovalStatus | null;
  className?: string;
}

/** Approval-only badge (pending / rejected). Placement work status is not shown. */
export function EmployeeStatusBadge({
  approvalStatus,
  className,
}: EmployeeStatusBadgeProps) {
  if (approvalStatus === 'pending') {
    return (
      <Badge
        variant="outline"
        className={cn(
          'h-6 w-fit shrink-0 justify-start gap-1 whitespace-nowrap rounded-md border-amber-300/70 bg-amber-50 px-2 text-[11px] font-semibold tracking-tight text-amber-800 shadow-none hover:bg-amber-50',
          className,
        )}
      >
        <Clock className="h-3 w-3 shrink-0 text-amber-600" strokeWidth={2.25} />
        Pending Approval
      </Badge>
    );
  }

  if (approvalStatus === 'rejected') {
    return (
      <Badge
        variant="outline"
        className={cn(
          'h-6 gap-1 justify-start rounded-md border-red-300/70 bg-red-50 px-2 text-[11px] font-semibold tracking-tight text-red-800 shadow-none hover:bg-red-50',
          className,
        )}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
        Rejected
      </Badge>
    );
  }

  return null;
}
