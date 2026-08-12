/**
 * Recruitment period reports (manager + recruiter views).
 * Agency-scoped like recruitmentDashboard; `mine` scopes to the actor's jobs/assignments.
 */
import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { agencyJobWhere } from './jobs';
import { getRecruitmentMatchingSummary } from './employeeJobMatching';

export type RecruitmentReportParams = {
  agencyIds: string[];
  actorId: string;
  mine?: boolean;
  startDate: Date;
  endDate: Date;
};

function subCompanyFilter(agencyIds: string[]) {
  return agencyIds.length === 1 ? agencyIds[0]! : { in: agencyIds };
}

function agencyAssignmentWhere(agencyIds: string[]): Prisma.EmployeeAssignmentWhereInput {
  return {
    employee: { addedBy: { subCompanyId: subCompanyFilter(agencyIds) } },
  };
}

function fullName(u: { firstName: string; lastName: string }): string {
  return `${u.firstName} ${u.lastName}`.trim();
}

function buildMonthBuckets(startDate: Date, endDate: Date) {
  const months: { start: Date; end: Date; label: string }[] = [];
  let cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  const endMonth = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));
  while (cursor <= endMonth) {
    const start = new Date(cursor);
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    months.push({
      start,
      end,
      label: start.toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
    });
    cursor = end;
  }
  return months;
}

export async function getRecruitmentReport(params: RecruitmentReportParams) {
  const { agencyIds, actorId, mine, startDate, endDate } = params;

  const jobWhere: Prisma.JobWhereInput = {
    AND: [agencyJobWhere(agencyIds), ...(mine ? [{ createdById: actorId }] : [])],
  };
  const assignmentScope: Prisma.EmployeeAssignmentWhereInput = {
    AND: [agencyAssignmentWhere(agencyIds), ...(mine ? [{ submittedById: actorId }] : [])],
  };

  const months = buildMonthBuckets(startDate, endDate);

  const [
    jobsByStatusRaw,
    filledPositions,
    activePlacements,
    pendingRequestsCount,
    pendingEmployeesCount,
    placementsApprovedInRange,
    placementsEndedInRange,
    trendJobs,
    placementEvents,
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
    prisma.employeeAssignment.count({
      where: {
        AND: [
          assignmentScope,
          { status: 'approved', approvedAt: { gte: startDate, lt: endDate } },
        ],
      },
    }),
    prisma.employeeAssignment.count({
      where: {
        AND: [assignmentScope, { endedAt: { gte: startDate, lt: endDate } }],
      },
    }),
    prisma.job.findMany({
      where: {
        AND: [
          jobWhere,
          {
            OR: [
              { createdAt: { gte: startDate, lt: endDate } },
              { closedAt: { gte: startDate, lt: endDate } },
            ],
          },
        ],
      },
      select: { createdAt: true, closedAt: true },
    }),
    prisma.employeeAssignment.findMany({
      where: {
        AND: [
          assignmentScope,
          {
            OR: [
              { approvedAt: { gte: startDate, lt: endDate } },
              { endedAt: { gte: startDate, lt: endDate } },
            ],
          },
        ],
      },
      select: { approvedAt: true, endedAt: true },
    }),
    getRecruitmentMatchingSummary({
      agencyIds,
      createdById: mine ? actorId : undefined,
    }),
  ]);

  const totalJobs = jobsByStatusRaw.reduce((sum, r) => sum + r._count._all, 0);
  const openRow = jobsByStatusRaw.find((r) => r.status === 'open');
  const openJobs = openRow?._count._all ?? 0;
  const totalPositions = openRow?._sum.openPositions ?? 0;
  const closedJobs = jobsByStatusRaw.find((r) => r.status === 'closed')?._count._all ?? 0;
  const filledJobs = jobsByStatusRaw.find((r) => r.status === 'filled')?._count._all ?? 0;
  const draftJobs = jobsByStatusRaw.find((r) => r.status === 'draft')?._count._all ?? 0;

  const monthlyJobOrders = months.map(({ start, end, label }) => ({
    month: label,
    opened: trendJobs.filter((j) => j.createdAt >= start && j.createdAt < end).length,
    closed: trendJobs.filter((j) => j.closedAt && j.closedAt >= start && j.closedAt < end).length,
  }));

  const monthlyPlacements = months.map(({ start, end, label }) => ({
    month: label,
    approved: placementEvents.filter(
      (p) => p.approvedAt && p.approvedAt >= start && p.approvedAt < end,
    ).length,
    ended: placementEvents.filter((p) => p.endedAt && p.endedAt >= start && p.endedAt < end)
      .length,
  }));

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
      .sort(
        (a, b) =>
          b.activePlacements + b.pendingRequests - (a.activePlacements + a.pendingRequests),
      );
  }

  let myJobs: Array<{
    id: string;
    title: string;
    status: string;
    openPositions: number;
    filledPositions: number;
    company: string;
  }> = [];

  if (mine) {
    const jobs = await prisma.job.findMany({
      where: jobWhere,
      select: {
        id: true,
        title: true,
        status: true,
        openPositions: true,
        company: true,
        assignments: {
          where: { isActive: true, isBackup: false },
          select: { id: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    myJobs = jobs.map((j) => ({
      id: j.id,
      title: j.title,
      status: j.status,
      openPositions: j.openPositions,
      filledPositions: j.assignments.length,
      company: j.company,
    }));
  }

  return {
    range: {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    },
    kpis: {
      totalJobs,
      openJobs,
      draftJobs,
      closedJobs,
      filledJobs,
      totalPositions,
      filledPositions,
      activePlacements,
      pendingRequests: pendingRequestsCount,
      employeesPendingApproval: pendingEmployeesCount,
      placementsApprovedInRange,
      placementsEndedInRange,
      availableMasters: matching.availableMasters,
      openJobsNeedingFill: matching.openJobsNeedingFill,
      employeesWithMatches: matching.employeesWithMatches,
      employeesWithZeroMatches: matching.employeesWithZeroMatches,
      jobsWithZeroMatches: matching.jobsWithZeroMatches,
    },
    jobsByStatus: jobsByStatusRaw.map((r) => ({ status: r.status, count: r._count._all })),
    monthlyJobOrders,
    monthlyPlacements,
    recruiterWorkload,
    myJobs,
  };
}
