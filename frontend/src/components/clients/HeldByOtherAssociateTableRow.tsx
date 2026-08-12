import { Lock } from 'lucide-react';
import { TableCell, TableRow } from '@/components/ui/table';

/** Columns after ID: Client Name … Actions */
export const HELD_CLIENT_TABLE_COL_SPAN = 7;

export const HELD_BY_OTHER_ASSOCIATE_LABEL = 'Assigned to someone else';

type Props = {
  rowNum: number;
};

/** Associate list row when another user owns the open lead — no client details or actions. */
export function HeldByOtherAssociateTableRow({ rowNum }: Props) {
  return (
    <TableRow className="cursor-not-allowed bg-muted/20 hover:bg-muted/20">
      <TableCell className="text-muted-foreground/70 text-sm align-middle py-3 w-12">{rowNum}</TableCell>
      <TableCell colSpan={HELD_CLIENT_TABLE_COL_SPAN} className="align-middle py-3">
        <div className="flex items-center justify-center w-full">
          <span className="inline-flex items-center gap-2 rounded-md border border-dashed border-muted-foreground/25 bg-muted/40 px-4 py-2 text-sm font-medium text-muted-foreground">
            <Lock className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
            {HELD_BY_OTHER_ASSOCIATE_LABEL}
          </span>
        </div>
      </TableCell>
    </TableRow>
  );
}
