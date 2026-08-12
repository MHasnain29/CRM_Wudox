/**
 * Recruitment dashboard aggregates (manager + recruiter views).
 * Agency-scoped like services/jobs.ts; `mine` restricts to the acting user's
 * own jobs (createdById) and requests/placements (submittedById).
 */
import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { agencyJobWhere } from './jobs';
import { getRecruitmentMatchingSummary } from './employeeJobMatching';

export type RecruitmentDashboardParams = {
  agencyIds: string[];
  actorId: string;
  mine?: boolean;
};

function subCompanyFilter(agencyIds: string[]) {
  return agencyIds.length === 1 ? agencyIds[0]! : { in: agencyIds };
}

/** EmployeeAssignment scope — via the submitting employee's agency (same as listJobAssignmentRequests). */
function agencyAssignmentWhere(agencyIds: string[]): Prisma.EmployeeAssignmentWhereInput {
  return {
    employee: { addedBy: { subCompanyId: subCompanyFilter(agencyIds) } },
  };
}

function fullName(u: { firstName: string; lastName: string }): string {
  return `${u.firstName} ${u.lastName}`.trim();
}

type AssignmentActivityRow = Prisma.EmployeeAssignmentGetPayload<{
  select: typeof activitySelect;
}>;

const activitySelect = {
  id: true,
  status: true,
  isActive: true,
  isBackup: true,
  targetType: true,
  submittedAt: true,
  approvedAt: true,
  rejectedAt: true,
  endedAt: true,
  updatedAt: true,
  employee: { select: { firstName: true, lastName: true } },
  submittedBy: { select: { firstName: true, lastName: true } },
  job: { select: { title: true } },
  activeClient: { select: { name: true } },
  client: { select: { name: true } },
} as const;

function activityEvent(row: AssignmentActivityRow) {
  const targetLabel =
    row.job?.title ?? row.activeClient?.name ?? row.client?.name ?? 'Unknown target';
  let type: 'submitted' | 'approved' | 'rejected' | 'ended' = 'submitted';
  let at = row.submittedAt;
  if (row.endedAt) {
    type = 'ended';
    at = row.endedAt;
  } else if (row.status === 'rejected' && row.rejectedAt) {
    type = 'rejected';
    at = row.rejectedAt;
  } else if (row.status === 'approved' && row.approvedAt) {
    type = 'approved';
    at = row.approvedAt;
  }
  return {
    id: row.id,
    type,
    employeeName: fullName(row.employee),
    targetType: row.targetType,
    targetLabel,
    submittedByName: fullName(row.submittedBy),
    at: at.toISOString(),
  };
}

export async function getRecruitmentDashboard(params: RecruitmentDashboardParams) {
  const { agencyIds, actorId, mine } = params;

  const jobWhere: Prisma.JobWhereInput = {
    AND: [agencyJobWhere(agencyIds), ...(mine ? [{ createdById: actorId }] : [])],
  };
  const assignmentScope: Prisma.EmployeeAssignmentWhereInput = {
    AND: [agencyAssignmentWhere(agencyIds), ...(mine ? [{ submittedById: actorId }] : [])],
  };

  // Onboarding agreements sent via PandaDoc but not yet signed/completed.
  const pendingSigningWhere: Prisma.EmployeeWhereInput = {
    onboardingPandaDocId: { not: null },
    onboardingPandaDocStatus: { notIn: ['document.completed', 'document.paid'] },
    addedBy: { subCompanyId: subCompanyFilter(agencyIds) },
    ...(mine ? { addedById: actorId } : {}),
  };

  const now = new Date();
  const months: { start: Date; end: Date; label: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    months.push({
      start,
      end,
      label: start.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
    });
  }
  const trendStart = months[0]!.start;

  const [
    jobsByStatusRaw,
    filledPositions,
    activeClients,
    pendingEmployeeRows,
    pendingRequestRows,
    activePlacements,
    pendingRequestsCount,
    pendingEmployeesCount,
    trendJobs,
    activityRows,
    pendingSigningRows,
    pendingSigningsCount,
    matching,
  ] = await Promise.all([
    prisma.job.groupBy({
      by: ['status'],
      where: jobWhere,
      _count: { _all: true },
      _sum: { openPositions: true },
    }),
    prisma.jobAssignment.count({
      where: { isActive: true, isBackup: false, job: jobWhere },
    }),
    prisma.activeClient.count({
      where: { subCompanyId: subCompanyFilter(agencyIds), status: 'active' },
    }),
    prisma.employee.findMany({
      where: {
        approvalStatus: 'pending',
        submitterRole: { not: null },
        addedBy: { subCompanyId: subCompanyFilter(agencyIds) },
        ...(mine ? { addedById: actorId } : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        createdAt: true,
        submitterRole: true,
        addedBy: { select: { firstName: true, lastName: true, subCompanyId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    // Job roster adds activate immediately — only client placements need RM approval.
    prisma.employeeAssignment.findMany({
      where: { AND: [assignmentScope, { status: 'pending', targetType: 'client' }] },
      select: {
        id: true,
        employeeId: true,
        targetType: true,
        isBackup: true,
        submittedAt: true,
        employee: {
          select: {
            firstName: true,
            lastName: true,
            addedBy: { select: { subCompanyId: true } },
          },
        },
        submittedBy: { select: { firstName: true, lastName: true } },
        job: { select: { id: true, title: true } },
        activeClient: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
      },
      orderBy: { submittedAt: 'desc' },
      take: 50,
    }),
    prisma.employeeAssignment.count({
      where: { AND: [assignmentScope, { isActive: true }] },
    }),
    prisma.employeeAssignment.count({
      where: { AND: [assignmentScope, { status: 'pending', targetType: 'client' }] },
    }),
    prisma.employee.count({
      where: {
        approvalStatus: 'pending',
        submitterRole: { not: null },
        addedBy: { subCompanyId: subCompanyFilter(agencyIds) },
        ...(mine ? { addedById: actorId } : {}),
      },
    }),
    prisma.job.findMany({
      where: {
        AND: [
          jobWhere,
          { OR: [{ createdAt: { gte: trendStart } }, { closedAt: { gte: trendStart } }] },
        ],
      },
      select: { createdAt: true, closedAt: true },
    }),
    prisma.employeeAssignment.findMany({
      where: assignmentScope,
      select: activitySelect,
      orderBy: { updatedAt: 'desc' },
      take: 10,
    }),
    prisma.employee.findMany({
      where: pendingSigningWhere,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        onboardingPandaDocStatus: true,
        onboardingPandaDocUpdatedAt: true,
        addedBy: { select: { firstName: true, lastName: true, subCompanyId: true } },
      },
      orderBy: { onboardingPandaDocUpdatedAt: 'desc' },
      take: 50,
    }),
    prisma.employee.count({ where: pendingSigningWhere }),
    getRecruitmentMatchingSummary({
      agencyIds,
      createdById: mine ? actorId : undefined,
    }),
  ]);

  const totalJobs = jobsByStatusRaw.reduce((sum, r) => sum + r._count._all, 0);
  const openRow = jobsByStatusRaw.find((r) => r.status === 'open');
  const openJobs = openRow?._count._all ?? 0;
  const totalPositions = openRow?._sum.openPositions ?? 0;

  const pendingAssignmentRequests = pendingRequestRows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: fullName(r.employee),
    targetType: r.targetType,
    jobId: r.job?.id ?? null,
    jobTitle: r.job?.title ?? null,
    clientName: r.activeClient?.name ?? r.client?.name ?? null,
    isBackup: r.isBackup,
    submittedByName: fullName(r.submittedBy),
    submittedAt: r.submittedAt.toISOString(),
    subCompanyId: r.employee.addedBy.subCompanyId ?? null,
  }));

  const pendingSignings = pendingSigningRows.map((e) => ({
    id: e.id,
    name: fullName(e),
    email: e.email,
    status: e.onboardingPandaDocStatus,
    sentAt: e.onboardingPandaDocUpdatedAt?.toISOString() ?? null,
    addedByName: fullName(e.addedBy),
    subCompanyId: e.addedBy.subCompanyId ?? null,
  }));

  const pendingEmployeeApprovals = pendingEmployeeRows.map((e) => ({
    id: e.id,
    name: fullName(e),
    submittedByName: fullName(e.addedBy),
    submittedAt: e.createdAt.toISOString(),
    submitterRole: e.submitterRole,
    subCompanyId: e.addedBy.subCompanyId ?? null,
  }));

  // Recruiter workload (manager view only): pending requests + active placements per submitter.
  let recruiterWorkload: Array<{
    userId: string;
    name: string;
    pendingRequests: number;
    activePlacements: number;
  }> = [];
  if (!mine) {
    const [pendingBySubmitter, activeBySubmitter] = await Promise.all([
      prisma.employeeAssignment.groupBy({
        by: ['submittedById'],
        where: { AND: [assignmentScope, { status: 'pending', targetType: 'client' }] },
        _count: { _all: true },
      }),
      prisma.employeeAssignment.groupBy({
        by: ['submittedById'],
        where: { AND: [assignmentScope, { isActive: true }] },
        _count: { _all: true },
      }),
    ]);
    const userIds = [
      ...new Set([
        ...pendingBySubmitter.map((r) => r.submittedById),
        ...activeBySubmitter.map((r) => r.submittedById),
      ]),
    ];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const nameById = new Map(users.map((u) => [u.id, fullName(u)]));
    recruiterWorkload = userIds
      .map((userId) => ({
        userId,
        name: nameById.get(userId) ?? 'Unknown user',
        pendingRequests:
          pendingBySubmitter.find((r) => r.submittedById === userId)?._count._all ?? 0,
        activePlacements:
          activeBySubmitter.find((r) => r.submittedById === userId)?._count._all ?? 0,
      }))
      .sort((a, b) => b.activePlacements + b.pendingRequests - (a.activePlacements + a.pendingRequests));
  }

  const monthlyJobOrders = months.map(({ start, end, label }) => ({
    month: label,
    opened: trendJobs.filter((j) => j.createdAt >= start && j.createdAt < end).length,
    closed: trendJobs.filter((j) => j.closedAt && j.closedAt >= start && j.closedAt < end).length,
  }));

  return {
    kpis: {
      totalJobs,
      openJobs,
      totalPositions,
      filledPositions,
      activeClients,
      employeesPendingApproval: pendingEmployeesCount,
      activePlacements,
      pendingRequests: pendingRequestsCount,
      pendingSignings: pendingSigningsCount,
      availableMasters: matching.availableMasters,
      openJobsNeedingFill: matching.openJobsNeedingFill,
      employeesWithMatches: matching.employeesWithMatches,
      employeesWithZeroMatches: matching.employeesWithZeroMatches,
      jobsWithZeroMatches: matching.jobsWithZeroMatches,
    },
    pendingAssignmentRequests,
    pendingEmployeeApprovals,
    pendingSignings,
    recruiterWorkload,
    jobsByStatus: jobsByStatusRaw.map((r) => ({ status: r.status, count: r._count._all })),
    monthlyJobOrders,
    recentActivity: activityRows.map(activityEvent),
  };
}
