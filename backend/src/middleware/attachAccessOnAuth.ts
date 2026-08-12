import type { Request, Response, NextFunction } from 'express';
import { attachAccessContext } from '../utils/requestPermission';

/**
 * Runs after route-level `authenticate` when `req.user` is set.
 * Safe to call on unauthenticated routes (no-op).
 */
export async function attachAccessOnAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user?.sub) {
    next();
    return;
  }
  return attachAccessContext(req, res, next);
}
