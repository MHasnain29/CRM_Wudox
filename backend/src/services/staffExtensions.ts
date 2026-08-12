import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { isAgencyIndependentRole } from '../config/agencyIndependentRoles';
import { ensureConfigRow } from './phoneSystemService';

export const STAFF_EXTENSION_START = 101;

export interface StaffExtensionRow {
  userId: string;
  userName: string;
  extension: string;
}

interface ExtensionCarrier {
  extension: string;
}

function parseJsonArray<T>(value: Prisma.JsonValue | null | undefined): T[] {
  if (!value || !Array.isArray(value)) return [];
  return value as T[];
}

export function staffUserLabel(firstName: string, lastName: string, email: string): string {
  return `${firstName} ${lastName}`.trim() || email;
}

export function collectReservedExtensions(
  ringGroups: ExtensionCarrier[],
  voicemailBoxes: ExtensionCarrier[],
  existingStaff: StaffExtensionRow[],
): Set<string> {
  const reserved = new Set<string>();
  for (const g of ringGroups) {
    const ext = g.extension?.trim();
    if (ext) reserved.add(ext);
  }
  for (const v of voicemailBoxes) {
    const ext = v.extension?.trim();
    if (ext) reserved.add(ext);
  }
  for (const s of existingStaff) {
    const ext = s.extension?.trim();
    if (ext) reserved.add(ext);
  }
  return reserved;
}

export function nextAvailableStaffExtension(
  reserved: Set<string>,
  start = STAFF_EXTENSION_START,
): string {
  let next = start;
  while (reserved.has(String(next))) next++;
  return String(next);
}

/** Pure assignment — returns null assigned when user already has an extension. */
export function assignExtensionIfMissing(
  existingStaff: StaffExtensionRow[],
  userId: string,
  userName: string,
  ringGroups: ExtensionCarrier[],
  voicemailBoxes: ExtensionCarrier[],
): { updated: StaffExtensionRow[]; assigned: string | null } {
  const current = existingStaff.find((s) => s.userId === userId);
  if (current?.extension?.trim()) {
    return { updated: existingStaff, assigned: null };
  }

  const reserved = collectReservedExtensions(ringGroups, voicemailBoxes, existingStaff);
  const extension = nextAvailableStaffExtension(reserved);
  const without = existingStaff.filter((s) => s.userId !== userId);
  return {
    updated: [...without, { userId, userName, extension }],
    assigned: extension,
  };
}

export function shouldAssignStaffExtension(
  role: string,
  subCompanyId: string | null | undefined,
): boolean {
  if (isAgencyIndependentRole(role)) return false;
  return !!subCompanyId?.trim();
}

export async function ensureStaffExtensionForUser(input: {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  subCompanyId: string | null | undefined;
}): Promise<string | null> {
  if (!shouldAssignStaffExtension(input.role, input.subCompanyId)) {
    return null;
  }

  const subCompanyId = input.subCompanyId!.trim();
  await ensureConfigRow(subCompanyId);

  const config = await prisma.phoneAgencyConfig.findUnique({
    where: { subCompanyId },
    select: { staffExtensions: true, ringGroups: true, voicemailBoxes: true },
  });
  if (!config) return null;

  const staffExtensions = parseJsonArray<StaffExtensionRow>(config.staffExtensions);
  const ringGroups = parseJsonArray<ExtensionCarrier>(config.ringGroups);
  const voicemailBoxes = parseJsonArray<ExtensionCarrier>(config.voicemailBoxes);
  const userName = staffUserLabel(input.firstName, input.lastName, input.email);

  const { updated, assigned } = assignExtensionIfMissing(
    staffExtensions,
    input.userId,
    userName,
    ringGroups,
    voicemailBoxes,
  );
  if (!assigned) return null;

  await prisma.phoneAgencyConfig.update({
    where: { subCompanyId },
    data: { staffExtensions: updated as unknown as Prisma.InputJsonValue },
  });

  return assigned;
}

/** Read-only lookup of one user's PBX extension in an agency phone config. */
export async function getStaffExtensionForUser(
  userId: string,
  subCompanyId: string | null | undefined,
): Promise<string | null> {
  if (!userId?.trim() || !subCompanyId?.trim()) return null;

  const config = await prisma.phoneAgencyConfig.findUnique({
    where: { subCompanyId: subCompanyId.trim() },
    select: { staffExtensions: true },
  });
  if (!config) return null;

  const row = parseJsonArray<StaffExtensionRow>(config.staffExtensions).find(
    (s) => s.userId === userId,
  );
  const extension = row?.extension?.trim();
  return extension || null;
}
