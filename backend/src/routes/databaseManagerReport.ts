/**
 * Database Manager productivity report — clients added to global database per manager.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { ensureAccessContext } from '../utils/requestPermission';

export const databaseManagerReportRouter = Router();
databaseManagerReportRouter.use(authenticate);

const querySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  userIds: z.string().optional(),
});

function dayStart(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

function dayEnd(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const REPORT_VIEWER_ROLES = new Set(['super_admin', 'director', 'operations_manager']);

databaseManagerReportRouter.get(
  '/database-managers',
  requirePermission('analytics:read'),
  async (req: Request, res: Response) => {
    const ctx = await ensureAccessContext(req);
    if (!ctx) return res.status(401).json({ error: 'Unauthorized' });

    const isDbManager = ctx.roleKey === 'database_manager';
    if (!isDbManager && !REPORT_VIEWER_ROLES.has(ctx.roleKey)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    }

    const startDate = parsed.data.startDate ?? todayStr();
    const endDate = parsed.data.endDate ?? startDate;
    const rangeStart = dayStart(startDate);
    const rangeEnd = dayEnd(endDate);

    let managerIds: string[] | undefined;
    if (parsed.data.userIds?.trim()) {
      managerIds = parsed.data.userIds.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (isDbManager) {
      managerIds = [ctx.userId];
    }

    const managers = await prisma.user.findMany({
      where: {
        role: 'database_manager',
        isActive: true,
        ...(managerIds?.length ? { id: { in: managerIds } } : {}),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isActive: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const ids = managers.map((m) => m.id);
    if (ids.length === 0) {
      return res.json({
        data: {
          startDate,
          endDate,
          managers: [],
        },
      });
    }

    const [approvedGroups, pendingGroups] = await Promise.all([
      prisma.client.groupBy({
        by: ['createdById'],
        where: {
          createdById: { in: ids },
          createdAt: { gte: rangeStart, lte: rangeEnd },
        },
        _count: { _all: true },
      }),
      prisma.pendingClientSubmission.groupBy({
        by: ['submittedById'],
        where: {
          submissionSource: 'global_database',
          submittedById: { in: ids },
        },
        _count: { _all: true },
      }),
    ]);

    const approvedByUser = new Map(
      approvedGroups.map((g) => [g.createdById!, g._count._all]),
    );
    const pendingByUser = new Map(pendingGroups.map((g) => [g.submittedById, g._count._all]));

    const data = managers.map((m) => ({
      userId: m.id,
      email: m.email,
      firstName: m.firstName,
      lastName: m.lastName,
      name: [m.firstName, m.lastName].filter(Boolean).join(' ').trim() || m.email,
      approvedCount: approvedByUser.get(m.id) ?? 0,
      pendingCount: pendingByUser.get(m.id) ?? 0,
      rejectedCount: 0,
    }));

    return res.json({
      data: {
        startDate,
        endDate,
        managers: data,
      },
    });
  },
);
