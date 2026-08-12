/**
 * Status-only approval meta for Daily Agenda pending-request rows.
 */
import { ROLE_LABELS } from '../config/permissions';

export type ApprovalStatusMeta = {
  requesterName?: string;
  currentStepIndex?: number;
  totalSteps?: number;
  awaitingRoleKey?: string;
  stepLabel: string;
};

const DIRECTOR_STEP_ROLES = new Set([
  'company_director',
  'director',
  'super_admin',
  'dev_team',
]);

/** Pending-requests tab + hierarchy totals — include requester-owned status rows. */
export function includeRequesterPendingStatus(filter: string): boolean {
  return filter === 'awaiting_approval' || filter === 'all';
}

export function isDirectorApprovalRole(roleKey: string | undefined): boolean {
  return !!roleKey && DIRECTOR_STEP_ROLES.has(roleKey);
}

function parseApprovalChain(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((k): k is string => typeof k === 'string' && k.length > 0);
}

function formatApprovalRoleLabel(roleKey: string): string {
  if (ROLE_LABELS[roleKey]) return ROLE_LABELS[roleKey];
  return roleKey
    .split('_')
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' ');
}

/**
 * Build step / awaiting labels from entity approvalChain when present,
 * with legacy manager→director fallback for client queues.
 */
export function buildApprovalStatusMeta(opts: {
  requesterName?: string | null;
  approvalChain?: unknown;
  currentStepIndex?: number | null;
  managerApprovedAt?: Date | null;
  /** Used when there is no chain (e.g. "Manager", "approver") */
  fallbackAwaitingLabel?: string;
}): ApprovalStatusMeta {
  const requesterName = opts.requesterName?.trim() || undefined;
  const chain = parseApprovalChain(opts.approvalChain);

  if (chain.length > 0) {
    const idx = Math.min(
      Math.max(typeof opts.currentStepIndex === 'number' ? opts.currentStepIndex : 0, 0),
      chain.length - 1,
    );
    const awaitingRoleKey = chain[idx];
    const roleLabel = formatApprovalRoleLabel(awaitingRoleKey);
    const stepNum = idx + 1;
    const base = `Step ${stepNum} of ${chain.length} · awaiting ${roleLabel}`;
    const stepLabel =
      opts.managerApprovedAt && idx > 0 ? `Manager forwarded · ${base}` : base;
    return {
      requesterName,
      currentStepIndex: idx,
      totalSteps: chain.length,
      awaitingRoleKey,
      stepLabel,
    };
  }

  if (opts.managerApprovedAt) {
    return {
      requesterName,
      currentStepIndex: 1,
      totalSteps: 2,
      awaitingRoleKey: 'company_director',
      stepLabel: 'Manager forwarded · awaiting Company Director',
    };
  }

  const awaiting = opts.fallbackAwaitingLabel?.trim() || 'approver';
  return {
    requesterName,
    stepLabel: `Awaiting ${awaiting}`,
  };
}
