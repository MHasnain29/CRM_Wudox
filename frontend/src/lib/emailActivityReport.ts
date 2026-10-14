import { apiFetch } from './api';

export interface EmailActivityPerson {
  userId: string;
  name: string;
  role: string;
  agencyId: string | null;
  /** Messages the person composed and sent themselves. */
  individual: { emails: number };
  /** Campaigns the person created, counted by the emails actually sent in the period. */
  bulk: { campaigns: number; emails: number };
}

export interface EmailActivityReport {
  from: string;
  to: string;
  people: EmailActivityPerson[];
}

export interface EmailActivityQuery {
  from: string;
  to: string;
  scope?: 'mine' | 'team' | 'all';
  agencyIds?: string[];
  userIds?: string[];
}

export async function fetchEmailActivityReport(params: EmailActivityQuery, signal?: AbortSignal): Promise<EmailActivityReport> {
  // Explicit scope filters, independent of the global viewed-agency header (same as the CRM time report).
  const query = new URLSearchParams({ from: params.from, to: params.to, scope: params.scope ?? 'all', allAgencies: '1' });
  if (params.agencyIds?.length) query.set('agencyIds', params.agencyIds.join(','));
  if (params.userIds?.length) query.set('userIds', params.userIds.join(','));
  const result = await apiFetch<EmailActivityReport>(`/reports/email-activity?${query}`, { signal });
  if (!result.ok || !result.data) throw new Error(('error' in result && result.error) || 'Could not load email activity');
  return result.data;
}

export function totalEmailsSent(person: Pick<EmailActivityPerson, 'individual' | 'bulk'>): number {
  return person.individual.emails + person.bulk.emails;
}

export function summarizeEmailActivity(people: EmailActivityPerson[]) {
  return people.reduce((totals, person) => ({
    individualEmails: totals.individualEmails + person.individual.emails,
    bulkCampaigns: totals.bulkCampaigns + person.bulk.campaigns,
    bulkEmails: totals.bulkEmails + person.bulk.emails,
    totalEmails: totals.totalEmails + totalEmailsSent(person),
  }), { individualEmails: 0, bulkCampaigns: 0, bulkEmails: 0, totalEmails: 0 });
}
