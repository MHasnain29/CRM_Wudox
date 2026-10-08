import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Mail, Loader2 } from 'lucide-react';
import { startOfMonth, format } from 'date-fns';
import { fetchBulkEmailConversionRate } from '@/lib/api';
import { conversionQueryArgs, type ConversionCardRange } from '@/lib/conversionQuery';

export type { ConversionCardRange };

interface Props {
  agencyId?: string;    // optional; elevated roles can scope to a specific agency
  /** Several agencies at once (elevated callers; the server keeps the ones they may see). */
  agencyIds?: string[];
  /** True while the accessible-agencies list is still resolving: the query waits, so it never falls back to the caller's own agency for a moment. */
  agenciesLoading?: boolean;
  /** Only campaigns created by these users — the same scope the campaign list beside the card uses. */
  ownerIds?: string[];
  /** Passed explicitly (never read from the global ownerExactFlag) so the key and the request always agree. */
  ownerExact?: boolean;
  startDate?: string;   // YYYY-MM-DD (legacy; the Reports page). Defaults to start of current month.
  endDate?: string;     // YYYY-MM-DD (legacy). Defaults to today.
  /** Takes precedence over startDate/endDate and the month-to-date default. */
  range?: ConversionCardRange;
  /** Header note when `range` is given, e.g. "Last 7 Days · Oct 2 – Oct 8". */
  periodCaption?: string;
  title?: string;       // override card title
}

/** A 4xx is deterministic (bad query, no permission) — retrying only delays the error. */
function isClientError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  return !!status && status >= 400 && status < 500;
}

export function AgencyBulkEmailConversionCard({
  agencyId, agencyIds, agenciesLoading = false, ownerIds, ownerExact,
  startDate: startDateProp, endDate: endDateProp, range, periodCaption, title,
}: Props) {
  const { key, params } = conversionQueryArgs({ agencyId, agencyIds, ownerIds, ownerExact, startDate: startDateProp, endDate: endDateProp, range });

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: key,
    queryFn: () => fetchBulkEmailConversionRate(params),
    enabled: !agenciesLoading,
    // On Bulk Mail (range given) transient failures are retried and the card polls like the campaign list;
    // the Reports page keeps its original single attempt and one-shot fetch.
    retry: (count, error) => !!range && !isClientError(error) && count < 2,
    refetchInterval: range ? 30_000 : false,
  });

  const loadFailed = isError && data === undefined;
  const headerNote = range
    ? periodCaption
    : !startDateProp && !endDateProp
      ? `${format(startOfMonth(new Date()), 'MMM d')} – Today`
      : undefined;

  return (
    <Card className="border-none shadow-sm">
      <CardHeader className="pb-3 pt-5 px-6">
        <CardTitle className="flex items-center gap-2 text-base text-purple-600">
          <Mail className="h-4 w-4" />
          {title ?? 'Bulk Email Conversion Rate'}
          {headerNote && (
            <span className="ml-auto text-xs font-normal text-muted-foreground" aria-live="polite">
              {headerNote}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-6 pb-5">
        {isPending ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : loadFailed ? (
          range ? (
            <div role="alert" className="flex flex-col items-center gap-2 py-2 text-center">
              <p className="text-sm text-muted-foreground">Couldn't load conversion rate.</p>
              <Button variant="outline" size="sm" onClick={() => { void refetch(); }}>Retry</Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-2 text-center">No data available for this period.</p>
          )
        ) : data ? (() => {
          const { count, conversions } = data;
          const valueColor = conversions > 0 ? 'text-green-600' : 'text-muted-foreground';
          return (
            <div className="space-y-1">
              <span className={`text-3xl font-bold ${valueColor}`}>{conversions}</span>
              <p className={`text-xs ${valueColor}`}>Converted leads</p>
              <p className="text-xs text-muted-foreground">{count} emails sent</p>
            </div>
          );
        })() : null}
      </CardContent>
    </Card>
  );
}
