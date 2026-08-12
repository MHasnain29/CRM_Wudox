import type { PendingImportedClient, Prisma } from '@prisma/client';
import prisma from '../config/database';
import {
  defaultLockDays,
  resolveClientVisibility,
} from './clientVisibilityPolicy';
import { isSuperUserScreenRole } from '../config/clientCreateApproval';

export type StagedImportContact = {
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  extension?: string | null;
  linkedin?: string | null;
};

export type PendingImportWithImporter = PendingImportedClient & {
  importedBy?: { role: string } | null;
};


function parseStagedContacts(pending: PendingImportedClient): StagedImportContact[] {
  if (!Array.isArray(pending.contacts)) return [];
  return pending.contacts as StagedImportContact[];
}

function buildContactRows(
  pending: PendingImportedClient,
  stagedContacts: StagedImportContact[],
) {
  if (stagedContacts.length > 0) {
    return stagedContacts.map((c, i) => ({
      name: (c.name?.trim() || pending.name.trim()) || 'Unknown',
      title: c.title?.trim() || null,
      email: c.email?.trim().toLowerCase() || null,
      phone: c.phone?.trim() || null,
      phoneExtension: c.extension?.trim() || null,
      linkedin: c.linkedin?.trim() || null,
      isPrimary: i === 0,
    }));
  }
  return [
    {
      name: pending.name.trim(),
      title: null,
      email: null,
      phone: null,
      phoneExtension: null,
      linkedin: null,
      isPrimary: true,
    },
  ];
}

function corporateCodeForPending(pending: PendingImportedClient, suffix: string): string {
  const slug =
    pending.name
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .slice(0, 40) || 'client';
  return `${slug}-${Date.now()}-${suffix}`;
}

/** Create client from a pending import row (mode=new). Deletes pending row in same transaction. */
export async function approvePendingImportAsNew(
  tx: Prisma.TransactionClient,
  params: {
    pending: PendingImportWithImporter;
    subCompanyId: string;
    lockDays: number;
    codeSuffix: string;
    explicitAgencyPath?: boolean;
  },
): Promise<{ clientId: string; visibility: 'global' | 'agency' }> {
  const { pending, subCompanyId, lockDays, codeSuffix, explicitAgencyPath } = params;
  const stagedContacts = parseStagedContacts(pending);
  const importerRole = pending.importedBy?.role ?? undefined;
  const visibility = resolveClientVisibility({
    creatorRole: importerRole,
    lockDays,
    explicitAgencyPath: explicitAgencyPath ?? isSuperUserScreenRole(importerRole),
  });
  const contactRows = buildContactRows(pending, stagedContacts);
  const uniqueTags = [...new Set((pending.tags ?? []).map((t) => t.trim()).filter(Boolean))];

  const client = await tx.client.create({
    data: {
      corporateCode: corporateCodeForPending(pending, codeSuffix),
      name: pending.name.trim(),
      industry: pending.industry?.trim() || null,
      location: pending.location?.trim() || null,
      address: pending.address?.trim() || null,
      companySize: pending.companySize?.trim() || pending.employees?.trim() || null,
      status: 'contacted',
      visibility,
      createdByRole: importerRole ?? null,
      ...(visibility === 'global' ? { visibilityPromotedAt: new Date() } : {}),
      importSourceId: pending.sourceId?.trim() || null,
    },
  });

  await tx.clientContact.createMany({
    data: contactRows.map((c) => ({
      clientId: client.id,
      name: c.name,
      title: c.title,
      email: c.email,
      phone: c.phone,
      phoneExtension: c.phoneExtension,
      linkedin: c.linkedin,
      isPrimary: c.isPrimary,
    })),
  });

  await tx.clientSubCompany.create({
    data: { clientId: client.id, subCompanyId, status: 'contacted' },
  });

  if (uniqueTags.length > 0) {
    await tx.clientTag.createMany({
      data: uniqueTags.map((tag) => ({ clientId: client.id, subCompanyId, tag })),
      skipDuplicates: true,
    });
  }

  if (pending.industry?.trim()) {
    const industryName = pending.industry.trim();
    await tx.allowedIndustry.upsert({
      where: { subCompanyId_name: { subCompanyId, name: industryName } },
      update: {},
      create: { subCompanyId, name: industryName },
    });
  }

  await tx.pendingImportedClient.delete({ where: { id: pending.id } });

  return { clientId: client.id, visibility };
}

export type BulkApproveImportResult = {
  approved: number;
  failed: Array<{ id: string; name: string; error: string }>;
  clientIds: string[];
  hadGlobalVisibility: boolean;
};

/** Approve many pending imports as new clients — chunked transactions for speed. */
export async function bulkApprovePendingImportsAsNew(
  subCompanyId: string,
  ids: string[],
): Promise<BulkApproveImportResult> {
  const uniqueIds = [...new Set(ids)];
  const visibilitySetting = await prisma.clientVisibilitySetting.findUnique({
    where: { subCompanyId },
    select: { days: true },
  });
  const lockDays = defaultLockDays(visibilitySetting?.days);

  const pendings = await prisma.pendingImportedClient.findMany({
    where: { id: { in: uniqueIds }, subCompanyId },
    include: { importedBy: { select: { role: true } } },
  });
  const pendingById = new Map(pendings.map((p) => [p.id, p]));

  const result: BulkApproveImportResult = {
    approved: 0,
    failed: [],
    clientIds: [],
    hadGlobalVisibility: false,
  };

  const ordered = uniqueIds.filter((id) => pendingById.has(id));
  for (const id of uniqueIds) {
    if (!pendingById.has(id)) {
      result.failed.push({ id, name: id, error: 'Pending import not found' });
    }
  }

  for (let i = 0; i < ordered.length; i++) {
    const id = ordered[i];
    const pending = pendingById.get(id)!;
    try {
      const row = await prisma.$transaction((tx) =>
        approvePendingImportAsNew(tx, {
          pending,
          subCompanyId,
          lockDays,
          codeSuffix: String(i),
        }),
      );
      result.approved += 1;
      result.clientIds.push(row.clientId);
      if (row.visibility === 'global') result.hadGlobalVisibility = true;
    } catch (err) {
      result.failed.push({
        id,
        name: pending.name,
        error: err instanceof Error ? err.message : 'Approve failed',
      });
    }
  }

  return result;
}

/** Approve a global-database pending import as a new global client. */
export async function executeGlobalPendingImportApproval(params: {
  pendingId: string;
  approverUserId: string;
}): Promise<{ clientId: string; visibility: 'global' } | null> {
  const pending = await prisma.pendingImportedClient.findFirst({
    where: { id: params.pendingId, submissionSource: 'global_database' },
    include: { importedBy: { select: { role: true, id: true } } },
  });
  if (!pending) return null;

  const stagedContacts = parseStagedContacts(pending);
  const contactRows = buildContactRows(pending, stagedContacts);
  const importerRole = pending.importedBy?.role ?? 'database_manager';

  const result = await prisma.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: {
        corporateCode: corporateCodeForPending(pending, 'global'),
        name: pending.name.trim(),
        industry: pending.industry?.trim() || null,
        location: pending.location?.trim() || null,
        address: pending.address?.trim() || null,
        companySize: pending.companySize?.trim() || pending.employees?.trim() || null,
        status: 'contacted',
        visibility: 'global',
        visibilityPromotedAt: new Date(),
        createdByRole: importerRole,
        createdById: pending.importedById,
        importSourceId: pending.sourceId?.trim() || null,
      },
    });

    await tx.clientContact.createMany({
      data: contactRows.map((c) => ({
        clientId: client.id,
        name: c.name,
        title: c.title,
        email: c.email,
        phone: c.phone,
        phoneExtension: c.phoneExtension,
        linkedin: c.linkedin,
        isPrimary: c.isPrimary,
      })),
    });

    await tx.pendingImportedClient.delete({ where: { id: pending.id } });
    return { clientId: client.id, visibility: 'global' as const };
  });

  const { invalidateClientListCacheForMainOrg } = await import('./clientListCache');
  const agencies = await prisma.subCompany.findMany({ select: { id: true } });
  for (const agency of agencies) {
    await invalidateClientListCacheForMainOrg(agency.id).catch(() => {});
  }

  return result;
}

export async function bulkRejectPendingImports(
  subCompanyId: string,
  ids: string[],
): Promise<{ deleted: number }> {
  const uniqueIds = [...new Set(ids)];
  const deleted = await prisma.pendingImportedClient.deleteMany({
    where: { id: { in: uniqueIds }, subCompanyId },
  });
  return { deleted: deleted.count };
}
