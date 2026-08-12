/**
 * Recruitment Active Clients — agency-scoped CRUD (separate from Marketing Client DB).
 */
import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import {
  trainingSummaryFromActiveClient,
  uploadActiveClientTrainingTemplate,
  validateClientTrainingInput,
} from './activeClientTraining';
import {
  isAllowedActiveClientTrainingTemplateId,
  resolveActiveClientTrainingTemplate,
} from './activeClientTrainingTemplates';

export type ActiveClientInput = {
  name: string;
  industry: string;
  location: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  status?: 'active' | 'inactive';
  notes?: string | null;
  clientTraining?: boolean;
  trainingFileBase64?: string | null;
  trainingFileName?: string | null;
  trainingMimeType?: string | null;
  trainingPandaDocTemplateId?: string | null;
};

function serializeActiveClient(
  row: {
    id: string;
    name: string;
    industry: string;
    location: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string;
    status: 'active' | 'inactive';
    notes: string | null;
    clientTraining?: boolean;
    trainingFileKey?: string | null;
    trainingFileName?: string | null;
    trainingPandaDocTemplateId?: string | null;
    trainingPandaDocTemplateName?: string | null;
    subCompanyId: string;
    createdById: string;
    createdAt: Date;
    updatedAt: Date;
    _count?: { jobs: number; employeeAssignments: number };
  },
  extras?: { jobCount?: number; placedEmployeeCount?: number },
) {
  const training = trainingSummaryFromActiveClient({
    clientTraining: Boolean(row.clientTraining),
    trainingFileKey: row.trainingFileKey ?? null,
    trainingFileName: row.trainingFileName ?? null,
    trainingPandaDocTemplateId: row.trainingPandaDocTemplateId ?? null,
    trainingPandaDocTemplateName: row.trainingPandaDocTemplateName ?? null,
  });
  return {
    id: row.id,
    name: row.name,
    industry: row.industry,
    location: row.location,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    status: row.status,
    notes: row.notes,
    clientTraining: training.clientTraining,
    hasTrainingDocument: training.hasDocument,
    trainingFileName: training.trainingFileName,
    trainingPandaDocTemplateId: training.trainingPandaDocTemplateId,
    trainingPandaDocTemplateName: training.trainingPandaDocTemplateName,
    agencyId: row.subCompanyId,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    jobCount: extras?.jobCount ?? row._count?.jobs ?? 0,
    placedEmployeeCount: extras?.placedEmployeeCount ?? row._count?.employeeAssignments ?? 0,
  };
}

export async function listActiveClients(params: {
  agencyIds: string[];
  search?: string;
  status?: 'active' | 'inactive';
  page?: number;
  pageSize?: number;
  /** Optional owner ("my records") filter on createdById; null = no narrowing. */
  ownerWhere?: Record<string, unknown> | null;
}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 50));
  const baseWhere: Prisma.ActiveClientWhereInput = {
    subCompanyId:
      params.agencyIds.length === 1 ? params.agencyIds[0] : { in: params.agencyIds },
  };
  if (params.status) baseWhere.status = params.status;
  if (params.search?.trim()) {
    const q = params.search.trim();
    baseWhere.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { industry: { contains: q, mode: 'insensitive' } },
      { location: { contains: q, mode: 'insensitive' } },
      { contactName: { contains: q, mode: 'insensitive' } },
      { contactEmail: { contains: q, mode: 'insensitive' } },
    ];
  }
  // Wrap with AND so the owner fragment never clobbers subCompanyId/search.
  const where: Prisma.ActiveClientWhereInput = params.ownerWhere
    ? { AND: [baseWhere, params.ownerWhere as Prisma.ActiveClientWhereInput] }
    : baseWhere;

  const [total, rows] = await Promise.all([
    prisma.activeClient.count({ where }),
    prisma.activeClient.findMany({
      where,
      include: {
        _count: {
          select: {
            jobs: true,
            employeeAssignments: true,
          },
        },
      },
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  // Count only active placements separately (Prisma filtered relation count varies by version)
  const clientIds = rows.map((r) => r.id);
  const placementCounts = clientIds.length
    ? await prisma.employeeAssignment.groupBy({
        by: ['activeClientId'],
        where: {
          activeClientId: { in: clientIds },
          isActive: true,
          status: 'approved',
          endedAt: null,
        },
        _count: { _all: true },
      })
    : [];
  const placedMap = new Map(
    placementCounts.map((p) => [p.activeClientId!, p._count._all]),
  );

  return {
    data: rows.map((r) =>
      serializeActiveClient(r, {
        jobCount: r._count.jobs,
        placedEmployeeCount: placedMap.get(r.id) ?? 0,
      }),
    ),
    total,
    page,
    pageSize,
  };
}

export async function getActiveClientById(id: string, agencyIds: string[]) {
  const row = await prisma.activeClient.findFirst({
    where: {
      id,
      subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
    },
    include: {
      jobs: {
        select: {
          id: true,
          title: true,
          status: true,
          location: true,
          openPositions: true,
          company: true,
          jobType: true,
          employmentType: true,
          filledPositions: true,
          scheduledPositions: true,
          backupPercentage: true,
          salaryMin: true,
          salaryMax: true,
          shiftSchedule: true,
          publishLinkedin: true,
          publishIndeed: true,
          publishGlassdoor: true,
          createdAt: true,
          closedAt: true,
          applicantCount: true,
        },
        orderBy: { updatedAt: 'desc' },
      },
      employeeAssignments: {
        where: { isActive: true, status: 'approved', endedAt: null },
        include: {
          employee: {
            select: { id: true, firstName: true, lastName: true, workStatus: true },
          },
        },
        orderBy: { approvedAt: 'desc' },
      },
    },
  });
  if (!row) return null;

  return {
    ...serializeActiveClient(row, {
      jobCount: row.jobs.length,
      placedEmployeeCount: row.employeeAssignments.length,
    }),
    jobs: row.jobs.map((j) => ({
      id: j.id,
      title: j.title,
      status: j.status,
      location: j.location,
      openPositions: j.openPositions,
      company: j.company,
      jobType: j.jobType,
      employmentType: j.employmentType,
      filledPositions: j.filledPositions,
      scheduledPositions: j.scheduledPositions,
      backupPercentage: j.backupPercentage,
      salaryMin: j.salaryMin != null ? Number(j.salaryMin) : null,
      salaryMax: j.salaryMax != null ? Number(j.salaryMax) : null,
      shiftSchedule: j.shiftSchedule,
      publishSettings: {
        linkedin: j.publishLinkedin,
        indeed: j.publishIndeed,
        glassdoor: j.publishGlassdoor,
      },
      createdAt: j.createdAt.toISOString(),
      closedAt: j.closedAt?.toISOString() ?? null,
      applicantCount: j.applicantCount,
    })),
    placements: row.employeeAssignments.map((a) => ({
      id: a.id,
      employeeId: a.employeeId,
      employeeName: `${a.employee.firstName} ${a.employee.lastName}`.trim(),
      workStatus: a.employee.workStatus,
      jobId: a.jobId,
      positionTitle: a.positionTitle,
    })),
  };
}

export async function createActiveClient(params: {
  input: ActiveClientInput;
  subCompanyId: string;
  createdById: string;
}) {
  const wantsTraining = Boolean(params.input.clientTraining);
  const templateId = params.input.trainingPandaDocTemplateId?.trim() || null;
  validateClientTrainingInput({
    clientTraining: wantsTraining,
    trainingFileBase64: params.input.trainingFileBase64,
    trainingFileName: params.input.trainingFileName,
    trainingPandaDocTemplateId: templateId,
    hasExistingDocument: false,
  });

  let pandaName: string | null = null;
  if (wantsTraining && templateId && isAllowedActiveClientTrainingTemplateId(templateId)) {
    pandaName = resolveActiveClientTrainingTemplate(templateId).name;
  }

  const row = await prisma.activeClient.create({
    data: {
      name: params.input.name.trim(),
      industry: params.input.industry.trim(),
      location: params.input.location.trim(),
      contactName: params.input.contactName.trim(),
      contactEmail: params.input.contactEmail.trim(),
      contactPhone: params.input.contactPhone.trim(),
      status: params.input.status ?? 'active',
      notes: params.input.notes?.trim() || null,
      clientTraining: wantsTraining,
      trainingPandaDocTemplateId: wantsTraining ? templateId : null,
      trainingPandaDocTemplateName: wantsTraining ? pandaName : null,
      subCompanyId: params.subCompanyId,
      createdById: params.createdById,
    },
  });

  if (
    wantsTraining &&
    !templateId &&
    params.input.trainingFileBase64 &&
    params.input.trainingFileName
  ) {
    try {
      const uploaded = await uploadActiveClientTrainingTemplate({
        activeClientId: row.id,
        subCompanyId: params.subCompanyId,
        fileBase64: params.input.trainingFileBase64,
        fileName: params.input.trainingFileName,
        mimeType: params.input.trainingMimeType,
      });
      const updated = await prisma.activeClient.update({
        where: { id: row.id },
        data: {
          trainingFileKey: uploaded.trainingFileKey,
          trainingFileName: uploaded.trainingFileName,
          trainingMimeType: uploaded.trainingMimeType,
          trainingFileSize: uploaded.trainingFileSize,
        },
      });
      return serializeActiveClient(updated);
    } catch (err) {
      await prisma.activeClient.delete({ where: { id: row.id } }).catch(() => undefined);
      throw err;
    }
  }

  return serializeActiveClient(row);
}

export async function updateActiveClient(
  id: string,
  agencyIds: string[],
  input: Partial<ActiveClientInput>,
) {
  const existing = await prisma.activeClient.findFirst({
    where: {
      id,
      subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
    },
    select: {
      id: true,
      subCompanyId: true,
      clientTraining: true,
      trainingFileKey: true,
      trainingPandaDocTemplateId: true,
    },
  });
  if (!existing) return null;

  const nextTraining =
    input.clientTraining !== undefined ? Boolean(input.clientTraining) : existing.clientTraining;
  const hasNewFile = Boolean(input.trainingFileBase64?.trim());
  const nextTemplateId =
    input.trainingPandaDocTemplateId !== undefined
      ? input.trainingPandaDocTemplateId?.trim() || null
      : existing.trainingPandaDocTemplateId;
  validateClientTrainingInput({
    clientTraining: nextTraining,
    trainingFileBase64: input.trainingFileBase64,
    trainingFileName: input.trainingFileName,
    trainingPandaDocTemplateId: nextTemplateId,
    hasExistingDocument:
      Boolean(existing.trainingFileKey) ||
      Boolean(existing.trainingPandaDocTemplateId) ||
      hasNewFile,
  });

  const data: Prisma.ActiveClientUpdateInput = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.industry !== undefined) data.industry = input.industry.trim();
  if (input.location !== undefined) data.location = input.location.trim();
  if (input.contactName !== undefined) data.contactName = input.contactName.trim();
  if (input.contactEmail !== undefined) data.contactEmail = input.contactEmail.trim();
  if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone.trim();
  if (input.status !== undefined) data.status = input.status;
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;

  if (!nextTraining) {
    data.clientTraining = false;
    data.trainingFileKey = null;
    data.trainingFileName = null;
    data.trainingMimeType = null;
    data.trainingFileSize = null;
    data.trainingPandaDocTemplateId = null;
    data.trainingPandaDocTemplateName = null;
  } else {
    data.clientTraining = true;
    if (nextTemplateId && isAllowedActiveClientTrainingTemplateId(nextTemplateId)) {
      const tpl = resolveActiveClientTrainingTemplate(nextTemplateId);
      data.trainingPandaDocTemplateId = tpl.id;
      data.trainingPandaDocTemplateName = tpl.name;
      // Prefer PandaDoc over legacy uploaded PDF
      data.trainingFileKey = null;
      data.trainingFileName = null;
      data.trainingMimeType = null;
      data.trainingFileSize = null;
    } else if (hasNewFile && input.trainingFileBase64 && input.trainingFileName) {
      const uploaded = await uploadActiveClientTrainingTemplate({
        activeClientId: id,
        subCompanyId: existing.subCompanyId,
        fileBase64: input.trainingFileBase64,
        fileName: input.trainingFileName,
        mimeType: input.trainingMimeType,
      });
      data.trainingFileKey = uploaded.trainingFileKey;
      data.trainingFileName = uploaded.trainingFileName;
      data.trainingMimeType = uploaded.trainingMimeType;
      data.trainingFileSize = uploaded.trainingFileSize;
      data.trainingPandaDocTemplateId = null;
      data.trainingPandaDocTemplateName = null;
    }
  }

  const row = await prisma.activeClient.update({ where: { id }, data });
  return serializeActiveClient(row);
}

export async function deleteActiveClient(
  id: string,
  agencyIds: string[],
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const existing = await prisma.activeClient.findFirst({
    where: {
      id,
      subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
    },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: 'Not found', status: 404 };

  const [jobCount, assignmentCount] = await Promise.all([
    prisma.job.count({ where: { activeClientId: id } }),
    prisma.employeeAssignment.count({
      where: {
        activeClientId: id,
        OR: [{ isActive: true }, { status: 'pending' }, { endedAt: null, status: 'approved' }],
      },
    }),
  ]);

  if (jobCount > 0 || assignmentCount > 0) {
    return {
      ok: false,
      error:
        'Cannot delete: this client has linked jobs or active/pending employee placements. End placements and remove jobs first.',
      status: 409,
    };
  }

  await prisma.activeClient.delete({ where: { id } });
  return { ok: true };
}
