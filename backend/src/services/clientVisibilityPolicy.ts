/**
 * Client visibility on create / import approve:
 * - Agency manual add / CSV import → Settings → Approvals workflows (all roles, including managers).
 *   Bypass policy or final approver self-action may auto-approve; otherwise Pending queue.
 * - Director / super_admin on non-explicit-agency paths → may be global immediately per role rules.
 * - Database Manager global database queue → not subject to agency Client Visibility delay.
 *   Agency-targeted import/add follows agency approval + Client Visibility.
 */
/** Roles whose agency creates skip the agency-only period (global immediately). */
export const IMMEDIATE_GLOBAL_CREATOR_ROLES = new Set(['director', 'super_admin']);

export function defaultLockDays(settingDays: number | null | undefined): number {
  return settingDays ?? 7;
}

export function resolveClientVisibility(params: {
  creatorRole: string | undefined;
  lockDays: number;
  /** Global database queue / org-global submission — never agency-locked. */
  globalDatabase?: boolean;
  /** Explicit agency destination — ignore immediate-global creator roles. */
  explicitAgencyPath?: boolean;
}): 'global' | 'agency' {
  if (params.globalDatabase) return 'global';
  if (params.explicitAgencyPath) {
    return params.lockDays <= 0 ? 'global' : 'agency';
  }
  if (params.creatorRole && IMMEDIATE_GLOBAL_CREATOR_ROLES.has(params.creatorRole)) {
    return 'global';
  }
  return params.lockDays <= 0 ? 'global' : 'agency';
}

/** User-facing note after a client row is created (notifications / API messages). */
export function describeClientVisibilityOutcome(lockDays: number, visibility: 'global' | 'agency'): string {
  if (visibility === 'global' || lockDays <= 0) {
    return 'It is now visible to all agencies.';
  }
  const unit = lockDays === 1 ? 'day' : 'days';
  return `It is available to your agency now and will be shared with all agencies after ${lockDays} ${unit} (Client Visibility setting).`;
}
