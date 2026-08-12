import { Request } from 'express';
import type { JwtPayload } from '../middleware/auth';
import prisma from '../config/database';
import { isAgencyIndependentRole } from '../config/agencyIndependentRoles';
import { getRedis, isRedisEnabled } from './redis';
import {
  buildAccessContext,
  canAccessMultipleAgencies,
  type AccessContext,
} from '../services/accessContext';
import { ensureAccessContext } from '../utils/requestPermission';

const CACHE_TTL_SECONDS = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Prefer `req.access` / `canAccessMultipleAgencies` on the request. */
export async function isElevatedRoleForRequest(req: Request): Promise<boolean> {
  const ctx = await ensureAccessContext(req);
  return ctx ? canAccessMultipleAgencies(ctx) : false;
}

/** @deprecated Use isElevatedRoleForRequest(req) or req.access */
export function isElevatedRole(role: string | undefined, req?: Request): boolean {
  if (req?.access) return canAccessMultipleAgencies(req.access);
  void role;
  return false;
}

async function resolveContext(user: JwtPayload, req?: Request): Promise<AccessContext> {
  if (req) {
    const ctx = await ensureAccessContext(req);
    if (ctx) return ctx;
  }
  return buildAccessContext(user);
}

/** All agency ids for org-wide client list routes (Database Manager global database). */
export async function fetchAllAgencyIds(): Promise<string[]> {
  try {
    const rows = await prisma.subCompany.findMany({
      select: { id: true },
      orderBy: { name: 'asc' },
    });
    return rows.map((s) => s.id);
  } catch (err) {
    console.error('[agencyScope] fetchAllAgencyIds failed:', err);
    return [];
  }
}

export async function resolveAllowedSubCompanyIds(
  user: JwtPayload,
  req?: Request,
): Promise<string[]> {
  const ownSubCompanyId = user.subCompanyId?.trim() || null;
  if (user.role === 'database_manager') {
    return fetchAllAgencyIds();
  }

  const managed = await prisma.operationsManagerSubCompany.findMany({
    where: { userId: user.sub },
    select: { subCompanyId: true },
  });
  if (managed.length > 0) {
    return [...new Set(managed.map((m) => m.subCompanyId))];
  }

  const ctx = await resolveContext(user, req);

  // OM without explicit assignments must not inherit org-wide cross_org access.
  if (ctx.roleKey === 'operations_manager') {
    return ownSubCompanyId ? [ownSubCompanyId] : [];
  }

  if (!ownSubCompanyId) {
    if (canAccessMultipleAgencies(ctx)) {
      return await fetchAllAgencyIds();
    }
    return [];
  }

  if (!canAccessMultipleAgencies(ctx)) return [ownSubCompanyId];

  const cacheKey = `agency_scope:${user.sub}:${ctx.scopeLevel}`;

  if (isRedisEnabled()) {
    try {
      const redis = getRedis();
      const cached = redis ? await redis.get(cacheKey) : null;
      if (cached) {
        const parsed: string[] = JSON.parse(cached);
        if (!parsed.includes(ownSubCompanyId)) parsed.push(ownSubCompanyId);
        return parsed;
      }
    } catch (err) {
      console.warn('[agencyScope] Redis read failed, falling back to DB:', (err as Error).message);
    }
  }

  const ids =
    ctx.scopeLevel === 'global' || hasPermissionGlobal(ctx)
      ? await fetchAllAgencyIds()
      : await fetchOrgAgencyIds(ownSubCompanyId);

  if (isRedisEnabled()) {
    try {
      const redis = getRedis();
      if (redis) await redis.set(cacheKey, JSON.stringify(ids), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      console.warn('[agencyScope] Redis write failed:', (err as Error).message);
    }
  }

  return ids;
}

function hasPermissionGlobal(ctx: AccessContext): boolean {
  return ctx.permissions.includes('agencies:global') || ctx.roleKey === 'super_admin';
}

export async function clearAgencyScopeCache(userId: string): Promise<void> {
  if (!isRedisEnabled()) return;
  try {
    const redis = getRedis();
    if (redis) await redis.del(`agency_scope:${userId}`);
  } catch (err) {
    console.warn('[agencyScope] Cache clear failed:', (err as Error).message);
  }
}

export function parseAgencyIdsParam(raw: unknown): string[] {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s));
}

export type ListAgencyScope = {
  allowedIds: string[];
  scopeFilter: { subCompanyId: string } | { subCompanyId: { in: string[] } };
  primarySubCompanyId: string;
};

/** Agency context for list routes — does not require user.subCompanyId (org-level roles use allowed agencies). */
export async function resolveListAgencyScope(
  req: Request,
  agencyIdsParam?: string,
): Promise<ListAgencyScope | null> {
  if (!req.user) return null;

  const allowedIds = await resolveAllowedSubCompanyIds(req.user, req);
  if (allowedIds.length === 0) return null;

  const requestedIds = parseAgencyIdsParam(agencyIdsParam);
  const scopeFilter = buildSubCompanyFilter(allowedIds, requestedIds);
  const primarySubCompanyId =
    'subCompanyId' in scopeFilter && typeof scopeFilter.subCompanyId === 'string'
      ? scopeFilter.subCompanyId
      : allowedIds[0]!;

  return { allowedIds, scopeFilter, primarySubCompanyId };
}

export function buildSubCompanyFilter(
  allowedIds: string[],
  requestedIds: string[],
): { subCompanyId: string } | { subCompanyId: { in: string[] } } {
  const effective =
    requestedIds.length > 0
      ? requestedIds.filter((id) => allowedIds.includes(id))
      : allowedIds;

  const ids = effective.length > 0 ? effective : allowedIds;

  return ids.length === 1
    ? { subCompanyId: ids[0] }
    : { subCompanyId: { in: ids } };
}

/** Whether the user may access a resource in the given agency. */
export async function canAccessSubCompanyResource(
  user: JwtPayload,
  resourceSubCompanyId: string,
  req?: Request,
): Promise<boolean> {
  const allowedIds = await resolveAllowedSubCompanyIds(user, req);
  return allowedIds.includes(resourceSubCompanyId);
}

/** Default agency for scoped routes: home agency when allowed, else first assigned agency. */
export function pickDefaultAgencyId(
  userSubCompanyId: string | null | undefined,
  allowedIds: string[],
): string | null {
  if (allowedIds.length === 0) return userSubCompanyId ?? null;
  if (userSubCompanyId && allowedIds.includes(userSubCompanyId)) return userSubCompanyId;
  return allowedIds[0];
}

export function parseSubCompanyIdQuery(req: Request): string | undefined {
  const rawId = req.query.subCompanyId;
  if (Array.isArray(rawId)) {
    return typeof rawId[0] === 'string' ? rawId[0] : undefined;
  }
  return typeof rawId === 'string' ? rawId : undefined;
}

/** When user can access multiple agencies, writes must include ?subCompanyId= from the filter. */
export async function assertMultiAgencyWriteTarget(
  req: Request,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!req.user) return { ok: false, status: 401, error: 'Unauthorized' };
  const allowedIds = await resolveAllowedSubCompanyIds(req.user, req);
  if (allowedIds.length <= 1) return { ok: true };
  const requestedId = parseSubCompanyIdQuery(req);
  if (requestedId && UUID_RE.test(requestedId) && allowedIds.includes(requestedId)) {
    return { ok: true };
  }
  return {
    ok: false,
    status: 400,
    error: 'Select an agency in the filter before adding a client.',
  };
}

export async function resolveAgencyScope(req: Request): Promise<string | null> {
  const userSubCompanyId = req.user?.subCompanyId?.trim() || null;

  // When act-as is active the subCompanyId is already mutated to the act-as user's agency.
  // Ignore ?subCompanyId= so the real caller's agency doesn't silently override it.
  if (req.user?.actAsUserId) return userSubCompanyId;

  const rawId = req.query.subCompanyId;
  const requestedId: string | undefined = Array.isArray(rawId)
    ? (rawId[0] as string)
    : typeof rawId === 'string'
      ? rawId
      : undefined;

  if (!req.user) return null;

  if (req.user.role === 'database_manager') {
    if (requestedId && UUID_RE.test(requestedId)) {
      const exists = await prisma.subCompany.findUnique({
        where: { id: requestedId },
        select: { id: true },
      });
      if (exists) return requestedId;
    }
    return null;
  }

  if (isAgencyIndependentRole(req.user.role)) {
    const allowedIds = await resolveAllowedSubCompanyIds(req.user, req);
    if (requestedId && UUID_RE.test(requestedId) && allowedIds.includes(requestedId)) {
      return requestedId;
    }
    return pickDefaultAgencyId(null, allowedIds);
  }

  if (!userSubCompanyId) return null;

  const allowedIds = await resolveAllowedSubCompanyIds(req.user, req);
  const ctx = await ensureAccessContext(req);

  if (!ctx || !canAccessMultipleAgencies(ctx)) {
    return pickDefaultAgencyId(userSubCompanyId, allowedIds);
  }

  if (requestedId && UUID_RE.test(requestedId) && allowedIds.includes(requestedId)) {
    return requestedId;
  }

  return pickDefaultAgencyId(userSubCompanyId, allowedIds);
}

/** Agency ids for GET /clients — Database Manager is org-wide (no home agency). */
export async function resolveClientListAgencyIds(
  user: JwtPayload,
  req?: Request,
): Promise<string[]> {
  if (user.role === 'database_manager') {
    return fetchAllAgencyIds();
  }
  return resolveAllowedSubCompanyIds(user, req);
}

async function fetchOrgAgencyIds(ownSubCompanyId: string): Promise<string[]> {
  try {
    const own = await prisma.subCompany.findUnique({
      where: { id: ownSubCompanyId },
      select: { mainOrgId: true },
    });

    if (!own?.mainOrgId) {
      console.warn(`[agencyScope] SubCompany ${ownSubCompanyId} has no mainOrgId — sees own agency only`);
      return [ownSubCompanyId];
    }

    const siblings = await prisma.subCompany.findMany({
      where: { mainOrgId: own.mainOrgId },
      select: { id: true },
      orderBy: { name: 'asc' },
    });

    const ids = siblings.map((s) => s.id);
    if (!ids.includes(ownSubCompanyId)) ids.push(ownSubCompanyId);
    return ids;
  } catch (err) {
    console.error('[agencyScope] DB query failed:', err);
    return [ownSubCompanyId];
  }
}
