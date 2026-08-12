import { ArrowLeft, Building2, CheckCircle2, Loader2, Save, Send, UserRound, UserRoundCheck } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmployeeStatusBadge } from '../EmployeeStatusBadge';
import type { EmployeeApprovalStatus } from '@/lib/employeeTypes';

export type EmployeeFormActionProps = {
  submitting: boolean;
  isEdit: boolean;
  canApprove: boolean;
  canSubmitForApproval: boolean;
  onSaveDraft: () => void;
  onSubmit: () => void;
  onApprove: () => void;
  onSubmitForApproval: () => void;
};

export function FormActionButtons({
  submitting,
  isEdit,
  canApprove,
  canSubmitForApproval,
  onSaveDraft,
  onSubmit,
  onApprove,
  onSubmitForApproval,
}: EmployeeFormActionProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      {canApprove && (
        <Button
          type="button"
          onClick={onApprove}
          disabled={submitting}
          className="bg-green-600 hover:bg-green-700 text-white"
        >
          <CheckCircle2 className="h-4 w-4 mr-1.5" />
          Approve to Master
        </Button>
      )}
      {canSubmitForApproval && (
        <Button
          type="button"
          onClick={onSubmitForApproval}
          disabled={submitting}
          className="bg-amber-600 hover:bg-amber-700 text-white"
        >
          <Send className="h-4 w-4 mr-1.5" />
          Resubmit for Approval
        </Button>
      )}
      {!isEdit && (
        <Button type="button" variant="outline" onClick={onSaveDraft} disabled={submitting}>
          <Save className="h-4 w-4 mr-1.5" />
          Save Draft
        </Button>
      )}
      <Button type="button" onClick={onSubmit} disabled={submitting}>
        {submitting ? (
          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
        ) : (
          <Send className="h-4 w-4 mr-1.5" />
        )}
        {isEdit ? 'Save Changes' : 'Save & Send Agreement'}
      </Button>
    </div>
  );
}

export function EmployeeFormHeader({
  photoUrl,
  displayName,
  approvalStatus,
  agencyName,
  assignedClientName,
  isEdit,
  onBack,
  actions,
}: {
  photoUrl: string | null;
  displayName: string;
  approvalStatus: EmployeeApprovalStatus | null;
  agencyName: string;
  assignedClientName: string;
  isEdit: boolean;
  onBack: () => void;
  actions: EmployeeFormActionProps;
}) {
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

  return (
    <div className="sticky top-0 z-20 -mx-6 px-6 py-3 bg-background/95 backdrop-blur border-b">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 shrink-0 -ml-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Avatar className="h-11 w-11 border shrink-0">
            {photoUrl && <AvatarImage src={photoUrl} alt="" className="object-cover" />}
            <AvatarFallback className="bg-primary/10 text-primary font-semibold">
              {initials || <UserRound className="h-5 w-5" />}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-lg font-bold tracking-tight truncate">
                {displayName || (isEdit ? 'Edit Employee' : 'New Employee')}
              </h1>
              <EmployeeStatusBadge approvalStatus={approvalStatus} />
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground min-w-0">
              {agencyName && (
                <span className="flex items-center gap-1 truncate">
                  <Building2 className="h-3 w-3 shrink-0" />
                  {agencyName}
                </span>
              )}
              <span className="flex items-center gap-1 truncate">
                <UserRoundCheck className="h-3 w-3 shrink-0" />
                {assignedClientName || 'Not assigned to a client'}
              </span>
            </div>
          </div>
        </div>
        <div className="shrink-0">
          <FormActionButtons {...actions} />
        </div>
      </div>
    </div>
  );
}
