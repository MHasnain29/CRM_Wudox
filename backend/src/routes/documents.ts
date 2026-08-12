/**
 * Documents/attachments for clients and leads.
 * List, upload (store in R2, create Document), delete, download.
 * All operations are agency-scoped via subCompanyId.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import type { Prisma } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { actAsMiddleware, effectiveActorId } from '../middleware/actAs';
import { uploadToR2, getFromR2 } from '../services/r2Storage';
import { env } from '../config/env';
import { createActivityLog } from '../services/activityLog';
import { resolveAgencyScope } from '../config/agencyScope';
import {
  assertClientAccessibleInAgency,
  documentsForClientDetail,
  isGlobalCreatorRole,
  resolveClientDetailScope,
} from '../services/clientAgencyAccess';

const listQuerySchema = z.object({
  clientId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
});

const uploadBodySchema = z.object({
  clientId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  type: z.string().min(1).max(100).default('attachment'),
  fileBase64: z.string().min(1),
  mimeType: z.string().max(128).optional(),
});

export const documentsRouter = Router();
documentsRouter.use(authenticate);
documentsRouter.use(actAsMiddleware);
documentsRouter.use(requirePermission('clients:read'));

async function resolveDocumentAgencyContext(req: Request): Promise<string | null> {
  return resolveAgencyScope(req);
}

async function assertLeadInAgency(leadId: string, subCompanyId: string): Promise<boolean> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, subCompanyId },
    select: { id: true, clientId: true },
  });
  return Boolean(lead);
}

function serializeDocument(d: {
  id: string;
  name: string;
  type: string;
  fileUrl: string | null;
  createdAt: Date;
  clientId: string | null;
  leadId: string | null;
}) {
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    fileUrl: d.fileUrl,
    createdAt: d.createdAt,
    clientId: d.clientId,
    leadId: d.leadId,
  };
}

/** GET /documents — list by clientId and/or leadId (at least one required), agency-scoped */
documentsRouter.get('/', async (req: Request, res: Response) => {
  const subCompanyId = await resolveDocumentAgencyContext(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success || (!parsed.data.clientId && !parsed.data.leadId)) {
    return res.status(400).json({ error: 'Provide clientId or leadId' });
  }
  const { clientId, leadId } = parsed.data;

  if (clientId) {
    const ok = await assertClientAccessibleInAgency(clientId, subCompanyId);
    if (!ok) return res.status(404).json({ error: 'Client not found' });
  }
  if (leadId) {
    const ok = await assertLeadInAgency(leadId, subCompanyId);
    if (!ok) return res.status(404).json({ error: 'Lead not found' });
  }

  const detailScope = await resolveClientDetailScope(req, subCompanyId);
  const where: Prisma.DocumentWhereInput = {
    AND: [
      documentsForClientDetail(detailScope),
      ...(clientId ? [{ clientId }] : []),
      ...(leadId ? [{ leadId }] : []),
    ],
  };

  const list = await prisma.document.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  return res.json({ data: list.map(serializeDocument) });
});

/** POST /documents — upload attachment (body: base64 file). Requires clients:write for clientId, leads:write for leadId. */
documentsRouter.post(
  '/',
  requirePermission('clients:write'),
  async (req: Request, res: Response) => {
    const subCompanyId = await resolveDocumentAgencyContext(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    const parsed = uploadBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { clientId, leadId, name, type, fileBase64, mimeType } = parsed.data;

    if (!clientId && !leadId) {
      return res.status(400).json({ error: 'Provide clientId or leadId' });
    }

    const maxSize = parseInt(env.MAX_FILE_SIZE ?? '10485760', 10);
    let buffer: Buffer;
    try {
      buffer = Buffer.from(fileBase64, 'base64');
    } catch {
      return res.status(400).json({ error: 'Invalid base64 file content' });
    }
    if (buffer.length > maxSize) {
      return res.status(400).json({ error: `File too large (max ${Math.round(maxSize / 1024 / 1024)}MB)` });
    }

    let clientName: string | undefined;
    let resolvedClientId: string | null = clientId ?? null;

    if (clientId) {
      const visible = await assertClientAccessibleInAgency(clientId, subCompanyId);
      if (!visible) return res.status(404).json({ error: 'Client not found' });
      const row = await prisma.client.findUnique({
        where: { id: clientId },
        select: { id: true, name: true },
      });
      if (!row) return res.status(404).json({ error: 'Client not found' });
      clientName = row.name;
      resolvedClientId = row.id;
    }

    if (leadId) {
      const lead = await prisma.lead.findFirst({
        where: { id: leadId, subCompanyId },
        select: { id: true, clientId: true },
      });
      if (!lead) return res.status(404).json({ error: 'Lead not found' });
      if (clientId && lead.clientId !== clientId) {
        return res.status(400).json({ error: 'Lead does not belong to this client' });
      }
      resolvedClientId = resolvedClientId ?? lead.clientId;
    }

    const ext = name.split('.').pop()?.slice(0, 10) ?? 'bin';
    const contentType = mimeType ?? (ext === 'pdf' ? 'application/pdf' : 'application/octet-stream');
    const key = `attachments/${resolvedClientId ?? leadId}/${Date.now()}-${name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

    const fileUrl = await uploadToR2(key, buffer, contentType);

    const doc = await prisma.document.create({
      data: {
        name,
        type: type || 'attachment',
        clientId: resolvedClientId,
        leadId: leadId ?? null,
        subCompanyId,
        isPublic: await isGlobalCreatorRole(req),
        fileUrl: fileUrl ?? key,
      },
    });

    if (resolvedClientId) {
      const userName = req.user?.email ?? 'User';
      await createActivityLog({
        userId: effectiveActorId(req),
        userName,
        subCompanyId,
        type: 'attachment_uploaded',
        description: `Uploaded document ${doc.name}`,
        metadata: {
          clientId: resolvedClientId,
          clientName,
          documentId: doc.id,
          fileName: name,
        },
      });
    }

    return res.status(201).json(serializeDocument(doc));
  },
);

/** GET /documents/:id/download — stream file from R2 or redirect if fileUrl is absolute. Auth required. */
documentsRouter.get('/:id/download', async (req: Request, res: Response) => {
  const subCompanyId = await resolveDocumentAgencyContext(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const detailScope = await resolveClientDetailScope(req, subCompanyId);
  const doc = await prisma.document.findFirst({
    where: { id: req.params.id, ...documentsForClientDetail(detailScope) },
    select: { id: true, name: true, fileUrl: true, clientId: true, leadId: true },
  });
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (!doc.fileUrl) return res.status(404).json({ error: 'Document has no file' });

  const fileUrl = doc.fileUrl.trim();
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
    return res.redirect(302, fileUrl);
  }

  const r2 = await getFromR2(fileUrl);
  if (!r2) return res.status(404).json({ error: 'File not found in storage' });

  const contentType = r2.contentType ?? 'application/octet-stream';
  const filename = doc.name.replace(/[^\w.-]/g, '_');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(r2.body);
});

/** DELETE /documents/:id */
documentsRouter.delete(
  '/:id',
  requirePermission('clients:write'),
  async (req: Request, res: Response) => {
    const subCompanyId = await resolveDocumentAgencyContext(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    const detailScope = await resolveClientDetailScope(req, subCompanyId);
    const doc = await prisma.document.findFirst({
      where: { id: req.params.id, ...documentsForClientDetail(detailScope) },
      select: { id: true },
    });
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    await prisma.document.delete({ where: { id: req.params.id } });
    return res.status(204).send();
  },
);
