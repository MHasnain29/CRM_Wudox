/**
 * Data scope for list/filter: who can see what (from RBAC scope_level).
 */

import type { Request } from 'express';
import type { DataScopeLevel } from '@prisma/client';
import type { JwtPayload } from '../middleware/auth';
import { isAgencyIndependentRole } from '../config/agencyIndependentRoles';
import { resolveAllowedSubCompanyIds } from '../config/agencyScope';
import { buildAccessContext, scopeAtLeast, canAccessMultipleAgencies, type AccessContext } from '../services/accessContext';
import { effectiveActorId } from '../middleware/actAs';

export interface DataScope {
  subCompanyId: string;
  locationIds?: string[];
  ownerId?: string;
  allowedUserIds?: string[];
}

function scopeFromLevel(level: DataScopeLevel, user: JwtPayload): DataScope {
  if (level === 'global' || level === 'agency') {
    return { subCompanyId: user.subCompanyId };
  }
  if (level === 'team') {
    return {
      subCompanyId: user.subCompanyId,
      ownerId: user.sub,
    };
  }
  return {
    subCompanyId: user.subCompanyId,
    ownerId: user.sub,
  };
}

export async function getDataScopeAsync(
  user: JwtPayload | undefined,
  req?: Request & { access?: AccessContext },
): Promise<DataScope | null> {
  if (!user?.sub) return null;

  const ctx = req?.access ?? (await buildAccessContext(user));
  const homeAgency = user.subCompanyId?.trim() || '';
  // Under act-as, team/own owner filters must use the linked target, not JWT sub.
  const actorId = req?.user ? effectiveActorId(req) : user.sub;

  if (!homeAgency && isAgencyIndependentRole(user.role)) {
    const allowedIds = await resolveAllowedSubCompanyIds(user, req);
    const anchorId = allowedIds[0] ?? '';
    if (scopeAtLeast(ctx.scopeLevel, 'agency') && canAccessMultipleAgencies(ctx)) {
      return { subCompanyId: anchorId };
    }
    if (scopeAtLeast(ctx.scopeLevel, 'team')) {
      return { subCompanyId: anchorId, ownerId: actorId };
    }
    return { subCompanyId: anchorId, ownerId: actorId };
  }

  if (!homeAgency) return null;
  return scopeFromLevel(ctx.scopeLevel, { ...user, sub: actorId, subCompanyId: homeAgency });
}

/** @deprecated Prefer getDataScopeAsync — sync fallback uses request access or builds from DB */
export function getDataScope(user: JwtPayload | undefined): DataScope | null {
  if (!user?.sub) return null;
  if (!user.subCompanyId?.trim() && isAgencyIndependentRole(user.role)) {
    return { subCompanyId: '', ownerId: user.sub };
  }
  if (!user.subCompanyId?.trim()) return null;
  return scopeFromLevel('own', user);
}

export function getDataScopeFromContext(ctx: AccessContext, user: JwtPayload): DataScope {
  return scopeFromLevel(ctx.scopeLevel, user);
}

export function canViewAllInAgencyFromContext(ctx: AccessContext): boolean {
  return scopeAtLeast(ctx.scopeLevel, 'agency');
}

export function canViewTeamFromContext(ctx: AccessContext): boolean {
  return scopeAtLeast(ctx.scopeLevel, 'team');
}

export function isOwnScopeFromContext(ctx: AccessContext): boolean {
  return ctx.scopeLevel === 'own';
}
