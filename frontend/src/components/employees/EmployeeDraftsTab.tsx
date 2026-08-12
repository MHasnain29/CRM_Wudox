import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { FilePenLine, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { StoredDraftSummary } from './form/localExtras';

/**
 * Draft tab of the Employees list — locally saved form drafts (device-only,
 * not yet submitted to the server). Continue → reopens the form with the
 * draft restored; Discard → removes it.
 */
export function EmployeeDraftsTab({
  drafts,
  onDiscard,
}: {
  drafts: StoredDraftSummary[];
  onDiscard: (draft: StoredDraftSummary) => void;
}) {
  const navigate = useNavigate();

  if (drafts.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm">
        No drafts on this device. Use “Save Draft” in the employee form to keep work in progress here.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Saved</TableHead>
          <TableHead className="w-[220px]"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {drafts.map((draft) => (
          <TableRow key={draft.storageKey}>
            <TableCell className="font-medium">{draft.name}</TableCell>
            <TableCell>
              <Badge variant="secondary" className="font-normal">
                {draft.employeeId ? 'Edit draft' : 'New application'}
              </Badge>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {draft.savedAt ? format(new Date(draft.savedAt), 'MMM d, yyyy h:mm a') : '—'}
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    navigate(draft.employeeId ? `/employees/${draft.employeeId}/edit` : '/employees/new')
                  }
                >
                  <FilePenLine className="h-3.5 w-3.5 mr-1.5" />
                  Continue
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onDiscard(draft)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Discard
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
