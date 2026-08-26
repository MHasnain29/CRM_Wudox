/**
 * Keeps the marketing role's client-facing title in sync.
 * Internal key stays `marketing`; display name is Sales & Marketing Executive.
 */
import prisma from '../config/database';
import { MARKETING_ROLE_KEY, MARKETING_ROLE_LABEL } from '../config/permissions';

const LEGACY_DISPLAY_NAME = 'Marketing';

export async function syncMarketingRoleDisplayName(): Promise<void> {
  const name = MARKETING_ROLE_LABEL;

  await prisma.rbacRole.updateMany({
    where: { key: MARKETING_ROLE_KEY },
    data: { name },
  });

  await prisma.user.updateMany({
    where: { role: MARKETING_ROLE_KEY, userType: LEGACY_DISPLAY_NAME },
    data: { userType: name },
  });
}
