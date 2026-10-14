import { Loader2, Mail, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useEmailActivityReport, type EmailActivityReportParams } from '@/hooks/useEmailActivityReport';
import { summarizeEmailActivity, totalEmailsSent } from '@/lib/emailActivityReport';

interface EmailActivityReportCardProps extends EmailActivityReportParams {
  names?: Record<string, string>;
  title?: string;
}

/** Individual vs bulk emails sent, for whoever the page's agency / manager / user filters select. */
export function EmailActivityReportCard({ names = {}, title = 'Email Activity', ...params }: EmailActivityReportCardProps) {
  const { data, isPending, isFetching, error, refetch, hasAudience } = useEmailActivityReport(params);
  const waiting = params.enabled === false;
  const people = waiting || !hasAudience ? [] : [...(data?.people ?? [])]
    .sort((a, b) => totalEmailsSent(b) - totalEmailsSent(a) || a.name.localeCompare(b.name));
  const totals = summarizeEmailActivity(people);
  const loading = isPending && hasAudience && !waiting;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base"><Mail className="h-5 w-5 text-purple-500" />{title}</CardTitle>
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching || !hasAudience || waiting} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading email activity...</p>}
        {error && <p role="alert" className="text-sm text-destructive">{data ? 'Could not refresh email activity. Showing the last loaded values. ' : ''}{error.message}</p>}
        {waiting && <p className="text-sm text-muted-foreground">Waiting for the selected scope.</p>}
        {!loading && !error && !waiting && people.length === 0 && <p className="text-sm text-muted-foreground">No people in the selected scope.</p>}
        {people.length > 0 && (
          <>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              {[
                { label: 'Individual Emails', value: totals.individualEmails, color: 'text-blue-600' },
                { label: 'Bulk Campaigns', value: totals.bulkCampaigns, color: 'text-purple-600' },
                { label: 'Bulk Emails Sent', value: totals.bulkEmails, color: 'text-purple-600' },
                { label: 'Total Emails Sent', value: totals.totalEmails, color: 'text-primary' },
              ].map(metric => (
                <div key={metric.label} className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground mb-1">{metric.label}</p>
                  <p className={`text-lg font-semibold tabular-nums ${metric.color}`}>{metric.value.toLocaleString()}</p>
                </div>
              ))}
            </div>
            {people.length > 1 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-xs text-muted-foreground text-left">
                    <th className="pb-2 pr-4 font-medium">Person</th>
                    <th className="px-3 pb-2 font-medium text-center">Individual Emails</th>
                    <th className="px-3 pb-2 font-medium text-center">Bulk Campaigns</th>
                    <th className="px-3 pb-2 font-medium text-center">Bulk Emails Sent</th>
                    <th className="pl-3 pb-2 font-medium text-center">Total</th>
                  </tr></thead>
                  <tbody>
                    {people.map(person => (
                      <tr key={person.userId} className="border-b last:border-0">
                        <td className="py-3 pr-4 font-medium">{names[person.userId] ?? person.name}</td>
                        <td className="px-3 py-3 text-center tabular-nums text-blue-600 font-semibold">{person.individual.emails.toLocaleString()}</td>
                        <td className="px-3 py-3 text-center tabular-nums text-purple-600 font-semibold">{person.bulk.campaigns.toLocaleString()}</td>
                        <td className="px-3 py-3 text-center tabular-nums text-purple-600 font-semibold">{person.bulk.emails.toLocaleString()}</td>
                        <td className="pl-3 py-3 text-center tabular-nums font-semibold">{totalEmailsSent(person).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Individual emails are messages sent from the CRM inbox. Bulk emails are campaign sends, credited to the person who created the
              campaign and counted on the day each email was sent. Only emails the mail provider accepted are counted.
              The Emails Sent figure elsewhere on this page counts client activity-log entries, so it can differ.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
