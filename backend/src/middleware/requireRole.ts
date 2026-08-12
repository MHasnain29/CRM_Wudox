import { Request, Response, NextFunction } from 'express';
import type { Role } from '../config/permissions';

/**
 * Require the user to have one of the given roles.
 * Use after authenticate middleware.
 */
export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.user?.role;
    if (!role) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (allowedRoles.length === 0 || allowedRoles.includes(role)) {
      next();
      return;
    }
    res.status(403).json({
      error: 'Forbidden',
      message: 'Your role does not have access to this resource',
    });
  };
}
