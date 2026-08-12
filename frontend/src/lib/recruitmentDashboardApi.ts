/**
 * Recruitment dashboard API — GET /api/v1/dashboard/recruitment.
 * Powers the live Recruitment Manager and Recruiter dashboards.
 */
import { apiFetch } from '@/lib/api';

export interface RecruitmentDashboardKpis {
  totalJobs: number;
  openJobs: number;
  totalPositions: number;
  filledPositions: number;
  activeClients: number;
  employeesPendingApproval: number;
  activePlacements: number;
  pendingRequests: number;
  pendingSignings: number;
  availableMasters: number;
  openJobsNeedingFill: number;
  employeesWithMatches: number;
  employeesWithZeroMatches: number;
  jobsWithZeroMatches: number;
}

export interface PendingSigning {
  id: string;
  name: string;
  email: string | null;
  status: string | null;
  sentAt: string | null;
  addedByName: string;
  subCompanyId: string | null;
}

export interface PendingAssignmentRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  targetType: 'client' | 'job';
  jobId: string | null;
  jobTitle: string | null;
  clientName: string | null;
  isBackup: boolean;
  submittedByName: string;
  submittedAt: string;
  subCompanyId: string | null;
}

export interface PendingEmployeeApproval {
  id: string;
  name: string;
  submittedByName: string;
  submittedAt: string;
  submitterRole: string | null;
  subCompanyId: string | null;
}

export interface RecruiterWorkloadEntry {
  userId: string;
  name: string;
  pendingRequests: number;
  activePlacements: number;
}

export interface RecruitmentActivityEvent {
  id: string;
  type: 'submitted' | 'approved' | 'rejected' | 'ended';
  employeeName: string;
  targetType: 'client' | 'job';
  targetLabel: string;
  submittedByName: string;
  at: string;
}

export interface RecruitmentDashboardData {
  kpis: RecruitmentDashboardKpis;
  pendingAssignmentRequests: PendingAssignmentRequest[];
  pendingEmployeeApprovals: PendingEmployeeApproval[];
  pendingSignings: PendingSigning[];
  recruiterWorkload: RecruiterWorkloadEntry[];
  jobsByStatus: Array<{ status: 'draft' | 'open' | 'closed' | 'filled'; count: number }>;
  monthlyJobOrders: Array<{ month: string; opened: number; closed: number }>;
  recentActivity: RecruitmentActivityEvent[];
}

export async function fetchRecruitmentDashboard(opts?: {
  mine?: boolean;
}): Promise<RecruitmentDashboardData> {
  const q = opts?.mine ? '?mine=1' : '';
  const res = await apiFetch<RecruitmentDashboardData>(`/dashboard/recruitment${q}`);
  if (!res.ok) {
    throw new Error(
      (res as { error?: string }).error ?? 'Failed to load recruitment dashboard',
    );
  }
  return res.data;
}
