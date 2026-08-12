import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { ensureAccessContext, hydrateUserAgencyContext } from '../utils/requestPermission';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  /** Empty string when user has no home agency (org-wide roles). */
  subCompanyId: string;
  iat?: number;
  exp?: number;
  /** Set by actAsMiddleware — never present in the JWT itself. */
  actAsUserId?: string;
}

/** Express middleware: verify Bearer JWT and set req.user */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : undefined;
  const token = headerToken || queryToken || undefined;
  if (!token) {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing token' });
    return;
  }
  void (async () => {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
      req.user = decoded;
      await hydrateUserAgencyContext(req);
      await ensureAccessContext(req);
      next();
    } catch {
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing token' });
    }
  })();
}

export function getAuthUser(req: Request): JwtPayload | null {
  return req.user ?? null;
}
