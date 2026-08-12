import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, Clock3, FileWarning, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  fetchExpiringEmployeeDocuments,
  type ExpiringEmployeeDocument,
} from '@/lib/api';

export function ExpiringDocumentsWidget() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ExpiringEmployeeDocument[]>([]);
  const [expiredCount, setExpiredCount] = useState(0);
  const [expiringCount, setExpiringCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchExpiringEmployeeDocuments({ withinDays: 90, page: 1, limit: 8 });
      setRows(result.data);
      setExpiredCount(result.expiredCount);
      setExpiringCount(result.expiringCount);
    } catch {
      setRows([]);
      setExpiredCount(0);
      setExpiringCount(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card className="border-none shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <FileWarning className="h-4 w-4 text-amber-600" />
            Document Expiry
          </CardTitle>
          <CardDescription>Expired or within 90 days</CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/employees?tab=expiring')}>
          View all
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border bg-red-50/60 border-red-100 px-3 py-2">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-red-600" />
              Expired
            </p>
            <p className="text-2xl font-semibold tabular-nums text-red-700">{expiredCount}</p>
          </div>
          <div className="rounded-lg border bg-amber-50/60 border-amber-100 px-3 py-2">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock3 className="h-3 w-3 text-amber-600" />
              Expiring soon
            </p>
            <p className="text-2xl font-semibold tabular-nums text-amber-700">{expiringCount}</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No documents need attention.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => {
              const isExpired = row.status === 'expired';
              return (
                <li
                  key={row.documentId}
                  className="flex items-start justify-between gap-2 text-sm border-b last:border-0 pb-2 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {row.employeeFirstName} {row.employeeLastName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{row.documentName}</p>
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    {isExpired ? (
                      <Badge
                        variant="outline"
                        className="bg-red-50 text-red-700 border-red-200 text-[10px]"
                      >
                        Expired
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]"
                      >
                        {row.daysUntil}d
                      </Badge>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      {format(parseISO(row.expiryDate), 'MMM d')}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
