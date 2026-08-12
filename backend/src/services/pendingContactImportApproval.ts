import type { PendingImportedContact, Prisma } from '@prisma/client';
import prisma from '../config/database';
import type { ContactImportContactPayload } from './contactImportConflictCheck';

export type StagedContactImportContact = ContactImportContactPayload;

function parseStagedContacts(pending: PendingImportedContact): StagedContactImportContact[] {
  if (!Array.isArray(pending.contacts)) return [];
  return pending.contacts as StagedContactImportContact[];
}

/**
 * Append staged contacts to the target client. If isPrimary is requested and the client
 * already has a primary, keep the existing primary (only set primary when none exists).
 */
export async function approvePendingContactImport(
  tx: Prisma.TransactionClient,
  pending: PendingImportedClientOrContact,
): Promise<{ clientId: string; appended: number }> {
  const staged = parseStagedContacts(pending as PendingImportedContact);
  if (staged.length === 0) {
    await tx.pendingImportedContact.delete({ where: { id: pending.id } });
    return { clientId: pending.targetClientId, appended: 0 };
  }

  const existingPrimary = await tx.clientContact.findFirst({
    where: { clientId: pending.targetClientId, isPrimary: true },
    select: { id: true },
  });

  let primaryAssigned = Boolean(existingPrimary);
  const rows = staged
    .map((c) => {
      const name = c.name?.trim();
      if (!name) return null;
      const wantPrimary = Boolean(c.isPrimary) && !primaryAssigned;
      if (wantPrimary) primaryAssigned = true;
      return {
        clientId: pending.targetClientId,
        name,
        title: c.title?.trim() || null,
        email: c.email?.trim().toLowerCase() || null,
        phone: c.phone?.trim() || null,
        phoneExtension: c.extension?.trim() || null,
        linkedin: c.linkedin?.trim() || null,
        isPrimary: wantPrimary,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length > 0) {
    await tx.clientContact.createMany({ data: rows });
  }

  await tx.pendingImportedContact.delete({ where: { id: pending.id } });
  return { clientId: pending.targetClientId, appended: rows.length };
}

type PendingImportedClientOrContact = {
  id: string;
  targetClientId: string;
  contacts: unknown;
};

export type BulkApproveContactImportResult = {
  approved: number;
  failed: Array<{ id: string; error: string }>;
  clientIds: string[];
  totalAppended: number;
};

export async function bulkApprovePendingContactImports(
  subCompanyId: string,
  ids: string[],
): Promise<BulkApproveContactImportResult> {
  const failed: BulkApproveContactImportResult['failed'] = [];
  const clientIds: string[] = [];
  let approved = 0;
  let totalAppended = 0;

  for (const id of ids) {
    try {
      const pending = await prisma.pendingImportedContact.findUnique({ where: { id } });
      if (!pending) {
        failed.push({ id, error: 'Not found' });
        continue;
      }
      if (pending.subCompanyId !== subCompanyId) {
        failed.push({ id, error: 'Wrong agency' });
        continue;
      }
      const result = await prisma.$transaction((tx) => approvePendingContactImport(tx, pending));
      approved += 1;
      totalAppended += result.appended;
      clientIds.push(result.clientId);
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : 'Approve failed' });
    }
  }

  return { approved, failed, clientIds, totalAppended };
}

export async function bulkRejectPendingContactImports(
  subCompanyId: string,
  ids: string[],
): Promise<{ rejected: number }> {
  const result = await prisma.pendingImportedContact.deleteMany({
    where: { id: { in: ids }, subCompanyId },
  });
  return { rejected: result.count };
}
