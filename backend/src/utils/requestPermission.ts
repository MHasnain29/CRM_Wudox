import type { Request, Response, NextFunction } from 'express';
import type { Permission } from '../config/permissions';
import {
  type AccessContext,
  buildAccessContext,
  hasAnyPermission,
  hasPermission,
} from '../services/accessContext';

declare global {
  // Express Request augmentation (standard pattern)
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Cached effective permission keys for this request (from DB RBAC). */
      permissionKeys?: string[];
      /** Full dynamic access context (permissions + data scope). */
      access?: AccessContext;
    }
  }
}

export async function ensureAccessContext(req: Request): Promise<AccessContext | null> {
  if (req.access) return req.access;
  if (!req.user?.sub || !req.user.role) return null;
  const ctx = await buildAccessContext(req.user);
  req.access = ctx;
  req.permissionKeys = ctx.permissions;
  return ctx;
}

export async function hydrateUserAgencyContext(req: Request): Promise<void> {
  const { hydrateRequestUserAgency } = await import('../services/agencyContext');
  await hydrateRequestUserAgency(req);
}

/** @deprecated Use req.access via ensureAccessContext */
export async function ensurePermissionKeys(req: Request): Promise<string[]> {
  const ctx = await ensureAccessContext(req);
  return ctx?.permissions ?? [];
}

export async function requestHasPermission(req: Request, permission: Permission): Promise<boolean> {
  const ctx = await ensureAccessContext(req);
  if (!ctx) return false;
  return hasPermission(ctx, permission);
}

export async function requestHasAnyPermission(req: Request, permissions: Permission[]): Promise<boolean> {
  const ctx = await ensureAccessContext(req);
  if (!ctx) return false;
  return hasAnyPermission(ctx, permissions);
}

export async function attachAccessContext(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (req.user) {
      await hydrateUserAgencyContext(req);
      await ensureAccessContext(req);
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** @deprecated alias */
export const attachUserPermissions = attachAccessContext;
