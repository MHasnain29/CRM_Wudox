import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { clientVisibilityWhere } from './clientAgencyAccess';

export type ImportContactPayload = {
  name: string;
  email?: string | null;
  phone?: string | null;
};

export type ImportClientPayload = {
  name: string;
  contacts?: ImportContactPayload[];
};

export type ImportConflictScope =
  | { importDestination: 'global' }
  | { importDestination: 'agency'; subCompanyId: string };

export type ImportConflictResult = {
  duplicateEmails: Array<{ email: string; clientName: string; clientId: string }>;
  duplicatePhones: Array<{ phone: string; clientName: string; clientId: string }>;
  duplicateCompanyNames: Array<{ name: string; clientName: string; clientId: string }>;
  inFileDuplicateEmails: string[];
  inFileDuplicatePhones: string[];
  hasConflicts: boolean;
};

export class ImportConflictError extends Error {
  readonly conflicts: ImportConflictResult;

  constructor(conflicts: ImportConflictResult) {
    super('Import blocked due to conflicts');
    this.name = 'ImportConflictError';
    this.conflicts = conflicts;
  }
}

export function normalizeImportEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function normalizeImportPhone(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function normalizeImportCompanyName(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function clientScopeWhere(scope: ImportConflictScope): Prisma.ClientWhereInput {
  if (scope.importDestination === 'global') return {};
  return clientVisibilityWhere(scope.subCompanyId);
}

export function findInFileContactDuplicates(clients: ImportClientPayload[]): {
  inFileDuplicateEmails: string[];
  inFileDuplicatePhones: string[];
} {
  const emailOccurrences = new Map<string, number>();
  const phoneOccurrences = new Map<string, number>();

  for (const client of clients) {
    for (const contact of client.contacts ?? []) {
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

function collectImportValues(clients: ImportClientPayload[]): {
  emails: string[];
  phones: string[];
  companyNames: string[];
} {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const companyNames = new Set<string>();

  for (const client of clients) {
    const name = client.name.trim();
    if (name) companyNames.add(name);
    for (const contact of client.contacts ?? []) {
      const email = normalizeImportEmail(contact.email);
      if (email) emails.add(email);
      const phone = normalizeImportPhone(contact.phone);
      if (phone) phones.add(phone);
    }
  }

  return {
    emails: [...emails],
    phones: [...phones],
    companyNames: [...companyNames],
  };
}

export function buildImportConflictResult(
  crm: Pick<
    ImportConflictResult,
    'duplicateEmails' | 'duplicatePhones' | 'duplicateCompanyNames'
  >,
  inFile: Pick<ImportConflictResult, 'inFileDuplicateEmails' | 'inFileDuplicatePhones'>,
): ImportConflictResult {
  const hasConflicts =
    crm.duplicateEmails.length > 0 ||
    crm.duplicatePhones.length > 0 ||
    crm.duplicateCompanyNames.length > 0 ||
    inFile.inFileDuplicateEmails.length > 0 ||
    inFile.inFileDuplicatePhones.length > 0;

  return { ...crm, ...inFile, hasConflicts };
}

export async function findCrmImportConflicts(input: {
  emails: string[];
  phones: string[];
  companyNames: string[];
  scope: ImportConflictScope;
}): Promise<
  Pick<ImportConflictResult, 'duplicateEmails' | 'duplicatePhones' | 'duplicateCompanyNames'>
> {
  const scopeWhere = clientScopeWhere(input.scope);
  const hasScopeFilter = input.scope.importDestination === 'agency';

  const [emailHits, phoneHits, nameHits] = await Promise.all([
    input.emails.length
      ? prisma.clientContact.findMany({
          where: {
            email: { in: input.emails },
            ...(hasScopeFilter ? { client: scopeWhere } : {}),
          },
          select: { email: true, client: { select: { id: true, name: true } } },
        })
      : [],
    input.phones.length
      ? prisma.clientContact.findMany({
          where: {
            phone: { in: input.phones },
            ...(hasScopeFilter ? { client: scopeWhere } : {}),
          },
          select: { phone: true, client: { select: { id: true, name: true } } },
        })
      : [],
    input.companyNames.length
      ? prisma.client.findMany({
          where: {
            ...(hasScopeFilter ? scopeWhere : {}),
            OR: input.companyNames.map((name) => ({
              name: { equals: name.trim(), mode: 'insensitive' as const },
            })),
          },
          select: { id: true, name: true },
        })
      : [],
  ]);

  const seenEmails = new Map<string, { email: string; clientName: string; clientId: string }>();
  for (const hit of emailHits) {
    const email = hit.email ? normalizeImportEmail(hit.email) : '';
    if (email && !seenEmails.has(email)) {
      seenEmails.set(email, {
        email,
        clientName: hit.client.name,
        clientId: hit.client.id,
      });
    }
  }

  const seenPhones = new Map<string, { phone: string; clientName: string; clientId: string }>();
  for (const hit of phoneHits) {
    const phone = hit.phone ? normalizeImportPhone(hit.phone) : '';
    if (phone && !seenPhones.has(phone)) {
      seenPhones.set(phone, {
        phone,
        clientName: hit.client.name,
        clientId: hit.client.id,
      });
    }
  }

  const seenNames = new Map<string, { name: string; clientName: string; clientId: string }>();
  for (const hit of nameHits) {
    const normalized = normalizeImportCompanyName(hit.name);
    if (normalized && !seenNames.has(normalized)) {
      seenNames.set(normalized, {
        name: hit.name,
        clientName: hit.name,
        clientId: hit.id,
      });
    }
  }

  return {
    duplicateEmails: [...seenEmails.values()],
    duplicatePhones: [...seenPhones.values()],
    duplicateCompanyNames: [...seenNames.values()],
  };
}

export function resolveImportConflictScope(options: {
  importDestination?: 'global' | 'agency';
  subCompanyId?: string;
}): ImportConflictScope {
  if (options.importDestination === 'global') {
    return { importDestination: 'global' };
  }
  const subCompanyId = options.subCompanyId?.trim();
  if (!subCompanyId) {
    throw new Error('Agency context required for import conflict check');
  }
  return { importDestination: 'agency', subCompanyId };
}

export async function checkImportConflicts(
  clients: ImportClientPayload[],
  options: {
    importDestination?: 'global' | 'agency';
    subCompanyId?: string;
  },
): Promise<ImportConflictResult> {
  const inFile = findInFileContactDuplicates(clients);
  const { emails, phones, companyNames } = collectImportValues(clients);
  const scope = resolveImportConflictScope(options);
  const crm = await findCrmImportConflicts({ emails, phones, companyNames, scope });
  return buildImportConflictResult(crm, inFile);
}

export async function assertImportHasNoConflicts(
  clients: ImportClientPayload[],
  options: {
    importDestination?: 'global' | 'agency';
    subCompanyId?: string;
  },
): Promise<void> {
  const result = await checkImportConflicts(clients, options);
  if (result.hasConflicts) {
    throw new ImportConflictError(result);
  }
}
