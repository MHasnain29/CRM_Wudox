import { apiFetch } from './api';
import type { CrmTimeReport } from './crmTimeReport';

export interface CrmTimeQuery {
  from: string;
  to: string;
  scope?: 'mine' | 'team' | 'all';
  agencyIds?: string[];
  userIds?: string[];
}

export async function fetchCrmTimeReport(params: CrmTimeQuery, signal?: AbortSignal): Promise<CrmTimeReport> {
  // This report has explicit scope filters, independent of the global viewed-agency header.
  const query = new URLSearchParams({ from: params.from, to: params.to, scope: params.scope ?? 'all', allAgencies: '1' });
  if (params.agencyIds?.length) query.set('agencyIds', params.agencyIds.join(','));
  if (params.userIds?.length) query.set('userIds', params.userIds.join(','));
  const result = await apiFetch<CrmTimeReport>(`/reports/crm-time?${query}`, { signal });
  if (!result.ok || !result.data) throw new Error(('error' in result && result.error) || 'Could not load measured CRM time');
  return result.data;
}
