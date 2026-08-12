/**
 * Server-side placement orchestrator (replaces frontend recruitmentPlacementSync).
 * Atomically updates JobAssignment roster, EmployeeAssignment, and Employee.workStatus.
 */
import type { PlacementEndReason, Prisma } from '@prisma/client';
import prisma from '../config/database';
import { agencyJobWhere, getJobById, type ScreeningCriteriaInput } from './jobs';
import { assertEmployeeMeetsJobLicenses } from './jobLicenseChecks';
import { assertEmployeeMeetsJobSkills } from './employeeJobMatching';
import {
  notifyAssignmentRequestsAutoRejected,
  notifyJobStatusChanged,
  notifyPlacementAdded,
  notifyPlacementEnded,
} from './jobFlowNotifications';
import { getAgencyBranding, sendEmployeeAssignmentDetailsEmail } from './email';
import { resolveTrainingOutboundSender } from './trainingOutboundSender';
import { env } from '../config/env';
import { assertEmployeeNotActivelyPlacedElsewhere } from './employeeAssignments';


type ShiftJson = {
  startTime?: string;
  endTime?: string;
  workDays?: string[];
};

function capacityFor(job: { openPositions: number; backupPercentage: number }) {
  return Math.ceil(job.openPositions * (1 + job.backupPercentage / 100));
}

function formatPay(salaryMin: unknown, salaryMax: unknown): string | null {
  if (salaryMin == null) return null;
  const min = Number(salaryMin);
  const max = salaryMax != null ? Number(salaryMax) : null;
  return `$${min}${max != null ? `–$${max}` : ''}/hr`;
}

function formatShift(shift: unknown): string | null {
  if (!shift || typeof shift !== 'object') return null;
  const s = shift as ShiftJson;
  const days = (s.workDays ?? []).slice(0, 5).join(', ');
  if (!s.startTime || !s.endTime) return days || null;
  return `${s.startTime}–${s.endTime}${days ? ` · ${days}` : ''}`;
}

async function assertJobInAgency(jobId: string, agencyIds: string[]) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, AND: [agencyJobWhere(agencyIds)] },
  });
  if (!job) throw Object.assign(new Error('Job not found'), { status: 404 });
  return job;
}

async function assertEmployeeInAgency(employeeId: string, agencyIds: string[]) {
  const emp = await prisma.employee.findFirst({
    where: {
      id: employeeId,
      addedBy: {
        subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
      },
    },
    select: { id: true, firstName: true, lastName: true, approvalStatus: true },
  });
  if (!emp) throw Object.assign(new Error('Employee not found'), { status: 404 });
  if (emp.approvalStatus !== 'approved') {
    throw Object.assign(new Error('Employee must be approved before placement'), { status: 400 });
  }
  return emp;
}

export async function placeEmployeeOnJob(params: {
  jobId: string;
  employeeId: string;
  agencyIds: string[];
  assignedById: string;
  isBackup?: boolean;
  /** When true, skip required-skills hard block (user confirmed mismatch). */
  allowSkillMismatch?: boolean;
  assignmentId?: string | null;
  workLocation?: string | null;
  positionTitle?: string | null;
  payRate?: string | null;
  shiftSchedule?: string | null;
  expectedDuration?: string | null;
  supervisorInfo?: string | null;
  requiredPpe?: string | null;
  workplaceHazards?: string | null;
}) {
  const job = await assertJobInAgency(params.jobId, params.agencyIds);
  if (job.status !== 'open') {
    throw Object.assign(
      new Error(`Cannot place employees on a ${job.status} job`),
      { status: 400 },
    );
  }
  await assertEmployeeInAgency(params.employeeId, params.agencyIds);
  if (!params.allowSkillMismatch) {
    const empSkills = await prisma.employee.findUnique({
      where: { id: params.employeeId },
      select: { skills: true },
    });
    assertEmployeeMeetsJobSkills(
      empSkills?.skills,
      (job.screeningCriteria as ScreeningCriteriaInput | null) ?? null,
    );
  }
  await assertEmployeeMeetsJobLicenses(params.employeeId, job);
  const isBackup = params.isBackup ?? false;

  const activeCount = await prisma.jobAssignment.count({
    where: { jobId: job.id, isActive: true },
  });
  const already = await prisma.jobAssignment.findFirst({
    where: { jobId: job.id, employeeId: params.employeeId, isActive: true },
    select: { id: true },
  });
  if (!already) {
    // Hard-block multi-job; Move ends the source placement first, then places here.
    await assertEmployeeNotActivelyPlacedElsewhere(params.employeeId, {
      jobId: job.id,
      excludeAssignmentId: params.assignmentId ?? null,
    });
  }
  if (!already && activeCount >= capacityFor(job)) {
    throw Object.assign(
      new Error(`Job roster is at capacity (${capacityFor(job)} including backup)`),
      { status: 400 },
    );
  }

  const workStatus = isBackup ? 'scheduled' : 'active';
  const positionTitle = params.positionTitle?.trim() || job.title;
  const payRate = params.payRate?.trim() || formatPay(job.salaryMin, job.salaryMax);
  const shiftSchedule = params.shiftSchedule?.trim() || formatShift(job.shiftSchedule);
  const workLocation = params.workLocation?.trim() || job.location;
  const expectedDuration = params.expectedDuration?.trim() || 'Ongoing';
  const supervisorInfo = params.supervisorInfo?.trim() || null;
  const requiredPpe = params.requiredPpe?.trim() || null;
  const workplaceHazards = params.workplaceHazards?.trim() || null;

  let employeeAssignmentId: string | null = params.assignmentId ?? null;

  await prisma.$transaction(async (tx) => {
    if (!already) {
      await tx.jobAssignment.create({
        data: {
          jobId: job.id,
          employeeId: params.employeeId,
          isBackup,
          isActive: true,
          assignedById: params.assignedById,
        },
      });
    } else {
      await tx.jobAssignment.update({
        where: { id: already.id },
        data: { isBackup },
      });
    }

    // No silent multi-job cleanup — assertEmployeeNotActivelyPlacedElsewhere already
    // enforces a single active placement (Move ends the source first).

    if (params.assignmentId) {
      const updated = await tx.employeeAssignment.update({
        where: { id: params.assignmentId },
        data: {
          targetType: 'job',
          jobId: job.id,
          activeClientId: job.activeClientId,
          workLocation,
          positionTitle,
          payRate,
          shiftSchedule,
          expectedDuration,
          supervisorInfo,
          requiredPpe,
          workplaceHazards,
          status: 'approved',
          isActive: true,
          endedAt: null,
          endReason: null,
          endNotes: null,
          rating: null,
          approvedById: params.assignedById,
          approvedAt: new Date(),
        },
        select: { id: true },
      });
      employeeAssignmentId = updated.id;
    } else {
      const created = await tx.employeeAssignment.create({
        data: {
          employeeId: params.employeeId,
          targetType: 'job',
          jobId: job.id,
          activeClientId: job.activeClientId,
          workLocation,
          positionTitle,
          payRate,
          shiftSchedule,
          expectedDuration,
          supervisorInfo,
          requiredPpe,
          workplaceHazards,
          status: 'approved',
          isActive: true,
          submittedById: params.assignedById,
          approvedById: params.assignedById,
          approvedAt: new Date(),
        },
        select: { id: true },
      });
      employeeAssignmentId = created.id;
    }

    await tx.employee.update({
      where: { id: params.employeeId },
      data: { workStatus },
    });

    // Refresh denormalized filled/scheduled counts
    const roster = await tx.jobAssignment.findMany({
      where: { jobId: job.id, isActive: true },
      select: { isBackup: true },
    });
    await tx.job.update({
      where: { id: job.id },
      data: {
        filledPositions: roster.filter((r) => !r.isBackup).length,
        scheduledPositions: roster.filter((r) => r.isBackup).length,
      },
    });
  });

  // Side effect: send assignment details email (never fails placement).
  // Backup-pool placements do not email the employee.
  if (employeeAssignmentId && !isBackup) {
    try {
      const [emp, activeClient] = await Promise.all([
        prisma.employee.findUnique({
          where: { id: params.employeeId },
          select: { email: true, firstName: true, lastName: true },
        }),
        job.activeClientId
          ? prisma.activeClient.findUnique({
              where: { id: job.activeClientId },
              select: { name: true },
            })
          : Promise.resolve(null),
      ]);
      const toEmail = emp?.email?.trim();
      const clientName = activeClient?.name?.trim() || job.company;
      const subCompanyId = job.subCompanyId;
      if (toEmail && clientName && subCompanyId) {
        let from = { email: '', name: 'NA Staffing CRM' };
        let agency = await getAgencyBranding(subCompanyId);
        let sentByName = 'Recruitment';

        const outbound = await resolveTrainingOutboundSender({
          sentByUserId: params.assignedById,
          subCompanyId,
        });
        if (outbound.ok) {
          from = outbound.sender.from;
          agency = outbound.sender.agency;
          sentByName = outbound.sender.sentByName;
        } else {
          from = {
            email: (agency?.emailFromAddress || env.EMAIL_FROM || '').trim(),
            name: agency?.emailFromName || agency?.name || 'NA Staffing CRM',
          };
          console.warn(
            `[jobPlacements] assignment email using agency From after resolve failed: ${outbound.error}`,
          );
        }

        if (!from.email) {
          console.warn('[jobPlacements] no From address — assignment email skipped');
        } else {
          const sendResult = await sendEmployeeAssignmentDetailsEmail({
            toEmail,
            candidateName: `${emp?.firstName ?? ''} ${emp?.lastName ?? ''}`.trim(),
            clientName,
            workLocation,
            positionTitle,
            payRate: payRate ?? '',
            shiftSchedule: shiftSchedule ?? '',
            expectedDuration,
            supervisorInfo,
            requiredPpe,
            workplaceHazards,
            sentByName,
            agency,
            from,
          });
          if (sendResult.delivered) {
            await prisma.employeeAssignment.update({
              where: { id: employeeAssignmentId },
              data: { detailsSentToCandidateAt: new Date() },
            });
          }
        }
      }
    } catch (err) {
      console.error('[jobPlacements] assignment details email failed', err);
    }
  }

  void notifyPlacementAdded({
    job,
    employeeId: params.employeeId,
    actorUserId: params.assignedById,
    isBackup,
  });

  return getJobById(job.id, params.agencyIds);
}

export async function toggleJobAssignmentRole(params: {
  jobId: string;
  assignmentId: string;
  agencyIds: string[];
  isBackup: boolean;
}) {
  await assertJobInAgency(params.jobId, params.agencyIds);
  const row = await prisma.jobAssignment.findFirst({
    where: { id: params.assignmentId, jobId: params.jobId, isActive: true },
  });
  if (!row) throw Object.assign(new Error('Assignment not found'), { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.jobAssignment.update({
      where: { id: row.id },
      data: { isBackup: params.isBackup },
    });
    await tx.employee.update({
      where: { id: row.employeeId },
      data: { workStatus: params.isBackup ? 'scheduled' : 'active' },
    });
    const roster = await tx.jobAssignment.findMany({
      where: { jobId: params.jobId, isActive: true },
      select: { isBackup: true },
    });
    await tx.job.update({
      where: { id: params.jobId },
      data: {
        filledPositions: roster.filter((r) => !r.isBackup).length,
        scheduledPositions: roster.filter((r) => r.isBackup).length,
      },
    });
  });

  return getJobById(params.jobId, params.agencyIds);
}

async function endOnePlacementInTx(
  tx: Prisma.TransactionClient,
  params: {
    employeeId: string;
    jobId?: string | null;
    endReason: PlacementEndReason;
    endNotes?: string | null;
    rating: number;
  },
): Promise<{ assignmentId: string; submittedById: string } | null> {
  if (params.jobId) {
    await tx.jobAssignment.updateMany({
      where: { jobId: params.jobId, employeeId: params.employeeId, isActive: true },
      data: { isActive: false },
    });
  } else {
    await tx.jobAssignment.updateMany({
      where: { employeeId: params.employeeId, isActive: true },
      data: { isActive: false },
    });
  }

  const activeAsg = await tx.employeeAssignment.findFirst({
    where: {
      employeeId: params.employeeId,
      isActive: true,
      ...(params.jobId ? { jobId: params.jobId } : {}),
    },
    orderBy: { approvedAt: 'desc' },
  });

  if (activeAsg) {
    await tx.employeeAssignment.update({
      where: { id: activeAsg.id },
      data: {
        isActive: false,
        endedAt: new Date(),
        endReason: params.endReason,
        endNotes: params.endNotes?.trim() || null,
        rating: params.rating,
      },
    });
  }

  await tx.employee.update({
    where: { id: params.employeeId },
    data: { workStatus: 'none' },
  });

  return activeAsg ? { assignmentId: activeAsg.id, submittedById: activeAsg.submittedById } : null;
}

export async function endJobPlacement(params: {
  jobId: string;
  assignmentId: string;
  agencyIds: string[];
  actorUserId: string;
  endReason: PlacementEndReason;
  endNotes?: string | null;
  rating: number;
}) {
  const job = await assertJobInAgency(params.jobId, params.agencyIds);
  const roster = await prisma.jobAssignment.findFirst({
    where: { id: params.assignmentId, jobId: job.id, isActive: true },
  });
  if (!roster) throw Object.assign(new Error('Assignment not found'), { status: 404 });
  if (params.rating < 1 || params.rating > 5) {
    throw Object.assign(new Error('Rating must be 1–5'), { status: 400 });
  }

  let ended: { assignmentId: string; submittedById: string } | null = null;
  await prisma.$transaction(async (tx) => {
    ended = await endOnePlacementInTx(tx, {
      employeeId: roster.employeeId,
      jobId: job.id,
      endReason: params.endReason,
      endNotes: params.endNotes,
      rating: params.rating,
    });
    const remaining = await tx.jobAssignment.findMany({
      where: { jobId: job.id, isActive: true },
      select: { isBackup: true },
    });
    await tx.job.update({
      where: { id: job.id },
      data: {
        filledPositions: remaining.filter((r) => !r.isBackup).length,
        scheduledPositions: remaining.filter((r) => r.isBackup).length,
      },
    });
  });

  void notifyPlacementEnded({
    job,
    employeeId: roster.employeeId,
    actorUserId: params.actorUserId,
    endReason: params.endReason,
    requesterUserId: (ended as { submittedById: string } | null)?.submittedById ?? null,
  });

  return getJobById(job.id, params.agencyIds);
}

export async function moveJobPlacement(params: {
  jobId: string;
  assignmentId: string;
  targetJobId: string;
  agencyIds: string[];
  assignedById: string;
  isBackup?: boolean;
}) {
  const source = await assertJobInAgency(params.jobId, params.agencyIds);
  const target = await assertJobInAgency(params.targetJobId, params.agencyIds);
  const roster = await prisma.jobAssignment.findFirst({
    where: { id: params.assignmentId, jobId: source.id, isActive: true },
  });
  if (!roster) throw Object.assign(new Error('Assignment not found'), { status: 404 });
  // Check before deactivating the source placement so a blocked move leaves
  // the employee where they are.
  await assertEmployeeMeetsJobLicenses(roster.employeeId, target);

  await prisma.$transaction(async (tx) => {
    await tx.jobAssignment.update({
      where: { id: roster.id },
      data: { isActive: false },
    });
    await tx.employeeAssignment.updateMany({
      where: { employeeId: roster.employeeId, jobId: source.id, isActive: true },
      data: { isActive: false },
    });
  });

  return placeEmployeeOnJob({
    jobId: params.targetJobId,
    employeeId: roster.employeeId,
    agencyIds: params.agencyIds,
    assignedById: params.assignedById,
    isBackup: params.isBackup ?? roster.isBackup,
  });
}

export async function endAllJobPlacements(params: {
  jobId: string;
  agencyIds: string[];
  actorUserId: string;
  finalStatus: 'closed' | 'filled';
  rows: Array<{
    employeeId: string;
    endReason: PlacementEndReason;
    endNotes?: string | null;
    rating: number;
  }>;
}) {
  const job = await assertJobInAgency(params.jobId, params.agencyIds);
  const active = await prisma.jobAssignment.findMany({
    where: { jobId: job.id, isActive: true },
  });

  const byEmp = new Map(params.rows.map((r) => [r.employeeId, r]));
  for (const a of active) {
    if (!byEmp.has(a.employeeId)) {
      throw Object.assign(
        new Error('Provide an end reason and rating for every active assignee'),
        { status: 400 },
      );
    }
  }

  // Snapshot pending requests before they are auto-rejected, for notifications.
  const pendingRequests = await prisma.employeeAssignment.findMany({
    where: { jobId: job.id, status: 'pending' },
    select: {
      id: true,
      submittedById: true,
      employee: { select: { firstName: true, lastName: true } },
    },
  });

  const endedPlacements: Array<{
    employeeId: string;
    endReason: PlacementEndReason;
    submittedById: string | null;
  }> = [];

  await prisma.$transaction(async (tx) => {
    for (const a of active) {
      const row = byEmp.get(a.employeeId)!;
      const ended = await endOnePlacementInTx(tx, {
        employeeId: a.employeeId,
        jobId: job.id,
        endReason: row.endReason,
        endNotes: row.endNotes,
        rating: row.rating,
      });
      endedPlacements.push({
        employeeId: a.employeeId,
        endReason: row.endReason,
        submittedById: ended?.submittedById ?? null,
      });
    }
    // Pending requests against this job are now moot — reject them.
    await tx.employeeAssignment.updateMany({
      where: { jobId: job.id, status: 'pending' },
      data: {
        status: 'rejected',
        isActive: false,
        rejectedAt: new Date(),
        rejectionReason: 'Job was closed',
      },
    });
    await tx.job.update({
      where: { id: job.id },
      data: {
        status: params.finalStatus,
        closedAt: new Date(),
        filledPositions: 0,
        scheduledPositions: 0,
      },
    });
  });

  for (const p of endedPlacements) {
    void notifyPlacementEnded({
      job,
      employeeId: p.employeeId,
      actorUserId: params.actorUserId,
      endReason: p.endReason,
      requesterUserId: p.submittedById,
    });
  }
  if (pendingRequests.length > 0) {
    void notifyAssignmentRequestsAutoRejected({
      subCompanyId: job.subCompanyId ?? params.agencyIds[0],
      jobTitle: job.title,
      requests: pendingRequests.map((r) => ({
        id: r.id,
        submittedById: r.submittedById,
        employeeName: `${r.employee.firstName} ${r.employee.lastName}`.trim(),
      })),
    });
  }
  void notifyJobStatusChanged({
    job,
    status: params.finalStatus,
    actorUserId: params.actorUserId,
  });

  return getJobById(job.id, params.agencyIds);
}

/** End a client-target (or any) employee assignment with rating. */
export async function endEmployeeAssignment(params: {
  employeeId: string;
  assignmentId: string;
  agencyIds: string[];
  actorUserId: string;
  endReason: PlacementEndReason;
  endNotes?: string | null;
  rating: number;
}) {
  await assertEmployeeInAgency(params.employeeId, params.agencyIds);
  if (params.rating < 1 || params.rating > 5) {
    throw Object.assign(new Error('Rating must be 1–5'), { status: 400 });
  }

  const asg = await prisma.employeeAssignment.findFirst({
    where: {
      id: params.assignmentId,
      employeeId: params.employeeId,
      isActive: true,
    },
  });
  if (!asg) throw Object.assign(new Error('Assignment not found'), { status: 404 });

  await prisma.$transaction(async (tx) => {
    await endOnePlacementInTx(tx, {
      employeeId: params.employeeId,
      jobId: asg.jobId,
      endReason: params.endReason,
      endNotes: params.endNotes,
      rating: params.rating,
    });
    if (asg.jobId) {
      const remaining = await tx.jobAssignment.findMany({
        where: { jobId: asg.jobId, isActive: true },
        select: { isBackup: true },
      });
      await tx.job.update({
        where: { id: asg.jobId },
        data: {
          filledPositions: remaining.filter((r) => !r.isBackup).length,
          scheduledPositions: remaining.filter((r) => r.isBackup).length,
        },
      });
    }
  });

  const jobRef = asg.jobId
    ? await prisma.job.findUnique({
        where: { id: asg.jobId },
        select: { id: true, title: true, company: true, createdById: true, subCompanyId: true },
      })
    : null;
  void notifyPlacementEnded({
    job: jobRef,
    employeeId: params.employeeId,
    actorUserId: params.actorUserId,
    endReason: params.endReason,
    requesterUserId: asg.submittedById,
  });

  return { success: true };
}
