import type { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';

/**
 * Reads the X-Act-As-User-Id request header (set by the frontend when a single
 * linked user is selected in LinkedUserAgencyFilter).
 *
 * On valid header:
 *  - Validates target is in the caller's link group via two targeted DB lookups.
 *  - Mutates req.user.subCompanyId → target's agency (scope resolution).
 *  - Mutates req.user.role → target's role (agency scope stays narrow).
 *  - Sets req.user.actAsUserId for effectiveActorId() attribution.
 *
 * req.user.sub is NEVER mutated.
 * req.access / req.permissionKeys are NOT replaced — the real caller's full
 * permissions are preserved so requirePermission() never blocks the admin.
 * Agency scoping still narrows to the target's agency because resolveAgencyScope
 * and resolveAllowedSubCompanyIds both read req.user.subCompanyId / role.
 *
 * Graceful fallbacks:
 *  - Header absent or equals self → noop
 *  - Target not in link group → 403
 *  - Target no longer active → noop (silently acts as self)
 *  - Unexpected DB error → noop (never block a write because of act-as lookup)
 */
export async function actAsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers['x-act-as-user-id'];
  const actAsId = typeof header === 'string' ? header.trim() : undefined;

  if (!actAsId || !req.user?.sub || actAsId === req.user.sub) {
    return next();
  }

  try {
    // Call 1: get caller's link group
    const callerLink = await prisma.userAgencyLink.findFirst({
      where: { userId: req.user.sub },
      select: { groupId: true },
    });
    if (!callerLink) {
      res.status(403).json({ error: 'Act-as target is not a linked account' });
      return;
    }

    // Call 2: confirm target is in the same group AND fetch their active state
    const targetLink = await prisma.userAgencyLink.findFirst({
      where: { groupId: callerLink.groupId, userId: actAsId },
      include: {
        user: { select: { subCompanyId: true, isActive: true, offboardingStartedAt: true, role: true } },
      },
    });
    if (!targetLink) {
      res.status(403).json({ error: 'Act-as target is not a linked account' });
      return;
    }

    const target = targetLink.user;
    if (!target || !target.isActive || target.offboardingStartedAt) {
      // Target no longer active — silently act as self
      return next();
    }

    req.user.actAsUserId = actAsId;
    if (target.subCompanyId) {
      req.user.subCompanyId = target.subCompanyId;
    }
    // Set target's role so resolveAllowedSubCompanyIds scopes to their agency only.
    // req.access / req.permissionKeys stay as the real caller's — no permission downgrade.
    if (target.role) {
      req.user.role = target.role;
    }

    next();
  } catch {
    // Never block a write because of an act-as lookup failure
    next();
  }
}

/**
 * Returns the user ID to use for write attribution:
 * createdBy, ownerId, actorId, fromUserId, submittedBy, etc.
 *
 * Use this wherever a record should be "owned by" or "created by" the act-as
 * user rather than the real caller.
 */
export function effectiveActorId(req: Request): string {
  return req.user!.actAsUserId ?? req.user!.sub;
}
