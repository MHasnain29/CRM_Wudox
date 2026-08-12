import type { Request, Response, NextFunction } from 'express';
import { requirePermission } from './requirePermission';
import {
  canViewTeamData,
  hasPermission,
  type AccessContext,
} from '../services/accessContext';
import { ensureAccessContext } from '../utils/requestPermission';

export const requireSettingsWrite = requirePermission('settings:write');

/** Call scripts: settings write, or settings read with team+ scope (legacy sales/recruitment managers). */
export async function requireCallScriptsAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const ctx = await ensureAccessContext(req);
  if (!ctx) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (canEditCallScripts(ctx)) {
    next();
    return;
  }
  res.status(403).json({
    error: 'Forbidden',
    message: 'You do not have permission to manage call scripts',
  });
}

export function canEditCallScripts(ctx: AccessContext): boolean {
  return hasPermission(ctx, 'settings:write') ||
    (hasPermission(ctx, 'settings:read') && canViewTeamData(ctx));
}
