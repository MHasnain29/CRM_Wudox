/**
 * Recruitment period reports API — GET /api/v1/dashboard/recruitment-report.
 */
import { apiFetch } from '@/lib/api';

export type ReportRangeDays = 30 | 90 | 180;

export interface RecruitmentReportKpis {
  totalJobs: number;
  openJobs: number;
  draftJobs: number;
  closedJobs: number;
  filledJobs: number;
  totalPositions: number;
  filledPositions: number;
  activePlacements: number;
  pendingRequests: number;
  employeesPendingApproval: number;
  placementsApprovedInRange: number;
  placementsEndedInRange: number;
  availableMasters: number;
  openJobsNeedingFill: number;
  employeesWithMatches: number;
  employeesWithZeroMatches: number;
  jobsWithZeroMatches: number;
}

export interface RecruitmentReportData {
  range: { startDate: string; endDate: string };
  kpis: RecruitmentReportKpis;
  jobsByStatus: Array<{ status: string; count: number }>;
  monthlyJobOrders: Array<{ month: string; opened: number; closed: number }>;
  monthlyPlacements: Array<{ month: string; approved: number; ended: number }>;
  recruiterWorkload: Array<{
    userId: string;
    name: string;
    pendingRequests: number;
    activePlacements: number;
  }>;
  myJobs: Array<{
    id: string;
    title: string;
    status: string;
    openPositions: number;
    filledPositions: number;
    company: string;
  }>;
}

export function reportRangeFromDays(days: ReportRangeDays): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - days);
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

export async function fetchRecruitmentReport(opts?: {
  mine?: boolean;
  days?: ReportRangeDays;
}): Promise<RecruitmentReportData> {
  const days = opts?.days ?? 180;
  const { startDate, endDate } = reportRangeFromDays(days);
  const params = new URLSearchParams({
    startDate,
    endDate,
  });
  if (opts?.mine) params.set('mine', '1');
  const res = await apiFetch<RecruitmentReportData>(
    `/dashboard/recruitment-report?${params.toString()}`,
  );
  if (!res.ok) {
    throw new Error(
      (res as { error?: string }).error ?? 'Failed to load recruitment report',
    );
  }
  return res.data;
}
