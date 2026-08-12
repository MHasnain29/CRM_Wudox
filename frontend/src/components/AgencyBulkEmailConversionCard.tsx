import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Mail, Loader2 } from 'lucide-react';
import { startOfMonth, endOfDay, format } from 'date-fns';
import { fetchBulkEmailConversionRate, type BulkEmailConversionRateResult } from '@/lib/api';

interface Props {
  agencyId?: string;    // optional; elevated roles can scope to a specific agency
  startDate?: string;   // YYYY-MM-DD (defaults to start of current month)
  endDate?: string;     // YYYY-MM-DD (defaults to today)
  title?: string;       // override card title
}

export function AgencyBulkEmailConversionCard({ agencyId, startDate: startDateProp, endDate: endDateProp, title }: Props) {
  const [metric, setMetric] = useState<BulkEmailConversionRateResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const startDate = startDateProp ?? format(startOfMonth(new Date()), 'yyyy-MM-dd');
    const endDate   = endDateProp   ?? format(endOfDay(new Date()),     'yyyy-MM-dd');
    setLoading(true);

    fetchBulkEmailConversionRate({
      startDate,
      endDate,
      agencyId,
      source: 'mail',
      dateBasis: 'assigned',
    })
      .then((r) => setMetric(r))
      .catch(() => setMetric(null))
      .finally(() => setLoading(false));
  }, [agencyId, startDateProp, endDateProp]);

  return (
    <Card className="border-none shadow-sm">
      <CardHeader className="pb-3 pt-5 px-6">
        <CardTitle className="flex items-center gap-2 text-base text-purple-600">
          <Mail className="h-4 w-4" />
          {title ?? 'Bulk Email Conversion Rate'}
          {!startDateProp && !endDateProp && (
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {format(startOfMonth(new Date()), 'MMM d')} – Today
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-6 pb-5">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !metric ? (
          <p className="text-sm text-muted-foreground py-2 text-center">No data available for this period.</p>
        ) : (() => {
          const { count, conversions } = metric;
          const valueColor = conversions > 0 ? 'text-green-600' : 'text-muted-foreground';
          return (
            <div className="space-y-1">
              <span className={`text-3xl font-bold ${valueColor}`}>{conversions}</span>
              <p className={`text-xs ${valueColor}`}>Converted leads</p>
              <p className="text-xs text-muted-foreground">{count} emails sent</p>
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}
