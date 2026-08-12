import { randomInt } from 'crypto';
import bcrypt from 'bcrypt';
import prisma from '../config/database';
import { env } from '../config/env';
import { getRedis, isRedisEnabled } from '../config/redis';

const SALT_ROUNDS = 12;
const REFRESH_PREFIX = 'refresh:';

/** Refresh token TTL in seconds for Redis */
function getRefreshTtlSeconds(): number {
  const s = env.JWT_REFRESH_EXPIRES_IN;
  const match = s.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 3600;
  const n = parseInt(match[1], 10);
  const u = match[2];
  if (u === 's') return n;
  if (u === 'm') return n * 60;
  if (u === 'h') return n * 3600;
  if (u === 'd') return n * 24 * 3600;
  return 7 * 24 * 3600;
}

export async function findUserByEmail(email: string) {
  const normalized = email.toLowerCase().trim();

  // Step 1 — primary email lookup (all roles)
  const user = await prisma.user.findUnique({
    where: { email: normalized, isActive: true },
    include: { subCompany: true, location: true },
  });
  if (user) return user;

  // Step 2 — OM per-agency email fallback (operations_manager only)
  const omLink = await prisma.operationsManagerSubCompany.findFirst({
    where: { agencyEmail: { equals: normalized, mode: 'insensitive' } },
    include: {
      user: { include: { subCompany: true, location: true } },
    },
  });
  if (omLink?.user?.isActive) return omLink.user;

  return null;
}

export async function findUserById(id: string) {
  return prisma.user.findUnique({
    where: { id, isActive: true },
    include: { subCompany: true, location: true },
  });
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function getJwtSecret(): string {
  return env.JWT_SECRET;
}

export function getJwtExpiresIn(): string {
  return env.JWT_EXPIRES_IN;
}

export function getRefreshSecret(): string {
  return env.JWT_REFRESH_SECRET;
}

export function getRefreshExpiresIn(): string {
  return env.JWT_REFRESH_EXPIRES_IN;
}

export function getResetExpiresIn(): string {
  return env.JWT_RESET_EXPIRES_IN ?? '1h';
}

/** Store refresh token id in Redis. No-op if Redis disabled. */
export async function storeRefreshToken(jti: string, userId: string): Promise<void> {
  if (!isRedisEnabled()) return;
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.setex(`${REFRESH_PREFIX}${jti}`, getRefreshTtlSeconds(), userId);
  } catch (err) {
    console.warn('⚠️  Redis storeRefreshToken failed:', (err as Error).message);
  }
}

/** Revoke refresh token (remove from Redis). No-op if Redis disabled. */
export async function revokeRefreshToken(jti: string): Promise<void> {
  if (!isRedisEnabled()) return;
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(`${REFRESH_PREFIX}${jti}`);
  } catch (err) {
    console.warn('⚠️  Redis revokeRefreshToken failed:', (err as Error).message);
  }
}

/** Check if refresh token is still valid (present in Redis). If Redis disabled or unavailable, returns true (no revoke list). */
export async function isRefreshTokenStored(jti: string): Promise<boolean> {
  if (!isRedisEnabled()) return true;
  const redis = getRedis();
  if (!redis) return true;
  try {
    const v = await redis.get(`${REFRESH_PREFIX}${jti}`);
    return v !== null;
  } catch (err) {
    console.warn('⚠️  Redis isRefreshTokenStored failed:', (err as Error).message);
    return true;
  }
}

/** Password complexity: min 8 chars, at least one letter and one number. */
export function validatePasswordFormat(password: string): { ok: boolean; message?: string } {
  if (password.length < 8) return { ok: false, message: 'Password must be at least 8 characters' };
  if (!/[a-zA-Z]/.test(password)) return { ok: false, message: 'Password must contain at least one letter' };
  if (!/\d/.test(password)) return { ok: false, message: 'Password must contain at least one number' };
  return { ok: true };
}

const TEMP_PASSWORD_CHARS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Generate a temporary password that passes validatePasswordFormat (8+ chars, letter, number). */
export function generateTemporaryPassword(): string {
  const length = 12;
  let s = '';
  for (let i = 0; i < length; i++) {
    s += TEMP_PASSWORD_CHARS[randomInt(0, TEMP_PASSWORD_CHARS.length)];
  }
  if (!/[a-zA-Z]/.test(s)) s = 'A' + s.slice(1);
  if (!/\d/.test(s)) s = s.slice(0, -1) + '3';
  return s;
}
