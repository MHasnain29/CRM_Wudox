import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Building2, Users } from 'lucide-react';
import { type PendingClientEditRecord } from '@/lib/api';
import { ApprovalQueueActions } from '@/components/ApprovalQueueActions';
import { diffPendingClientEdit, type ContactChangeKind } from '@/lib/pendingClientEditDiff';

interface Props {
  edit: PendingClientEditRecord | null;
  onClose: () => void;
  onQueueChanged: () => void;
}

function formatPerson(u: { firstName: string; lastName: string; email: string }): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.email || 'Unknown';
}

function changeBadge(kind: ContactChangeKind) {
  if (kind === 'added') {
    return (
      <Badge className="ml-2 text-xs bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-0">
        Added
      </Badge>
    );
  }
  if (kind === 'edited') {
    return (
      <Badge className="ml-2 text-xs bg-amber-100 text-amber-900 hover:bg-amber-100 border-0">
        Edited
      </Badge>
    );
  }
  if (kind === 'removed') {
    return (
      <Badge variant="destructive" className="ml-2 text-xs">
        Removed
      </Badge>
    );
  }
  return null;
}

export function PendingClientEditSheet({ edit, onClose, onQueueChanged }: Props) {
  if (!edit) return null;

  const diff = diffPendingClientEdit(edit, edit.client);
  const changedContacts = diff.contacts.filter((c) => c.kind !== 'unchanged');
  const unchangedContacts = diff.contacts.filter((c) => c.kind === 'unchanged');
  const managerApproved = !!(edit.managerApprovedAt && edit.managerApprovedById);
  const managerLabel = edit.managerApprovedBy ? formatPerson(edit.managerApprovedBy) : null;

  const handleActionComplete = () => {
    onQueueChanged();
    onClose();
  };

  return (
    <Sheet open={!!edit} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Review client edit
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div>
            <h3 className="font-semibold text-lg">{edit.name}</h3>
            <p className="text-sm text-muted-foreground">
              Submitted by {formatPerson(edit.submittedBy)} ·{' '}
              {new Date(edit.submittedAt).toLocaleString()}
            </p>
            {edit.client?.name && edit.client.name !== edit.name && (
              <p className="text-xs text-muted-foreground mt-1">
                Current name: {edit.client.name}
              </p>
            )}
          </div>

          <Alert>
            <AlertDescription>
              <span className="font-medium">Changes: </span>
              {diff.summaryLine}
            </AlertDescription>
          </Alert>

          {managerApproved && managerLabel && (
            <Alert>
              <AlertDescription>
                Forwarded by {managerLabel}. A director or super admin must give final approval
                before changes are applied.
              </AlertDescription>
            </Alert>
          )}

          <div className="rounded-lg border p-3 space-y-2 text-sm">
            {edit.industry && (
              <div>
                <span className="text-muted-foreground">Industry: </span>
                {edit.industry}
                {diff.fieldChanges.includes('industry') && (
                  <Badge variant="outline" className="ml-2 text-[10px]">
                    changed
                  </Badge>
                )}
              </div>
            )}
            {edit.location && (
              <div>
                <span className="text-muted-foreground">Location: </span>
                {edit.location}
                {diff.fieldChanges.includes('location') && (
                  <Badge variant="outline" className="ml-2 text-[10px]">
                    changed
                  </Badge>
                )}
              </div>
            )}
            {edit.address && (
              <div>
                <span className="text-muted-foreground">Address: </span>
                {edit.address}
                {diff.fieldChanges.includes('address') && (
                  <Badge variant="outline" className="ml-2 text-[10px]">
                    changed
                  </Badge>
                )}
              </div>
            )}
            {edit.companySize && (
              <div>
                <span className="text-muted-foreground">Company size: </span>
                {edit.companySize}
                {diff.fieldChanges.includes('company size') && (
                  <Badge variant="outline" className="ml-2 text-[10px]">
                    changed
                  </Badge>
                )}
              </div>
            )}
            {edit.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1 items-center">
                {edit.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
                {diff.fieldChanges.includes('tags') && (
                  <Badge variant="outline" className="text-[10px]">
                    tags changed
                  </Badge>
                )}
              </div>
            )}
          </div>

          {(changedContacts.length > 0 || unchangedContacts.length > 0) && (
            <div>
              <h4 className="text-sm font-medium flex items-center gap-2 mb-2">
                <Users className="h-4 w-4" />
                Contacts
                {changedContacts.length > 0 && (
                  <span className="text-muted-foreground font-normal">
                    ({diff.addedCount} added, {diff.editedCount} edited, {diff.removedCount} removed)
                  </span>
                )}
              </h4>
              <ul className="space-y-2 text-sm">
                {[...changedContacts, ...unchangedContacts].map((item, i) => {
                  const contact = item.contact;
                  const removed = item.kind === 'removed';
                  return (
                    <li
                      key={contact.id ?? `c-${i}`}
                      className={`rounded border p-2 ${removed ? 'opacity-70 border-dashed' : ''}`}
                    >
                      <div className={`font-medium ${removed ? 'line-through' : ''}`}>
                        {contact.name ?? '—'}
                        {contact.isPrimary && (
                          <Badge variant="outline" className="ml-2 text-xs">
                            Primary
                          </Badge>
                        )}
                        {changeBadge(item.kind)}
                      </div>
                      {contact.title && (
                        <div className="text-muted-foreground">{contact.title}</div>
                      )}
                      {contact.email && <div>{contact.email}</div>}
                      {contact.phone && <div>{contact.phone}</div>}
                      {item.kind === 'edited' && item.before && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Was: {[item.before.name, item.before.email, item.before.phone]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <ApprovalQueueActions
            workflow="client_manual_edit"
            entityId={edit.id}
            subCompanyId={edit.subCompanyId}
            finalApproveLabel="Approve and apply changes"
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
