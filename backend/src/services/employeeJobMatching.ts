/**
 * Employee ↔ job matching.
 * TEMP: skill (and list-time license) match is off — flows list available people/jobs only.
 * Skill assert is also a no-op; re-enable in employeeMeetsJobMatch / assertEmployeeMeetsJobSkills.
 */
import type { JobStatus, Prisma } from '@prisma/client';
import prisma from '../config/database';
import {
  employeeHasValidLicensesForJob,
  loadEmployeeLicenseDocs,
  type JobLicenseFields,
  type LicenseDocFields,
} from './jobLicenseChecks';
import { agencyJobWhere } from './jobs';
import type { ScreeningCriteriaInput } from './jobs';

export type MatchJobFields = JobLicenseFields & {
  id: string;
  title: string;
  status: JobStatus;
  location: string;
  company: string;
  activeClientId: string;
  screeningCriteria: ScreeningCriteriaInput | null;
  requiredLicenseTypes: string[];
  licenseRequired: boolean;
  openPositions: number;
  activeClient?: { id: string; name: string } | null;
};

function normalizeSkill(s: string): string {
  return s.trim().toLowerCase();
}

/** Employee must have every required skill (case-insensitive). Empty required → pass. */
export function employeeHasAllRequiredSkills(
  employeeSkills: string[] | null | undefined,
  requiredSkills: string[] | null | undefined,
): boolean {
  const required = (requiredSkills ?? []).map(normalizeSkill).filter(Boolean);
  if (required.length === 0) return true;
  const have = new Set((employeeSkills ?? []).map(normalizeSkill).filter(Boolean));
  return required.every((s) => have.has(s));
}

export function requiredSkillsFromJob(
  screeningCriteria: ScreeningCriteriaInput | null | undefined,
): string[] {
  return (screeningCriteria?.requiredSkills ?? []).filter((s) => s.trim());
}

export function employeeMeetsJobMatch(params: {
  employeeSkills: string[] | null | undefined;
  job: {
    screeningCriteria?: ScreeningCriteriaInput | null;
    licenseRequired: boolean;
    requiredLicenseTypes: string[];
  };
  licenseDocs: LicenseDocFields[];
}): boolean {
  // TEMP: skill match disabled — list all available employees/jobs (not skill-gated).
  // const required = requiredSkillsFromJob(params.job.screeningCriteria);
  // if (!employeeHasAllRequiredSkills(params.employeeSkills, required)) return false;
  void params.employeeSkills;
  void params.job.screeningCriteria;
  // Licenses still enforced at assign time when licenseRequired; listing stays open.
  void params.licenseDocs;
  void params.job.licenseRequired;
  void params.job.requiredLicenseTypes;
  return true;
  // return employeeHasValidLicensesForJob(params.licenseDocs, params.job);
}

/** Throws 400 when employee lacks any required skill for the job. */
export function assertEmployeeMeetsJobSkills(
  employeeSkills: string[] | null | undefined,
  screeningCriteria: ScreeningCriteriaInput | null | undefined,
): void {
  // TEMP: skill match disabled for link / place flows.
  void employeeSkills;
  void screeningCriteria;
  return;
  /*
  const required = requiredSkillsFromJob(screeningCriteria);
  if (employeeHasAllRequiredSkills(employeeSkills, required)) return;
  const missing = required.filter((s) => {
    const have = new Set((employeeSkills ?? []).map(normalizeSkill));
    return !have.has(normalizeSkill(s));
  });
  throw Object.assign(
    new Error(
      missing.length
        ? `Employee is missing required skill(s): ${missing.join(', ')}`
        : 'Employee does not meet required skills for this job',
    ),
    { status: 400 },
  );
  */
}

function serializeMatchJob(row: {
  id: string;
  jobCode: string | null;
  title: string;
  status: JobStatus;
  location: string;
  company: string;
  activeClientId: string | null;
  openPositions: number;
  licenseRequired: boolean;
  requiredLicenseTypes: string[];
  screeningCriteria: Prisma.JsonValue | null;
  activeClient: {
    id: string;
    name: string;
    clientTraining?: boolean;
    trainingFileKey?: string | null;
    trainingFileName?: string | null;
  } | null;
}) {
  const screening = (row.screeningCriteria as ScreeningCriteriaInput | null) ?? null;
  const activeClientId = row.activeClientId ?? row.activeClient?.id ?? '';
  return {
    id: row.id,
    jobCode: row.jobCode,
    title: row.title,
    status: row.status,
    location: row.location,
    company: row.company,
    activeClientId,
    activeClientName: row.activeClient?.name ?? row.company,
    activeClient: row.activeClient
      ? {
          id: row.activeClient.id,
          name: row.activeClient.name,
          clientTraining: Boolean(row.activeClient.clientTraining),
          hasTrainingDocument: Boolean(row.activeClient.trainingFileKey),
          trainingFileName: row.activeClient.trainingFileName ?? null,
        }
      : activeClientId
        ? { id: activeClientId, name: row.company }
        : null,
    openPositions: row.openPositions,
    licenseRequired: row.licenseRequired,
    requiredLicenseTypes: row.requiredLicenseTypes,
    screeningCriteria: screening,
    requiredSkills: requiredSkillsFromJob(screening),
  };
}

const jobMatchSelect = {
  id: true,
  jobCode: true,
  title: true,
  status: true,
  location: true,
  company: true,
  activeClientId: true,
  openPositions: true,
  licenseRequired: true,
  requiredLicenseTypes: true,
  screeningCriteria: true,
  activeClient: {
    select: {
      id: true,
      name: true,
      clientTraining: true,
      trainingFileKey: true,
      trainingFileName: true,
    },
  },
} as const;

export async function listMatchingJobsForEmployee(params: {
  employeeId: string;
  agencyIds: string[];
  activeClientId?: string;
  statuses?: JobStatus[];
}) {
  const emp = await prisma.employee.findFirst({
    where: {
      id: params.employeeId,
      addedBy: {
        subCompanyId:
          params.agencyIds.length === 1 ? params.agencyIds[0] : { in: params.agencyIds },
      },
    },
    select: { id: true, skills: true },
  });
  if (!emp) return null;

  const licenseDocs = await loadEmployeeLicenseDocs(emp.id);
  const statuses = params.statuses ?? (['open', 'draft'] as JobStatus[]);
  const and: Prisma.JobWhereInput[] = [
    agencyJobWhere(params.agencyIds),
    { status: { in: statuses } },
    { activeClientId: { not: null } },
  ];
  if (params.activeClientId) and.push({ activeClientId: params.activeClientId });

  const jobs = await prisma.job.findMany({
    where: { AND: and },
    select: jobMatchSelect,
    orderBy: { title: 'asc' },
    take: 500,
  });

  const matching = jobs.filter((job) =>
    employeeMeetsJobMatch({
      employeeSkills: emp.skills,
      job: {
        screeningCriteria: (job.screeningCriteria as ScreeningCriteriaInput | null) ?? null,
        licenseRequired: job.licenseRequired,
        requiredLicenseTypes: job.requiredLicenseTypes,
      },
      licenseDocs,
    }),
  );

  return matching.map(serializeMatchJob);
}

/**
 * Job-centric board: open/draft jobs with Available Master employees
 * (skill match temporarily disabled — all available, not already on the job).
 */
export async function listEmployeeJobMatchBoard(params: {
  agencyIds: string[];
  page?: number;
  pageSize?: number;
  q?: string;
  /** "My jobs only" owner filter on Job.createdById; null = all agency jobs. */
  jobOwnerWhere?: Record<string, unknown> | null;
}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 50));
  const skip = (page - 1) * pageSize;

  const search = params.q?.trim();
  const jobBase: Prisma.JobWhereInput[] = [
    agencyJobWhere(params.agencyIds),
    { status: { in: ['open', 'draft'] } },
    { activeClientId: { not: null } },
  ];
  if (params.jobOwnerWhere) jobBase.push(params.jobOwnerWhere as Prisma.JobWhereInput);
  if (search) {
    jobBase.push({
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
        { jobCode: { contains: search, mode: 'insensitive' } },
        { activeClient: { name: { contains: search, mode: 'insensitive' } } },
      ],
    });
  }
  const jobWhere: Prisma.JobWhereInput = { AND: jobBase };

  const employeeWhere: Prisma.EmployeeWhereInput = {
    addedBy: {
      subCompanyId:
        params.agencyIds.length === 1 ? params.agencyIds[0] : { in: params.agencyIds },
    },
    approvalStatus: 'approved',
    workStatus: 'none',
    NOT: { tags: { some: { tag: 'blacklisted' } } },
  };

  const [total, jobs, employees] = await Promise.all([
    prisma.job.count({ where: jobWhere }),
    prisma.job.findMany({
      where: jobWhere,
      select: {
        ...jobMatchSelect,
        assignments: {
          where: { isActive: true },
          select: { employeeId: true },
        },
      },
      orderBy: { title: 'asc' },
      skip,
      take: pageSize,
    }),
    prisma.employee.findMany({
      where: employeeWhere,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        skills: true,
        workStatus: true,
        approvalStatus: true,
        city: true,
        province: true,
        addedBy: { select: { subCompanyId: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 2000,
    }),
  ]);

  const empIds = employees.map((e) => e.id);
  const allDocs =
    empIds.length === 0
      ? []
      : await prisma.employeeDocument.findMany({
          where: {
            employeeId: { in: empIds },
            name: { startsWith: 'license — ', mode: 'insensitive' },
          },
          select: { employeeId: true, name: true, expiryDate: true },
        });

  const docsByEmp = new Map<string, LicenseDocFields[]>();
  for (const d of allDocs) {
    const list = docsByEmp.get(d.employeeId) ?? [];
    list.push({ name: d.name, expiryDate: d.expiryDate });
    docsByEmp.set(d.employeeId, list);
  }

  const data = jobs.map((job) => {
    const placedIds = new Set(job.assignments.map((a) => a.employeeId));
    const matchingEmployees = employees
      .filter((emp) => {
        if (placedIds.has(emp.id)) return false;
        return employeeMeetsJobMatch({
          employeeSkills: emp.skills,
          job: {
            screeningCriteria: (job.screeningCriteria as ScreeningCriteriaInput | null) ?? null,
            licenseRequired: job.licenseRequired,
            requiredLicenseTypes: job.requiredLicenseTypes,
          },
          licenseDocs: docsByEmp.get(emp.id) ?? [],
        });
      })
      .map((emp) => ({
        id: emp.id,
        firstName: emp.firstName,
        lastName: emp.lastName,
        email: emp.email,
        phone: emp.phone,
        skills: emp.skills ?? [],
        workStatus: emp.workStatus,
        approvalStatus: emp.approvalStatus,
        city: emp.city,
        province: emp.province,
        addedBySubCompanyId: emp.addedBy.subCompanyId ?? null,
      }));

    return {
      job: serializeMatchJob(job),
      matchingEmployees,
      matchCount: matchingEmployees.length,
    };
  });

  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

export async function listMatchingEmployeesForJob(params: {
  jobId: string;
  agencyIds: string[];
  q?: string;
}) {
  const job = await prisma.job.findFirst({
    where: { id: params.jobId, AND: [agencyJobWhere(params.agencyIds)] },
    select: {
      id: true,
      licenseRequired: true,
      requiredLicenseTypes: true,
      screeningCriteria: true,
      assignments: {
        where: { isActive: true },
        select: { employeeId: true },
      },
    },
  });
  if (!job) return null;

  const placedIds = new Set(job.assignments.map((a) => a.employeeId));
  const screening = (job.screeningCriteria as ScreeningCriteriaInput | null) ?? null;

  const search = params.q?.trim();
  const where: Prisma.EmployeeWhereInput = {
    addedBy: {
      subCompanyId:
        params.agencyIds.length === 1 ? params.agencyIds[0] : { in: params.agencyIds },
    },
    approvalStatus: 'approved',
    NOT: {
      OR: [
        { workStatus: { in: ['active', 'scheduled'] } },
        { tags: { some: { tag: 'blacklisted' } } },
      ],
    },
    ...(search
      ? {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const employees = await prisma.employee.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      skills: true,
      workStatus: true,
      approvalStatus: true,
      city: true,
      province: true,
      tags: { select: { tag: true } },
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    take: 300,
  });

  const candidates = employees.filter((e) => !placedIds.has(e.id));
  const empIds = candidates.map((e) => e.id);
  const allDocs =
    empIds.length === 0
      ? []
      : await prisma.employeeDocument.findMany({
          where: {
            employeeId: { in: empIds },
            name: { startsWith: 'license — ', mode: 'insensitive' },
          },
          select: { employeeId: true, name: true, expiryDate: true },
        });

  const docsByEmp = new Map<string, LicenseDocFields[]>();
  for (const d of allDocs) {
    const list = docsByEmp.get(d.employeeId) ?? [];
    list.push({ name: d.name, expiryDate: d.expiryDate });
    docsByEmp.set(d.employeeId, list);
  }

  const jobLicense: JobLicenseFields = {
    licenseRequired: job.licenseRequired,
    requiredLicenseTypes: job.requiredLicenseTypes,
  };

  const matching = candidates.filter((emp) =>
    employeeMeetsJobMatch({
      employeeSkills: emp.skills,
      job: {
        screeningCriteria: screening,
        ...jobLicense,
      },
      licenseDocs: docsByEmp.get(emp.id) ?? [],
    }),
  );

  return matching.map((emp) => {
    const tags = emp.tags.map((t) => t.tag);
    const specialTags = tags.filter(
      (t) => t === 'blacklisted' || t === 'no_show' || t === 'ex',
    );
    return {
      id: emp.id,
      firstName: emp.firstName,
      lastName: emp.lastName,
      email: emp.email,
      phone: emp.phone,
      skills: emp.skills ?? [],
      workStatus: emp.workStatus,
      approvalStatus: emp.approvalStatus,
      city: emp.city,
      province: emp.province,
      tags,
      specialTags,
    };
  });
}

export type RecruitmentMatchingSummary = {
  availableMasters: number;
  openJobsNeedingFill: number;
  employeesWithMatches: number;
  employeesWithZeroMatches: number;
  jobsWithZeroMatches: number;
};

/**
 * Agency-scoped matching aggregates for dashboards/reports.
 * When `createdById` is set (recruiter/mine), only that user's open jobs are counted.
 */
export async function getRecruitmentMatchingSummary(params: {
  agencyIds: string[];
  createdById?: string;
}): Promise<RecruitmentMatchingSummary> {
  const agencyFilter: Prisma.EmployeeWhereInput = {
    addedBy: {
      subCompanyId:
        params.agencyIds.length === 1 ? params.agencyIds[0]! : { in: params.agencyIds },
    },
    approvalStatus: 'approved',
    workStatus: 'none',
    NOT: { tags: { some: { tag: 'blacklisted' } } },
  };

  const jobAnd: Prisma.JobWhereInput[] = [
    agencyJobWhere(params.agencyIds),
    { status: { in: ['open', 'draft'] } },
    { activeClientId: { not: null } },
    { openPositions: { gt: 0 } },
  ];
  if (params.createdById) jobAnd.push({ createdById: params.createdById });

  const [employees, openJobs] = await Promise.all([
    prisma.employee.findMany({
      where: agencyFilter,
      select: { id: true, skills: true },
      take: 2000,
    }),
    prisma.job.findMany({
      where: { AND: jobAnd },
      select: jobMatchSelect,
      take: 500,
    }),
  ]);

  const availableMasters = employees.length;
  const openJobsNeedingFill = openJobs.length;

  if (availableMasters === 0 || openJobsNeedingFill === 0) {
    return {
      availableMasters,
      openJobsNeedingFill,
      employeesWithMatches: 0,
      employeesWithZeroMatches: availableMasters,
      jobsWithZeroMatches: openJobsNeedingFill,
    };
  }

  const empIds = employees.map((e) => e.id);
  const allDocs = await prisma.employeeDocument.findMany({
    where: {
      employeeId: { in: empIds },
      name: { startsWith: 'license — ', mode: 'insensitive' },
    },
    select: { employeeId: true, name: true, expiryDate: true },
  });
  const docsByEmp = new Map<string, LicenseDocFields[]>();
  for (const d of allDocs) {
    const list = docsByEmp.get(d.employeeId) ?? [];
    list.push({ name: d.name, expiryDate: d.expiryDate });
    docsByEmp.set(d.employeeId, list);
  }

  let employeesWithMatches = 0;
  const jobMatchCounts = new Map<string, number>();
  for (const job of openJobs) jobMatchCounts.set(job.id, 0);

  for (const emp of employees) {
    const licenseDocs = docsByEmp.get(emp.id) ?? [];
    let matchCount = 0;
    for (const job of openJobs) {
      const ok = employeeMeetsJobMatch({
        employeeSkills: emp.skills,
        job: {
          screeningCriteria: (job.screeningCriteria as ScreeningCriteriaInput | null) ?? null,
          licenseRequired: job.licenseRequired,
          requiredLicenseTypes: job.requiredLicenseTypes,
        },
        licenseDocs,
      });
      if (ok) {
        matchCount += 1;
        jobMatchCounts.set(job.id, (jobMatchCounts.get(job.id) ?? 0) + 1);
      }
    }
    if (matchCount > 0) employeesWithMatches += 1;
  }

  let jobsWithZeroMatches = 0;
  for (const count of jobMatchCounts.values()) {
    if (count === 0) jobsWithZeroMatches += 1;
  }

  return {
    availableMasters,
    openJobsNeedingFill,
    employeesWithMatches,
    employeesWithZeroMatches: availableMasters - employeesWithMatches,
    jobsWithZeroMatches,
  };
}
