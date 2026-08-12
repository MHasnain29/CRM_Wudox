/**
 * Performance Report route — compares each user's actual daily activity
 * against their role's configured performance targets (emails, calls, meeting schedule count)
 * and dynamic task/follow-up completion (assigned vs completed).
 *
 * Access: director | super_admin | operations_manager
 * Scope: currently only sales_associate users are measured.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { resolveAllowedSubCompanyIds } from '../config/agencyScope';
import {
  canAccessMultipleAgencies,
  canViewTeamData,
} from '../services/accessContext';
import { ensureAccessContext } from '../utils/requestPermission';
import { getActiveRoleKeysByScopeLevels } from '../services/rbac';
import { getPositionsClosedByUserBulk } from '../services/positionsClosedAggregator';


/** Own-scope roles with performance targets (RBAC-driven; sales_associate fallback if DB empty). */
async function getMeasuredRoleKeys(): Promise<string[]> {
  const keys = await getActiveRoleKeysByScopeLevels(['own']);
  return keys.length > 0 ? keys : ['sales_associate'];
}

const querySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD').optional(),
  endDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be YYYY-MM-DD').optional(),
  userIds:   z.string().optional(),   // comma-separated UUIDs
  agencyIds: z.string().optional(),   // comma-separated UUIDs
  source: z.enum(['call', 'mail']).optional(),
  dateBasis: z.enum(['activity', 'assigned']).optional(),
});

export const performanceReportRouter = Router();
performanceReportRouter.use(authenticate);

/** Build UTC Date boundaries from a YYYY-MM-DD string. */
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

/**
 * GET /reports/performance
 *
 * For each measured-role user, returns:
 *   - target active on startDate (role-level snapshot for their agency)
 *   - actual counts for [startDate, endDate]
 *   - percentage of target achieved per metric
 *
 * Query params:
 *   startDate  YYYY-MM-DD  (default: today UTC)
 *   endDate    YYYY-MM-DD  (default: startDate)
 *   userIds    comma-separated UUIDs (default: all active measured users in scope)
 *   agencyIds  comma-separated UUIDs (default: all agencies caller can access)
 */
performanceReportRouter.get(
  '/performance',
  requirePermission('analytics:read'),
  async (req: Request, res: Response) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    }

    const { startDate, endDate, userIds: userIdsRaw, agencyIds: agencyIdsRaw } = parsed.data;

    // ── Date range (UTC day boundaries) ────────────────────────────────────
    const today = todayStr();
    const startStr = startDate ?? today;
    const endStr   = endDate   ?? startStr;

    const rangeStart = dayStart(startStr);
    const rangeEnd   = dayEnd(endStr);
    const targetAsOf = dayStart(startStr); // find target active on start of period

    // ── Agency scoping ──────────────────────────────────────────────────────
    const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
    const requestedAgencyIds = agencyIdsRaw
      ? agencyIdsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const effectiveAgencyIds =
      requestedAgencyIds.length > 0
        ? requestedAgencyIds.filter((id) => allowedIds.includes(id))
        : allowedIds;
    const agencyIdFilter = effectiveAgencyIds.length === 1
      ? effectiveAgencyIds[0]
      : effectiveAgencyIds;

    // ── User scoping (measured roles only) ─────────────────────────────────
    const requestedUserIds = userIdsRaw
      ? userIdsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    const measuredRoles = await getMeasuredRoleKeys();
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: measuredRoles },
        subCompanyId: Array.isArray(agencyIdFilter) ? { in: agencyIdFilter } : agencyIdFilter,
        ...(requestedUserIds.length ? { id: { in: requestedUserIds } } : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        subCompanyId: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    if (!users.length) return res.json([]);

    const userIds = users.map((u) => u.id);

    // ── Fetch actual activity counts in parallel ────────────────────────────
    const [
      emailCounts,
      callCounts,
      tasksAssignedCounts,
      tasksCompletedCounts,
      followUpsAssignedCounts,
      followUpsCompletedCounts,
      meetingsScheduledCounts,
    ] = await Promise.all([
      prisma.email.groupBy({
        by: ['fromUserId'],
        where: {
          fromUserId: { in: userIds },
          folder: 'sent',
          timestamp: { gte: rangeStart, lte: rangeEnd },
        },
        _count: { id: true },
      }),
      prisma.call.groupBy({
        by: ['ownerId'],
        where: {
          ownerId: { in: userIds },
          createdAt: { gte: rangeStart, lte: rangeEnd },
        },
        _count: { id: true },
      }),
      prisma.task.groupBy({
        by: ['ownerId'],
        where: {
          ownerId: { in: userIds },
          dueDate: { gte: rangeStart, lte: rangeEnd },
        },
        _count: { id: true },
      }),
      prisma.task.groupBy({
        by: ['ownerId'],
        where: {
          ownerId: { in: userIds },
          status: 'done',
          updatedAt: { gte: rangeStart, lte: rangeEnd },
        },
        _count: { id: true },
      }),
      prisma.followUp.groupBy({
        by: ['ownerId'],
        where: {
          ownerId: { in: userIds },
          dueDate: { gte: rangeStart, lte: rangeEnd },
        },
        _count: { id: true },
      }),
      prisma.followUp.groupBy({
        by: ['ownerId'],
        where: {
          ownerId: { in: userIds },
          completed: true,
          updatedAt: { gte: rangeStart, lte: rangeEnd },
        },
        _count: { id: true },
      }),
      prisma.meeting.groupBy({
        by: ['ownerId'],
        where: {
          ownerId: { in: userIds },
          createdAt: { gte: rangeStart, lte: rangeEnd },
        },
        _count: { id: true },
      }),
    ]);

    const emailMap              = Object.fromEntries(emailCounts.map((r)              => [r.fromUserId!, r._count.id]));
    const callMap               = Object.fromEntries(callCounts.map((r)               => [r.ownerId!,    r._count.id]));
    const tasksAssignedMap      = Object.fromEntries(tasksAssignedCounts.map((r)      => [r.ownerId!,    r._count.id]));
    const tasksCompletedMap     = Object.fromEntries(tasksCompletedCounts.map((r)     => [r.ownerId!,    r._count.id]));
    const followUpsAssignedMap  = Object.fromEntries(followUpsAssignedCounts.map((r)  => [r.ownerId!,    r._count.id]));
    const followUpsCompletedMap = Object.fromEntries(followUpsCompletedCounts.map((r) => [r.ownerId!,    r._count.id]));
    const meetingsScheduledMap  = Object.fromEntries(meetingsScheduledCounts.map((r)  => [r.ownerId!,    r._count.id]));

    // ── Resolve targets by (agency, role) ──────────────────────────────────
    // One target per unique (subCompanyId, role) combo — all users sharing the same role
    // in the same agency get the same target.
    const agencyRoleKeys = [...new Set(users.map((u) => `${u.subCompanyId}|${u.role}`))];

    const targetEntries = await Promise.all(
      agencyRoleKeys.map(async (key) => {
        const [agencyId, role] = key.split('|');
        const t = await prisma.performanceTarget.findFirst({
          where: { subCompanyId: agencyId, role, effectiveFrom: { lte: targetAsOf } },
          orderBy: { effectiveFrom: 'desc' },
          select: { emailsTarget: true, callsTarget: true, meetingScheduleCountTarget: true },
        });
        return [key, t] as const;
      }),
    );
    const targetByAgencyRole = Object.fromEntries(targetEntries);

    // ── Build response ──────────────────────────────────────────────────────
    function pct(actual: number, target: number): number | null {
      if (target <= 0) return null;
      return Math.round((actual / target) * 100);
    }

    function completionPct(completed: number, assigned: number): number | null {
      if (assigned <= 0) return null;
      return Math.round((completed / assigned) * 100);
    }

    type TargetShape = { emailsTarget: number; callsTarget: number; meetingScheduleCountTarget: number };

    const results = users.map((user) => {
      const target: TargetShape | null = targetByAgencyRole[`${user.subCompanyId}|${user.role}`] ?? null;

      const tasksAssigned     = tasksAssignedMap[user.id]      ?? 0;
      const tasksCompleted    = tasksCompletedMap[user.id]     ?? 0;
      const followUpsAssigned = followUpsAssignedMap[user.id]  ?? 0;
      const followUpsCompleted = followUpsCompletedMap[user.id] ?? 0;

      const actual = {
        emails: emailMap[user.id] ?? 0,
        calls: callMap[user.id] ?? 0,
        tasks: { assigned: tasksAssigned, completed: tasksCompleted },
        followUps: { assigned: followUpsAssigned, completed: followUpsCompleted },
        meetingsScheduled: meetingsScheduledMap[user.id] ?? 0,
      };

      const percentages = {
        emails: pct(actual.emails, target?.emailsTarget ?? 0),
        calls: pct(actual.calls, target?.callsTarget ?? 0),
        tasks: completionPct(tasksCompleted, tasksAssigned),
        followUps: completionPct(followUpsCompleted, followUpsAssigned),
        meetings: target ? pct(actual.meetingsScheduled, target.meetingScheduleCountTarget) : null,
      };

      return {
        userId:           user.id,
        firstName:        user.firstName,
        lastName:         user.lastName,
        email:            user.email,
        role:             user.role,
        subCompanyId:     user.subCompanyId,
        target,
        actual,
        percentages,
        targetConfigured: target !== null,
      };
    });

    return res.json(results);
  },
);

/**
 * Compute conversion rate (1 decimal place).
 * Returns null when activities = 0 (divide-by-zero guard → display "—").
 * Caps at 100 and warns when conversions > activities (data quality flag).
 */
function calcConversionRate(activities: number, conversions: number): number | null {
  if (activities === 0) return null;
  const raw = (conversions / activities) * 100;
  if (raw > 100) {
    console.warn(`[conversion-rate] conversions (${conversions}) > activities (${activities}) — data quality flag`);
    return 100;
  }
  return Math.round(raw * 10) / 10;
}

/**
 * Build a set of "userId|clientId" pairs where the lead flow is associate-driven
 * and assignment/request timing falls in the selected range.
 *
 * Evidence used:
 * - Lead request approved for (requestedById, clientId) with requestedAt in range, OR
 * - Existing lead for (ownerId, clientId) created in range (direct assignment path).
 */
async function buildEligibleAssignedClientKeys(
  userIds: string[],
  agencyIdFilter: string | string[],
  rangeStart: Date,
  rangeEnd: Date,
): Promise<Set<string>> {
  const whereAgency = Array.isArray(agencyIdFilter) ? { in: agencyIdFilter } : agencyIdFilter;
  const [approvedRequests, directAssignments] = await Promise.all([
    prisma.leadRequest.findMany({
      where: {
        requestedById: { in: userIds },
        status: 'approved',
        subCompanyId: whereAgency,
        requestedAt: { gte: rangeStart, lte: rangeEnd },
      },
      select: { requestedById: true, clientId: true },
    }),
    prisma.lead.findMany({
      where: {
        ownerId: { in: userIds },
        subCompanyId: whereAgency,
        createdAt: { gte: rangeStart, lte: rangeEnd },
      },
      select: { ownerId: true, clientId: true },
    }),
  ]);

  const keys = new Set<string>();
  for (const req of approvedRequests) keys.add(`${req.requestedById}|${req.clientId}`);
  for (const lead of directAssignments) keys.add(`${lead.ownerId}|${lead.clientId}`);
  return keys;
}

/**
 * GET /reports/conversion-rates
 *
 * For each sales_associate in scope, returns:
 *   - calls made in period (denominator) + closed_won leads where they had a
 *     call linked to the lead AND that call was within the period AND before
 *     lead.closedAt (numerator)
 *   - same for emails sent
 *   - conversion rates (1 decimal %, null when denominator = 0)
 *
 * Causal rule (Option B): an activity must be (a) linked to the lead via
 * Call.leadId / Email.leadId, (b) owned by this user, (c) timestamped within
 * the selected period, and (d) timestamped before lead.closedAt.
 *
 * Query params: same as /performance (startDate, endDate, userIds, agencyIds)
 */
performanceReportRouter.get(
  '/conversion-rates',
  requirePermission('analytics:read'),
  async (req: Request, res: Response) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    }

    const { startDate, endDate, userIds: userIdsRaw, agencyIds: agencyIdsRaw } = parsed.data;

    const today    = todayStr();
    const startStr = startDate ?? today;
    const endStr   = endDate   ?? startStr;

    const rangeStart = dayStart(startStr);
    const rangeEnd   = dayEnd(endStr);

    // ── Agency scoping ──────────────────────────────────────────────────────
    const allowedIds = await resolveAllowedSubCompanyIds(req.user!);
    const requestedAgencyIds = agencyIdsRaw
      ? agencyIdsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const effectiveAgencyIds =
      requestedAgencyIds.length > 0
        ? requestedAgencyIds.filter((id) => allowedIds.includes(id))
        : allowedIds;
    const agencyIdFilter = effectiveAgencyIds.length === 1
      ? effectiveAgencyIds[0]
      : effectiveAgencyIds;

    // ── User scoping (sales_associate only) ────────────────────────────────
    const requestedUserIds = userIdsRaw
      ? userIdsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    const ctx = await ensureAccessContext(req);
    const isTeamManager = ctx ? canViewTeamData(ctx) && !canAccessMultipleAgencies(ctx) : false;
    const teamFilter = isTeamManager
      ? { reportingManagerIds: { has: req.user!.sub } }
      : {};

    const measuredRoles = await getMeasuredRoleKeys();
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: measuredRoles },
        subCompanyId: Array.isArray(agencyIdFilter) ? { in: agencyIdFilter } : agencyIdFilter,
        ...(requestedUserIds.length ? { id: { in: requestedUserIds } } : {}),
        ...teamFilter,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        subCompanyId: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    if (!users.length) return res.json([]);

    const userIds = users.map((u) => u.id);

    // ── Fetch denominators + causal numerator source in parallel ───────────
    const source = parsed.data.source ?? 'call';
    const dateBasis = parsed.data.dateBasis ?? 'activity';

    // Explicitly keep this endpoint call-only for now. Mail conversions are
    // exposed on the dedicated bulk-mail endpoint/page.
    if (source !== 'call') return res.json([]);

    const [callCounts, wonLeads, eligibleAssignedClientKeys] = await Promise.all([
      // Call denominator: all calls by user in period (any outcome)
      prisma.call.groupBy({
        by: ['ownerId'],
        where: {
          ownerId:   { in: userIds },
          timestamp: { gte: rangeStart, lte: rangeEnd },
        },
        _count: { id: true },
      }),

      // Numerator source: closed_won leads in period that have at least one
      // linked call from a measured user within the period.
      prisma.lead.findMany({
        where: {
          status:      'closed_won',
          closedAt:    { gte: rangeStart, lte: rangeEnd },
          subCompanyId: Array.isArray(agencyIdFilter) ? { in: agencyIdFilter } : agencyIdFilter,
          calls: { some: { ownerId: { in: userIds }, timestamp: { gte: rangeStart } } },
        },
        select: {
          id: true,
          clientId: true,
          closedAt: true,
          calls: {
            where: { ownerId: { in: userIds }, timestamp: { gte: rangeStart } },
            select: { ownerId: true, timestamp: true },
          },
        },
      }),
      dateBasis === 'assigned'
        ? buildEligibleAssignedClientKeys(userIds, agencyIdFilter, rangeStart, rangeEnd)
        : Promise.resolve(new Set<string>()),
    ]);

    // Index denominators by userId
    const callCountMap = Object.fromEntries(callCounts.map((r) => [r.ownerId!, r._count.id]));

    // Build per-user conversion sets: userId → distinct lead IDs where causal
    // condition is met (activity timestamp < lead.closedAt).
    const callConvMap: Record<string, Set<string>> = {};

    for (const lead of wonLeads) {
      const closeMs = lead.closedAt!.getTime();

      for (const call of lead.calls) {
        if (new Date(call.timestamp).getTime() < closeMs) {
          if (
            dateBasis === 'assigned' &&
            !eligibleAssignedClientKeys.has(`${call.ownerId}|${lead.clientId}`)
          ) {
            continue;
          }
          (callConvMap[call.ownerId] ??= new Set()).add(lead.id);
        }
      }
    }

    // ── Build response ──────────────────────────────────────────────────────
    const results = users.map((user) => {
      const callCount = callCountMap[user.id] ?? 0;
      const callConvs = callConvMap[user.id]?.size ?? 0;

      return {
        userId:       user.id,
        firstName:    user.firstName,
        lastName:     user.lastName,
        email:        user.email,
        role:         user.role,
        subCompanyId: user.subCompanyId,
        calls: { count: callCount, conversions: callConvs, rate: calcConversionRate(callCount, callConvs) },
      };
    });

    return res.json(results);
  },
);

/**
 * GET /reports/my-conversion-rate
 * Returns the caller's own conversion rate for a date range.
 * Accessible to any authenticated user (no elevated role required).
 *
 * Query params:
 *   startDate  YYYY-MM-DD  (default: today UTC)
 *   endDate    YYYY-MM-DD  (default: startDate)
 */
performanceReportRouter.get(
  '/my-conversion-rate',
  async (req: Request, res: Response) => {
    const userId      = req.user?.sub;
    const subCompanyId = req.user?.subCompanyId;
    if (!userId || !subCompanyId) {
      return res.status(403).json({ error: 'Auth context required' });
    }

    const dateSchema = z.object({
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      endDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      source: z.enum(['call', 'mail']).optional(),
      dateBasis: z.enum(['activity', 'assigned']).optional(),
    });
    const parsed = dateSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });

    const today    = todayStr();
    const startStr = parsed.data.startDate ?? today;
    const endStr   = parsed.data.endDate   ?? startStr;
    const rangeStart = dayStart(startStr);
    const rangeEnd   = dayEnd(endStr);

    const source = parsed.data.source ?? 'call';
    const dateBasis = parsed.data.dateBasis ?? 'activity';
    if (source !== 'call') {
      return res.json({ calls: { count: 0, conversions: 0, rate: null } });
    }

    const [callCount, wonLeads, eligibleAssignedClientKeys] = await Promise.all([
      prisma.call.count({
        where: { ownerId: userId, timestamp: { gte: rangeStart, lte: rangeEnd } },
      }),
      prisma.lead.findMany({
        where: {
          status:   'closed_won',
          closedAt: { gte: rangeStart, lte: rangeEnd },
          calls: { some: { ownerId: userId, timestamp: { gte: rangeStart } } },
        },
        select: {
          id: true,
          clientId: true,
          closedAt: true,
          calls: { where: { ownerId: userId, timestamp: { gte: rangeStart } }, select: { timestamp: true } },
        },
      }),
      dateBasis === 'assigned'
        ? buildEligibleAssignedClientKeys([userId], subCompanyId, rangeStart, rangeEnd)
        : Promise.resolve(new Set<string>()),
    ]);

    let callConvs = 0;
    for (const lead of wonLeads) {
      if (dateBasis === 'assigned' && !eligibleAssignedClientKeys.has(`${userId}|${lead.clientId}`)) continue;
      const closeMs = lead.closedAt!.getTime();
      if (lead.calls.some((c) => new Date(c.timestamp).getTime() < closeMs)) callConvs++;
    }

    return res.json({
      calls: { count: callCount, conversions: callConvs, rate: calcConversionRate(callCount, callConvs) },
    });
  },
);

/**
 * GET /reports/bulk-email-conversion-rate
 *
 * Agency-level bulk email conversion rate.
 * Bulk emails (EmailCampaign) have no per-user ownership — they are scoped
 * to an agency (subCompanyId), so this metric is only meaningful at the
 * agency level.
 *
 * Denominator: EmailCampaignRecipient rows with status in (sent, delivered,
 *   opened, clicked) for campaigns sent within the period.
 *
 * Numerator (dateBasis='assigned', what the dashboard card uses):
 *   distinct clients who were assigned to a measured own-scope role during the
 *   period (via approved LeadRequest or direct Lead creation) AND who
 *   received a qualifying recipient row strictly BEFORE that assignment.
 *   Lead-won status is NOT required — assignment after a bulk email is
 *   treated as the conversion event.
 *
 * Numerator (dateBasis='activity', legacy):
 *   closed_won leads in the period whose client received at least one
 *   qualifying recipient row before lead.closedAt.
 *
 * Scope:
 *   - Caller with agency access (any authenticated user): restricted to
 *     their own subCompanyId unless elevated + agencyId query param given.
 *
 * Query params:
 *   startDate  YYYY-MM-DD  (default: today UTC)
 *   endDate    YYYY-MM-DD  (default: startDate)
 *   agencyId   UUID        (optional; elevated roles only)
 */
performanceReportRouter.get(
  '/bulk-email-conversion-rate',
  async (req: Request, res: Response) => {
    const callerSubCompanyId = req.user?.subCompanyId;
    if (!req.user || !callerSubCompanyId) {
      return res.status(403).json({ error: 'Auth context required' });
    }

    const schema = z.object({
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      endDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      agencyId:  z.string().uuid().optional(),
      source: z.enum(['call', 'mail']).optional(),
      dateBasis: z.enum(['activity', 'assigned']).optional(),
    });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });

    const today    = todayStr();
    const startStr = parsed.data.startDate ?? today;
    const endStr   = parsed.data.endDate   ?? startStr;
    const rangeStart = dayStart(startStr);
    const rangeEnd   = dayEnd(endStr);

    // Resolve target agency: default to caller's agency; elevated roles may
    // pass ?agencyId= to view a different agency they have access to.
    const ctx = await ensureAccessContext(req);
    const canPickAgency = ctx ? canAccessMultipleAgencies(ctx) : false;
    let targetAgencyId = callerSubCompanyId;
    if (parsed.data.agencyId && canPickAgency) {
      const allowed = await resolveAllowedSubCompanyIds(req.user);
      if (!allowed.includes(parsed.data.agencyId)) {
        return res.status(403).json({ error: 'Not allowed for this agency' });
      }
      targetAgencyId = parsed.data.agencyId;
    }

    const source = parsed.data.source ?? 'mail';
    const dateBasis = parsed.data.dateBasis ?? 'activity';
    if (source !== 'mail') {
      return res.json({ count: 0, conversions: 0, rate: null });
    }

    const SENT_STATUSES = ['sent', 'delivered', 'opened', 'clicked'] as const;

    // Denominator: recipient rows from this agency's campaigns sent in period
    const denominator = await prisma.emailCampaignRecipient.count({
      where: {
        status:   { in: [...SENT_STATUSES] },
        sentAt:   { gte: rangeStart, lte: rangeEnd },
        campaign: { subCompanyId: targetAgencyId },
      },
    });

    let conversions = 0;

    if (dateBasis === 'assigned') {
      // Numerator: clients assigned to a measured own-scope role within the period
      // (via approved LeadRequest or direct Lead creation) where a
      // qualifying bulk-email recipient row exists strictly BEFORE the
      // earliest assignment. Each unique client counts at most once.
      const measuredRoles = await getMeasuredRoleKeys();
      const associates = await prisma.user.findMany({
        where: { subCompanyId: targetAgencyId, role: { in: measuredRoles }, isActive: true },
        select: { id: true },
      });
      const associateIds = associates.map((u) => u.id);

      if (associateIds.length > 0) {
        const [approvedRequests, directLeads] = await Promise.all([
          prisma.leadRequest.findMany({
            where: {
              requestedById: { in: associateIds },
              status: 'approved',
              subCompanyId: targetAgencyId,
              requestedAt: { gte: rangeStart, lte: rangeEnd },
            },
            select: { clientId: true, requestedAt: true },
          }),
          prisma.lead.findMany({
            where: {
              ownerId: { in: associateIds },
              subCompanyId: targetAgencyId,
              createdAt: { gte: rangeStart, lte: rangeEnd },
            },
            select: { clientId: true, createdAt: true },
          }),
        ]);

        // Earliest assignment time per client — comparing email sends to
        // this guarantees the email truly preceded any assignment.
        const earliestAssignmentByClient = new Map<string, number>();
        for (const r of approvedRequests) {
          const t = r.requestedAt.getTime();
          const cur = earliestAssignmentByClient.get(r.clientId);
          if (cur === undefined || t < cur) earliestAssignmentByClient.set(r.clientId, t);
        }
        for (const l of directLeads) {
          const t = l.createdAt.getTime();
          const cur = earliestAssignmentByClient.get(l.clientId);
          if (cur === undefined || t < cur) earliestAssignmentByClient.set(l.clientId, t);
        }

        if (earliestAssignmentByClient.size > 0) {
          const clientIds = Array.from(earliestAssignmentByClient.keys());
          const matches = await prisma.emailCampaignRecipient.findMany({
            where: {
              clientId: { in: clientIds },
              status:   { in: [...SENT_STATUSES] },
              campaign: { subCompanyId: targetAgencyId },
              sentAt:   { not: null },
            },
            select: { clientId: true, sentAt: true },
          });
          const sentByClient: Record<string, number[]> = {};
          for (const m of matches) {
            if (!m.sentAt) continue;
            (sentByClient[m.clientId] ??= []).push(m.sentAt.getTime());
          }
          for (const [clientId, assignedAt] of earliestAssignmentByClient) {
            const sends = sentByClient[clientId];
            if (sends && sends.some((t) => t < assignedAt)) conversions++;
          }
        }
      }
    } else {
      // Legacy 'activity' basis: closed_won leads in period with an email
      // sent strictly before lead.closedAt.
      const wonLeads = await prisma.lead.findMany({
        where: {
          status:       'closed_won',
          closedAt:     { gte: rangeStart, lte: rangeEnd },
          subCompanyId: targetAgencyId,
        },
        select: { id: true, closedAt: true, clientId: true },
      });

      if (wonLeads.length > 0) {
        const clientIds = Array.from(new Set(wonLeads.map((l) => l.clientId)));
        const matches = await prisma.emailCampaignRecipient.findMany({
          where: {
            clientId: { in: clientIds },
            status:   { in: [...SENT_STATUSES] },
            campaign: { subCompanyId: targetAgencyId },
            sentAt:   { not: null },
          },
          select: { clientId: true, sentAt: true },
        });
        const sentByClient: Record<string, number[]> = {};
        for (const m of matches) {
          if (!m.sentAt) continue;
          (sentByClient[m.clientId] ??= []).push(m.sentAt.getTime());
        }
        for (const lead of wonLeads) {
          const closeMs = lead.closedAt!.getTime();
          const sends = sentByClient[lead.clientId];
          if (sends && sends.some((t) => t < closeMs)) conversions++;
        }
      }
    }

    return res.json({
      count: denominator,
      conversions,
      rate: calcConversionRate(denominator, conversions),
    });
  },
);

/**
 * GET /reports/my-performance
 * Returns the caller's own actuals vs their role's target for a date range.
 * Accessible to any authenticated user (no elevated role required).
 *
 * Query params:
 *   startDate  YYYY-MM-DD  (default: today UTC)
 *   endDate    YYYY-MM-DD  (default: startDate)
 */
performanceReportRouter.get(
  '/my-performance',
  async (req: Request, res: Response) => {
    const userId      = req.user?.sub;
    const subCompanyId = req.user?.subCompanyId;
    const role        = req.user?.role;
    if (!userId || !subCompanyId || !role) {
      return res.status(403).json({ error: 'Auth context required' });
    }

    const dateSchema = z.object({
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      endDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    });
    const parsed = dateSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });

    const today    = todayStr();
    const startStr = parsed.data.startDate ?? today;
    const endStr   = parsed.data.endDate   ?? startStr;

    const rangeStart = dayStart(startStr);
    const rangeEnd   = dayEnd(endStr);
    const targetAsOf = dayStart(startStr);

    const [
      emailCount,
      callCount,
      tasksAssigned,
      tasksCompleted,
      followUpsAssigned,
      followUpsCompleted,
      meetingsScheduled,
    ] = await Promise.all([
      prisma.email.count({ where: { fromUserId: userId, folder: 'sent', timestamp: { gte: rangeStart, lte: rangeEnd } } }),
      prisma.call.count({ where: { ownerId: userId, createdAt: { gte: rangeStart, lte: rangeEnd } } }),
      prisma.task.count({ where: { ownerId: userId, dueDate: { gte: rangeStart, lte: rangeEnd } } }),
      prisma.task.count({ where: { ownerId: userId, status: 'done', updatedAt: { gte: rangeStart, lte: rangeEnd } } }),
      prisma.followUp.count({ where: { ownerId: userId, dueDate: { gte: rangeStart, lte: rangeEnd } } }),
      prisma.followUp.count({ where: { ownerId: userId, completed: true, updatedAt: { gte: rangeStart, lte: rangeEnd } } }),
      prisma.meeting.count({ where: { ownerId: userId, createdAt: { gte: rangeStart, lte: rangeEnd } } }),
    ]);

    const target = await prisma.performanceTarget.findFirst({
      where: { subCompanyId, role, effectiveFrom: { lte: targetAsOf } },
      orderBy: { effectiveFrom: 'desc' },
      select: { emailsTarget: true, callsTarget: true, meetingScheduleCountTarget: true },
    });

    const actual = {
      emails: emailCount,
      calls: callCount,
      tasks: { assigned: tasksAssigned, completed: tasksCompleted },
      followUps: { assigned: followUpsAssigned, completed: followUpsCompleted },
      meetingsScheduled,
    };

    function pct(a: number, t: number) { return t > 0 ? Math.round((a / t) * 100) : null; }
    function completionPct(c: number, a: number) { return a > 0 ? Math.round((c / a) * 100) : null; }

    const percentages = {
      emails: pct(actual.emails, target?.emailsTarget ?? 0),
      calls: pct(actual.calls, target?.callsTarget ?? 0),
      tasks: completionPct(tasksCompleted, tasksAssigned),
      followUps: completionPct(followUpsCompleted, followUpsAssigned),
      meetings: target ? pct(meetingsScheduled, target.meetingScheduleCountTarget) : null,
    };

    return res.json({ target: target ?? null, actual, percentages, targetConfigured: target !== null });
  },
);

const positionsQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  agencyIds: z.string().optional(),
});

/**
 * GET /reports/user-positions
 *
 * Returns a map of userId → total positions closed (sum of ProposalPosition.count)
 * for Closed Won leads in the given date range.
 *
 * Accessible to any authenticated user:
 *   - Elevated roles see all users in their managed agencies.
 *   - Any other user sees only their own entry.
 *
 * Query params: startDate (YYYY-MM-DD), endDate (YYYY-MM-DD), agencyIds (comma-separated)
 */
performanceReportRouter.get(
  '/user-positions',
  async (req: Request, res: Response) => {
    if (!req.user?.sub || !req.user?.subCompanyId) {
      return res.status(403).json({ error: 'Auth context required' });
    }

    const parsed = positionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    }

    const { startDate, endDate, agencyIds: agencyIdsRaw } = parsed.data;

    const today    = todayStr();
    const startStr = startDate ?? today;
    const endStr   = endDate   ?? startStr;
    const from = dayStart(startStr);
    const to   = dayEnd(endStr);

    const ctx = await ensureAccessContext(req);
    const isElevated = ctx ? canAccessMultipleAgencies(ctx) : false;

    let subCompanyIds: string[];
    if (isElevated) {
      const allowedIds = await resolveAllowedSubCompanyIds(req.user);
      const requested = agencyIdsRaw
        ? agencyIdsRaw.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
      subCompanyIds = requested.length > 0
        ? requested.filter((id) => allowedIds.includes(id))
        : allowedIds;
    } else {
      subCompanyIds = [req.user.subCompanyId];
    }

    const bulk = await getPositionsClosedByUserBulk({ subCompanyIds, from, to });

    if (!isElevated) {
      const own = bulk[req.user.sub] ?? 0;
      return res.json({ [req.user.sub]: own });
    }

    return res.json(bulk);
  },
);
