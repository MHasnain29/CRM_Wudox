/**
 * Emails: inbox, sent, drafts. Send via SendGrid; receive via Inbound Parse webhook.
 * Agency-scoped (subCompanyId). Inbox = toUserId = current user; Sent/Drafts = fromUserId = current user.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { actAsMiddleware, effectiveActorId } from '../middleware/actAs';
import { sendClientEmail, buildCrmReplyToAddress, resolveOutboundUserSender } from '../services/email';
import { senderUserSelect, injectSenderSignature, resolveSenderSignatureBlock } from '../services/sender';
import { isSenderDomainError } from '../services/senderDomainErrors';
import { env } from '../config/env';
import multer from 'multer';
import { createActivityLog } from '../services/activityLog';
import { emitToUsers } from '../socket';
import {
  resolveAllowedSubCompanyIds,
  isElevatedRoleForRequest,
  resolveAgencyScope,
  resolveListAgencyScope,
} from '../config/agencyScope';
import { canAccessMultipleAgencies, canViewTeamData } from '../services/accessContext';
import { expandLinkedOwnerScope, ownerExactFromQuery } from '../services/linkedOwnerExpand';
import { getLinkedAccounts } from '../services/agencyLink';
import { ensureAccessContext, requestHasPermission } from '../utils/requestPermission';
import { getFromR2, uploadToR2 } from '../services/r2Storage';
import { invalidateClientListCache } from '../services/clientListCache';

type InboundUploadFile = {
  fieldname: string;
  originalname?: string;
  mimetype?: string;
  buffer: Buffer;
};

const MAX_EMAIL_ATTACHMENTS = 10;
const MAX_EMAIL_ATTACHMENT_SIZE = 30 * 1024 * 1024; // 30MB per file

const ATTACHMENT_MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
  avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff',
  mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', mov: 'video/quicktime',
  avi: 'video/x-msvideo', mkv: 'video/x-matroska', m4v: 'video/x-m4v',
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv', txt: 'text/plain', zip: 'application/zip', rar: 'application/x-rar-compressed',
};

const emailAttachmentInputSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(128),
  data: z.string().min(1),
});

const listQuerySchema = z.object({
  folder: z.enum(['inbox', 'sent', 'drafts']),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
  agencyIds: z.string().optional(), // elevated roles only, sent folder only
  ownerIds: z.string().optional(),  // multi-user filter: comma-separated UUIDs (sent folder, elevated roles)
});

const sendBodySchema = z.object({
  to: z.array(z.object({
    contactId: z.string().uuid().optional(),
    clientId: z.string().uuid().optional(),
    email: z.string().email().optional(),
    name: z.string().optional(),
  })).min(1),
  cc: z.array(z.object({ email: z.string().email(), name: z.string().optional() })).optional(),
  subject: z.string().min(1).max(500),
  body: z.string(),
  clientId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  inReplyTo: z.string().uuid().optional(),
  subCompanyId: z.string().uuid().optional(),  // OM-specific: override agency context for sending
  attachments: z.array(emailAttachmentInputSchema).max(MAX_EMAIL_ATTACHMENTS).optional(),
  replyAsUserId: z.string().uuid().optional(),  // emails:reply_as — send on behalf of a direct report
});

const draftBodySchema = z.object({
  to: z.array(z.object({
    contactId: z.string().uuid().optional(),
    clientId: z.string().uuid().optional(),
    email: z.string().email().optional(),
    name: z.string().optional(),
  })).optional(),
  subject: z.string().max(500).optional(),
  body: z.string().optional(),
  clientId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  /** OM-self: persist which agency From was selected for reopen. */
  subCompanyId: z.string().uuid().optional(),
});

export const emailsRouter = Router();
const inboundForm = multer({ limits: { fileSize: MAX_EMAIL_ATTACHMENT_SIZE, files: MAX_EMAIL_ATTACHMENTS } });

function inferMimeType(filename: string, mimeType?: string | null): string {
  if (mimeType?.trim()) return mimeType.trim();
  const ext = filename.split('.').pop()?.toLowerCase().slice(0, 10) ?? 'bin';
  return ATTACHMENT_MIME_MAP[ext] ?? 'application/octet-stream';
}

function sanitizeAttachmentFilename(filename: string): string {
  const trimmed = filename.trim().replace(/[/\\]/g, '_');
  const safe = trimmed.replace(/[^a-zA-Z0-9._\- ]/g, '_').slice(0, 255);
  return safe || 'attachment';
}

/** Upload attachments to R2, persist EmailAttachment rows, return SendGrid-ready payloads. */
async function persistEmailAttachments(
  emailId: string,
  items: z.infer<typeof emailAttachmentInputSchema>[],
): Promise<{ content: string; filename: string; type: string }[]> {
  const maxSize = parseInt(env.MAX_FILE_SIZE ?? '10485760', 10);
  const sendGridAttachments: { content: string; filename: string; type: string }[] = [];

  for (const item of items) {
    let buffer: Buffer;
    try {
      buffer = Buffer.from(item.data, 'base64');
    } catch {
      throw new Error(`Invalid attachment data: ${item.filename}`);
    }
    if (buffer.length === 0) {
      throw new Error(`Empty attachment: ${item.filename}`);
    }
    if (buffer.length > maxSize || buffer.length > MAX_EMAIL_ATTACHMENT_SIZE) {
      const limitMb = Math.round(Math.min(maxSize, MAX_EMAIL_ATTACHMENT_SIZE) / 1024 / 1024);
      throw new Error(`"${item.filename}" exceeds maximum size (${limitMb}MB)`);
    }

    const filename = sanitizeAttachmentFilename(item.filename);
    const mimeType = inferMimeType(filename, item.mimeType);
    const key = `emails/${emailId}/${Date.now()}-${filename.replace(/\s+/g, '_')}`;
    const fileKey = await uploadToR2(key, buffer, mimeType);

    await prisma.emailAttachment.create({
      data: {
        emailId,
        filename,
        fileKey: fileKey ?? key,
        mimeType,
        size: buffer.length,
      },
    });

    sendGridAttachments.push({
      content: buffer.toString('base64'),
      filename,
      type: mimeType,
    });
  }

  return sendGridAttachments;
}

/** Store inbound webhook file attachments for a saved email. */
async function persistInboundEmailAttachments(
  emailId: string,
  files: InboundUploadFile[],
  attachmentInfoRaw?: string,
): Promise<number> {
  if (!files.length) return 0;

  let info: Record<string, { filename?: string; type?: string }> = {};
  if (attachmentInfoRaw) {
    try {
      info = JSON.parse(attachmentInfoRaw);
    } catch {
      // ignore malformed metadata
    }
  }

  const maxSize = parseInt(env.MAX_FILE_SIZE ?? '10485760', 10);
  let stored = 0;

  for (const file of files.slice(0, MAX_EMAIL_ATTACHMENTS)) {
    const buffer = file.buffer;
    if (!buffer?.length) continue;
    if (buffer.length > maxSize || buffer.length > MAX_EMAIL_ATTACHMENT_SIZE) continue;

    const meta = info[file.fieldname] ?? {};
    const filename = sanitizeAttachmentFilename(meta.filename ?? file.originalname ?? file.fieldname);
    const mimeType = inferMimeType(filename, meta.type ?? file.mimetype);
    const key = `emails/${emailId}/${Date.now()}-${filename.replace(/\s+/g, '_')}`;
    const fileKey = await uploadToR2(key, buffer, mimeType);

    await prisma.emailAttachment.create({
      data: {
        emailId,
        filename,
        fileKey: fileKey ?? key,
        mimeType,
        size: buffer.length,
      },
    });
    stored += 1;
  }

  return stored;
}

async function resolveEmailAgencyId(req: Request): Promise<string | null> {
  return resolveAgencyScope(req);
}

async function getWritableEmailSubCompanyId(req: Request): Promise<string | null> {
  return resolveAgencyScope(req);
}

async function emailAccessAgencyIds(req: Request): Promise<string[]> {
  const scope = await resolveListAgencyScope(req);
  if (scope) return scope.allowedIds;
  const single = await resolveEmailAgencyId(req);
  return single ? [single] : [];
}

/** GET /emails — list by folder (inbox | sent | drafts).
 *  - inbox/drafts/sent + ownerIds (elevated/manager): scoped to those users (multi-agency when agencyScope allows).
 *  - inbox without ownerIds: personal to caller.
 *  - sent + elevated: can view across agencies via agencyIds.
 */
emailsRouter.get('/', authenticate, actAsMiddleware, async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
  const { folder, page, limit, agencyIds: agencyIdsRaw, ownerIds: ownerIdsRaw } = parsed.data;

  const agencyScope = await resolveListAgencyScope(req, agencyIdsRaw);
  const subCompanyId = agencyScope?.primarySubCompanyId ?? (await resolveEmailAgencyId(req));
  if (!subCompanyId && folder !== 'inbox') {
    return res.status(403).json({ error: 'Agency context required' });
  }

  const userId = effectiveActorId(req);
  const ctx = await ensureAccessContext(req);
  const elevated = await isElevatedRoleForRequest(req);
  const isTeamManager = ctx ? canViewTeamData(ctx) && !canAccessMultipleAgencies(ctx) : false;

  let where: Record<string, unknown>;

  const ownerIdsList = ownerIdsRaw ? ownerIdsRaw.split(',').filter((id) => /^[0-9a-f-]{36}$/i.test(id)) : [];

  // Linked anchors: expand each user's normal scope (any role).
  const linkedScope = ownerIdsList.length > 0
    ? await expandLinkedOwnerScope(userId, req.user!.subCompanyId, ownerIdsList, { exact: ownerExactFromQuery(req.query) })
    : null;
  const linkedUserFilterIds =
    linkedScope && linkedScope.mode !== 'agencies' && linkedScope.userIds.length > 0
      ? linkedScope.userIds
      : null;

  // Resolve team IDs for managers (self + direct reports) — used as default when no ownerIds filter
  let managerTeamIds: string[] | null = null;
  if (isTeamManager && ownerIdsList.length === 0 && subCompanyId) {
    const directReports = await prisma.user.findMany({
      where: { subCompanyId, reportingManagerIds: { has: userId }, isActive: true },
      select: { id: true },
    });
    managerTeamIds = [userId, ...directReports.map((u) => u.id)];
  }

  if (folder === 'inbox') {
    if (linkedScope) {
      where = {
        subCompanyId: { in: linkedScope.subCompanyIds },
        folder,
        ...(linkedUserFilterIds
          ? { OR: [{ toUserId: { in: linkedUserFilterIds } }, { forwardedToUserId: { in: linkedUserFilterIds } }] }
          : {}),
      };
    } else if (ownerIdsList.length > 0 && (elevated || isTeamManager)) {
      // Elevated / manager: honor owner scope (same as sent), including multi-agency
      if (elevated && agencyScope) {
        where = {
          ...agencyScope.scopeFilter,
          folder,
          OR: [{ toUserId: { in: ownerIdsList } }, { forwardedToUserId: { in: ownerIdsList } }],
        };
      } else if (subCompanyId) {
        where = {
          subCompanyId,
          folder,
          OR: [{ toUserId: { in: ownerIdsList } }, { forwardedToUserId: { in: ownerIdsList } }],
        };
      } else {
        where = {
          folder,
          OR: [{ toUserId: { in: ownerIdsList } }, { forwardedToUserId: { in: ownerIdsList } }],
        };
      }
    } else {
      where = { subCompanyId, folder, OR: [{ toUserId: userId }, { forwardedToUserId: userId }] };
    }
  } else if (folder === 'drafts') {
    if (linkedScope) {
      where = {
        subCompanyId: { in: linkedScope.subCompanyIds },
        folder,
        ...(linkedUserFilterIds
          ? { OR: [{ fromUserId: { in: linkedUserFilterIds } }, { forwardedToUserId: { in: linkedUserFilterIds } }] }
          : {}),
      };
    } else if (elevated && agencyScope) {
      where = ownerIdsList.length > 0
        ? { ...agencyScope.scopeFilter, folder, OR: [{ fromUserId: { in: ownerIdsList } }, { forwardedToUserId: { in: ownerIdsList } }] }
        : { ...agencyScope.scopeFilter, folder };
    } else if (isTeamManager && subCompanyId) {
      const teamFilter = ownerIdsList.length > 0 ? ownerIdsList : managerTeamIds!;
      where = { subCompanyId, folder, OR: [{ fromUserId: { in: teamFilter } }, { forwardedToUserId: { in: teamFilter } }] };
    } else if (subCompanyId) {
      where = { subCompanyId, folder, OR: [{ fromUserId: userId }, { forwardedToUserId: userId }] };
    } else {
      where = { folder, OR: [{ fromUserId: userId }, { forwardedToUserId: userId }] };
    }
  } else {
    // Sent folder
    if (linkedScope) {
      where = {
        subCompanyId: { in: linkedScope.subCompanyIds },
        folder,
        ...(linkedUserFilterIds
          ? { OR: [{ fromUserId: { in: linkedUserFilterIds } }, { forwardedToUserId: { in: linkedUserFilterIds } }] }
          : {}),
      };
    } else if (elevated && agencyScope) {
      where = ownerIdsList.length > 0
        ? { ...agencyScope.scopeFilter, folder, OR: [{ fromUserId: { in: ownerIdsList } }, { forwardedToUserId: { in: ownerIdsList } }] }
        : { ...agencyScope.scopeFilter, folder };
    } else if (isTeamManager && subCompanyId) {
      const teamFilter = ownerIdsList.length > 0 ? ownerIdsList : managerTeamIds!;
      where = { subCompanyId, folder, OR: [{ fromUserId: { in: teamFilter } }, { forwardedToUserId: { in: teamFilter } }] };
    } else if (subCompanyId) {
      where = { subCompanyId, folder, OR: [{ fromUserId: userId }, { forwardedToUserId: userId }] };
    } else {
      where = { folder, OR: [{ fromUserId: userId }, { forwardedToUserId: userId }] };
    }
  }

  const [list, total] = await Promise.all([
    prisma.email.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        recipients: { where: { recipientType: 'to' } },
        fromUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        forwardedFromUser: { select: { id: true, firstName: true, lastName: true } },
        sentByUser: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { attachments: true } },
      },
    }),
    prisma.email.count({ where }),
  ]);

  const unreadCount = await prisma.email.count({
    where: { ...where, isRead: false },
  });

  let data = list.map((e) => ({
    id: e.id,
    from: {
      name: e.fromName,
      email: e.fromEmail,
      userId: e.fromUserId ?? undefined,
    },
    to: e.recipients.filter((r) => r.recipientType === 'to').map((r) => ({
      name: r.name ?? r.emailAddress,
      email: r.emailAddress,
      clientId: r.clientId ?? undefined,
      contactId: r.contactId ?? undefined,
    })),
    subject: e.subject,
    body: e.body,
    timestamp: e.timestamp,
    isRead: e.isRead,
    folder: e.folder,
    clientId: e.clientId ?? undefined,
    leadId: e.leadId ?? undefined,
    inReplyTo: e.inReplyTo ?? undefined,
    subCompanyId: e.subCompanyId,
    attachmentCount: e._count?.attachments ?? 0,
    forwardedFromUserId: e.forwardedFromUserId ?? undefined,
    forwardedFromName: e.forwardedFromUser
      ? `${e.forwardedFromUser.firstName} ${e.forwardedFromUser.lastName}`.trim()
      : undefined,
    sentBy: e.sentByUser
      ? { id: e.sentByUser.id, name: [e.sentByUser.firstName, e.sentByUser.lastName].filter(Boolean).join(' ') }
      : undefined,
  }));

  // Backfill compatibility: include PandaDoc "sent" proposals that were sent before
  // we started persisting them into the emails table.
  if (folder === 'sent' && page === 1 && subCompanyId) {
    const pandaStatuses = ['document.sent', 'document.viewed', 'document.completed'];
    const ownerFilterIds = ownerIdsList.length > 0
      ? ownerIdsList
      : (isTeamManager ? managerTeamIds! : [userId]);

    const proposalWhereBase: any = {
      pandaDocId: { not: null },
      pandaDocStatus: { in: pandaStatuses },
      lead: {
        subCompanyId,
      },
    };

    if (elevated && agencyScope) {
      const subCo = agencyScope.scopeFilter.subCompanyId;
      const selectedAgencyIds = typeof subCo === 'string' ? [subCo] : subCo.in;
      proposalWhereBase.lead.subCompanyId = { in: selectedAgencyIds };
      if (ownerIdsList.length > 0) {
        proposalWhereBase.lead.ownerId = { in: ownerIdsList };
      }
    } else {
      proposalWhereBase.lead.ownerId = { in: ownerFilterIds };
    }

    const pandaProposals = await prisma.proposal.findMany({
      where: proposalWhereBase,
      select: {
        id: true,
        pandaDocId: true,
        pandaDocUpdatedAt: true,
        leadId: true,
        selectedContact: { select: { id: true, name: true, email: true } },
        lead: {
          select: {
            id: true,
            ownerId: true,
            owner: { select: { firstName: true, lastName: true, email: true } },
            clientId: true,
            client: { select: { name: true } },
          },
        },
      },
      orderBy: { pandaDocUpdatedAt: 'desc' },
      take: 200,
    });

    const existingPandaDocLeadIds = new Set(
      list
        .filter((e) => {
          const subject = (e.subject || '').toLowerCase();
          const body = (e.body || '').toLowerCase();
          return subject.includes('agreement sent via pandadoc')
            || body.includes('sent via pandadoc');
        })
        .map((e) => e.leadId)
        .filter(Boolean)
    );

    const syntheticItems = pandaProposals
      .filter((p) => !existingPandaDocLeadIds.has(p.leadId))
      .map((p) => {
        const ownerName = `${p.lead.owner.firstName ?? ''} ${p.lead.owner.lastName ?? ''}`.trim() || p.lead.owner.email || 'User';
        const contactName = p.selectedContact?.name || p.selectedContact?.email || 'Client contact';
        const contactEmail = p.selectedContact?.email || '';
        const ts = p.pandaDocUpdatedAt ?? new Date();
        const pandaDocUrl = `https://app.pandadoc.com/a/#/documents/${p.pandaDocId}`;
        return {
          id: `pandadoc-${p.id}`,
          from: {
            name: ownerName,
            email: p.lead.owner.email || '',
            userId: p.lead.ownerId,
          },
          to: [{
            name: contactName,
            email: contactEmail || contactName,
            clientId: p.lead.clientId,
            contactId: p.selectedContact?.id,
          }],
          subject: `Agreement sent via PandaDoc — ${p.lead.client.name}`,
          body: `<p>An agreement was sent via PandaDoc to <strong>${contactName}</strong>${contactEmail ? ` (${contactEmail})` : ''}.</p><p style="margin-top:16px"><a href="${pandaDocUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 14px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:13px;line-height:1.2">View document in PandaDoc</a></p>`,
          timestamp: ts,
          isRead: true,
          folder: 'sent' as const,
          clientId: p.lead.clientId,
          leadId: p.lead.id,
          inReplyTo: undefined,
          subCompanyId,
          attachmentCount: 0,
          forwardedFromUserId: undefined,
          forwardedFromName: undefined,
          sentBy: undefined,
        };
      });

    if (syntheticItems.length > 0) {
      data = [...data, ...syntheticItems]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);
    }
  }

  return res.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    unreadCount,
  });
});

/** GET /emails/unread-count — inbox unread count for badge */
emailsRouter.get('/unread-count', authenticate, actAsMiddleware, async (req: Request, res: Response) => {
  const count = await prisma.email.count({
    where: {
      folder: 'inbox',
      toUserId: effectiveActorId(req),
      isRead: false,
    },
  });
  return res.json({ count });
});

/** GET /emails/reply-as/eligible-users — list users the caller may send email on behalf of */
emailsRouter.get('/reply-as/eligible-users', authenticate, async (req: Request, res: Response) => {
  const canReplyAs = await requestHasPermission(req, 'emails:reply_as');
  if (!canReplyAs) {
    return res.json({ users: [] });
  }

  const userId = req.user!.sub;
  const elevated = await isElevatedRoleForRequest(req);

  if (elevated) {
    // Elevated roles (super_admin, director, OM): all active users in accessible agencies, excluding self
    const allowedIds = await resolveAllowedSubCompanyIds(req.user!, req);
    const agencyFilter = allowedIds.length > 0
      ? { OR: [{ subCompanyId: { in: allowedIds } }, { subCompanyId: null }] }
      : {};
    const users = await prisma.user.findMany({
      where: { id: { not: userId }, isActive: true, ...agencyFilter },
      select: { id: true, firstName: true, lastName: true, email: true, role: true, subCompanyId: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    return res.json({ users });
  }

  // Managers: direct reports only
  const users = await prisma.user.findMany({
    where: { reportingManagerIds: { has: userId }, isActive: true },
    select: { id: true, firstName: true, lastName: true, email: true, role: true, subCompanyId: true },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });

  return res.json({ users });
});

/** GET /emails/:id — get one email */
emailsRouter.get('/:id', authenticate, actAsMiddleware, async (req: Request, res: Response) => {
  const allowedIds = await emailAccessAgencyIds(req);
  const subCompanyId = (await resolveEmailAgencyId(req)) ?? allowedIds[0] ?? null;

  // Synthetic PandaDoc list entries use id shape "pandadoc-<proposalId>".
  // Resolve them into a readable email-like detail payload.
  if (req.params.id.startsWith('pandadoc-')) {
    const proposalId = req.params.id.slice('pandadoc-'.length);
    if (!/^[0-9a-f-]{36}$/i.test(proposalId)) {
      return res.status(404).json({ error: 'Email not found' });
    }

    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId },
      select: {
        id: true,
        pandaDocId: true,
        pandaDocStatus: true,
        pandaDocUpdatedAt: true,
        selectedContact: { select: { id: true, name: true, email: true } },
        lead: {
          select: {
            id: true,
            ownerId: true,
            owner: { select: { firstName: true, lastName: true, email: true } },
            clientId: true,
            client: { select: { name: true } },
            subCompanyId: true,
          },
        },
      },
    });

    const pandaAllowedIds = await resolveAllowedSubCompanyIds(req.user!, req);
    if (!proposal || !proposal.pandaDocId || !pandaAllowedIds.includes(proposal.lead.subCompanyId)) {
      return res.status(404).json({ error: 'Email not found' });
    }

    const userId = effectiveActorId(req);
    const elevated = await isElevatedRoleForRequest(req);
    const ctx = await ensureAccessContext(req);
    const isTeamManager = ctx ? canViewTeamData(ctx) && !canAccessMultipleAgencies(ctx) : false;

    if (!elevated) {
      if (isTeamManager && subCompanyId) {
        const directReports = await prisma.user.findMany({
          where: { subCompanyId, reportingManagerIds: { has: userId }, isActive: true },
          select: { id: true },
        });
        const allowedOwnerIds = new Set([userId, ...directReports.map((u) => u.id)]);
        if (!allowedOwnerIds.has(proposal.lead.ownerId)) {
          return res.status(404).json({ error: 'Email not found' });
        }
      } else if (proposal.lead.ownerId !== userId) {
        return res.status(404).json({ error: 'Email not found' });
      }
    }

    const ownerName = `${proposal.lead.owner.firstName ?? ''} ${proposal.lead.owner.lastName ?? ''}`.trim() || proposal.lead.owner.email || 'User';
    const contactName = proposal.selectedContact?.name || proposal.selectedContact?.email || 'Client contact';
    const contactEmail = proposal.selectedContact?.email || '';
    const statusLabel = (proposal.pandaDocStatus ?? 'document.sent').replace('document.', '');
    const pandaDocUrl = `https://app.pandadoc.com/a/#/documents/${proposal.pandaDocId}`;

    return res.json({
      id: `pandadoc-${proposal.id}`,
      from: {
        name: ownerName,
        email: proposal.lead.owner.email || '',
        userId: proposal.lead.ownerId,
      },
      to: [{
        name: contactName,
        email: contactEmail || contactName,
        clientId: proposal.lead.clientId ?? undefined,
        contactId: proposal.selectedContact?.id ?? undefined,
      }],
      cc: [],
      subject: `Agreement sent via PandaDoc — ${proposal.lead.client.name}`,
      body: `<p>An agreement was sent via PandaDoc to <strong>${contactName}</strong>${contactEmail ? ` (${contactEmail})` : ''}.</p><p>Current document status: <strong>${statusLabel}</strong>.</p><p style="margin-top:16px"><a href="${pandaDocUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 14px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:13px;line-height:1.2">View document in PandaDoc</a></p>`,
      timestamp: proposal.pandaDocUpdatedAt ?? new Date(),
      isRead: true,
      folder: 'sent',
      clientId: proposal.lead.clientId ?? undefined,
      leadId: proposal.lead.id,
      inReplyTo: undefined,
      attachments: [],
    });
  }

  let email;
  const elevated = await isElevatedRoleForRequest(req);
  const ctx = await ensureAccessContext(req);
  const isTeamManager = ctx ? canViewTeamData(ctx) && !canAccessMultipleAgencies(ctx) : false;

  const detailInclude = {
    recipients: true,
    attachments: true,
    sentByUser: { select: { id: true, firstName: true, lastName: true } },
  } as const;

  if (elevated) {
    email = await prisma.email.findFirst({
      where: { id: req.params.id, subCompanyId: { in: allowedIds } },
      include: detailInclude,
    });
  } else if (isTeamManager && subCompanyId) {
    // Managers can view their own emails + emails from their direct reports
    const teamMembers = await prisma.user.findMany({
      where: { subCompanyId, reportingManagerIds: { has: req.user!.sub } },
      select: { id: true },
    });
    const allowedUserIds = [req.user!.sub, ...teamMembers.map((u) => u.id)];
    email = await prisma.email.findFirst({
      where: {
        id: req.params.id,
        subCompanyId,
        OR: [
          { fromUserId: { in: allowedUserIds } },
          { toUserId: { in: allowedUserIds } },
          { forwardedToUserId: { in: allowedUserIds } },
        ],
      },
      include: detailInclude,
    });
  } else {
    const actorId = effectiveActorId(req);
    const linkedAccounts = await getLinkedAccounts(req.user!.sub);
    const linkedUserIds = linkedAccounts.map((a) => a.userId);
    const linkedSubCoIds = linkedAccounts.map((a) => a.subCompanyId).filter(Boolean) as string[];
    const allUserIds = [actorId, ...linkedUserIds];
    const baseSubCoIds = subCompanyId ? [subCompanyId] : allowedIds.length > 0 ? allowedIds : [];
    const allSubCoIds = [...new Set([...baseSubCoIds, ...linkedSubCoIds])];

    email = await prisma.email.findFirst({
      where: {
        id: req.params.id,
        ...(allSubCoIds.length > 0 ? { subCompanyId: { in: allSubCoIds } } : {}),
        OR: [
          { fromUserId: { in: allUserIds } },
          { toUserId: { in: allUserIds } },
          { forwardedToUserId: { in: allUserIds } },
        ],
      },
      include: detailInclude,
    });
  }
  if (!email) return res.status(404).json({ error: 'Email not found' });

  // Gap 5: if this is a reply to a "sent on behalf" email, surface the original sentByUser
  let originalSentBy: { id: string; name: string } | undefined;
  if (email.inReplyTo) {
    const parent = await prisma.email.findFirst({
      where: { id: email.inReplyTo },
      select: { sentByUser: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (parent?.sentByUser) {
      originalSentBy = {
        id: parent.sentByUser.id,
        name: [parent.sentByUser.firstName, parent.sentByUser.lastName].filter(Boolean).join(' '),
      };
    }
  }

  const sentBy = email.sentByUser
    ? { id: email.sentByUser.id, name: [email.sentByUser.firstName, email.sentByUser.lastName].filter(Boolean).join(' ') }
    : undefined;

  return res.json({
    id: email.id,
    from: { name: email.fromName, email: email.fromEmail, userId: email.fromUserId ?? undefined },
    to: email.recipients.filter((r) => r.recipientType === 'to').map((r) => ({
      name: r.name ?? r.emailAddress,
      email: r.emailAddress,
      clientId: r.clientId ?? undefined,
      contactId: r.contactId ?? undefined,
    })),
    cc: email.recipients.filter((r) => r.recipientType === 'cc').map((r) => ({
      name: r.name ?? r.emailAddress,
      email: r.emailAddress,
    })),
    subject: email.subject,
    body: email.body,
    timestamp: email.timestamp,
    isRead: email.isRead,
    folder: email.folder,
    clientId: email.clientId ?? undefined,
    leadId: email.leadId ?? undefined,
    inReplyTo: email.inReplyTo ?? undefined,
    subCompanyId: email.subCompanyId,
    attachments: (email.attachments ?? []).map((a) => ({
      id: a.id,
      filename: a.filename,
      fileKey: a.fileKey,
      mimeType: a.mimeType,
      size: a.size ?? undefined,
    })),
    sentBy,
    originalSentBy,
  });
});

/** GET /emails/:id/attachments/:attachmentId — serve attachment from R2 */
emailsRouter.get('/:id/attachments/:attachmentId', authenticate, async (req: Request, res: Response) => {
  const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
  const attachment = await prisma.emailAttachment.findFirst({
    where: { id: req.params.attachmentId, email: { id: req.params.id, subCompanyId: { in: allowedIds } } },
  });
  if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

  try {
    const r2 = await getFromR2(attachment.fileKey);
    if (!r2) return res.status(404).json({ error: 'File not found in storage' });
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${attachment.filename}"`);
    return res.send(r2.body);
  } catch {
    return res.status(503).json({ error: 'Storage unavailable' });
  }
});

/** DELETE /emails/:id — delete an email (requires emails:delete permission)
 *  Scope:
 *    elevated (director / super_admin / ops_manager) → any email in their agency
 *    team manager (sales_manager / recruitment_manager) → own + direct reports'
 *    others with permission → own emails only (fromUserId or toUserId = self)
 */
emailsRouter.delete('/:id', authenticate, actAsMiddleware, async (req: Request, res: Response) => {
  const canDelete = await requestHasPermission(req, 'emails:delete');
  if (!canDelete) return res.status(403).json({ error: 'Forbidden' });

  const userId = effectiveActorId(req);
  const allowedIds = await emailAccessAgencyIds(req);
  const subCompanyId = (await resolveEmailAgencyId(req)) ?? allowedIds[0] ?? null;

  const elevated = await isElevatedRoleForRequest(req);
  const ctx = await ensureAccessContext(req);
  const isTeamManager = ctx ? canViewTeamData(ctx) && !canAccessMultipleAgencies(ctx) : false;

  let email;
  if (elevated) {
    email = await prisma.email.findFirst({
      where: { id: req.params.id, subCompanyId: { in: allowedIds } },
      select: { id: true },
    });
  } else if (isTeamManager && subCompanyId) {
    const teamMembers = await prisma.user.findMany({
      where: { subCompanyId, reportingManagerIds: { has: userId } },
      select: { id: true },
    });
    const allowedUserIds = [userId, ...teamMembers.map((u) => u.id)];
    email = await prisma.email.findFirst({
      where: {
        id: req.params.id,
        subCompanyId,
        OR: [
          { fromUserId: { in: allowedUserIds } },
          { toUserId: { in: allowedUserIds } },
          { forwardedToUserId: { in: allowedUserIds } },
        ],
      },
      select: { id: true },
    });
  } else {
    email = await prisma.email.findFirst({
      where: {
        id: req.params.id,
        ...(subCompanyId ? { subCompanyId } : allowedIds.length > 0 ? { subCompanyId: { in: allowedIds } } : {}),
        OR: [
          { fromUserId: userId },
          { toUserId: userId },
          { forwardedToUserId: userId },
        ],
      },
      select: { id: true },
    });
  }

  if (!email) return res.status(404).json({ error: 'Email not found' });

  await prisma.$transaction([
    prisma.emailRecipient.deleteMany({ where: { emailId: email.id } }),
    prisma.email.delete({ where: { id: email.id } }),
  ]);

  return res.json({ ok: true });
});

/** PATCH /emails/:id/read — mark as read */
emailsRouter.patch('/:id/read', authenticate, actAsMiddleware, async (req: Request, res: Response) => {
  const email = await prisma.email.findFirst({
    where: {
      id: req.params.id,
      OR: [
        { toUserId: effectiveActorId(req) },
        { forwardedToUserId: effectiveActorId(req) },
        { fromUserId: effectiveActorId(req) },
      ],
    },
  });
  if (!email) return res.status(404).json({ error: 'Email not found' });

  await prisma.email.update({
    where: { id: req.params.id },
    data: { isRead: true },
  });
  return res.json({ ok: true });
});

interface ResolvedRecipient {
  email: string;
  name: string;
  clientId?: string;
  contactId?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatEmailTemplateDate(d = new Date()): string {
  return d.toLocaleDateString('en-US', { dateStyle: 'long' });
}

function renderTemplate(input: string, ctx: Record<string, string>): string {
  let out = input ?? '';
  const footerText = ctx.agency_footer ?? '';
  if (!footerText) {
    // Pre-render: remove "{{agency_footer}} · " so proposal-style footers don't leave a dangling separator
    out = out.replace(/\{\{agency_footer\}\}\s*[·\-–—•]\s*/g, '');
  }
  out = out.replaceAll('{{contact_name}}', ctx.contact_name ?? '');
  out = out.replaceAll('{{company_name}}', ctx.company_name ?? '');
  out = out.replaceAll('{{user_name}}', ctx.user_name ?? '');
  out = out.replaceAll('{{user_email}}', ctx.user_email ?? '');
  out = out.replaceAll('{{sender_name}}', ctx.sender_name ?? '');
  out = out.replaceAll('{{agency_name}}', ctx.agency_name ?? '');
  out = out.replaceAll('{{date}}', ctx.date ?? '');
  out = out.replaceAll('{{agency_footer}}', footerText);
  if (!footerText) {
    // Strip empty <p> tags left by the now-empty agency_footer slot.
    // Do NOT strip the enclosing <tr> — injectSenderSignature uses the seed footer
    // <tr> as an anchor; removing it causes the signature to land outside the card.
    out = out.replace(/<p[^>]*>\s*<\/p>/g, '');
  }
  // Strip legacy variables that templates may contain — footer is now auto-appended
  out = out.replaceAll('{{sender_title}}', '');
  out = out.replaceAll('{{sender_phone}}', '');
  out = out.replaceAll('{{sender_email}}', '');
  return out;
}

function contactNameFromRecipientLabel(label: string): string {
  const t = (label || '').trim();
  if (!t) return '';
  // Labels are sometimes "Name – Title"; keep the name portion.
  return t.split('–')[0]?.trim() ?? t;
}

// buildCrmReplyToAddress is exported from services/email.ts and re-used here via import above.

/** Resolve "to" array to list of { email, name, clientId?, contactId? }. */
async function resolveRecipients(
  to: Array<{ contactId?: string; clientId?: string; email?: string; name?: string }>,
  _subCompanyId: string
): Promise<ResolvedRecipient[]> {
  const result: ResolvedRecipient[] = [];
  for (const r of to) {
    if (r.email) {
      result.push({ email: r.email, name: r.name ?? r.email });
      continue;
    }
    if (r.contactId) {
      const contact = await prisma.clientContact.findFirst({
        where: { id: r.contactId },
      });
      if (!contact?.email) continue;
      result.push({
        email: contact.email,
        name: [contact.name, contact.title].filter(Boolean).join(' – ') || contact.email,
        clientId: contact.clientId,
        contactId: contact.id,
      });
      continue;
    }
    if (r.clientId) {
      const primary = await prisma.clientContact.findFirst({
        where: { clientId: r.clientId, isPrimary: true },
      });
      if (primary?.email) {
        result.push({
          email: primary.email,
          name: primary.name || primary.email,
          clientId: r.clientId,
          contactId: primary.id,
        });
      }
    }
  }
  return result;
}

/** POST /emails/send — send email via SendGrid and store as sent */
emailsRouter.post('/send', authenticate, actAsMiddleware, async (req: Request, res: Response) => {
  const parsed = sendBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  const { to, cc, subject, body, clientId, leadId, inReplyTo, subCompanyId: bodySubCompanyId, attachments: attachmentInputs, replyAsUserId } = parsed.data;

  // emails:reply_as — check permission and hierarchy before anything else.
  // Default sender is the effective actor (Emily when acting as Emily).
  let senderUserId = effectiveActorId(req);
  let replyAsSubCompanyId: string | null = null;
  if (replyAsUserId) {
    const canReplyAs = await requestHasPermission(req, 'emails:reply_as');
    if (!canReplyAs) {
      return res.status(403).json({ error: 'You do not have permission to send email on behalf of another user' });
    }
    const targetUser = await prisma.user.findUnique({
      where: { id: replyAsUserId, isActive: true },
      select: { id: true, reportingManagerIds: true, subCompanyId: true },
    });
    if (!targetUser) {
      return res.status(403).json({ error: 'You are not authorized to send email on behalf of this user' });
    }
    // Elevated roles skip the direct-report check; managers must be a direct manager of the target
    const elevated = await isElevatedRoleForRequest(req);
    if (!elevated && !targetUser.reportingManagerIds.includes(effectiveActorId(req))) {
      return res.status(403).json({ error: 'You are not authorized to send email on behalf of this user' });
    }
    senderUserId = replyAsUserId;
    replyAsSubCompanyId = targetUser.subCompanyId;
  }

  // OM can pass subCompanyId in the body to pick which agency they're sending from.
  // Allowlist against caller's accessible agencies (no silent cross-agency send).
  if (bodySubCompanyId) {
    const allowedIds = await resolveAllowedSubCompanyIds(req.user!, req);
    if (!allowedIds.includes(bodySubCompanyId)) {
      return res.status(403).json({ error: 'Not allowed to send from this agency' });
    }
  }
  const subCompanyId = bodySubCompanyId ?? replyAsSubCompanyId ?? await getWritableEmailSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const recipients = await resolveRecipients(to, subCompanyId);
  if (recipients.length === 0) return res.status(400).json({ error: 'No valid recipients' });

  const fromUser = await prisma.user.findUnique({
    where: { id: senderUserId },
    select: { ...senderUserSelect, role: true, phone: true },
  });
  if (!fromUser?.email) return res.status(400).json({ error: 'User email not found' });

  const replyToName = [fromUser.firstName, fromUser.lastName].filter(Boolean).join(' ') || fromUser.email;

  // Load recipient context for templating (contact/company names) in one pass.
  const contactIds = recipients.map((r) => r.contactId).filter(Boolean) as string[];
  const clientIds = Array.from(
    new Set(
      recipients
        .map((r) => r.clientId ?? clientId)
        .filter(Boolean) as string[]
    )
  );

  const [contacts, clients, subCompany] = await Promise.all([
    contactIds.length
      ? prisma.clientContact.findMany({
          where: { id: { in: contactIds } },
          select: { id: true, name: true, clientId: true },
        })
      : Promise.resolve([]),
    clientIds.length
      ? prisma.client.findMany({
          where: { id: { in: clientIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    prisma.subCompany.findUnique({ where: { id: subCompanyId }, select: { name: true, emailFooterText: true, emailSignatureTemplate: true, emailTagline: true, emailFromAddress: true, emailFromName: true, emailSendAsDomain: true, emailInboundDomain: true, emailInboundLocalpart: true, agencyLogoUrl: true } }),
  ]);

  // Self-send: OM agencyEmail applies. Reply-as: target user only (skip OM).
  let sender;
  try {
    sender = (
      await resolveOutboundUserSender({
        userId: fromUser.id,
        subCompanyId,
        applyOmAgencyEmail: !replyAsUserId,
      })
    ).from;
  } catch (err) {
    if (isSenderDomainError(err)) {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    throw err;
  }
  const fromEmail = sender.email;
  const fromName = sender.name || replyToName;
  if (!fromEmail) {
    return res.status(500).json({
      error: `Email sender is not configured. Attempted to send to: ${recipients.map((r) => r.email).join(', ')}`,
      fromEmail: null,
      toEmails: recipients.map((r) => r.email),
    });
  }

  // Same display name + From email as the message header (keeps signature consistent for Super Users).
  const signatureResolved = await resolveSenderSignatureBlock(
    senderUserId,
    fromName,
    subCompany?.name ?? '',
    subCompany?.emailSignatureTemplate,
    {
      email: fromEmail,
      logoUrl: subCompany?.agencyLogoUrl,
      tagline: subCompany?.emailTagline,
      subCompanyId,
    },
  );
  const signatureFooterHtml = signatureResolved.html;
  const signatureInlineAttachments = signatureResolved.inlineAttachments;
  const agencyFooterText = escapeHtml(
    [subCompany?.emailFooterText?.trim(), subCompany?.emailTagline?.trim()].filter(Boolean).join(' · ')
  );

  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const clientNameById = new Map(clients.map((c) => [c.id, c.name]));

  // Store what was sent. If there's exactly 1 recipient, store the rendered version for clarity.
  let storedSubject = subject;
  let storedBody = body;
  if (recipients.length === 1) {
    const r = recipients[0];
    const contact = r.contactId ? contactById.get(r.contactId) : undefined;
    const resolvedClientId = r.clientId ?? contact?.clientId ?? clientId;
    const companyName = resolvedClientId ? clientNameById.get(resolvedClientId) ?? '' : '';
    const contactName = contact?.name ?? contactNameFromRecipientLabel(r.name);

    storedSubject = renderTemplate(subject, {
      contact_name: contactName,
      company_name: companyName,
      user_name: replyToName,
      user_email: fromUser.email,
      sender_name: replyToName,
      agency_name: subCompany?.name ?? '',
      date: formatEmailTemplateDate(),
      agency_footer: [subCompany?.emailFooterText?.trim(), subCompany?.emailTagline?.trim()].filter(Boolean).join(' · '),
    });
    storedBody = renderTemplate(body, {
      contact_name: escapeHtml(contactName),
      company_name: escapeHtml(companyName),
      user_name: escapeHtml(replyToName),
      user_email: escapeHtml(fromUser.email),
      sender_name: escapeHtml(replyToName),
      agency_name: escapeHtml(subCompany?.name ?? ''),
      date: escapeHtml(formatEmailTemplateDate()),
      agency_footer: agencyFooterText,
    });
  }

  // Create the email record first so we can embed its id in Reply-To for proper threading in inbound parse.
  const emailRecord = await prisma.email.create({
    data: {
      subCompanyId,
      fromUserId: senderUserId,
      sentByUserId: replyAsUserId ? req.user!.sub : null,
      fromName,
      fromEmail,
      subject: storedSubject,
      body: storedBody,
      folder: 'sent',
      clientId: clientId ?? null,
      leadId: leadId ?? null,
      inReplyTo: inReplyTo ?? null,
      isRead: true,
      recipients: {
        create: [
          ...recipients.map((r) => ({
            recipientType: 'to' as const,
            name: r.name,
            emailAddress: r.email,
            clientId: r.clientId ?? clientId ?? null,
            contactId: r.contactId ?? null,
          })),
          ...(cc ?? []).map((c) => ({
            recipientType: 'cc' as const,
            name: c.name ?? null,
            emailAddress: c.email,
            clientId: null,
            contactId: null,
          })),
        ],
      },
    },
    include: { recipients: true },
  });

  const replyToCrm = buildCrmReplyToAddress(emailRecord.id, senderUserId, subCompany);

  let sendGridAttachments: { content: string; filename: string; type: string }[] = [];
  if (attachmentInputs?.length) {
    try {
      sendGridAttachments = await persistEmailAttachments(emailRecord.id, attachmentInputs);
    } catch (e) {
      await prisma.email.delete({ where: { id: emailRecord.id } }).catch(() => {});
      const msg = e instanceof Error ? e.message : 'Failed to process attachments';
      return res.status(400).json({ error: msg });
    }
  }

  let sent = false;
  const toEmails = recipients.map((r) => r.email);
  try {
    // Personalize per recipient (so {{contact_name}} / {{company_name}} can differ).
    for (const r of recipients) {
      const contact = r.contactId ? contactById.get(r.contactId) : undefined;
      const resolvedClientId = r.clientId ?? contact?.clientId ?? clientId;
      const companyName = resolvedClientId ? clientNameById.get(resolvedClientId) ?? '' : '';
      const contactName = contact?.name ?? contactNameFromRecipientLabel(r.name);

      const ctxEscaped = {
        contact_name: escapeHtml(contactName),
        company_name: escapeHtml(companyName),
        user_name: escapeHtml(replyToName),
        user_email: escapeHtml(fromUser.email),
        sender_name: escapeHtml(replyToName),
        agency_name: escapeHtml(subCompany?.name ?? ''),
        date: escapeHtml(formatEmailTemplateDate()),
        agency_footer: agencyFooterText,
      };

      const renderedSubject = renderTemplate(subject, {
        contact_name: contactName,
        company_name: companyName,
        user_name: replyToName,
        user_email: fromUser.email,
        sender_name: replyToName,
        agency_name: subCompany?.name ?? '',
        date: formatEmailTemplateDate(),
        agency_footer: [subCompany?.emailFooterText?.trim(), subCompany?.emailTagline?.trim()].filter(Boolean).join(' · '),
      });
      // Always inject the "Best regards, [name+sig]" footer inside the email card
      const renderedHtml = injectSenderSignature(renderTemplate(body, ctxEscaped), signatureFooterHtml);

      const ok = await sendClientEmail({
        to: [{ email: r.email, name: r.name }],
        cc: cc?.length ? cc.map((c) => ({ email: c.email, name: c.name })) : undefined,
        from: { email: fromEmail, name: fromName },
        // Replies should come back into CRM and be thread-matched.
        replyTo: { email: replyToCrm, name: fromName },
        subject: renderedSubject,
        html: renderedHtml,
        text: renderedHtml.replace(/<[^>]*>/g, '').trim(),
        attachments: [
          ...sendGridAttachments,
          ...signatureInlineAttachments,
        ].length
          ? [...sendGridAttachments, ...signatureInlineAttachments]
          : undefined,
        subCompanyId,
        dedupeKey: `email:${emailRecord.id}:to:${r.email.toLowerCase()}`,
      });
      sent = sent || ok;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown provider error';
    const sgErrors = (e as any)?.response?.body?.errors ?? null;
    return res.status(502).json({
      error: `Failed to send email from ${fromEmail} to ${toEmails.join(', ')}. ${msg}`,
      fromEmail,
      toEmails,
      replyTo: replyToCrm,
      emailId: emailRecord.id,
      sendgridErrors: sgErrors,
    });
  }

  // Activity log uses the actual caller's identity for auditability.
  let actorName = replyToName;
  if (replyAsUserId) {
    const callerUser = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: { firstName: true, lastName: true, email: true },
    });
    actorName = callerUser
      ? [callerUser.firstName, callerUser.lastName].filter(Boolean).join(' ') || callerUser.email
      : replyToName;
  }

  const uniqueClientIds = new Set<string>();
  for (const r of recipients) {
    const contact = r.contactId ? contactById.get(r.contactId) : undefined;
    const resolvedClientId = (r.clientId ?? contact?.clientId ?? clientId) ?? null;
    if (resolvedClientId) uniqueClientIds.add(resolvedClientId);
  }

  if (uniqueClientIds.size > 0) {
    for (const cid of uniqueClientIds) {
      const clientName = clientNameById.get(cid) ?? '';
      await createActivityLog({
        userId: effectiveActorId(req),
        userName: actorName,
        subCompanyId,
        type: 'email_sent',
        description: replyAsUserId
          ? `Sent email as ${replyToName} to ${clientName || 'client'}`
          : `Sent email to ${clientName || 'client'}`,
        metadata: {
          clientId: cid,
          clientName: clientName || undefined,
          subject,
          emailId: emailRecord.id,
          toCount: recipients.length,
          ...(replyAsUserId ? { replyAsUserId, replyAsName: replyToName } : {}),
        },
      });
    }
  } else {
    // Email sent without a linked client (e.g. direct email)
    await createActivityLog({
      userId: effectiveActorId(req),
      userName: actorName,
      subCompanyId,
      type: 'email_sent',
      description: replyAsUserId
        ? `Sent email as ${replyToName}: ${subject || '(no subject)'}`
        : `Sent email: ${subject || '(no subject)'}`,
      metadata: {
        subject,
        emailId: emailRecord.id,
        toCount: recipients.length,
        ...(replyAsUserId ? { replyAsUserId, replyAsName: replyToName } : {}),
      },
    });
  }
  const emailRefreshIds = [...new Set([senderUserId, req.user!.sub])];
  emitToUsers(emailRefreshIds, 'email:refresh', { subCompanyId });
  await invalidateClientListCache(subCompanyId);
  emitToUsers(emailRefreshIds, 'client:refresh', { subCompanyId });

  return res.status(201).json({
    id: emailRecord.id,
    sent,
    message: sent ? 'Email sent' : 'Email saved (SendGrid not configured)',
  });
});

/** POST /emails/draft — save as draft */
emailsRouter.post('/draft', authenticate, actAsMiddleware, async (req: Request, res: Response) => {
  const parsed = draftBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  const { to, subject, body, clientId, leadId, subCompanyId: bodySubCompanyId } = parsed.data;

  if (bodySubCompanyId) {
    const allowedIds = await resolveAllowedSubCompanyIds(req.user!, req);
    if (!allowedIds.includes(bodySubCompanyId)) {
      return res.status(403).json({ error: 'Not allowed to save draft for this agency' });
    }
  }
  const subCompanyId = bodySubCompanyId ?? await getWritableEmailSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const fromUser = await prisma.user.findUnique({
    where: { id: effectiveActorId(req) },
    select: { email: true, firstName: true, lastName: true },
  });
  if (!fromUser?.email) return res.status(400).json({ error: 'User email not found' });

  const fromName = [fromUser.firstName, fromUser.lastName].filter(Boolean).join(' ') || fromUser.email;
  const recipients = to?.length ? await resolveRecipients(to, subCompanyId) : [];

  const emailRecord = await prisma.email.create({
    data: {
      subCompanyId,
      fromUserId: effectiveActorId(req),
      fromName,
      fromEmail: fromUser.email,
      subject: subject ?? '(No subject)',
      body: body ?? '',
      folder: 'drafts',
      clientId: clientId ?? null,
      leadId: leadId ?? null,
      recipients: {
        create: recipients.map((r) => ({
          recipientType: 'to' as const,
          name: r.name,
          emailAddress: r.email,
          clientId: r.clientId ?? clientId ?? null,
          contactId: r.contactId ?? null,
        })),
      },
    },
    include: { recipients: true },
  });

  return res.status(201).json({
    id: emailRecord.id,
    subject: emailRecord.subject,
    timestamp: emailRecord.timestamp,
  });
});

/** DELETE /emails/draft/:id — delete a draft */
emailsRouter.delete('/draft/:id', authenticate, actAsMiddleware, async (req: Request, res: Response) => {
  const allowedIds = await emailAccessAgencyIds(req);
  if (allowedIds.length === 0) return res.status(403).json({ error: 'Agency context required' });

  const draft = await prisma.email.findFirst({
    where: { id: req.params.id, subCompanyId: { in: allowedIds }, fromUserId: effectiveActorId(req), folder: 'drafts' },
  });
  if (!draft) return res.status(404).json({ error: 'Draft not found' });

  await prisma.emailRecipient.deleteMany({ where: { emailId: draft.id } });
  await prisma.email.delete({ where: { id: draft.id } });
  return res.json({ ok: true });
});

/** PUT /emails/draft/:id — update draft */
emailsRouter.put('/draft/:id', authenticate, actAsMiddleware, async (req: Request, res: Response) => {
  const allowedIds = await emailAccessAgencyIds(req);
  if (allowedIds.length === 0) return res.status(403).json({ error: 'Agency context required' });

  const draft = await prisma.email.findFirst({
    where: {
      id: req.params.id,
      subCompanyId: { in: allowedIds },
      fromUserId: effectiveActorId(req),
      folder: 'drafts',
    },
  });
  if (!draft) return res.status(404).json({ error: 'Draft not found' });

  const parsed = draftBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  const { to, subject, body, clientId, leadId, subCompanyId: bodySubCompanyId } = parsed.data;

  let nextSubCompanyId = draft.subCompanyId;
  if (bodySubCompanyId) {
    if (!allowedIds.includes(bodySubCompanyId)) {
      return res.status(403).json({ error: 'Not allowed to save draft for this agency' });
    }
    nextSubCompanyId = bodySubCompanyId;
  }

  const recipients = to?.length ? await resolveRecipients(to, nextSubCompanyId) : [];

  await prisma.emailRecipient.deleteMany({ where: { emailId: draft.id } });
  await prisma.email.update({
    where: { id: draft.id },
    data: {
      subject: subject ?? draft.subject,
      body: body ?? draft.body,
      clientId: clientId ?? draft.clientId,
      leadId: leadId ?? draft.leadId,
      subCompanyId: nextSubCompanyId,
      recipients: {
        create: recipients.map((r) => ({
          recipientType: 'to' as const,
          name: r.name,
          emailAddress: r.email,
          clientId: clientId ?? null,
          contactId: null,
        })),
      },
    },
  });

  return res.json({ ok: true });
});

/** POST /emails/inbound — SendGrid Inbound Parse webhook (no auth; validate by checking payload) */
emailsRouter.post('/inbound', inboundForm.any(), async (req: Request, res: Response) => {
  const body = req.body as Record<string, string>;
  const files = ((req as Request & { files?: InboundUploadFile[] }).files) ?? [];
  const from = body.from ?? body.From ?? '';
  const to = body.to ?? body.To ?? '';
  const subject = body.subject ?? body.Subject ?? '(No subject)';
  const text = body.text ?? body.Text ?? '';
  const html = body.html ?? body.Html ?? text;

  console.log('📨 [INBOUND] Webhook received ─────────────────');
  console.log('📨 [INBOUND] From   :', from);
  console.log('📨 [INBOUND] To     :', to);
  console.log('📨 [INBOUND] Subject:', subject);

  const toAddress = (typeof to === 'string' ? to : '').split(',')[0]?.trim().toLowerCase();
  if (!toAddress) {
    console.log('📨 [INBOUND] ❌ Missing to address — rejected');
    return res.status(400).send('Missing to');
  }

  // 1) Prefer CRM reply-to addresses (plus addressing) so we can match thread + user.
  // Format: local+crmreply-<emailId>.<userId>@domain
  const crmReplyMatch = toAddress.match(/\+crmreply-([0-9a-f-]{36})\.([0-9a-f-]{36})@/i);

  let user: { id: string; subCompanyId: string | null; emailForwardingToUserId: string | null } | null = null;
  let threadEmail: { id: string; clientId: string | null; leadId: string | null; subCompanyId: string } | null = null;

  if (crmReplyMatch) {
    const [, emailId, userId] = crmReplyMatch;
    console.log('📨 [INBOUND] CRM reply match — emailId:', emailId, 'userId:', userId);
    user = await (prisma.user as any).findFirst({
      where: { id: userId },
      select: { id: true, subCompanyId: true, emailForwardingToUserId: true },
    });
    if (user) {
      threadEmail = await prisma.email.findFirst({
        where: { id: emailId, subCompanyId: user.subCompanyId ?? undefined, fromUserId: user.id },
        select: { id: true, clientId: true, leadId: true, subCompanyId: true },
      });
      console.log('📨 [INBOUND] Thread match:', threadEmail ? `✅ emailId=${threadEmail.id}` : '❌ not found');
    } else {
      console.log('📨 [INBOUND] ❌ User not found for userId:', userId);
    }
  } else {
    console.log('📨 [INBOUND] No CRM reply pattern — falling back to direct user lookup');
  }

  // 2) Fallback: direct-to-user inbox (old behavior)
  if (!user) {
    user = await (prisma.user as any).findFirst({
      where: { email: { equals: toAddress, mode: 'insensitive' } },
      select: { id: true, subCompanyId: true, emailForwardingToUserId: true },
    });
  }
  if (!user || !user.subCompanyId) {
    console.log('📨 [INBOUND] ❌ No user found for address:', toAddress, '— discarded');
    return res.status(200).send('OK');
  }

  // 3) Offboarding forwarding rule: if the resolved user has departed, route to their successor.
  // toUserId stays as the original addressee; forwardedToUserId points to who actually receives it.
  let forwardingTargetId: string | null = null;
  if (user.emailForwardingToUserId) {
    const target = await prisma.user.findFirst({
      where: { id: user.emailForwardingToUserId, isActive: true },
      select: { id: true },
    });
    if (target) {
      console.log(`📨 [INBOUND] Offboarded user ${user.id} — forwarding to ${target.id}`);
      forwardingTargetId = target.id;
    }
  }

  const fromMatch = from.match(/^(?:(.+?)\s*)?<([^>]+)>$/) || [null, null, from];
  const fromName = (fromMatch[1] ?? fromMatch[2] ?? from).trim() || 'Unknown';
  const fromEmail = (fromMatch[2] ?? from).trim();

  // Best-effort: match sender to a client contact to attach clientId if we didn't resolve a thread.
  let inferredClientId: string | null = threadEmail?.clientId ?? null;
  const inferredLeadId: string | null = threadEmail?.leadId ?? null;
  if (!inferredClientId && fromEmail) {
    const contact = await prisma.clientContact.findFirst({
      where: { email: { equals: fromEmail, mode: 'insensitive' } },
      select: { clientId: true },
    });
    inferredClientId = contact?.clientId ?? null;
  }

  const inboundEmail = await prisma.email.create({
    data: {
      subCompanyId: user.subCompanyId,
      toUserId: user.id,
      forwardedToUserId: forwardingTargetId,
      forwardedFromUserId: forwardingTargetId ? user.id : null,
      fromName,
      fromEmail,
      subject,
      body: html || text,
      folder: 'inbox',
      clientId: inferredClientId,
      leadId: inferredLeadId,
      inReplyTo: threadEmail?.id ?? null,
      isRead: false,
      recipients: {
        create: [{ recipientType: 'to', emailAddress: toAddress, name: toAddress }],
      },
    },
  });

  const attachmentInfoRaw = body['attachment-info'] ?? body.attachment_info ?? body['attachment_info'];
  const storedAttachments = await persistInboundEmailAttachments(inboundEmail.id, files, attachmentInfoRaw).catch((err) => {
    console.error('📨 [INBOUND] ⚠️ Failed to store attachments:', err);
    return 0;
  });

  const notifyUserId = forwardingTargetId ?? user.id;
  console.log('📨 [INBOUND] ✅ Saved to inbox — userId:', notifyUserId, forwardingTargetId ? `(forwarded from ${user.id})` : '', 'thread:', threadEmail?.id ?? 'none', 'attachments:', storedAttachments);
  console.log('📨 [INBOUND] ────────────────────────────────────');
  emitToUsers([notifyUserId], 'email:refresh', { subCompanyId: user.subCompanyId });

  return res.status(200).send('OK');
});
