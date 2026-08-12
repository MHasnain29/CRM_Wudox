import { Request, Response, NextFunction } from 'express';
import { hasAnyPermission, type Permission } from '../config/permissions';
import { ensurePermissionKeys } from '../utils/requestPermission';

declare global {
  // Express Request augmentation (standard pattern)
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Cached effective permission keys for this request (from DB or static fallback). */
      permissionKeys?: string[];
    }
  }
}

/**
 * Require the user to have at least one of the given permissions.
 * Use after authenticate middleware.
 */
export function requirePermission(...permissions: Permission[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const role = req.user?.role;
    if (!role) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (permissions.length === 0) {
      next();
      return;
    }
    if (role === 'super_admin') {
      next();
      return;
    }
    try {
      const keys = await ensurePermissionKeys(req);
      const allowed = permissions.some((p) => keys.includes(p));
      if (allowed) {
        next();
        return;
      }
    } catch {
      if (hasAnyPermission(role, permissions)) {
        next();
        return;
      }
    }
    res.status(403).json({
      error: 'Forbidden',
      message: 'You do not have permission to perform this action',
    });
  };
}

/**
 * Require the user to have a specific permission.
 */
export function requireOnePermission(permission: Permission) {
  return requirePermission(permission);
}
