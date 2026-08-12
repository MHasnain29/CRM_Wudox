import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { requestHasPermission } from '../utils/requestPermission';
import { getEmployeeData, commitOffboarding, partialCommitOffboarding, getInProgressUsers, getPastOffboardedUsers } from '../services/offboarding';

const router = Router();
router.use(authenticate);

async function requireOffboardingAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.user?.sub;
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const hasPerm = await requestHasPermission(req, 'employees:offboard');
  if (hasPerm) { next(); return; }

  res.status(403).json({ error: 'Forbidden', message: 'employees:offboard permission required' });
}

router.get('/employee/:userId/data', requireOffboardingAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const data = await getEmployeeData(userId);
    res.json(data);
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2025') {
      res.status(404).json({ error: 'Employee not found' });
    } else {
      console.error('[offboarding] getEmployeeData error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

const itemAssignmentSchema = z.object({
  id: z.string().uuid(),
  toUserId: z.string().uuid(),
});

const commitBodySchema = z.object({
  departingUserId: z.string().uuid(),
  emailForwardToUserId: z.string().uuid(),
  clients: z.array(itemAssignmentSchema),
  pipeline: z.array(itemAssignmentSchema),
  leads: z.array(itemAssignmentSchema),
  tasks: z.array(itemAssignmentSchema),
  meetings: z.array(itemAssignmentSchema),
  followUps: z.array(itemAssignmentSchema).default([]),
  fallbackUserId: z.string().uuid(),
  deactivateUser: z.boolean().default(true),
});

router.post('/commit', requireOffboardingAccess, async (req: Request, res: Response): Promise<void> => {
  const parsed = commitBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }

  const adminId = req.user!.sub;
  const subCompanyId = req.user!.subCompanyId;

  if (!subCompanyId) {
    res.status(400).json({ error: 'No agency context' });
    return;
  }

  const admin = await prisma.user.findUnique({
    where: { id: adminId },
    select: { firstName: true, lastName: true },
  });
  const adminName = admin ? `${admin.firstName} ${admin.lastName}` : 'Admin';

  try {
    await commitOffboarding(parsed.data, adminId, subCompanyId, adminName);
    res.json({ success: true });
  } catch (err) {
    console.error('[offboarding] commitOffboarding error:', err);
    res.status(500).json({ error: 'Offboarding failed. No data was changed.' });
  }
});

const partialCommitBodySchema = z.object({
  departingUserId: z.string().uuid(),
  fallbackUserId: z.string().uuid(),
  emailForwardToUserId: z.string().uuid().optional(),
  clients: z.array(itemAssignmentSchema).optional(),
  pipeline: z.array(itemAssignmentSchema).optional(),
  leads: z.array(itemAssignmentSchema).optional(),
  tasks: z.array(itemAssignmentSchema).optional(),
  meetings: z.array(itemAssignmentSchema).optional(),
  followUps: z.array(itemAssignmentSchema).optional(),
});

router.post('/partial-commit', requireOffboardingAccess, async (req: Request, res: Response): Promise<void> => {
  const parsed = partialCommitBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }
  const actorId = req.user!.sub;
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { firstName: true, lastName: true },
  });
  const actorName = actor ? `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim() || 'Admin' : 'Admin';
  try {
    await partialCommitOffboarding({ ...parsed.data, actorId, actorName });
    res.json({ success: true });
  } catch (err) {
    console.error('[offboarding] partialCommitOffboarding error:', err);
    res.status(500).json({ error: 'Partial commit failed' });
  }
});

// POST /initiate/:userId — mark a user as in offboarding
router.post('/initiate/:userId', requireOffboardingAccess, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;
  const adminSubCompanyId = req.user!.subCompanyId;

  if (!adminSubCompanyId) {
    res.status(400).json({ error: 'No agency context' });
    return;
  }

  try {
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { subCompanyId: true, isActive: true, offboardingStartedAt: true },
    });

    if (!target) { res.status(404).json({ error: 'User not found' }); return; }
    if (target.subCompanyId !== adminSubCompanyId) { res.status(403).json({ error: 'Forbidden' }); return; }
    if (!target.isActive) { res.status(400).json({ error: 'User is already inactive' }); return; }
    if ((target as any).offboardingStartedAt) { res.json({ success: true }); return; } // idempotent

    await prisma.user.update({
      where: { id: userId },
      data: { offboardingStartedAt: new Date() },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[offboarding] initiate error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /cancel/:userId — cancel in-progress offboarding (idempotent)
router.post('/cancel/:userId', requireOffboardingAccess, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;

  try {
    await prisma.user.updateMany({
      where: { id: userId, subCompanyId: req.user!.subCompanyId ?? undefined },
      data: { offboardingStartedAt: null },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[offboarding] cancel error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /in-progress — list users currently being offboarded in this agency
router.get('/in-progress', requireOffboardingAccess, async (req: Request, res: Response): Promise<void> => {
  const subCompanyId = req.user!.subCompanyId;

  if (!subCompanyId) {
    res.json([]);
    return;
  }

  try {
    const users = await getInProgressUsers(subCompanyId);
    res.json(users);
  } catch (err) {
    console.error('[offboarding] in-progress error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /past — list past offboarded users in this agency (lightweight — no step details)
router.get('/past', requireOffboardingAccess, async (req: Request, res: Response): Promise<void> => {
  const subCompanyId = req.user!.subCompanyId;

  if (!subCompanyId) {
    res.json([]);
    return;
  }

  try {
    const users = await getPastOffboardedUsers(subCompanyId);
    res.json(users);
  } catch (err) {
    console.error('[offboarding] past error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /history/by-user/:userId — fetch offboarding trail for a user (as departed or as receiver)
router.get('/history/by-user/:userId', requireOffboardingAccess, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;

  try {
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { subCompanyId: true },
    });
    if (!targetUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Logs where this user was the departing employee
    const departedLogs = await prisma.offboardingLog.findMany({
      where: { departingUserId: userId },
      include: {
        admin: { select: { id: true, firstName: true, lastName: true } },
        departingUser: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
      orderBy: { committedAt: 'desc' },
    });

    // All logs in this agency — filter for ones where this user received items
    const agencyLogs = targetUser.subCompanyId
      ? await prisma.offboardingLog.findMany({
          where: { subCompanyId: targetUser.subCompanyId, departingUserId: { not: userId } },
          include: {
            admin: { select: { id: true, firstName: true, lastName: true } },
            departingUser: { select: { id: true, firstName: true, lastName: true, role: true } },
          },
          orderBy: { committedAt: 'desc' },
        })
      : [];

    // Filter + compute per-user received counts in JS (log count is always tiny)
    const receivedLogs = agencyLogs
      .map((log) => {
        const p = log.payload as Record<string, unknown>;
        const fallback = p.fallbackUserId as string | undefined;
        const emailTo = p.emailForwardToUserId as string | undefined;

        const resolve = (toId: unknown) => (toId as string | null | undefined) ?? fallback;

        const arr = (key: string) => (p[key] as { id: string; toUserId: string | null }[] | undefined) ?? [];

        const emailCount = emailTo === userId ? ((log.summary as Record<string, number>).emailCount ?? 0) : 0;
        const clientCount = arr('clients').filter((a) => resolve(a.toUserId) === userId).length;
        const pipelineCount = arr('pipeline').filter((a) => resolve(a.toUserId) === userId).length;
        const leadCount = arr('leads').filter((a) => resolve(a.toUserId) === userId).length;
        const taskCount = arr('tasks').filter((a) => resolve(a.toUserId) === userId).length;
        const meetingCount = arr('meetings').filter((a) => resolve(a.toUserId) === userId).length;
        const followUpCount = arr('followUps').filter((a) => resolve(a.toUserId) === userId).length;

        const total = emailCount + clientCount + pipelineCount + leadCount + taskCount + meetingCount + followUpCount;
        if (total === 0) return null;

        return {
          id: log.id,
          committedAt: log.committedAt,
          admin: log.admin,
          departingUser: log.departingUser,
          totalCounts: log.summary as Record<string, number>,
          myReceivedCounts: { emailCount, clientCount, pipelineCount, leadCount, taskCount, meetingCount, followUpCount },
        };
      })
      .filter(Boolean);

    // For departed logs, build per-recipient breakdown
    const departedFormatted = await Promise.all(
      departedLogs.map(async (log) => {
        const p = log.payload as Record<string, unknown>;
        const fallback = p.fallbackUserId as string;
        const emailTo = p.emailForwardToUserId as string;

        const resolve = (toId: unknown) => (toId as string | null | undefined) ?? fallback;
        const arr = (key: string) => (p[key] as { id: string; toUserId: string | null }[] | undefined) ?? [];

        // Collect unique recipient IDs — keys must match OffboardingHistoryCounts on frontend
        const recipientMap = new Map<string, { emailCount: number; clientCount: number; pipelineCount: number; leadCount: number; taskCount: number; meetingCount: number; followUpCount: number }>();
        const get = (id: string) => {
          if (!recipientMap.has(id)) recipientMap.set(id, { emailCount: 0, clientCount: 0, pipelineCount: 0, leadCount: 0, taskCount: 0, meetingCount: 0, followUpCount: 0 });
          return recipientMap.get(id)!;
        };

        if (emailTo) get(emailTo).emailCount = ((log.summary as Record<string, number>).emailCount ?? 0);
        for (const a of arr('clients')) get(resolve(a.toUserId)).clientCount++;
        for (const a of arr('pipeline')) get(resolve(a.toUserId)).pipelineCount++;
        for (const a of arr('leads')) get(resolve(a.toUserId)).leadCount++;
        for (const a of arr('tasks')) get(resolve(a.toUserId)).taskCount++;
        for (const a of arr('meetings')) get(resolve(a.toUserId)).meetingCount++;
        for (const a of arr('followUps')) get(resolve(a.toUserId)).followUpCount++;

        // Fetch recipient names
        const recipientIds = Array.from(recipientMap.keys());
        const users = await prisma.user.findMany({
          where: { id: { in: recipientIds } },
          select: { id: true, firstName: true, lastName: true },
        });
        const userMap = new Map(users.map((u) => [u.id, u]));

        const recipients = recipientIds
          .map((rid) => {
            const u = userMap.get(rid);
            const c = recipientMap.get(rid)!;
            return u ? { userId: rid, firstName: u.firstName, lastName: u.lastName, ...c } : null;
          })
          .filter(Boolean);

        return {
          id: log.id,
          committedAt: log.committedAt,
          admin: log.admin,
          departingUser: log.departingUser,
          totalCounts: log.summary as Record<string, number>,
          recipients,
        };
      })
    );

    res.json({ departed: departedFormatted, received: receivedLogs });
  } catch (err) {
    console.error('[offboarding] history error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
