import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { clientVisibilityWhere } from './clientAgencyAccess';
import {
  normalizeImportEmail,
  normalizeImportPhone,
  normalizeImportCompanyName,
  type ImportConflictScope,
} from './clientImportConflictCheck';

export type ContactImportMatchKey = 'corporateCode' | 'companyName' | 'importSourceId';

export type ContactImportContactPayload = {
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  extension?: string | null;
  linkedin?: string | null;
  isPrimary?: boolean | null;
};

export type ContactImportRowPayload = {
  corporateCode?: string | null;
  companyName?: string | null;
  importSourceId?: string | null;
  contacts: ContactImportContactPayload[];
};

export type ContactImportMatchResult = {
  targetClientId: string;
  clientName: string;
  matchKey: ContactImportMatchKey;
  matchValue: string;
};

export type ContactImportConflictResult = {
  unmatched: Array<{
    rowIndex: number;
    corporateCode?: string | null;
    companyName?: string | null;
    importSourceId?: string | null;
    reason: string;
  }>;
  duplicateEmails: Array<{ email: string; clientName: string; clientId: string }>;
  duplicatePhones: Array<{ phone: string; clientName: string; clientId: string }>;
  inFileDuplicateEmails: string[];
  inFileDuplicatePhones: string[];
  ambiguousMatches: Array<{
    matchKey: ContactImportMatchKey;
    matchValue: string;
    clientIds: string[];
  }>;
  matched: Array<ContactImportMatchResult & { rowIndex: number; contactCount: number }>;
  hasConflicts: boolean;
};

export class ContactImportConflictError extends Error {
  readonly conflicts: ContactImportConflictResult;

  constructor(conflicts: ContactImportConflictResult) {
    super('Contact import blocked due to conflicts');
    this.name = 'ContactImportConflictError';
    this.conflicts = conflicts;
  }
}

function clientScopeWhere(scope: ImportConflictScope): Prisma.ClientWhereInput {
  if (scope.importDestination === 'global') return {};
  return clientVisibilityWhere(scope.subCompanyId);
}

function findInFileContactDuplicates(rows: ContactImportRowPayload[]): {
  inFileDuplicateEmails: string[];
  inFileDuplicatePhones: string[];
} {
  const emailOccurrences = new Map<string, number>();
  const phoneOccurrences = new Map<string, number>();

  for (const row of rows) {
    for (const contact of row.contacts) {
      const email = normalizeImportEmail(contact.email);
      if (email) emailOccurrences.set(email, (emailOccurrences.get(email) ?? 0) + 1);
      const phone = normalizeImportPhone(contact.phone);
      if (phone) phoneOccurrences.set(phone, (phoneOccurrences.get(phone) ?? 0) + 1);
    }
  }

  return {
    inFileDuplicateEmails: [...emailOccurrences.entries()]
      .filter(([, count]) => count > 1)
      .map(([email]) => email),
    inFileDuplicatePhones: [...phoneOccurrences.entries()]
      .filter(([, count]) => count > 1)
      .map(([phone]) => phone),
  };
}

async function resolveClientMatch(
  row: ContactImportRowPayload,
  scope: ImportConflictScope,
): Promise<
  | { ok: true; match: ContactImportMatchResult }
  | { ok: false; unmatchedReason?: string; ambiguous?: { matchKey: ContactImportMatchKey; matchValue: string; clientIds: string[] } }
> {
  const scopeWhere = clientScopeWhere(scope);
  const corporateCode = row.corporateCode?.trim() || null;
  const companyName = row.companyName?.trim() || null;
  const importSourceId = row.importSourceId?.trim() || null;

  if (!corporateCode && !companyName && !importSourceId) {
    return { ok: false, unmatchedReason: 'No company match key provided (corporateCode, companyName, or importSourceId)' };
  }

  if (corporateCode) {
    const hits = await prisma.client.findMany({
      where: { ...scopeWhere, corporateCode },
      select: { id: true, name: true },
      take: 5,
    });
    if (hits.length === 1) {
      return {
        ok: true,
        match: {
          targetClientId: hits[0].id,
          clientName: hits[0].name,
          matchKey: 'corporateCode',
          matchValue: corporateCode,
        },
      };
    }
    if (hits.length > 1) {
      return {
        ok: false,
        ambiguous: {
          matchKey: 'corporateCode',
          matchValue: corporateCode,
          clientIds: hits.map((h) => h.id),
        },
      };
    }
  }

  if (companyName) {
    const normalized = normalizeImportCompanyName(companyName);
    const candidates = await prisma.client.findMany({
      where: {
        ...scopeWhere,
        name: { equals: companyName, mode: 'insensitive' },
      },
      select: { id: true, name: true },
      take: 5,
    });
    // Prefer exact trimmed case-insensitive; filter to normalized equality for safety
    const hits = candidates.filter((c) => normalizeImportCompanyName(c.name) === normalized);
    if (hits.length === 1) {
      return {
        ok: true,
        match: {
          targetClientId: hits[0].id,
          clientName: hits[0].name,
          matchKey: 'companyName',
          matchValue: companyName,
        },
      };
    }
    if (hits.length > 1) {
      return {
        ok: false,
        ambiguous: {
          matchKey: 'companyName',
          matchValue: companyName,
          clientIds: hits.map((h) => h.id),
        },
      };
    }
  }

  if (importSourceId) {
    const hits = await prisma.client.findMany({
      where: { ...scopeWhere, importSourceId },
      select: { id: true, name: true },
      take: 5,
    });
    if (hits.length === 1) {
      return {
        ok: true,
        match: {
          targetClientId: hits[0].id,
          clientName: hits[0].name,
          matchKey: 'importSourceId',
          matchValue: importSourceId,
        },
      };
    }
    if (hits.length > 1) {
      return {
        ok: false,
        ambiguous: {
          matchKey: 'importSourceId',
          matchValue: importSourceId,
          clientIds: hits.map((h) => h.id),
        },
      };
    }
  }

  return {
    ok: false,
    unmatchedReason: `No existing client matched${corporateCode ? ` corporateCode=${corporateCode}` : ''}${companyName ? ` companyName=${companyName}` : ''}${importSourceId ? ` importSourceId=${importSourceId}` : ''}`,
  };
}

export async function checkContactImportConflicts(
  rows: ContactImportRowPayload[],
  scope: ImportConflictScope,
): Promise<ContactImportConflictResult> {
  const inFile = findInFileContactDuplicates(rows);
  const unmatched: ContactImportConflictResult['unmatched'] = [];
  const ambiguousMatches: ContactImportConflictResult['ambiguousMatches'] = [];
  const matched: ContactImportConflictResult['matched'] = [];

  const emails = new Set<string>();
  const phones = new Set<string>();

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    for (const c of row.contacts) {
      const email = normalizeImportEmail(c.email);
      if (email) emails.add(email);
      const phone = normalizeImportPhone(c.phone);
      if (phone) phones.add(phone);
    }

    const resolved = await resolveClientMatch(row, scope);
    if (!resolved.ok) {
      if (resolved.ambiguous) {
        ambiguousMatches.push(resolved.ambiguous);
      } else {
        unmatched.push({
          rowIndex,
          corporateCode: row.corporateCode,
          companyName: row.companyName,
          importSourceId: row.importSourceId,
          reason: resolved.unmatchedReason ?? 'Unmatched',
        });
      }
      continue;
    }
    matched.push({
      ...resolved.match,
      rowIndex,
      contactCount: row.contacts.length,
    });
  }

  const scopeWhere = clientScopeWhere(scope);
  const hasScopeFilter = scope.importDestination === 'agency';

  const [emailHits, phoneHits] = await Promise.all([
    emails.size
      ? prisma.clientContact.findMany({
          where: {
            email: { in: [...emails] },
            ...(hasScopeFilter ? { client: scopeWhere } : {}),
          },
          select: { email: true, client: { select: { id: true, name: true } } },
        })
      : [],
    phones.size
      ? prisma.clientContact.findMany({
          where: {
            phone: { in: [...phones] },
            ...(hasScopeFilter ? { client: scopeWhere } : {}),
          },
          select: { phone: true, client: { select: { id: true, name: true } } },
        })
      : [],
  ]);

  const duplicateEmails = emailHits
    .filter((h) => h.email)
    .map((h) => ({
      email: h.email!,
      clientName: h.client.name,
      clientId: h.client.id,
    }));
  const duplicatePhones = phoneHits
    .filter((h) => h.phone)
    .map((h) => ({
      phone: h.phone!,
      clientName: h.client.name,
      clientId: h.client.id,
    }));

  const hasConflicts =
    unmatched.length > 0 ||
    ambiguousMatches.length > 0 ||
    duplicateEmails.length > 0 ||
    duplicatePhones.length > 0 ||
    inFile.inFileDuplicateEmails.length > 0 ||
    inFile.inFileDuplicatePhones.length > 0;

  return {
    unmatched,
    duplicateEmails,
    duplicatePhones,
    inFileDuplicateEmails: inFile.inFileDuplicateEmails,
    inFileDuplicatePhones: inFile.inFileDuplicatePhones,
    ambiguousMatches,
    matched,
    hasConflicts,
  };
}

export async function assertContactImportHasNoConflicts(
  rows: ContactImportRowPayload[],
  scope: ImportConflictScope,
): Promise<ContactImportConflictResult> {
  const result = await checkContactImportConflicts(rows, scope);
  if (result.hasConflicts) {
    throw new ContactImportConflictError(result);
  }
  return result;
}

/** Resolve each row to a target client (throws if any conflict). Returns grouped by client. */
export async function resolveContactImportRows(
  rows: ContactImportRowPayload[],
  scope: ImportConflictScope,
): Promise<
  Array<{
    targetClientId: string;
    clientName: string;
    matchKey: ContactImportMatchKey;
    matchValue: string;
    contacts: ContactImportContactPayload[];
  }>
> {
  const check = await assertContactImportHasNoConflicts(rows, scope);
  const byClient = new Map<
    string,
    {
      targetClientId: string;
      clientName: string;
      matchKey: ContactImportMatchKey;
      matchValue: string;
      contacts: ContactImportContactPayload[];
    }
  >();

  for (const match of check.matched) {
    const row = rows[match.rowIndex];
    if (!row) continue;
    const existing = byClient.get(match.targetClientId);
    if (existing) {
      existing.contacts.push(...row.contacts);
    } else {
      byClient.set(match.targetClientId, {
        targetClientId: match.targetClientId,
        clientName: match.clientName,
        matchKey: match.matchKey,
        matchValue: match.matchValue,
        contacts: [...row.contacts],
      });
    }
  }

  return [...byClient.values()];
}
