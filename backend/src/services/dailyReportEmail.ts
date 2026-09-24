import sgMail from '@sendgrid/mail';
import { env } from '../config/env';
import type { DailyReportPayload, ReportPerson } from './dailyReportTypes';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const metric = (person: ReportPerson, key: string) => person.metrics.find(item => item.key === key)?.value ?? null;
const count = (value: number | null) => value === null ? '—' : String(value);
function duration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds > 0 && seconds < 60) return '<1m';
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

interface CompactSection { label: string; value: string; detail: string }
function personSections(person: ReportPerson): CompactSection[] {
  const n = (key: string) => count(metric(person, key));
  if (person.profile === 'software') return [
    { label: 'Hubstaff tasks', value: `${n('hubstaffTasksCompleted')} done · ${n('hubstaffTasksOpen')} open`, detail: `${n('hubstaffTasksWorked')} worked on · ${n('hubstaffTasksOverdue')} overdue` },
    { label: 'Tracked time', value: duration(person.time.trackedSeconds), detail: person.time.status === 'complete' ? 'Synced' : person.time.status === 'unavailable' ? 'Awaiting Hubstaff data' : `${person.time.status} data` },
  ];
  const callOutcomes = [
    ['callsNoAnswer', 'no answer'], ['callsBusy', 'busy'], ['callsVoicemail', 'voicemail'], ['callsPending', 'pending'],
  ].flatMap(([key, label]) => { const value = metric(person, key); return value !== null && value > 0 ? [`${value} ${label}`] : []; });
  return [
    { label: 'Tasks', value: `${n('crmTasksCompleted')} done · ${n('crmTasksOpen')} open`, detail: `${n('crmTasksOverdue')} overdue` },
    { label: 'Follow-ups', value: `${n('followUpsCompleted')} done · ${n('followUpsDue')} due`, detail: `${n('followUpsOverdue')} overdue` },
    { label: 'Emails', value: `${n('personalEmails')} sent · ${n('emailsReceived')} received`, detail: `${n('replies')} replies · ${n('emailsUnread')} unread` },
    { label: 'Calls', value: `${n('calls')} made · ${n('callsAnswered')} answered`, detail: [`${n('inboundCallsAnswered')} inbound attended`, ...callOutcomes].join(' · ') },
  ];
}

// Keep genuinely empty CRM rows short, while retaining open/overdue work,
// other recorded outcomes and missing-metric cases as full summary cards.
function isEmptyCrmPerson(person: ReportPerson): boolean {
  const keys = ['crmTasksCompleted', 'crmTasksOpen', 'followUpsCompleted', 'followUpsDue', 'personalEmails', 'emailsReceived', 'emailsUnread', 'replies', 'calls', 'inboundCallsAnswered'];
  return person.profile !== 'software' && keys.every(key => metric(person, key) === 0)
    && !person.time.trackedSeconds && !person.crmUsage?.recordedEvents && !person.tasks.length
    && person.metrics.every(item => item.key === 'referenceShift' || item.key.startsWith('target') || item.value === null || item.value === 0);
}

function coverageNotice(report: DailyReportPayload): string {
  const crm = report.people.some(person => person.profile !== 'software');
  if (report.sources.length && report.sources.every(source => source.status === 'not_connected')) {
    return `Hubstaff not connected. ${crm ? 'CRM results are included.' : 'Task and time data are unavailable.'}`;
  }
  if (report.sources.some(source => source.status !== 'synced') || report.people.some(person => person.time.status !== 'complete')) {
    return `Hubstaff data is incomplete for some users.${crm ? ' Available CRM results are included.' : ''}`;
  }
  return report.sources.length ? 'Hubstaff connected and synchronized.' : '';
}

export function renderDailyReport(report: DailyReportPayload, url: string) {
  const crmPeople = report.people.filter(person => person.profile !== 'software');
  const crmTotal = (key: string): number | null => crmPeople.length && crmPeople.every(person => metric(person, key) !== null)
    ? crmPeople.reduce((sum, person) => sum + (metric(person, key) ?? 0), 0) : null;
  const notice = coverageNotice(report);
  const labels: Record<string, string> = { software: 'Software / IT', marketing_sales: 'Marketing / Sales', recruitment: 'Recruitment', general: 'Other teams' };
  const personUrl = (person: ReportPerson) => `${url.split('#')[0]}#employee-${encodeURIComponent(person.userId)}`;
  const emptySummary = 'Tasks 0 · Follow-ups 0 · Emails 0 sent / 0 received · Calls 0 made / 0 attended';
  const groups = [...new Set([...report.profiles, ...report.people.map(person => person.profile)])].map(profile => {
    const people = report.people.filter(person => person.profile === profile);
    if (!people.length) return '';
    const cards = people.map(person => {
      const sections = personSections(person);
      const time = person.time.trackedSeconds === null ? '' : ` · ${duration(person.time.trackedSeconds)} tracked${person.time.status === 'complete' ? '' : ` (${person.time.status})`}`;
      const header = `<tr><td style="padding:10px 12px 6px"><a href="${escape(personUrl(person))}" style="color:#172b4d;font-size:14px;font-weight:bold;text-decoration:none">${escape(person.name)} ↗</a><span style="font-size:11px;color:#64748b"> · ${escape(person.agencyName)}${escape(time)}</span></td></tr>`;
      const cells = sections.map(section => `<td width="50%" valign="top" style="padding:5px 12px;font-size:12px;line-height:1.5"><small style="color:#64748b">${escape(section.label)}</small><br><b>${escape(section.value)}</b><br><small>${escape(section.detail)}</small></td>`);
      const rows = cells.reduce<string[]>((result, cell, index) => { if (index % 2 === 0) result.push(`<tr>${cell}${cells[index + 1] ?? ''}</tr>`); return result; }, []).join('');
      const body = isEmptyCrmPerson(person)
        ? `<tr><td style="padding:0 12px 10px;font-size:11px;color:#64748b">${emptySummary}</td></tr>`
        : `<tr><td style="padding-bottom:8px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed">${rows}</table></td></tr>`;
      return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;background:#fff">${header}${body}</table>`;
    }).join('');
    return `<h2 style="font-size:14px;color:#334155;margin:20px 0 8px">${escape(labels[profile] ?? profile)} <span style="font-weight:normal;color:#94a3b8">${people.length}</span></h2>${cards}`;
  }).join('');
  const summary: Array<[string, string]> = [
    ['People', String(report.summary.people)],
    ...(crmPeople.length ? [['Emails sent', count(crmTotal('personalEmails'))], ['Emails received', count(crmTotal('emailsReceived'))], ['Calls made', count(crmTotal('calls'))]] as Array<[string, string]>
      : [['Tasks done', count(report.summary.completedTasks)], ['Tracked time', duration(report.summary.trackedSeconds)]] as Array<[string, string]>),
  ];
  const summaryHtml = summary.map(([label, value]) => `<td valign="top" style="padding:12px 4px;text-align:center;background:#f0fdfa"><div style="font-size:21px;font-weight:bold;color:#115e59">${escape(value)}</div><div style="font-size:10px;color:#52616f">${escape(label)}</div></td>`).join('');
  const footnote = '— = unavailable. Sent = accepted for sending. Received = CRM inbox arrivals; replies are included in received. Open, overdue and unread show current status.';
  const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#172b4d"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:16px 8px"><table role="presentation" width="680" cellspacing="0" cellpadding="0" style="width:100%;max-width:680px;background:white;border-radius:12px"><tr><td style="padding:24px 18px 16px;border-top:4px solid #0f766e">
    <div style="font-size:10px;letter-spacing:2px;color:#0f766e;font-weight:bold">DAILY WORK SNAPSHOT</div>
    <h1 style="font-size:23px;margin:8px 0">${escape(report.title)}</h1><div style="font-size:12px;color:#64748b">${escape(report.reportDate)} · ${escape(report.timezone)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0 12px;table-layout:fixed"><tr>${summaryHtml}</tr></table>
    ${notice ? `<div style="font-size:12px;color:#92400e;background:#fffbeb;padding:10px;border-radius:6px">${escape(notice)}</div>` : ''}
    ${groups || '<p>No matching employees in this report.</p>'}
    <p style="margin:20px 0 12px"><a href="${escape(url)}" style="display:inline-block;background:#0f766e;color:white;padding:12px 20px;text-decoration:none;border-radius:6px;font-size:13px;font-weight:bold">View full report →</a></p>
    <p style="font-size:10px;line-height:1.6;color:#64748b;margin:0">${crmPeople.length ? escape(footnote) : '— = unavailable.'}<br>Names open each user’s details. CRM access required. Full records and data notes are in the detailed report.</p>
    </td></tr></table></td></tr></table></body></html>`;
  const text = [
    `${report.title} — ${report.reportDate} (${report.timezone})`,
    summary.map(([label, value]) => `${label}: ${value}`).join(' · '), notice,
    ...report.people.map(person => [
      `${person.name} — ${person.agencyName}`,
      isEmptyCrmPerson(person) ? emptySummary : personSections(person).map(section => `${section.label}: ${section.value}; ${section.detail}`).join('\n'),
      ...(person.profile !== 'software' && person.time.trackedSeconds !== null ? [`Tracked: ${duration(person.time.trackedSeconds)} (${person.time.status})`] : []),
      `Details: ${personUrl(person)}`,
    ].join('\n')),
    `View full report (CRM access required): ${url}`, crmPeople.length ? footnote : '— = unavailable.',
  ].filter(Boolean).join('\n\n');
  return { html, text };
}

export async function sendReportSnapshot(report: DailyReportPayload, snapshotId: string): Promise<string | null> {
  if (!env.SENDGRID_API_KEY) throw Object.assign(new Error('SendGrid is not configured'), { definiteFailure: true });
  const url = `${(env.FRONTEND_URL || env.APP_URL || 'https://staffing.wudox.ca').replace(/\/$/, '')}/daily-reports/${encodeURIComponent(snapshotId)}`;
  const content = renderDailyReport(report, url);
  sgMail.setApiKey(env.SENDGRID_API_KEY);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      sgMail.send({ to: report.recipient.email, from: { email: 'reports@wudox.ca', name: 'Wudox Daily Reports' },
        subject: `${report.title} — ${report.reportDate}`, ...content, customArgs: { daily_report_snapshot_id: snapshotId } }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Provider response timed out; delivery outcome is unknown')), 25000); }),
    ]);
    return typeof response[0].headers['x-message-id'] === 'string' ? response[0].headers['x-message-id'] : null;
  } finally { if (timer) clearTimeout(timer); }
}
