/**
 * Recruitment Jobs CRUD — agency-scoped.
 */
import type { EmploymentType, JobStatus, JobType, Prisma } from '@prisma/client';
import { Prisma as PrismaNS } from '@prisma/client';
import prisma from '../config/database';
import {
  notifyAssignmentRequestsAutoRejected,
  notifyJobStatusChanged,
} from './jobFlowNotifications';

export type ScreeningCriteriaInput = {
  requiredSkills?: string[];
  preferredSkills?: string[];
  minExperienceYears?: number;
  educationLevel?: string;
  certifications?: string[];
  salaryMin?: number;
  salaryMax?: number;
  location?: string;
  remoteOption?: 'onsite' | 'remote' | 'hybrid';
};

export type ShiftScheduleInput = {
  startTime?: string;
  endTime?: string;
  workDays?: string[];
  jobStartDate?: string | null;
  jobEndDate?: string | null;
};

export type CreateJobInput = {
  templateId?: string | null;
  jobType: 'internal' | 'external';
  title: string;
  company?: string;
  activeClientId: string;
  location: string;
  department?: string | null;
  description: string;
  requirements: string;
  responsibilities: string;
  openPositions?: number;
  backupPercentage?: number;
  status?: JobStatus;
  employmentType: 'full_time' | 'part_time' | 'contract' | 'temporary';
  salaryMin?: number | null;
  salaryMax?: number | null;
  publishLinkedin?: boolean;
  publishIndeed?: boolean;
  publishGlassdoor?: boolean;
  licenseRequired?: boolean;
  requiredLicenseTypes?: string[];
  screeningCriteria?: ScreeningCriteriaInput | null;
  shiftSchedule?: ShiftScheduleInput | null;
};

const assignmentInclude = {
  employee: { select: { id: true, firstName: true, lastName: true } },
} as const;

const jobInclude = {
  activeClient: { select: { id: true, name: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  assignments: {
    where: { isActive: true },
    include: assignmentInclude,
    orderBy: { assignedAt: 'asc' as const },
  },
} as const;

/** Next 6-digit sequential job code (000001, 000002, …) via DB sequence. */
async function nextJobCode(): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ nextval: bigint | number | string }>>`
    SELECT nextval('jobs_job_code_seq') AS nextval
  `;
  const n = Number(rows[0]?.nextval);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error('Failed to allocate job code sequence');
  }
  return String(n).padStart(6, '0');
}

function mapEmploymentType(v: string): EmploymentType {
  if (v === 'full-time' || v === 'full_time') return 'full_time';
  if (v === 'part-time' || v === 'part_time') return 'part_time';
  if (v === 'contract') return 'contract';
  return 'temporary';
}

function serializeJob(
  row: Prisma.JobGetPayload<{ include: typeof jobInclude }>,
) {
  const createdByName = `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim();
  const filled = row.assignments.filter((a) => !a.isBackup).length;
  const scheduled = row.assignments.filter((a) => a.isBackup).length;
  return {
    id: row.id,
    jobCode: row.jobCode,
    templateId: row.templateId,
    jobType: row.jobType as JobType,
    title: row.title,
    company: row.company,
    clientId: row.activeClientId,
    activeClientId: row.activeClientId,
    activeClientName: row.activeClient?.name ?? row.company,
    agencyId: row.subCompanyId,
    location: row.location,
    department: row.department,
    description: row.description,
    requirements: row.requirements,
    responsibilities: row.responsibilities,
    openPositions: row.openPositions,
    filledPositions: filled,
    scheduledPositions: scheduled,
    backupPercentage: row.backupPercentage,
    status: row.status,
    employmentType: row.employmentType,
    salaryMin: row.salaryMin != null ? Number(row.salaryMin) : null,
    salaryMax: row.salaryMax != null ? Number(row.salaryMax) : null,
    publishSettings: {
      linkedin: row.publishLinkedin,
      indeed: row.publishIndeed,
      glassdoor: row.publishGlassdoor,
      publishedAt: row.publishedAt?.toISOString() ?? null,
    },
    licenseRequired: row.licenseRequired,
    requiredLicenseTypes: row.requiredLicenseTypes,
    screeningCriteria: (row.screeningCriteria as ScreeningCriteriaInput | null) ?? null,
    shiftSchedule: (row.shiftSchedule as ShiftScheduleInput | null) ?? null,
    createdById: row.createdById,
    createdByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    applicantCount: row.applicantCount,
    assignments: row.assignments.map((a) => ({
      id: a.id,
      jobId: a.jobId,
      employeeId: a.employeeId,
      employeeName: `${a.employee.firstName} ${a.employee.lastName}`.trim(),
      isBackup: a.isBackup,
      isActive: a.isActive,
      assignedAt: a.assignedAt.toISOString(),
      assignedBy: a.assignedById,
    })),
  };
}

function agencyJobWhere(agencyIds: string[]): Prisma.JobWhereInput {
  return {
    OR: [
      { subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds } },
      // Legacy rows without agency: visible only when createdBy is in scope
      {
        subCompanyId: null,
        createdBy: {
          subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
        },
      },
    ],
  };
}

export async function listJobs(params: {
  agencyIds: string[];
  /** Optional owner ("my records") filter fragment on createdById; null = no narrowing. */
  ownerWhere?: Record<string, unknown> | null;
  search?: string;
  status?: JobStatus | JobStatus[];
  jobType?: JobType;
  employmentType?: EmploymentType;
  location?: string;
  department?: string;
  activeClientId?: string;
  publishLinkedin?: boolean;
  publishIndeed?: boolean;
  publishGlassdoor?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 50));
  const and: Prisma.JobWhereInput[] = [agencyJobWhere(params.agencyIds)];
  if (params.ownerWhere) and.push(params.ownerWhere as Prisma.JobWhereInput);

  if (params.status) {
    and.push({
      status: Array.isArray(params.status) ? { in: params.status } : params.status,
    });
  }
  if (params.jobType) and.push({ jobType: params.jobType });
  if (params.employmentType) and.push({ employmentType: params.employmentType });
  if (params.location) and.push({ location: { contains: params.location, mode: 'insensitive' } });
  if (params.department) and.push({ department: { contains: params.department, mode: 'insensitive' } });
  if (params.activeClientId) and.push({ activeClientId: params.activeClientId });
  if (params.publishLinkedin) and.push({ publishLinkedin: true });
  if (params.publishIndeed) and.push({ publishIndeed: true });
  if (params.publishGlassdoor) and.push({ publishGlassdoor: true });
  if (params.search?.trim()) {
    const q = params.search.trim();
    and.push({
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { jobCode: { contains: q, mode: 'insensitive' } },
        { company: { contains: q, mode: 'insensitive' } },
        { location: { contains: q, mode: 'insensitive' } },
        { department: { contains: q, mode: 'insensitive' } },
      ],
    });
  }

  const where: Prisma.JobWhereInput = { AND: and };
  const [total, rows] = await Promise.all([
    prisma.job.count({ where }),
    prisma.job.findMany({
      where,
      include: jobInclude,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    data: rows.map(serializeJob),
    total,
    page,
    pageSize,
  };
}

export async function getJobById(id: string, agencyIds: string[]) {
  const row = await prisma.job.findFirst({
    where: { id, AND: [agencyJobWhere(agencyIds)] },
    include: jobInclude,
  });
  return row ? serializeJob(row) : null;
}

export async function createJob(params: {
  input: CreateJobInput;
  subCompanyId: string;
  createdById: string;
}) {
  const client = await prisma.activeClient.findFirst({
    where: { id: params.input.activeClientId, subCompanyId: params.subCompanyId },
    select: { id: true, name: true },
  });
  if (!client) {
    throw Object.assign(new Error('Active client not found in this agency'), { status: 404 });
  }

  const anyPublish =
    params.input.publishLinkedin || params.input.publishIndeed || params.input.publishGlassdoor;

  const data = {
      templateId: params.input.templateId ?? null,
      jobType: params.input.jobType,
      title: params.input.title.trim(),
      company: (params.input.company?.trim() || client.name).trim(),
      location: params.input.location.trim(),
      department: params.input.department?.trim() || null,
      description: params.input.description,
      requirements: params.input.requirements,
      responsibilities: params.input.responsibilities,
      openPositions: params.input.openPositions ?? 1,
      backupPercentage: params.input.backupPercentage ?? 70,
      status: params.input.status ?? 'open',
      employmentType: mapEmploymentType(params.input.employmentType),
      salaryMin: params.input.salaryMin ?? null,
      salaryMax: params.input.salaryMax ?? null,
      publishLinkedin: params.input.publishLinkedin ?? false,
      publishIndeed: params.input.publishIndeed ?? false,
      publishGlassdoor: params.input.publishGlassdoor ?? false,
      publishedAt: anyPublish ? new Date() : null,
      licenseRequired: params.input.licenseRequired ?? false,
      requiredLicenseTypes: params.input.licenseRequired
        ? params.input.requiredLicenseTypes ?? []
        : [],
      screeningCriteria: params.input.screeningCriteria ?? undefined,
      shiftSchedule: params.input.shiftSchedule ?? undefined,
      subCompanyId: params.subCompanyId,
      activeClientId: client.id,
      createdById: params.createdById,
  };

  const jobCode = await nextJobCode();
  const row = await prisma.job.create({
    data: { ...data, jobCode },
    include: jobInclude,
  });
  return serializeJob(row);
}

export async function updateJob(
  id: string,
  agencyIds: string[],
  input: Partial<CreateJobInput>,
) {
  const existing = await prisma.job.findFirst({
    where: { id, AND: [agencyJobWhere(agencyIds)] },
    select: { id: true, subCompanyId: true },
  });
  if (!existing) return null;

  const data: Prisma.JobUpdateInput = {};
  if (input.templateId !== undefined) data.templateId = input.templateId;
  if (input.jobType !== undefined) data.jobType = input.jobType;
  if (input.title !== undefined) data.title = input.title.trim();
  if (input.location !== undefined) data.location = input.location.trim();
  if (input.department !== undefined) data.department = input.department?.trim() || null;
  if (input.description !== undefined) data.description = input.description;
  if (input.requirements !== undefined) data.requirements = input.requirements;
  if (input.responsibilities !== undefined) data.responsibilities = input.responsibilities;
  if (input.openPositions !== undefined) data.openPositions = input.openPositions;
  if (input.backupPercentage !== undefined) data.backupPercentage = input.backupPercentage;
  if (input.employmentType !== undefined) data.employmentType = mapEmploymentType(input.employmentType);
  if (input.salaryMin !== undefined) data.salaryMin = input.salaryMin;
  if (input.salaryMax !== undefined) data.salaryMax = input.salaryMax;
  if (input.publishLinkedin !== undefined) data.publishLinkedin = input.publishLinkedin;
  if (input.publishIndeed !== undefined) data.publishIndeed = input.publishIndeed;
  if (input.publishGlassdoor !== undefined) data.publishGlassdoor = input.publishGlassdoor;
  if (input.licenseRequired !== undefined) {
    data.licenseRequired = input.licenseRequired;
    if (!input.licenseRequired) data.requiredLicenseTypes = [];
  }
  if (input.requiredLicenseTypes !== undefined && input.licenseRequired !== false) {
    data.requiredLicenseTypes = input.requiredLicenseTypes;
  }
  if (input.screeningCriteria !== undefined) data.screeningCriteria = input.screeningCriteria ?? PrismaNS.JsonNull;
  if (input.shiftSchedule !== undefined) data.shiftSchedule = input.shiftSchedule ?? PrismaNS.JsonNull;

  if (input.activeClientId) {
    const client = await prisma.activeClient.findFirst({
      where: {
        id: input.activeClientId,
        subCompanyId:
          existing.subCompanyId ??
          (agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds }),
      },
      select: { id: true, name: true },
    });
    if (!client) {
      throw Object.assign(new Error('Active client not found'), { status: 404 });
    }
    data.activeClient = { connect: { id: client.id } };
    data.company = input.company?.trim() || client.name;
  } else if (input.company !== undefined) {
    data.company = input.company.trim();
  }

  const row = await prisma.job.update({
    where: { id },
    data,
    include: jobInclude,
  });
  return serializeJob(row);
}

export async function updateJobStatus(
  id: string,
  agencyIds: string[],
  status: JobStatus,
  opts?: { allowWithRoster?: boolean; actorUserId?: string },
) {
  const existing = await prisma.job.findFirst({
    where: { id, AND: [agencyJobWhere(agencyIds)] },
    include: {
      assignments: { where: { isActive: true }, select: { id: true } },
    },
  });
  if (!existing) return null;

  if (
    !opts?.allowWithRoster &&
    (status === 'closed' || status === 'filled') &&
    existing.assignments.length > 0
  ) {
    throw Object.assign(
      new Error('End all placements before closing or marking this job filled'),
      { status: 409 },
    );
  }

  const closing = status === 'closed' || status === 'filled';

  // Snapshot pending requests before they are auto-rejected, for notifications.
  const pendingRequests = closing
    ? await prisma.employeeAssignment.findMany({
        where: { jobId: id, status: 'pending' },
        select: {
          id: true,
          submittedById: true,
          employee: { select: { firstName: true, lastName: true } },
        },
      })
    : [];

  const row = await prisma.$transaction(async (tx) => {
    if (closing) {
      // Pending requests against this job are now moot — reject them.
      await tx.employeeAssignment.updateMany({
        where: { jobId: id, status: 'pending' },
        data: {
          status: 'rejected',
          isActive: false,
          rejectedAt: new Date(),
          rejectionReason: 'Job was closed',
        },
      });
    }
    return tx.job.update({
      where: { id },
      data: {
        status,
        closedAt: closing ? new Date() : null,
      },
      include: jobInclude,
    });
  });

  if (opts?.actorUserId) {
    if (pendingRequests.length > 0) {
      void notifyAssignmentRequestsAutoRejected({
        subCompanyId: existing.subCompanyId ?? agencyIds[0],
        jobTitle: existing.title,
        requests: pendingRequests.map((r) => ({
          id: r.id,
          submittedById: r.submittedById,
          employeeName: `${r.employee.firstName} ${r.employee.lastName}`.trim(),
        })),
      });
    }
    const reopening =
      status === 'open' && (existing.status === 'closed' || existing.status === 'filled');
    if (closing || reopening) {
      void notifyJobStatusChanged({
        job: existing,
        status: closing ? status as 'closed' | 'filled' : 'open',
        actorUserId: opts.actorUserId,
      });
    }
  }

  return serializeJob(row);
}

export async function deleteJob(id: string, agencyIds: string[]) {
  const existing = await prisma.job.findFirst({
    where: { id, AND: [agencyJobWhere(agencyIds)] },
    include: { assignments: { where: { isActive: true }, select: { id: true } } },
  });
  if (!existing) return { ok: false as const, error: 'Not found', status: 404 };
  if (existing.assignments.length > 0) {
    return {
      ok: false as const,
      error: 'Cannot delete job with active placements. End placements first.',
      status: 409,
    };
  }
  await prisma.job.delete({ where: { id } });
  return { ok: true as const };
}

/** Re-export for placements service */
export { agencyJobWhere, jobInclude, serializeJob, mapEmploymentType };
