/**
 * Unified daily activity aggregation across CRM modules.
 */
import prisma from '../config/database';
import type { JwtPayload } from '../middleware/auth';
import type { Permission } from '../config/permissions';
import {
  buildSubCompanyFilter,
  resolveAllowedSubCompanyIds,
} from '../config/agencyScope';
import {
  buildAccessContext,
  canAccessMultipleAgencies,
  canViewTeamData,
  getUserRoleEnumKeysForScopeLevels,
  hasAnyPermission,
  hasPermission,
  getUserIdsForRoleKeyInAgency,
  type AccessContext,
} from './accessContext';
import type { DataScopeLevel } from '@prisma/client';
import type { DayBounds } from './dailyActivityDates';
import { computeDaysOverdue, resolveDayBoundsForAgencies } from './dailyActivityDates';
import {
  buildReportingTree,
  filterVisibleUserIds,
  formatUserName,
  getVisibleUserIds,
  resolveEffectiveAgencyIds,
  type TeamTreeNode,
} from './teamScope';
import { resolveDailyActivityAgendaUserIds } from './dailyActivityScope';
import { getUserRoleTitleSync } from './rbac';
import { buildApprovalStatusMeta, includeRequesterPendingStatus, isDirectorApprovalRole } from './dailyActivityApprovalMeta';

export type DailyActivityKind =
  | 'task'
  | 'meeting'
  | 'follow_up'
  | 'lead'
  | 'proposal'
  | 'call'
  | 'email'
  | 'note'
  | 'lead_request'
  | 'client_submission'
  | 'client_edit'
  | 'notification'
  | 'reminder'
  | 'resource_request'
  | 'lead_extension'
  | 'proposal_extension'
  | 'employee';

export type DailyActivityStatus =
  | 'today'
  | 'pending'
  | 'overdue'
  | 'completed_today'
  | 'awaiting_approval';

export type ActivityFilter =
  | 'today'
  | 'action_today'
  | 'pending'
  | 'overdue'
  | 'completed_today'
  | 'awaiting_approval'
  | 'all';

export type QuickAction = 'complete' | 'snooze' | 'approve' | 'reject' | 'open' | 'call' | 'email';

export interface DailyActivityItem {
  id: string;
  kind: DailyActivityKind;
  title: string;
  subtitle?: string;
  ownerId: string;
  ownerName: string;
  status: DailyActivityStatus;
  dueAt?: string;
  occurredAt?: string;
  entityId: string;
  link: string;
  quickActions?: QuickAction[];
  meta?: Record<string, unknown>;
  /** Set when status is overdue — calendar days past due in agency timezone */
  daysOverdue?: number;
}

export interface DailyActivityCounters {
  total: number;
  today: number;
  pending: number;
  overdue: number;
  awaiting_approval: number;
  completed_today: number;
  /** Exact count of action_today feed items for this user (matches agenda) */
  action_today: number;
  byKind: Partial<Record<DailyActivityKind, number>>;
}

/** Matches action_today filter — must match agenda list exactly */
export function countActionToday(c: DailyActivityCounters): number {
  return Math.max(0, c.action_today ?? 0);
}

const KIND_PERMISSIONS: Partial<Record<DailyActivityKind, Permission[]>> = {
  task: ['tasks:read'],
  meeting: ['meetings:read'],
  follow_up: ['leads:read'],
  lead: ['leads:read'],
  proposal: ['leads:read'],
  call: ['calls:read'],
  email: ['calls:read'],
  note: ['clients:read'],
  lead_request: ['leads:read'],
  client_submission: ['clients:read'],
  client_edit: ['clients:read'],
  notification: [],
  reminder: ['tasks:read'],
  resource_request: ['settings:read'],
  lead_extension: ['leads:read'],
  proposal_extension: ['leads:read'],
  employee: ['employees:read'],
};

const AGENDA_ACTIONABLE_KINDS: ReadonlySet<DailyActivityKind> = new Set([
  'task',
  'meeting',
  'follow_up',
  'lead',
  'proposal',
  'lead_request',
  'client_submission',
  'client_edit',
  'resource_request',
  'lead_extension',
  'proposal_extension',
  'employee',
]);

/** Gate kinds by the viewer's effective RBAC permissions (DB), not the static role map. */
function hasModulePermission(access: AccessContext, kind: DailyActivityKind): boolean {
  const required = KIND_PERMISSIONS[kind];
  if (!required || required.length === 0) return true;
  return hasAnyPermission(access, required);
}

function emptyCounters(): DailyActivityCounters {
  return {
    total: 0,
    today: 0,
    pending: 0,
    overdue: 0,
    awaiting_approval: 0,
    completed_today: 0,
    action_today: 0,
    byKind: {},
  };
}

function bumpCounter(c: DailyActivityCounters, status: DailyActivityStatus, kind: DailyActivityKind): void {
  c.total += 1;
  if (status === 'today') c.today += 1;
  if (status === 'pending') c.pending += 1;
  if (status === 'awaiting_approval') c.awaiting_approval += 1;
  if (status === 'overdue') c.overdue += 1;
  if (status === 'completed_today') c.completed_today += 1;
  c.byKind[kind] = (c.byKind[kind] ?? 0) + 1;
}

type CounterFields = Pick<
  DailyActivityCounters,
  'total' | 'today' | 'pending' | 'overdue' | 'awaiting_approval' | 'completed_today'
>;

function sumCounterFields(a: CounterFields, b: CounterFields): void {
  a.total += b.total ?? 0;
  a.today += b.today ?? 0;
  a.pending += b.pending ?? 0;
  a.overdue += b.overdue ?? 0;
  a.awaiting_approval += b.awaiting_approval ?? 0;
  a.completed_today += b.completed_today ?? 0;
}

function toTreeCounters(c: DailyActivityCounters): TeamTreeNode['counters'] {
  return {
    total: c.total,
    today: c.today,
    pending: c.pending,
    overdue: c.overdue,
    awaiting_approval: c.awaiting_approval,
    completed_today: c.completed_today,
    action_today: c.action_today,
  };
}

function cloneCounters(c: DailyActivityCounters): DailyActivityCounters {
  return {
    total: c.total,
    today: c.today,
    pending: c.pending,
    overdue: c.overdue,
    awaiting_approval: c.awaiting_approval,
    completed_today: c.completed_today,
    action_today: c.action_today,
    byKind: { ...c.byKind },
  };
}

function buildActionTodayByUser(items: DailyActivityItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    if (!matchesFilter(item.status, 'action_today')) continue;
    map.set(item.ownerId, (map.get(item.ownerId) ?? 0) + 1);
  }
  return map;
}

/** Matches completed_today filter — same source as Done agenda list */
function buildCompletedTodayByUser(items: DailyActivityItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    if (item.status !== 'completed_today') continue;
    map.set(item.ownerId, (map.get(item.ownerId) ?? 0) + 1);
  }
  return map;
}

async function loadApproverIdsFromAgency(subCompanyScope: SubCompanyScope): Promise<{
  managerIds: Set<string>;
  directorIds: Set<string>;
  settingsApproverIds: Set<string>;
}> {
  const rows = await prisma.user.findMany({
    where: { ...subCompanyScope, isActive: true },
    select: { id: true, role: true },
  });
  const teamRoleKeys = new Set(await getUserRoleEnumKeysForScopeLevels(['team']));
  const elevatedRoleKeys = new Set(await getUserRoleEnumKeysForScopeLevels(['agency', 'global']));
  const managerIds = new Set<string>();
  const directorIds = new Set<string>();
  const settingsApproverIds = new Set<string>();
  for (const u of rows) {
    if (teamRoleKeys.has(u.role) || u.role === 'operations_manager') managerIds.add(u.id);
    if (elevatedRoleKeys.has(u.role)) directorIds.add(u.id);
    if (elevatedRoleKeys.has(u.role)) settingsApproverIds.add(u.id);
  }
  return { managerIds, directorIds, settingsApproverIds };
}

function isReviewRejectedAfterRequest(
  reviewRequestedAt: Date | null | undefined,
  reviewRejectedAt: Date | null | undefined,
): boolean {
  if (!reviewRequestedAt || !reviewRejectedAt) return false;
  return reviewRejectedAt.getTime() >= reviewRequestedAt.getTime();
}

/** Still needs manager action (initial approve or document review before activation). */
function proposalNeedsManagerAction(p: {
  status: string;
  isForReview: boolean;
  reviewRequestedAt: Date | null;
  reviewRejectedAt: Date | null;
  activatedAt: Date | null;
}): boolean {
  if (p.status === 'pending') return true;
  if (p.status !== 'approved' || p.isForReview) return false;
  if (!p.reviewRequestedAt) return false;
  if (isReviewRejectedAfterRequest(p.reviewRequestedAt, p.reviewRejectedAt)) return false;
  if (p.activatedAt) return false;
  return true;
}

function pickApproverInScope(
  approverId: string | null,
  audienceUserIds: Set<string>,
): string | null {
  if (!approverId || !audienceUserIds.has(approverId)) return null;
  return approverId;
}

function pickFirstInScope(ids: Set<string>, audienceUserIds: Set<string>): string | null {
  for (const id of ids) {
    if (audienceUserIds.has(id)) return id;
  }
  return null;
}

function dedupeActivityItems(items: DailyActivityItem[]): DailyActivityItem[] {
  const seen = new Set<string>();
  const taskEntitySeen = new Set<string>();
  const leadIdsWithFollowUp = new Set<string>();
  const out: DailyActivityItem[] = [];

  for (const item of items) {
    if (item.kind === 'follow_up' && item.meta?.leadId) {
      leadIdsWithFollowUp.add(String(item.meta.leadId));
    }
  }

  for (const item of items) {
    if (seen.has(item.id)) continue;

    if (item.kind === 'reminder' && item.id.startsWith('reminder:task:')) {
      const taskId = item.entityId;
      if (taskEntitySeen.has(taskId)) continue;
      taskEntitySeen.add(taskId);
    }
    if (item.kind === 'task') {
      taskEntitySeen.add(item.entityId);
    }
    if (item.kind === 'lead' && leadIdsWithFollowUp.has(item.entityId)) {
      continue;
    }

    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function resolveManagerApproverId(
  reportingManagerIds: string[],
  managerIds: Set<string>,
  userIds: string[],
): string | null {
  const fromReporting = reportingManagerIds.find((id) => managerIds.has(id));
  if (fromReporting) return fromReporting;
  const firstManager = userIds.find((id) => managerIds.has(id));
  return firstManager ?? null;
}

function resolveDirectorApproverId(directorIds: Set<string>, userIds: string[]): string | null {
  return userIds.find((id) => directorIds.has(id)) ?? null;
}

function classifyDueItem(
  dueAt: Date,
  completed: boolean,
  bounds: DayBounds,
  now: Date,
): DailyActivityStatus | null {
  if (completed) {
    return null;
  }
  if (dueAt >= bounds.startUTC && dueAt < bounds.endUTC) return 'today';
  if (dueAt < now) return 'overdue';
  return 'pending';
}

function withOverdueDays(items: DailyActivityItem[], bounds: DayBounds): DailyActivityItem[] {
  return items.map((item) => {
    if (item.status !== 'overdue' || !item.dueAt) return item;
    return {
      ...item,
      daysOverdue: computeDaysOverdue(new Date(item.dueAt), bounds),
    };
  });
}

function matchesFilter(status: DailyActivityStatus, filter: ActivityFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'action_today') {
    return status === 'today' || status === 'overdue' || status === 'awaiting_approval';
  }
  if (filter === 'pending') {
    return status === 'pending' || status === 'awaiting_approval';
  }
  if (filter === 'awaiting_approval') {
    return status === 'awaiting_approval';
  }
  return status === filter;
}

/** Completion must have a timestamp and fall inside agency "today". */
function completedWithinToday(doneAt: Date | null | undefined, bounds: DayBounds): boolean {
  if (!doneAt) return false;
  return doneAt >= bounds.startUTC && doneAt < bounds.endUTC;
}

function mergeUserNames(
  users: { id: string; firstName: string; lastName: string }[],
): Map<string, string> {
  return new Map(users.map((u) => [u.id, formatUserName(u.firstName, u.lastName)]));
}

async function loadUserNames(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, firstName: true, lastName: true },
  });
  return mergeUserNames(rows);
}

type SubCompanyScope =
  | { subCompanyId: string }
  | { subCompanyId: { in: string[] } };

async function resolveViewerSubCompanyScope(
  viewer: JwtPayload,
  requestedAgencyIds: string[] = [],
): Promise<SubCompanyScope> {
  const allowedIds = await resolveAllowedSubCompanyIds(viewer);
  const effectiveIds = await resolveEffectiveAgencyIds(viewer, requestedAgencyIds);
  return buildSubCompanyFilter(allowedIds, effectiveIds);
}

async function resolveDayBounds(
  viewer: JwtPayload,
  requestedAgencyIds: string[] = [],
) {
  const effectiveIds = await resolveEffectiveAgencyIds(viewer, requestedAgencyIds);
  return resolveDayBoundsForAgencies(effectiveIds, viewer.subCompanyId!);
}

interface CollectContext {
  subCompanyScope: SubCompanyScope;
  userIds: string[];
  bounds: DayBounds;
  now: Date;
  viewerRole: string;
  viewerScopeLevel: DataScopeLevel;
  viewerAccess: AccessContext;
  nameById: Map<string, string>;
  teamRoleKeys: Set<string>;
  filter: ActivityFilter;
  kinds?: DailyActivityKind[];
}

async function buildCollectContextBase(
  viewer: JwtPayload,
  subCompanyScope: SubCompanyScope,
  userIds: string[],
  bounds: DayBounds,
  nameById: Map<string, string>,
  extra: Omit<CollectContext, 'subCompanyScope' | 'userIds' | 'bounds' | 'now' | 'viewerRole' | 'viewerScopeLevel' | 'viewerAccess' | 'nameById' | 'teamRoleKeys'>,
): Promise<CollectContext> {
  const viewerAccess = await buildAccessContext(viewer);
  const teamRoleKeys = new Set(await getUserRoleEnumKeysForScopeLevels(['team']));
  return {
    subCompanyScope,
    userIds,
    bounds,
    now: new Date(),
    viewerRole: viewer.role,
    viewerScopeLevel: viewerAccess.scopeLevel,
    viewerAccess,
    nameById,
    teamRoleKeys,
    ...extra,
  };
}

function kindAllowed(ctx: CollectContext, kind: DailyActivityKind): boolean {
  if (!AGENDA_ACTIONABLE_KINDS.has(kind)) return false;
  if (!hasModulePermission(ctx.viewerAccess, kind)) return false;
  if (ctx.kinds && ctx.kinds.length > 0 && !ctx.kinds.includes(kind)) return false;
  return true;
}

async function collectAllItems(ctx: CollectContext): Promise<DailyActivityItem[]> {
  const items: DailyActivityItem[] = [];
  const { subCompanyScope, userIds, bounds, now } = ctx;
  if (userIds.length === 0) return items;

  const ownerIn = { in: userIds };
  const audienceUserIds = new Set(userIds);
  const { managerIds, directorIds, settingsApproverIds } =
    await loadApproverIdsFromAgency(subCompanyScope);

  if (kindAllowed(ctx, 'task')) {
    const tasks = await prisma.task.findMany({
      where: { ...subCompanyScope, ownerId: ownerIn },
      select: {
        id: true,
        title: true,
        dueDate: true,
        status: true,
        ownerId: true,
        updatedAt: true,
        completedAt: true,
        reminderDate: true,
        reminderEnabled: true,
      },
      take: 500,
    });
    for (const t of tasks) {
      const ownerName = ctx.nameById.get(t.ownerId) ?? 'Unknown';
      if (t.status === 'done') {
        if (!completedWithinToday(t.completedAt, bounds)) {
          continue;
        }
        const doneAt = t.completedAt!;
        const st: DailyActivityStatus = 'completed_today';
        if (matchesFilter(st, ctx.filter)) {
          items.push({
            id: `task:${t.id}`,
            kind: 'task',
            title: t.title,
            ownerId: t.ownerId,
            ownerName,
            status: st,
            occurredAt: doneAt.toISOString(),
            dueAt: t.dueDate.toISOString(),
            entityId: t.id,
            link: '/tasks',
            quickActions: ['open'],
          });
        }
        continue;
      }
      const st = classifyDueItem(t.dueDate, false, bounds, now);
      if (st && matchesFilter(st, ctx.filter)) {
        items.push({
          id: `task:${t.id}`,
          kind: 'task',
          title: t.title,
          ownerId: t.ownerId,
          ownerName,
          status: st,
          dueAt: t.dueDate.toISOString(),
          entityId: t.id,
          link: '/tasks',
          quickActions: ['open'],
        });
      }
      if (
        t.reminderEnabled &&
        t.reminderDate &&
        t.reminderDate >= bounds.startUTC &&
        t.reminderDate < bounds.endUTC &&
        kindAllowed(ctx, 'reminder')
      ) {
        const st: DailyActivityStatus = 'today';
        if (matchesFilter(st, ctx.filter)) {
          items.push({
            id: `reminder:task:${t.id}`,
            kind: 'reminder',
            title: `Reminder: ${t.title}`,
            ownerId: t.ownerId,
            ownerName,
            status: st,
            dueAt: t.reminderDate.toISOString(),
            entityId: t.id,
            link: '/tasks',
            quickActions: ['open'],
          });
        }
      }
    }
  }

  if (kindAllowed(ctx, 'follow_up')) {
    const followUps = await prisma.followUp.findMany({
      where: { ...subCompanyScope, ownerId: ownerIn },
      select: {
        id: true,
        leadId: true,
        notes: true,
        dueDate: true,
        completed: true,
        ownerId: true,
        updatedAt: true,
        completedAt: true,
        client: { select: { name: true } },
      },
      take: 500,
    });
    for (const f of followUps) {
      const ownerName = ctx.nameById.get(f.ownerId) ?? 'Unknown';
      const title = f.notes?.slice(0, 80) || f.client.name || 'Follow-up';
      if (f.completed) {
        if (!completedWithinToday(f.completedAt, bounds)) {
          continue;
        }
        const doneAt = f.completedAt!;
        const st: DailyActivityStatus = 'completed_today';
        if (matchesFilter(st, ctx.filter)) {
          items.push({
            id: `follow_up:${f.id}`,
            kind: 'follow_up',
            title,
            subtitle: f.client.name,
            ownerId: f.ownerId,
            ownerName,
            status: st,
            occurredAt: doneAt.toISOString(),
            entityId: f.id,
            link: '/follow-ups',
            quickActions: ['open'],
            meta: f.leadId ? { leadId: f.leadId } : undefined,
          });
        }
        continue;
      }
      const st = classifyDueItem(f.dueDate, false, bounds, now);
      if (st && matchesFilter(st, ctx.filter)) {
        items.push({
          id: `follow_up:${f.id}`,
          kind: 'follow_up',
          title,
          subtitle: f.client.name,
          ownerId: f.ownerId,
          ownerName,
          status: st,
          dueAt: f.dueDate.toISOString(),
          entityId: f.id,
          link: '/follow-ups',
          quickActions: ['open'],
          meta: f.leadId ? { leadId: f.leadId } : undefined,
        });
      }
    }
  }

  if (kindAllowed(ctx, 'meeting')) {
    const meetings = await prisma.meeting.findMany({
      where: { ...subCompanyScope, ownerId: ownerIn },
      select: {
        id: true,
        title: true,
        startTime: true,
        endTime: true,
        status: true,
        ownerId: true,
        updatedAt: true,
        client: { select: { name: true } },
      },
      take: 500,
    });
    for (const m of meetings) {
      const ownerName = ctx.nameById.get(m.ownerId) ?? 'Unknown';
      if (m.status === 'completed') {
        const doneAt = m.endTime <= now ? m.endTime : m.updatedAt;
        if (!completedWithinToday(doneAt, bounds)) {
          continue;
        }
        const st: DailyActivityStatus = 'completed_today';
        if (matchesFilter(st, ctx.filter)) {
          items.push({
            id: `meeting:${m.id}`,
            kind: 'meeting',
            title: m.title,
            subtitle: m.client.name,
            ownerId: m.ownerId,
            ownerName,
            status: st,
            occurredAt: doneAt.toISOString(),
            entityId: m.id,
            link: '/meetings',
            quickActions: ['open'],
          });
        }
        continue;
      }
      let st: DailyActivityStatus | null = null;
      if (m.startTime >= bounds.startUTC && m.startTime < bounds.endUTC) {
        st = 'today';
      } else if (m.status === 'scheduled' && m.startTime < now) {
        st = 'overdue';
      } else if (m.status === 'scheduled' && m.startTime >= now) {
        st = 'pending';
      }
      if (st && matchesFilter(st, ctx.filter)) {
        items.push({
          id: `meeting:${m.id}`,
          kind: 'meeting',
          title: m.title,
          subtitle: m.client.name,
          ownerId: m.ownerId,
          ownerName,
          status: st,
          dueAt: m.startTime.toISOString(),
          entityId: m.id,
          link: '/meetings',
          quickActions: ['open'],
        });
      }
    }
  }

  if (kindAllowed(ctx, 'lead')) {
    const leads = await prisma.lead.findMany({
      where: {
        ...subCompanyScope,
        ownerId: ownerIn,
        status: { in: ['open', 'active'] },
      },
      select: {
        id: true,
        ownerId: true,
        nextFollowUp: true,
        leadDeadline: true,
        client: { select: { name: true } },
      },
      take: 500,
    });
    for (const l of leads) {
      const ownerName = ctx.nameById.get(l.ownerId) ?? 'Unknown';
      const due = l.nextFollowUp ?? l.leadDeadline;
      if (!due) continue;
      const st = classifyDueItem(due, false, bounds, now);
      if (st && matchesFilter(st, ctx.filter)) {
        items.push({
          id: `lead:${l.id}`,
          kind: 'lead',
          title: `Lead follow-up: ${l.client.name}`,
          ownerId: l.ownerId,
          ownerName,
          status: st,
          dueAt: due.toISOString(),
          entityId: l.id,
          link: '/leads',
          quickActions: ['open'],
        });
      }
    }
  }

  if (kindAllowed(ctx, 'call') && ctx.filter !== 'completed_today') {
    const calls = await prisma.call.findMany({
      where: {
        ...subCompanyScope,
        ownerId: ownerIn,
        timestamp: { gte: bounds.startUTC, lt: bounds.endUTC },
      },
      select: { id: true, ownerId: true, timestamp: true, client: { select: { name: true } } },
      take: 200,
    });
    for (const c of calls) {
      if (ctx.filter !== 'all' && ctx.filter !== 'today') continue;
      const st: DailyActivityStatus = 'completed_today';
      if (!matchesFilter(st, ctx.filter) && ctx.filter !== 'today') continue;
      items.push({
        id: `call:${c.id}`,
        kind: 'call',
        title: `Call: ${c.client.name}`,
        ownerId: c.ownerId,
        ownerName: ctx.nameById.get(c.ownerId) ?? 'Unknown',
        status: ctx.filter === 'today' ? 'today' : 'completed_today',
        occurredAt: c.timestamp.toISOString(),
        entityId: c.id,
        link: '/calls',
        quickActions: ['open'],
      });
    }
  }

  if (kindAllowed(ctx, 'email') && ctx.filter !== 'completed_today') {
    const emails = await prisma.email.findMany({
      where: {
        ...subCompanyScope,
        fromUserId: ownerIn,
        folder: 'sent',
        timestamp: { gte: bounds.startUTC, lt: bounds.endUTC },
      },
      select: { id: true, fromUserId: true, timestamp: true, subject: true },
      take: 200,
    });
    for (const e of emails) {
      if (!e.fromUserId) continue;
      if (ctx.filter !== 'all' && ctx.filter !== 'today') continue;
      items.push({
        id: `email:${e.id}`,
        kind: 'email',
        title: e.subject || 'Email sent',
        ownerId: e.fromUserId,
        ownerName: ctx.nameById.get(e.fromUserId) ?? 'Unknown',
        status: ctx.filter === 'today' ? 'today' : 'completed_today',
        occurredAt: e.timestamp.toISOString(),
        entityId: e.id,
        link: '/emails',
        quickActions: ['open'],
      });
    }
    const unread = await prisma.email.findMany({
      where: {
        ...subCompanyScope,
        toUserId: ownerIn,
        isRead: false,
      },
      select: { id: true, toUserId: true, timestamp: true, subject: true },
      take: 100,
    });
    for (const e of unread) {
      if (!e.toUserId) continue;
      const st: DailyActivityStatus = 'pending';
      if (!matchesFilter(st, ctx.filter)) continue;
      items.push({
        id: `email:unread:${e.id}`,
        kind: 'email',
        title: e.subject || 'Unread email',
        ownerId: e.toUserId,
        ownerName: ctx.nameById.get(e.toUserId) ?? 'Unknown',
        status: st,
        occurredAt: e.timestamp.toISOString(),
        entityId: e.id,
        link: '/emails',
        quickActions: ['open'],
      });
    }
  }

  if (kindAllowed(ctx, 'note') && ctx.filter !== 'completed_today') {
    const notes = await prisma.clientNote.findMany({
      where: {
        ...subCompanyScope,
        userId: ownerIn,
        createdAt: { gte: bounds.startUTC, lt: bounds.endUTC },
      },
      select: { id: true, userId: true, content: true, createdAt: true, client: { select: { name: true } } },
      take: 100,
    });
    for (const n of notes) {
      if (ctx.filter !== 'all' && ctx.filter !== 'today') continue;
      items.push({
        id: `note:${n.id}`,
        kind: 'note',
        title: n.content.slice(0, 80) || 'Note',
        subtitle: n.client.name,
        ownerId: n.userId,
        ownerName: ctx.nameById.get(n.userId) ?? 'Unknown',
        status: 'completed_today',
        occurredAt: n.createdAt.toISOString(),
        entityId: n.id,
        link: '/clients',
        quickActions: ['open'],
      });
    }
  }

  if (kindAllowed(ctx, 'notification')) {
    const notifications = await prisma.notification.findMany({
      where: {
        ...subCompanyScope,
        userId: ownerIn,
        readAt: null,
      },
      select: { id: true, userId: true, title: true, body: true, link: true, createdAt: true },
      take: 100,
    });
    for (const n of notifications) {
      const st: DailyActivityStatus =
        n.createdAt >= bounds.startUTC && n.createdAt < bounds.endUTC ? 'today' : 'pending';
      if (!matchesFilter(st, ctx.filter)) continue;
      items.push({
        id: `notification:${n.id}`,
        kind: 'notification',
        title: n.title,
        subtitle: n.body,
        ownerId: n.userId,
        ownerName: ctx.nameById.get(n.userId) ?? 'Unknown',
        status: st,
        occurredAt: n.createdAt.toISOString(),
        entityId: n.id,
        link: n.link ?? '/',
        quickActions: ['open'],
      });
    }
  }

  const viewerIsManager = canViewTeamData(ctx.viewerAccess);
  const viewerIsElevated = canAccessMultipleAgencies(ctx.viewerAccess);
  const viewerCanApproveClients = hasPermission(ctx.viewerAccess, 'clients:approve');
  const viewerCanRecommendClients = hasPermission(ctx.viewerAccess, 'clients:manager_recommend');

  if (kindAllowed(ctx, 'lead_request') && (viewerIsManager || viewerIsElevated)) {
    const requests = await prisma.leadRequest.findMany({
      where: { ...subCompanyScope, status: 'pending' },
      include: {
        client: { select: { name: true } },
        requestedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      take: 100,
    });
    for (const r of requests) {
      const st: DailyActivityStatus = 'awaiting_approval';
      if (!matchesFilter(st, ctx.filter)) continue;
      const approverId = pickApproverInScope(r.managerId, audienceUserIds);
      if (!approverId) continue;
      const requesterName = formatUserName(r.requestedBy.firstName, r.requestedBy.lastName);
      const approvalMeta = buildApprovalStatusMeta({
        requesterName,
        approvalChain: r.approvalChain,
        currentStepIndex: r.currentStepIndex,
        fallbackAwaitingLabel: 'Manager',
      });
      items.push({
        id: `lead_request:${r.id}`,
        kind: 'lead_request',
        title: `Lead request: ${r.client.name}`,
        subtitle: approvalMeta.stepLabel,
        ownerId: approverId,
        ownerName: ctx.nameById.get(approverId) ?? 'Manager',
        status: st,
        occurredAt: r.requestedAt.toISOString(),
        entityId: r.id,
        link: '/leads',
        quickActions: ['approve', 'reject', 'open'],
        meta: approvalMeta,
      });
    }

    if (ctx.filter === 'completed_today' || ctx.filter === 'all') {
      const reviewedRequests = await prisma.leadRequest.findMany({
        where: {
          ...subCompanyScope,
          status: { in: ['approved', 'rejected'] },
          reviewedAt: { gte: bounds.startUTC, lt: bounds.endUTC },
          reviewedById: ownerIn,
        },
        include: {
          client: { select: { name: true } },
        },
        take: 100,
      });
      for (const r of reviewedRequests) {
        if (!r.reviewedAt || !r.reviewedById) continue;
        const st: DailyActivityStatus = 'completed_today';
        if (!matchesFilter(st, ctx.filter)) continue;
        const approverId = pickApproverInScope(r.reviewedById, audienceUserIds);
        if (!approverId) continue;
        items.push({
          id: `lead_request:done:${r.id}`,
          kind: 'lead_request',
          title: `Lead request ${r.status}: ${r.client.name}`,
          ownerId: approverId,
          ownerName: ctx.nameById.get(approverId) ?? 'Manager',
          status: st,
          occurredAt: r.reviewedAt.toISOString(),
          entityId: r.id,
          link: '/leads',
          quickActions: ['open'],
        });
      }
    }
  }

  if (
    kindAllowed(ctx, 'client_submission') &&
    (viewerCanRecommendClients ||
      viewerCanApproveClients ||
      includeRequesterPendingStatus(ctx.filter))
  ) {
    const subs = await prisma.pendingClientSubmission.findMany({
      where: { ...subCompanyScope },
      include: {
        submittedBy: {
          select: { id: true, firstName: true, lastName: true, reportingManagerIds: true },
        },
      },
      take: 100,
    });
    for (const s of subs) {
      const st: DailyActivityStatus = 'awaiting_approval';
      if (!matchesFilter(st, ctx.filter) && ctx.filter !== 'pending') continue;

      const submitterRole = s.submitterRole ?? '';
      const submitterIsManager = ctx.teamRoleKeys.has(submitterRole) || submitterRole === 'operations_manager';
      const requesterName = formatUserName(s.submittedBy.firstName, s.submittedBy.lastName);
      const approvalMeta = buildApprovalStatusMeta({
        requesterName,
        approvalChain: s.approvalChain,
        currentStepIndex: s.currentStepIndex,
        managerApprovedAt: s.managerApprovedAt,
        fallbackAwaitingLabel: s.managerApprovedAt ? 'Company Director' : 'Manager',
      });
      const awaitingDirector = isDirectorApprovalRole(approvalMeta.awaitingRoleKey);
      let included = false;

      if (
        viewerCanRecommendClients &&
        !submitterIsManager &&
        !s.managerApprovedAt &&
        !awaitingDirector
      ) {
        const rawApprover = resolveManagerApproverId(
          s.submittedBy.reportingManagerIds ?? [],
          managerIds,
          userIds,
        );
        const approverId = pickApproverInScope(rawApprover, audienceUserIds);
        if (approverId) {
          items.push({
            id: `client_submission:${s.id}`,
            kind: 'client_submission',
            title: `New client submission: ${s.name}`,
            subtitle: approvalMeta.stepLabel,
            ownerId: approverId,
            ownerName: ctx.nameById.get(approverId) ?? 'Manager',
            status: st,
            occurredAt: s.submittedAt.toISOString(),
            entityId: s.id,
            link: '/clients?tab=pending',
            quickActions: ['approve', 'open'],
            meta: approvalMeta,
          });
          included = true;
        }
      } else if (
        viewerCanApproveClients &&
        (submitterIsManager || !!s.managerApprovedAt || awaitingDirector)
      ) {
        const rawApprover = resolveDirectorApproverId(directorIds, userIds);
        const approverId = pickApproverInScope(rawApprover, audienceUserIds);
        if (approverId) {
          items.push({
            id: `client_submission:${s.id}`,
            kind: 'client_submission',
            title: `Client approval: ${s.name}`,
            subtitle: approvalMeta.stepLabel,
            ownerId: approverId,
            ownerName: ctx.nameById.get(approverId) ?? 'Director',
            status: st,
            occurredAt: s.submittedAt.toISOString(),
            entityId: s.id,
            link: '/clients?tab=pending',
            quickActions: ['approve', 'reject', 'open'],
            meta: approvalMeta,
          });
          included = true;
        }
      }

      if (
        !included &&
        includeRequesterPendingStatus(ctx.filter) &&
        audienceUserIds.has(s.submittedById)
      ) {
        items.push({
          id: `client_submission:${s.id}`,
          kind: 'client_submission',
          title: `New client submission: ${s.name}`,
          subtitle: approvalMeta.stepLabel,
          ownerId: s.submittedById,
          ownerName: requesterName || 'Unknown',
          status: st,
          occurredAt: s.submittedAt.toISOString(),
          entityId: s.id,
          link: '/clients?tab=pending',
          quickActions: ['open'],
          meta: approvalMeta,
        });
      }
    }

    if (ctx.filter === 'completed_today' || ctx.filter === 'all') {
      const managerApprovedSubs = await prisma.pendingClientSubmission.findMany({
        where: {
          ...subCompanyScope,
          managerApprovedAt: { gte: bounds.startUTC, lt: bounds.endUTC },
          managerApprovedById: ownerIn,
        },
        select: {
          id: true,
          name: true,
          managerApprovedAt: true,
          managerApprovedById: true,
        },
        take: 100,
      });

      for (const s of managerApprovedSubs) {
        if (!s.managerApprovedAt || !s.managerApprovedById) continue;
        const st: DailyActivityStatus = 'completed_today';
        if (!matchesFilter(st, ctx.filter)) continue;
        const approverId = pickApproverInScope(s.managerApprovedById, audienceUserIds);
        if (!approverId) continue;
        items.push({
          id: `client_submission:done:${s.id}`,
          kind: 'client_submission',
          title: `Client submission approved: ${s.name}`,
          ownerId: approverId,
          ownerName: ctx.nameById.get(approverId) ?? 'Manager',
          status: st,
          occurredAt: s.managerApprovedAt.toISOString(),
          entityId: s.id,
          link: '/clients?tab=pending',
          quickActions: ['open'],
        });
      }

      if (viewerCanApproveClients) {
        const directorClientActions = await prisma.activityLog.findMany({
          where: {
            ...subCompanyScope,
            userId: ownerIn,
            timestamp: { gte: bounds.startUTC, lt: bounds.endUTC },
            type: { in: ['client_created', 'client_pending_submission', 'client_pending_edit', 'client_updated'] },
          },
          select: {
            id: true,
            userId: true,
            type: true,
            description: true,
            timestamp: true,
            metadata: true,
          },
          take: 100,
        });

        for (const log of directorClientActions) {
          const st: DailyActivityStatus = 'completed_today';
          if (!matchesFilter(st, ctx.filter)) continue;
          const approverId = pickApproverInScope(log.userId, audienceUserIds);
          if (!approverId) continue;

          const meta = log.metadata as { clientId?: string; clientName?: string } | null;
          const clientName =
            meta?.clientName ??
            (log.description.match(/"([^"]+)"/)?.[1] ?? 'Client');

          if (log.type === 'client_created') {
            if (!log.description.includes('Approved pending submission')) continue;
            items.push({
              id: `client_submission:done:log:${log.id}`,
              kind: 'client_submission',
              title: `Client approved: ${clientName}`,
              ownerId: approverId,
              ownerName: ctx.nameById.get(approverId) ?? 'Director',
              status: st,
              occurredAt: log.timestamp.toISOString(),
              entityId: meta?.clientId ?? log.id,
              link: meta?.clientId ? `/clients?client=${meta.clientId}` : '/clients?tab=pending',
              quickActions: ['open'],
            });
          } else if (log.type === 'client_updated' && log.description.includes('Approved pending edit')) {
            items.push({
              id: `client_edit:done:log:${log.id}`,
              kind: 'client_edit',
              title: `Client edit approved: ${clientName}`,
              ownerId: approverId,
              ownerName: ctx.nameById.get(approverId) ?? 'Director',
              status: st,
              occurredAt: log.timestamp.toISOString(),
              entityId: meta?.clientId ?? log.id,
              link: meta?.clientId ? `/clients?client=${meta.clientId}` : '/clients?tab=pending',
              quickActions: ['open'],
            });
          } else if (log.description.includes('Rejected pending client submission')) {
            items.push({
              id: `client_submission:done:log:${log.id}`,
              kind: 'client_submission',
              title: `Client submission rejected: ${clientName}`,
              ownerId: approverId,
              ownerName: ctx.nameById.get(approverId) ?? 'Director',
              status: st,
              occurredAt: log.timestamp.toISOString(),
              entityId: log.id,
              link: '/clients?tab=pending',
              quickActions: ['open'],
            });
          } else if (log.description.includes('Rejected pending client edit')) {
            items.push({
              id: `client_edit:done:log:${log.id}`,
              kind: 'client_edit',
              title: `Client edit rejected: ${clientName}`,
              ownerId: approverId,
              ownerName: ctx.nameById.get(approverId) ?? 'Director',
              status: st,
              occurredAt: log.timestamp.toISOString(),
              entityId: log.id,
              link: '/clients?tab=pending',
              quickActions: ['open'],
            });
          }
        }
      }
    }
  }

  if (
    kindAllowed(ctx, 'client_edit') &&
    (viewerCanRecommendClients ||
      viewerCanApproveClients ||
      includeRequesterPendingStatus(ctx.filter))
  ) {
    const edits = await prisma.pendingClientEdit.findMany({
      where: { ...subCompanyScope },
      include: {
        submittedBy: {
          select: { id: true, firstName: true, lastName: true, reportingManagerIds: true },
        },
        client: { select: { id: true, name: true } },
      },
      take: 100,
    });
    for (const e of edits) {
      const st: DailyActivityStatus = 'awaiting_approval';
      if (!matchesFilter(st, ctx.filter) && ctx.filter !== 'pending') continue;

      const submitterRole = e.submitterRole ?? '';
      const submitterIsManager = ctx.teamRoleKeys.has(submitterRole) || submitterRole === 'operations_manager';
      const requesterName = formatUserName(e.submittedBy.firstName, e.submittedBy.lastName);
      const approvalMeta = buildApprovalStatusMeta({
        requesterName,
        approvalChain: e.approvalChain,
        currentStepIndex: e.currentStepIndex,
        managerApprovedAt: e.managerApprovedAt,
        fallbackAwaitingLabel: e.managerApprovedAt ? 'Company Director' : 'Manager',
      });
      const awaitingDirector = isDirectorApprovalRole(approvalMeta.awaitingRoleKey);
      let included = false;

      if (
        viewerCanRecommendClients &&
        !submitterIsManager &&
        !e.managerApprovedAt &&
        !awaitingDirector
      ) {
        const rawApprover = resolveManagerApproverId(
          e.submittedBy.reportingManagerIds ?? [],
          managerIds,
          userIds,
        );
        const approverId = pickApproverInScope(rawApprover, audienceUserIds);
        if (approverId) {
          items.push({
            id: `client_edit:${e.id}`,
            kind: 'client_edit',
            title: `Client edit submission: ${e.name}`,
            subtitle: approvalMeta.stepLabel,
            ownerId: approverId,
            ownerName: ctx.nameById.get(approverId) ?? 'Manager',
            status: st,
            occurredAt: e.submittedAt.toISOString(),
            entityId: e.id,
            link: '/clients?tab=pending',
            quickActions: ['approve', 'open'],
            meta: approvalMeta,
          });
          included = true;
        }
      } else if (
        viewerCanApproveClients &&
        (submitterIsManager || !!e.managerApprovedAt || awaitingDirector)
      ) {
        const rawApprover = resolveDirectorApproverId(directorIds, userIds);
        const approverId = pickApproverInScope(rawApprover, audienceUserIds);
        if (approverId) {
          items.push({
            id: `client_edit:${e.id}`,
            kind: 'client_edit',
            title: `Client edit approval: ${e.name}`,
            subtitle: approvalMeta.stepLabel,
            ownerId: approverId,
            ownerName: ctx.nameById.get(approverId) ?? 'Director',
            status: st,
            occurredAt: e.submittedAt.toISOString(),
            entityId: e.id,
            link: '/clients?tab=pending',
            quickActions: ['approve', 'reject', 'open'],
            meta: approvalMeta,
          });
          included = true;
        }
      }

      if (
        !included &&
        includeRequesterPendingStatus(ctx.filter) &&
        audienceUserIds.has(e.submittedById)
      ) {
        items.push({
          id: `client_edit:${e.id}`,
          kind: 'client_edit',
          title: `Client edit submission: ${e.name}`,
          subtitle: approvalMeta.stepLabel,
          ownerId: e.submittedById,
          ownerName: requesterName || 'Unknown',
          status: st,
          occurredAt: e.submittedAt.toISOString(),
          entityId: e.id,
          link: '/clients?tab=pending',
          quickActions: ['open'],
          meta: approvalMeta,
        });
      }
    }

    if (ctx.filter === 'completed_today' || ctx.filter === 'all') {
      const managerApprovedEdits = await prisma.pendingClientEdit.findMany({
        where: {
          ...subCompanyScope,
          managerApprovedAt: { gte: bounds.startUTC, lt: bounds.endUTC },
          managerApprovedById: ownerIn,
        },
        select: {
          id: true,
          name: true,
          managerApprovedAt: true,
          managerApprovedById: true,
        },
        take: 100,
      });

      for (const e of managerApprovedEdits) {
        if (!e.managerApprovedAt || !e.managerApprovedById) continue;
        const st: DailyActivityStatus = 'completed_today';
        if (!matchesFilter(st, ctx.filter)) continue;
        const approverId = pickApproverInScope(e.managerApprovedById, audienceUserIds);
        if (!approverId) continue;
        items.push({
          id: `client_edit:done:${e.id}`,
          kind: 'client_edit',
          title: `Client edit submission approved: ${e.name}`,
          ownerId: approverId,
          ownerName: ctx.nameById.get(approverId) ?? 'Manager',
          status: st,
          occurredAt: e.managerApprovedAt.toISOString(),
          entityId: e.id,
          link: '/clients?tab=pending',
          quickActions: ['open'],
        });
      }
    }
  }

  if (kindAllowed(ctx, 'proposal')) {
    const proposals = await prisma.proposal.findMany({
      where: {
        lead: { ...subCompanyScope },
        OR: [
          { status: 'pending' },
          {
            status: 'approved',
            isForReview: false,
            activatedAt: null,
            reviewRequestedAt: { not: null },
          },
        ],
      },
      include: {
        lead: {
          select: {
            id: true,
            ownerId: true,
            owner: {
              select: {
                firstName: true,
                lastName: true,
                reportingManagerIds: true,
              },
            },
            client: { select: { name: true } },
          },
        },
        createdBy: { select: { firstName: true, lastName: true } },
        reviewRequestedBy: { select: { firstName: true, lastName: true } },
      },
      take: 100,
    });
    for (const p of proposals) {
      if (!proposalNeedsManagerAction(p)) continue;
      const st: DailyActivityStatus = 'awaiting_approval';
      if (!matchesFilter(st, ctx.filter) && ctx.filter !== 'pending') continue;
      const rawApprover =
        resolveManagerApproverId(
          p.lead.owner.reportingManagerIds ?? [],
          managerIds,
          userIds,
        ) ?? p.lead.ownerId;
      const approverId = pickApproverInScope(rawApprover, audienceUserIds);
      if (!approverId) continue;
      const title =
        p.status === 'pending'
          ? `Proposal review: ${p.lead.client.name}`
          : `Document review: ${p.lead.client.name}`;
      const requesterUser =
        p.status === 'pending'
          ? p.createdBy
          : p.reviewRequestedBy ?? p.createdBy ?? p.lead.owner;
      const requesterName = requesterUser
        ? formatUserName(requesterUser.firstName, requesterUser.lastName)
        : formatUserName(p.lead.owner.firstName, p.lead.owner.lastName);
      const approvalMeta = buildApprovalStatusMeta({
        requesterName,
        approvalChain: p.approvalChain,
        currentStepIndex: p.currentStepIndex,
        fallbackAwaitingLabel: 'Manager',
      });
      items.push({
        id: `proposal:${p.id}`,
        kind: 'proposal',
        title,
        subtitle: approvalMeta.stepLabel,
        ownerId: approverId,
        ownerName: ctx.nameById.get(approverId) ?? 'Unknown',
        status: st,
        occurredAt: p.createdAt.toISOString(),
        entityId: p.id,
        link: '/proposals',
        quickActions: viewerIsManager || viewerIsElevated ? ['approve', 'reject', 'open'] : ['open'],
        meta: approvalMeta,
      });
    }

    if (ctx.filter === 'completed_today' || ctx.filter === 'all') {
      const reviewedProposals = await prisma.proposal.findMany({
        where: {
          lead: { ...subCompanyScope },
          reviewedAt: { gte: bounds.startUTC, lt: bounds.endUTC },
          reviewedById: ownerIn,
          status: { in: ['approved', 'rejected'] },
        },
        include: {
          lead: { select: { client: { select: { name: true } } } },
        },
        take: 100,
      });

      for (const p of reviewedProposals) {
        if (!p.reviewedAt || !p.reviewedById) continue;
        const st: DailyActivityStatus = 'completed_today';
        if (!matchesFilter(st, ctx.filter)) continue;
        const approverId = pickApproverInScope(p.reviewedById, audienceUserIds);
        if (!approverId) continue;
        items.push({
          id: `proposal:done:${p.id}`,
          kind: 'proposal',
          title: `Proposal ${p.status}: ${p.lead.client.name}`,
          ownerId: approverId,
          ownerName: ctx.nameById.get(approverId) ?? 'Unknown',
          status: st,
          occurredAt: p.reviewedAt.toISOString(),
          entityId: p.id,
          link: '/proposals',
          quickActions: ['open'],
        });
      }
    }
  }

  if (kindAllowed(ctx, 'lead_extension')) {
    const ext = await prisma.leadExtensionRequest.findMany({
      where: {
        status: 'pending',
        lead: { ...subCompanyScope },
      },
      include: {
        lead: {
          select: {
            id: true,
            ownerId: true,
            client: { select: { name: true } },
            owner: { select: { reportingManagerIds: true } },
          },
        },
        requestedBy: { select: { firstName: true, lastName: true } },
      },
      take: 50,
    });
    for (const e of ext) {
      const st: DailyActivityStatus = 'awaiting_approval';
      if (!matchesFilter(st, ctx.filter) && ctx.filter !== 'pending') continue;
      const rawApprover = resolveManagerApproverId(
        e.lead.owner.reportingManagerIds ?? [],
        managerIds,
        userIds,
      );
      const approverId = pickApproverInScope(rawApprover, audienceUserIds);
      if (!approverId) continue;
      const requesterName = formatUserName(e.requestedBy.firstName, e.requestedBy.lastName);
      const approvalMeta = buildApprovalStatusMeta({
        requesterName,
        approvalChain: e.approvalChain,
        currentStepIndex: e.currentStepIndex,
        fallbackAwaitingLabel: 'Manager',
      });
      items.push({
        id: `lead_extension:${e.id}`,
        kind: 'lead_extension',
        title: `Lead extension: ${e.lead.client.name}`,
        subtitle: approvalMeta.stepLabel,
        ownerId: approverId,
        ownerName: ctx.nameById.get(approverId) ?? 'Unknown',
        status: st,
        occurredAt: e.requestedAt.toISOString(),
        entityId: e.lead.id,
        link: '/leads',
        quickActions: ['open'],
        meta: approvalMeta,
      });
    }

    if (ctx.filter === 'completed_today' || ctx.filter === 'all') {
      const reviewedExtensions = await prisma.leadExtensionRequest.findMany({
        where: {
          lead: { ...subCompanyScope },
          reviewedAt: { gte: bounds.startUTC, lt: bounds.endUTC },
          reviewedById: ownerIn,
          status: { in: ['approved', 'rejected', 'returned'] },
        },
        include: {
          lead: { select: { id: true, client: { select: { name: true } } } },
        },
        take: 50,
      });

      for (const e of reviewedExtensions) {
        if (!e.reviewedAt || !e.reviewedById) continue;
        const st: DailyActivityStatus = 'completed_today';
        if (!matchesFilter(st, ctx.filter)) continue;
        const approverId = pickApproverInScope(e.reviewedById, audienceUserIds);
        if (!approverId) continue;
        items.push({
          id: `lead_extension:done:${e.id}`,
          kind: 'lead_extension',
          title: `Lead extension ${e.status}: ${e.lead.client.name}`,
          ownerId: approverId,
          ownerName: ctx.nameById.get(approverId) ?? 'Unknown',
          status: st,
          occurredAt: e.reviewedAt.toISOString(),
          entityId: e.lead.id,
          link: '/leads',
          quickActions: ['open'],
        });
      }
    }
  }

  if (kindAllowed(ctx, 'proposal_extension')) {
    const ext = await prisma.proposalExtensionRequest.findMany({
      where: {
        status: 'pending',
        proposal: { lead: { ...subCompanyScope } },
      },
      include: {
        proposal: {
          select: {
            id: true,
            lead: {
              select: {
                id: true,
                ownerId: true,
                client: { select: { name: true } },
                owner: { select: { reportingManagerIds: true } },
              },
            },
          },
        },
        requestedBy: { select: { firstName: true, lastName: true } },
      },
      take: 50,
    });
    for (const e of ext) {
      const st: DailyActivityStatus = 'awaiting_approval';
      if (!matchesFilter(st, ctx.filter) && ctx.filter !== 'pending') continue;
      const rawApprover = resolveManagerApproverId(
        e.proposal.lead.owner.reportingManagerIds ?? [],
        managerIds,
        userIds,
      );
      const approverId = pickApproverInScope(rawApprover, audienceUserIds);
      if (!approverId) continue;
      const requesterName = formatUserName(e.requestedBy.firstName, e.requestedBy.lastName);
      const approvalMeta = buildApprovalStatusMeta({
        requesterName,
        approvalChain: e.approvalChain,
        currentStepIndex: e.currentStepIndex,
        fallbackAwaitingLabel: 'Manager',
      });
      items.push({
        id: `proposal_extension:${e.id}`,
        kind: 'proposal_extension',
        title: `Proposal extension: ${e.proposal.lead.client.name}`,
        subtitle: approvalMeta.stepLabel,
        ownerId: approverId,
        ownerName: ctx.nameById.get(approverId) ?? 'Unknown',
        status: st,
        occurredAt: e.createdAt.toISOString(),
        entityId: e.proposal.id,
        link: '/proposals',
        quickActions: ['open'],
        meta: approvalMeta,
      });
    }

    if (ctx.filter === 'completed_today' || ctx.filter === 'all') {
      const reviewedProposalExtensions = await prisma.proposalExtensionRequest.findMany({
        where: {
          proposal: { lead: { ...subCompanyScope } },
          reviewedAt: { gte: bounds.startUTC, lt: bounds.endUTC },
          reviewedById: ownerIn,
          status: { in: ['approved', 'rejected'] },
        },
        include: {
          proposal: {
            select: { id: true, lead: { select: { client: { select: { name: true } } } } },
          },
        },
        take: 50,
      });

      for (const e of reviewedProposalExtensions) {
        if (!e.reviewedAt || !e.reviewedById) continue;
        const st: DailyActivityStatus = 'completed_today';
        if (!matchesFilter(st, ctx.filter)) continue;
        const approverId = pickApproverInScope(e.reviewedById, audienceUserIds);
        if (!approverId) continue;
        items.push({
          id: `proposal_extension:done:${e.id}`,
          kind: 'proposal_extension',
          title: `Proposal extension ${e.status}: ${e.proposal.lead.client.name}`,
          ownerId: approverId,
          ownerName: ctx.nameById.get(approverId) ?? 'Unknown',
          status: st,
          occurredAt: e.reviewedAt.toISOString(),
          entityId: e.proposal.id,
          link: '/proposals',
          quickActions: ['open'],
        });
      }
    }
  }

  if (kindAllowed(ctx, 'employee')) {
    const employees = await prisma.employee.findMany({
      where: {
        approvalStatus: 'pending',
        addedBy: { ...subCompanyScope, isActive: true },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        createdAt: true,
        approvalChain: true,
        currentStepIndex: true,
        addedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            subCompanyId: true,
            reportingManagerIds: true,
          },
        },
      },
      take: 50,
    });
    for (const emp of employees) {
      const st: DailyActivityStatus = 'awaiting_approval';
      if (!matchesFilter(st, ctx.filter) && ctx.filter !== 'pending') continue;
      const adderAgency = emp.addedBy.subCompanyId;
      let approverId: string | null = null;
      if (adderAgency) {
        const chain = Array.isArray(emp.approvalChain)
          ? (emp.approvalChain as string[])
          : [];
        const targetRole =
          chain[emp.currentStepIndex] ?? chain[0] ?? 'recruitment_manager';
        const roleUserIds = await getUserIdsForRoleKeyInAgency(adderAgency, targetRole);
        approverId = pickFirstInScope(new Set(roleUserIds), audienceUserIds);
      }
      if (!approverId) {
        const rawApprover = resolveManagerApproverId(
          emp.addedBy.reportingManagerIds ?? [],
          managerIds,
          userIds,
        );
        approverId = pickApproverInScope(rawApprover, audienceUserIds);
      }
      if (!approverId) continue;
      const requesterName = formatUserName(emp.addedBy.firstName, emp.addedBy.lastName);
      const approvalMeta = buildApprovalStatusMeta({
        requesterName,
        fallbackAwaitingLabel: 'Manager',
      });
      items.push({
        id: `employee:${emp.id}`,
        kind: 'employee',
        title: `Employee approval: ${emp.firstName} ${emp.lastName}`,
        subtitle: approvalMeta.stepLabel,
        ownerId: approverId,
        ownerName: ctx.nameById.get(approverId) ?? 'Unknown',
        status: st,
        occurredAt: emp.createdAt.toISOString(),
        entityId: emp.id,
        link: '/employees',
        quickActions: ['open'],
        meta: approvalMeta,
      });
    }

    const pendingAssignments = await prisma.employeeAssignment.findMany({
      where: {
        status: 'pending',
        employee: { addedBy: { ...subCompanyScope, isActive: true } },
      },
      select: {
        id: true,
        targetType: true,
        createdAt: true,
        approvalChain: true,
        currentStepIndex: true,
        client: { select: { name: true } },
        job: { select: { title: true } },
        employee: {
          select: {
            firstName: true,
            lastName: true,
            addedBy: { select: { subCompanyId: true } },
          },
        },
        submittedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            reportingManagerIds: true,
          },
        },
      },
      take: 50,
    });
    for (const row of pendingAssignments) {
      const st: DailyActivityStatus = 'awaiting_approval';
      if (!matchesFilter(st, ctx.filter) && ctx.filter !== 'pending') continue;
      const adderAgency = row.employee.addedBy.subCompanyId;
      let approverId: string | null = null;
      if (adderAgency) {
        const chain = Array.isArray(row.approvalChain)
          ? (row.approvalChain as string[])
          : [];
        const targetRole =
          chain[row.currentStepIndex] ?? chain[0] ?? 'recruitment_manager';
        const roleUserIds = await getUserIdsForRoleKeyInAgency(adderAgency, targetRole);
        approverId = pickFirstInScope(new Set(roleUserIds), audienceUserIds);
      }
      if (!approverId) {
        const rawApprover = resolveManagerApproverId(
          row.submittedBy.reportingManagerIds ?? [],
          managerIds,
          userIds,
        );
        approverId = pickApproverInScope(rawApprover, audienceUserIds);
      }
      if (!approverId) continue;
      const requesterName = formatUserName(row.submittedBy.firstName, row.submittedBy.lastName);
      const approvalMeta = buildApprovalStatusMeta({
        requesterName,
        fallbackAwaitingLabel: 'Manager',
      });
      const targetLabel =
        row.targetType === 'client' ? row.client?.name ?? 'Client' : row.job?.title ?? 'Job';
      items.push({
        id: `employee_assignment:${row.id}`,
        kind: 'employee',
        title: `Link approval: ${row.employee.firstName} ${row.employee.lastName} → ${targetLabel}`,
        subtitle: approvalMeta.stepLabel,
        ownerId: approverId,
        ownerName: ctx.nameById.get(approverId) ?? 'Unknown',
        status: st,
        occurredAt: row.createdAt.toISOString(),
        entityId: row.id,
        link: `/employees?assignment=${row.id}`,
        quickActions: ['open'],
        meta: approvalMeta,
      });
    }

    if (ctx.filter === 'completed_today' || ctx.filter === 'all') {
      const approvedEmployees = await prisma.employee.findMany({
        where: {
          addedBy: { ...subCompanyScope, isActive: true },
          approvalStatus: { in: ['approved', 'rejected'] },
          approvedAt: { gte: bounds.startUTC, lt: bounds.endUTC },
          approvedById: ownerIn,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          approvalStatus: true,
          approvedAt: true,
          approvedById: true,
        },
        take: 50,
      });

      for (const emp of approvedEmployees) {
        if (!emp.approvedAt || !emp.approvedById) continue;
        const st: DailyActivityStatus = 'completed_today';
        if (!matchesFilter(st, ctx.filter)) continue;
        const approverId = pickApproverInScope(emp.approvedById, audienceUserIds);
        if (!approverId) continue;
        items.push({
          id: `employee:done:${emp.id}`,
          kind: 'employee',
          title: `Employee ${emp.approvalStatus}: ${emp.firstName} ${emp.lastName}`,
          ownerId: approverId,
          ownerName: ctx.nameById.get(approverId) ?? 'Unknown',
          status: st,
          occurredAt: emp.approvedAt.toISOString(),
          entityId: emp.id,
          link: '/employees',
          quickActions: ['open'],
        });
      }
    }
  }

  if (kindAllowed(ctx, 'resource_request') && (viewerIsManager || viewerIsElevated)) {
    const [industries, tags, jobTitles] = await Promise.all([
      prisma.industryRequest.findMany({
        where: { ...subCompanyScope, status: 'pending' },
        select: {
          id: true,
          name: true,
          requestedById: true,
          createdAt: true,
          requestedBy: { select: { firstName: true, lastName: true } },
        },
        take: 30,
      }),
      prisma.tagRequest.findMany({
        where: { ...subCompanyScope, status: 'pending' },
        select: {
          id: true,
          name: true,
          requestedById: true,
          createdAt: true,
          requestedBy: { select: { firstName: true, lastName: true } },
        },
        take: 30,
      }),
      prisma.jobTitleRequest.findMany({
        where: { ...subCompanyScope, status: 'pending' },
        select: {
          id: true,
          name: true,
          requestedById: true,
          createdAt: true,
          requestedBy: { select: { firstName: true, lastName: true } },
        },
        take: 30,
      }),
    ]);
    for (const r of [...industries, ...tags, ...jobTitles]) {
      const st: DailyActivityStatus = 'awaiting_approval';
      if (!matchesFilter(st, ctx.filter) && ctx.filter !== 'pending') continue;
      const approverId = pickFirstInScope(settingsApproverIds, audienceUserIds);
      if (!approverId) continue;
      const requesterName = formatUserName(r.requestedBy.firstName, r.requestedBy.lastName);
      const approvalMeta = buildApprovalStatusMeta({
        requesterName,
        fallbackAwaitingLabel: 'approver',
      });
      items.push({
        id: `resource_request:${r.id}`,
        kind: 'resource_request',
        title: `Resource request: ${r.name}`,
        subtitle: approvalMeta.stepLabel,
        ownerId: approverId,
        ownerName: ctx.nameById.get(approverId) ?? 'Unknown',
        status: st,
        occurredAt: r.createdAt.toISOString(),
        entityId: r.id,
        link: '/settings',
        quickActions: ['open'],
        meta: approvalMeta,
      });
    }

    if (ctx.filter === 'completed_today' || ctx.filter === 'all') {
      const [industriesDone, tagsDone, jobTitlesDone] = await Promise.all([
        prisma.industryRequest.findMany({
          where: {
            ...subCompanyScope,
            status: { in: ['approved', 'rejected'] },
            decidedAt: { gte: bounds.startUTC, lt: bounds.endUTC },
            decidedById: ownerIn,
          },
          select: { id: true, name: true, status: true, decidedById: true, decidedAt: true },
          take: 30,
        }),
        prisma.tagRequest.findMany({
          where: {
            ...subCompanyScope,
            status: { in: ['approved', 'rejected'] },
            decidedAt: { gte: bounds.startUTC, lt: bounds.endUTC },
            decidedById: ownerIn,
          },
          select: { id: true, name: true, status: true, decidedById: true, decidedAt: true },
          take: 30,
        }),
        prisma.jobTitleRequest.findMany({
          where: {
            ...subCompanyScope,
            status: { in: ['approved', 'rejected'] },
            decidedAt: { gte: bounds.startUTC, lt: bounds.endUTC },
            decidedById: ownerIn,
          },
          select: { id: true, name: true, status: true, decidedById: true, decidedAt: true },
          take: 30,
        }),
      ]);

      for (const r of [...industriesDone, ...tagsDone, ...jobTitlesDone]) {
        if (!r.decidedAt || !r.decidedById) continue;
        const st: DailyActivityStatus = 'completed_today';
        if (!matchesFilter(st, ctx.filter)) continue;
        const approverId = pickApproverInScope(r.decidedById, audienceUserIds);
        if (!approverId) continue;
        items.push({
          id: `resource_request:done:${r.id}`,
          kind: 'resource_request',
          title: `Resource request ${r.status}: ${r.name}`,
          ownerId: approverId,
          ownerName: ctx.nameById.get(approverId) ?? 'Unknown',
          status: st,
          occurredAt: r.decidedAt.toISOString(),
          entityId: r.id,
          link: '/settings',
          quickActions: ['open'],
        });
      }
    }
  }

  return dedupeActivityItems(items);
}

function aggregateCounters(items: DailyActivityItem[]): DailyActivityCounters {
  const c = emptyCounters();
  for (const item of items) {
    bumpCounter(c, item.status, item.kind);
  }
  return c;
}

function aggregateCountersByUser(items: DailyActivityItem[]): Map<string, DailyActivityCounters> {
  const map = new Map<string, DailyActivityCounters>();
  for (const item of items) {
    let c = map.get(item.ownerId);
    if (!c) {
      c = emptyCounters();
      map.set(item.ownerId, c);
    }
    bumpCounter(c, item.status, item.kind);
  }
  return map;
}

function withActionTodayCount(
  counters: DailyActivityCounters,
  userId: string,
  actionTodayByUser: Map<string, number>,
): DailyActivityCounters {
  const c = cloneCounters(counters);
  c.action_today = actionTodayByUser.get(userId) ?? 0;
  return c;
}

function withCompletedTodayCount(
  counters: DailyActivityCounters,
  userId: string,
  completedTodayByUser: Map<string, number>,
): DailyActivityCounters {
  const c = cloneCounters(counters);
  c.completed_today = completedTodayByUser.get(userId) ?? 0;
  return c;
}

function withAgendaCounts(
  counters: DailyActivityCounters,
  userId: string,
  actionTodayByUser: Map<string, number>,
  completedTodayByUser: Map<string, number>,
): DailyActivityCounters {
  return withCompletedTodayCount(
    withActionTodayCount(counters, userId, actionTodayByUser),
    userId,
    completedTodayByUser,
  );
}

function attachCountersToTree(
  nodes: TeamTreeNode[],
  byUser: Map<string, DailyActivityCounters>,
  actionTodayByUser: Map<string, number>,
  completedTodayByUser: Map<string, number>,
): TeamTreeNode[] {
  return nodes.map((node) => {
    if (node.isUnassignedGroup) {
      const children = attachCountersToTree(
        node.children,
        byUser,
        actionTodayByUser,
        completedTodayByUser,
      );
      const rolled = emptyCounters();
      let actionToday = 0;
      let completedToday = 0;
      for (const ch of children) {
        sumCounterFields(rolled, ch.counters);
        actionToday += ch.counters.action_today ?? 0;
        completedToday += ch.counters.completed_today ?? 0;
      }
      rolled.action_today = actionToday;
      rolled.completed_today = completedToday;
      return {
        ...node,
        counters: toTreeCounters(rolled),
        children,
      };
    }
    const children = attachCountersToTree(
      node.children,
      byUser,
      actionTodayByUser,
      completedTodayByUser,
    );
    const selfCounters = byUser.get(node.user.id) ?? emptyCounters();
    const display = withAgendaCounts(
      selfCounters,
      node.user.id,
      actionTodayByUser,
      completedTodayByUser,
    );

    return {
      ...node,
      counters: toTreeCounters(display),
      children,
    };
  });
}

export interface HierarchyResult {
  tree: TeamTreeNode[];
  bounds: DayBounds;
  totals: DailyActivityCounters;
}

function findTreeUser(nodes: TeamTreeNode[], userId: string): TeamTreeNode | null {
  for (const node of nodes) {
    if (!node.isUnassignedGroup && node.user.id === userId) return node;
    const found = findTreeUser(node.children, userId);
    if (found) return found;
  }
  return null;
}

/**
 * Ops managers / cross-org leaders are often visible for counts but omitted from the
 * agency reporting tree. Without a self row, the UI treats counters as 0 and wipes the badge.
 */
async function ensureViewerInTree(
  tree: TeamTreeNode[],
  viewer: JwtPayload,
  byUser: Map<string, DailyActivityCounters>,
  actionTodayByUser: Map<string, number>,
  completedTodayByUser: Map<string, number>,
): Promise<TeamTreeNode[]> {
  const viewerId = viewer.sub;
  if (!viewerId || findTreeUser(tree, viewerId)) return tree;

  const self = await prisma.user.findUnique({
    where: { id: viewerId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
      userType: true,
      reportingManagerIds: true,
    },
  });
  if (!self) return tree;

  const selfCounters = byUser.get(viewerId) ?? emptyCounters();
  const display = withAgendaCounts(
    selfCounters,
    viewerId,
    actionTodayByUser,
    completedTodayByUser,
  );

  return [
    {
      user: {
        id: self.id,
        firstName: self.firstName,
        lastName: self.lastName,
        role: self.role,
        roleLabel: getUserRoleTitleSync(self),
        reportingManagerIds: self.reportingManagerIds ?? [],
      },
      counters: toTreeCounters(display),
      children: [],
    },
    ...tree,
  ];
}

/** Open work due or overdue today for the viewer only (excludes future upcoming). */
export async function getDailyActivityTodayCount(
  viewer: JwtPayload,
  requestedAgencyIds: string[] = [],
): Promise<{ count: number }> {
  const viewerId = viewer.sub;
  if (!viewerId) return { count: 0 };

  const visible = await filterVisibleUserIds(viewer, [viewerId]);
  if (visible.length === 0) return { count: 0 };

  const subCompanyScope = await resolveViewerSubCompanyScope(viewer, requestedAgencyIds);
  const bounds = await resolveDayBounds(viewer, requestedAgencyIds);
  const nameById = await loadUserNames([viewerId]);
  const ctx = await buildCollectContextBase(viewer, subCompanyScope, [viewerId], bounds, nameById, {
    filter: 'all',
  });
  const items = await collectAllItems(ctx);
  const actionTodayByUser = buildActionTodayByUser(items);
  return { count: actionTodayByUser.get(viewerId) ?? 0 };
}

export async function getDailyActivityHierarchy(
  viewer: JwtPayload,
  requestedAgencyIds: string[] = [],
): Promise<HierarchyResult> {
  const subCompanyScope = await resolveViewerSubCompanyScope(viewer, requestedAgencyIds);
  const bounds = await resolveDayBounds(viewer, requestedAgencyIds);
  const userIds = await getVisibleUserIds(viewer, requestedAgencyIds);
  const nameById = await loadUserNames(userIds);

  const baseCtx = await buildCollectContextBase(viewer, subCompanyScope, userIds, bounds, nameById, {
    filter: 'all',
  });

  const itemsActionToday = await collectAllItems({ ...baseCtx, filter: 'action_today' });
  const itemsCompletedToday = await collectAllItems({ ...baseCtx, filter: 'completed_today' });
  const itemsAll = await collectAllItems({ ...baseCtx, filter: 'all' });

  const actionTodayByUser = buildActionTodayByUser(itemsActionToday);
  const completedTodayByUser = buildCompletedTodayByUser(itemsCompletedToday);
  const byUser = aggregateCountersByUser(itemsAll);
  const treeRaw = await buildReportingTree(viewer, requestedAgencyIds);
  const treeWithCounters = attachCountersToTree(
    treeRaw,
    byUser,
    actionTodayByUser,
    completedTodayByUser,
  );
  const tree = await ensureViewerInTree(
    treeWithCounters,
    viewer,
    byUser,
    actionTodayByUser,
    completedTodayByUser,
  );
  const totals = aggregateCounters(itemsAll);
  let actionTodayTotal = 0;
  for (const n of actionTodayByUser.values()) actionTodayTotal += n;
  totals.action_today = actionTodayTotal;
  let completedTodayTotal = 0;
  for (const n of completedTodayByUser.values()) completedTodayTotal += n;
  totals.completed_today = completedTodayTotal;

  return { tree, bounds, totals };
}

export interface ListItemsParams {
  scope?: 'self' | 'team' | 'user';
  userId?: string;
  filter?: ActivityFilter;
  kinds?: DailyActivityKind[];
  q?: string;
  page?: number;
  limit?: number;
  agencyIds?: string[];
}

export interface ListItemsResult {
  data: DailyActivityItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  bounds: DayBounds;
}

export async function listDailyActivityItems(
  viewer: JwtPayload,
  params: ListItemsParams,
): Promise<ListItemsResult> {
  const agencyIds = params.agencyIds ?? [];
  const subCompanyScope = await resolveViewerSubCompanyScope(viewer, agencyIds);
  const bounds = await resolveDayBounds(viewer, agencyIds);
  const filter = params.filter ?? 'action_today';
  const page = Math.max(params.page ?? 1, 1);
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 100);

  let userIds = await getVisibleUserIds(viewer, agencyIds);

  if (params.scope === 'self' || (!params.scope && (await getVisibilityTierForViewer(viewer)) === 'own')) {
    userIds = [viewer.sub!];
  } else {
    const resolved = await resolveDailyActivityAgendaUserIds(
      viewer,
      params.userId ?? null,
      agencyIds,
    );
    userIds = resolved.userIds;
    if (userIds.length === 0) {
      return {
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
        bounds,
      };
    }
  }

  const nameById = await loadUserNames(userIds);
  const listCtx = await buildCollectContextBase(viewer, subCompanyScope, userIds, bounds, nameById, {
    filter,
    kinds: params.kinds,
  });
  let items = await collectAllItems(listCtx);

  if (params.q?.trim()) {
    const q = params.q.trim().toLowerCase();
    items = items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.subtitle?.toLowerCase().includes(q) ||
        i.ownerName.toLowerCase().includes(q) ||
        (typeof i.meta?.requesterName === 'string' &&
          i.meta.requesterName.toLowerCase().includes(q)) ||
        (typeof i.meta?.stepLabel === 'string' && i.meta.stepLabel.toLowerCase().includes(q)) ||
        i.kind.includes(q),
    );
  }

  items = withOverdueDays(items, bounds);

  const ownerSet = new Set(userIds);
  items = items.filter((i) => ownerSet.has(i.ownerId));

  items.sort((a, b) => {
    const ta = a.dueAt ?? a.occurredAt ?? '';
    const tb = b.dueAt ?? b.occurredAt ?? '';
    return ta.localeCompare(tb);
  });

  const total = items.length;
  const skip = (page - 1) * limit;
  const data = items.slice(skip, skip + limit);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
    },
    bounds,
  };
}

async function getVisibilityTierForViewer(viewer: JwtPayload): Promise<'own' | 'team' | 'agency'> {
  const access = await buildAccessContext(viewer);
  if (access.scopeLevel === 'global' || access.scopeLevel === 'agency') return 'agency';
  if (access.scopeLevel === 'team') return 'team';
  return 'own';
}

export async function getDailyActivitySummary(
  viewer: JwtPayload,
  requestedUserIds: string[],
  requestedAgencyIds: string[] = [],
): Promise<{ byUserId: Record<string, DailyActivityCounters>; bounds: DayBounds }> {
  const subCompanyScope = await resolveViewerSubCompanyScope(viewer, requestedAgencyIds);
  const bounds = await resolveDayBounds(viewer, requestedAgencyIds);
  const userIds = await filterVisibleUserIds(viewer, requestedUserIds);
  const nameById = await loadUserNames(userIds);

  const baseCtx = await buildCollectContextBase(viewer, subCompanyScope, userIds, bounds, nameById, {
    filter: 'all',
  });
  const itemsAll = await collectAllItems({ ...baseCtx, filter: 'all' });
  const itemsActionToday = await collectAllItems({ ...baseCtx, filter: 'action_today' });
  const itemsCompletedToday = await collectAllItems({ ...baseCtx, filter: 'completed_today' });
  const actionTodayByUser = buildActionTodayByUser(itemsActionToday);
  const completedTodayByUser = buildCompletedTodayByUser(itemsCompletedToday);
  const byUser = aggregateCountersByUser(itemsAll);
  const byUserId: Record<string, DailyActivityCounters> = {};
  for (const [id, c] of byUser) {
    byUserId[id] = withAgendaCounts(c, id, actionTodayByUser, completedTodayByUser);
  }
  return { byUserId, bounds };
}
