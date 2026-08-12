import prisma from '../config/database';
import { AGENCY_INDEPENDENT_ROLES, isAgencyIndependentRole } from '../config/agencyIndependentRoles';

/** Clear home agency / location for org-wide roles (idempotent). */
export async function clearStaleAgencyIndependentHomeAgencies(): Promise<number> {
  const result = await prisma.user.updateMany({
    where: {
      role: { in: [...AGENCY_INDEPENDENT_ROLES] },
      OR: [{ subCompanyId: { not: null } }, { locationId: { not: null } }],
    },
    data: { subCompanyId: null, locationId: null },
  });
  return result.count;
}

/** Ensure a single user row matches agency-independent rules (e.g. on login). */
export async function ensureAgencyIndependentUserRecord(
  userId: string,
  role: string,
): Promise<void> {
  if (!isAgencyIndependentRole(role)) return;
  await prisma.user.updateMany({
    where: {
      id: userId,
      OR: [{ subCompanyId: { not: null } }, { locationId: { not: null } }],
    },
    data: { subCompanyId: null, locationId: null },
  });
}

export function agencyLabelForUser(
  role: string,
  subCompanyName: string | null | undefined,
): string | null {
  if (isAgencyIndependentRole(role)) return null;
  return subCompanyName ?? null;
}
