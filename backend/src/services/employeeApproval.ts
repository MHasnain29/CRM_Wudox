/**
 * Employee add approval (step 1): save → pending (agreement + default
 * trainings auto-sent), manager approve → master. Final approve requires
 * required docs, signed agreement, and both default training certificates.
 */
import type { DocumentType, Prisma } from '@prisma/client';
import prisma from '../config/database';
import { submitEntityForApproval } from './approvalActions';
import { getEmployeeById } from './employees';
import {
  assertEmployeeAgreementSigned,
  syncEmployeeOnboardingAgreement,
} from './employeeOnboardingDocs';
import {
  assertEmployeeTrainingsComplete,
  sendDefaultEmployeeTrainings,
} from './employeeDefaultTraining';

/** Required before final manager approval (in addition to signed agreement). */
export const REQUIRED_EMPLOYEE_DOC_TYPES: DocumentType[] = [
  'photo_id',
  'sin',
  'proof_of_status',
];

export function missingRequiredEmployeeDocs(presentTypes: DocumentType[]): DocumentType[] {
  const set = new Set(presentTypes);
  return REQUIRED_EMPLOYEE_DOC_TYPES.filter((t) => !set.has(t));
}

export async function assertEmployeeDocsReady(employeeId: string): Promise<void> {
  const docs = await prisma.employeeDocument.findMany({
    where: { employeeId },
    select: { type: true },
  });
  const missing = missingRequiredEmployeeDocs(docs.map((d) => d.type));
  if (missing.length > 0) {
    throw Object.assign(
      new Error(
        `Missing required documents before approval: ${missing.join(', ')}. Upload photo ID, SIN, and proof of status.`,
      ),
      { status: 400 },
    );
  }
}

async function assertReadyForMaster(
  employeeId: string,
  agencyIds: string[],
  actorId: string,
): Promise<void> {
  // Best-effort PandaDoc refresh so a just-signed doc is picked up without a manual Sync.
  try {
    await syncEmployeeOnboardingAgreement({ employeeId, agencyIds, actorId });
  } catch {
    // Ignore sync failures — assert below uses stored status / uploaded agreement.
  }
  await assertEmployeeDocsReady(employeeId);
  await assertEmployeeAgreementSigned(employeeId);
  await assertEmployeeTrainingsComplete(employeeId);
}

export async function finalizeEmployeeAddApproval(
  employeeId: string,
  agencyIds: string[],
  approverId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  try {
    await assertReadyForMaster(employeeId, agencyIds, approverId);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    return { ok: false, error: (err as Error).message, status };
  }

  const existing = await prisma.employee.findFirst({
    where: {
      id: employeeId,
      approvalStatus: 'pending',
      addedBy: {
        subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
      },
    },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: 'Not found', status: 404 };

  await prisma.employee.update({
    where: { id: employeeId },
    data: {
      approvalStatus: 'approved',
      // Master = available for placement only. Job/client link sets workStatus later.
      workStatus: 'none',
      approvedById: approverId,
      approvedAt: new Date(),
      rejectedById: null,
      rejectedAt: null,
      rejectionReason: null,
    },
  });
  return { ok: true };
}

export async function finalizeEmployeeAddRejection(
  employeeId: string,
  agencyIds: string[],
  rejecterId: string,
  reason?: string | null,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const existing = await prisma.employee.findFirst({
    where: {
      id: employeeId,
      approvalStatus: 'pending',
      addedBy: {
        subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
      },
    },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: 'Not found', status: 404 };

  await prisma.employee.update({
    where: { id: employeeId },
    data: {
      approvalStatus: 'rejected',
      workStatus: 'none',
      rejectedById: rejecterId,
      rejectedAt: new Date(),
      rejectionReason: reason?.trim() || null,
    },
  });
  return { ok: true };
}

export async function submitEmployeeForApproval(params: {
  employeeId: string;
  agencyIds: string[];
  subCompanyId: string;
  submitterUserId: string;
  submitterRoleKey: string;
  submitterPermissions: string[];
}) {
  const emp = await prisma.employee.findFirst({
    where: {
      id: params.employeeId,
      approvalStatus: { in: ['pending', 'rejected'] },
      addedBy: {
        subCompanyId:
          params.agencyIds.length === 1 ? params.agencyIds[0] : { in: params.agencyIds },
      },
    },
    select: { id: true, approvalStatus: true },
  });
  if (!emp) {
    throw Object.assign(new Error('Employee not found or not eligible for submission'), {
      status: 404,
    });
  }

  // Docs / agreement / training are checked on final approve only so Save can move to Pending.
  try {
    await sendDefaultEmployeeTrainings({
      employeeId: params.employeeId,
      sentByUserId: params.submitterUserId,
      agencyIds: params.agencyIds,
    });
  } catch (err) {
    console.error('[employeeApproval] default trainings on submit', err);
  }

  if (emp.approvalStatus === 'rejected') {
    await prisma.employee.update({
      where: { id: params.employeeId },
      data: {
        approvalStatus: 'pending',
        workStatus: 'none',
        rejectedById: null,
        rejectedAt: null,
        rejectionReason: null,
        approvedById: null,
        approvedAt: null,
        submitterRole: null,
        approvalChain: [] as unknown as Prisma.InputJsonValue,
        currentStepIndex: 0,
      },
    });
  }

  await prisma.employee.update({
    where: { id: params.employeeId },
    data: { submitterRole: params.submitterRoleKey },
  });

  const result = await submitEntityForApproval({
    workflow: 'employee_add',
    entityId: params.employeeId,
    subCompanyId: params.subCompanyId,
    submitterUserId: params.submitterUserId,
    submitterRoleKey: params.submitterRoleKey,
    submitterPermissions: params.submitterPermissions,
  });

  if (result.misconfigured) {
    throw Object.assign(new Error('Approval route is misconfigured for this agency'), {
      status: 400,
    });
  }

  const employee = await getEmployeeById(params.employeeId, params.agencyIds);
  return { ...result, employee };
}

/** Apply Active immediately when agency policy bypasses employee_add — only if agreement is signed. */
export async function maybeAutoApproveNewEmployee(params: {
  employeeId: string;
  subCompanyId: string;
  submitterUserId: string;
  submitterRoleKey: string;
  submitterPermissions: string[];
}): Promise<void> {
  const { resolveApprovalRouting } = await import('./approvalChain');
  const { bypassed } = await resolveApprovalRouting(
    params.submitterRoleKey,
    'employee_add',
    params.subCompanyId,
  );
  if (!bypassed) return;

  const finalized = await finalizeEmployeeAddApproval(
    params.employeeId,
    [params.subCompanyId],
    params.submitterUserId,
  );
  if (!finalized.ok) return;

  await prisma.employee.update({
    where: { id: params.employeeId },
    data: {
      submitterRole: params.submitterRoleKey,
      approvalChain: [] as unknown as Prisma.InputJsonValue,
      currentStepIndex: 0,
    },
  });
}
