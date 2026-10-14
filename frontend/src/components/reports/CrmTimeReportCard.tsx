import { Clock, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCrmTimeReport, type CrmTimeReportParams } from '@/hooks/useCrmTimeReport';
import { describeCurrentCrmTracking, formatCrmSeconds, formatCrmWorkingHours, summarizeCrmTime, type CrmTimePerson, type CurrentCrmTracking } from '@/lib/crmTimeReport';

interface CrmTimeReportCardProps extends CrmTimeReportParams {
  names?: Record<string, string>;
  title?: string;
}

function CurrentTrackingStatus({ tracking }: { tracking: CurrentCrmTracking }) {
  return (
    <div className="mt-1 space-y-1 text-xs font-normal text-muted-foreground">
      <p><span className="font-medium">Current tracking:</span> {describeCurrentCrmTracking(tracking)}</p>
      {tracking.status !== 'outside_working_hours' && <p>Configured hours: {formatCrmWorkingHours(tracking)}.</p>}
      <p>Checked {new Date(tracking.asOf).toLocaleString()}.
        {tracking.lastObservedAt && <> Last measured interval ended {new Date(tracking.lastObservedAt).toLocaleString()}.</>}
      </p>
    </div>
  );
}

function PersonTimeRow({ person, name, showCurrentTracking }: { person: CrmTimePerson; name: string; showCurrentTracking: boolean }) {
  const timing = person.crmInactivity;
  const measured = timing?.status === 'measured';
  return (
    <tr className="border-b last:border-0">
      <td className="py-3 pr-4 font-medium">
        {name}
        {showCurrentTracking && person.timeSource === 'crm' && person.currentTracking && <CurrentTrackingStatus tracking={person.currentTracking} />}
      </td>
      {person.timeSource === 'hubstaff' ? (
        <td colSpan={4} className="py-3 text-muted-foreground">Tracked in Hubstaff</td>
      ) : (
        <>
          <td className="px-3 py-3 whitespace-nowrap">{formatCrmSeconds(measured ? timing.activeSeconds : null)}</td>
          <td className="px-3 py-3 whitespace-nowrap">{formatCrmSeconds(measured ? timing.idleSeconds : null)}</td>
          <td className="px-3 py-3 whitespace-nowrap">
            {formatCrmSeconds(timing?.breakSeconds)}
            {timing?.breakOngoing && <span className="ml-2 text-xs text-purple-600">Ongoing at cutoff</span>}
          </td>
          <td className="pl-3 py-3 whitespace-nowrap text-muted-foreground">{formatCrmSeconds(measured ? timing.observedSeconds : null)}</td>
        </>
      )}
    </tr>
  );
}

/** Uses only persisted measurement intervals and declared breaks from the report API. */
export function CrmTimeReportCard({ names = {}, title = 'Measured CRM Time', ...params }: CrmTimeReportCardProps) {
  const { data, isPending, isFetching, error, refetch, hasAudience } = useCrmTimeReport(params);
  const people = params.enabled === false || !hasAudience ? [] : data?.people ?? [];
  const totals = summarizeCrmTime(people);
  const loading = isPending && hasAudience && params.enabled !== false;
  const asOf = data?.asOf ? new Date(data.asOf).toLocaleString() : null;
  const singleTracking = people.length === 1 && people[0].timeSource === 'crm' ? people[0].currentTracking : undefined;
  const hasCurrentTracking = people.some(person => person.timeSource === 'crm' && person.currentTracking);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base"><Clock className="h-5 w-5 text-primary" />{title}</CardTitle>
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching || !hasAudience || params.enabled === false} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading measured time...</p>}
        {error && <p role="alert" className="text-sm text-destructive">{data ? 'Could not refresh measured time. Showing the last loaded values. ' : ''}{error.message}</p>}
        {params.enabled === false && <p className="text-sm text-muted-foreground">Waiting for the selected scope.</p>}
        {!loading && !error && params.enabled !== false && (!hasAudience || people.length === 0) && <p className="text-sm text-muted-foreground">No people in the selected scope.</p>}
        {totals.crmCount > 0 && (
          <>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              {[
                { label: 'CRM Active', value: totals.activeSeconds, color: 'text-green-600' },
                { label: 'CRM Inactivity', value: totals.idleSeconds, color: 'text-amber-600' },
                { label: 'Recorded Break', value: totals.breakSeconds, color: 'text-purple-600' },
                { label: 'Observed Coverage', value: totals.observedSeconds, color: 'text-primary' },
              ].map(metric => (
                <div key={metric.label} className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground mb-1">{metric.label}</p>
                  <p className={`text-lg font-semibold ${metric.color}`}>{formatCrmSeconds(metric.value)}</p>
                  {metric.label === 'Recorded Break' && totals.breakOngoing && <p className="text-xs text-purple-600 mt-1">Includes break ongoing at cutoff</p>}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {totals.partial ? `Active and inactivity totals cover ${totals.measuredCount} of ${totals.crmCount} CRM users with observations. ` : ''}
              {totals.measuredCount === 0 ? 'Active and inactivity are unavailable: no observed CRM time in this period. ' : ''}
              Active and inactivity include observed CRM time during working hours. Inactivity begins after the configured grace period. Breaks are recorded separately; unobserved time is excluded.
              {' '}These values describe CRM interaction, not total working time or work quality.
            </p>
            {singleTracking && <div className="rounded-lg bg-muted/40 p-3"><CurrentTrackingStatus tracking={singleTracking} /></div>}
          </>
        )}
        {people.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-xs text-muted-foreground text-left">
                <th className="pb-2 pr-4 font-medium">Person</th><th className="px-3 pb-2 font-medium">CRM Active</th><th className="px-3 pb-2 font-medium">CRM Inactivity</th><th className="px-3 pb-2 font-medium">Recorded Break</th><th className="pl-3 pb-2 font-medium">Observed Coverage</th>
              </tr></thead>
              <tbody>{people.map(person => <PersonTimeRow key={person.userId} person={person} name={names[person.userId] ?? person.name ?? 'User'} showCurrentTracking={people.length > 1} />)}</tbody>
            </table>
          </div>
        )}
        {totals.hubstaffCount > 0 && <p className="text-xs text-muted-foreground">{totals.hubstaffCount} IT {totals.hubstaffCount === 1 ? 'user is' : 'users are'} tracked in Hubstaff and excluded from CRM time totals.</p>}
        {hasCurrentTracking && <p className="text-xs text-muted-foreground">Current tracking status describes the latest check only; it does not explain unobserved time earlier in this period.</p>}
        {asOf && <p className="text-xs text-muted-foreground">As of {asOf}. Current-period time refreshes every 30 seconds.</p>}
      </CardContent>
    </Card>
  );
}
