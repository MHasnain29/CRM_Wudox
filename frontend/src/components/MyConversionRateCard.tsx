import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Phone, Loader2 } from 'lucide-react';
import { startOfMonth, endOfDay, format } from 'date-fns';
import {
  fetchMyConversionRate,
  fetchConversionRates,
  type MyConversionRateResult,
} from '@/lib/api';

type Mode = 'self' | 'user' | 'team';

interface Props {
  activity: 'calls';
  mode?: Mode;
  userId?: string;       // required for mode='user'
  userName?: string;     // display name for mode='user'
  agencyId?: string;     // optional scope for mode='team' (elevated role + specific agency)
  label?: string;        // override the card title
  startDate?: string;    // YYYY-MM-DD (defaults to start of current month)
  endDate?: string;      // YYYY-MM-DD (defaults to today)
}

interface Metric {
  count: number;
  conversions: number;
  rate: number | null;
}

function calcRate(count: number, conversions: number): number | null {
  if (count === 0) return null;
  const raw = (conversions / count) * 100;
  return Math.round(raw * 10) / 10;
}

export function MyConversionRateCard({ activity, mode = 'self', userId, userName, agencyId, label, startDate: startDateProp, endDate: endDateProp }: Props) {
  const [metric, setMetric]   = useState<Metric | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const startDate = startDateProp ?? format(startOfMonth(new Date()), 'yyyy-MM-dd');
    const endDate   = endDateProp   ?? format(endOfDay(new Date()),     'yyyy-MM-dd');
    setLoading(true);

    const run = async () => {
      try {
        if (mode === 'self') {
          const r: MyConversionRateResult | null = await fetchMyConversionRate({
            startDate,
            endDate,
            source: 'call',
            dateBasis: 'assigned',
          });
          setMetric(r ? r[activity] : null);
          return;
        }

        if (mode === 'user' && userId) {
          const results = await fetchConversionRates({
            startDate,
            endDate,
            userIds: [userId],
            source: 'call',
            dateBasis: 'assigned',
          });
          const hit = results.find((u) => u.userId === userId);
          setMetric(hit ? hit[activity] : { count: 0, conversions: 0, rate: null });
          return;
        }

        if (mode === 'team') {
          const results = await fetchConversionRates({
            startDate,
            endDate,
            agencyIds: agencyId ? [agencyId] : undefined,
            source: 'call',
            dateBasis: 'assigned',
          });
          // Aggregate counts across users. For conversions, a single won lead can
          // be credited to multiple users (e.g. a handoff), so cap at count to
          // avoid misleading >100% from cross-attribution.
          let totalCount = 0;
          let totalConv  = 0;
          for (const r of results) {
            const m = r[activity];
            totalCount += m.count;
            totalConv  += m.conversions;
          }
          const cappedConv = Math.min(totalConv, totalCount);
          setMetric({ count: totalCount, conversions: cappedConv, rate: calcRate(totalCount, cappedConv) });
          return;
        }

        setMetric(null);
      } catch {
        setMetric(null);
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [activity, mode, userId, agencyId, startDateProp, endDateProp]);

  const activityLabel = 'Call Conversion Rate';
  const defaultTitle =
    mode === 'self' ? `My ${activityLabel}` :
    mode === 'user' ? `${userName ?? 'User'} — ${activityLabel}` :
    `Team ${activityLabel}`;
  const title = label ?? defaultTitle;

  return (
    <Card className="border-none shadow-sm">
      <CardHeader className="pb-3 pt-5 px-6">
        <CardTitle className="flex items-center gap-2 text-base text-blue-600">
          <Phone className="h-4 w-4" />
          {title}
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
          const { count, conversions, rate } = metric;
          const rateColor = rate === null ? 'text-muted-foreground' : rate >= 15 ? 'text-green-600' : rate >= 7 ? 'text-amber-600' : 'text-red-500';
          return (
            <div className="space-y-1">
              <span className={`text-3xl font-bold ${rateColor}`}>{rate === null ? '—' : `${rate}%`}</span>
              <p className={`text-xs ${rateColor}`}>{conversions} won / {count} calls</p>
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}
