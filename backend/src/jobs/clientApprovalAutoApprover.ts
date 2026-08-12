import prisma from '../config/database';
import { defaultLockDays } from '../services/clientVisibilityPolicy';
import { executePendingEditApproval, executePendingSubmissionApproval } from '../services/clientApprovalExecutor';
import { buildApprovalChain, enrichEntityChainState, isAtFinalApprovalStep } from '../services/approvalChain';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let intervalTimer: ReturnType<typeof setInterval> | null = null;

async function resolveSystemApproverId(subCompanyId: string): Promise<string | null> {
  const approver = await prisma.user.findFirst({
    where: {
      isActive: true,
      subCompanyId,
      role: { in: ['director', 'company_director', 'super_admin'] },
    },
    select: { id: true },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  });
  return approver?.id ?? null;
}

function approvalCutoffFromVisibilityDays(days: number): Date {
  if (days <= 0) return new Date();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
}

async function autoApproveExpiredForAgency(subCompanyId: string, cutoff: Date): Promise<void> {
  const approverUserId = await resolveSystemApproverId(subCompanyId);
  if (!approverUserId) return;

  const [expiredSubmissions, expiredEdits] = await Promise.all([
    prisma.pendingClientSubmission.findMany({
      where: {
        subCompanyId,
        submissionSource: 'agency',
        submittedAt: { lte: cutoff },
      },
      select: {
        id: true,
        submitterRole: true,
        currentStepIndex: true,
        approvalChain: true,
        managerApprovedAt: true,
      },
    }),
    prisma.pendingClientEdit.findMany({
      where: { subCompanyId, submittedAt: { lte: cutoff } },
      select: {
        id: true,
        submitterRole: true,
        currentStepIndex: true,
        approvalChain: true,
        managerApprovedAt: true,
      },
    }),
  ]);

  for (const row of expiredSubmissions) {
    try {
      const built = await buildApprovalChain(
        row.submitterRole ?? 'sales_associate',
        'client_manual_add',
        subCompanyId,
      );
      const state = enrichEntityChainState(row, built);
      if (!isAtFinalApprovalStep(state)) continue;

      await executePendingSubmissionApproval({
        pendingId: row.id,
        subCompanyId,
        approverUserId,
        autoApproved: true,
      });
    } catch (err) {
      console.error('[clientApprovalAutoApprover] Failed submission', row.id, err);
    }
  }

  for (const row of expiredEdits) {
    try {
      const built = await buildApprovalChain(
        row.submitterRole ?? 'sales_associate',
        'client_manual_edit',
        subCompanyId,
      );
      const state = enrichEntityChainState(row, built);
      if (!isAtFinalApprovalStep(state)) continue;

      await executePendingEditApproval({
        pendingEditId: row.id,
        subCompanyId,
        approverUserId,
        autoApproved: true,
      });
    } catch (err) {
      console.error('[clientApprovalAutoApprover] Failed edit', row.id, err);
    }
  }
}

async function runOnce(): Promise<void> {
  try {
    const visibilitySettings = await prisma.clientVisibilitySetting.findMany({
      select: { subCompanyId: true, days: true },
    });
    const visibilityByAgency = new Map(visibilitySettings.map((s) => [s.subCompanyId, s.days]));

    const agencyIds = new Set<string>(
      [
        ...visibilitySettings.map((s) => s.subCompanyId),
        ...(
          await prisma.pendingClientSubmission.findMany({
            where: { subCompanyId: { not: null }, submissionSource: 'agency' },
            select: { subCompanyId: true },
            distinct: ['subCompanyId'],
          })
        ).map((r) => r.subCompanyId!),
        ...(
          await prisma.pendingClientEdit.findMany({
            select: { subCompanyId: true },
            distinct: ['subCompanyId'],
          })
        ).map((r) => r.subCompanyId),
      ].filter((id): id is string => !!id),
    );

    for (const subCompanyId of agencyIds) {
      const days = defaultLockDays(visibilityByAgency.get(subCompanyId));
      const cutoff = approvalCutoffFromVisibilityDays(days);
      await autoApproveExpiredForAgency(subCompanyId, cutoff);
    }
  } catch (err) {
    console.error('[clientApprovalAutoApprover] Error:', err);
  }
}

export function startClientApprovalAutoApprover(): void {
  if (intervalTimer) return;
  void runOnce();
  intervalTimer = setInterval(() => void runOnce(), CHECK_INTERVAL_MS);
  console.log('✅ Client approval auto-approver started (1-hour interval)');
}

export function stopClientApprovalAutoApprover(): void {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}
