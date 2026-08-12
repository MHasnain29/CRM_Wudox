/**
 * Employee → Client/Job assignment approval (step 2).
 * Client placements require assignment details emailed to the candidate before activation.
 */
import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { submitEntityForApproval } from './approvalActions';
import { sendEmployeeAssignmentDetailsEmail, getAgencyBranding } from './email';
import { assertEmployeeMeetsJobLicenses } from './jobLicenseChecks';
import { assertEmployeeMeetsJobSkills } from './employeeJobMatching';
import type { ScreeningCriteriaInput } from './jobs';
import {
  notifyAssignmentRequestSubmitted,
  notifyPlacementAdded,
} from './jobFlowNotifications';
import { maybeStartActiveClientTrainingAfterJobLink } from './activeClientTraining';
import {
  formatTrainingSendError,
  resolveTrainingOutboundSender,
} from './trainingOutboundSender';
import { env } from '../config/env';

/** Prefer recruiter From; always fall back to agency / EMAIL_FROM so placement mail still sends. */
async function resolveAssignmentOutbound(params: {
  sentByUserId: string;
  subCompanyId: string;
}): Promise<{
  from: { email: string; name: string };
  agency: Awaited<ReturnType<typeof getAgencyBranding>>;
  sentByName: string;
}> {
  const outbound = await resolveTrainingOutboundSender(params);
  if (outbound.ok) {
    return {
      from: outbound.sender.from,
      agency: outbound.sender.agency,
      sentByName: outbound.sender.sentByName,
    };
  }

  const agency = await getAgencyBranding(params.subCompanyId);
  const email = (agency?.emailFromAddress || env.EMAIL_FROM || '').trim();
  if (!email) {
    throw Object.assign(
      new Error(
        outbound.error ||
          'No From address configured for assignment email. Set agency email From or EMAIL_FROM.',
      ),
      { status: 502 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: params.sentByUserId },
    select: { firstName: true, lastName: true },
  });
  const sentByName =
    `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || 'Recruitment';

  console.warn(
    `[employeeAssignments] using agency From after outbound resolve failed: ${outbound.error}`,
  );

  return {
    from: {
      email,
      name: agency?.emailFromName || agency?.name || 'NA Staffing CRM',
    },
    agency,
    sentByName,
  };
}

export type AssignmentDetailsInput = {
  workLocation?: string | null;
  positionTitle?: string | null;
  payRate?: string | null;
  shiftSchedule?: string | null;
  expectedDuration?: string | null;
  supervisorInfo?: string | null;
  requiredPpe?: string | null;
  workplaceHazards?: string | null;
};

export type CreateEmployeeAssignmentInput = {
  employeeId: string;
  targetType: 'client' | 'job';
  clientId?: string | null;
  /** Recruitment Active Client id (preferred over marketing clientId). */
  activeClientId?: string | null;
  jobId?: string | null;
  /** Job targets only: request a backup-pool slot instead of a primary one. */
  isBackup?: boolean;
  /** When true, skip required-skills hard block (user confirmed mismatch). */
  allowSkillMismatch?: boolean;
} & AssignmentDetailsInput;

const CLIENT_REQUIRED_DETAILS: Array<[keyof AssignmentDetailsInput, string]> = [
  ['workLocation', 'Work location'],
  ['positionTitle', 'Position title'],
  ['payRate', 'Pay rate'],
  ['shiftSchedule', 'Shift schedule'],
  ['supervisorInfo', 'Supervisor information'],
  ['requiredPpe', 'Required PPE'],
];

function formatJobPay(salaryMin: unknown, salaryMax: unknown): string | null {
  if (salaryMin == null) return null;
  const min = Number(salaryMin);
  if (Number.isNaN(min)) return null;
  const max = salaryMax != null ? Number(salaryMax) : null;
  return `$${min}${max != null && !Number.isNaN(max) ? `–$${max}` : ''}/hr`;
}

function formatJobShift(shift: unknown): string | null {
  if (!shift || typeof shift !== 'object') return null;
  const s = shift as { startTime?: string; endTime?: string; workDays?: string[] };
  const days = (s.workDays ?? []).slice(0, 5).join(', ');
  if (!s.startTime || !s.endTime) return days || null;
  return `${s.startTime}–${s.endTime}${days ? ` · ${days}` : ''}`;
}

export type AssignmentEmailResult = {
  sent: boolean;
  warning?: string;
};

function trimOrNull(value?: string | null): string | null {
  const t = value?.trim();
  return t ? t : null;
}

/**
 * One employee may hold at most one active job/client placement.
 * Same `jobId` is allowed (caller handles idempotent re-add).
 * Use Move to Job / End placement for transfers — never silent multi-roster.
 */
export async function assertEmployeeNotActivelyPlacedElsewhere(
  employeeId: string,
  opts?: { jobId?: string | null; excludeAssignmentId?: string | null },
): Promise<void> {
  const allowJobId = opts?.jobId ?? null;
  const excludeAssignmentId = opts?.excludeAssignmentId ?? null;

  const otherRoster = await prisma.jobAssignment.findFirst({
    where: {
      employeeId,
      isActive: true,
      ...(allowJobId ? { jobId: { not: allowJobId } } : {}),
    },
    select: {
      job: { select: { title: true } },
    },
  });
  if (otherRoster) {
    const title = otherRoster.job?.title?.trim() || 'another job';
    throw Object.assign(
      new Error(
        `Employee is already placed on ${title}. End that placement or use Move to Job before assigning elsewhere.`,
      ),
      { status: 400 },
    );
  }

  const otherPlacement = await prisma.employeeAssignment.findFirst({
    where: {
      employeeId,
      status: 'approved',
      isActive: true,
      ...(excludeAssignmentId ? { id: { not: excludeAssignmentId } } : {}),
      ...(allowJobId
        ? {
            NOT: {
              AND: [{ targetType: 'job' as const }, { jobId: allowJobId }],
            },
          }
        : {}),
    },
    select: {
      targetType: true,
      job: { select: { title: true } },
      activeClient: { select: { name: true } },
      client: { select: { name: true } },
    },
  });
  if (otherPlacement) {
    const label =
      otherPlacement.job?.title?.trim() ||
      otherPlacement.activeClient?.name?.trim() ||
      otherPlacement.client?.name?.trim() ||
      (otherPlacement.targetType === 'job' ? 'another job' : 'a client');
    throw Object.assign(
      new Error(
        `Employee is already placed on ${label}. End that placement or use Move to Job before assigning elsewhere.`,
      ),
      { status: 400 },
    );
  }
}

function assertClientAssignmentDetails(
  input: AssignmentDetailsInput,
): asserts input is AssignmentDetailsInput & {
  workLocation: string;
  positionTitle: string;
  payRate: string;
  shiftSchedule: string;
  supervisorInfo: string;
  requiredPpe: string;
} {
  for (const [key, label] of CLIENT_REQUIRED_DETAILS) {
    if (!trimOrNull(input[key])) {
      throw Object.assign(new Error(`${label} is required for client assignment`), { status: 400 });
    }
  }
}

function serializeAssignment(
  row: Prisma.EmployeeAssignmentGetPayload<{
    include: {
      client: { select: { id: true; name: true } };
      activeClient: { select: { id: true; name: true } };
      job: { select: { id: true; title: true; company: true } };
      submittedBy: { select: { id: true; firstName: true; lastName: true } };
      approvedBy: { select: { id: true; firstName: true; lastName: true } };
      employee: { select: { addedBy: { select: { subCompanyId: true } } } };
    };
  }>,
) {
  const clientName = row.activeClient?.name ?? row.client?.name ?? null;
  const clientIdOut = row.activeClientId ?? row.clientId;
  return {
    id: row.id,
    employeeId: row.employeeId,
    targetType: row.targetType,
    clientId: clientIdOut,
    activeClientId: row.activeClientId,
    clientName,
    jobId: row.jobId,
    jobTitle: row.job?.title ?? null,
    jobCompany: row.job?.company ?? null,
    workLocation: row.workLocation,
    positionTitle: row.positionTitle,
    payRate: row.payRate,
    shiftSchedule: row.shiftSchedule,
    expectedDuration: row.expectedDuration,
    supervisorInfo: row.supervisorInfo,
    requiredPpe: row.requiredPpe,
    workplaceHazards: row.workplaceHazards,
    detailsSentToCandidateAt: row.detailsSentToCandidateAt?.toISOString() ?? null,
    trainingMessage: row.trainingMessage,
    trainingSentAt: row.trainingSentAt?.toISOString() ?? null,
    trainingChannel: row.trainingChannel,
    trainingCertificateDocumentId: row.trainingCertificateDocumentId,
    trainingCompletedAt: row.trainingCompletedAt?.toISOString() ?? null,
    status: row.endedAt ? 'ended' : row.status,
    isActive: row.isActive,
    isBackup: row.isBackup,
    endedAt: row.endedAt?.toISOString() ?? null,
    endReason: row.endReason,
    endNotes: row.endNotes,
    rating: row.rating,
    submittedById: row.submittedById,
    submittedByName: `${row.submittedBy.firstName} ${row.submittedBy.lastName}`.trim(),
    submittedAt: row.submittedAt.toISOString(),
    approvedById: row.approvedById,
    approvedByName: row.approvedBy
      ? `${row.approvedBy.firstName} ${row.approvedBy.lastName}`.trim()
      : null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason,
    currentStepIndex: row.currentStepIndex,
    approvalChain: row.approvalChain,
    subCompanyId: row.employee.addedBy.subCompanyId ?? null,
  };
}

const assignmentInclude = {
  client: { select: { id: true, name: true } },
  activeClient: { select: { id: true, name: true } },
  job: { select: { id: true, title: true, company: true } },
  submittedBy: { select: { id: true, firstName: true, lastName: true } },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
  employee: { select: { addedBy: { select: { subCompanyId: true } } } },
} as const;

export async function listEmployeeAssignments(employeeId: string, agencyIds: string[]) {
  const emp = await prisma.employee.findFirst({
    where: {
      id: employeeId,
      addedBy: {
        subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
      },
    },
    select: { id: true },
  });
  if (!emp) return null;

  const rows = await prisma.employeeAssignment.findMany({
    where: { employeeId },
    include: assignmentInclude,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(serializeAssignment);
}

export async function getActiveClientAssignment(employeeId: string) {
  return prisma.employeeAssignment.findFirst({
    where: {
      employeeId,
      status: 'approved',
      isActive: true,
      OR: [
        { targetType: 'client' },
        { activeClientId: { not: null } },
        { clientId: { not: null } },
      ],
    },
    include: {
      client: { select: { id: true, name: true } },
      activeClient: { select: { id: true, name: true } },
      job: { select: { id: true, activeClientId: true, company: true } },
    },
    orderBy: { approvedAt: 'desc' },
  });
}

export async function createEmployeeAssignment(params: {
  input: CreateEmployeeAssignmentInput;
  agencyIds: string[];
  subCompanyId: string;
  submitterUserId: string;
  submitterRoleKey: string;
  submitterPermissions: string[];
}) {
  const { input } = params;
  if (input.targetType === 'client' && !input.clientId && !input.activeClientId) {
    throw Object.assign(new Error('clientId or activeClientId is required for client assignment'), {
      status: 400,
    });
  }
  if (input.targetType === 'job' && !input.jobId) {
    throw Object.assign(new Error('jobId is required for job assignment'), { status: 400 });
  }

  if (input.targetType === 'client') {
    assertClientAssignmentDetails(input);
  }

  let details = {
    workLocation: trimOrNull(input.workLocation),
    positionTitle: trimOrNull(input.positionTitle),
    payRate: trimOrNull(input.payRate),
    shiftSchedule: trimOrNull(input.shiftSchedule),
    expectedDuration: trimOrNull(input.expectedDuration),
    supervisorInfo: trimOrNull(input.supervisorInfo),
    requiredPpe: trimOrNull(input.requiredPpe),
    workplaceHazards: trimOrNull(input.workplaceHazards),
  };

  const emp = await prisma.employee.findFirst({
    where: {
      id: input.employeeId,
      approvalStatus: 'approved',
      addedBy: {
        subCompanyId: params.agencyIds.length === 1 ? params.agencyIds[0] : { in: params.agencyIds },
      },
    },
    select: { id: true, firstName: true, lastName: true, email: true, skills: true },
  });
  if (!emp) {
    throw Object.assign(
      new Error('Employee must be approved before linking to a client or job'),
      { status: 400 },
    );
  }

  // One active placement per employee (same job is handled below).
  await assertEmployeeNotActivelyPlacedElsewhere(input.employeeId, {
    jobId: input.targetType === 'job' ? input.jobId : null,
  });

  if (input.targetType === 'job' && input.jobId) {
    const alreadyOnThisJob = await prisma.jobAssignment.findFirst({
      where: { jobId: input.jobId, employeeId: input.employeeId, isActive: true },
      select: { id: true },
    });
    if (alreadyOnThisJob) {
      throw Object.assign(new Error('Employee is already on this job roster'), { status: 400 });
    }
  }

  let clientName: string | null = null;
  let resolvedActiveClientId: string | null = input.activeClientId ?? null;
  let resolvedClientId: string | null = input.clientId ?? null;

  if (input.targetType === 'client') {
    if (resolvedActiveClientId) {
      const ac = await prisma.activeClient.findFirst({
        where: {
          id: resolvedActiveClientId,
          subCompanyId: params.subCompanyId,
        },
        select: { id: true, name: true },
      });
      if (!ac) throw Object.assign(new Error('Active client not found'), { status: 404 });
      clientName = ac.name;
      resolvedActiveClientId = ac.id;
      resolvedClientId = null;
    } else if (resolvedClientId) {
      const client = await prisma.client.findUnique({
        where: { id: resolvedClientId },
        select: { id: true, name: true },
      });
      if (!client) throw Object.assign(new Error('Client not found'), { status: 404 });
      clientName = client.name;
    }

    if (!emp.email?.trim()) {
      throw Object.assign(
        new Error('Candidate email is required to send assignment details before activation'),
        { status: 400 },
      );
    }
  }
  if (input.targetType === 'job' && input.jobId) {
    const job = await prisma.job.findUnique({
      where: { id: input.jobId },
      select: {
        id: true,
        title: true,
        company: true,
        location: true,
        salaryMin: true,
        salaryMax: true,
        shiftSchedule: true,
        activeClientId: true,
        status: true,
        licenseRequired: true,
        requiredLicenseTypes: true,
        screeningCriteria: true,
        activeClient: { select: { id: true, name: true } },
      },
    });
    if (!job) throw Object.assign(new Error('Job not found'), { status: 404 });
    if (job.status === 'closed' || job.status === 'filled') {
      throw Object.assign(new Error(`Cannot request assignment to a ${job.status} job`), {
        status: 400,
      });
    }
    if (!input.allowSkillMismatch) {
      assertEmployeeMeetsJobSkills(
        emp.skills,
        (job.screeningCriteria as ScreeningCriteriaInput | null) ?? null,
      );
    }
    await assertEmployeeMeetsJobLicenses(input.employeeId, job);
    if (job.activeClientId) resolvedActiveClientId = job.activeClientId;
    clientName = job.activeClient?.name?.trim() || job.company || null;
    // Prefer staff-entered details; fill gaps from the job so the email always has core fields.
    details = {
      workLocation: details.workLocation || trimOrNull(job.location),
      positionTitle: details.positionTitle || trimOrNull(job.title),
      payRate: details.payRate || formatJobPay(job.salaryMin, job.salaryMax),
      shiftSchedule: details.shiftSchedule || formatJobShift(job.shiftSchedule),
      expectedDuration: details.expectedDuration,
      supervisorInfo: details.supervisorInfo,
      requiredPpe: details.requiredPpe,
      workplaceHazards: details.workplaceHazards,
    };
  }

  const pendingExists = await prisma.employeeAssignment.findFirst({
    where: {
      employeeId: input.employeeId,
      targetType: input.targetType,
      status: 'pending',
      ...(input.targetType === 'client'
        ? resolvedActiveClientId
          ? { activeClientId: resolvedActiveClientId }
          : { clientId: resolvedClientId! }
        : { jobId: input.jobId! }),
    },
    select: { id: true },
  });
  if (pendingExists) {
    throw Object.assign(new Error('A pending assignment for this target already exists'), {
      status: 400,
    });
  }

  let detailsSentToCandidateAt: Date | null = null;
  let assignmentEmail: AssignmentEmailResult | undefined;
  const asBackup = input.targetType === 'job' && Boolean(input.isBackup);

  // Backup-pool placements: no candidate emails (assignment details or client training).
  const canSendDetails =
    !asBackup &&
    Boolean(emp.email?.trim()) &&
    Boolean(clientName?.trim()) &&
    Boolean(details.workLocation || details.positionTitle);

  if (canSendDetails && clientName) {
    try {
      const outbound = await resolveAssignmentOutbound({
        sentByUserId: params.submitterUserId,
        subCompanyId: params.subCompanyId,
      });
      const sendResult = await sendEmployeeAssignmentDetailsEmail({
        toEmail: emp.email!.trim(),
        candidateName: `${emp.firstName} ${emp.lastName}`.trim(),
        clientName,
        workLocation: details.workLocation ?? '',
        positionTitle: details.positionTitle ?? '',
        payRate: details.payRate ?? '',
        shiftSchedule: details.shiftSchedule ?? '',
        expectedDuration: details.expectedDuration,
        supervisorInfo: details.supervisorInfo,
        requiredPpe: details.requiredPpe,
        workplaceHazards: details.workplaceHazards,
        sentByName: outbound.sentByName,
        agency: outbound.agency,
        from: outbound.from,
      });
      if (sendResult.delivered) {
        detailsSentToCandidateAt = new Date();
        assignmentEmail = { sent: true };
      } else {
        // SendGrid not configured — keep client activation unblocked in non-prod.
        if (input.targetType === 'client') {
          detailsSentToCandidateAt = new Date();
        }
        assignmentEmail = {
          sent: false,
          warning:
            'Email service is not configured (missing SENDGRID_API_KEY). Assignment details were not emailed.',
        };
      }
    } catch (err) {
      console.error('[employeeAssignments] failed to send details to candidate', err);
      const detail = formatTrainingSendError(err).replace(/^Failed to send training email\.?\s*/i, '');
      if (input.targetType === 'client' && process.env.NODE_ENV === 'production') {
        throw Object.assign(
          new Error(
            detail ||
              'Failed to send assignment details to the candidate. Try again before activating.',
          ),
          { status: 502 },
        );
      }
      console.warn(
        '[employeeAssignments] continuing without candidate email; placement will proceed when allowed',
      );
      if (input.targetType === 'client') {
        // Stamp so RM can approve in local/dev when outbound mail is broken.
        detailsSentToCandidateAt = new Date();
      }
      assignmentEmail = {
        sent: false,
        warning: detail
          ? `Assignment details email could not be sent: ${detail}`
          : 'Assignment details email could not be sent',
      };
    }
  } else if (!asBackup && input.targetType === 'job' && !emp.email?.trim()) {
    assignmentEmail = {
      sent: false,
      warning: 'No email on file — assignment details not sent to the employee',
    };
  } else if (!asBackup && canSendDetails === false && input.targetType === 'job' && emp.email?.trim()) {
    assignmentEmail = {
      sent: false,
      warning: 'Missing client or assignment details — email not sent',
    };
  }

  const row = await prisma.employeeAssignment.create({
    data: {
      employeeId: input.employeeId,
      targetType: input.targetType,
      clientId: input.targetType === 'client' ? resolvedClientId : null,
      activeClientId: resolvedActiveClientId,
      jobId: input.targetType === 'job' ? input.jobId! : null,
      isBackup: input.targetType === 'job' ? Boolean(input.isBackup) : false,
      ...details,
      detailsSentToCandidateAt,
      status: 'pending',
      isActive: false,
      submittedById: params.submitterUserId,
      submitterRole: params.submitterRoleKey,
    },
    include: assignmentInclude,
  });

  // Job assignments skip manager approval — activate immediately.
  if (input.targetType === 'job') {
    const finalized = await finalizeEmployeeAssignmentApproval(
      row.id,
      params.agencyIds,
      params.submitterUserId,
    );
    if (!finalized.ok) {
      await prisma.employeeAssignment.delete({ where: { id: row.id } });
      throw Object.assign(new Error(finalized.error), { status: finalized.status });
    }
    const refreshed = await prisma.employeeAssignment.findUniqueOrThrow({
      where: { id: row.id },
      include: assignmentInclude,
    });
    // Isolated side effect — never fails the job link.
    // Skip client-training / PandaDoc for backup-pool adds; primary + job link still send.
    const clientTraining = asBackup
      ? { started: false, emailSent: false }
      : await maybeStartActiveClientTrainingAfterJobLink({
          assignmentId: refreshed.id,
          employeeId: refreshed.employeeId,
          activeClientId: refreshed.activeClientId,
          sentByUserId: params.submitterUserId,
        });
    return {
      assignment: serializeAssignment(refreshed),
      autoApproved: true,
      targetRoleKey: null as string | null,
      clientTraining,
      assignmentEmail,
    };
  }

  const result = await submitEntityForApproval({
    workflow: 'employee_assignment',
    entityId: row.id,
    subCompanyId: params.subCompanyId,
    submitterUserId: params.submitterUserId,
    submitterRoleKey: params.submitterRoleKey,
    submitterPermissions: params.submitterPermissions,
  });

  if (result.misconfigured) {
    await prisma.employeeAssignment.delete({ where: { id: row.id } });
    throw Object.assign(new Error('Approval route is misconfigured for this agency'), {
      status: 400,
    });
  }

  const refreshed = await prisma.employeeAssignment.findUniqueOrThrow({
    where: { id: row.id },
    include: assignmentInclude,
  });

  if (!result.autoApproved) {
    void notifyAssignmentRequestSubmitted({
      assignmentId: row.id,
      subCompanyId: params.subCompanyId,
      targetRoleKey: result.targetRoleKey,
    });
  }

  return {
    assignment: serializeAssignment(refreshed),
    autoApproved: result.autoApproved,
    targetRoleKey: result.targetRoleKey,
    assignmentEmail,
  };
}

export async function finalizeEmployeeAssignmentApproval(
  assignmentId: string,
  agencyIds: string[],
  approverId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const row = await prisma.employeeAssignment.findFirst({
    where: {
      id: assignmentId,
      status: 'pending',
      employee: {
        addedBy: {
          subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
        },
      },
    },
  });
  if (!row) return { ok: false, error: 'Not found', status: 404 };

  if (row.targetType === 'client') {
    for (const [key, label] of CLIENT_REQUIRED_DETAILS) {
      if (!trimOrNull(row[key])) {
        return {
          ok: false,
          error: `${label} is required before activating a client assignment`,
          status: 400,
        };
      }
    }
    if (!row.detailsSentToCandidateAt) {
      return {
        ok: false,
        error: 'Assignment details must be sent to the candidate before activation',
        status: 400,
      };
    }
  }

  let jobNotifyRef: {
    id: string;
    title: string;
    company: string;
    createdById: string;
    subCompanyId: string | null;
  } | null = null;

  if (row.targetType === 'job' && row.jobId) {
    try {
      await assertEmployeeNotActivelyPlacedElsewhere(row.employeeId, {
        jobId: row.jobId,
        excludeAssignmentId: row.id,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Employee is already placed elsewhere';
      const status =
        err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number'
          ? (err as { status: number }).status
          : 400;
      return { ok: false, error: message, status };
    }

    const job = await prisma.job.findUnique({
      where: { id: row.jobId },
      select: {
        id: true,
        title: true,
        company: true,
        createdById: true,
        subCompanyId: true,
        status: true,
        openPositions: true,
        backupPercentage: true,
      },
    });
    if (!job || job.status !== 'open') {
      return { ok: false, error: 'Job is closed', status: 400 };
    }
    jobNotifyRef = job;
    const capacity = Math.ceil(job.openPositions * (1 + job.backupPercentage / 100));
    const [activeCount, alreadyOnRoster] = await Promise.all([
      prisma.jobAssignment.count({ where: { jobId: row.jobId, isActive: true } }),
      prisma.jobAssignment.findFirst({
        where: { jobId: row.jobId, employeeId: row.employeeId, isActive: true },
        select: { id: true },
      }),
    ]);
    if (!alreadyOnRoster && activeCount >= capacity) {
      return {
        ok: false,
        error: `Job roster is at capacity (${capacity} including backup)`,
        status: 400,
      };
    }
  }

  if (row.targetType === 'client') {
    try {
      await assertEmployeeNotActivelyPlacedElsewhere(row.employeeId, {
        excludeAssignmentId: row.id,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Employee is already placed elsewhere';
      const status =
        err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number'
          ? (err as { status: number }).status
          : 400;
      return { ok: false, error: message, status };
    }
  }

  await prisma.$transaction(async (tx) => {
    if (row.targetType === 'client' && (row.clientId || row.activeClientId)) {
      await tx.employeeAssignment.updateMany({
        where: {
          employeeId: row.employeeId,
          targetType: 'client',
          isActive: true,
          id: { not: row.id },
        },
        data: { isActive: false },
      });
    }

    let activeClientId = row.activeClientId;
    if (row.targetType === 'job' && row.jobId && !activeClientId) {
      const job = await tx.job.findUnique({
        where: { id: row.jobId },
        select: { activeClientId: true },
      });
      activeClientId = job?.activeClientId ?? null;
    }

    await tx.employeeAssignment.update({
      where: { id: row.id },
      data: {
        status: 'approved',
        isActive: true,
        activeClientId,
        approvedById: approverId,
        approvedAt: new Date(),
        rejectedById: null,
        rejectedAt: null,
        rejectionReason: null,
      },
    });

    if (row.targetType === 'job' && row.jobId) {
      const existing = await tx.jobAssignment.findFirst({
        where: { jobId: row.jobId, employeeId: row.employeeId, isActive: true },
        select: { id: true },
      });
      if (!existing) {
        await tx.jobAssignment.create({
          data: {
            jobId: row.jobId,
            employeeId: row.employeeId,
            isBackup: row.isBackup,
            isActive: true,
            assignedById: approverId,
          },
        });
      }
      const roster = await tx.jobAssignment.findMany({
        where: { jobId: row.jobId, isActive: true },
        select: { isBackup: true },
      });
      await tx.job.update({
        where: { id: row.jobId },
        data: {
          filledPositions: roster.filter((r) => !r.isBackup).length,
          scheduledPositions: roster.filter((r) => r.isBackup).length,
        },
      });
    }

    await tx.employee.update({
      where: { id: row.employeeId },
      data: {
        workStatus: row.targetType === 'job' && row.isBackup ? 'scheduled' : 'active',
      },
    });
  });

  if (jobNotifyRef) {
    void notifyPlacementAdded({
      job: jobNotifyRef,
      employeeId: row.employeeId,
      actorUserId: approverId,
      isBackup: row.isBackup,
    });
  }

  return { ok: true };
}

export async function finalizeEmployeeAssignmentRejection(
  assignmentId: string,
  agencyIds: string[],
  rejecterId: string,
  reason?: string | null,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const row = await prisma.employeeAssignment.findFirst({
    where: {
      id: assignmentId,
      status: 'pending',
      employee: {
        addedBy: {
          subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
        },
      },
    },
    select: { id: true },
  });
  if (!row) return { ok: false, error: 'Not found', status: 404 };

  await prisma.employeeAssignment.update({
    where: { id: assignmentId },
    data: {
      status: 'rejected',
      isActive: false,
      rejectedById: rejecterId,
      rejectedAt: new Date(),
      rejectionReason: reason?.trim() || null,
    },
  });
  return { ok: true };
}

/** Pending job-target requests for a job (shown in the job's Manage Employees dialog). */
export async function listJobAssignmentRequests(jobId: string, agencyIds: string[]) {
  const rows = await prisma.employeeAssignment.findMany({
    where: {
      jobId,
      targetType: 'job',
      status: 'pending',
      employee: {
        addedBy: {
          subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
        },
      },
    },
    select: {
      id: true,
      employeeId: true,
      isBackup: true,
      submittedAt: true,
      submittedBy: { select: { firstName: true, lastName: true } },
      employee: { select: { firstName: true, lastName: true } },
    },
    orderBy: { submittedAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: `${r.employee.firstName} ${r.employee.lastName}`.trim(),
    isBackup: r.isBackup,
    submittedAt: r.submittedAt.toISOString(),
    submittedByName: `${r.submittedBy.firstName} ${r.submittedBy.lastName}`.trim(),
  }));
}

/** Reload a single assignment for API responses (e.g. training checklist updates). */
export async function getSerializedEmployeeAssignment(assignmentId: string) {
  const row = await prisma.employeeAssignment.findUnique({
    where: { id: assignmentId },
    include: assignmentInclude,
  });
  if (!row) return null;
  return serializeAssignment(row);
}
