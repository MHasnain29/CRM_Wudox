/**
 * Hubstaff API client + sync logic.
 *
 * Auth: a Hubstaff Personal Access Token (created at developer.hubstaff.com)
 * acts as an OAuth refresh token. It is exchanged at account.hubstaff.com for
 * a 24h access token, and Hubstaff ROTATES the refresh token on every exchange
 * — the new value must be persisted immediately or the connection breaks.
 *
 * Data: daily per-user/per-project activity rolls up from
 * GET /v2/organizations/{org}/activities/daily (max 31-day window per call).
 */
import prisma from '../config/database';
import type { HubstaffConfig } from '@prisma/client';

const TOKEN_URL = 'https://account.hubstaff.com/access_tokens';
const API_BASE = 'https://api.hubstaff.com/v2';

export class HubstaffError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'HubstaffError';
  }
}

// ── Token handling ────────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** Exchange a refresh token (PAT) for an access token. Returns the rotated pair. */
export async function exchangeRefreshToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new HubstaffError(
      `Hubstaff token exchange failed (${res.status})${body ? `: ${body.slice(0, 200)}` : ''}. The personal access token may be invalid or expired — reconnect in Settings.`,
      res.status,
    );
  }
  return (await res.json()) as TokenResponse;
}

/**
 * Returns a valid access token for the config, refreshing (and persisting the
 * rotated refresh token) when the current one is missing or near expiry.
 */
async function getAccessToken(config: HubstaffConfig): Promise<string> {
  const bufferMs = 5 * 60 * 1000;
  if (
    config.accessToken &&
    config.accessTokenExpiresAt &&
    config.accessTokenExpiresAt.getTime() - bufferMs > Date.now()
  ) {
    return config.accessToken;
  }

  const tokens = await exchangeRefreshToken(config.refreshToken);
  const updated = await prisma.hubstaffConfig.update({
    where: { id: config.id },
    data: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
  });
  // Keep the in-memory object current for subsequent calls in the same request
  config.accessToken = updated.accessToken;
  config.refreshToken = updated.refreshToken;
  config.accessTokenExpiresAt = updated.accessTokenExpiresAt;
  return tokens.access_token;
}

// ── API client ────────────────────────────────────────────────────────────────

async function hubstaffGet<T>(config: HubstaffConfig, path: string, params?: URLSearchParams): Promise<T> {
  const token = await getAccessToken(config);
  const url = `${API_BASE}${path}${params && params.size > 0 ? `?${params}` : ''}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new HubstaffError(`Hubstaff API error ${res.status} on ${path}${body ? `: ${body.slice(0, 200)}` : ''}`, res.status);
  }
  return (await res.json()) as T;
}

/** Follows page_start_id pagination and returns the concatenation of extract() per page. */
async function hubstaffGetAll<TPage, TItem>(
  config: HubstaffConfig,
  path: string,
  baseParams: Record<string, string | string[]>,
  extract: (page: TPage) => TItem[],
): Promise<{ items: TItem[]; pages: TPage[] }> {
  const items: TItem[] = [];
  const pages: TPage[] = [];
  let pageStartId: number | undefined;

  for (let i = 0; i < 50; i++) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(baseParams)) {
      if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
      else params.append(key, value);
    }
    params.append('page_limit', '500');
    if (pageStartId !== undefined) params.append('page_start_id', String(pageStartId));

    const page = await hubstaffGet<TPage & { pagination?: { next_page_start_id?: number } }>(config, path, params);
    pages.push(page);
    items.push(...extract(page));

    const next = page.pagination?.next_page_start_id;
    if (next === undefined || next === null) break;
    pageStartId = next;
  }
  return { items, pages };
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
  membership_role?: string;
  removed_at?: string | null;
}

export interface HubstaffProject {
  id: number;
  name: string;
  status?: string;
}

export interface HubstaffDailyActivityRecord {
  id: number;
  date: string; // YYYY-MM-DD
  user_id: number;
  project_id: number | null;
  tracked: number;
  keyboard: number;
  mouse: number;
  overall: number;
  input_tracked: number;
  manual: number;
  idle: number;
  billable: number;
}

/** List organizations visible to a token without a stored config (used at connect time). */
export async function listOrganizationsForToken(refreshToken: string): Promise<{
  organizations: HubstaffOrganization[];
  tokens: TokenResponse;
}> {
  const tokens = await exchangeRefreshToken(refreshToken);
  const res = await fetch(`${API_BASE}/organizations?page_limit=100`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!res.ok) {
    throw new HubstaffError(`Failed to list Hubstaff organizations (${res.status})`, res.status);
  }
  const body = (await res.json()) as { organizations: HubstaffOrganization[] };
  return { organizations: body.organizations ?? [], tokens };
}

export async function listMembers(config: HubstaffConfig): Promise<{ members: HubstaffMember[]; users: HubstaffUser[] }> {
  const { items, pages } = await hubstaffGetAll<
    { members: HubstaffMember[]; users?: HubstaffUser[] },
    HubstaffMember
  >(config, `/organizations/${config.hubstaffOrgId}/members`, { 'include[]': 'users' }, (p) => p.members ?? []);
  const users = pages.flatMap((p) => p.users ?? []);
  return { members: items, users };
}

export async function listProjects(config: HubstaffConfig): Promise<HubstaffProject[]> {
  const { items } = await hubstaffGetAll<{ projects: HubstaffProject[] }, HubstaffProject>(
    config,
    `/organizations/${config.hubstaffOrgId}/projects`,
    { status: 'all' },
    (p) => p.projects ?? [],
  );
  return items;
}

async function fetchDailyActivities(config: HubstaffConfig, start: string, stop: string): Promise<HubstaffDailyActivityRecord[]> {
  const { items } = await hubstaffGetAll<
    { daily_activities: HubstaffDailyActivityRecord[] },
    HubstaffDailyActivityRecord
  >(
    config,
    `/organizations/${config.hubstaffOrgId}/activities/daily`,
    { 'date[start]': start, 'date[stop]': stop },
    (p) => p.daily_activities ?? [],
  );
  return items;
}

// ── User link management ──────────────────────────────────────────────────────

/**
 * Refreshes the HubstaffUserLink rows from the org member list.
 * New Hubstaff users are auto-matched to CRM users by email (case-insensitive);
 * manual links are never overwritten.
 */
export async function syncUserLinks(config: HubstaffConfig): Promise<number> {
  const { members, users } = await listMembers(config);
  const usersById = new Map(users.map((u) => [u.id, u]));

  const crmUsers = await prisma.user.findMany({
    where: { subCompanyId: config.subCompanyId, isActive: true },
    select: { id: true, email: true },
  });
  const crmUsersByEmail = new Map(crmUsers.map((u) => [u.email.toLowerCase(), u.id]));

  let created = 0;
  for (const member of members) {
    if (member.removed_at) continue;
    const hubstaffUser = usersById.get(member.user_id);
    const email = hubstaffUser?.email?.toLowerCase();

    const existing = await prisma.hubstaffUserLink.findUnique({
      where: { configId_hubstaffUserId: { configId: config.id, hubstaffUserId: member.user_id } },
    });
    if (existing) {
      // Keep name/email fresh; never touch an established mapping
      await prisma.hubstaffUserLink.update({
        where: { id: existing.id },
        data: { hubstaffName: hubstaffUser?.name ?? existing.hubstaffName, hubstaffEmail: hubstaffUser?.email ?? existing.hubstaffEmail },
      });
      continue;
    }

    const matchedUserId = email ? crmUsersByEmail.get(email) ?? null : null;
    await prisma.hubstaffUserLink.create({
      data: {
        configId: config.id,
        subCompanyId: config.subCompanyId,
        hubstaffUserId: member.user_id,
        hubstaffName: hubstaffUser?.name,
        hubstaffEmail: hubstaffUser?.email,
        userId: matchedUserId,
        autoMatched: matchedUserId !== null,
      },
    });
    created++;
  }
  return created;
}

// ── Activity sync ─────────────────────────────────────────────────────────────

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Pulls daily activities for [startDate, endDate] (inclusive, YYYY-MM-DD) and
 * upserts HubstaffDailyActivity rows, attributing each to a CRM user via the
 * link table. Splits ranges into ≤31-day windows (Hubstaff API limit).
 */
export async function syncActivities(
  config: HubstaffConfig,
  startDate: string,
  endDate: string,
): Promise<{ upserted: number }> {
  const projects = await listProjects(config).catch(() => [] as HubstaffProject[]);
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));

  const links = await prisma.hubstaffUserLink.findMany({ where: { configId: config.id } });
  const userIdByHubstaffId = new Map(links.map((l) => [l.hubstaffUserId, l.userId]));

  let upserted = 0;
  let windowStart = new Date(`${startDate}T00:00:00Z`);
  const rangeEnd = new Date(`${endDate}T00:00:00Z`);

  while (windowStart <= rangeEnd) {
    const windowEnd = new Date(windowStart);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + 30);
    const stop = windowEnd < rangeEnd ? windowEnd : rangeEnd;

    const records = await fetchDailyActivities(config, toDateOnly(windowStart), toDateOnly(stop));

    for (const rec of records) {
      const hubstaffProjectId = rec.project_id ?? 0;
      const date = new Date(`${rec.date}T00:00:00Z`);
      const data = {
        userId: userIdByHubstaffId.get(rec.user_id) ?? null,
        projectName: projectNames.get(hubstaffProjectId) ?? null,
        trackedSeconds: rec.tracked ?? 0,
        keyboardSeconds: rec.keyboard ?? 0,
        mouseSeconds: rec.mouse ?? 0,
        overallSeconds: rec.overall ?? 0,
        inputTrackedSeconds: rec.input_tracked ?? 0,
        manualSeconds: rec.manual ?? 0,
        idleSeconds: rec.idle ?? 0,
        billableSeconds: rec.billable ?? 0,
      };
      await prisma.hubstaffDailyActivity.upsert({
        where: {
          subCompanyId_hubstaffUserId_date_hubstaffProjectId: {
            subCompanyId: config.subCompanyId,
            hubstaffUserId: rec.user_id,
            date,
            hubstaffProjectId,
          },
        },
        create: {
          subCompanyId: config.subCompanyId,
          hubstaffUserId: rec.user_id,
          date,
          hubstaffProjectId,
          ...data,
        },
        update: data,
      });
      upserted++;
    }

    windowStart = new Date(stop);
    windowStart.setUTCDate(windowStart.getUTCDate() + 1);
  }

  return { upserted };
}

/** Full sync for one config: refresh user links, then pull activities. */
export async function runHubstaffSync(
  config: HubstaffConfig,
  startDate: string,
  endDate: string,
): Promise<{ upserted: number; newLinks: number }> {
  try {
    const newLinks = await syncUserLinks(config);
    const { upserted } = await syncActivities(config, startDate, endDate);
    await prisma.hubstaffConfig.update({
      where: { id: config.id },
      data: { lastSyncAt: new Date(), lastSyncError: null },
    });
    return { upserted, newLinks };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.hubstaffConfig
      .update({ where: { id: config.id }, data: { lastSyncError: message.slice(0, 1000) } })
      .catch(() => {});
    throw err;
  }
}
