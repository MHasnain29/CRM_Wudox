/**
 * Client Notes — custom field definitions + per-client values.
 *
 * Visibility model:
 *   - global field (subCompanyId NULL): visible on every client; one logical value per
 *     (clientId, fieldDefId) enforced by service-layer transactional upsert.
 *   - agency field (subCompanyId set):  visible only when caller is in that agency AND
 *     the client has a ClientSubCompany row for that agency; one value per
 *     (clientId, fieldDefId, subCompanyId).
 *
 * Editability: PUT value rejects with 409 unless the client has a Lead.status='closed_won'.
 * Permissions are checked at the route layer (client_notes:configure, client_notes:fields:write).
 */
import type { Request } from 'express';
import { Prisma, ClientNoteFieldType, ClientVisibility } from '@prisma/client';
import prisma from '../config/database';
import { resolveAllowedSubCompanyIds } from '../config/agencyScope';
import type { JwtPayload } from '../middleware/auth';

export type FieldDefDto = {
  id: string;
  key: string;
  label: string;
  fieldType: ClientNoteFieldType;
  options: string[] | null;
  visibility: ClientVisibility;
  subCompanyId: string | null;
  subCompanyName: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FieldValueDto = {
  fieldDefId: string;
  value: unknown;
  updatedAt: string;
  updatedBy: { id: string; name: string };
};

/** Client is "Closed Won" when at least one of its leads has status closed_won. */
export async function isClosedWon(clientId: string): Promise<boolean> {
  const count = await prisma.lead.count({ where: { clientId, status: 'closed_won' } });
  return count > 0;
}

/** Returns a Set<clientId> for a batch of clientIds — single grouped query, no N+1. */
export async function getClosedWonClientIds(clientIds: string[]): Promise<Set<string>> {
  if (clientIds.length === 0) return new Set();
  const rows = await prisma.lead.findMany({
    where: { clientId: { in: clientIds }, status: 'closed_won' },
    select: { clientId: true },
    distinct: ['clientId'],
  });
  return new Set(rows.map((r) => r.clientId));
}

function parseOptions(raw: Prisma.JsonValue | null): string[] | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw.map((v) => String(v));
  return null;
}

function toFieldDefDto(row: {
  id: string;
  key: string;
  label: string;
  fieldType: ClientNoteFieldType;
  options: Prisma.JsonValue | null;
  visibility: ClientVisibility;
  subCompanyId: string | null;
  subCompany: { name: string } | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): FieldDefDto {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    fieldType: row.fieldType,
    options: parseOptions(row.options),
    visibility: row.visibility,
    subCompanyId: row.subCompanyId,
    subCompanyName: row.subCompany?.name ?? null,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Field defs the caller can configure in Settings → Client Notes.
 * Returns global defs + defs scoped to any agency the caller can access.
 */
export async function listConfigurableFieldDefs(req: Request): Promise<FieldDefDto[]> {
  const user = req.user as JwtPayload | undefined;
  if (!user) return [];
  const allowedAgencyIds = await resolveAllowedSubCompanyIds(user, req);
  const rows = await prisma.clientNoteFieldDef.findMany({
    where: {
      OR: [
        { subCompanyId: null },
        ...(allowedAgencyIds.length > 0 ? [{ subCompanyId: { in: allowedAgencyIds } }] : []),
      ],
    },
    include: { subCompany: { select: { name: true } } },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  });
  return rows.map(toFieldDefDto);
}

/**
 * Field defs that should be rendered for a specific client.
 * - Always: active global defs.
 * - Plus: active agency-scoped defs where the client has a ClientSubCompany row for that agency
 *   AND the caller can access that agency.
 */
export async function listFieldDefsForClient(req: Request, clientId: string): Promise<FieldDefDto[]> {
  const user = req.user as JwtPayload | undefined;
  if (!user) return [];
  const allowedAgencyIds = await resolveAllowedSubCompanyIds(user, req);
  const clientAgencyRows = await prisma.clientSubCompany.findMany({
    where: { clientId, ...(allowedAgencyIds.length > 0 ? { subCompanyId: { in: allowedAgencyIds } } : {}) },
    select: { subCompanyId: true },
  });
  const clientAgencyIds = clientAgencyRows.map((r) => r.subCompanyId);

  const rows = await prisma.clientNoteFieldDef.findMany({
    where: {
      isActive: true,
      OR: [
        { subCompanyId: null },
        ...(clientAgencyIds.length > 0 ? [{ subCompanyId: { in: clientAgencyIds } }] : []),
      ],
    },
    include: { subCompany: { select: { name: true } } },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  });
  return rows.map(toFieldDefDto);
}

/** Values keyed by fieldDefId. For global fields returns the single shared value; for agency fields the caller-agency value. */
export async function listFieldValuesForClient(
  req: Request,
  clientId: string,
  defs: FieldDefDto[],
): Promise<Record<string, FieldValueDto>> {
  if (defs.length === 0) return {};
  const user = req.user as JwtPayload | undefined;
  if (!user) return {};
  const callerAgencyId = user.subCompanyId;

  const globalDefIds = defs.filter((d) => d.visibility === ClientVisibility.global).map((d) => d.id);
  const agencyDefIds = defs.filter((d) => d.visibility === ClientVisibility.agency).map((d) => d.id);

  const out: Record<string, FieldValueDto> = {};

  if (globalDefIds.length > 0) {
    const rows = await prisma.clientNoteFieldValue.findMany({
      where: { clientId, fieldDefId: { in: globalDefIds } },
      orderBy: { updatedAt: 'desc' },
      include: { updatedBy: { select: { id: true, firstName: true, lastName: true } } },
    });
    // Pick most-recent per fieldDef (rows ordered desc — first one wins per group)
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.fieldDefId)) continue;
      seen.add(r.fieldDefId);
      out[r.fieldDefId] = {
        fieldDefId: r.fieldDefId,
        value: deserializeValue(r.value, defs.find((d) => d.id === r.fieldDefId)?.fieldType),
        updatedAt: r.updatedAt.toISOString(),
        updatedBy: {
          id: r.updatedBy.id,
          name: `${r.updatedBy.firstName} ${r.updatedBy.lastName}`.trim(),
        },
      };
    }
  }

  if (agencyDefIds.length > 0 && callerAgencyId) {
    const rows = await prisma.clientNoteFieldValue.findMany({
      where: { clientId, subCompanyId: callerAgencyId, fieldDefId: { in: agencyDefIds } },
      include: { updatedBy: { select: { id: true, firstName: true, lastName: true } } },
    });
    for (const r of rows) {
      out[r.fieldDefId] = {
        fieldDefId: r.fieldDefId,
        value: deserializeValue(r.value, defs.find((d) => d.id === r.fieldDefId)?.fieldType),
        updatedAt: r.updatedAt.toISOString(),
        updatedBy: {
          id: r.updatedBy.id,
          name: `${r.updatedBy.firstName} ${r.updatedBy.lastName}`.trim(),
        },
      };
    }
  }

  return out;
}

function deserializeValue(raw: string | null, fieldType: ClientNoteFieldType | undefined): unknown {
  if (raw === null || raw === undefined) return null;
  switch (fieldType) {
    case ClientNoteFieldType.number: {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case ClientNoteFieldType.boolean:
      return raw === 'true';
    default:
      return raw;
  }
}

function serializeValue(raw: unknown, fieldType: ClientNoteFieldType, options: string[] | null): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  switch (fieldType) {
    case ClientNoteFieldType.text:
    case ClientNoteFieldType.textarea: {
      if (typeof raw !== 'string') throw new ValidationError('Value must be a string');
      const trimmed = raw.trim();
      return trimmed.length === 0 ? null : trimmed;
    }
    case ClientNoteFieldType.number: {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) throw new ValidationError('Value must be a finite number');
      return String(n);
    }
    case ClientNoteFieldType.boolean: {
      if (typeof raw === 'boolean') return String(raw);
      if (raw === 'true' || raw === 'false') return raw;
      throw new ValidationError('Value must be true or false');
    }
    case ClientNoteFieldType.select: {
      if (typeof raw !== 'string') throw new ValidationError('Value must be one of the listed options');
      if (!options || !options.includes(raw)) throw new ValidationError('Value must be one of the listed options');
      return raw;
    }
  }
}

export class ValidationError extends Error {
  status = 422;
}
export class ConflictError extends Error {
  status = 409;
}
export class NotFoundError extends Error {
  status = 404;
}

/** Validate key format for a new field def. */
export function validateKey(key: string): void {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(key)) {
    throw new ValidationError('Key must be lowercase snake_case, start with a letter, max 63 chars');
  }
}

export type CreateFieldDefInput = {
  key: string;
  label: string;
  fieldType: ClientNoteFieldType;
  options?: string[] | null;
  visibility: ClientVisibility;
  subCompanyId?: string | null;
  sortOrder?: number;
};

export async function createFieldDef(req: Request, input: CreateFieldDefInput): Promise<FieldDefDto> {
  const user = req.user as JwtPayload | undefined;
  if (!user) throw new ValidationError('Unauthorized');
  validateKey(input.key);

  if (input.visibility === ClientVisibility.agency) {
    if (!input.subCompanyId) throw new ValidationError('subCompanyId is required for agency-scoped fields');
    const allowed = await resolveAllowedSubCompanyIds(user, req);
    if (!allowed.includes(input.subCompanyId)) {
      throw new ValidationError('You cannot create fields for this agency');
    }
  }
  if (input.fieldType === ClientNoteFieldType.select) {
    if (!input.options || input.options.length === 0) {
      throw new ValidationError('At least one option is required for select fields');
    }
  }

  const subCompanyId = input.visibility === ClientVisibility.agency ? input.subCompanyId ?? null : null;
  // Pre-check key uniqueness within scope so we return a friendly 409 instead of a Prisma error.
  const dup = await prisma.clientNoteFieldDef.findFirst({
    where: { key: input.key, subCompanyId: subCompanyId ?? null },
    select: { id: true },
  });
  if (dup) throw new ConflictError('A field with this key already exists in this scope');

  const row = await prisma.clientNoteFieldDef.create({
    data: {
      key: input.key,
      label: input.label.trim(),
      fieldType: input.fieldType,
      options: input.options ?? Prisma.DbNull,
      visibility: input.visibility,
      subCompanyId,
      sortOrder: input.sortOrder ?? 0,
      createdById: user.sub,
    },
    include: { subCompany: { select: { name: true } } },
  });
  return toFieldDefDto(row);
}

export type UpdateFieldDefInput = {
  label?: string;
  options?: string[] | null;
  sortOrder?: number;
  isActive?: boolean;
};

export async function updateFieldDef(req: Request, id: string, patch: UpdateFieldDefInput): Promise<FieldDefDto> {
  const user = req.user as JwtPayload | undefined;
  if (!user) throw new ValidationError('Unauthorized');

  const existing = await prisma.clientNoteFieldDef.findUnique({
    where: { id },
    include: { subCompany: { select: { name: true } } },
  });
  if (!existing) throw new NotFoundError('Field not found');

  // Authorization: caller must be able to access this field's scope
  if (existing.subCompanyId) {
    const allowed = await resolveAllowedSubCompanyIds(user, req);
    if (!allowed.includes(existing.subCompanyId)) throw new NotFoundError('Field not found');
  }

  if (existing.fieldType === ClientNoteFieldType.select && patch.options !== undefined) {
    if (!patch.options || patch.options.length === 0) {
      throw new ValidationError('Select fields require at least one option');
    }
    // If existing values reference an option that's being removed, block the change.
    const dropped = (parseOptions(existing.options) ?? []).filter((o) => !patch.options!.includes(o));
    if (dropped.length > 0) {
      const usingDropped = await prisma.clientNoteFieldValue.findFirst({
        where: { fieldDefId: id, value: { in: dropped } },
        select: { id: true },
      });
      if (usingDropped) {
        throw new ConflictError('Cannot remove options that are in use by existing values');
      }
    }
  }

  const row = await prisma.clientNoteFieldDef.update({
    where: { id },
    data: {
      ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
      ...(patch.options !== undefined ? { options: patch.options ?? Prisma.DbNull } : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    },
    include: { subCompany: { select: { name: true } } },
  });
  return toFieldDefDto(row);
}

export async function deactivateFieldDef(req: Request, id: string): Promise<void> {
  const user = req.user as JwtPayload | undefined;
  if (!user) throw new ValidationError('Unauthorized');
  const existing = await prisma.clientNoteFieldDef.findUnique({ where: { id }, select: { subCompanyId: true } });
  if (!existing) throw new NotFoundError('Field not found');
  if (existing.subCompanyId) {
    const allowed = await resolveAllowedSubCompanyIds(user, req);
    if (!allowed.includes(existing.subCompanyId)) throw new NotFoundError('Field not found');
  }
  await prisma.clientNoteFieldDef.update({ where: { id }, data: { isActive: false } });
}

/**
 * Write a value for one field on one client. Caller must have client_notes:fields:write and
 * the client must be Closed Won. For global fields the write goes to a single row per
 * (clientId, fieldDefId) via transactional upsert keyed on a sentinel agency = caller's own.
 */
export async function setFieldValue(
  req: Request,
  clientId: string,
  fieldDefId: string,
  rawValue: unknown,
): Promise<FieldValueDto> {
  const user = req.user as JwtPayload | undefined;
  if (!user?.subCompanyId) throw new ValidationError('Agency context required');

  // 1. Client must be Closed Won.
  if (!(await isClosedWon(clientId))) {
    throw new ConflictError('Field Notes are only editable when the client is Closed Won');
  }

  // 2. The field def must be visible to the caller for this client.
  const visible = await listFieldDefsForClient(req, clientId);
  const def = visible.find((d) => d.id === fieldDefId);
  if (!def) throw new NotFoundError('Field not found');
  if (!def.isActive) throw new ConflictError('Field is no longer active');

  // 3. Validate + serialize the value.
  const serialized = serializeValue(rawValue, def.fieldType, def.options);

  // 4. Pick the row key. For global → single shared row keyed on (clientId, fieldDefId);
  //    we use the caller's subCompanyId as the carrier but enforce a single-row invariant
  //    inside a transaction by replacing any other row that exists for the same (clientId, fieldDefId).
  const callerAgencyId = user.subCompanyId;

  const row = await prisma.$transaction(async (tx) => {
    if (def.visibility === ClientVisibility.global) {
      // Delete any prior row for this (clientId, fieldDefId) regardless of subCompanyId
      // so the unique [clientId, fieldDefId, subCompanyId] index still applies but logically
      // a global field has at most one row at any time.
      await tx.clientNoteFieldValue.deleteMany({
        where: { clientId, fieldDefId, NOT: { subCompanyId: callerAgencyId } },
      });
    }
    return tx.clientNoteFieldValue.upsert({
      where: {
        clientId_fieldDefId_subCompanyId: {
          clientId,
          fieldDefId,
          subCompanyId: callerAgencyId,
        },
      },
      update: { value: serialized, updatedById: user.sub },
      create: {
        clientId,
        fieldDefId,
        subCompanyId: callerAgencyId,
        value: serialized,
        updatedById: user.sub,
      },
      include: { updatedBy: { select: { id: true, firstName: true, lastName: true } } },
    });
  });

  return {
    fieldDefId,
    value: deserializeValue(row.value, def.fieldType),
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: {
      id: row.updatedBy.id,
      name: `${row.updatedBy.firstName} ${row.updatedBy.lastName}`.trim(),
    },
  };
}

// Re-export Prisma's needed bits so route file uses one source.
export { ClientNoteFieldType, ClientVisibility };
