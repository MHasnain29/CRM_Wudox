/**
 * Dashboard stats: today's counts for calls and emails (server-side, no pagination limit).
 */
import { Router, Request, Response } from 'express';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { resolveAllowedSubCompanyIds, resolveListAgencyScope } from '../config/agencyScope';
import { getRecruitmentDashboard } from '../services/recruitmentDashboard';
import { getRecruitmentReport } from '../services/recruitmentReports';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

/**
 * GET /dashboard/recruitment — aggregate KPIs, pending approvals and charts for
 * the recruitment manager / recruiter dashboards. `?mine=1` scopes to the
 * current user's own jobs and requests (recruiter view).
 */
dashboardRouter.get(
  '/recruitment',
  requirePermission('jobs:read'),
  async (req: Request, res: Response) => {
    const scope = await resolveListAgencyScope(req, req.query.agencyIds as string | undefined);
    if (!scope?.allowedIds.length) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const mine = req.query.mine === '1' || req.query.mine === 'true';
    const data = await getRecruitmentDashboard({
      agencyIds: scope.allowedIds,
      actorId: req.user!.sub,
      mine,
    });
    return res.json(data);
  },
);

/**
 * GET /dashboard/recruitment-report — period analytics for recruitment reports.
 * Query: mine=1, startDate=ISO, endDate=ISO (defaults to last 180 days).
 */
dashboardRouter.get(
  '/recruitment-report',
  requirePermission('jobs:read'),
  async (req: Request, res: Response) => {
    const scope = await resolveListAgencyScope(req, req.query.agencyIds as string | undefined);
    if (!scope?.allowedIds.length) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const mine = req.query.mine === '1' || req.query.mine === 'true';
    const now = new Date();
    const defaultStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1),
    );
    let startDate = defaultStart;
    let endDate = now;
    if (typeof req.query.startDate === 'string' && req.query.startDate) {
      const parsed = new Date(req.query.startDate);
      if (!Number.isNaN(parsed.getTime())) startDate = parsed;
    }
    if (typeof req.query.endDate === 'string' && req.query.endDate) {
      const parsed = new Date(req.query.endDate);
      if (!Number.isNaN(parsed.getTime())) endDate = parsed;
    }
    if (startDate >= endDate) {
      return res.status(400).json({ error: 'startDate must be before endDate' });
    }
    const data = await getRecruitmentReport({
      agencyIds: scope.allowedIds,
      actorId: req.user!.sub,
      mine,
      startDate,
      endDate,
    });
    return res.json(data);
  },
);

/** Start of today and start of tomorrow in UTC (for date range). */
function getTodayUTCBounds(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** GET /dashboard/today-stats — calls today and emails sent today for current user (agency-scoped). */
dashboardRouter.get('/today-stats', async (req: Request, res: Response) => {
  const subCompanyId = req.user?.subCompanyId;
  const userId = req.user?.sub;
  if (!subCompanyId || !userId) {
    return res.status(403).json({ error: 'Agency context required' });
  }

  const { start, end } = getTodayUTCBounds();

  const [callsToday, emailsToday] = await Promise.all([
    prisma.call.count({
      where: {
        subCompanyId,
        ownerId: userId,
        timestamp: { gte: start, lt: end },
      },
    }),
    prisma.email.count({
      where: {
        subCompanyId,
        folder: 'sent',
        fromUserId: userId,
        timestamp: { gte: start, lt: end },
      },
    }),
  ]);

  return res.json({ callsToday, emailsToday });
});

/** GET /dashboard/lead-status-over-time — monthly lead status counts for the last 12 months (agency-scoped). */
dashboardRouter.get('/lead-status-over-time', async (req: Request, res: Response) => {
  const subCompanyId = req.user?.subCompanyId;
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }

  const now = new Date();
  const months: { start: Date; end: Date; label: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    const label = start.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    months.push({ start, end, label });
  }

  // Fetch all leads for the agency created in the last 12 months
  const startDate = months[0].start;
  const leads = await prisma.lead.findMany({
    where: {
      subCompanyId,
      createdAt: { gte: startDate },
    },
    select: {
      status: true,
      createdAt: true,
      closedAt: true,
    },
  });

  const data = months.map(({ start, end, label }) => {
    let won = 0, lost = 0, active = 0, open = 0;
    for (const lead of leads) {
      // Lead was created in this month
      if (lead.createdAt >= start && lead.createdAt < end) {
        if (lead.status === 'closed_won') won++;
        else if (lead.status === 'closed_lost') lost++;
        else if (lead.status === 'active') active++;
        else if (lead.status === 'open') open++;
      }
      // Lead was closed (won/lost) in this month but created earlier
      if (lead.closedAt && lead.closedAt >= start && lead.closedAt < end && lead.createdAt < start) {
        if (lead.status === 'closed_won') won++;
        else if (lead.status === 'closed_lost') lost++;
      }
    }
    return { month: label, Won: won, Lost: lost, Active: active, Open: open };
  });

  return res.json(data);
});

/**
 * GET /dashboard/director-stats
 * Cross-division stats for director / super_admin / operations_manager.
 * Query params:
 *   period  = today | month | year | custom (default: month)
 *   from    = ISO date string (required when period=custom)
 *   to      = ISO date string (required when period=custom)
 */
dashboardRouter.get(
  '/director-stats',
  requirePermission('analytics:read'),
  async (req: Request, res: Response) => {
    const userSubCompanyId = req.user!.subCompanyId;

    if (!userSubCompanyId) {
      return res.status(403).json({ error: 'Agency context required' });
    }

    // ── Determine which sub-companies this user can see ──────────────────
    const subCompanyIds = await resolveAllowedSubCompanyIds(req.user!);

    if (subCompanyIds.length === 0) {
      return res.json({
        subCompanies: [],
        overview: { totalClients: 0, activeClients: 0, wonLeads: 0, lostLeads: 0, totalUsers: 0, activeUsers: 0, conversionRate: 0, periodWonLeads: 0, periodLostLeads: 0 },
        divisions: [],
        monthlyTrend: [],
      });
    }

    // ── Parse date range ─────────────────────────────────────────────────
    const now = new Date();
    const period = (req.query.period as string) ?? 'month';
    let periodStart: Date;
    let periodEnd: Date;

    if (period === 'today') {
      periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      periodEnd = new Date(periodStart.getTime() + 86400000);
    } else if (period === 'year') {
      periodStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      periodEnd = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
    } else if (period === 'custom' && req.query.from && req.query.to) {
      periodStart = new Date(req.query.from as string);
      periodEnd = new Date(req.query.to as string);
      if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
        return res.status(400).json({ error: 'Invalid from/to dates' });
      }
    } else {
      // month (default)
      periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    }

    // Last month bounds (for trend comparison)
    const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const thisMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    // ── Monthly trend buckets (last 6 months) ────────────────────────────
    const trendMonths: { start: Date; end: Date; label: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      trendMonths.push({
        start: d,
        end: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)),
        label: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
      });
    }
    const trendWindowStart = trendMonths[0].start;

    // ── Fetch all data in parallel ────────────────────────────────────────
    const [subCompanies, allLeads, periodClosedLeads, allClients, allUsers, allCalls, allEmails, allMeetings] =
      await Promise.all([
        prisma.subCompany.findMany({
          where: { id: { in: subCompanyIds } },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        // All leads (no date filter) — for all-time totals (pipeline health) and trend
        prisma.lead.findMany({
          where: { subCompanyId: { in: subCompanyIds } },
          select: { id: true, subCompanyId: true, status: true, closedAt: true, createdAt: true },
        }),
        // Leads closed in the selected period — for period-accurate chart bars
        prisma.lead.findMany({
          where: {
            subCompanyId: { in: subCompanyIds },
            status: { in: ['closed_won', 'closed_lost'] },
            closedAt: { gte: periodStart, lt: periodEnd },
          },
          select: { subCompanyId: true, status: true },
        }),
        // Clients: via junction table
        prisma.clientSubCompany.findMany({
          where: { subCompanyId: { in: subCompanyIds } },
          select: { subCompanyId: true, status: true },
        }),
        // Users
        prisma.user.findMany({
          where: { subCompanyId: { in: subCompanyIds } },
          select: { id: true, subCompanyId: true, isActive: true },
        }),
        // Calls in period
        prisma.call.findMany({
          where: {
            subCompanyId: { in: subCompanyIds },
            timestamp: { gte: periodStart, lt: periodEnd },
          },
          select: { subCompanyId: true },
        }),
        // Emails (sent) in period
        prisma.email.findMany({
          where: {
            subCompanyId: { in: subCompanyIds },
            folder: 'sent',
            timestamp: { gte: periodStart, lt: periodEnd },
          },
          select: { subCompanyId: true },
        }),
        // Meetings in period
        prisma.meeting.findMany({
          where: {
            subCompanyId: { in: subCompanyIds },
            startTime: { gte: periodStart, lt: periodEnd },
          },
          select: { subCompanyId: true },
        }),
      ]);

    // ── Per-division computation ──────────────────────────────────────────
    const divisions = subCompanies.map((sc) => {
      const scLeads = allLeads.filter((l) => l.subCompanyId === sc.id);
      const scPeriodClosed = periodClosedLeads.filter((l) => l.subCompanyId === sc.id);
      const scClients = allClients.filter((c) => c.subCompanyId === sc.id);
      const scUsers = allUsers.filter((u) => u.subCompanyId === sc.id);
      const scCalls = allCalls.filter((c) => c.subCompanyId === sc.id);
      const scEmails = allEmails.filter((e) => e.subCompanyId === sc.id);
      const scMeetings = allMeetings.filter((m) => m.subCompanyId === sc.id);

      // All-time totals (pipeline health)
      const wonLeads = scLeads.filter((l) => l.status === 'closed_won').length;
      const lostLeads = scLeads.filter((l) => l.status === 'closed_lost').length;
      const activeLeads = scLeads.filter((l) => l.status === 'active' || l.status === 'open').length;
      const totalLeads = scLeads.length;
      const conversionRate = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0;

      // Period-filtered closed leads (for chart bars)
      const periodWonLeads = scPeriodClosed.filter((l) => l.status === 'closed_won').length;
      const periodLostLeads = scPeriodClosed.filter((l) => l.status === 'closed_lost').length;

      // Trend: compare won this calendar month vs last calendar month
      const thisMonthWon = scLeads.filter((l) => {
        if (l.status !== 'closed_won' || !l.closedAt) return false;
        const d = new Date(l.closedAt);
        return d >= thisMonthStart && d < thisMonthEnd;
      }).length;
      const lastMonthWon = scLeads.filter((l) => {
        if (l.status !== 'closed_won' || !l.closedAt) return false;
        const d = new Date(l.closedAt);
        return d >= lastMonthStart && d < lastMonthEnd;
      }).length;
      const trendValue =
        lastMonthWon > 0
          ? Math.round(((thisMonthWon - lastMonthWon) / lastMonthWon) * 100)
          : thisMonthWon > 0
          ? 100
          : 0;

      return {
        id: sc.id,
        name: sc.name,
        // All-time pipeline health
        totalLeads,
        activeLeads,
        wonLeads,
        lostLeads,
        conversionRate,
        // Month-over-month trend (always vs last calendar month)
        trend: thisMonthWon > lastMonthWon ? ('up' as const) : thisMonthWon < lastMonthWon ? ('down' as const) : ('neutral' as const),
        trendValue,
        // Period-filtered activity
        calls: scCalls.length,
        emails: scEmails.length,
        meetings: scMeetings.length,
        // Period-filtered closed leads (used in bar charts)
        periodWonLeads,
        periodLostLeads,
        // Team
        teamSize: scUsers.filter((u) => u.isActive).length,
        totalUsers: scUsers.length,
        // Clients
        totalClients: scClients.length,
        activeClients: scClients.filter((c) => c.status === 'active').length,
      };
    });

    // ── Overall summary ───────────────────────────────────────────────────
    const totalWonLeads = allLeads.filter((l) => l.status === 'closed_won').length;
    const totalLostLeads = allLeads.filter((l) => l.status === 'closed_lost').length;
    const totalLeadsAll = allLeads.length;
    const overview = {
      totalClients: allClients.length,
      activeClients: allClients.filter((c) => c.status === 'active').length,
      // All-time
      wonLeads: totalWonLeads,
      lostLeads: totalLostLeads,
      totalUsers: allUsers.length,
      activeUsers: allUsers.filter((u) => u.isActive).length,
      conversionRate: totalLeadsAll > 0 ? Math.round((totalWonLeads / totalLeadsAll) * 100) : 0,
      // Period-filtered
      periodWonLeads: periodClosedLeads.filter((l) => l.status === 'closed_won').length,
      periodLostLeads: periodClosedLeads.filter((l) => l.status === 'closed_lost').length,
    };

    // ── Monthly trend (last 6 months, won per division) ───────────────────
    // Fetch all leads closed in the trend window once
    const trendLeads = allLeads.filter((l) => {
      if (l.status !== 'closed_won' || !l.closedAt) return false;
      const d = new Date(l.closedAt);
      return d >= trendWindowStart;
    });

    const monthlyTrend = trendMonths.map(({ start, end, label }) => {
      const entry: Record<string, string | number> = { month: label };
      subCompanies.forEach((sc) => {
        entry[sc.name] = trendLeads.filter((l) => {
          if (l.subCompanyId !== sc.id || !l.closedAt) return false;
          const d = new Date(l.closedAt);
          return d >= start && d < end;
        }).length;
      });
      return entry;
    });

    return res.json({
      subCompanies,
      overview,
      divisions,
      monthlyTrend,
    });
  }
);
