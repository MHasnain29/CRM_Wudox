/**
 * Recruitment Active Clients API — /api/v1/active-clients.
 * Server returns dates as ISO strings; `agencyId` maps to subCompanyId.
 */
import { apiFetch } from '@/lib/api';
import type { ActiveClientStatus } from '@/lib/activeClientTypes';

export interface ApiActiveClient {
  id: string;
  name: string;
  industry: string;
  location: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  status: ActiveClientStatus;
  notes: string | null;
  clientTraining?: boolean;
  hasTrainingDocument?: boolean;
  trainingFileName?: string | null;
  trainingPandaDocTemplateId?: string | null;
  trainingPandaDocTemplateName?: string | null;
  agencyId: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  jobCount: number;
  placedEmployeeCount: number;
}

export interface ActiveClientJobSummary {
  id: string;
  title: string;
  status: string;
  location: string;
  openPositions: number;
  company: string;
  jobType: string;
  employmentType: string;
  filledPositions: number;
  scheduledPositions: number;
  backupPercentage: number;
  salaryMin: number | null;
  salaryMax: number | null;
  shiftSchedule: {
    startTime?: string;
    endTime?: string;
    workDays?: string[];
    jobStartDate?: string | null;
    jobEndDate?: string | null;
  } | null;
  publishSettings: {
    linkedin: boolean;
    indeed: boolean;
    glassdoor: boolean;
  };
  createdAt: string;
  closedAt: string | null;
  applicantCount: number;
}

export interface ActiveClientPlacement {
  id: string;
  employeeId: string;
  employeeName: string;
  workStatus: string | null;
  jobId: string | null;
  positionTitle: string | null;
}

export interface ApiActiveClientDetail extends ApiActiveClient {
  jobs: ActiveClientJobSummary[];
  placements: ActiveClientPlacement[];
}

export interface ActiveClientInputPayload {
  name: string;
  industry: string;
  location: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  status?: ActiveClientStatus;
  notes?: string | null;
  clientTraining?: boolean;
  trainingFileBase64?: string | null;
  trainingFileName?: string | null;
  trainingMimeType?: string | null;
  trainingPandaDocTemplateId?: string | null;
}

export interface ActiveClientListResult {
  data: ApiActiveClient[];
  total: number;
  page: number;
  pageSize: number;
}

function errorOf(res: unknown, fallback: string): string {
  return (res as { error?: string }).error ?? fallback;
}

export async function fetchActiveClients(params?: {
  search?: string;
  status?: ActiveClientStatus;
  page?: number;
  pageSize?: number;
  agencyIds?: string[];
  ownerIds?: string[];
  ownerExact?: boolean;
}): Promise<ActiveClientListResult> {
  const sp = new URLSearchParams();
  if (params?.search) sp.set('search', params.search);
  if (params?.status) sp.set('status', params.status);
  if (params?.page) sp.set('page', String(params.page));
  if (params?.pageSize) sp.set('pageSize', String(params.pageSize));
  if (params?.agencyIds?.length) sp.set('agencyIds', params.agencyIds.join(','));
  if (params?.ownerIds?.length) {
    sp.set('ownerIds', params.ownerIds.join(','));
    if (params.ownerExact) sp.set('ownerExact', '1');
  }
  const q = sp.toString();
  const res = await apiFetch<ActiveClientListResult>(`/active-clients${q ? `?${q}` : ''}`);
  if (!res.ok) throw new Error(errorOf(res, 'Failed to load active clients'));
  return res.data;
}

export async function fetchActiveClient(id: string): Promise<ApiActiveClientDetail> {
  const res = await apiFetch<ApiActiveClientDetail>(
    `/active-clients/${encodeURIComponent(id)}`,
  );
  if (!res.ok) throw new Error(errorOf(res, 'Failed to load active client'));
  return res.data;
}

export async function createActiveClient(
  input: ActiveClientInputPayload,
): Promise<ApiActiveClient> {
  const res = await apiFetch<ApiActiveClient>('/active-clients', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(errorOf(res, 'Failed to create active client'));
  return res.data;
}

export async function updateActiveClient(
  id: string,
  input: Partial<ActiveClientInputPayload>,
): Promise<ApiActiveClient> {
  const res = await apiFetch<ApiActiveClient>(`/active-clients/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(errorOf(res, 'Failed to update active client'));
  return res.data;
}

/** DELETE — server returns 409 with a message when jobs/placements still reference the client. */
export async function deleteActiveClient(id: string): Promise<void> {
  const res = await apiFetch<{ success: boolean }>(
    `/active-clients/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) throw new Error(errorOf(res, 'Failed to delete active client'));
}
