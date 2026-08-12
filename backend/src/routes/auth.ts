import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import {
  findUserByEmail,
  findUserById,
  verifyPassword,
  hashPassword,
  getJwtExpiresIn,
  getRefreshExpiresIn,
  getResetExpiresIn,
  storeRefreshToken,
  revokeRefreshToken,
  isRefreshTokenStored,
  validatePasswordFormat,
} from '../services/auth';
import prisma from '../config/database';
import { env } from '../config/env';
import { authenticate } from '../middleware/auth';
import type { JwtPayload } from '../middleware/auth';
import { resolveAllowedSubCompanyIds } from '../config/agencyScope';
import { buildAccessContext, canAccessMultipleAgencies } from '../services/accessContext';
import { sendPasswordResetEmail, getAgencyBranding } from '../services/email';
import { getUserRoleTitle } from '../services/rbac';
import { ensureAgencyIndependentUserRecord } from '../services/agencyIndependentUsers';
import { isAgencyIndependentRole } from '../config/agencyIndependentRoles';
import { isIpAllowedForUser } from '../services/ipRestriction';
import { normalizeIp } from '../utils/ipCheck';
import { startActivitySession, endActivitySession } from '../services/activitySession';
import { setManualPresence } from '../services/agentPresence';
import { AgentPresenceStatus } from '@prisma/client';
import { getGoogleAuthUrl, exchangeCodeForTokens, getGoogleAccountEmail, encryptToken } from '../services/googleCalendar';
import { safeSubCompanyForClient } from '../utils/safeSubCompany';
import { validateSwitchTarget } from '../services/agencyLink';

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshBody = z.object({
  refreshToken: z.string().min(1),
});

const logoutBody = z.object({
  refreshToken: z.string().optional(),
});

const forgotPasswordBody = z.object({
  email: z.string().email(),
});

const resetPasswordBody = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(1),
});

export const authRouter = Router();

// POST /login — JWT + refresh; refresh stored in Redis
authRouter.post('/login', async (req: Request, res: Response) => {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Validation error',
      details: parsed.error.flatten(),
    });
  }
  const { email, password } = parsed.data;

  const user = await findUserByEmail(email);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const clientIp = normalizeIp(req.ip || req.socket?.remoteAddress || '');
  const ipCheck = await isIpAllowedForUser(user.role, user.country, clientIp);
  if (!ipCheck.allowed) {
    return res.status(401).json({ error: 'Login not allowed', message: ipCheck.message });
  }

  await ensureAgencyIndependentUserRecord(user.id, user.role);
  const effectiveSubCompanyId = isAgencyIndependentRole(user.role) ? null : user.subCompanyId;

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  // Activity log: successful login
  const userName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email;
  const logSubCompanyId =
    effectiveSubCompanyId ??
    (await prisma.subCompany.findFirst({ select: { id: true }, orderBy: { name: 'asc' } }))?.id ??
    null;
  if (logSubCompanyId) {
    await prisma.activityLog.create({
      data: {
        type: 'auth_login',
        userId: user.id,
        userName,
        subCompanyId: logSubCompanyId,
        description: 'User logged in',
        metadata: {
          ip: normalizeIp(req.ip || req.socket?.remoteAddress || ''),
          userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
        },
      },
    });
  }

  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: user.id,
    email: user.email,
    role: user.role,
    subCompanyId: effectiveSubCompanyId ?? '',
  };
  const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: getJwtExpiresIn() } as jwt.SignOptions);

  const jti = crypto.randomUUID();
  const refreshToken = jwt.sign(
    { sub: user.id, type: 'refresh', jti },
    env.JWT_REFRESH_SECRET,
    { expiresIn: getRefreshExpiresIn() } as jwt.SignOptions
  );
  await storeRefreshToken(jti, user.id);

  // Open server-authoritative activity session (closes any stale session first)
  const activitySubCompanyId =
    effectiveSubCompanyId ??
    (await prisma.subCompany.findFirst({ select: { id: true }, orderBy: { name: 'asc' } }))?.id ??
    user.id;
  const activitySessionId = await startActivitySession(user.id, activitySubCompanyId);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omit passwordHash from response
  const { passwordHash: _, subCompany: subFromUser, ...userWithoutSecrets } = user;
  const access = await buildAccessContext(payload);
  return res.json({
    user: {
      ...userWithoutSecrets,
      subCompanyId: effectiveSubCompanyId,
      subCompany: isAgencyIndependentRole(user.role) ? null : safeSubCompanyForClient(subFromUser),
    },
    token,
    refreshToken,
    expiresIn: getJwtExpiresIn(),
    roleLabel: await getUserRoleTitle(user),
    permissions: access.permissions,
    dataScopeLevel: access.scopeLevel,
    activitySessionId,
  });
});

// POST /refresh-token — token rotation on refresh
authRouter.post('/refresh-token', async (req: Request, res: Response) => {
  const parsed = refreshBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  }
  const { refreshToken: oldRefresh } = parsed.data;

  let decoded: { sub: string; type?: string; jti?: string };
  try {
    decoded = jwt.verify(oldRefresh, env.JWT_REFRESH_SECRET as jwt.Secret) as typeof decoded;
  } catch {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
  if (decoded.type !== 'refresh' || !decoded.sub) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }

  const jti = decoded.jti ?? decoded.sub;
  const valid = await isRefreshTokenStored(jti);
  if (!valid) {
    return res.status(401).json({ error: 'Refresh token revoked or expired' });
  }

  await revokeRefreshToken(jti);

  const user = await findUserById(decoded.sub);
  if (!user || !user.isActive) {
    return res.status(401).json({ error: 'User not found or inactive' });
  }

  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: user.id,
    email: user.email,
    role: user.role,
    subCompanyId: user.subCompanyId ?? '',
  };
  const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: getJwtExpiresIn() } as jwt.SignOptions);

  const newJti = crypto.randomUUID();
  const refreshToken = jwt.sign(
    { sub: user.id, type: 'refresh', jti: newJti },
    env.JWT_REFRESH_SECRET,
    { expiresIn: getRefreshExpiresIn() } as jwt.SignOptions
  );
  await storeRefreshToken(newJti, user.id);

  return res.json({
    token,
    refreshToken,
    expiresIn: getJwtExpiresIn(),
  });
});

// POST /logout — revoke refresh when provided
authRouter.post('/logout', async (req: Request, res: Response) => {
  const parsed = logoutBody.safeParse(req.body);
  const refreshToken = parsed.success ? parsed.data.refreshToken : undefined;

  if (refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { jti?: string; sub?: string };
      const jti = decoded.jti ?? decoded.sub;
      if (jti) await revokeRefreshToken(jti);

      // Close activity session + activity log
      if (decoded.sub) {
        await endActivitySession(decoded.sub);
        const u = await prisma.user.findUnique({
          where: { id: decoded.sub },
          select: { id: true, email: true, firstName: true, lastName: true, subCompanyId: true },
        });
        if (u) {
          await setManualPresence(u.id, u.subCompanyId, AgentPresenceStatus.offline).catch(
            () => undefined,
          );
          const userName = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email;
          await prisma.activityLog.create({
            data: {
              type: 'auth_logout',
              userId: u.id,
              userName,
              subCompanyId: u.subCompanyId ?? '',
              description: 'User logged out',
              metadata: {
                ip: normalizeIp(req.ip || req.socket?.remoteAddress || ''),
                userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
              },
            },
          });
        }
      }
    } catch {
      // ignore invalid token
    }
  }

  return res.status(204).send();
});

// POST /forgot-password
authRouter.post('/forgot-password', async (req: Request, res: Response) => {
  const parsed = forgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  }
  const { email } = parsed.data;

  const user = await findUserByEmail(email);
  if (!user) {
    return res.status(404).json({ error: 'No account found with this email address.' });
  }

  const resetToken = jwt.sign(
    { sub: user.id, type: 'password_reset' },
    env.JWT_SECRET,
    { expiresIn: getResetExpiresIn() } as jwt.SignOptions
  );
  const agency = await getAgencyBranding(user.subCompanyId);
  try {
    await sendPasswordResetEmail(user.email, user.firstName, resetToken, agency);
  } catch (err) {
    console.error('[forgot-password] Failed to send reset email:', err);
    if (env.NODE_ENV === 'development') {
      const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${encodeURIComponent(resetToken)}`;
      console.log(`[dev] Password reset link for ${user.email}: ${resetUrl}`);
    }
  }

  return res.json({ message: 'If an account exists with this email, you will receive a reset link.' });
});

// POST /reset-password — set new password using token from email link
authRouter.post('/reset-password', async (req: Request, res: Response) => {
  const parsed = resetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  }
  const { token: resetToken, newPassword } = parsed.data;

  const format = validatePasswordFormat(newPassword);
  if (!format.ok) {
    return res.status(400).json({ error: format.message });
  }

  let decoded: { sub: string; type?: string };
  try {
    decoded = jwt.verify(resetToken, env.JWT_SECRET) as typeof decoded;
  } catch {
    return res.status(400).json({ error: 'Invalid or expired reset link' });
  }
  if (decoded.type !== 'password_reset' || !decoded.sub) {
    return res.status(400).json({ error: 'Invalid reset link' });
  }

  const hashed = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: decoded.sub },
    data: { passwordHash: hashed },
  });

  return res.json({ message: 'Password updated. You can log in with your new password.' });
});

/**
 * Authorization for per-agency Google Calendar integration management.
 * A user may connect/disconnect Google for a given agency if they have
 * cross-agency access and the target is in their allowed agency list.
 */
async function canManageAgencyIntegration(user: JwtPayload, targetSubCompanyId: string): Promise<boolean> {
  const ctx = await buildAccessContext(user);
  if (!canAccessMultipleAgencies(ctx)) return false;
  const allowed = await resolveAllowedSubCompanyIds(user);
  return allowed.includes(targetSubCompanyId);
}

async function canConnectGoogleCalendar(user: JwtPayload): Promise<boolean> {
  const ctx = await buildAccessContext(user);
  return canAccessMultipleAgencies(ctx);
}

// GET /auth/google?subCompanyId=<id> — return Google OAuth URL for a specific agency
authRouter.get('/google', authenticate, async (req: Request, res: Response) => {
  if (!(await canConnectGoogleCalendar(req.user!))) {
    return res.status(403).json({ error: 'Only super users can connect Google Calendar' });
  }
  const targetSubCompanyId = (typeof req.query.subCompanyId === 'string' && req.query.subCompanyId.trim())
    ? req.query.subCompanyId.trim()
    : req.user!.subCompanyId;
  if (!targetSubCompanyId) {
    return res.status(400).json({ error: 'Agency context required' });
  }
  if (!(await canManageAgencyIntegration(req.user!, targetSubCompanyId))) {
    return res.status(403).json({ error: 'You do not have access to this agency' });
  }
  try {
    const state = jwt.sign(
      { sub: req.user!.sub, subCompanyId: targetSubCompanyId, type: 'google_oauth' },
      env.JWT_SECRET,
      { expiresIn: '10m' } as jwt.SignOptions,
    );
    const url = getGoogleAuthUrl(state);
    return res.json({ url });
  } catch {
    return res.status(503).json({ error: 'Google Calendar integration is not configured' });
  }
});

// GET /auth/google/callback — browser redirect from Google, no Authorization header
authRouter.get('/google/callback', async (req: Request, res: Response) => {
  const code = typeof req.query.code === 'string' ? req.query.code : null;
  const state = typeof req.query.state === 'string' ? req.query.state : null;

  const errRedirect = (reason: string, editAgency?: string) => {
    const params = new URLSearchParams({ tab: 'agencies', google: 'error', reason });
    if (editAgency) params.set('editAgency', editAgency);
    return res.redirect(`${env.FRONTEND_URL}/settings?${params.toString()}`);
  };

  if (!code || !state) return errRedirect('missing_params');

  let decoded: { sub: string; subCompanyId: string; type: string };
  try {
    decoded = jwt.verify(state, env.JWT_SECRET) as { sub: string; subCompanyId: string; type: string };
  } catch {
    return errRedirect('expired');
  }
  if (decoded.type !== 'google_oauth' || !decoded.sub || !decoded.subCompanyId) {
    return errRedirect('invalid_state');
  }

  try {
    // Re-check authorization at callback time — role may have changed since Connect was clicked
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true, subCompanyId: true, role: true },
    });
    if (!user) return errRedirect('unauthorized', decoded.subCompanyId);
    const allowed = await canManageAgencyIntegration(
      { sub: user.id, role: user.role, subCompanyId: user.subCompanyId } as JwtPayload,
      decoded.subCompanyId,
    );
    if (!allowed) return errRedirect('unauthorized', decoded.subCompanyId);

    const { refreshToken } = await exchangeCodeForTokens(code);
    const connectedEmail = await getGoogleAccountEmail(refreshToken);
    await prisma.subCompany.update({
      where: { id: decoded.subCompanyId },
      data: {
        googleRefreshToken: encryptToken(refreshToken),
        googleCalendarConnected: true,
        googleConnectedEmail: connectedEmail,
      },
    });
    const params = new URLSearchParams({ tab: 'agencies', google: 'connected', editAgency: decoded.subCompanyId });
    return res.redirect(`${env.FRONTEND_URL}/settings?${params.toString()}`);
  } catch (err: any) {
    console.error('[auth] Google callback error:', err);
    return errRedirect('exchange_failed', decoded.subCompanyId);
  }
});

// POST /auth/google/disconnect { subCompanyId } — clear token on the named agency
authRouter.post('/google/disconnect', authenticate, async (req: Request, res: Response) => {
  if (!(await canConnectGoogleCalendar(req.user!))) {
    return res.status(403).json({ error: 'Only super users can disconnect Google Calendar' });
  }
  const targetSubCompanyId = (typeof req.body?.subCompanyId === 'string' && req.body.subCompanyId.trim())
    ? req.body.subCompanyId.trim()
    : req.user!.subCompanyId;
  if (!targetSubCompanyId) {
    return res.status(400).json({ error: 'Agency context required' });
  }
  if (!(await canManageAgencyIntegration(req.user!, targetSubCompanyId))) {
    return res.status(403).json({ error: 'You do not have access to this agency' });
  }
  await prisma.subCompany.update({
    where: { id: targetSubCompanyId },
    data: { googleRefreshToken: null, googleCalendarConnected: false, googleConnectedEmail: null },
  });
  return res.json({ ok: true });
});

// POST /switch-agency — seamless session swap to a linked agency account
// No permission check — link existence IS the authorization. Any linked user can switch.
// Rate-limited separately in server.ts (10 req/min per IP).
authRouter.post('/switch-agency', authenticate, async (req: Request, res: Response) => {
  const targetUserId = req.body?.targetUserId;
  const oldRefreshToken: string | undefined = req.body?.refreshToken;
  if (typeof targetUserId !== 'string' || !targetUserId) {
    return res.status(400).json({ error: 'targetUserId is required' });
  }

  const currentUserId = req.user!.sub;

  let oldJti: string | undefined;
  if (oldRefreshToken) {
    try {
      const decoded = jwt.verify(oldRefreshToken, env.JWT_REFRESH_SECRET) as { jti?: string; sub?: string };
      oldJti = decoded.jti ?? decoded.sub;
    } catch {
      // Invalid/expired refresh token — proceed without revocation
    }
  }

  let targetUser: Awaited<ReturnType<typeof validateSwitchTarget>>;
  try {
    targetUser = await validateSwitchTarget(currentUserId, targetUserId);
  } catch {
    return res.status(403).json({ error: 'Access denied' });
  }

  const clientIp = normalizeIp(req.ip || req.socket?.remoteAddress || '');
  const ipCheck = await isIpAllowedForUser(targetUser.role, targetUser.country, clientIp);
  if (!ipCheck.allowed) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: targetUser.id,
    email: targetUser.email,
    role: targetUser.role,
    subCompanyId: targetUser.subCompanyId ?? '',
  };
  const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: getJwtExpiresIn() } as jwt.SignOptions);

  const jti = crypto.randomUUID();
  const refreshToken = jwt.sign(
    { sub: targetUser.id, type: 'refresh', jti },
    env.JWT_REFRESH_SECRET,
    { expiresIn: getRefreshExpiresIn() } as jwt.SignOptions,
  );
  await storeRefreshToken(jti, targetUser.id);

  const activitySessionId = await startActivitySession(targetUser.id, targetUser.subCompanyId ?? targetUser.id);

  await Promise.all([
    ensureAgencyIndependentUserRecord(targetUser.id, targetUser.role),
    prisma.user.update({ where: { id: targetUser.id }, data: { lastLoginAt: new Date() } }),
  ]);

  void endActivitySession(currentUserId).catch(() => {});
  if (oldJti) void revokeRefreshToken(oldJti).catch(() => {});

  // Audit log (EC-11.3)
  const fromSubCompany = await prisma.subCompany.findUnique({
    where: { id: req.user!.subCompanyId || '' },
    select: { name: true },
  });
  await prisma.activityLog.create({
    data: {
      type: 'auth_agency_switch',
      userId: currentUserId,
      userName: req.user!.email,
      subCompanyId: req.user!.subCompanyId || targetUser.subCompanyId || targetUser.id,
      description: `Switched from ${fromSubCompany?.name ?? 'unknown'} to ${targetUser.subCompany?.name ?? 'unknown'}`,
      metadata: {
        fromUserId: currentUserId,
        toUserId: targetUser.id,
        fromSubCompanyId: req.user!.subCompanyId,
        toSubCompanyId: targetUser.subCompanyId,
        ip: clientIp,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      },
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omit passwordHash from response
  const { passwordHash: _, subCompany: subFromUser, ...userWithoutSecrets } = targetUser;
  const access = await buildAccessContext(payload);

  return res.json({
    user: {
      ...userWithoutSecrets,
      subCompanyId: targetUser.subCompanyId,
      subCompany: safeSubCompanyForClient(subFromUser),
    },
    token,
    refreshToken,
    expiresIn: getJwtExpiresIn(),
    roleLabel: await getUserRoleTitle(targetUser),
    permissions: access.permissions,
    dataScopeLevel: access.scopeLevel,
    activitySessionId,
  });
});

authRouter.get('/me', authenticate, async (req: Request, res: Response) => {
  const userId = req.user?.sub ?? '';
  const full = await prisma.user.findUnique({
    where: { id: userId },
    include: { subCompany: true, location: true },
  });
  if (!full) {
    return res.status(404).json({ error: 'User not found' });
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omit passwordHash from response
  const { passwordHash: _, subCompany: sc, ...userRest } = full;
  const access = await buildAccessContext({
    sub: full.id,
    email: full.email,
    role: full.role,
    subCompanyId: full.subCompanyId ?? '',
  });
  return res.json({
    ...userRest,
    subCompany: safeSubCompanyForClient(sc),
    googleCalendarConnected: full.subCompany?.googleCalendarConnected ?? false,
    googleConnectedEmail: full.subCompany?.googleConnectedEmail ?? null,
    roleLabel: await getUserRoleTitle(full),
    permissions: access.permissions,
    dataScopeLevel: access.scopeLevel,
  });
});
