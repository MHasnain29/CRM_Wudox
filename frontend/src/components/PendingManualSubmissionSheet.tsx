import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Building2, Users } from 'lucide-react';
import { type PendingManualSubmissionRecord } from '@/lib/api';
import { ApprovalQueueActions } from '@/components/ApprovalQueueActions';
import {
  isGlobalDatabasePendingSubmission,
  resolveManualSubmissionWorkflow,
} from '@/lib/pendingSubmissionApproval';

interface Props {
  submission: PendingManualSubmissionRecord | null;
  onClose: () => void;
  onQueueChanged: () => void;
}

function formatPerson(u: { firstName: string; lastName: string; email: string }): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.email || 'Unknown';
}

export function PendingManualSubmissionSheet({ submission, onClose, onQueueChanged }: Props) {
  if (!submission) return null;

  const contacts = Array.isArray(submission.contacts) ? submission.contacts : [];
  const isGlobal = isGlobalDatabasePendingSubmission(submission);
  const workflow = resolveManualSubmissionWorkflow(submission);
  const managerApproved =
    !isGlobal && !!(submission.managerApprovedAt && submission.managerApprovedById);
  const managerLabel = submission.managerApprovedBy
    ? formatPerson(submission.managerApprovedBy)
    : null;

  const handleActionComplete = () => {
    onQueueChanged();
    onClose();
  };

  return (
    <Sheet open={!!submission} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Review manual submission
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {managerApproved && managerLabel ? (
            <Alert>
              <AlertDescription>
                <span className="font-medium">Forwarded by manager ({managerLabel}).</span>{' '}
                Awaiting final approval before this client is added to the database.
              </AlertDescription>
            </Alert>
          ) : null}

          <div>
            <div className="text-sm text-muted-foreground">Company</div>
            <div className="text-lg font-semibold">{submission.name}</div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-muted-foreground">Industry</div>
              <div>{submission.industry || '—'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Size</div>
              <div>{submission.companySize || '—'}</div>
            </div>
            <div className="col-span-2">
              <div className="text-muted-foreground">Location</div>
              <div>{submission.location || '—'}</div>
            </div>
            {submission.address ? (
              <div className="col-span-2">
                <div className="text-muted-foreground">Address</div>
                <div>{submission.address}</div>
              </div>
            ) : null}
          </div>

          {submission.tags?.length ? (
            <div className="flex flex-wrap gap-1">
              {submission.tags.map((t) => (
                <Badge key={t} variant="secondary">
                  {t}
                </Badge>
              ))}
            </div>
          ) : null}

          <div>
            <div className="flex items-center gap-2 text-sm font-medium mb-2">
              <Users className="h-4 w-4" />
              Contacts ({contacts.length})
            </div>
            <ul className="space-y-2 text-sm border rounded-md p-3">
              {contacts.map((c, i) => {
                const row = c as { name?: string; title?: string; email?: string; phone?: string };
                return (
                  <li key={i} className="border-b last:border-0 pb-2 last:pb-0">
                    <div className="font-medium">{row.name ?? '—'}</div>
                    {row.title ? <div className="text-muted-foreground">{row.title}</div> : null}
                    {row.email ? <div className="text-muted-foreground">{row.email}</div> : null}
                    {row.phone ? <div className="text-muted-foreground">{row.phone}</div> : null}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="text-xs text-muted-foreground">
            Submitted by {formatPerson(submission.submittedBy)}
            {submission.submitterRole ? ` · ${submission.submitterRole}` : ''}
          </div>

          <ApprovalQueueActions
            workflow={workflow}
            entityId={submission.id}
            subCompanyId={submission.subCompanyId ?? undefined}
            finalApproveLabel={
              isGlobal ? 'Approve and add to global database' : 'Approve and add to agency clients'
            }
            onActionComplete={handleActionComplete}
          />

          <div className="flex gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
