/**
 * Recruitment Jobs API — /api/v1/jobs.
 * Maps API payloads (ISO strings, snake_case employment types, activeClientId)
 * to the frontend `Job` shape from `@/lib/jobTypes`.
 */
import { apiFetch } from '@/lib/api';
import type {
  Job,
  JobAssignment,
  JobStatus,
  JobType,
  ScreeningCriteria,
  ShiftSchedule,
  WorkDay,
} from '@/lib/jobTypes';

// ─── Raw API shapes ──────────────────────────────────────────────────────────

interface ApiJobAssignment {
  id: string;
  jobId: string;
  employeeId: string;
  employeeName: string;
  isBackup: boolean;
  isActive: boolean;
  assignedAt: string;
  assignedBy: string;
  assignedByName?: string;
}

interface ApiJob {
  id: string;
  jobCode: string | null;
  templateId: string | null;
  jobType: JobType;
  title: string;
  company: string;
  clientId: string | null;
  activeClientId: string | null;
  activeClientName: string;
  agencyId: string | null;
  location: string;
  department: string | null;
  description: string;
  requirements: string;
  responsibilities: string;
  openPositions: number;
  filledPositions: number;
  scheduledPositions: number;
  backupPercentage: number;
  status: JobStatus;
  employmentType: string;
  salaryMin: number | null;
  salaryMax: number | null;
  publishSettings: {
    linkedin: boolean;
    indeed: boolean;
    glassdoor: boolean;
    publishedAt: string | null;
  };
  licenseRequired?: boolean;
  requiredLicenseTypes?: string[];
  screeningCriteria: Partial<ScreeningCriteria> | null;
  shiftSchedule: {
    startTime?: string;
    endTime?: string;
    workDays?: string[];
    jobStartDate?: string | null;
    jobEndDate?: string | null;
  } | null;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  applicantCount: number;
  assignments: ApiJobAssignment[];
}

// ─── Mapping helpers ─────────────────────────────────────────────────────────

const HYPHENATED: Record<string, Job['employmentType']> = {
  full_time: 'full-time',
  part_time: 'part-time',
  contract: 'contract',
  temporary: 'temporary',
  'full-time': 'full-time',
  'part-time': 'part-time',
};

function toApiEmploymentType(v: string): string {
  return v.replace(/-/g, '_');
}

function mapAssignment(a: ApiJobAssignment): JobAssignment {
  return {
    id: a.id,
    jobId: a.jobId,
    employeeId: a.employeeId,
    employeeName: a.employeeName,
    isBackup: a.isBackup,
    isActive: a.isActive,
    assignedAt: new Date(a.assignedAt),
    assignedBy: a.assignedBy,
    assignedByName: a.assignedByName ?? '',
  };
}

export function mapApiJob(raw: ApiJob): Job {
  const shift = raw.shiftSchedule;
  const shiftSchedule: ShiftSchedule = {
    startTime: shift?.startTime ?? '09:00',
    endTime: shift?.endTime ?? '17:00',
    workDays: (shift?.workDays ?? []) as WorkDay[],
    jobStartDate: shift?.jobStartDate ? new Date(shift.jobStartDate) : new Date(raw.createdAt),
    jobEndDate: shift?.jobEndDate ? new Date(shift.jobEndDate) : undefined,
  };
  const screeningCriteria: ScreeningCriteria = {
    requiredSkills: raw.screeningCriteria?.requiredSkills ?? [],
    preferredSkills: raw.screeningCriteria?.preferredSkills ?? [],
    minExperienceYears: raw.screeningCriteria?.minExperienceYears ?? 0,
    educationLevel: raw.screeningCriteria?.educationLevel,
    certifications: raw.screeningCriteria?.certifications,
    salaryMin: raw.screeningCriteria?.salaryMin,
    salaryMax: raw.screeningCriteria?.salaryMax,
    location: raw.screeningCriteria?.location,
    remoteOption: raw.screeningCriteria?.remoteOption ?? 'onsite',
  };
  return {
    id: raw.id,
    jobCode: raw.jobCode ?? undefined,
    templateId: raw.templateId ?? undefined,
    jobType: raw.jobType,
    title: raw.title,
    company: raw.company || raw.activeClientName,
    clientId: raw.activeClientId ?? raw.clientId ?? undefined,
    agencyId: raw.agencyId ?? undefined,
    location: raw.location,
    department: raw.department ?? undefined,
    description: raw.description,
    requirements: raw.requirements,
    responsibilities: raw.responsibilities,
    openPositions: raw.openPositions,
    filledPositions: raw.filledPositions,
    scheduledPositions: raw.scheduledPositions,
    backupPercentage: raw.backupPercentage,
    status: raw.status,
    screeningCriteria,
    publishSettings: {
      linkedin: raw.publishSettings?.linkedin ?? false,
      indeed: raw.publishSettings?.indeed ?? false,
      glassdoor: raw.publishSettings?.glassdoor ?? false,
      publishedAt: raw.publishSettings?.publishedAt
        ? new Date(raw.publishSettings.publishedAt)
        : undefined,
    },
    shiftSchedule,
    salaryMin: raw.salaryMin ?? undefined,
    salaryMax: raw.salaryMax ?? undefined,
    employmentType: HYPHENATED[raw.employmentType] ?? 'full-time',
    licenseRequired: raw.licenseRequired ?? false,
    requiredLicenseTypes: raw.requiredLicenseTypes ?? [],
    createdById: raw.createdById,
    createdByName: raw.createdByName,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
    closedAt: raw.closedAt ? new Date(raw.closedAt) : undefined,
    applicantCount: raw.applicantCount,
    assignments: (raw.assignments ?? []).map(mapAssignment),
  };
}

function errorOf(res: unknown, fallback: string): string {
  return (res as { error?: string }).error ?? fallback;
}

// ─── Payload types ───────────────────────────────────────────────────────────

export interface JobInputPayload {
  templateId?: string | null;
  jobType: JobType;
  title: string;
  company?: string;
  /** Active Client id (recruitment). */
  activeClientId: string;
  location: string;
  department?: string | null;
  description: string;
  requirements: string;
  responsibilities: string;
  openPositions?: number;
  backupPercentage?: number;
  status?: JobStatus;
  employmentType: Job['employmentType'] | 'full_time' | 'part_time';
  salaryMin?: number | null;
  salaryMax?: number | null;
  licenseRequired?: boolean;
  requiredLicenseTypes?: string[];
  publishSettings?: { linkedin?: boolean; indeed?: boolean; glassdoor?: boolean };
  screeningCriteria?: Partial<ScreeningCriteria> | null;
  shiftSchedule?: {
    startTime?: string;
    endTime?: string;
    workDays?: string[];
    jobStartDate?: string | null;
    jobEndDate?: string | null;
  } | null;
}

export type PlacementEndReason = 'work_complete' | 'not_performing' | 'other';

export interface JobsListParams {
  search?: string;
  status?: JobStatus | JobStatus[];
  jobType?: JobType;
  employmentType?: string;
  location?: string;
  department?: string;
  activeClientId?: string;
  publishLinkedin?: boolean;
  publishIndeed?: boolean;
  publishGlassdoor?: boolean;
  page?: number;
  pageSize?: number;
  agencyIds?: string[];
  ownerIds?: string[];
  ownerExact?: boolean;
}

export interface JobsListResult {
  data: Job[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

export async function fetchJobs(params?: JobsListParams): Promise<JobsListResult> {
  const sp = new URLSearchParams();
  if (params?.search) sp.set('search', params.search);
  if (params?.status) {
    sp.set('status', Array.isArray(params.status) ? params.status.join(',') : params.status);
  }
  if (params?.jobType) sp.set('jobType', params.jobType);
  if (params?.employmentType) sp.set('employmentType', toApiEmploymentType(params.employmentType));
  if (params?.location) sp.set('location', params.location);
  if (params?.department) sp.set('department', params.department);
  if (params?.activeClientId) sp.set('activeClientId', params.activeClientId);
  if (params?.publishLinkedin) sp.set('publishLinkedin', 'true');
  if (params?.publishIndeed) sp.set('publishIndeed', 'true');
  if (params?.publishGlassdoor) sp.set('publishGlassdoor', 'true');
  if (params?.page) sp.set('page', String(params.page));
  if (params?.pageSize) sp.set('pageSize', String(params.pageSize));
  if (params?.agencyIds?.length) sp.set('agencyIds', params.agencyIds.join(','));
  if (params?.ownerIds?.length) {
    sp.set('ownerIds', params.ownerIds.join(','));
    if (params.ownerExact) sp.set('ownerExact', '1');
  }
  const q = sp.toString();
  const res = await apiFetch<{ data: ApiJob[]; total: number; page: number; pageSize: number }>(
    `/jobs${q ? `?${q}` : ''}`,
  );
  if (!res.ok) throw new Error(errorOf(res, 'Failed to load jobs'));
  return { ...res.data, data: res.data.data.map(mapApiJob) };
}

export async function fetchJob(id: string): Promise<Job> {
  const res = await apiFetch<ApiJob>(`/jobs/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(errorOf(res, 'Failed to load job'));
  return mapApiJob(res.data);
}

function serializeInput(input: Partial<JobInputPayload>): Record<string, unknown> {
  const { employmentType, ...rest } = input;
  return {
    ...rest,
    ...(employmentType ? { employmentType: toApiEmploymentType(employmentType) } : {}),
  };
}

export async function createJob(input: JobInputPayload): Promise<Job> {
  const res = await apiFetch<ApiJob>('/jobs', {
    method: 'POST',
    body: JSON.stringify(serializeInput(input)),
  });
  if (!res.ok) throw new Error(errorOf(res, 'Failed to create job'));
  return mapApiJob(res.data);
}

export async function updateJob(id: string, input: Partial<JobInputPayload>): Promise<Job> {
  const res = await apiFetch<ApiJob>(`/jobs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(serializeInput(input)),
  });
  if (!res.ok) throw new Error(errorOf(res, 'Failed to update job'));
  return mapApiJob(res.data);
}

export async function updateJobStatus(id: string, status: JobStatus): Promise<Job> {
  const res = await apiFetch<ApiJob>(`/jobs/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(errorOf(res, 'Failed to update job status'));
  return mapApiJob(res.data);
}

export async function deleteJob(id: string): Promise<void> {
  const res = await apiFetch<{ success: boolean }>(`/jobs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(errorOf(res, 'Failed to delete job'));
}

/** POST /jobs/:id/assignments — place an employee on the job. Returns the updated job. */
export async function placeEmployeeOnJob(
  jobId: string,
  body: {
    employeeId: string;
    isBackup?: boolean;
    assignmentId?: string | null;
    workLocation?: string | null;
    positionTitle?: string | null;
    payRate?: string | null;
    shiftSchedule?: string | null;
    expectedDuration?: string | null;
    supervisorInfo?: string | null;
    requiredPpe?: string | null;
    workplaceHazards?: string | null;
  },
): Promise<Job> {
  const res = await apiFetch<ApiJob>(`/jobs/${encodeURIComponent(jobId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(errorOf(res, 'Failed to place employee'));
  return mapApiJob(res.data);
}

/** PATCH /jobs/:id/assignments/:assignmentId — toggle backup/active role. */
export async function toggleJobAssignmentRole(
  jobId: string,
  assignmentId: string,
  isBackup: boolean,
): Promise<Job> {
  const res = await apiFetch<ApiJob>(
    `/jobs/${encodeURIComponent(jobId)}/assignments/${encodeURIComponent(assignmentId)}`,
    { method: 'PATCH', body: JSON.stringify({ isBackup }) },
  );
  if (!res.ok) throw new Error(errorOf(res, 'Failed to update assignment role'));
  return mapApiJob(res.data);
}

/** POST /jobs/:id/assignments/:assignmentId/end — end one placement. */
export async function endJobPlacement(
  jobId: string,
  assignmentId: string,
  body: { endReason: PlacementEndReason; endNotes?: string | null; rating: number },
): Promise<Job> {
  const res = await apiFetch<ApiJob>(
    `/jobs/${encodeURIComponent(jobId)}/assignments/${encodeURIComponent(assignmentId)}/end`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  if (!res.ok) throw new Error(errorOf(res, 'Failed to end placement'));
  return mapApiJob(res.data);
}

/** POST /jobs/:id/assignments/:assignmentId/move — move placement to another job. */
export async function moveJobPlacement(
  jobId: string,
  assignmentId: string,
  body: { targetJobId: string; isBackup?: boolean },
): Promise<Job> {
  const res = await apiFetch<ApiJob>(
    `/jobs/${encodeURIComponent(jobId)}/assignments/${encodeURIComponent(assignmentId)}/move`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  if (!res.ok) throw new Error(errorOf(res, 'Failed to move placement'));
  return mapApiJob(res.data);
}

export interface JobAssignmentRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  isBackup: boolean;
  submittedAt: string;
  submittedByName: string;
}

/** GET /jobs/:id/assignment-requests — pending approval requests targeting this job. */
export async function fetchJobAssignmentRequests(jobId: string): Promise<JobAssignmentRequest[]> {
  const res = await apiFetch<{ data: JobAssignmentRequest[] }>(
    `/jobs/${encodeURIComponent(jobId)}/assignment-requests`,
  );
  if (!res.ok) throw new Error(errorOf(res, 'Failed to load assignment requests'));
  return res.data.data;
}

/** POST /jobs/:id/end-placements — end all active placements and close/fill the job. */
export async function endAllJobPlacements(
  jobId: string,
  body: {
    finalStatus: 'closed' | 'filled';
    rows: Array<{
      employeeId: string;
      endReason: PlacementEndReason;
      endNotes?: string | null;
      rating: number;
    }>;
  },
): Promise<Job> {
  const res = await apiFetch<ApiJob>(`/jobs/${encodeURIComponent(jobId)}/end-placements`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(errorOf(res, 'Failed to end placements'));
  return mapApiJob(res.data);
}

// ─── Backup percentage preference (Settings) ─────────────────────────────────

const BACKUP_PERCENTAGE_KEY = 'job-backup-percentage';
export const DEFAULT_BACKUP_PERCENTAGE = 70;

export function getBackupPercentagePreference(): number {
  try {
    const raw = localStorage.getItem(BACKUP_PERCENTAGE_KEY);
    const n = raw != null ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= 0 && n <= 500 ? n : DEFAULT_BACKUP_PERCENTAGE;
  } catch {
    return DEFAULT_BACKUP_PERCENTAGE;
  }
}

export function setBackupPercentagePreference(value: number): void {
  try {
    localStorage.setItem(BACKUP_PERCENTAGE_KEY, String(value));
  } catch {
    // ignore storage failures
  }
}
