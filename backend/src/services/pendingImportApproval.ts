import { randomUUID } from 'crypto';
import type { PendingImportedClient, Prisma } from '@prisma/client';
import prisma from '../config/database';
import {
  defaultLockDays,
  resolveClientVisibility,
} from './clientVisibilityPolicy';
import { isSuperUserScreenRole } from '../config/clientCreateApproval';
import { groupUploaderApprovals, type ImportUploaderApprovalGroup } from './pendingImportApprovalNotify';

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

const BULK_APPROVE_CHUNK = 100;

type PreparedBulkRow = {
  pendingId: string;
  importedById: string;
  name: string;
  client: Prisma.ClientCreateManyInput;
  contacts: Prisma.ClientContactCreateManyInput[];
  link: Prisma.ClientSubCompanyCreateManyInput;
  tags: Prisma.ClientTagCreateManyInput[];
  visibility: 'global' | 'agency';
};

function prepareBulkApproveRow(
  pending: PendingImportWithImporter,
  subCompanyId: string,
  lockDays: number,
  codeSuffix: string,
): PreparedBulkRow {
  const now = new Date();
  const clientId = randomUUID();
  const stagedContacts = parseStagedContacts(pending);
  const importerRole = pending.importedBy?.role ?? undefined;
  const visibility = resolveClientVisibility({
    creatorRole: importerRole,
    lockDays,
    explicitAgencyPath: isSuperUserScreenRole(importerRole),
  });
  const contactRows = buildContactRows(pending, stagedContacts);
  const uniqueTags = [...new Set((pending.tags ?? []).map((t) => t.trim()).filter(Boolean))];

  return {
    pendingId: pending.id,
    importedById: pending.importedById,
    name: pending.name,
    visibility,
    client: {
      id: clientId,
      corporateCode: corporateCodeForPending(pending, codeSuffix),
      name: pending.name.trim(),
      industry: pending.industry?.trim() || null,
      location: pending.location?.trim() || null,
      address: pending.address?.trim() || null,
      companySize: pending.companySize?.trim() || pending.employees?.trim() || null,
      status: 'contacted',
      visibility,
      createdByRole: importerRole ?? null,
      ...(visibility === 'global' ? { visibilityPromotedAt: now } : {}),
      importSourceId: pending.sourceId?.trim() || null,
      createdAt: now,
      updatedAt: now,
    },
    contacts: contactRows.map((c) => ({
      id: randomUUID(),
      clientId,
      name: c.name,
      title: c.title,
      email: c.email,
      phone: c.phone,
      phoneExtension: c.phoneExtension,
      linkedin: c.linkedin,
      isPrimary: c.isPrimary,
      createdAt: now,
      updatedAt: now,
    })),
    link: {
      id: randomUUID(),
      clientId,
      subCompanyId,
      status: 'contacted',
      createdAt: now,
      updatedAt: now,
    },
    tags: uniqueTags.map((tag) => ({ clientId, subCompanyId, tag })),
  };
}

async function insertPreparedChunk(
  tx: Prisma.TransactionClient,
  rows: PreparedBulkRow[],
): Promise<void> {
  await tx.client.createMany({ data: rows.map((r) => r.client) });
  const contacts = rows.flatMap((r) => r.contacts);
  if (contacts.length > 0) {
    await tx.clientContact.createMany({ data: contacts });
  }
  await tx.clientSubCompany.createMany({ data: rows.map((r) => r.link) });
  const tags = rows.flatMap((r) => r.tags);
  if (tags.length > 0) {
    await tx.clientTag.createMany({ data: tags, skipDuplicates: true });
  }
  await tx.pendingImportedClient.deleteMany({
    where: { id: { in: rows.map((r) => r.pendingId) } },
  });
}

async function ensureAllowedIndustries(subCompanyId: string, names: string[]): Promise<void> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (unique.length === 0) return;
  const existing = await prisma.allowedIndustry.findMany({
    where: { subCompanyId, name: { in: unique } },
    select: { name: true },
  });
  const have = new Set(existing.map((e) => e.name));
  const missing = unique.filter((name) => !have.has(name));
  if (missing.length === 0) return;
  await prisma.allowedIndustry.createMany({
    data: missing.map((name) => ({ subCompanyId, name })),
    skipDuplicates: true,
  });
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
  uploaderApprovals: ImportUploaderApprovalGroup[];
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
    uploaderApprovals: [],
  };

  const ordered = uniqueIds.filter((id) => pendingById.has(id));
  for (const id of uniqueIds) {
    if (!pendingById.has(id)) {
      result.failed.push({ id, name: id, error: 'Pending import not found' });
    }
  }

  await ensureAllowedIndustries(
    subCompanyId,
    ordered.map((id) => pendingById.get(id)?.industry ?? '').filter(Boolean),
  );

  const approvedRows: Array<{ importedById: string; name: string; clientId: string }> = [];

  const recordSuccess = (rows: PreparedBulkRow[]) => {
    result.approved += rows.length;
    for (const row of rows) {
      const clientId = String(row.client.id);
      result.clientIds.push(clientId);
      approvedRows.push({ importedById: row.importedById, name: row.name, clientId });
      if (row.visibility === 'global') result.hadGlobalVisibility = true;
    }
  };

  const approveOneByOne = async (slice: typeof ordered, startIndex: number) => {
    for (let i = 0; i < slice.length; i++) {
      const id = slice[i];
      const pending = pendingById.get(id)!;
      try {
        const row = await prisma.$transaction((tx) =>
          approvePendingImportAsNew(tx, {
            pending,
            subCompanyId,
            lockDays,
            codeSuffix: String(startIndex + i),
          }),
        );
        result.approved += 1;
        result.clientIds.push(row.clientId);
        approvedRows.push({
          importedById: pending.importedById,
          name: pending.name,
          clientId: row.clientId,
        });
        if (row.visibility === 'global') result.hadGlobalVisibility = true;
      } catch (err) {
        result.failed.push({
          id,
          name: pending.name,
          error: err instanceof Error ? err.message : 'Approve failed',
        });
      }
    }
  };

  for (let start = 0; start < ordered.length; start += BULK_APPROVE_CHUNK) {
    const slice = ordered.slice(start, start + BULK_APPROVE_CHUNK);
    const prepared = slice.map((id, i) =>
      prepareBulkApproveRow(pendingById.get(id)!, subCompanyId, lockDays, `${start + i}-${randomUUID().slice(0, 8)}`),
    );
    try {
      await prisma.$transaction((tx) => insertPreparedChunk(tx, prepared), {
        timeout: 30_000,
        maxWait: 10_000,
      });
      recordSuccess(prepared);
    } catch {
      // One bad row must not fail the whole chunk — fall back to per-row.
      await approveOneByOne(slice, start);
    }
  }

  result.uploaderApprovals = groupUploaderApprovals(approvedRows);
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
