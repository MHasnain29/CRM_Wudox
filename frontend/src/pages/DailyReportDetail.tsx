import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, ExternalLink, Loader2 } from 'lucide-react';
import { useStore } from '@/lib/store';
import { useHasPermission } from '@/lib/access';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  REPORT_PROFILES,
  getDailyReportSnapshot,
  type DailyReportPayload,
  type ReportEmployee,
  type ReportMetric,
} from '@/lib/dailyReportsApi';

function duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'Unavailable';
  if (seconds > 0 && seconds < 60) return '<1m';
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function timestamp(value: string | null, timezone: string): string {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unavailable';
  return date.toLocaleString(undefined, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' });
}

function metricValue(metric: ReportMetric): string {
  if (metric.value === null) return 'Unavailable';
  if (metric.unit === 'seconds') return duration(metric.value);
  if (metric.unit === '%' || metric.unit === 'percent') return `${metric.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  return `${metric.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}${metric.unit ? ` ${metric.unit}` : ''}`;
}

function SourceLink({ url, children }: { url: string | null; children: ReactNode }) {
  // Evidence comes from imported providers. Only local paths and web URLs are navigable.
  const isLocal = url?.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\');
  if (!url || (!/^https?:\/\//i.test(url) && !isLocal)) return <>{children}</>;
  if (url.startsWith('/')) return <Link to={url} className="text-primary hover:underline">{children}</Link>;
  return <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">{children}<ExternalLink className="h-3 w-3 shrink-0" /></a>;
}

function EmployeeReport({ person, timezone }: { person: ReportEmployee; timezone: string }) {
  const software = person.profile === 'software';
  const evidence = software ? person.evidence.filter((item) => item.type.startsWith('hubstaff')) : person.evidence;
  const metrics = software ? person.metrics.filter((metric) => metric.key.startsWith('hubstaff')) : person.metrics;
  return (
    <Card id={`employee-${person.userId}`} className="scroll-mt-6">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><CardTitle className="text-lg">{person.name}</CardTitle><CardDescription>{person.agencyName} · <span className="capitalize">{person.role.replace(/_/g, ' ')}</span></CardDescription></div>
          <div className="flex flex-wrap gap-2"><Badge variant="secondary">{software ? 'Hubstaff' : 'Hubstaff + CRM'}</Badge><Badge variant={person.time.status === 'complete' ? 'secondary' : 'outline'}>Time data: {person.time.status}</Badge></div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {person.warnings.length > 0 && <ul className="list-disc space-y-1 rounded-md bg-amber-50 p-3 pl-7 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{person.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {[
            ['Recorded time', duration(person.time.trackedSeconds)],
            ['Manual time', duration(person.time.manualSeconds)],
            ['Idle time', duration(person.time.idleSeconds)],
            ['Without a task', duration(person.time.unallocatedSeconds)],
            ['Input activity', person.time.inputActivityPercent === null ? 'Unavailable' : `${person.time.inputActivityPercent.toFixed(1)}%`],
          ].map(([label, value]) => <div key={label} className="rounded-md bg-muted/50 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-lg font-semibold">{value}</dd></div>)}
        </dl>
        {person.time.categories?.length > 0 && <div><h4 className="mb-2 text-sm font-semibold">Time by project and work category</h4><Table><TableHeader><TableRow><TableHead>Project</TableHead><TableHead>Work category</TableHead><TableHead>Recorded time</TableHead></TableRow></TableHeader><TableBody>{person.time.categories.map((category, index) => <TableRow key={`${category.project}:${category.profile}:${index}`}><TableCell>{category.project}</TableCell><TableCell>{REPORT_PROFILES.find((profile) => profile.key === category.profile)?.label ?? category.profile.replace(/_/g, ' ')}</TableCell><TableCell>{duration(category.trackedSeconds)}</TableCell></TableRow>)}</TableBody></Table></div>}
        {!software && person.crmUsage && <div className="rounded-md border p-3 text-sm"><h4 className="font-semibold">CRM activity</h4><p className="mt-1">{person.crmUsage.recordedEvents.toLocaleString()} recorded work events</p>{person.crmUsage.firstActivityAt && <p className="mt-1 text-xs text-muted-foreground">First: {timestamp(person.crmUsage.firstActivityAt, timezone)} · Last: {timestamp(person.crmUsage.lastActivityAt, timezone)}</p>}<p className="mt-1 text-xs text-muted-foreground">These events show recorded actions in CRM. They do not measure time spent in CRM and are not added to Hubstaff working hours.</p></div>}
        {metrics.length > 0 && <div><h4 className="mb-2 text-sm font-semibold">Work results</h4><dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{metrics.map((metric) => <div key={metric.key} className="rounded-md border p-3"><dt className="text-xs text-muted-foreground">{metric.label}</dt><dd className="mt-1 text-lg font-semibold">{metricValue(metric)}</dd></div>)}</dl></div>}
        <div>
          <h4 className="mb-2 text-sm font-semibold">Hubstaff tasks</h4>
          {person.tasks.length === 0 ? <p className="text-sm text-muted-foreground">No task details are available for this reporting period.</p> : (
            <>
              <Table>
                <TableHeader><TableRow><TableHead>Task / project</TableHead><TableHead>Status</TableHead><TableHead>Time this day</TableHead><TableHead>Total recorded time</TableHead><TableHead>Employee contribution</TableHead><TableHead>Estimate</TableHead><TableHead>Dates</TableHead></TableRow></TableHeader>
                <TableBody>{person.tasks.map((task) => <TableRow key={task.id}>
                  <TableCell className="min-w-52"><SourceLink url={task.sourceUrl}>{task.title}</SourceLink><span className="mt-1 block text-xs text-muted-foreground">{task.projectName}</span></TableCell>
                  <TableCell><Badge variant="outline">{task.status.replace(/_/g, ' ')}</Badge></TableCell>
                  <TableCell className="whitespace-nowrap">{duration(task.todaySeconds)}</TableCell>
                  <TableCell className="whitespace-nowrap">{duration(task.totalSeconds)}</TableCell>
                  <TableCell className="whitespace-nowrap">{duration(task.contributionSeconds)}</TableCell>
                  <TableCell className="whitespace-nowrap">{duration(task.estimateSeconds)}{task.estimateSeconds !== null && task.estimateSeconds > 0 && task.totalSeconds !== null && task.totalSeconds > task.estimateSeconds && <span className="block text-xs text-amber-700 dark:text-amber-400">{duration(task.totalSeconds - task.estimateSeconds)} over estimate</span>}</TableCell>
                  <TableCell className="min-w-44 text-xs">{task.completedAt && <p>Completed: {timestamp(task.completedAt, timezone)}</p>}{task.dueAt && <p>Due: {timestamp(task.dueAt, timezone)}</p>}{!task.completedAt && !task.dueAt && 'Unavailable'}</TableCell>
                </TableRow>)}</TableBody>
              </Table>
              <p className="mt-2 text-xs text-muted-foreground">Total recorded time includes effort across contributors and days, when the full task history is available. Employee contribution is this person’s recorded effort. Shared task rows must not be added together to calculate company totals.</p>
            </>
          )}
        </div>
        {evidence.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm font-semibold">{software ? 'Hubstaff task records' : 'Work records'} ({evidence.length})</summary>
            <Table className="mt-2"><TableHeader><TableRow><TableHead>Work</TableHead><TableHead>Type</TableHead><TableHead>Recorded at</TableHead></TableRow></TableHeader><TableBody>{evidence.map((item, index) => <TableRow key={`${item.type}:${item.at}:${index}`}><TableCell><SourceLink url={item.url}>{item.title}</SourceLink></TableCell><TableCell className="capitalize">{item.type.replace(/_/g, ' ')}</TableCell><TableCell className="whitespace-nowrap">{timestamp(item.at, timezone)}</TableCell></TableRow>)}</TableBody></Table>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

export default function DailyReportDetail() {
  const { id } = useParams<{ id: string }>();
  const contextKey = useStore((state) => `${state.currentUser?.id ?? ''}:${state.viewedSubCompanyId ?? state.currentSubCompany?.id ?? ''}`);
  return <SnapshotDetail key={`${id}:${contextKey}`} id={id} />;
}

function SnapshotDetail({ id }: { id: string | undefined }) {
  const { hash } = useLocation();
  const canViewSettings = useHasPermission('settings:read');
  const [report, setReport] = useState<DailyReportPayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const includesCrmWork = report?.people.some((person) => person.profile !== 'software') ?? false;
  useEffect(() => {
    if (!report || !hash.startsWith('#employee-')) return;
    try { document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' }); }
    catch { /* An invalid fragment must not prevent the report from loading. */ }
  }, [report, hash]);
  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setLoading(true);
    setError('');
    if (!id) { setLoading(false); setError('The report link is missing its identifier.'); return; }
    getDailyReportSnapshot(id)
      .then((result) => { if (!cancelled) setReport(result); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load this report.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, reload]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <Button asChild variant="ghost" size="sm"><Link to={canViewSettings ? '/settings?tab=daily-reports' : '/reports'}><ArrowLeft className="mr-2 h-4 w-4" />{canViewSettings ? 'Daily report settings' : 'Reports'}</Link></Button>
      {loading ? <div role="status" className="flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" />Loading report…</div> : error ? <Card><CardContent className="space-y-3 pt-6"><p role="alert" className="text-destructive">{error}</p><Button variant="outline" onClick={() => setReload((value) => value + 1)}>Try again</Button></CardContent></Card> : report ? (
        <>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">{report.title}</h1>
            <p className="text-muted-foreground">{report.reportDate.slice(0, 10)} · {report.timezone} · Recipient: {report.recipient.email}</p>
            <p className="text-sm text-muted-foreground">Reporting window: {timestamp(report.periodStart, report.timezone)} – {timestamp(report.periodEnd, report.timezone)}</p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" />Saved {timestamp(report.generatedAt, report.timezone)}. This snapshot preserves the figures used for this report.</p>
          </div>
          {report.warnings.length > 0 && <div role="status" className="rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"><h2 className="font-semibold">Attention needed</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{report.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {[
              ['People', String(report.summary.people)],
              ['Recorded time', duration(report.summary.trackedSeconds)],
              ['Tasks completed', report.summary.completedTasks === null ? 'Unavailable' : String(report.summary.completedTasks)],
              ...(includesCrmWork ? [
                ['Personal emails', String(report.summary.personalEmails)],
                ...(report.summary.repliesReceived === undefined ? [] : [['Replies received', String(report.summary.repliesReceived)]]),
                ['Follow-ups completed', String(report.summary.followUpsCompleted)],
              ] : []),
            ].map(([label, value]) => <div key={label} className="rounded-lg border bg-card p-4"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 text-2xl font-semibold">{value}</dd></div>)}
          </dl>
          <Card><CardHeader><CardTitle className="text-base">Data coverage</CardTitle><CardDescription>Missing or incomplete tracking is shown explicitly. Input activity is context for keyboard and mouse usage; it is not a productivity score.</CardDescription></CardHeader><CardContent><div className="flex flex-wrap gap-4">{report.sources.map((source, index) => <div key={`${source.label}:${index}`} className="min-w-52 rounded-md border p-3"><p className="text-sm font-medium">{source.label} <Badge variant="outline">{source.status.replace(/_/g, ' ')}</Badge></p><p className="mt-1 text-xs text-muted-foreground">Last synchronized: {timestamp(source.lastSyncedAt, report.timezone)}</p></div>)}</div></CardContent></Card>
          {REPORT_PROFILES.map((profile) => {
            const people = report.people.filter((person) => person.profile === profile.key);
            if (people.length === 0) return null;
            return <section key={profile.key} className="space-y-4" aria-labelledby={`department-${profile.key}`}><h2 id={`department-${profile.key}`} className="text-xl font-semibold">{profile.label} <span className="text-base font-normal text-muted-foreground">({people.length})</span></h2>{people.map((person) => <EmployeeReport key={person.userId} person={person} timezone={report.timezone} />)}</section>;
          })}
          {report.people.length === 0 && <Card><CardContent className="pt-6 text-center text-muted-foreground">No users are available in this report’s saved scope.</CardContent></Card>}
        </>
      ) : null}
    </div>
  );
}
