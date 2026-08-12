import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { deleteActiveClient, type ApiActiveClient } from '@/lib/activeClientsApi';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface DeleteActiveClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: ApiActiveClient | null;
}

export function DeleteActiveClientDialog({
  open,
  onOpenChange,
  client,
}: DeleteActiveClientDialogProps) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const jobCount = client?.jobCount ?? 0;
  const placedCount = client?.placedEmployeeCount ?? 0;
  const blocked = jobCount > 0 || placedCount > 0;

  const handleConfirm = async () => {
    if (!client) return;
    setBusy(true);
    try {
      await deleteActiveClient(client.id);
      await queryClient.invalidateQueries({ queryKey: ['active-clients'] });
      toast.success(`${client.name} removed`);
      onOpenChange(false);
    } catch (err) {
      // Server returns 409 with a descriptive message when jobs/placements still reference the client.
      toast.error(err instanceof Error ? err.message : 'Failed to delete active client');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete active client?</AlertDialogTitle>
          <AlertDialogDescription>
            {jobCount > 0 ? (
              <>
                <span className="font-medium text-foreground">{client?.name}</span> has{' '}
                {jobCount} linked job{jobCount === 1 ? '' : 's'}. Remove or reassign those jobs
                before deleting this client.
              </>
            ) : placedCount > 0 ? (
              <>
                <span className="font-medium text-foreground">{client?.name}</span> still has{' '}
                {placedCount} placed employee{placedCount === 1 ? '' : 's'}. End those placements
                before deleting.
              </>
            ) : (
              <>
                This will permanently remove{' '}
                <span className="font-medium text-foreground">{client?.name}</span> from Active
                Clients. This does not affect Marketing Clients.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => void handleConfirm()}
            disabled={blocked || busy}
            className={blocked ? undefined : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'}
          >
            {blocked ? 'Cannot delete' : busy ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
