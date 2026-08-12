/**
 * In-app messages: per-agency conversations, text + attachments, unread count.
 * Any authenticated user in the agency can message others in the same agency.
 * Real-time: Socket.IO emits message:new and conversation:read to participants.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { uploadToR2, getFromR2 } from '../services/r2Storage';
import { env } from '../config/env';
import { emitToUsers } from '../socket';

const createConversationSchema = z.object({
  participantUserId: z.string().uuid(),
});

const sendMessageSchema = z.object({
  text: z.string().max(10000).optional(),
  attachments: z.array(z.object({
    name: z.string().min(1).max(255),
    fileBase64: z.string().min(1),
    mimeType: z.string().max(128).optional(),
  })).max(10).optional(),
  /** Socket-only hint: play sound for recipient without creating an in-app notification. */
  playSoundOnly: z.boolean().optional(),
});

const MAX_ATTACHMENT_SIZE = 30 * 1024 * 1024; // 30MB

export const messagesRouter = Router();
messagesRouter.use(authenticate);

function requireAgency(req: Request, res: Response): string | null {
  const subCompanyId = req.user?.subCompanyId;
  if (!subCompanyId) {
    res.status(403).json({ error: 'Agency context required' });
    return null;
  }
  return subCompanyId;
}

/** Agency colleague or ops manager assigned to this agency (incl. super users on the agency). */
async function findMessageRecipient(subCompanyId: string, participantUserId: string) {
  return prisma.user.findFirst({
    where: {
      id: participantUserId,
      isActive: true,
      OR: [
        { subCompanyId },
        {
          role: 'operations_manager',
          managedSubCompanies: { some: { subCompanyId } },
        },
      ],
    },
    select: { id: true, firstName: true, lastName: true },
  });
}

/** GET /messages/unread-count — total unread messages for sidebar */
messagesRouter.get('/unread-count', async (req: Request, res: Response) => {
  const subCompanyId = requireAgency(req, res);
  if (!subCompanyId) return;

  const userId = req.user!.sub;
  const participants = await prisma.conversationParticipant.findMany({
    where: { userId },
    select: { conversationId: true, lastReadAt: true },
  });
  const conversationIds = participants.map((p) => p.conversationId);
  const lastReadMap = new Map(participants.map((p) => [p.conversationId, p.lastReadAt]));

  const messages = await prisma.message.findMany({
    where: {
      conversationId: { in: conversationIds },
      senderId: { not: userId },
    },
    select: { conversationId: true, createdAt: true },
  });

  let count = 0;
  for (const m of messages) {
    const lastRead = lastReadMap.get(m.conversationId);
    if (!lastRead || m.createdAt > lastRead) count++;
  }

  return res.json({ count });
});

/** GET /messages/conversations — list my conversations with last message and unread per conv */
messagesRouter.get('/conversations', async (req: Request, res: Response) => {
  const subCompanyId = requireAgency(req, res);
  if (!subCompanyId) return;

  const userId = req.user!.sub;
  const participants = await prisma.conversationParticipant.findMany({
    where: { userId },
    include: {
      conversation: {
        include: {
          participants: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true, userType: true } } } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { sender: { select: { firstName: true, lastName: true } } },
          },
        },
      },
    },
  });

  const lastReadMap = new Map(participants.map((p) => [p.conversationId, p.lastReadAt]));

  const convIds = participants.map((p) => p.conversationId);
  const unreadCounts = await prisma.message.groupBy({
    by: ['conversationId'],
    where: {
      conversationId: { in: convIds },
      senderId: { not: userId },
    },
    _count: true,
  });
  const unreadByConv = new Map<string, number>();
  for (const c of unreadCounts) {
    const lastRead = lastReadMap.get(c.conversationId);
    const count = lastRead
      ? await prisma.message.count({
          where: {
            conversationId: c.conversationId,
            senderId: { not: userId },
            createdAt: { gt: lastRead },
          },
        })
      : c._count;
    unreadByConv.set(c.conversationId, count);
  }

  const list = participants.map((p) => {
    const conv = p.conversation;
    const otherParticipants = conv.participants.filter((u) => u.userId !== userId);
    const names = otherParticipants.map((u) => `${u.user.firstName} ${u.user.lastName}`.trim()).filter(Boolean);
    const lastMsg = conv.messages[0];
    return {
      id: conv.id,
      participantUserIds: otherParticipants.map((u) => u.userId),
      participantNames: names,
      lastMessage: lastMsg?.text ?? '(No messages yet)',
      lastMessageTime: lastMsg?.createdAt ?? conv.createdAt,
      unreadCount: unreadByConv.get(conv.id) ?? 0,
    };
  });

  list.sort((a, b) => new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime());

  return res.json({ data: list });
});

/** POST /messages/conversations — find or create 1:1 conversation with another user (same agency) */
messagesRouter.post('/conversations', async (req: Request, res: Response) => {
  const subCompanyId = requireAgency(req, res);
  if (!subCompanyId) return;

  const parsed = createConversationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }
  const { participantUserId } = parsed.data;
  const currentUserId = req.user!.sub;

  if (participantUserId === currentUserId) {
    return res.status(400).json({ error: 'Cannot start conversation with yourself' });
  }

  const otherUser = await findMessageRecipient(subCompanyId, participantUserId);
  if (!otherUser) {
    return res.status(400).json({ error: 'User not found or not in your agency' });
  }

  const myConvs = await prisma.conversation.findMany({
    where: {
      subCompanyId,
      participants: { some: { userId: currentUserId } },
    },
    include: { participants: { select: { userId: true } } },
  });

  const existing = myConvs.find((c) => {
    const ids = c.participants.map((p) => p.userId);
    return ids.length === 2 && ids.includes(currentUserId) && ids.includes(participantUserId);
  });

  if (existing) {
    const lastMsg = await prisma.message.findFirst({
      where: { conversationId: existing.id },
      orderBy: { createdAt: 'desc' },
      select: { text: true, createdAt: true },
    });
    const part = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: existing.id, userId: currentUserId } },
      select: { lastReadAt: true },
    });
    const unreadCount = part?.lastReadAt
      ? await prisma.message.count({
          where: {
            conversationId: existing.id,
            senderId: { not: currentUserId },
            createdAt: { gt: part.lastReadAt },
          },
        })
      : await prisma.message.count({
          where: { conversationId: existing.id, senderId: { not: currentUserId } },
        });
    return res.json({
      id: existing.id,
      participantUserIds: [participantUserId],
      participantNames: [`${otherUser.firstName} ${otherUser.lastName}`.trim()],
      lastMessage: lastMsg?.text ?? null,
      lastMessageTime: lastMsg?.createdAt ?? existing.updatedAt,
      unreadCount,
    });
  }

  const conversation = await prisma.conversation.create({
    data: {
      subCompanyId,
      participants: {
        create: [
          { userId: currentUserId },
          { userId: participantUserId },
        ],
      },
    },
    include: {
      participants: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
    },
  });

  const other = conversation.participants.find((p) => p.userId === participantUserId);
  return res.status(201).json({
    id: conversation.id,
    participantUserIds: [participantUserId],
    participantNames: other ? [`${other.user.firstName} ${other.user.lastName}`.trim()] : [],
    lastMessage: null,
    lastMessageTime: conversation.createdAt,
    unreadCount: 0,
  });
});

/** GET /messages/conversations/:id — get one conversation (participants) */
messagesRouter.get('/conversations/:id', async (req: Request, res: Response) => {
  const subCompanyId = requireAgency(req, res);
  if (!subCompanyId) return;

  const conv = await prisma.conversation.findFirst({
    where: { id: req.params.id, subCompanyId },
    include: {
      participants: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true, userType: true } } } },
    },
  });
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const userId = req.user!.sub;
  const isParticipant = conv.participants.some((p) => p.userId === userId);
  if (!isParticipant) return res.status(403).json({ error: 'Not a participant' });

  const otherParticipants = conv.participants.filter((p) => p.userId !== userId);
  return res.json({
    id: conv.id,
    participantUserIds: otherParticipants.map((p) => p.userId),
    participantNames: otherParticipants.map((p) => `${p.user.firstName} ${p.user.lastName}`.trim()),
  });
});

/** GET /messages/conversations/:id/messages — list messages (paginated, newest last) */
messagesRouter.get('/conversations/:id/messages', async (req: Request, res: Response) => {
  const subCompanyId = requireAgency(req, res);
  if (!subCompanyId) return;

  const conv = await prisma.conversation.findFirst({
    where: { id: req.params.id, subCompanyId },
    include: { participants: { select: { userId: true } } },
  });
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const userId = req.user!.sub;
  if (!conv.participants.some((p) => p.userId === userId)) {
    return res.status(403).json({ error: 'Not a participant' });
  }

  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const before = req.query.before as string | undefined;

  const where: { conversationId: string; createdAt?: { lt: Date } } = { conversationId: req.params.id };
  if (before) where.createdAt = { lt: new Date(before) };

  const messages = await prisma.message.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    include: {
      sender: { select: { id: true, firstName: true, lastName: true } },
      attachments: true,
    },
  });

  const hasMore = messages.length > limit;
  const list = (hasMore ? messages.slice(0, limit) : messages).reverse();

  const data = list.map((m) => ({
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    senderName: `${m.sender.firstName} ${m.sender.lastName}`.trim(),
    text: m.text,
    type: m.type ?? 'text',
    metadata: m.metadata ?? null,
    createdAt: m.createdAt,
    attachments: m.attachments.map((a) => ({
      id: a.id,
      name: a.name,
      fileUrl: a.fileUrl,
      mimeType: a.mimeType,
      fileSize: a.fileSize,
    })),
  }));

  return res.json({ data, hasMore });
});

/** POST /messages/conversations/:id/messages — send message (text + optional attachments) */
messagesRouter.post('/conversations/:id/messages', async (req: Request, res: Response) => {
  const subCompanyId = requireAgency(req, res);
  if (!subCompanyId) return;

  const conv = await prisma.conversation.findFirst({
    where: { id: req.params.id, subCompanyId },
    include: { participants: { select: { userId: true } } },
  });
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const userId = req.user!.sub;
  if (!conv.participants.some((p) => p.userId === userId)) {
    return res.status(403).json({ error: 'Not a participant' });
  }

  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }
  const { text, attachments: attachmentPayloads, playSoundOnly } = parsed.data;

  if (!text?.trim() && (!attachmentPayloads || attachmentPayloads.length === 0)) {
    return res.status(400).json({ error: 'Message must have text or at least one attachment' });
  }

  const message = await prisma.message.create({
    data: {
      conversationId: req.params.id,
      senderId: userId,
      text: text?.trim() ?? null,
    },
    include: {
      sender: { select: { id: true, firstName: true, lastName: true } },
      attachments: true,
    },
  });

  if (attachmentPayloads && attachmentPayloads.length > 0) {
    const maxSize = parseInt(env.MAX_FILE_SIZE ?? '10485760', 10);
    for (const att of attachmentPayloads) {
      let buffer: Buffer;
      try {
        buffer = Buffer.from(att.fileBase64, 'base64');
      } catch {
        continue;
      }
      if (buffer.length > maxSize || buffer.length > MAX_ATTACHMENT_SIZE) continue;
      const ext = att.name.split('.').pop()?.toLowerCase().slice(0, 10) ?? 'bin';
      const MIME_MAP: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
        webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
        avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff',
        mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', mov: 'video/quicktime',
        avi: 'video/x-msvideo', mkv: 'video/x-matroska', m4v: 'video/x-m4v',
        pdf: 'application/pdf', doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xls: 'application/vnd.ms-excel',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        csv: 'text/csv', txt: 'text/plain',
      };
      const inferredMime = att.mimeType || MIME_MAP[ext] || 'application/octet-stream';
      const key = `messages/${req.params.id}/${message.id}/${Date.now()}-${att.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const fileUrl = await uploadToR2(key, buffer, inferredMime);
      await prisma.messageAttachment.create({
        data: {
          messageId: message.id,
          name: att.name,
          fileUrl: fileUrl ?? key,
          mimeType: inferredMime,
          fileSize: buffer.length,
        },
      });
    }
  }

  const withAttachments = await prisma.message.findUnique({
    where: { id: message.id },
    include: {
      sender: { select: { id: true, firstName: true, lastName: true } },
      attachments: true,
    },
  });

  const payload = {
    id: withAttachments!.id,
    conversationId: withAttachments!.conversationId,
    senderId: withAttachments!.senderId,
    senderName: `${withAttachments!.sender.firstName} ${withAttachments!.sender.lastName}`.trim(),
    text: withAttachments!.text,
    type: withAttachments!.type ?? 'text',
    metadata: withAttachments!.metadata ?? null,
    createdAt: withAttachments!.createdAt,
    attachments: withAttachments!.attachments.map((a) => ({
      id: a.id,
      name: a.name,
      fileUrl: a.fileUrl,
      mimeType: a.mimeType,
      fileSize: a.fileSize,
    })),
  };

  const participantIds = conv.participants.map((p) => p.userId);
  emitToUsers(participantIds, 'message:new', {
    conversationId: conv.id,
    message: payload,
    ...(playSoundOnly ? { playSoundOnly: true } : {}),
  });

  return res.status(201).json(payload);
});

/** GET /messages/attachments/:id — serve attachment file (stream from R2 or redirect) */
messagesRouter.get('/attachments/:id', async (req: Request, res: Response) => {
  const userId = req.user!.sub;
  const att = await prisma.messageAttachment.findUnique({
    where: { id: req.params.id },
    include: {
      message: {
        include: { conversation: { include: { participants: { select: { userId: true } } } } },
      },
    },
  });
  if (!att) return res.status(404).json({ error: 'Attachment not found' });

  const isParticipant = att.message.conversation.participants.some((p) => p.userId === userId);
  if (!isParticipant) return res.status(403).json({ error: 'Not a participant' });

  const fileUrl = att.fileUrl.trim();
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
    return res.redirect(302, fileUrl);
  }

  const r2 = await getFromR2(fileUrl);
  if (!r2) return res.status(404).json({ error: 'File not found in storage' });

  const contentType = r2.contentType ?? att.mimeType ?? 'application/octet-stream';
  const filename = att.name.replace(/[^\w.-]/g, '_');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  // Allow cross-origin loading so <img> tags on the frontend (different port) can render the image
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  return res.send(r2.body);
});

/** PATCH /messages/conversations/:id/read — mark conversation as read */
messagesRouter.patch('/conversations/:id/read', async (req: Request, res: Response) => {
  const subCompanyId = requireAgency(req, res);
  if (!subCompanyId) return;

  const conv = await prisma.conversation.findFirst({
    where: { id: req.params.id, subCompanyId },
    include: { participants: { select: { userId: true } } },
  });
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const userId = req.user!.sub;
  await prisma.conversationParticipant.updateMany({
    where: { conversationId: req.params.id, userId },
    data: { lastReadAt: new Date() },
  });

  const otherParticipantIds = conv.participants.filter((p) => p.userId !== userId).map((p) => p.userId);
  if (otherParticipantIds.length > 0) {
    emitToUsers(otherParticipantIds, 'conversation:read', { conversationId: conv.id });
  }

  return res.json({ ok: true });
});
