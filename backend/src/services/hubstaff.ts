/** Read-only Hubstaff import. Task ownership and completion remain in Hubstaff. */
import { randomUUID } from 'crypto';
import prisma from '../config/database';
import type { HubstaffConfig, Prisma } from '@prisma/client';
import { decryptSecret, encryptSecret } from '../utils/secretsCrypto';
import { resolveAllowedSubCompanyIds } from '../config/agencyScope';
import {
  aggregateActivities,
  dateOnly,
  normalizeActivity,
  observedCompletion,
  providerId,
  retryDelay,
  sourceTimestamp,
  taskKey,
  completedStatus,
  sourceUrl,
  taskTransition,
  type DailyActivityRecord,
  type TimeTask,
} from './hubstaffData';

const TOKEN_URL = 'https://account.hubstaff.com/access_tokens';
const API_BASE = 'https://api.hubstaff.com/v2';
const TASKS_BASE = 'https://tasks.hubstaff.com/api/v1';
const LEASE_MS = 5 * 60 * 1000;
const activeLeases = new Map<string, { owner: string; lost: boolean }>();
export class HubstaffError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message);
    this.name = 'HubstaffError';
  }
}
interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}
export interface HubstaffOrganization {
  id: number;
  name: string;
  status?: string;
}
export interface HubstaffUser {
  id: number;
  name: string;
  email?: string;
}
export interface HubstaffMember {
  user_id: number;
  removed_at?: string | null;
}
export interface HubstaffProject {
  id: number;
  name: string;
  status?: string;
}
export type HubstaffDailyActivityRecord = DailyActivityRecord;

/** DB lease covers background/manual imports, re-mapping, and rotating refresh tokens. */
export async function withHubstaffLease<T>(
  configId: string,
  action: (config: HubstaffConfig) => Promise<T>
): Promise<T> {
  const owner = randomUUID();
  const claimed = await prisma.hubstaffConfig.updateMany({
    where: { id: configId, OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lt: new Date() } }] },
    data: { syncLeaseOwner: owner, syncLeaseUntil: new Date(Date.now() + LEASE_MS) },
  });
  if (claimed.count !== 1)
    throw new HubstaffError(
      'Hubstaff is already syncing. Try again after the current sync finishes.',
      409
    );
  const state = { owner, lost: false };
  activeLeases.set(configId, state);
  const heartbeat = setInterval(() => {
    void prisma.hubstaffConfig
      .updateMany({
        where: { id: configId, syncLeaseOwner: owner },
        data: { syncLeaseUntil: new Date(Date.now() + LEASE_MS) },
      })
      .then(r => {
        if (r.count !== 1) state.lost = true;
      })
      .catch(() => {
        state.lost = true;
      });
  }, 30_000);
  heartbeat.unref();
  try {
    const current = await prisma.hubstaffConfig.findUniqueOrThrow({ where: { id: configId } });
    return await action(current);
  } finally {
    clearInterval(heartbeat);
    if (activeLeases.get(configId)?.owner === owner) activeLeases.delete(configId);
    await prisma.hubstaffConfig.updateMany({
      where: { id: configId, syncLeaseOwner: owner },
      data: { syncLeaseOwner: null, syncLeaseUntil: null },
    });
  }
}
async function assertLease(config: HubstaffConfig): Promise<void> {
  const lease = activeLeases.get(config.id);
  if (!lease || lease.lost)
    throw new HubstaffError(
      'Hubstaff sync lease was lost; no partial snapshot was published.',
      409
    );
  const renewed = await prisma.hubstaffConfig.updateMany({
    where: { id: config.id, syncLeaseOwner: lease.owner, syncLeaseUntil: { gt: new Date() } },
    data: { syncLeaseUntil: new Date(Date.now() + LEASE_MS) },
  });
  if (renewed.count !== 1) {
    lease.lost = true;
    throw new HubstaffError('Hubstaff sync lease expired.', 409);
  }
}

/** Do not automatically retry token exchanges: an uncertain result may have rotated the token. */
export async function exchangeRefreshToken(refreshToken: string): Promise<TokenResponse> {
  // Fail before rotating a credential if the configured encryption key is unavailable.
  encryptSecret('hubstaff-key-check');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(20_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: decryptSecret(refreshToken),
    }),
  });
  if (!response.ok)
    throw new HubstaffError(
      `Hubstaff token exchange failed (${response.status}). Reconnect in Settings.`,
      response.status
    );
  const tokens = (await response.json()) as TokenResponse;
  if (!tokens.access_token || !tokens.refresh_token || !Number.isFinite(tokens.expires_in))
    throw new HubstaffError('Invalid Hubstaff token response');
  return tokens;
}
async function getAccessToken(config: HubstaffConfig): Promise<string> {
  await assertLease(config);
  if (
    config.accessToken &&
    config.accessTokenExpiresAt &&
    config.accessTokenExpiresAt.getTime() > Date.now() + 300_000
  ) {
    return decryptSecret(config.accessToken);
  }
  const tokens = await exchangeRefreshToken(config.refreshToken);
  const data = {
    accessToken: encryptSecret(tokens.access_token),
    refreshToken: encryptSecret(tokens.refresh_token),
    accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
  };
  const saved = await prisma.hubstaffConfig.updateMany({
    where: { id: config.id, syncLeaseOwner: activeLeases.get(config.id)!.owner },
    data,
  });
  if (saved.count !== 1)
    throw new HubstaffError(
      'Could not safely persist the rotated Hubstaff token. Reconnect in Settings.'
    );
  Object.assign(config, data);
  return tokens.access_token;
}
export async function hubstaffReadJson<T>(url: string, token: string): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      if (attempt === 3)
        throw new HubstaffError('Hubstaff request timed out or could not connect.');
      await new Promise(resolve => setTimeout(resolve, retryDelay(null, attempt)));
      continue;
    }
    if (response.ok) return (await response.json()) as T;
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      const delay = retryDelay(response.headers.get('retry-after'), attempt);
      // Honor long rate-limit windows by failing this run; the next scheduled run retries.
      if (delay > 30_000)
        throw new HubstaffError(
          'Hubstaff rate limit reached. A later sync will retry.',
          response.status
        );
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }
    throw new HubstaffError(
      `Hubstaff read failed (${response.status}) on ${new URL(url).pathname}.`,
      response.status
    );
  }
  throw new HubstaffError('Hubstaff request failed');
}
async function getAll<T>(
  config: HubstaffConfig,
  path: string,
  field: string,
  baseParams: Record<string, string | string[]> = {},
  base = API_BASE
): Promise<{ items: T[]; pages: Record<string, unknown>[] }> {
  const items: T[] = [];
  const pages: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let count = 0; count < 1000; count++) {
    const params = new URLSearchParams({ page_limit: '500' });
    for (const [key, value] of Object.entries(baseParams)) {
      if (Array.isArray(value)) value.forEach(v => params.append(key, v));
      else params.set(key, value);
    }
    if (cursor) params.set('page_start_id', cursor);
    const token = await getAccessToken(config);
    const page = await hubstaffReadJson<
      Record<string, unknown> & { pagination?: { next_page_start_id?: number | string } }
    >(`${base}${path}?${params}`, token);
    if (!Array.isArray(page[field]))
      throw new HubstaffError(
        `Hubstaff returned an invalid ${field} response; previous data was retained.`
      );
    items.push(...(page[field] as T[]));
    pages.push(page);
    const next = page.pagination?.next_page_start_id;
    if (next == null) return { items, pages };
    cursor = String(next);
    if (seen.has(cursor))
      throw new HubstaffError('Hubstaff pagination repeated a cursor; previous data was retained.');
    seen.add(cursor);
  }
  throw new HubstaffError(
    'Hubstaff pagination exceeded the safety limit; previous data was retained.'
  );
}
export async function listOrganizationsForToken(
  refreshToken: string
): Promise<{ organizations: HubstaffOrganization[]; tokens: TokenResponse }> {
  const tokens = await exchangeRefreshToken(refreshToken);
  const organizations: HubstaffOrganization[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 1000; page++) {
    const params = new URLSearchParams({ page_limit: '500' });
    if (cursor) params.set('page_start_id', cursor);
    const body = await hubstaffReadJson<{
      organizations: HubstaffOrganization[];
      pagination?: { next_page_start_id?: number };
    }>(`${API_BASE}/organizations?${params}`, tokens.access_token);
    if (!Array.isArray(body.organizations))
      throw new HubstaffError('Invalid Hubstaff organization response');
    organizations.push(...body.organizations);
    if (body.pagination?.next_page_start_id == null) return { organizations, tokens };
    cursor = String(body.pagination.next_page_start_id);
    if (seen.has(cursor)) break;
    seen.add(cursor);
  }
  throw new HubstaffError('Unable to read the complete organization list. Reconnect in Settings.');
}
export async function listMembers(
  config: HubstaffConfig
): Promise<{ members: HubstaffMember[]; users: HubstaffUser[] }> {
  const { items, pages } = await getAll<HubstaffMember>(
    config,
    `/organizations/${config.hubstaffOrgId}/members`,
    'members',
    { 'include[]': 'users' }
  );
  return {
    members: items,
    users: pages.flatMap(page => (Array.isArray(page.users) ? (page.users as HubstaffUser[]) : [])),
  };
}
export async function listProjects(config: HubstaffConfig): Promise<HubstaffProject[]> {
  const { items } = await getAll<HubstaffProject>(
    config,
    `/organizations/${config.hubstaffOrgId}/projects`,
    'projects',
    { status: 'all' }
  );
  return items;
}
export async function eligibleHubstaffUsers(config: HubstaffConfig) {
  const mappings = await prisma.hubstaffProjectMapping.findMany({
    where: { configId: config.id },
    select: { subCompanyId: true },
  });
  const agencyIds = new Set([config.subCompanyId, ...mappings.map(m => m.subCompanyId)]);
  const candidates = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [{ subCompanyId: { in: [...agencyIds] } }, { subCompanyId: null }],
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      subCompanyId: true,
    },
  });
  const eligible = [];
  for (const user of candidates) {
    if (user.subCompanyId && agencyIds.has(user.subCompanyId)) {
      eligible.push(user);
      continue;
    }
    const allowed = await resolveAllowedSubCompanyIds({
      sub: user.id,
      email: user.email,
      role: user.role,
      subCompanyId: user.subCompanyId ?? '',
    });
    if (allowed.some(id => agencyIds.has(id))) eligible.push(user);
  }
  return eligible;
}
export async function syncUserLinks(config: HubstaffConfig): Promise<number> {
  const { members, users } = await listMembers(config);
  const byId = new Map(users.map(user => [user.id, user]));
  const crmUsers = await eligibleHubstaffUsers(config);
  const byEmail = new Map(crmUsers.map(user => [user.email.toLowerCase(), user.id]));
  let created = 0;
  for (const member of members) {
    if (member.removed_at) continue;
    const user = byId.get(member.user_id);
    const existing = await prisma.hubstaffUserLink.findUnique({
      where: { configId_hubstaffUserId: { configId: config.id, hubstaffUserId: member.user_id } },
    });
    const metadata = { hubstaffName: user?.name, hubstaffEmail: user?.email };
    if (existing) {
      await prisma.hubstaffUserLink.update({ where: { id: existing.id }, data: metadata });
    } else {
      const userId = user?.email ? (byEmail.get(user.email.toLowerCase()) ?? null) : null;
      await prisma.hubstaffUserLink.create({
        data: {
          configId: config.id,
          subCompanyId: config.subCompanyId,
          hubstaffUserId: member.user_id,
          ...metadata,
          userId,
          autoMatched: userId !== null,
        },
      });
      created++;
    }
  }
  return created;
}

interface TasksProductTask {
  id: number;
  subject?: string;
  done?: boolean;
  status?: string;
  estimate_hours?: number | null;
  url?: string | null;
  done_at?: string | null;
  due_at?: string | null;
  updated_at?: string | null;
}
async function fetchTaskEnrichment(config: HubstaffConfig): Promise<Map<string, TasksProductTask>> {
  const result = new Map<string, TasksProductTask>();
  if (!config.tasksOrganizationId || !config.tasksIntegrationId) return result;
  const integrations = await getAll<{ id: number; type: string }>(
    config,
    `/organizations/${config.hubstaffOrgId}/integrations`,
    'integrations'
  );
  const integration = integrations.items.find(item => item.id === config.tasksIntegrationId);
  if (
    !integration ||
    !integration.type
      .toLowerCase()
      .replace(/[^a-z]/g, '')
      .includes('hubstafftasks')
  ) {
    throw new HubstaffError(
      'The selected integration is not a verified Hubstaff Tasks integration.'
    );
  }
  const projects = new Map<number, { id: number }>();
  for (const status of ['active', 'archived']) {
    const page = await getAll<{ id: number }>(
      config,
      `/organizations/${config.tasksOrganizationId}/projects`,
      'projects',
      { status },
      TASKS_BASE
    );
    for (const project of page.items) projects.set(project.id, project);
  }
  for (const project of projects.values()) {
    const tasks = await getAll<TasksProductTask>(
      config,
      `/projects/${project.id}/tasks`,
      'tasks',
      { removed: 'true' },
      TASKS_BASE
    );
    for (const task of tasks.items) result.set(String(task.id), task);
  }
  return result;
}
async function syncTaskSnapshots(
  config: HubstaffConfig
): Promise<{ status: string; error: string | null }> {
  let tasks: TimeTask[];
  try {
    ({ items: tasks } = await getAll<TimeTask>(
      config,
      `/organizations/${config.hubstaffOrgId}/tasks`,
      'tasks',
      {
        'status[]': [
          'active',
          'completed',
          'deleted',
          'archived',
          'archived_native_active',
          'archived_native_completed',
          'archived_native_deleted',
        ],
      }
    ));
  } catch (err) {
    const status =
      err instanceof HubstaffError && [401, 403, 404].includes(err.status ?? 0)
        ? 'unavailable'
        : 'error';
    return { status, error: err instanceof Error ? err.message : 'Task import failed' };
  }
  let enriched = new Map<string, TasksProductTask>();
  let enrichmentError: string | null = null;
  try {
    enriched = await fetchTaskEnrichment(config);
  } catch (err) {
    enrichmentError = err instanceof Error ? err.message : 'Tasks estimates unavailable';
  }
  const previous = await prisma.hubstaffTask.findMany({
    where: { configId: config.id },
    select: {
      taskKey: true,
      status: true,
      completionObservedAt: true,
      providerUpdatedAt: true,
      completedAt: true,
      dueAt: true,
      estimateSeconds: true,
      sourceUrl: true,
      source: true,
      rawJson: true,
    },
  });
  const priorByKey = new Map(previous.map(task => [task.taskKey, task]));
  const now = new Date();
  const uniqueTasks = new Map<string, TimeTask>();
  for (const task of tasks) {
    const id = providerId(task.id);
    if (!id) throw new HubstaffError('Invalid Hubstaff task identity');
    const duplicate = uniqueTasks.get(id);
    if (duplicate && JSON.stringify(duplicate) !== JSON.stringify(task))
      throw new HubstaffError(
        'Conflicting task snapshots were returned; previous task data was retained.'
      );
    uniqueTasks.set(id, task);
  }
  const data = [...uniqueTasks.values()].map(task => {
    const key = taskKey(task.id);
    if (!key || typeof task.summary !== 'string' || typeof task.status !== 'string')
      throw new HubstaffError('Invalid Hubstaff task snapshot');
    const prior = priorByKey.get(key);
    const priorRaw =
      prior?.rawJson && typeof prior.rawJson === 'object' && !Array.isArray(prior.rawJson)
        ? prior.rawJson
        : {};
    const staleEnrichment = Boolean(enrichmentError && prior?.source === 'hubstaff_tasks');
    const extra =
      task.integration_id === config.tasksIntegrationId && task.remote_id
        ? enriched.get(task.remote_id)
        : undefined;
    const status = staleEnrichment
      ? (prior?.status ?? task.status)
      : extra && typeof extra.done === 'boolean' && !task.status.includes('deleted')
        ? extra.done
          ? 'completed'
          : 'active'
        : task.status;
    const completedAt = completedStatus(status)
      ? staleEnrichment
        ? (prior?.completedAt ?? null)
        : sourceTimestamp(extra?.done_at ?? task.completed_at)
      : null;
    return {
      configId: config.id,
      hubstaffOrgId: config.hubstaffOrgId,
      taskKey: key,
      hubstaffTaskId: providerId(task.id),
      globalTodoId: providerId(task.global_todo_id),
      projectManagementId:
        task.integration_id === config.tasksIntegrationId ? (task.remote_id ?? null) : null,
      hubstaffProjectId: task.project_id,
      name: extra?.subject ?? task.summary,
      status,
      completedAt,
      completionObservedAt: completedStatus(status)
        ? (observedCompletion(prior?.status, status, now) ?? prior?.completionObservedAt ?? null)
        : null,
      estimateSeconds: staleEnrichment
        ? (prior?.estimateSeconds ?? null)
        : extra?.estimate_hours != null &&
            Number.isFinite(extra.estimate_hours) &&
            extra.estimate_hours >= 0
          ? Math.round(extra.estimate_hours * 3600)
          : null,
      assigneeIds: (task.assignee_ids ?? []).filter(Number.isSafeInteger),
      dueAt: staleEnrichment
        ? (prior?.dueAt ?? null)
        : sourceTimestamp(extra?.due_at ?? task.due_at),
      providerUpdatedAt: sourceTimestamp(task.updated_at),
      source: extra || staleEnrichment ? 'hubstaff_tasks' : 'hubstaff_time',
      sourceUrl: staleEnrichment ? (prior?.sourceUrl ?? null) : sourceUrl(extra?.url ?? task.url),
      isDeleted: status.includes('deleted'),
      lastSeenAt: now,
      rawJson: JSON.parse(
        JSON.stringify({
          time: task,
          ...(extra
            ? { tasks: extra }
            : staleEnrichment && priorRaw.tasks
              ? { tasks: priorRaw.tasks }
              : {}),
          enrichmentStatus: staleEnrichment
            ? 'stale'
            : extra
              ? 'available'
              : config.tasksOrganizationId
                ? 'unavailable'
                : 'not_configured',
        })
      ) as Prisma.InputJsonValue,
    };
  });
  await assertLease(config);
  await prisma.$transaction(
    async tx => {
      for (const row of data) {
        const prior = priorByKey.get(row.taskKey);
        if (
          prior?.providerUpdatedAt &&
          row.providerUpdatedAt &&
          row.providerUpdatedAt < prior.providerUpdatedAt
        ) {
          await tx.hubstaffTask.updateMany({
            where: { configId: config.id, taskKey: row.taskKey },
            data: { lastSeenAt: now },
          });
          continue;
        }
        await tx.hubstaffTask.upsert({
          where: { configId_taskKey: { configId: config.id, taskKey: row.taskKey } },
          create: row,
          update: row,
        });
        const transition = taskTransition(prior?.status, row.status);
        if (transition)
          await tx.hubstaffTaskEvent.create({
            data: {
              configId: config.id,
              hubstaffOrgId: config.hubstaffOrgId,
              taskKey: row.taskKey,
              type: transition,
              fromStatus: prior?.status,
              toStatus: row.status,
              assigneeIds: row.assigneeIds,
              observedAt: now,
              occurredAt: transition === 'completed' ? row.completedAt : null,
            },
          });
      }
      await tx.hubstaffTask.updateMany({
        where: { configId: config.id, lastSeenAt: { lt: now } },
        data: { isDeleted: true },
      });
    },
    { timeout: 120_000 }
  );
  return {
    status:
      enrichmentError && previous.some(task => task.source === 'hubstaff_tasks')
        ? 'partial'
        : 'available',
    error: enrichmentError,
  };
}

export async function lockHubstaffAgencies(
  tx: Prisma.TransactionClient,
  agencies: string[]
): Promise<void> {
  for (const agency of [...new Set(agencies)].sort()) {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `hubstaff_daily:${agency}`
    );
  }
}
/** Call while holding the agency locks, after changing canonical rows. */
export async function rebuildHubstaffDaily(
  tx: Prisma.TransactionClient,
  agencies: string[],
  date?: { gte: Date; lte: Date }
): Promise<void> {
  // Multiple organizations may contribute projects to one CRM agency. Rebuild from
  // every canonical source, so one connection never erases another's daily totals.
  const all = await tx.hubstaffTaskActivity.findMany({
    where: { subCompanyId: { in: agencies }, date },
  });
  const names = await tx.hubstaffProjectMapping.findMany({
    where: { subCompanyId: { in: agencies } },
  });
  const nameByProject = new Map(
    names.map(mapping => [`${mapping.configId}:${mapping.hubstaffProjectId}`, mapping.projectName])
  );
  const groups = new Map<string, Prisma.HubstaffDailyActivityCreateManyInput>();
  for (const row of all) {
    const key = `${row.subCompanyId}:${row.hubstaffUserId}:${row.date.toISOString()}:${row.hubstaffProjectId}`;
    const existing = groups.get(key);
    if (existing) {
      for (const field of [
        'trackedSeconds',
        'keyboardSeconds',
        'mouseSeconds',
        'overallSeconds',
        'inputTrackedSeconds',
        'manualSeconds',
        'idleSeconds',
        'billableSeconds',
      ] as const) {
        existing[field] = (existing[field] ?? 0) + row[field];
      }
      if (existing.userId !== row.userId) existing.userId = null;
    } else {
      groups.set(key, {
        subCompanyId: row.subCompanyId,
        hubstaffUserId: row.hubstaffUserId,
        userId: row.userId,
        date: row.date,
        hubstaffProjectId: row.hubstaffProjectId,
        projectName: nameByProject.get(`${row.configId}:${row.hubstaffProjectId}`) ?? null,
        trackedSeconds: row.trackedSeconds,
        keyboardSeconds: row.keyboardSeconds,
        mouseSeconds: row.mouseSeconds,
        overallSeconds: row.overallSeconds,
        inputTrackedSeconds: row.inputTrackedSeconds,
        manualSeconds: row.manualSeconds,
        idleSeconds: row.idleSeconds,
        billableSeconds: row.billableSeconds,
      });
    }
  }
  await tx.hubstaffDailyActivity.deleteMany({ where: { subCompanyId: { in: agencies }, date } });
  const daily = [...groups.values()];
  for (let offset = 0; offset < daily.length; offset += 1000) {
    await tx.hubstaffDailyActivity.createMany({ data: daily.slice(offset, offset + 1000) });
  }
}

export async function syncActivities(
  config: HubstaffConfig,
  startDate: string,
  endDate: string
): Promise<{ upserted: number }> {
  const projects = await listProjects(config); // Never erase names after a failed metadata fetch.
  for (const project of projects) {
    await prisma.hubstaffProjectMapping.upsert({
      where: { configId_hubstaffProjectId: { configId: config.id, hubstaffProjectId: project.id } },
      create: {
        configId: config.id,
        hubstaffProjectId: project.id,
        projectName: project.name,
        subCompanyId: config.subCompanyId,
      },
      update: { projectName: project.name },
    });
  }
  const mappings = await prisma.hubstaffProjectMapping.findMany({ where: { configId: config.id } });
  const byProject = new Map(mappings.map(mapping => [mapping.hubstaffProjectId, mapping]));
  const links = await prisma.hubstaffUserLink.findMany({ where: { configId: config.id } });
  const byUser = new Map(links.map(link => [link.hubstaffUserId, link.userId]));
  const taskRows = await prisma.hubstaffTask.findMany({
    where: { configId: config.id },
    select: { taskKey: true, globalTodoId: true },
  });
  const globalByTask = new Map(taskRows.map(task => [task.taskKey, task.globalTodoId]));
  const uniqueTaskByGlobal = new Map<string, string | null>();
  for (const task of taskRows) {
    if (!task.globalTodoId) continue;
    uniqueTaskByGlobal.set(
      task.globalTodoId,
      uniqueTaskByGlobal.has(task.globalTodoId) ? null : task.taskKey
    );
  }
  let windowStart = dateOnly(startDate);
  const rangeEnd = dateOnly(endDate);
  let upserted = 0;
  while (windowStart <= rangeEnd) {
    const windowEnd = new Date(
      Math.min(windowStart.getTime() + 30 * 86400_000, rangeEnd.getTime())
    );
    const fetched = await getAll<DailyActivityRecord>(
      config,
      `/organizations/${config.hubstaffOrgId}/activities/daily`,
      'daily_activities',
      {
        'date[start]': windowStart.toISOString().slice(0, 10),
        'date[stop]': windowEnd.toISOString().slice(0, 10),
      }
    );
    const normalized = fetched.items.map(normalizeActivity);
    if (normalized.some(row => row.date < windowStart || row.date > windowEnd))
      throw new HubstaffError('Hubstaff returned activity outside the requested date window');
    const { records } = aggregateActivities(normalized);
    const now = new Date();
    const canonical = records.map(row => ({
      ...row,
      taskKey: row.hubstaffTaskId
        ? row.taskKey
        : row.globalTodoId
          ? (uniqueTaskByGlobal.get(row.globalTodoId) ?? null)
          : null,
      configId: config.id,
      hubstaffOrgId: config.hubstaffOrgId,
      subCompanyId: byProject.get(row.hubstaffProjectId)?.subCompanyId ?? config.subCompanyId,
      userId: byUser.get(row.hubstaffUserId) ?? null,
      globalTodoId:
        row.globalTodoId ?? (row.taskKey ? (globalByTask.get(row.taskKey) ?? null) : null),
      syncedAt: now,
    }));
    await assertLease(config);
    // Publish only a fully fetched window, including source deletions and zeroed days.
    await prisma.$transaction(
      async tx => {
        const date = { gte: windowStart, lte: windowEnd };
        const old = await tx.hubstaffTaskActivity.findMany({
          where: { configId: config.id, date },
          select: { subCompanyId: true },
        });
        const agencies = [
          ...new Set([
            config.subCompanyId,
            ...old.map(row => row.subCompanyId),
            ...canonical.map(row => row.subCompanyId),
          ]),
        ];
        await lockHubstaffAgencies(tx, agencies);
        await tx.hubstaffTaskActivity.deleteMany({ where: { configId: config.id, date } });
        // PostgreSQL parameter limit: keep large historical windows in safe batches.
        for (let offset = 0; offset < canonical.length; offset += 1000) {
          await tx.hubstaffTaskActivity.createMany({
            data: canonical.slice(offset, offset + 1000),
          });
        }
        await rebuildHubstaffDaily(tx, agencies, date);
      },
      { timeout: 120_000 }
    );
    upserted += canonical.length;
    windowStart = new Date(windowEnd.getTime() + 86400_000);
  }
  return { upserted };
}

export async function runHubstaffSync(
  config: HubstaffConfig,
  startDate: string,
  endDate: string
): Promise<{ upserted: number; newLinks: number; taskStatus: string }> {
  dateOnly(startDate);
  dateOnly(endDate);
  if (startDate > endDate) throw new HubstaffError('startDate must be before endDate', 400);
  return withHubstaffLease(config.id, async current => {
    if (!current.syncEnabled || !current.refreshToken)
      throw new HubstaffError('Hubstaff is disconnected', 400);
    const duplicate = await prisma.hubstaffConfig.findFirst({
      where: { hubstaffOrgId: current.hubstaffOrgId, id: { not: current.id }, syncEnabled: true },
    });
    if (duplicate)
      throw new HubstaffError(
        'This Hubstaff organization has more than one CRM connection. Keep one connection and map its projects to agencies.'
      );
    const run = await prisma.hubstaffSyncRun.create({
      data: { configId: current.id, startDate: dateOnly(startDate), endDate: dateOnly(endDate) },
    });
    try {
      const newLinks = await syncUserLinks(current);
      const taskResult = await syncTaskSnapshots(current);
      const { upserted } = await syncActivities(current, startDate, endDate);
      await assertLease(current);
      const now = new Date();
      await prisma.$transaction([
        prisma.hubstaffConfig.update({
          where: { id: current.id },
          data: {
            lastSyncAt: now,
            lastSyncError: null,
            taskSyncStatus: taskResult.status,
            taskSyncError: taskResult.error,
            ...(taskResult.status === 'available' ? { lastTaskSyncAt: now } : {}),
          },
        }),
        prisma.hubstaffSyncRun.update({
          where: { id: run.id },
          data: {
            status: taskResult.status === 'available' ? 'complete' : 'partial',
            taskStatus: taskResult.status,
            activityRows: upserted,
            completedAt: now,
            error: taskResult.error,
          },
        }),
      ]);
      return { upserted, newLinks, taskStatus: taskResult.status };
    } catch (err) {
      const error = err instanceof Error ? err.message.slice(0, 1000) : 'Hubstaff sync failed';
      await prisma.hubstaffConfig.update({
        where: { id: current.id },
        data: { lastSyncError: error },
      });
      await prisma.hubstaffSyncRun.update({
        where: { id: run.id },
        data: { status: 'failed', completedAt: new Date(), error },
      });
      throw err;
    }
  });
}
