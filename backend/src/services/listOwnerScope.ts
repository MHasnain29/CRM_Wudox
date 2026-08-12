/**
 * Shared owner/team filters for list endpoints (tasks, meetings, calls, etc.)
 * driven by RBAC data scope — not hardcoded role names.
 */
import type { Request } from 'express';
import type { DataScopeLevel } from '@prisma/client';
import prisma from '../config/database';
import {
  canAccessMultipleAgencies,
  canViewAllDataInAgency,
  canViewTeamData,
  isOwnDataOnlyScope,
  scopeAtLeast,
} from './accessContext';
import { getDataScopeLevelForRoleKey } from './rbac';
import { ensureAccessContext } from '../utils/requestPermission';
import { effectiveActorId } from '../middleware/actAs';

export type OwnerIdWhere =
  | string
  | { in: string[] }
  | { not: string }
  | undefined;

async function directReportIds(managerId: string, subCompanyId: string): Promise<string[]> {
  const reports = await prisma.user.findMany({
    where: { subCompanyId, reportingManagerIds: { has: managerId }, isActive: true },
    select: { id: true },
  });
  return reports.map((u) => u.id);
}

export async function teamMemberIds(userId: string, subCompanyId: string): Promise<string[]> {
  return [userId, ...(await directReportIds(userId, subCompanyId))];
}

export async function resolveScopeLevelForRole(roleKey: string | undefined): Promise<DataScopeLevel> {
  if (!roleKey) return 'own';
  return (await getDataScopeLevelForRoleKey(roleKey)) ?? 'own';
}

/** Build Prisma `ownerId` filter for agency-scoped list routes. */
export async function buildOwnerIdFilterForList(
  req: Request,
  opts: {
    userId: string;
    primarySubCompanyId: string;
    scope?: 'mine' | 'team' | 'all';
    explicitOwnerId?: string;
    ownerIdsList?: string[];
  },
): Promise<OwnerIdWhere> {
  const ctx = await ensureAccessContext(req);
  if (!ctx) return opts.userId;

  const canFilterByOwners = canAccessMultipleAgencies(ctx) || canViewTeamData(ctx);
  const seesAgencyWide = canViewAllDataInAgency(ctx) || canAccessMultipleAgencies(ctx);

  if (opts.ownerIdsList && opts.ownerIdsList.length > 0 && canFilterByOwners) {
    return { in: opts.ownerIdsList };
  }
  if (opts.explicitOwnerId) {
    return opts.explicitOwnerId;
  }

  if (opts.scope === 'mine') {
    return opts.userId;
  }

  if (opts.scope === 'team') {
    if (seesAgencyWide) {
      return { not: opts.userId };
    }
    if (canViewTeamData(ctx)) {
      const ids = await teamMemberIds(opts.userId, opts.primarySubCompanyId);
      return ids.length > 0 ? { in: ids } : { in: [] };
    }
    return opts.userId;
  }

  if (opts.scope === 'all' || seesAgencyWide) {
    return undefined;
  }

  if (canViewTeamData(ctx)) {
    const ids = await teamMemberIds(opts.userId, opts.primarySubCompanyId);
    return { in: ids };
  }

  return opts.userId;
}

export async function canAssignTasksToOthers(req: Request): Promise<boolean> {
  const ctx = await ensureAccessContext(req);
  return ctx ? canViewTeamData(ctx) : false;
}

/** Validate task assignee when creator assigns to someone else. */
export async function assertCanAssignTaskToUser(
  req: Request,
  owner: { role: string; reportingManagerIds: string[] | null },
): Promise<string | null> {
  if (!req.user) return 'Unauthorized';
  const ctx = await ensureAccessContext(req);
  if (!ctx || isOwnDataOnlyScope(ctx)) {
    return 'You can only create tasks for yourself';
  }
  if (!canViewTeamData(ctx)) {
    return 'You can only create tasks for yourself';
  }

  const targetScope = await resolveScopeLevelForRole(owner.role);
  if (scopeAtLeast(targetScope, 'agency') && !scopeAtLeast(ctx.scopeLevel, 'agency')) {
    return 'You cannot assign tasks to this user';
  }

  if (scopeAtLeast(ctx.scopeLevel, 'team') && !scopeAtLeast(ctx.scopeLevel, 'agency')) {
    // Under act-as, reports belong to the linked target — not the real login user.
    const actorId = effectiveActorId(req);
    const isDirect = owner.reportingManagerIds?.includes(actorId) ?? false;
    if (!isDirect) {
      return 'You can only assign tasks to your direct reports';
    }
  }

  return null;
}

export async function resolveClientLeadVisibleOwnerIdsFromScope(params: {
  scopeLevel: DataScopeLevel;
  viewerUserId?: string;
  subCompanyId: string;
}): Promise<Set<string> | null> {
  if (!params.viewerUserId) return null;
  if (params.scopeLevel === 'own') return new Set([params.viewerUserId]);
  if (scopeAtLeast(params.scopeLevel, 'agency')) return null;
  if (params.scopeLevel === 'team') {
    const ids = await teamMemberIds(params.viewerUserId, params.subCompanyId);
    return new Set(ids);
  }
  return new Set([params.viewerUserId]);
}

export async function resolveContactedScopeUserIdsFromScope(params: {
  userId: string;
  scopeLevel: DataScopeLevel;
  subCompanyId: string;
  scope?: 'mine' | 'team';
}): Promise<string[]> {
  if (params.scope !== 'team') return [params.userId];
  if (scopeAtLeast(params.scopeLevel, 'agency')) {
    const all = await prisma.user.findMany({
      where: { subCompanyId: params.subCompanyId, isActive: true },
      select: { id: true },
    });
    return all.map((u) => u.id);
  }
  if (params.scopeLevel === 'team') {
    return teamMemberIds(params.userId, params.subCompanyId);
  }
  return [params.userId];
}

export function isOwnScopeLevel(scopeLevel: DataScopeLevel): boolean {
  return scopeLevel === 'own';
}
