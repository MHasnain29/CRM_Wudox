import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { fetchDatabaseManagerReport, type DatabaseManagerReportRow } from '@/lib/api';
import { toast } from 'sonner';

type Props = {
  startDate: string;
  endDate: string;
};

export function DatabaseManagerReportSection({ startDate, endDate }: Props) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<DatabaseManagerReportRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDatabaseManagerReport({ startDate, endDate })
      .then((data) => { if (!cancelled) setRows(data.managers); })
      .catch((e) => {
        if (!cancelled) toast.error(e instanceof Error ? e.message : 'Failed to load database manager report');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [startDate, endDate]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Database Managers</CardTitle>
        <CardDescription>
          Clients approved into the global database per Database Manager for the selected date range.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No database managers or no activity in this period.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="text-right">Approved</TableHead>
                <TableHead className="text-right">Pending</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.userId}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.email}</TableCell>
                  <TableCell className="text-right">{r.approvedCount}</TableCell>
                  <TableCell className="text-right">{r.pendingCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
