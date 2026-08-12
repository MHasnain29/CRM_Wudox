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
import { Eye, Loader2, RefreshCw } from 'lucide-react';

export type PairSigningMember = {
  id: string;
  label: string;
  shortLabel: string;
  pandaDocStatus: string | null;
  pandaDocId: string | null;
};

type Props = {
  members: PairSigningMember[];
  receivedManual: boolean;
  isSyncing?: boolean;
  onPreview: (proposalId: string) => void;
  onSync?: (pandaDocId: string) => void;
};

function memberSigned(m: PairSigningMember) {
  return m.pandaDocStatus === 'document.completed';
}

function statusLabel(status: string | null): string {
  if (!status) return 'Pending';
  const map: Record<string, string> = {
    'document.draft': 'Preparing',
    'document.sent': 'Sent',
    'document.viewed': 'Viewed',
    'document.completed': 'Signed',
    'document.declined': 'Declined',
    'document.voided': 'Voided',
  };
  return map[status] ?? status.replace('document.', '');
}

/**
 * CRM-style document table for Temp / Direct (or single) PandaDoc rows.
 */
export function PairSigningStatusSection({
  members,
  receivedManual,
  isSyncing,
  onPreview,
  onSync,
}: Props) {
  const anySigned = members.some(memberSigned);
  const ready = anySigned || receivedManual;
  const multi = members.length > 1;

  return (
    <div className="rounded-md border overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b bg-muted/40">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Agreements
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {ready
              ? multi
                ? 'Ready — either signed agreement unlocks activation'
                : 'Ready to activate'
              : 'Waiting for client signature'}
          </p>
        </div>
        <Badge
          variant="secondary"
          className={
            ready
              ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-50'
              : undefined
          }
        >
          {ready ? 'Ready' : 'Waiting'}
        </Badge>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-9 text-xs">Agreement</TableHead>
            <TableHead className="h-9 text-xs w-[100px]">Status</TableHead>
            <TableHead className="h-9 text-xs text-right w-[148px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => {
            const signed = memberSigned(m);
            const canSync = Boolean(m.pandaDocId && !signed && onSync);
            return (
              <TableRow key={m.id}>
                <TableCell className="py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{m.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {signed ? 'Signed by client' : statusLabel(m.pandaDocStatus) === 'Viewed' ? 'Opened, not signed yet' : 'Not signed yet'}
                    </p>
                  </div>
                </TableCell>
                <TableCell className="py-2.5">
                  <Badge
                    variant="secondary"
                    className={
                      signed
                        ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-50 font-normal'
                        : 'font-normal text-muted-foreground'
                    }
                  >
                    {statusLabel(m.pandaDocStatus)}
                  </Badge>
                </TableCell>
                <TableCell className="py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 w-[88px] justify-center gap-1.5"
                      onClick={() => onPreview(m.id)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Preview
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0"
                      title={canSync ? 'Sync status' : 'Sync unavailable'}
                      disabled={!canSync || isSyncing}
                      onClick={() => {
                        if (canSync) onSync!(m.pandaDocId!);
                      }}
                    >
                      {isSyncing && canSync ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
