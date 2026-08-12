import prisma from '../config/database';
import { isIpAllowed } from '../utils/ipCheck';
import type { Country } from '@prisma/client';

/**
 * Check if a client IP is allowed to login for a user with the given role and country.
 * If no rule exists for (role, country), no restriction → allowed.
 * If rules exist (role only, or role+country), IP must be in at least one rule's allowed list.
 */
export async function isIpAllowedForUser(
  role: string,
  country: Country,
  clientIp: string
): Promise<{ allowed: boolean; message?: string }> {
  const rules = await prisma.ipRestrictionRule.findMany({
    where: {
      role,
      OR: [{ country: null }, { country }],
    },
  });
  if (rules.length === 0) return { allowed: true };
  for (const rule of rules) {
    if (isIpAllowed(clientIp, rule.allowedIps)) return { allowed: true };
  }
  return {
    allowed: false,
    message: 'Login is restricted to specific IPs for your role. Your current IP is not allowed.',
  };
}
