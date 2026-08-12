import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { parseAllowedIps, isIpAllowed, normalizeIp } from '../utils/ipCheck';

let cached: ReturnType<typeof parseAllowedIps> | null = null;

function getAllowlist() {
  if (!cached) {
    const raw = env.IP_ALLOWLIST?.trim() ?? '';
    cached = raw ? parseAllowedIps(raw) : { exact: [], cidr: [] };
  }
  return cached;
}

/**
 * Middleware: when IP_ALLOWLIST is set, only allow requests from listed IPs (or CIDRs).
 * /health is not restricted so load balancers can probe.
 * Use after trust proxy is set so req.ip is the real client IP when behind a proxy.
 */
export function ipAllowlist(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/health') {
    next();
    return;
  }

  const list = getAllowlist();
  if (list.exact.length === 0 && list.cidr.length === 0) {
    next();
    return;
  }

  const clientIp = normalizeIp(req.ip || req.socket?.remoteAddress || '');
  if (!clientIp) {
    res.status(403).json({ error: 'Forbidden', message: 'IP restriction: could not determine client IP' });
    return;
  }

  const raw = env.IP_ALLOWLIST?.trim() ?? '';
  if (isIpAllowed(clientIp, raw)) {
    next();
    return;
  }

  res.status(403).json({ error: 'Forbidden', message: 'IP restriction: your IP is not allowed' });
}

/** Call when env may have changed (e.g. tests) so allowlist is re-parsed. */
export function clearAllowlistCache(): void {
  cached = null;
}
