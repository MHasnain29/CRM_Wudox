import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Building2, Users, CheckCircle, Trash2, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  approvePendingContactImport,
  deletePendingContactImport,
  type PendingContactImportRecord,
} from '@/lib/api';
import { ApprovalQueueActions } from '@/components/ApprovalQueueActions';
import { useCanFinalApprovePendingClients } from '@/lib/access';

interface Props {
  pending: PendingContactImportRecord | null;
  onClose: () => void;
  onQueueChanged: () => void;
}

export function PendingContactImportReviewSheet({ pending, onClose, onQueueChanged }: Props) {
  const { toast } = useToast();
  const isDirector = useCanFinalApprovePendingClients();
  const [submitting, setSubmitting] = useState(false);

  if (!pending) return null;

  const contacts = Array.isArray(pending.contacts) ? pending.contacts : [];
  const clientName = pending.targetClient?.name ?? 'Client';

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      const result = await approvePendingContactImport(pending.id, {
        subCompanyId: pending.subCompanyId ?? undefined,
      });
      toast({
        title: 'Contacts added',
        description: `Appended ${result.appended} contact(s) to ${clientName}.`,
      });
      onQueueChanged();
      onClose();
    } catch (err) {
      toast({
        title: 'Approve failed',
        description: err instanceof Error ? err.message : 'Could not approve',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    setSubmitting(true);
    try {
      await deletePendingContactImport(pending.id, {
        subCompanyId: pending.subCompanyId ?? undefined,
      });
      toast({ title: 'Contact import rejected' });
      onQueueChanged();
      onClose();
    } catch (err) {
      toast({
        title: 'Reject failed',
        description: err instanceof Error ? err.message : 'Could not reject',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={!!pending} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Review contact import</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div className="flex items-start gap-3 rounded-lg border p-3">
            <Building2 className="h-5 w-5 text-muted-foreground mt-0.5" />
            <div>
              <p className="font-medium">{clientName}</p>
              {pending.targetClient?.corporateCode && (
                <p className="text-xs text-muted-foreground">
                  Code: {pending.targetClient.corporateCode}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Matched via {pending.matchKey} = {pending.matchValue}
              </p>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium">Contacts to append ({contacts.length})</p>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {contacts.map((c, i) => (
                <div key={i} className="rounded border px-3 py-2 text-sm">
                  <p className="font-medium">{c.name}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {c.title && <Badge variant="secondary">{c.title}</Badge>}
                    {c.email && <Badge variant="outline">{c.email}</Badge>}
                    {c.phone && <Badge variant="outline">{c.phone}</Badge>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {isDirector ? (
            <div className="flex gap-2 pt-2">
              <Button
                className="flex-1"
                disabled={submitting}
                onClick={() => void handleApprove()}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-2" />
                )}
                Approve & append
              </Button>
              <Button
                variant="destructive"
                disabled={submitting}
                onClick={() => void handleReject()}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Reject
              </Button>
            </div>
          ) : (
            <ApprovalQueueActions
              workflow={
                pending.submissionSource === 'global_database'
                  ? 'database_contact_import'
                  : 'contact_import'
              }
              entityId={pending.id}
              subCompanyId={pending.subCompanyId ?? undefined}
              onActionComplete={() => {
                onQueueChanged();
                onClose();
              }}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
