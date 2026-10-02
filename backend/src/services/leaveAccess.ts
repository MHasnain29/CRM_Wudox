import type { Request } from 'express';
import prisma from '../config/database';
import { resolveAllowedSubCompanyIds } from '../config/agencyScope';
import { ensureAccessContext } from '../utils/requestPermission';
import { hasPermission } from './accessContext';

export class LeaveAccessError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'LeaveAccessError';
  }
}

export type LeaveAccess = {
  isSuperAdmin: boolean;
  canApprove: boolean;
  userId: string;
  agencyIds: string[];
  selectedAgencyId: string | null;
  canAccessAgencylessOwners: boolean;
  actingAsUserId?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseAgencySelection(value: unknown, name: string, multiple = false): string[] | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') {
    throw new LeaveAccessError(400, `Invalid ${name}`);
  }
  const ids = (multiple ? value.split(',') : [value]).map((id) => id.trim());
  if (ids.some((id) => !UUID_RE.test(id))) {
    throw new LeaveAccessError(400, `Invalid ${name}`);
  }
  return [...new Set(ids)];
}

/** Leave scope must reject invalid selections instead of widening to all allowed agencies. */
export async function getLeaveAccess(req: Request): Promise<LeaveAccess> {
  if (!req.user?.sub) throw new LeaveAccessError(401, 'Unauthorized');

  const actingAsUserId = req.user.actAsUserId;
  // Authentication hydrates the real caller's context before act-as mutates req.user.
  // Never rebuild authority from the linked account if that prerequisite is missing.
  if (actingAsUserId && !req.access) throw new LeaveAccessError(403, 'Act-as context unavailable');
  const ctx = await ensureAccessContext(req);
  if (!ctx || ctx.userId !== req.user.sub) throw new LeaveAccessError(401, 'Unauthorized');

  const actAsHeader = req.headers?.['x-act-as-user-id'];
  if (actAsHeader !== undefined && typeof actAsHeader !== 'string') {
    throw new LeaveAccessError(400, 'Invalid act-as account');
  }
  const requestedActor = typeof actAsHeader === 'string' ? actAsHeader.trim() : '';
  if (requestedActor && requestedActor !== req.user.sub && requestedActor !== actingAsUserId) {
    // actAsMiddleware deliberately falls back on inactive accounts/lookup errors.
    // Leave writes must not silently fall back to the caller's broader agency scope.
    throw new LeaveAccessError(403, 'Act-as account unavailable');
  }

  const selected = parseAgencySelection(req.query.subCompanyId, 'subCompanyId');
  const requestedIds = parseAgencySelection(req.query.agencyIds, 'agencyIds', true);
  const selectedAgencyId = selected?.[0] ?? (requestedIds?.length === 1 ? requestedIds[0] : null);
  if (selected && requestedIds && !requestedIds.includes(selected[0])) {
    throw new LeaveAccessError(400, 'Agency selections do not match');
  }

  // The shared helper must see the real role/home agency, not the act-as mutation.
  let agencyIds = [...new Set(await resolveAllowedSubCompanyIds({
    ...req.user,
    role: ctx.roleKey,
    subCompanyId: ctx.subCompanyId,
    actAsUserId: undefined,
  }, req))];

  if (actingAsUserId) {
    const target = await prisma.user.findUnique({
      where: { id: actingAsUserId },
      select: { subCompanyId: true, isActive: true, offboardingStartedAt: true },
    });
    if (!target?.isActive || target.offboardingStartedAt) {
      throw new LeaveAccessError(403, 'Act-as account unavailable');
    }
    agencyIds = target.subCompanyId && agencyIds.includes(target.subCompanyId)
      ? [target.subCompanyId]
      : [];
  }

  const requested = [...(selected ?? []), ...(requestedIds ?? [])];
  if (requested.some((id) => !agencyIds.includes(id))) {
    throw new LeaveAccessError(403, 'You do not have access to the selected agency');
  }
  if (selected) agencyIds = selected;
  else if (requestedIds) agencyIds = requestedIds;

  const isSuperAdmin = ctx.roleKey === 'super_admin';
  return {
    isSuperAdmin,
    canApprove: hasPermission(ctx, 'leave:approve'),
    userId: req.user.sub,
    agencyIds,
    selectedAgencyId,
    canAccessAgencylessOwners: isSuperAdmin && !actingAsUserId && !selected && !requestedIds,
    ...(actingAsUserId ? { actingAsUserId } : {}),
  };
}

/** Callers separately enforce approval permission and prohibit self-approval. */
export function requireLeaveOwnerAccess(
  access: LeaveAccess,
  ownerUserId: string,
  ownerAgencyId: string | null,
): void {
  if (!ownerUserId || (ownerAgencyId
    ? !access.agencyIds.includes(ownerAgencyId)
    : !access.canAccessAgencylessOwners)) {
    throw new LeaveAccessError(403, 'You do not have access to this employee’s leave');
  }
}

export function requireLeaveConfig(access: LeaveAccess): void {
  if (!access.isSuperAdmin) {
    throw new LeaveAccessError(403, 'Only Super Admin can configure leave types and allowances');
  }
}

export function requireLeaveWriteAgency(access: LeaveAccess): string {
  if (access.agencyIds.length === 1) return access.agencyIds[0];
  if (access.agencyIds.length === 0) {
    throw new LeaveAccessError(403, 'No authorized agency is available');
  }
  throw new LeaveAccessError(400, 'Select an agency before changing leave settings');
}
