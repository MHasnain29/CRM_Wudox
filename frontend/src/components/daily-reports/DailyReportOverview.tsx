import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, Clock, Eye } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { DailyReportPayload, DailyReportPresentation, ReportEmployee, ReportPersonPresentation } from '@/lib/dailyReportsApi';

const STATUS_TONES = {
  bad: 'border-transparent bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  warn: 'border-transparent bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  ok: 'border-transparent bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300',
  muted: 'border-transparent bg-muted text-muted-foreground',
};

function timestamp(value: string | null, timezone: string): string {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'Unavailable';
  return new Date(value).toLocaleString(undefined, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' });
}

function MetricLine({ line }: { line: ReportPersonPresentation['lines'][number] }) {
  return (
    <div className="flex gap-3 border-t border-border/60 py-2 first:border-0">
      <dt className="w-20 shrink-0 text-xs font-medium text-muted-foreground sm:w-24">{line.name}</dt>
      <dd className={`min-w-0 flex-1 text-sm ${line.stacked ? 'space-y-1' : 'flex flex-wrap gap-x-2 gap-y-1'}`}>
        {line.groups.map((group, index) => typeof group === 'string'
          ? <span key={index} className={`${line.stacked ? 'block ' : ''}text-xs text-muted-foreground`}>{group}</span>
          : <span key={index} className="flex flex-wrap gap-x-1.5 gap-y-1">
            {group.map((item, itemIndex) => <Fragment key={`${item.label}:${itemIndex}`}>
              {itemIndex > 0 && <span aria-hidden="true" className="text-muted-foreground/40">·</span>}
              <span className={`whitespace-nowrap ${item.tone === 'bad' ? 'text-red-600 dark:text-red-400' : item.tone === 'zero' ? 'text-muted-foreground' : 'text-foreground'}`}>
                <span className={item.tone === 'zero' ? '' : 'font-semibold'}>{item.text}</span> {item.label}
              </span>
            </Fragment>)}
          </span>)}
      </dd>
    </div>
  );
}

function EmployeeSummary({ person, view, expanded, onToggle, details }: {
  person: ReportEmployee;
  view: ReportPersonPresentation;
  expanded: boolean;
  onToggle: () => void;
  details: () => ReactNode;
}) {
  const detailsId = `employee-details-${person.userId}`;
  return (
    <article id={`employee-${person.userId}`} className="scroll-mt-6 overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/40 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-100 text-xs font-semibold text-teal-800 dark:bg-teal-900/60 dark:text-teal-200">{view.initials}</span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">
              <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={detailsId} className="rounded-sm text-left hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-teal-300">{person.name}</button>
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{view.roleLabel} · {person.agencyName}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:items-end sm:flex-col sm:gap-1">
          {view.status && <Badge className={`px-2 py-0.5 text-[11px] ${STATUS_TONES[view.status.tone]}`}>{view.status.label}</Badge>}
          {view.trackedLabel && <span className="text-xs text-muted-foreground">{view.trackedLabel}</span>}
        </div>
      </div>
      {view.empty
        ? <p className="px-4 py-2.5 text-xs text-muted-foreground">No activity recorded.</p>
        : <dl className="border-t px-4 py-1">{view.lines.map((line) => <MetricLine key={line.name} line={line} />)}</dl>}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-11 w-full justify-between rounded-none border-t border-teal-200 bg-teal-50 px-4 text-sm font-semibold text-teal-800 hover:bg-teal-100 hover:text-teal-900 focus-visible:ring-inset focus-visible:ring-teal-600 focus-visible:ring-offset-0 active:scale-100 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200 dark:hover:bg-teal-900/60 dark:hover:text-teal-100 dark:focus-visible:ring-teal-400"
        onClick={onToggle}
        aria-label={`${expanded ? 'Hide' : 'View'} details for ${person.name}`}
        aria-expanded={expanded}
        aria-controls={detailsId}
      >
        <span className="flex items-center gap-2">
          <Eye aria-hidden="true" className="h-4 w-4" />
          {expanded ? 'Hide details' : 'View details'}
        </span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </Button>
      {expanded && <div id={detailsId} className="border-t">{details()}</div>}
    </article>
  );
}

export function DailyReportOverview({ report, presentation, selectedEmployeeId, renderDetails }: {
  report: DailyReportPayload;
  presentation: DailyReportPresentation;
  selectedEmployeeId: string | null;
  renderDetails: (person: ReportEmployee) => ReactNode;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(selectedEmployeeId ? [selectedEmployeeId] : []));
  useEffect(() => {
    if (selectedEmployeeId) setExpandedIds((previous) => new Set([...previous, selectedEmployeeId]));
  }, [selectedEmployeeId]);
  const peopleById = new Map(report.people.map((person) => [person.userId, person]));
  const toggle = (userId: string) => setExpandedIds((previous) => {
    const next = new Set(previous);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    return next;
  });

  return (
    <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border bg-card shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 bg-teal-700 px-5 py-4 text-white md:px-6">
        <p className="flex items-center gap-3 font-semibold">Wudox <span className="text-[11px] font-normal uppercase tracking-[0.2em] text-teal-100">Daily Report</span></p>
        <div className="text-sm sm:text-right"><p>{presentation.longDate}</p><p className="mt-0.5 text-xs text-teal-100">{presentation.window}</p></div>
      </header>
      <div className="space-y-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{report.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{presentation.headline}</p>
          {presentation.notice && <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{presentation.notice}</p>}
        </div>

        {presentation.tiles.length > 0 && <dl aria-label="Report summary" className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {presentation.tiles.map((tile) => <div key={tile.label} className="rounded-xl border border-teal-100 bg-teal-50/80 p-4 dark:border-teal-900 dark:bg-teal-950/40">
            <dt className="text-xs font-medium text-teal-900 dark:text-teal-200">{tile.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-teal-800 dark:text-teal-100">{tile.value}</dd>
            {tile.notes.length > 0 && <p className="mt-1 flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">{tile.notes.map((note, index) => <Fragment key={`${note.text}:${index}`}>
              {index > 0 && <span aria-hidden="true">·</span>}
              <span className={note.bad ? 'font-medium text-red-600 dark:text-red-400' : undefined}>{note.text}</span>
            </Fragment>)}</p>}
          </div>)}
        </dl>}

        {presentation.attention.length > 0 && <section aria-labelledby="report-attention" className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-4 py-3 dark:bg-amber-950/40">
          <h2 id="report-attention" className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200"><AlertTriangle className="h-4 w-4" />Needs attention</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-4 text-sm">
            {presentation.attention.map((item, index) => <li key={`${item.title}:${index}`}>
              <span className="font-medium">{item.title}</span>{' — '}
              {item.people ? <>{item.people.slice(0, 5).map(([name, value], personIndex) => <Fragment key={`${name}:${personIndex}`}>
                {personIndex > 0 && ' · '}<span className="font-medium">{name}</span>{value && ` ${value}`}
              </Fragment>)}{item.people.length > 5 && ` · and ${item.people.length - 5} more`}</> : item.detail}
            </li>)}
          </ul>
        </section>}

        {presentation.groups.map((group) => <section key={group.key} aria-labelledby={`department-${group.key}`} className="space-y-3">
          <h2 id={`department-${group.key}`} className="flex items-center gap-2 pt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}<span className="font-normal">· {group.people.length}</span></h2>
          {group.people.map((view) => {
            const person = peopleById.get(view.userId);
            return person ? <EmployeeSummary key={view.userId} person={person} view={view} expanded={expandedIds.has(view.userId)} onToggle={() => toggle(view.userId)} details={() => renderDetails(person)} /> : null;
          })}
        </section>)}
        {report.people.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No users are available in this report’s saved scope.</p>}

        <details className="rounded-xl border px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">Data coverage and report notes</summary>
          <div className="mt-3 space-y-4 text-sm">
            <p className="text-muted-foreground">Missing or incomplete tracking is shown explicitly. Input activity is context for keyboard and mouse usage; it is not a productivity score.</p>
            <div className="flex flex-wrap gap-3">{report.sources.map((source, index) => <div key={`${source.label}:${index}`} className="rounded-lg bg-muted/40 p-3">
              <p className="flex flex-wrap items-center gap-2 font-medium">{source.label}<Badge variant="outline">{source.status.replace(/_/g, ' ')}</Badge></p>
              <p className="mt-1 text-xs text-muted-foreground">Last synchronized: {timestamp(source.lastSyncedAt, report.timezone)}</p>
            </div>)}</div>
            {report.warnings.length > 0 && <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{report.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
          </div>
        </details>
        <footer className="space-y-2 border-t pt-4 text-xs leading-relaxed text-muted-foreground">
          <p>{presentation.footnote}</p>
          <p>Reporting window: {timestamp(report.periodStart, report.timezone)} – {timestamp(report.periodEnd, report.timezone)} · {report.timezone}</p>
          <p className="flex items-start gap-1.5"><Clock className="mt-0.5 h-3 w-3 shrink-0" />Saved {timestamp(report.generatedAt, report.timezone)}. This snapshot preserves the figures used for this report.</p>
          <p className="break-words">Recipient: {report.recipient.email}</p>
        </footer>
      </div>
    </div>
  );
}
