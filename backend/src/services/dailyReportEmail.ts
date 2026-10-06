import sgMail from '@sendgrid/mail';
import { env } from '../config/env';
import { formatRoleLabel } from '../config/permissions';
import type { DailyReportPayload, ReportPerson } from './dailyReportTypes';
import { normalizeReportCcEmails } from './dailyReportAddresses';
import { reportDayBounds } from './reportMetrics';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
/** undefined = not part of this report (no permission, or an older snapshot); null = unavailable. */
const metric = (person: ReportPerson, key: string): number | null | undefined => person.metrics.find(item => item.key === key)?.value;
/** Missing and unavailable values count as zero. */
const total = (person: ReportPerson, keys: readonly string[]) => keys.reduce((n, key) => n + (metric(person, key) ?? 0), 0);
const num = (value: number | null | undefined) => typeof value === 'number' ? value.toLocaleString('en-US') : '—';
const plural = (count: number, word: string, many = `${word}s`) => `${num(count)} ${count === 1 ? word : many}`;
const pct = (part: number | null | undefined, whole: number | null | undefined) => typeof part === 'number' && whole ? `${Math.round((part / whole) * 100)}%` : null;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(word => word[0]).slice(0, 2).join('').toUpperCase() || '?';
function duration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds > 0 && seconds < 60) return '<1m';
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`;
}
/** Sum across people; undefined when nobody has the metric, null when any value is unavailable. */
function sum(people: ReportPerson[], ...keys: string[]): number | null | undefined {
  const values = people.flatMap(person => keys.map(key => metric(person, key))).filter(value => value !== undefined);
  if (!values.length) return undefined;
  return values.some(value => value === null) ? null : values.reduce<number>((n, value) => n + value!, 0);
}
/**
 * Each person's tasks come from the source their card shows: Hubstaff for software
 * staff, CRM for everyone else. (Every person carries a Hubstaff placeholder metric.)
 */
const taskKey = (person: ReportPerson, kind: 'Completed' | 'Open' | 'Overdue') => `${person.profile === 'software' ? 'hubstaffTasks' : 'crmTasks'}${kind}`;
const overdueKeys = (person: ReportPerson) => person.profile === 'software' ? ['hubstaffTasksOverdue'] : ['crmTasksOverdue', 'followUpsOverdue'];
type TaskKind = 'Completed' | 'Worked' | 'Open' | 'Overdue';
/**
 * Team task total: CRM tasks per person plus software staff's Hubstaff tasks, a shared
 * task counted once. Known numbers are added up; `partial` notes anyone unavailable.
 */
function teamTasks(report: DailyReportPayload, kind: TaskKind) {
  const values: (number | null | undefined)[] = report.people.filter(person => person.profile !== 'software').map(person => metric(person, `crmTasks${kind}`));
  const shared = report.summary.hubstaffTasks?.[kind.toLowerCase() as Lowercase<TaskKind>];
  // Older snapshots have no de-duplicated totals; they add people up instead.
  if (shared) values.push(shared.count, ...(shared.complete ? [] : [null]));
  else values.push(...report.people.filter(person => person.profile === 'software').map(person => metric(person, `hubstaffTasks${kind}`)));
  const known = values.filter((value): value is number => typeof value === 'number');
  return { value: known.length ? known.reduce((n, value) => n + value, 0) : values.some(value => value === null) ? null : undefined, partial: !!known.length && values.some(value => value === null) };
}

const C = { ink: '#172b4d', text: '#334155', muted: '#64748b', faint: '#a3adba', line: '#e2e8f0', row: '#f1f5f9', teal: '#0f766e', tealInk: '#115e59', tealSoft: '#f0fdfa', red: '#dc2626' };
const TAG = { bad: ['#fef2f2', C.red], warn: ['#fffbeb', '#b45309'], ok: ['#f0fdf4', '#15803d'], muted: ['#f1f5f9', C.muted] } as const;
/** Label colour, number colour and number weight for each kind of count. */
const TONE = { zero: [C.faint, C.faint, 'normal'], bad: [C.red, C.red, 'bold'], normal: [C.text, C.ink, 'bold'] } as const;

// Section order and wording. Email delivery results sit on their own line.
interface Part { key: string; label: string; bad?: boolean; hideZero?: boolean }
interface Section { name: string; stacked?: boolean; groups: { parts: Part[]; unavailable?: string }[] }
const p = (key: string, label: string, bad = false, hideZero = false): Part => ({ key, label, bad, hideZero });
const CRM_SECTIONS: Section[] = [
  { name: 'Email', stacked: true, groups: [
    { parts: [p('personalEmails', 'sent'), p('emailsReceived', 'received'), p('replies', 'replies'), p('emailsUnread', 'unread')] },
    { parts: [p('emailsDelivered', 'delivered'), p('emailsBounced', 'bounced', true), p('emailsOpened', 'opened'), p('emailsClicked', 'clicked')], unavailable: 'Delivery results not available yet' },
  ] },
  { name: 'Bulk mail', groups: [{ parts: [p('campaignSent', 'sent'), p('campaignDelivered', 'delivered'), p('campaignBounced', 'bounced', true), p('campaignOpened', 'opened'), p('campaignClicked', 'clicked')] }] },
  { name: 'Tasks', groups: [{ parts: [p('crmTasksCompleted', 'completed'), p('crmTasksOpen', 'open'), p('crmTasksOverdue', 'overdue', true), p('crmTasksReopened', 'reopened')] }] },
  { name: 'Follow-ups', groups: [{ parts: [p('followUpsCompleted', 'completed'), p('followUpsDue', 'due'), p('followUpsOnTime', 'on time'), p('followUpsOverdue', 'overdue', true)] }] },
  { name: 'Meetings', groups: [{ parts: [p('meetingsScheduled', 'booked'), p('meetingsCompleted', 'held')] }] },
  { name: 'Calls', groups: [
    { parts: [p('calls', 'made'), p('callsAnswered', 'answered'), p('callsNoAnswer', 'no answer'), p('callsBusy', 'busy'), p('callsVoicemail', 'voicemail'), p('callsPending', 'pending', false, true)] },
    { parts: [p('inboundCallsAnswered', 'incoming')] },
  ] },
];
const HUBSTAFF_TASKS: Section = { name: 'Tasks', groups: [{ parts: [p('hubstaffTasksCompleted', 'completed'), p('hubstaffTasksWorked', 'worked on'), p('hubstaffTasksOpen', 'open'), p('hubstaffTasksOverdue', 'overdue', true)], unavailable: 'Hubstaff task data not available yet' }] };

interface Item { text: string; label: string; tone: keyof typeof TONE }
interface Line { name: string; stacked?: boolean; groups: (Item[] | string)[] }

function sectionLine(person: ReportPerson, section: Section): Line | null {
  const groups = section.groups.map(group => ({ group, values: group.parts.map(part => ({ part, value: metric(person, part.key) })).filter(({ part, value }) => value !== undefined && !(part.hideZero && value === 0)) }))
    .filter(entry => entry.values.length);
  if (!groups.length) return null;
  if (groups.every(entry => entry.values.every(({ value }) => value === 0))) return { name: section.name, groups: ['Nothing recorded'] };
  return { name: section.name, stacked: section.stacked, groups: groups.map(({ group, values }) => values.every(({ value }) => value === null)
    ? group.unavailable ?? 'Not available'
    : values.map(({ part, value }) => ({ text: num(value), label: part.label, tone: !value ? 'zero' : part.bad ? 'bad' : 'normal' }))) };
}

function timeLine(person: ReportPerson): Line {
  const time = person.time;
  if (time.trackedSeconds === null) return { name: 'Time', groups: [time.status === 'restricted' ? 'Not shared with this report' : 'Hubstaff data not available yet'] };
  const activity = time.inputActivityPercent === null ? null : Math.round(time.inputActivityPercent);
  const entries: [number | null, string, (value: number) => string][] = [
    [time.trackedSeconds, 'tracked', duration], [activity, 'activity', value => `${value}%`],
    [time.idleSeconds, 'idle', duration], [time.manualSeconds, 'manual', duration], [time.unallocatedSeconds, 'no task', duration],
  ];
  const items = entries.flatMap(([value, label, format]): Item[] => value === null ? [] : [{ text: format(value), label, tone: value ? 'normal' : 'zero' }]);
  return { name: 'Time', groups: time.status === 'complete' ? [items] : [items, `${time.status} data`] };
}

function personLines(person: ReportPerson): Line[] {
  if (person.profile === 'software') return [timeLine(person), sectionLine(person, HUBSTAFF_TASKS)].filter((line): line is Line => !!line);
  const lines = CRM_SECTIONS.map(section => sectionLine(person, section)).filter((line): line is Line => !!line);
  // Missing tracking can mean legacy mail or an interrupted evidence write.
  const untracked = metric(person, 'emailsUntracked');
  const email = lines.find(line => line.name === 'Email');
  if (email && untracked) email.groups.push(`${plural(untracked, 'email')} without confirmed engagement tracking; counts include verified events only`);
  return lines;
}

// Keep genuinely empty CRM rows short, while retaining open/overdue work,
// other recorded outcomes and missing-metric cases as full summary cards.
function isEmptyCrmPerson(person: ReportPerson): boolean {
  const keys = ['crmTasksCompleted', 'crmTasksOpen', 'followUpsCompleted', 'followUpsDue', 'personalEmails', 'emailsReceived', 'emailsUnread', 'replies', 'calls', 'inboundCallsAnswered'];
  return person.profile !== 'software' && keys.every(key => metric(person, key) === 0)
    && !person.time.trackedSeconds && !person.crmUsage?.recordedEvents && !person.tasks.length
    && person.metrics.every(item => item.key === 'referenceShift' || item.key.endsWith('Target') || item.value === null || item.value === 0);
}

function belowGoals(person: ReportPerson) {
  return ([['calls', 'callsTarget', 'call'], ['personalEmails', 'emailsTarget', 'email']] as const).flatMap(([key, targetKey, kind]) => {
    const done = metric(person, key), target = metric(person, targetKey);
    return typeof done === 'number' && typeof target === 'number' && target > 0 && done < target ? [{ kind, done, target }] : [];
  });
}

/** Everything both the HTML and text versions show for one person, worked out once. */
interface PersonView { person: ReportPerson; empty: boolean; below: ReturnType<typeof belowGoals>; status: { label: string; tone: keyof typeof TAG } | null; lines: Line[] }
/** Daily goals are only compared once the report covers the whole day. */
function personView(person: ReportPerson, fullDay: boolean): PersonView {
  const empty = isEmptyCrmPerson(person);
  const overdue = total(person, overdueKeys(person));
  // Someone with no activity is listed as such, not again under each goal.
  const below = fullDay && !empty ? belowGoals(person) : [];
  const status = empty ? { label: 'No activity', tone: 'muted' as const }
    : overdue ? { label: `${num(overdue)} overdue`, tone: 'bad' as const }
      : below.length ? { label: 'Below goal', tone: 'warn' as const }
        : overdueKeys(person).some(key => typeof metric(person, key) === 'number') ? { label: 'On track', tone: 'ok' as const } : null;
  return { person, empty, below, status, lines: empty ? [] : personLines(person) };
}

/** Plain-language watch list built only from numbers already in the report. */
interface Attention { title: string; people?: [string, string][]; detail?: string }
function attentionItems(report: DailyReportPayload, views: PersonView[]): Attention[] {
  const items: Attention[] = [];
  const who = (pick: (view: PersonView) => string | null) => views.flatMap(view => { const value = pick(view); return value === null ? [] : [[view.person.name, value] as [string, string]]; });
  for (const [keyOf, word] of [[() => 'followUpsOverdue', 'follow-up'], [(person: ReportPerson) => taskKey(person, 'Overdue'), 'task']] as const) {
    const counts = views.map(({ person }) => [person.name, total(person, [keyOf(person)])] as const).filter(([, count]) => count > 0);
    // A shared Hubstaff task is overdue once for the team, though each assignee is listed.
    const teamTotal = word === 'task' ? teamTasks(report, 'Overdue').value : null;
    if (counts.length) items.push({ title: `${plural(teamTotal ?? counts.reduce((n, [, count]) => n + count, 0), word)} overdue`, people: counts.map(([name, count]) => [name, num(count)]) });
  }
  const bounced = (key: string) => views.reduce((n, { person }) => n + total(person, [key]), 0);
  const personal = bounced('emailsBounced'), bulk = bounced('campaignBounced');
  if (personal + bulk) items.push({ title: `${plural(personal + bulk, 'email')} bounced`, detail: `Bulk mail ${num(bulk)} · Personal ${num(personal)}. Check contact lists for bad addresses.` });
  for (const kind of ['call', 'email'] as const) {
    const below = who(view => { const goal = view.below.find(item => item.kind === kind); return goal ? `${goal.done} of ${goal.target}` : null; });
    if (below.length) items.push({ title: `Below daily ${kind} goal`, people: below });
  }
  const idle = who(view => view.empty ? '' : null);
  if (idle.length) items.push({ title: 'No activity recorded', people: idle });
  return items;
}
const MAX_NAMES = 5;
/** Up to MAX_NAMES "name value" entries, then "and N more". */
function names(people: [string, string][], format: (name: string, value: string) => string, separator: string) {
  const more = people.length - MAX_NAMES;
  return [...people.slice(0, MAX_NAMES).map(([name, value]) => format(name, value)), ...(more > 0 ? [`and ${more} more`] : [])].join(separator);
}

interface Note { text: string; bad?: boolean }
interface Tile { label: string; value: string; notes: Note[] }
function summaryTiles(report: DailyReportPayload): Tile[] {
  const people = report.people, crm = people.filter(person => person.profile !== 'software');
  const tile = (label: string, value: number | null | undefined, ...notes: (Note | null)[]): Tile[] =>
    value === undefined ? [] : [{ label, value: num(value), notes: notes.filter((note): note is Note => !!note) }];
  // Notes are left out when their number is missing or unavailable; alerts also when zero.
  const count = (value: number | null | undefined, word: string): Note | null => typeof value === 'number' ? { text: `${num(value)} ${word}` } : null;
  const alert = (value: number | null | undefined, word: string): Note | null => value ? { text: `${num(value)} ${word}`, bad: true } : null;
  const rate = (part: number | null | undefined, whole: number | null | undefined, word: string): Note | null => { const value = pct(part, whole); return value ? { text: `${value} ${word}` } : null; };
  const tasks = (kind: TaskKind) => teamTasks(report, kind).value;
  const tasksMissing = teamTasks(report, 'Completed').partial ? { text: 'some data not available' } : null;
  if (!crm.length) return [
    ...(report.summary.trackedSeconds === null ? [] : [{ label: 'Time tracked', value: duration(report.summary.trackedSeconds), notes: [{ text: plural(report.summary.people, 'person', 'people') }] }]),
    ...tile('Tasks done', tasks('Completed'), count(tasks('Worked'), 'worked on'), tasksMissing),
    ...tile('Tasks open', tasks('Open'), alert(tasks('Overdue'), 'overdue')),
  ];
  // Partial positive results can coexist with unknown outcomes. Keep these counts
  // in employee rows, but only compute rates when every tracked recipient settled.
  const measured = crm.filter(person => {
    if (metric(person, 'emailsUntracked')) return false;
    const values = ['emailsDelivered', 'emailsBounced', 'emailsOpened', 'emailsClicked'].map(key => metric(person, key));
    const tracked = metric(person, 'emailsTracked') ?? metric(person, 'personalEmails');
    return values.every(value => typeof value === 'number') && typeof tracked === 'number'
      && values[0]! + values[1]! === tracked;
  });
  const tracked = measured.reduce((n, person) => n + (metric(person, 'emailsTracked') ?? metric(person, 'personalEmails') ?? 0), 0);
  const ofTracked = (key: string, word: string) => rate(measured.reduce((n, person) => n + total(person, [key]), 0), tracked, word);
  const bulkSent = sum(crm, 'campaignSent'), calls = sum(crm, 'calls'), talk = sum(crm, 'callTalkSeconds');
  return [
    ...tile('Emails sent', sum(crm, 'personalEmails'), ...(measured.length
      ? [ofTracked('emailsDelivered', 'delivered'), ofTracked('emailsOpened', 'opened')]
      : [count(sum(crm, 'emailsReceived'), 'received')])),
    ...tile('Bulk mail sent', bulkSent, rate(sum(crm, 'campaignDelivered'), bulkSent, 'delivered'), alert(sum(crm, 'campaignBounced'), 'bounced')),
    ...tile('Tasks done', tasks('Completed'), count(tasks('Open'), 'open'), alert(tasks('Overdue'), 'overdue'), tasksMissing),
    ...tile('Follow-ups done', sum(crm, 'followUpsCompleted'), count(sum(crm, 'followUpsDue'), 'due'), alert(sum(crm, 'followUpsOverdue'), 'overdue')),
    ...tile('Meetings held', sum(crm, 'meetingsCompleted'), count(sum(crm, 'meetingsScheduled'), 'newly booked')),
    ...tile('Calls made', calls, rate(sum(crm, 'callsAnswered'), calls, 'answered'), talk ? { text: `${duration(talk)} talk time` } : null),
  ];
}

function coverageNotice(report: DailyReportPayload): string {
  const crm = report.people.some(person => person.profile !== 'software');
  if (report.sources.length && report.sources.every(source => source.status === 'not_connected')) {
    return `Hubstaff not connected. ${crm ? 'CRM results are included.' : 'Task and time data are unavailable.'}`;
  }
  if (report.sources.some(source => source.status !== 'synced') || report.people.some(person => person.time.status !== 'complete')) {
    return `Hubstaff data is incomplete for some users.${crm ? ' Available CRM results are included.' : ''}`;
  }
  return '';
}

function reportWindow(report: DailyReportPayload) {
  const date = report.reportDate.slice(0, 10);
  const longDate = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const end = new Date(report.periodEnd);
  const fullDay = !Number.isFinite(end.getTime()) || end >= reportDayBounds(date, report.timezone).end;
  return { longDate, fullDay, window: fullDay ? 'Full day' : `Up to ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: report.timezone })}` };
}

const TEXT_LABEL_WIDTH = 12;
const lineText = (line: Line) => line.groups.map(group => typeof group === 'string' ? group : group.map(item => `${item.text} ${item.label}`).join(' · ')).join(line.stacked ? `\n${' '.repeat(2 + TEXT_LABEL_WIDTH)}` : ' · ');
function lineHtml(line: Line) {
  // Items never split; lines wrap only after a separator.
  const sep = '<span style="color:#cbd5e1">&nbsp;· </span>';
  const item = ({ text, label, tone }: Item) => { const [labelColor, valueColor, weight] = TONE[tone]; return `<span style="white-space:nowrap;color:${labelColor}"><b style="color:${valueColor};font-weight:${weight}">${escape(text)}</b> ${escape(label)}</span>`; };
  return line.groups.map(group => typeof group === 'string' ? `<span style="color:${C.faint};font-size:12px">${escape(group)}</span>` : group.map(item).join(sep)).join(line.stacked ? '<br>' : sep);
}

const DEPARTMENTS: Record<string, string> = { software: 'Software / IT', marketing_sales: 'Marketing / Sales', recruitment: 'Recruitment', general: 'Other teams' };
const FOOTNOTE = 'Gray = nothing recorded. Red = needs attention (bounced or overdue). — = not available. Sent counts emails accepted for sending; replies are also counted in received. Delivered, bounced, opened and clicked count each person an email was sent to, as reported by SendGrid when this report was saved. Opens are estimates: some mail apps load or block images automatically. Open and overdue show the status when this report was saved.';

/** Shared calculations keep the saved report screen and delivered email consistent. */
function prepareDailyReport(report: DailyReportPayload) {
  const { longDate, window, fullDay } = reportWindow(report);
  const notice = coverageNotice(report);
  const tiles = summaryTiles(report);
  const views = report.people.map(person => personView(person, fullDay));
  const attention = attentionItems(report, views);
  const tracked = report.summary.trackedSeconds === null ? '' : ` · ${duration(report.summary.trackedSeconds)} tracked`;
  const headline = `${plural(report.summary.people, 'person', 'people')}${tracked} · ${report.timezone}`;
  const groups = [...new Set([...report.profiles, ...report.people.map(person => person.profile)])]
    .map(profile => ({ key: profile, label: DEPARTMENTS[profile] ?? profile, views: views.filter(view => view.person.profile === profile) }))
    .filter(group => group.views.length);
  return { longDate, window, fullDay, notice, tiles, attention, headline, groups };
}

export interface DailyReportPresentation {
  longDate: string;
  fullDay: boolean;
  window: string;
  headline: string;
  notice: string;
  tiles: Tile[];
  attention: Attention[];
  groups: {
    key: string;
    label: string;
    people: {
      userId: string;
      initials: string;
      roleLabel: string;
      empty: boolean;
      status: PersonView['status'];
      trackedLabel: string | null;
      lines: Line[];
    }[];
  }[];
  footnote: string;
}

/** Derive display-only values from a saved payload; never change the snapshot. */
export function buildDailyReportPresentation(report: DailyReportPayload): DailyReportPresentation {
  const { groups, ...presentation } = prepareDailyReport(report);
  return {
    ...presentation,
    groups: groups.map(({ key, label, views }) => ({
      key,
      label,
      people: views.map(({ person, empty, status, lines }) => ({
        userId: person.userId,
        initials: initials(person.name),
        roleLabel: formatRoleLabel(person.role),
        empty,
        status,
        trackedLabel: person.time.trackedSeconds === null ? null
          : `${duration(person.time.trackedSeconds)} tracked${person.time.status === 'complete' ? '' : ` (${person.time.status})`}`,
        lines,
      })),
    })),
    footnote: FOOTNOTE,
  };
}

export function renderDailyReport(report: DailyReportPayload, url: string) {
  const personUrl = (person: ReportPerson) => `${url.split('#')[0]}#employee-${encodeURIComponent(person.userId)}`;
  const { longDate, window, notice, tiles, attention, headline, groups } = prepareDailyReport(report);

  const personCard = ({ person, empty, status, lines }: PersonView) => {
    const tag = status ? `<span style="display:inline-block;font-size:10.5px;font-weight:bold;border-radius:99px;padding:2px 8px;background:${TAG[status.tone][0]};color:${TAG[status.tone][1]}">${escape(status.label)}</span>` : '';
    const trackedLine = person.time.trackedSeconds === null ? '' : `<div style="font-size:11px;color:${C.muted};margin-top:3px">${escape(duration(person.time.trackedSeconds))} tracked${person.time.status === 'complete' ? '' : ` (${escape(person.time.status)})`}</div>`;
    const header = `<tr><td colspan="2" style="background:#f8fafc;border-bottom:1px solid ${C.line};padding:9px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
      <td width="38" valign="middle"><div style="width:28px;height:28px;border-radius:14px;background:#e0f2f1;color:${C.teal};font-size:11px;font-weight:bold;text-align:center;line-height:28px">${escape(initials(person.name))}</div></td>
      <td valign="middle"><a href="${escape(personUrl(person))}" style="color:${C.ink};font-size:14px;font-weight:bold;text-decoration:none">${escape(person.name)} ↗</a><div style="font-size:11px;color:${C.muted}">${escape(formatRoleLabel(person.role))} · ${escape(person.agencyName)}</div></td>
      <td align="right" valign="middle" style="white-space:nowrap">${tag}${trackedLine}</td></tr></table></td></tr>`;
    const rows = empty
      ? `<tr><td colspan="2" style="padding:8px 12px 10px;font-size:11.5px;color:${C.muted}">No activity recorded.</td></tr>`
      : lines.map((line, index) => {
        const border = index ? `border-top:1px solid ${C.row};` : '';
        return `<tr><td width="92" valign="top" style="${border}padding:6px 8px 6px 12px;font-size:11.5px;color:${C.muted};font-weight:bold;white-space:nowrap">${escape(line.name)}</td><td valign="top" style="${border}padding:6px 12px 6px 0;font-size:12.5px;line-height:1.55;color:${C.text}">${lineHtml(line)}</td></tr>`;
      }).join('');
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid ${C.line};border-radius:8px;border-collapse:separate;margin-bottom:10px;background:#fff">${header}${rows}</table>`;
  };

  const tileCells = tiles.map(item => `<td width="33%" valign="top" style="background:${C.tealSoft};border-radius:8px;padding:10px 12px">
    <div style="font-size:20px;font-weight:bold;color:${C.tealInk}">${escape(item.value)}</div><div style="font-size:11px;font-weight:bold;color:${C.text}">${escape(item.label)}</div>
    ${item.notes.length ? `<div style="font-size:10.5px;color:${C.muted};margin-top:2px">${item.notes.map(entry => `<span style="white-space:nowrap${entry.bad ? `;color:${C.red};font-weight:bold` : ''}">${escape(entry.text)}</span>`).join(' · ')}</div>` : ''}</td>`);
  const tileRows = tileCells.reduce<string[]>((rows, cell, index) => { if (index % 3 === 0) rows.push(''); rows[rows.length - 1] += cell; return rows; }, [])
    .map(row => `<tr>${row}</tr>`).join('');
  const attentionHtml = attention.map(item => {
    const detail = item.people ? names(item.people, (name, value) => `<span style="white-space:nowrap"><b style="color:${C.ink}">${escape(name)}</b>${value ? ` ${escape(value)}` : ''}</span>`, ' · ') : escape(item.detail);
    return `<div style="font-size:12px;color:${C.text};line-height:1.6">• <b style="color:${C.ink}">${escape(item.title)}</b> — ${detail}</div>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:${C.ink}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:16px 8px">
  <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="width:100%;max-width:680px;background:#fff;border-radius:12px;border-collapse:separate;overflow:hidden">
    <tr><td style="background:${C.teal};padding:16px 20px;color:#fff"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
      <td valign="middle" style="font-size:16px;font-weight:bold;color:#fff">Wudox <span style="font-size:11px;font-weight:normal;letter-spacing:1.5px;color:#ccfbf1">DAILY REPORT</span></td>
      <td align="right" valign="middle" style="font-size:12px;color:#e6fffa;line-height:1.5">${escape(longDate)}<br>${escape(window)}</td></tr></table></td></tr>
    <tr><td style="padding:20px 20px 16px">
      <h1 style="font-size:20px;margin:0 0 2px;color:${C.ink}">${escape(report.title)}</h1>
      <div style="font-size:12px;color:${C.muted}">${escape(headline)}</div>
      ${notice ? `<div style="font-size:12px;color:#92400e;background:#fffbeb;padding:8px 10px;border-radius:6px;margin-top:12px">${escape(notice)}</div>` : ''}
      ${tileRows ? `<table role="presentation" width="100%" cellspacing="6" cellpadding="0" style="margin:10px -6px 4px;table-layout:fixed">${tileRows}</table>` : ''}
      ${attention.length ? `<div style="background:#fffbeb;border-left:3px solid #f59e0b;border-radius:6px;padding:10px 14px;margin:6px 0 4px"><div style="font-size:12px;font-weight:bold;color:#92400e;margin-bottom:4px">Needs attention</div>${attentionHtml}</div>` : ''}
      ${groups.map(group => `<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#475569;font-weight:bold;margin:22px 0 8px">${escape(group.label)} <span style="font-weight:normal;color:#94a3b8">· ${group.views.length}</span></div>${group.views.map(personCard).join('')}`).join('') || '<p>No matching employees in this report.</p>'}
      <p style="margin:18px 0 14px"><a href="${escape(url)}" style="display:inline-block;background:${C.teal};color:#fff;padding:11px 20px;text-decoration:none;border-radius:6px;font-size:13px;font-weight:bold">Open full report →</a></p>
      <p style="font-size:10px;line-height:1.6;color:${C.muted};margin:0;border-top:1px solid ${C.row};padding-top:10px">${escape(FOOTNOTE)}<br>Names open each person’s details. CRM access required. Full records and data notes are in the detailed report.</p>
    </td></tr></table></td></tr></table></body></html>`;

  const text = [
    `${report.title} — ${longDate} (${window})`, headline, notice,
    tiles.map(item => `${item.label}: ${item.value}${item.notes.length ? ` (${item.notes.map(entry => entry.text).join(' · ')})` : ''}`).join('\n'),
    attention.length ? ['Needs attention:', ...attention.map(item => `- ${item.title}: ${item.people ? names(item.people, (name, value) => `${name}${value ? ` ${value}` : ''}`, ', ') : item.detail}`)].join('\n') : '',
    ...groups.map(group => [`${group.label.toUpperCase()} (${group.views.length})`, ...group.views.map(({ person, empty, status, lines }) => {
      const head = [person.name, `${formatRoleLabel(person.role)} · ${person.agencyName}`, status?.label, person.time.trackedSeconds === null ? '' : `${duration(person.time.trackedSeconds)} tracked`].filter(Boolean).join(' — ');
      const body = empty ? ['  No activity recorded.'] : lines.map(line => `  ${`${line.name}:`.padEnd(TEXT_LABEL_WIDTH)}${lineText(line)}`);
      return [head, ...body, `  Details: ${personUrl(person)}`].join('\n');
    })].join('\n\n')),
    `Open full report (CRM access required): ${url}`, FOOTNOTE,
  ].filter(Boolean).join('\n\n');
  return { html, text };
}

export async function sendReportSnapshot(report: DailyReportPayload, snapshotId: string): Promise<string | null> {
  const ccEmails = normalizeReportCcEmails(report.ccEmails, report.recipient.email);
  if (!env.SENDGRID_API_KEY) throw Object.assign(new Error('SendGrid is not configured'), { definiteFailure: true });
  const url = `${(env.FRONTEND_URL || env.APP_URL || 'https://staffing.wudox.ca').replace(/\/$/, '')}/daily-reports/${encodeURIComponent(snapshotId)}`;
  const content = renderDailyReport(report, url);
  sgMail.setApiKey(env.SENDGRID_API_KEY);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      sgMail.send({ to: report.recipient.email, from: { email: 'reports@wudox.ca', name: 'Wudox Daily Reports' },
        ...(ccEmails.length ? { cc: ccEmails } : {}),
        subject: `${report.title} — ${report.reportDate}`, ...content, customArgs: { daily_report_snapshot_id: snapshotId } }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Provider response timed out; delivery outcome is unknown')), 25000); }),
    ]);
    return typeof response[0].headers['x-message-id'] === 'string' ? response[0].headers['x-message-id'] : null;
  } finally { if (timer) clearTimeout(timer); }
}
