import type { Request } from 'express';
import type { JwtPayload } from '../middleware/auth';
import { isAgencyIndependentRole } from '../config/agencyIndependentRoles';
import {
  pickDefaultAgencyId,
  resolveAgencyScope,
  resolveAllowedSubCompanyIds,
} from '../config/agencyScope';

/**
 * Org-wide roles have no JWT home agency; pick the first allowed agency for single-agency routes.
 * List/cross-agency routes should still use resolveAllowedSubCompanyIds.
 */
export async function withEffectiveHomeAgency(
  user: JwtPayload,
  req?: Request,
): Promise<JwtPayload> {
  if (user.subCompanyId?.trim() || !isAgencyIndependentRole(user.role)) return user;
  const allowedIds = await resolveAllowedSubCompanyIds(user, req);
  const pick = pickDefaultAgencyId(null, allowedIds);
  if (!pick) return user;
  return { ...user, subCompanyId: pick };
}

export async function resolveEffectiveSubCompanyId(req: Request): Promise<string | null> {
  if (!req.user) return null;
  const hydrated = await withEffectiveHomeAgency(req.user, req);
  return hydrated.subCompanyId?.trim() || null;
}

export async function hydrateRequestUserAgency(req: Request): Promise<void> {
  if (!req.user) return;
  req.user = await withEffectiveHomeAgency(req.user, req);
}

/** @deprecated use resolveEffectiveSubCompanyId */
export async function resolveRequestSubCompanyId(req: Request): Promise<string | null> {
  if (!req.user) return null;
  const home = req.user.subCompanyId?.trim();
  if (home) return home;
  return resolveAgencyScope(req);
}
