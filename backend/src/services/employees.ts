/**
 * Employee applicants: list, create, update, approve/reject, documents.
 * Agency scope via addedBy.subCompanyId (Employee has no agency FK).
 */
import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { uploadToR2, getFromR2, buildAgencyR2Key } from './r2Storage';
import { env } from '../config/env';
import {
  DEFAULT_TRAINING_REQUIRED_COUNT,
  loadEmployeeReadinessMap,
  type EmployeeReadiness,
} from './employeeDefaultTraining';
import {
  normalizeEmployeeUiExtras,
  type EmployeeUiExtras,
} from './employeeUiExtras';
import { buildSeedPlaceholderPdf, isSeedDocumentUrl } from './seedDocumentPlaceholder';

const listInclude = {
  tags: true,
  addedBy: { select: { id: true, firstName: true, lastName: true, subCompanyId: true } },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
  rejectedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.EmployeeInclude;

const detailInclude = {
  ...listInclude,
  workExperiences: { orderBy: { sortOrder: 'asc' as const } },
  documents: {
    orderBy: { uploadedAt: 'desc' as const },
    include: {
      uploadedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  notes: { orderBy: { createdAt: 'desc' as const } },
} satisfies Prisma.EmployeeInclude;

export type WorkExperienceInput = {
  companyName: string;
  contactNumber?: string | null;
  position?: string | null;
  duration?: string | null;
  sortOrder: number;
};

export type CreateEmployeeInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  gender: 'male' | 'female' | 'other';
  dateOfBirth?: string | null;
  address: string;
  addressLine2?: string | null;
  city: string;
  province: string;
  postalCode: string;
  country?: string | null;
  emergencyContactName: string;
  emergencyContactPhone: string;
  educationLevel: string;
  educationFromYear?: number | null;
  educationEndYear?: number | null;
  graduated: boolean;
  courseStudied?: string | null;
  diplomaName?: string | null;
  experienceDuties: string;
  availableFrom: string;
  availabilityTypes: Array<'full_time' | 'part_time'>;
  skills?: string[];
  residencyStatus: 'citizen' | 'pr' | 'student' | 'refugee' | 'work_permit';
  shiftsAvailable: string[];
  ableTwelveHourShift: boolean;
  englishProficiency: string[];
  workExperiences: WorkExperienceInput[];
  employeeType?: 'internal' | 'external';
  workStatus?: 'none' | 'active' | 'scheduled' | null;
  hourlyRate?: number | null;
  salaryPaymentMethod?: 'cheque' | 'deposit' | null;
  bankName?: string | null;
  bankInstitutionNumber?: string | null;
  bankTransitNumber?: string | null;
  bankAccountNumber?: string | null;
  /** Form-only extras (no SIN). */
  uiExtras?: EmployeeUiExtras | null;
};

export type UpdateEmployeeInput = Partial<
  Omit<CreateEmployeeInput, 'workExperiences' | 'email' | 'phone' | 'firstName' | 'lastName'>
> & {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string;
  employeeType?: 'internal' | 'external';
  workStatus?: 'none' | 'active' | 'scheduled' | null;
  position?: string | null;
  department?: string | null;
  hourlyRate?: number | null;
  salaryPaymentMethod?: 'cheque' | 'deposit' | null;
  bankName?: string | null;
  bankInstitutionNumber?: string | null;
  bankTransitNumber?: string | null;
  bankAccountNumber?: string | null;
  tags?: string[];
  workExperiences?: WorkExperienceInput[];
  uiExtras?: EmployeeUiExtras | null;
};

function parseApprovalChain(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string');
}

type EmployeeSerializedSource =
  | Prisma.EmployeeGetPayload<{ include: typeof detailInclude }>
  | Prisma.EmployeeGetPayload<{ include: typeof listInclude }>;

function serializeEmployee(
  emp: EmployeeSerializedSource,
  activeClient?: {
    assignmentId: string;
    clientId: string;
    clientName: string;
    jobId?: string | null;
    jobTitle?: string | null;
  } | null,
  readiness?: EmployeeReadiness | null,
  opts?: { clientTrainingPending?: boolean },
) {
  const tags = emp.tags.map((t) => t.tag);
  const specialTags = tags.filter((t) =>
    t === 'blacklisted' || t === 'no_show' || t === 'ex',
  );
  const addedByName = `${emp.addedBy.firstName} ${emp.addedBy.lastName}`.trim();
  const approvedByName = emp.approvedBy
    ? `${emp.approvedBy.firstName} ${emp.approvedBy.lastName}`.trim()
    : undefined;
  const rejectedByName = emp.rejectedBy
    ? `${emp.rejectedBy.firstName} ${emp.rejectedBy.lastName}`.trim()
    : undefined;
  // Scalars always present on Employee; cast avoids Prisma include-union inference gaps.
  const chainFields = emp as EmployeeSerializedSource & {
    approvalChain: unknown;
    submitterRole: string | null;
    currentStepIndex: number;
  };
  const approvalChain = parseApprovalChain(chainFields.approvalChain);

  const readinessFields = {
    agreementStatus: readiness?.agreementStatus ?? ('incomplete' as const),
    trainingCompletedCount: readiness?.trainingCompletedCount ?? 0,
    trainingRequiredCount: readiness?.trainingRequiredCount ?? DEFAULT_TRAINING_REQUIRED_COUNT,
  };

  const base = {
    id: emp.id,
    employeeType: emp.employeeType,
    firstName: emp.firstName,
    lastName: emp.lastName,
    email: emp.email,
    phone: emp.phone,
    alternatePhone: emp.alternatePhone,
    dateOfBirth: emp.dateOfBirth?.toISOString() ?? null,
    gender: emp.gender,
    address: emp.address,
    addressLine2: emp.addressLine2,
    city: emp.city,
    province: emp.province,
    postalCode: emp.postalCode,
    country: emp.country,
    emergencyContactName: emp.emergencyContactName,
    emergencyContactPhone: emp.emergencyContactPhone,
    educationLevel: emp.educationLevel,
    educationFromYear: emp.educationFromYear,
    educationEndYear: emp.educationEndYear,
    graduated: emp.graduated,
    courseStudied: emp.courseStudied,
    diplomaName: emp.diplomaName,
    experienceDuties: emp.experienceDuties,
    availableFrom: emp.availableFrom?.toISOString().slice(0, 10) ?? null,
    availabilityTypes: emp.availabilityTypes ?? [],
    skills: emp.skills ?? [],
    residencyStatus: emp.residencyStatus,
    shiftsAvailable: emp.shiftsAvailable,
    ableTwelveHourShift: emp.ableTwelveHourShift,
    englishProficiency: emp.englishProficiency,
    workStatus: emp.workStatus,
    approvalStatus: emp.approvalStatus,
    hireDate: emp.hireDate?.toISOString() ?? null,
    terminationDate: emp.terminationDate?.toISOString() ?? null,
    position: emp.position,
    department: emp.department,
    hourlyRate: emp.hourlyRate != null ? Number(emp.hourlyRate) : null,
    salaryPaymentMethod: emp.salaryPaymentMethod,
    bankName: emp.bankName,
    bankInstitutionNumber: emp.bankInstitutionNumber,
    bankTransitNumber: emp.bankTransitNumber,
    bankAccountNumber: emp.bankAccountNumber,
    tags,
    specialTags,
    addedBy: emp.addedById,
    addedByName,
    addedBySubCompanyId: emp.addedBy.subCompanyId ?? null,
    approvedBy: emp.approvedById,
    approvedByName,
    approvedAt: emp.approvedAt?.toISOString() ?? null,
    rejectedBy: emp.rejectedById,
    rejectedByName,
    rejectedAt: emp.rejectedAt?.toISOString() ?? null,
    rejectionReason: emp.rejectionReason,
    submitterRole: chainFields.submitterRole ?? null,
    currentStepIndex: chainFields.currentStepIndex ?? 0,
    approvalChain,
    activeAssignmentId: activeClient?.assignmentId ?? null,
    activeClientId: activeClient?.clientId || null,
    activeClientName: activeClient?.clientName || null,
    assignedClientId: activeClient?.clientId || null,
    assignedClientName: activeClient?.clientName || null,
    activeJobId: activeClient?.jobId || null,
    activeJobTitle: activeClient?.jobTitle || null,
    /** Signed client-training form still missing for at least one placement. */
    clientTrainingPending: opts?.clientTrainingPending ?? false,
    onboardingPandaDocId: (emp as { onboardingPandaDocId?: string | null }).onboardingPandaDocId ?? null,
    onboardingPandaDocStatus: (emp as { onboardingPandaDocStatus?: string | null }).onboardingPandaDocStatus ?? null,
    onboardingPandaDocUpdatedAt:
      (emp as { onboardingPandaDocUpdatedAt?: Date | null }).onboardingPandaDocUpdatedAt?.toISOString() ?? null,
    ...readinessFields,
    createdAt: emp.createdAt.toISOString(),
    updatedAt: emp.updatedAt.toISOString(),
  };

  if ('workExperiences' in emp) {
    const detail = emp as Prisma.EmployeeGetPayload<{ include: typeof detailInclude }>;
    return {
      ...base,
      uiExtras: normalizeEmployeeUiExtras(
        (detail as { uiExtras?: unknown }).uiExtras ?? null,
      ),
      workExperiences: detail.workExperiences.map((w) => ({
        id: w.id,
        companyName: w.companyName,
        contactNumber: w.contactNumber,
        position: w.position,
        duration: w.duration,
        sortOrder: w.sortOrder,
      })),
      documents: detail.documents.map((d) => ({
        id: d.id,
        type: d.type,
        name: d.name,
        fileName: d.fileName,
        fileSize: Number(d.fileSize),
        mimeType: d.mimeType,
        url: d.url,
        uploadedAt: d.uploadedAt.toISOString(),
        uploadedBy: d.uploadedById,
        uploadedByName: `${d.uploadedBy.firstName} ${d.uploadedBy.lastName}`.trim(),
        expiryDate: d.expiryDate?.toISOString() ?? null,
        notes: d.notes,
      })),
      notes: detail.notes.map((n) => ({
        id: n.id,
        userId: n.userId,
        userName: n.userName,
        content: n.content,
        createdAt: n.createdAt.toISOString(),
      })),
      emergencyContact:
        detail.emergencyContactName
          ? {
              name: detail.emergencyContactName,
              phone: detail.emergencyContactPhone ?? '',
            }
          : null,
    };
  }

  return {
    ...base,
    emergencyContact:
      emp.emergencyContactName
        ? {
            name: emp.emergencyContactName,
            phone: emp.emergencyContactPhone ?? '',
          }
        : null,
  };
}

export type EmployeePipelineBucket =
  | 'unregistered'
  | 'pending'
  | 'master'
  | 'active';

export type ListEmployeesParams = {
  page: number;
  limit: number;
  search?: string;
  approvalStatus?: string;
  workStatus?: string;
  pipelineBucket?: EmployeePipelineBucket;
  tags?: string[];
  tagAny?: string[];
  excludeTags?: string[];
  city?: string;
  province?: string;
  employeeType?: string;
  agencyIds: string[];
  /** Optional owner ("my records") filter on addedById; null = no narrowing. */
  ownerWhere?: Record<string, unknown> | null;
};

const activeClientAssignmentFilter = {
  some: {
    status: 'approved' as const,
    isActive: true,
    OR: [
      { targetType: 'client' as const },
      { activeClientId: { not: null } },
      { clientId: { not: null } },
    ],
  },
};

function agencyEmployeeBase(agencyIds: string[]): Prisma.EmployeeWhereInput {
  return {
    addedBy: {
      subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
      isActive: true,
    },
  };
}

/** Unregistered = rejected, or legacy records not yet submitted for approval. */
function unregisteredWhere(): Prisma.EmployeeWhereInput {
  return {
    OR: [
      { approvalStatus: 'rejected' },
      { approvalStatus: 'pending', submitterRole: null },
    ],
  };
}

/** Pending Approval = submitted employee_add chain awaiting RM. */
function pendingSubmittedWhere(): Prisma.EmployeeWhereInput {
  return {
    approvalStatus: 'pending',
    submitterRole: { not: null },
  };
}

function masterWhere(): Prisma.EmployeeWhereInput {
  return {
    approvalStatus: 'approved',
    NOT: { employeeAssignments: activeClientAssignmentFilter },
  };
}

/** Placed on a client (including while client-training form is still pending). */
function activeWithClientWhere(): Prisma.EmployeeWhereInput {
  return {
    approvalStatus: 'approved',
    employeeAssignments: activeClientAssignmentFilter,
    NOT: { tags: { some: { tag: { in: ['blacklisted', 'ex', 'no_show'] } } } },
  };
}

async function loadClientTrainingPendingSet(employeeIds: string[]): Promise<Set<string>> {
  const pending = new Set<string>();
  if (employeeIds.length === 0) return pending;
  const rows = await prisma.activeClientTrainingAssignment.findMany({
    where: { employeeId: { in: employeeIds }, status: 'pending' },
    select: { employeeId: true },
  });
  for (const row of rows) pending.add(row.employeeId);
  return pending;
}

async function loadActiveClientMap(
  employeeIds: string[],
): Promise<
  Map<
    string,
    {
      assignmentId: string;
      clientId: string;
      clientName: string;
      jobId: string | null;
      jobTitle: string | null;
    }
  >
> {
  const map = new Map<
    string,
    {
      assignmentId: string;
      clientId: string;
      clientName: string;
      jobId: string | null;
      jobTitle: string | null;
    }
  >();
  if (employeeIds.length === 0) return map;

  // All active approved placements (client + job, including job-only with no client id).
  const rows = await prisma.employeeAssignment.findMany({
    where: {
      employeeId: { in: employeeIds },
      status: 'approved',
      isActive: true,
    },
    include: {
      client: { select: { id: true, name: true } },
      activeClient: { select: { id: true, name: true } },
      job: {
        select: {
          id: true,
          title: true,
          company: true,
          activeClientId: true,
          activeClient: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { approvedAt: 'desc' },
  });

  for (const row of rows) {
    if (map.has(row.employeeId)) continue;
    const clientId =
      row.activeClientId ??
      row.clientId ??
      row.job?.activeClientId ??
      row.job?.activeClient?.id ??
      row.jobId ??
      null;
    const clientName =
      row.activeClient?.name ??
      row.client?.name ??
      row.job?.activeClient?.name ??
      row.job?.company ??
      null;
    const jobId = row.jobId ?? row.job?.id ?? null;
    const jobTitle = row.job?.title?.trim() || null;
    // Always record so list rows get activeAssignmentId even without a named client.
    map.set(row.employeeId, {
      assignmentId: row.id,
      clientId: clientId ?? '',
      clientName: clientName ?? jobTitle ?? 'Active placement',
      jobId,
      jobTitle,
    });
  }

  // Roster-only: active jobAssignment without a linked EmployeeAssignment row.
  const missingIds = employeeIds.filter((id) => !map.has(id));
  if (missingIds.length > 0) {
    const rosterRows = await prisma.jobAssignment.findMany({
      where: { employeeId: { in: missingIds }, isActive: true },
      select: {
        id: true,
        employeeId: true,
        job: {
          select: {
            id: true,
            title: true,
            company: true,
            activeClientId: true,
            activeClient: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { assignedAt: 'desc' },
    });
    for (const row of rosterRows) {
      if (map.has(row.employeeId)) continue;
      const jobTitle = row.job.title?.trim() || null;
      const clientId = row.job.activeClientId ?? row.job.activeClient?.id ?? row.job.id;
      const clientName =
        row.job.activeClient?.name ?? row.job.company ?? jobTitle ?? 'Active placement';
      map.set(row.employeeId, {
        // Prefer employees ending placement via job side when only roster exists.
        assignmentId: row.id,
        clientId,
        clientName,
        jobId: row.job.id,
        jobTitle,
      });
    }
  }

  return map;
}

/**
 * Master approval used to stamp workStatus=active without a placement.
 * Clear that so Available matching and the Active badge stay honest.
 */
async function healPhantomPlacedWorkStatus(employeeIds: string[]): Promise<Set<string>> {
  const healed = new Set<string>();
  if (employeeIds.length === 0) return healed;

  const candidates = await prisma.employee.findMany({
    where: {
      id: { in: employeeIds },
      approvalStatus: 'approved',
      workStatus: { in: ['active', 'scheduled'] },
    },
    select: { id: true },
  });
  if (candidates.length === 0) return healed;

  const candIds = candidates.map((c) => c.id);
  const [placements, rosterRows] = await Promise.all([
    prisma.employeeAssignment.findMany({
      where: {
        employeeId: { in: candIds },
        status: 'approved',
        isActive: true,
      },
      select: { employeeId: true },
    }),
    prisma.jobAssignment.findMany({
      where: { employeeId: { in: candIds }, isActive: true },
      select: { employeeId: true },
    }),
  ]);
  const placed = new Set<string>();
  for (const row of placements) placed.add(row.employeeId);
  for (const row of rosterRows) placed.add(row.employeeId);

  const ghostIds = candIds.filter((id) => !placed.has(id));
  if (ghostIds.length === 0) return healed;

  await prisma.employee.updateMany({
    where: { id: { in: ghostIds } },
    data: { workStatus: 'none' },
  });
  for (const id of ghostIds) healed.add(id);
  return healed;
}

export async function listEmployees(params: ListEmployeesParams) {
  const {
    page,
    limit,
    search,
    approvalStatus,
    workStatus,
    pipelineBucket,
    tags,
    tagAny,
    excludeTags,
    city,
    province,
    employeeType,
    agencyIds,
    ownerWhere,
  } = params;

  const andParts: Prisma.EmployeeWhereInput[] = [agencyEmployeeBase(agencyIds)];
  if (ownerWhere) andParts.push(ownerWhere as Prisma.EmployeeWhereInput);

  if (pipelineBucket === 'unregistered') {
    andParts.push(unregisteredWhere());
  } else if (pipelineBucket === 'pending') {
    andParts.push(pendingSubmittedWhere());
  } else if (pipelineBucket === 'master') {
    andParts.push(masterWhere());
  } else if (pipelineBucket === 'active') {
    andParts.push(activeWithClientWhere());
  } else {
    if (approvalStatus) {
      andParts.push({ approvalStatus: approvalStatus as 'pending' | 'approved' | 'rejected' });
    }
    if (workStatus) {
      andParts.push({ workStatus: workStatus as 'none' | 'active' | 'scheduled' });
    }
  }

  if (employeeType) {
    andParts.push({ employeeType: employeeType as 'internal' | 'external' });
  }
  if (city) andParts.push({ city: { equals: city, mode: 'insensitive' } });
  if (province) andParts.push({ province: { equals: province, mode: 'insensitive' } });

  if (tags && tags.length > 0) {
    for (const tag of tags) andParts.push({ tags: { some: { tag } } });
  }
  if (tagAny && tagAny.length > 0) {
    andParts.push({ tags: { some: { tag: { in: tagAny } } } });
  }
  if (excludeTags && excludeTags.length > 0) {
    andParts.push({ NOT: { tags: { some: { tag: { in: excludeTags } } } } });
  }

  if (search?.trim()) {
    const q = search.trim();
    andParts.push({
      OR: [
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { city: { contains: q, mode: 'insensitive' } },
        { position: { contains: q, mode: 'insensitive' } },
      ],
    });
  }

  const where: Prisma.EmployeeWhereInput = { AND: andParts };

  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    prisma.employee.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: listInclude,
    }),
    prisma.employee.count({ where }),
  ]);

  const healed = await healPhantomPlacedWorkStatus(rows.map((r) => r.id));
  const normalizedRows = rows.map((row) =>
    healed.has(row.id) ? { ...row, workStatus: 'none' as const } : row,
  );

  const ids = normalizedRows.map((r) => r.id);
  const [activeMap, readinessMap, trainingPendingSet] = await Promise.all([
    loadActiveClientMap(ids),
    loadEmployeeReadinessMap(normalizedRows),
    loadClientTrainingPendingSet(ids),
  ]);

  return {
    data: normalizedRows.map((row) =>
      serializeEmployee(row, activeMap.get(row.id) ?? null, readinessMap.get(row.id) ?? null, {
        clientTrainingPending: trainingPendingSet.has(row.id),
      }),
    ),
    total,
    page,
    limit,
  };
}

export async function getEmployeeCounts(
  agencyIds: string[],
  ownerWhere?: Record<string, unknown> | null,
) {
  const base: Prisma.EmployeeWhereInput = ownerWhere
    ? { AND: [agencyEmployeeBase(agencyIds), ownerWhere as Prisma.EmployeeWhereInput] }
    : agencyEmployeeBase(agencyIds);

  const [master, active, blacklist, ex, pending, unregistered] = await Promise.all([
    prisma.employee.count({ where: { AND: [base, masterWhere()] } }),
    prisma.employee.count({ where: { AND: [base, activeWithClientWhere()] } }),
    prisma.employee.count({
      where: {
        ...base,
        approvalStatus: 'approved',
        tags: { some: { tag: 'blacklisted' } },
      },
    }),
    prisma.employee.count({
      where: {
        ...base,
        approvalStatus: 'approved',
        tags: { some: { tag: { in: ['ex', 'no_show'] } } },
      },
    }),
    prisma.employee.count({ where: { AND: [base, pendingSubmittedWhere()] } }),
    prisma.employee.count({ where: { AND: [base, unregisteredWhere()] } }),
  ]);

  return { master, active, blacklist, ex, pending, unregistered };
}

export async function getEmployeeById(id: string, agencyIds: string[]) {
  const emp = await prisma.employee.findFirst({
    where: {
      id,
      addedBy: {
        subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
      },
    },
    include: detailInclude,
  });
  if (!emp) return null;
  const healed = await healPhantomPlacedWorkStatus([emp.id]);
  const normalized = healed.has(emp.id) ? { ...emp, workStatus: 'none' as const } : emp;
  const [activeMap, readinessMap, trainingPendingSet] = await Promise.all([
    loadActiveClientMap([normalized.id]),
    loadEmployeeReadinessMap([normalized]),
    loadClientTrainingPendingSet([normalized.id]),
  ]);
  return serializeEmployee(
    normalized,
    activeMap.get(normalized.id) ?? null,
    readinessMap.get(normalized.id) ?? null,
    { clientTrainingPending: trainingPendingSet.has(normalized.id) },
  );
}

export async function createEmployee(input: CreateEmployeeInput, addedById: string) {
  if (input.workExperiences.length !== 2) {
    throw Object.assign(new Error('Exactly two work experiences are required'), { status: 400 });
  }

  const emp = await prisma.employee.create({
    data: {
      employeeType: 'external',
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone.trim(),
      gender: input.gender,
      dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
      address: input.address.trim(),
      addressLine2: input.addressLine2?.trim() || null,
      city: input.city.trim(),
      province: input.province.trim(),
      postalCode: input.postalCode.trim(),
      country: input.country?.trim() || 'Canada',
      emergencyContactName: input.emergencyContactName.trim(),
      emergencyContactPhone: input.emergencyContactPhone.trim(),
      educationLevel: input.educationLevel.trim(),
      educationFromYear: input.educationFromYear ?? null,
      educationEndYear: input.educationEndYear ?? null,
      graduated: input.graduated,
      courseStudied: input.courseStudied?.trim() || null,
      diplomaName: input.diplomaName?.trim() || null,
      experienceDuties: input.experienceDuties.trim(),
      availableFrom: new Date(input.availableFrom),
      availabilityTypes: input.availabilityTypes,
      skills: input.skills ?? [],
      residencyStatus: input.residencyStatus,
      shiftsAvailable: input.shiftsAvailable,
      ableTwelveHourShift: input.ableTwelveHourShift,
      englishProficiency: input.englishProficiency,
      workStatus: input.workStatus ?? 'none',
      approvalStatus: 'pending',
      hourlyRate: input.hourlyRate != null ? input.hourlyRate : null,
      salaryPaymentMethod: input.salaryPaymentMethod ?? null,
      bankName: input.salaryPaymentMethod === 'deposit' ? input.bankName?.trim() || null : null,
      bankInstitutionNumber:
        input.salaryPaymentMethod === 'deposit' ? input.bankInstitutionNumber?.trim() || null : null,
      bankTransitNumber:
        input.salaryPaymentMethod === 'deposit' ? input.bankTransitNumber?.trim() || null : null,
      bankAccountNumber:
        input.salaryPaymentMethod === 'deposit' ? input.bankAccountNumber?.trim() || null : null,
      addedById,
      ...(input.uiExtras !== undefined
        ? { uiExtras: normalizeEmployeeUiExtras(input.uiExtras) }
        : {}),
      workExperiences: {
        create: input.workExperiences.map((w) => ({
          companyName: w.companyName.trim(),
          contactNumber: w.contactNumber?.trim() || null,
          position: w.position?.trim() || null,
          duration: w.duration?.trim() || null,
          sortOrder: w.sortOrder,
        })),
      },
    },
    include: detailInclude,
  });

  return serializeEmployee(emp);
}

export async function updateEmployee(id: string, agencyIds: string[], input: UpdateEmployeeInput) {
  const existing = await prisma.employee.findFirst({
    where: {
      id,
      addedBy: {
        subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
      },
    },
    select: { id: true, uiExtras: true },
  });
  if (!existing) return null;

  if (input.workExperiences && input.workExperiences.length !== 2) {
    throw Object.assign(new Error('Exactly two work experiences are required'), { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    if (input.tags) {
      await tx.employeeTag.deleteMany({ where: { employeeId: id } });
      if (input.tags.length > 0) {
        await tx.employeeTag.createMany({
          data: input.tags.map((tag) => ({ employeeId: id, tag })),
        });
      }
    }

    if (input.workExperiences) {
      await tx.employeeWorkExperience.deleteMany({ where: { employeeId: id } });
      await tx.employeeWorkExperience.createMany({
        data: input.workExperiences.map((w) => ({
          employeeId: id,
          companyName: w.companyName.trim(),
          contactNumber: w.contactNumber?.trim() || null,
          position: w.position?.trim() || null,
          duration: w.duration?.trim() || null,
          sortOrder: w.sortOrder,
        })),
      });
    }

    const data: Prisma.EmployeeUpdateInput = {};
    if (input.firstName !== undefined) data.firstName = input.firstName.trim();
    if (input.lastName !== undefined) data.lastName = input.lastName.trim();
    if (input.email !== undefined) data.email = input.email?.trim().toLowerCase() || null;
    if (input.phone !== undefined) data.phone = input.phone.trim();
    if (input.gender !== undefined) data.gender = input.gender;
    if (input.dateOfBirth !== undefined) {
      data.dateOfBirth = input.dateOfBirth ? new Date(input.dateOfBirth) : null;
    }
    if (input.address !== undefined) data.address = input.address.trim();
    if (input.addressLine2 !== undefined) data.addressLine2 = input.addressLine2?.trim() || null;
    if (input.city !== undefined) data.city = input.city.trim();
    if (input.province !== undefined) data.province = input.province.trim();
    if (input.postalCode !== undefined) data.postalCode = input.postalCode.trim();
    if (input.country !== undefined) data.country = input.country?.trim() || null;
    if (input.emergencyContactName !== undefined) {
      data.emergencyContactName = input.emergencyContactName.trim();
    }
    if (input.emergencyContactPhone !== undefined) {
      data.emergencyContactPhone = input.emergencyContactPhone.trim();
    }
    if (input.educationLevel !== undefined) data.educationLevel = input.educationLevel.trim();
    if (input.educationFromYear !== undefined) data.educationFromYear = input.educationFromYear;
    if (input.educationEndYear !== undefined) data.educationEndYear = input.educationEndYear;
    if (input.graduated !== undefined) data.graduated = input.graduated;
    if (input.courseStudied !== undefined) data.courseStudied = input.courseStudied?.trim() || null;
    if (input.diplomaName !== undefined) data.diplomaName = input.diplomaName?.trim() || null;
    if (input.experienceDuties !== undefined) data.experienceDuties = input.experienceDuties.trim();
    if (input.availableFrom !== undefined) data.availableFrom = new Date(input.availableFrom);
    if (input.availabilityTypes !== undefined) data.availabilityTypes = input.availabilityTypes;
    if (input.skills !== undefined) data.skills = input.skills;
    if (input.residencyStatus !== undefined) data.residencyStatus = input.residencyStatus;
    if (input.shiftsAvailable !== undefined) data.shiftsAvailable = input.shiftsAvailable;
    if (input.ableTwelveHourShift !== undefined) data.ableTwelveHourShift = input.ableTwelveHourShift;
    if (input.englishProficiency !== undefined) data.englishProficiency = input.englishProficiency;
    // External-only: ignore attempts to set internal
    if (input.employeeType !== undefined) data.employeeType = 'external';
    if (input.workStatus !== undefined) data.workStatus = input.workStatus;
    if (input.position !== undefined) data.position = input.position?.trim() || null;
    if (input.department !== undefined) data.department = input.department?.trim() || null;
    if (input.hourlyRate !== undefined) {
      data.hourlyRate = input.hourlyRate != null ? input.hourlyRate : null;
    }
    if (input.salaryPaymentMethod !== undefined) {
      data.salaryPaymentMethod = input.salaryPaymentMethod;
    }
    const paymentMethod =
      input.salaryPaymentMethod !== undefined
        ? input.salaryPaymentMethod
        : undefined;
    if (paymentMethod === 'cheque' || paymentMethod === null) {
      data.bankName = null;
      data.bankInstitutionNumber = null;
      data.bankTransitNumber = null;
      data.bankAccountNumber = null;
    } else if (paymentMethod === 'deposit' || paymentMethod === undefined) {
      if (input.bankName !== undefined) data.bankName = input.bankName?.trim() || null;
      if (input.bankInstitutionNumber !== undefined) {
        data.bankInstitutionNumber = input.bankInstitutionNumber?.trim() || null;
      }
      if (input.bankTransitNumber !== undefined) {
        data.bankTransitNumber = input.bankTransitNumber?.trim() || null;
      }
      if (input.bankAccountNumber !== undefined) {
        data.bankAccountNumber = input.bankAccountNumber?.trim() || null;
      }
    }
    if (input.uiExtras !== undefined) {
      // Merge patch into existing extras so omitted keys are preserved.
      const prev = normalizeEmployeeUiExtras(existing.uiExtras);
      const patch = input.uiExtras ?? {};
      const merged: Record<string, unknown> = { ...prev };
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) merged[key] = value;
      }
      data.uiExtras = normalizeEmployeeUiExtras(merged);
    }

    if (Object.keys(data).length > 0) {
      await tx.employee.update({ where: { id }, data });
    }
  });

  return getEmployeeById(id, agencyIds);
}

export async function approveEmployee(id: string, agencyIds: string[], approverId: string) {
  const { finalizeEmployeeAddApproval } = await import('./employeeApproval');
  const result = await finalizeEmployeeAddApproval(id, agencyIds, approverId);
  if (!result.ok) {
    throw Object.assign(new Error(result.error), { status: result.status });
  }
  return getEmployeeById(id, agencyIds);
}

export async function rejectEmployee(
  id: string,
  agencyIds: string[],
  rejecterId: string,
  reason: string,
) {
  const existing = await prisma.employee.findFirst({
    where: {
      id,
      approvalStatus: 'pending',
      addedBy: {
        subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
      },
    },
    select: { id: true },
  });
  if (!existing) return null;

  await prisma.employee.update({
    where: { id },
    data: {
      approvalStatus: 'rejected',
      rejectedById: rejecterId,
      rejectedAt: new Date(),
      rejectionReason: reason.trim(),
      approvedById: null,
      approvedAt: null,
    },
  });

  return getEmployeeById(id, agencyIds);
}

export async function addEmployeeNote(
  id: string,
  agencyIds: string[],
  userId: string,
  userName: string,
  content: string,
) {
  const existing = await prisma.employee.findFirst({
    where: {
      id,
      addedBy: {
        subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
      },
    },
    select: { id: true },
  });
  if (!existing) return null;

  await prisma.employeeNote.create({
    data: {
      employeeId: id,
      userId,
      userName,
      content: content.trim(),
    },
  });

  return getEmployeeById(id, agencyIds);
}

export async function uploadEmployeeDocument(params: {
  employeeId: string;
  agencyIds: string[];
  uploadedById: string;
  name: string;
  fileBase64: string;
  mimeType?: string;
  type?: 'resume' | 'photo_id' | 'sin' | 'proof_of_status' | 'agreement' | 'bank_deposit' | 'other' | 'training_certificate';
  expiryDate?: Date | null;
}) {
  const {
    employeeId,
    agencyIds,
    uploadedById,
    name,
    fileBase64,
    mimeType,
    type = 'resume',
    expiryDate,
  } = params;

  const emp = await prisma.employee.findFirst({
    where: {
      id: employeeId,
      addedBy: {
        subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
      },
    },
    select: { id: true, addedBy: { select: { subCompanyId: true } } },
  });
  if (!emp) return null;

  const maxSize = parseInt(env.MAX_FILE_SIZE ?? '10485760', 10);
  let buffer: Buffer;
  try {
    buffer = Buffer.from(fileBase64, 'base64');
  } catch {
    throw Object.assign(new Error('Invalid base64 file content'), { status: 400 });
  }
  if (buffer.length > maxSize) {
    throw Object.assign(
      new Error(`File too large (max ${Math.round(maxSize / 1024 / 1024)}MB)`),
      { status: 400 },
    );
  }

  const safeName = name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const ext = safeName.split('.').pop()?.slice(0, 10) ?? 'bin';
  const contentType = mimeType ?? (ext === 'pdf' ? 'application/pdf' : 'application/octet-stream');
  const agencyId = emp.addedBy.subCompanyId ?? agencyIds[0]!;
  const key = buildAgencyR2Key(agencyId, 'employees', employeeId, `${Date.now()}-${safeName}`);
  const fileUrl = await uploadToR2(key, buffer, contentType);

  const doc = await prisma.employeeDocument.create({
    data: {
      employeeId,
      type,
      name,
      fileName: name,
      fileSize: BigInt(buffer.length),
      mimeType: contentType,
      url: fileUrl ?? key,
      uploadedById,
      ...(expiryDate !== undefined ? { expiryDate } : {}),
    },
    include: {
      uploadedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  return {
    id: doc.id,
    type: doc.type,
    name: doc.name,
    fileName: doc.fileName,
    fileSize: Number(doc.fileSize),
    mimeType: doc.mimeType,
    url: doc.url,
    uploadedAt: doc.uploadedAt.toISOString(),
    uploadedBy: doc.uploadedById,
    uploadedByName: `${doc.uploadedBy.firstName} ${doc.uploadedBy.lastName}`.trim(),
    expiryDate: doc.expiryDate?.toISOString() ?? null,
  };
}

export async function updateEmployeeDocumentExpiry(params: {
  employeeId: string;
  docId: string;
  agencyIds: string[];
  expiryDate: Date | null;
}) {
  const { employeeId, docId, agencyIds, expiryDate } = params;

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

  const existing = await prisma.employeeDocument.findFirst({
    where: { id: docId, employeeId },
    select: { id: true },
  });
  if (!existing) return null;

  const doc = await prisma.employeeDocument.update({
    where: { id: docId },
    data: { expiryDate },
    include: {
      uploadedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  return {
    id: doc.id,
    type: doc.type,
    name: doc.name,
    fileName: doc.fileName,
    fileSize: Number(doc.fileSize),
    mimeType: doc.mimeType,
    url: doc.url,
    uploadedAt: doc.uploadedAt.toISOString(),
    uploadedBy: doc.uploadedById,
    uploadedByName: `${doc.uploadedBy.firstName} ${doc.uploadedBy.lastName}`.trim(),
    expiryDate: doc.expiryDate?.toISOString() ?? null,
    notes: doc.notes,
  };
}

export async function deleteEmployeeDocument(
  employeeId: string,
  docId: string,
  agencyIds: string[],
) {
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

  const doc = await prisma.employeeDocument.findFirst({
    where: { id: docId, employeeId },
  });
  if (!doc) return null;

  await prisma.employeeDocument.delete({ where: { id: docId } });
  return true;
}

export async function getEmployeeDocumentBuffer(
  employeeId: string,
  docId: string,
  agencyIds: string[],
) {
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

  const doc = await prisma.employeeDocument.findFirst({
    where: { id: docId, employeeId },
  });
  if (!doc) return null;

  // Seed/demo docs use seed:// URLs with no R2 object — serve a previewable PDF.
  if (isSeedDocumentUrl(doc.url)) {
    return {
      body: buildSeedPlaceholderPdf(doc.name || doc.fileName),
      contentType: 'application/pdf',
      fileName: doc.fileName?.toLowerCase().endsWith('.pdf')
        ? doc.fileName
        : `${doc.fileName || 'document'}.pdf`,
      url: doc.url,
    };
  }

  const r2 = await getFromR2(doc.url);
  if (!r2) {
    return {
      body: null as Buffer | null,
      contentType: doc.mimeType ?? 'application/octet-stream',
      fileName: doc.fileName,
      url: doc.url,
    };
  }

  return {
    body: r2.body,
    contentType: r2.contentType ?? doc.mimeType ?? 'application/octet-stream',
    fileName: doc.fileName,
    url: doc.url,
  };
}
