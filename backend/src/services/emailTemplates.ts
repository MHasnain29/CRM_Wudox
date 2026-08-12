/**
 * Email templates: shared library (ownerUserId null) vs personal copies.
 * Shared queries always include ownerUserId: null to avoid leaking personal rows.
 */
import type { Request } from 'express';
import prisma from '../config/database';
import { resolveAgencyScope, resolveAllowedSubCompanyIds, isElevatedRoleForRequest } from '../config/agencyScope';
import { effectiveActorId } from '../middleware/actAs';
import { ensurePermissionKeys } from '../utils/requestPermission';

export type EmailTemplateRow = {
  id: string;
  subCompanyId: string | null;
  ownerUserId: string | null;
  sourceTemplateId: string | null;
  name: string;
  subject: string;
  bodyHtml: string;
  headerHtml: string | null;
  footerHtml: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function formatEmailTemplate(t: EmailTemplateRow) {
  return {
    id: t.id,
    subCompanyId: t.subCompanyId,
    ownerUserId: t.ownerUserId,
    sourceTemplateId: t.sourceTemplateId,
    name: t.name,
    subject: t.subject,
    bodyHtml: t.bodyHtml,
    headerHtml: t.headerHtml,
    footerHtml: t.footerHtml,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

async function hasSettingsRead(req: Request): Promise<boolean> {
  if (req.user?.role === 'super_admin') return true;
  try {
    const keys = await ensurePermissionKeys(req);
    return keys.includes('settings:read');
  } catch {
    return false;
  }
}

/** Shared library only — never personal copies. */
export async function listSharedTemplates(
  req: Request,
  opts: { subCompanyId?: string }
): Promise<EmailTemplateRow[]> {
  const isElevated = await isElevatedRoleForRequest(req);
  const wantsAll = !opts.subCompanyId || opts.subCompanyId === 'all';

  if (wantsAll && isElevated) {
    const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
    return prisma.emailTemplate.findMany({
      where: {
        ownerUserId: null,
        OR: [{ subCompanyId: { in: allowedIds } }, { subCompanyId: null }],
      },
      orderBy: [{ subCompanyId: 'asc' }, { name: 'asc' }],
    });
  }

  const subCompanyId =
    opts.subCompanyId && opts.subCompanyId !== 'all'
      ? opts.subCompanyId
      : await resolveAgencyScope(req);
  if (!subCompanyId) throw Object.assign(new Error('Agency context required'), { status: 403 });

  const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
  if (!allowedIds.includes(subCompanyId)) {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  }

  return prisma.emailTemplate.findMany({
    where: {
      ownerUserId: null,
      OR: [{ subCompanyId }, { subCompanyId: null }],
    },
    orderBy: { name: 'asc' },
  });
}

/** Personal copies for the effective actor only. */
export async function listMineTemplates(req: Request): Promise<EmailTemplateRow[]> {
  const actorId = effectiveActorId(req);
  return prisma.emailTemplate.findMany({
    where: { ownerUserId: actorId },
    orderBy: { name: 'asc' },
  });
}

/** Compose picker: shared in scope ∪ my personal. */
export async function listForCompose(req: Request): Promise<EmailTemplateRow[]> {
  const actorId = effectiveActorId(req);
  const isElevated = await isElevatedRoleForRequest(req);

  if (isElevated) {
    const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
    return prisma.emailTemplate.findMany({
      where: {
        OR: [
          {
            ownerUserId: null,
            OR: [{ subCompanyId: { in: allowedIds } }, { subCompanyId: null }],
          },
          { ownerUserId: actorId },
        ],
      },
      orderBy: [{ ownerUserId: 'asc' }, { name: 'asc' }],
    });
  }

  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) throw Object.assign(new Error('Agency context required'), { status: 403 });

  return prisma.emailTemplate.findMany({
    where: {
      OR: [
        {
          ownerUserId: null,
          OR: [{ subCompanyId }, { subCompanyId: null }],
        },
        { ownerUserId: actorId },
      ],
    },
    orderBy: [{ ownerUserId: 'asc' }, { name: 'asc' }],
  });
}

export async function getVisibleTemplate(
  req: Request,
  id: string
): Promise<EmailTemplateRow | null> {
  const actorId = effectiveActorId(req);
  const allowedIds = await resolveAllowedSubCompanyIds(req.user!);

  return prisma.emailTemplate.findFirst({
    where: {
      id,
      OR: [
        {
          ownerUserId: null,
          OR: [{ subCompanyId: { in: allowedIds } }, { subCompanyId: null }],
        },
        { ownerUserId: actorId },
      ],
    },
  });
}

export async function createSharedTemplate(
  req: Request,
  data: {
    name: string;
    subject: string;
    bodyHtml: string;
    headerHtml?: string;
    footerHtml?: string;
    subCompanyId?: string;
  }
): Promise<EmailTemplateRow> {
  const [allowedIds, isElevated] = await Promise.all([
    resolveAllowedSubCompanyIds(req.user!),
    isElevatedRoleForRequest(req),
  ]);

  let targetSubCompanyId: string | null;
  if (isElevated && !data.subCompanyId) {
    targetSubCompanyId = null;
  } else if (isElevated && data.subCompanyId) {
    if (!allowedIds.includes(data.subCompanyId)) {
      throw Object.assign(new Error('You do not have access to that agency'), { status: 403 });
    }
    targetSubCompanyId = data.subCompanyId;
  } else {
    const own = await resolveAgencyScope(req);
    if (!own) throw Object.assign(new Error('Agency context required'), { status: 403 });
    targetSubCompanyId = own;
  }

  return prisma.emailTemplate.create({
    data: {
      subCompanyId: targetSubCompanyId,
      ownerUserId: null,
      sourceTemplateId: null,
      name: data.name,
      subject: data.subject,
      bodyHtml: data.bodyHtml,
      headerHtml: data.headerHtml ?? null,
      footerHtml: data.footerHtml ?? null,
    },
  });
}

/** Clone a shared template into a personal copy for the effective actor. */
export async function customizeTemplate(
  req: Request,
  sourceTemplateId: string
): Promise<EmailTemplateRow> {
  const actorId = effectiveActorId(req);
  const allowedIds = await resolveAllowedSubCompanyIds(req.user!);

  const source = await prisma.emailTemplate.findFirst({
    where: {
      id: sourceTemplateId,
      ownerUserId: null,
      OR: [{ subCompanyId: { in: allowedIds } }, { subCompanyId: null }],
    },
  });
  if (!source) throw Object.assign(new Error('Template not found'), { status: 404 });

  const agencyId = await resolveAgencyScope(req);
  if (!agencyId) throw Object.assign(new Error('Agency context required'), { status: 403 });

  const baseName = source.name.replace(/\s*\(My copy\)\s*$/i, '').trim() || source.name;
  const name = `${baseName} (My copy)`.slice(0, 200);

  return prisma.emailTemplate.create({
    data: {
      subCompanyId: agencyId,
      ownerUserId: actorId,
      sourceTemplateId: source.id,
      name,
      subject: source.subject,
      bodyHtml: source.bodyHtml,
      headerHtml: source.headerHtml,
      footerHtml: source.footerHtml,
    },
  });
}

export async function updateTemplate(
  req: Request,
  id: string,
  data: {
    name?: string;
    subject?: string;
    bodyHtml?: string;
    headerHtml?: string | null;
    footerHtml?: string | null;
  }
): Promise<EmailTemplateRow> {
  const actorId = effectiveActorId(req);
  const existing = await prisma.emailTemplate.findFirst({ where: { id } });
  if (!existing) throw Object.assign(new Error('Template not found'), { status: 404 });

  if (existing.ownerUserId) {
    if (existing.ownerUserId !== actorId) {
      throw Object.assign(new Error('Template not found'), { status: 404 });
    }
  } else {
    if (!(await hasSettingsRead(req))) {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    }
    const [allowedIds, isElevated] = await Promise.all([
      resolveAllowedSubCompanyIds(req.user!),
      isElevatedRoleForRequest(req),
    ]);
    // Global (All Agencies): elevated only. Agency-scoped: must be in allowlist.
    if (existing.subCompanyId === null) {
      if (!isElevated) {
        throw Object.assign(new Error('Not your template'), { status: 403 });
      }
    } else if (!allowedIds.includes(existing.subCompanyId)) {
      throw Object.assign(new Error('Template not found'), { status: 404 });
    }
  }

  return prisma.emailTemplate.update({
    where: { id },
    data: {
      name: data.name,
      subject: data.subject,
      bodyHtml: data.bodyHtml,
      headerHtml: data.headerHtml,
      footerHtml: data.footerHtml,
    },
  });
}

export async function deleteTemplate(req: Request, id: string): Promise<void> {
  const actorId = effectiveActorId(req);
  const existing = await prisma.emailTemplate.findFirst({ where: { id } });
  if (!existing) throw Object.assign(new Error('Template not found'), { status: 404 });

  if (existing.ownerUserId) {
    if (existing.ownerUserId !== actorId) {
      throw Object.assign(new Error('Template not found'), { status: 404 });
    }
  } else {
    if (!(await hasSettingsRead(req))) {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    }
    const [allowedIds, isElevated] = await Promise.all([
      resolveAllowedSubCompanyIds(req.user!),
      isElevatedRoleForRequest(req),
    ]);
    if (existing.subCompanyId === null) {
      if (!isElevated) {
        throw Object.assign(new Error('Not your template'), { status: 403 });
      }
    } else if (!allowedIds.includes(existing.subCompanyId)) {
      throw Object.assign(new Error('Not your template'), { status: 403 });
    }
  }

  await prisma.emailTemplate.delete({ where: { id } });
}
