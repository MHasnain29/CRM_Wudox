// Notifications: list, mark read, unread count, SSE stream.
// Merged list includes own + linked users' notifications with source identity fields.
import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { env } from '../config/env';
import { onNotificationCreated } from '../services/notificationEvents';
import type { JwtPayload } from '../middleware/auth';

export const notificationsRouter = Router();

type LinkedMember = {
  userId: string;
  firstName: string;
  lastName: string;
  agencyName: string;
  color: string | null;
};

// Returns active linked group members with name, agency and color. Never throws.
async function getLinkedMembers(userId: string): Promise<LinkedMember[]> {
  try {
    const link = await prisma.userAgencyLink.findFirst({
      where: { userId },
      select: { groupId: true },
    });
    if (!link) return [];

    const members = await prisma.userAgencyLink.findMany({
      where: { groupId: link.groupId, userId: { not: userId } },
      include: {
        user: { select: { isActive: true, offboardingStartedAt: true, subCompanyId: true, firstName: true, lastName: true } },
      },
    });

    const active = members.filter((m) => m.user.isActive && !m.user.offboardingStartedAt);
    if (active.length === 0) return [];

    const subCompanyIds = [
      ...new Set(active.map((m) => m.user.subCompanyId).filter(Boolean)),
    ] as string[];

    const subCompanies = await prisma.subCompany.findMany({
      where: { id: { in: subCompanyIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(subCompanies.map((s) => [s.id, s.name]));

    return active.map((m) => ({
      userId: m.userId,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      agencyName: m.user.subCompanyId ? (nameById.get(m.user.subCompanyId) ?? 'Linked Agency') : 'Linked Agency',
      color: m.color,
    }));
  } catch {
    return [];
  }
}

// SSE — auth via ?token= because EventSource can't send headers.
notificationsRouter.get('/stream', async (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : undefined;
  if (!token) { res.status(401).json({ error: 'Missing token' }); return; }

  let user: JwtPayload;
  try {
    user = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  } catch {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data: string) => {
    res.write(`data: ${data}\n\n`);
    if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
      (res as unknown as { flush: () => void }).flush();
    }
  };

  const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 25_000);

  const watchedIds = new Set<string>([user.sub]);
  try {
    const link = await prisma.userAgencyLink.findFirst({ where: { userId: user.sub }, select: { groupId: true } });
    if (link) {
      const members = await prisma.userAgencyLink.findMany({ where: { groupId: link.groupId }, select: { userId: true } });
      members.forEach((m) => watchedIds.add(m.userId));
    }
  } catch { /* never block SSE */ }

  const unsubscribe = onNotificationCreated((payload) => {
    if (watchedIds.has(payload.userId)) send('refresh');
  });

  req.on('close', () => { clearInterval(keepAlive); unsubscribe(); });
});

notificationsRouter.use(authenticate);

function getSubCompanyId(req: Request): string | null {
  return req.user?.subCompanyId ?? null;
}

// GET / — own + linked notifications merged, newest first, with source identity fields.
notificationsRouter.get('/', async (req: Request, res: Response) => {
  const subCompanyId = getSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const userId = req.user!.sub;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

  const [linkedMembers, selfUser, selfAgency] = await Promise.all([
    getLinkedMembers(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } }),
    prisma.subCompany.findUnique({ where: { id: subCompanyId }, select: { name: true } }),
  ]);

  const linkedUserIds = linkedMembers.map((m) => m.userId);
  const memberByUserId = new Map(linkedMembers.map((m) => [m.userId, m]));

  const dbList = await prisma.notification.findMany({
    where: {
      OR: [
        { userId, subCompanyId },
        ...(linkedUserIds.length > 0 ? [{ userId: { in: linkedUserIds } }] : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  // Dedup by type:relatedId — old fan-out may have left multiple records for same event.
  const seenKey = new Set<string>();
  const deduped = dbList.filter((n) => {
    if (!n.relatedId) return true;
    const key = `${n.type}:${n.relatedId}`;
    if (seenKey.has(key)) return false;
    seenKey.add(key);
    return true;
  });

  const merged = deduped.map((n) => {
    const isOwn = n.userId === userId;
    const member = memberByUserId.get(n.userId);
    return {
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      relatedId: n.relatedId,
      readAt: n.readAt,
      createdAt: n.createdAt,
      isReminder: false,
      sourceUserId: n.userId,
      sourceFirstName: isOwn ? (selfUser?.firstName ?? '') : (member?.firstName ?? ''),
      sourceLastName: isOwn ? (selfUser?.lastName ?? '') : (member?.lastName ?? ''),
      sourceAgencyName: isOwn ? (selfAgency?.name ?? '') : (member?.agencyName ?? ''),
      sourceUserColor: isOwn ? null : (member?.color ?? null),
      isOwn,
    };
  });

  return res.json({ data: merged });
});

// GET /unread-count — deduped unread count across own + linked.
notificationsRouter.get('/unread-count', async (req: Request, res: Response) => {
  const subCompanyId = getSubCompanyId(req);
  if (!subCompanyId) return res.json({ count: 0 });

  const userId = req.user!.sub;
  const linkedMembers = await getLinkedMembers(userId);
  const linkedUserIds = linkedMembers.map((m) => m.userId);

  const unreadRows = await prisma.notification.findMany({
    where: {
      OR: [
        { userId, subCompanyId, readAt: null },
        ...(linkedUserIds.length > 0 ? [{ userId: { in: linkedUserIds }, readAt: null }] : []),
      ],
    },
    select: { type: true, relatedId: true },
    orderBy: { createdAt: 'desc' },
  });

  const seenKey = new Set<string>();
  let count = 0;
  for (const n of unreadRows) {
    if (!n.relatedId) { count++; continue; }
    const key = `${n.type}:${n.relatedId}`;
    if (!seenKey.has(key)) { seenKey.add(key); count++; }
  }

  return res.json({ count });
});

// PATCH /read-all — must be before /:id/read to avoid "read-all" matching as an id.
notificationsRouter.patch('/read-all', async (req: Request, res: Response) => {
  const subCompanyId = getSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const userId = req.user!.sub;
  const linkedMembers = await getLinkedMembers(userId);
  const linkedUserIds = linkedMembers.map((m) => m.userId);

  await prisma.notification.updateMany({
    where: {
      OR: [
        { userId, subCompanyId, readAt: null },
        ...(linkedUserIds.length > 0 ? [{ userId: { in: linkedUserIds }, readAt: null }] : []),
      ],
    },
    data: { readAt: new Date() },
  });

  return res.json({ ok: true });
});

// PATCH /:id/read — works on own or linked users' notifications.
notificationsRouter.patch('/:id/read', async (req: Request, res: Response) => {
  const userId = req.user!.sub;
  const id = req.params.id;

  if (id.startsWith('reminder-')) return res.json({ ok: true });

  const linkedMembers = await getLinkedMembers(userId);
  const allUserIds = [userId, ...linkedMembers.map((m) => m.userId)];

  const n = await prisma.notification.findFirst({ where: { id, userId: { in: allUserIds } } });
  if (!n) return res.status(404).json({ error: 'Notification not found' });

  await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });

  return res.json({ ok: true });
});
