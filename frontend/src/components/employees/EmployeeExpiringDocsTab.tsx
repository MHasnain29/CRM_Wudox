import { useCallback, useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, Clock3, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';
import {
  fetchExpiringEmployeeDocuments,
  type ExpiringEmployeeDocument,
} from '@/lib/api';

const DOC_TYPE_LABELS: Record<string, string> = {
  photo_id: 'Photo ID',
  sin: 'SIN',
  proof_of_status: 'Proof of Status',
  resume: 'Resume',
  agreement: 'Agreement',
  bank_deposit: 'Bank Deposit',
  other: 'Other / License',
  training_certificate: 'Training Certificate',
};

type Props = {
  onSelectEmployee: (employeeId: string) => void;
  onCountsChange?: (counts: { total: number; expired: number; expiring: number }) => void;
};

export function EmployeeExpiringDocsTab({ onSelectEmployee, onCountsChange }: Props) {
  const [rows, setRows] = useState<ExpiringEmployeeDocument[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchExpiringEmployeeDocuments({ withinDays: 90, page: 1, limit: 200 });
      setRows(result.data);
      onCountsChange?.({
        total: result.total,
        expired: result.expiredCount,
        expiring: result.expiringCount,
      });
    } catch (err) {
      toast({
        title: 'Failed to load expiring documents',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
      setRows([]);
      onCountsChange?.({ total: 0, expired: 0, expiring: 0 });
    } finally {
      setLoading(false);
    }
  }, [onCountsChange]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading expiring documents…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm">
        No documents expired or expiring within 90 days.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employee</TableHead>
          <TableHead>Document</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Expiry</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Days</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const isExpired = row.status === 'expired';
          return (
            <TableRow
              key={row.documentId}
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => onSelectEmployee(row.employeeId)}
            >
              <TableCell className="font-medium">
                {row.employeeFirstName} {row.employeeLastName}
              </TableCell>
              <TableCell className="max-w-[220px] truncate" title={row.documentName}>
                {row.documentName}
              </TableCell>
              <TableCell>{DOC_TYPE_LABELS[row.documentType] ?? row.documentType}</TableCell>
              <TableCell>
                {format(parseISO(row.expiryDate), 'MMM d, yyyy')}
              </TableCell>
              <TableCell>
                {isExpired ? (
                  <Badge
                    variant="outline"
                    className="bg-red-50 text-red-700 border-red-200 gap-1"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    Expired
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="bg-amber-50 text-amber-700 border-amber-200 gap-1"
                  >
                    <Clock3 className="h-3 w-3" />
                    Expiring soon
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {isExpired ? (
                  <span className="text-red-600">{Math.abs(row.daysUntil)}d ago</span>
                ) : (
                  <span className="text-amber-700">{row.daysUntil}d</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
