/**
 * Employee ↔ job skill/license matching API.
 */
import { apiFetch } from '@/lib/api';

export type MatchingJob = {
  id: string;
  jobCode?: string | null;
  title: string;
  status: string;
  location: string;
  company: string;
  activeClientId: string;
  activeClientName: string;
  activeClient: {
    id: string;
    name: string;
    clientTraining?: boolean;
    hasTrainingDocument?: boolean;
    trainingFileName?: string | null;
  } | null;
  openPositions: number;
  licenseRequired: boolean;
  requiredLicenseTypes: string[];
  requiredSkills: string[];
  screeningCriteria: {
    requiredSkills?: string[];
    preferredSkills?: string[];
  } | null;
};

export type MatchingEmployee = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  skills: string[];
  workStatus: string | null;
  approvalStatus: string;
  city: string | null;
  province: string | null;
  tags?: string[];
  specialTags?: string[];
  addedBySubCompanyId?: string | null;
};

/** One job row on the Job Matches board (job → matching employees). */
export type JobMatchBoardRow = {
  job: MatchingJob;
  matchingEmployees: MatchingEmployee[];
  matchCount: number;
};

export type JobMatchBoardResult = {
  data: JobMatchBoardRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

function errorOf(res: unknown, fallback: string): string {
  return (res as { error?: string }).error ?? fallback;
}

/** GET /employees/:id/matching-jobs */
export async function fetchMatchingJobsForEmployee(
  employeeId: string,
  params?: {
    activeClientId?: string;
    status?: string | string[];
    agencyIds?: string[];
  },
): Promise<MatchingJob[]> {
  const qs = new URLSearchParams();
  if (params?.activeClientId) qs.set('activeClientId', params.activeClientId);
  if (params?.status) {
    qs.set('status', Array.isArray(params.status) ? params.status.join(',') : params.status);
  }
  if (params?.agencyIds?.length) qs.set('agencyIds', params.agencyIds.join(','));
  const q = qs.toString();
  const res = await apiFetch<{ data: MatchingJob[] }>(
    `/employees/${encodeURIComponent(employeeId)}/matching-jobs${q ? `?${q}` : ''}`,
  );
  if (!res.ok) throw new Error(errorOf(res, 'Failed to load matching jobs'));
  return res.data.data ?? [];
}

/** GET /employees/job-matches — open jobs with matching Available Master employees */
export async function fetchEmployeeJobMatchBoard(params?: {
  page?: number;
  pageSize?: number;
  q?: string;
  agencyIds?: string[];
  ownerIds?: string[];
  ownerExact?: boolean;
}): Promise<JobMatchBoardResult> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
  if (params?.q) qs.set('q', params.q);
  if (params?.agencyIds?.length) qs.set('agencyIds', params.agencyIds.join(','));
  if (params?.ownerIds?.length) {
    qs.set('ownerIds', params.ownerIds.join(','));
    if (params.ownerExact) qs.set('ownerExact', '1');
  }
  const q = qs.toString();
  const res = await apiFetch<JobMatchBoardResult>(
    `/employees/job-matches${q ? `?${q}` : ''}`,
  );
  if (!res.ok) throw new Error(errorOf(res, 'Failed to load job matches'));
  return {
    data: Array.isArray(res.data.data) ? res.data.data : [],
    pagination: res.data.pagination,
  };
}

/** GET /jobs/:id/matching-employees */
export async function fetchMatchingEmployeesForJob(
  jobId: string,
  params?: { q?: string; agencyIds?: string[] },
): Promise<MatchingEmployee[]> {
  const qs = new URLSearchParams();
  if (params?.q) qs.set('q', params.q);
  if (params?.agencyIds?.length) qs.set('agencyIds', params.agencyIds.join(','));
  const q = qs.toString();
  const res = await apiFetch<{ data: MatchingEmployee[] }>(
    `/jobs/${encodeURIComponent(jobId)}/matching-employees${q ? `?${q}` : ''}`,
  );
  if (!res.ok) throw new Error(errorOf(res, 'Failed to load matching employees'));
  return res.data.data ?? [];
}
