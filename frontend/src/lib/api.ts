/**
 * API client for Wudox CRM backend.
 * Base URL from VITE_API_URL (default https://staffing.wudox.ca).
 * Auth: Bearer token from authStore; optional refresh on 401.
 */

import type { ActivityLog } from './types';
import type { Country } from './countries';
import { useStore } from './store';
import { clearClientSessionData, TOKEN_KEY, REFRESH_KEY } from './sessionCache';
import {
  normalizeClientDestinationConfig,
  normalizeClientFlowConfig,
  isElevatedClientFlowConfig,
  type ClientDestinationConfig,
  type ClientFlowConfig,
} from './clientDestinationFlow';

import { API_BASE, API_PREFIX, getTunnelHeaders } from './apiConfig';
import { actAsHeader } from './actAsHeader';
import { ownerExactFlag } from './ownerExactFlag';
import type {
  CreateEmployeePayload,
  Employee,
  EmployeeCounts,
  EmployeeDocument,
} from './employeeTypes';

export type { CreateEmployeePayload, Employee, EmployeeCounts };

/** Attach ownerIds (+ ownerExact when the linked manager chip means "this person only"). */
function appendOwnerIds(
  sp: URLSearchParams,
  ownerIds: string[] | undefined,
  ownerExact?: boolean,
): void {
  if (!ownerIds?.length) return;
  sp.set('ownerIds', ownerIds.join(','));
  if (ownerExact ?? ownerExactFlag.get()) sp.set('ownerExact', '1');
}

/** Public company branding for login / embeds (no auth). Only returns configured name + logo. */
export interface PublicCompanyBranding {
  companyId: string | null;
  subCompanyId?: string | null;
  projectName: string;
  logoUrl: string | null;
}

/** GET /public/branding — single tenant (primary sub-company). */
export async function fetchPublicBranding(): Promise<PublicCompanyBranding | null> {
  const res = await fetch(`${API_PREFIX}/public/branding`, { headers: getTunnelHeaders() });
  if (!res.ok) return null;
  return (await res.json()) as PublicCompanyBranding;
}

function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function getAuthHeaders(): HeadersInit {
  const token = getStoredToken();
  const actAsId = actAsHeader.get();
  return {
    'Content-Type': 'application/json',
    ...getTunnelHeaders(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(actAsId ? { 'X-Act-As-User-Id': actAsId } : {}),
  };
}

/** User-facing message when `fetch` throws (e.g. backend down, wrong VITE_API_URL, CORS). */
function formatNetworkFetchError(err: unknown): string {
  if (err instanceof TypeError) {
    const m = err.message;
    if (m === 'Failed to fetch' || m.toLowerCase().includes('network')) {
      return `Cannot reach the API at ${API_BASE}. Check that the backend is running and that VITE_API_URL in frontend/.env points to it (CORS must allow this origin).`;
    }
  }
  if (err instanceof Error) return err.message;
  return 'Network request failed';
}

async function fetchJsonWithData<T>(
  url: string,
  init: RequestInit,
  fallbackErrorLabel: string,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, credentials: 'include' });
  } catch (e) {
    throw new Error(formatNetworkFetchError(e));
  }
  const text = await res.text();
  let parsed: { data?: T; error?: string; message?: string };
  try {
    parsed = text ? (JSON.parse(text) as { data?: T; error?: string; message?: string }) : {};
  } catch {
    if (!res.ok) {
      const snippet = text.trim().slice(0, 160);
      throw new Error(
        snippet ? `${fallbackErrorLabel} (${res.status}): ${snippet}` : `${fallbackErrorLabel} (${res.status})`,
      );
    }
    throw new Error('Invalid JSON response from server');
  }
  if (!res.ok) {
    const msg =
      (typeof parsed.error === 'string' && parsed.error) ||
      (typeof parsed.message === 'string' && parsed.message) ||
      `${fallbackErrorLabel} (${res.status})`;
    throw new Error(msg);
  }
  if (parsed.data === undefined) throw new Error('Missing data in response');
  return parsed.data;
}

let _refreshPromise: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    const refresh = getStoredRefreshToken();
    if (!refresh) return false;
    // Capture current token so we can detect if another tab refreshed while we were waiting
    const tokenSnapshot = getStoredToken();
    try {
      const res = await fetch(`${API_PREFIX}/auth/refresh-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getTunnelHeaders() },
        body: JSON.stringify({ refreshToken: refresh }),
        credentials: 'include',
      });
      if (!res.ok) {
        // Another tab may have already rotated the tokens (multi-tab race condition).
        // If localStorage now has a different access token, treat this as success.
        const currentToken = getStoredToken();
        if (currentToken && currentToken !== tokenSnapshot) return true;
        return false;
      }
      const data = await res.json();
      if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
      if (data.refreshToken) localStorage.setItem(REFRESH_KEY, data.refreshToken);
      return true;
    } catch {
      return false;
    }
  })().finally(() => { _refreshPromise = null; });
  return _refreshPromise;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<
  | { data: T; ok: true }
  | { data: null; ok: false; status: number; error?: string }
> {
  let url = path.startsWith('http') ? path : `${API_PREFIX}${path}`;
  // Auto-inject viewed agency scope for director-level users (skip if already present,
  // org-wide, or explicit all-agencies / catalog template list modes).
  const { viewedSubCompanyId } = useStore.getState();
  if (
    viewedSubCompanyId &&
    !url.includes('subCompanyId=') &&
    !url.includes('globalDb=true') &&
    !url.includes('allAgencies=') &&
    !url.includes('catalog=')
  ) {
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}subCompanyId=${encodeURIComponent(viewedSubCompanyId)}`;
  }
  let headers: HeadersInit = {
    ...getAuthHeaders(),
    ...(options.headers as Record<string, string>),
  };

  let res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401) {
    const refreshed = getStoredRefreshToken() ? await refreshTokens() : false;
    if (refreshed) {
      headers = { ...headers, ...getAuthHeaders() };
      res = await fetch(url, { ...options, headers, credentials: 'include' });
    } else {
      clearClientSessionData();
      window.location.href = '/login';
      return { data: null, ok: false, status: 401 };
    }
  }

  if (!res.ok) {
    let error: string | undefined;
    try {
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      error = body.error ?? body.message;
    } catch {
      // ignore parse errors
    }
    return { data: null, ok: false, status: res.status, error };
  }

  const contentType = res.headers.get('content-type');
  const data = contentType?.includes('application/json')
    ? ((await res.json()) as T)
    : (await res.text()) as unknown as T;
  return { data, ok: true };
}

/** POST /auth/forgot-password — request reset link (no auth) */
export async function forgotPassword(email: string): Promise<{ message: string }> {
  const res = await fetch(`${API_PREFIX}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getTunnelHeaders() },
    body: JSON.stringify({ email: email.trim() }),
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Request failed');
  return data as { message: string };
}

/** POST /auth/reset-password — set new password with token from email (no auth) */
export async function resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
  const res = await fetch(`${API_PREFIX}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getTunnelHeaders() },
    body: JSON.stringify({ token, newPassword }),
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Reset failed');
  return data as { message: string };
}

/** POST /auth/login */
export async function login(email: string, password: string) {
  const res = await fetch(`${API_PREFIX}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getTunnelHeaders() },
    body: JSON.stringify({ email: email.trim(), password }),
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error ?? 'Login failed');
  }
  return data as {
    user: ApiUser;
    token: string;
    refreshToken: string;
    expiresIn: string;
    roleLabel: string;
    permissions: string[];
    dataScopeLevel?: 'own' | 'team' | 'agency' | 'global';
  };
}

/** POST /auth/logout (optional body: { refreshToken }) */
export async function logout() {
  const refresh = getStoredRefreshToken();
  try {
    await fetch(`${API_PREFIX}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(refresh ? { refreshToken: refresh } : {}),
      credentials: 'include',
    });
  } catch {
    // ignore
  }
}

/** GET /auth/me — current user with roleLabel and permissions */
export async function fetchMe() {
  const result = await apiFetch<{
    roleLabel: string;
    permissions: string[];
    dataScopeLevel?: 'own' | 'team' | 'agency' | 'global';
  } & ApiUser>('/auth/me');
  if (!result.ok) return null;
  return result.data;
}

export interface ApiUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  country: string;
  role: string;
  userType: string;
  subCompanyId: string;
  locationId?: string | null;
  isActive: boolean;
  offboardingStartedAt?: string | null;
  reportingManagerIds?: string[];
  accessibleLocationIds?: string[];
  dailyCallsTarget?: number;
  dailyEmailsTarget?: number;
  dailyMeetingScheduleTarget?: number;
  workStartTime?: string;
  workEndTime?: string;
  subCompany?: {
    id: string;
    name: string;
    mainOrgId: string;
    appProjectName?: string | null;
    logoUrl?: string | null;
    agencyLogoUrl?: string | null;
    agencyEmail?: string | null;
    agencyPhone?: string | null;
    emailFooterText?: string | null;
    emailTagline?: string | null;
    emailSendAsDomain?: string | null;
  };
  location?: { id: string; name: string; address?: string; country: string; isActive: boolean } | null;
  canActAsAdmin?: boolean;
}

/** GET /users — list users for an agency (excludes super users). Pass subCompanyId when viewing as super_admin/director to get that agency's users. Requires users:read. */
export async function fetchAllowedEmailDomains(): Promise<string[]> {
  const res = await apiFetch<{ domains: string[] }>('/users/allowed-email-domains');
  return res.ok ? (res.data?.domains ?? []) : [];
}

export async function fetchUsers(params?: { subCompanyId?: string }): Promise<ApiUser[]> {
  const search = params?.subCompanyId ? `?subCompanyId=${encodeURIComponent(params.subCompanyId)}` : '';
  const res = await apiFetch<{ data: ApiUser[] }>(`/users${search}`);
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

/** GET /users/scope-filter — agency users for elevated filter chips (includes company_director, etc.). */
export async function fetchScopeFilterUsers(subCompanyId: string): Promise<ApiUser[]> {
  const res = await apiFetch<{ data: ApiUser[] }>(
    `/users/scope-filter?subCompanyId=${encodeURIComponent(subCompanyId)}`,
  );
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

export interface UserHierarchyNodeUser {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  roleLabel: string;
}

export interface UserHierarchyNode {
  user: UserHierarchyNodeUser;
  isUnassignedGroup?: boolean;
  children: UserHierarchyNode[];
}

export interface UserHierarchyResponse {
  tree?: UserHierarchyNode[];
  /** Single-agency context (elevated roles with one agency selected). */
  agency?: { id: string; name: string };
  agencies?: { id: string; name: string; tree: UserHierarchyNode[] }[];
}

/** GET /users/hierarchy — reporting tree (elevated roles and managers). */
export async function fetchUserHierarchy(params?: {
  subCompanyId?: string;
}): Promise<UserHierarchyResponse> {
  const search = params?.subCompanyId ? `?subCompanyId=${encodeURIComponent(params.subCompanyId)}` : '';
  const res = await apiFetch<{ data: UserHierarchyResponse }>(`/users/hierarchy${search}`);
  if (!res.ok) return {};
  return res.data?.data ?? {};
}

/** POST /users/sync-default-targets — backfill users with 0 stored targets to the current agency defaults. */
export async function syncDefaultTargets(): Promise<void> {
  await apiFetch('/users/sync-default-targets', { method: 'POST' });
}

/** GET /users/accessible-agencies — returns agencies this user can access (non-empty only for elevated roles). */
export async function fetchAccessibleAgencies(): Promise<{ id: string; name: string; countries: string[] }[]> {
  const res = await apiFetch<{ data: { id: string; name: string; countries: string[] }[] }>('/users/accessible-agencies');
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

/** GET /users/agency-managers — list managers for current agency (for lead request form). Works with leads:read (sales associates). */
export async function fetchAgencyManagers(): Promise<{ id: string; firstName: string; lastName: string; email: string; role: string }[]> {
  const res = await apiFetch<{ data: { id: string; firstName: string; lastName: string; email: string; role: string }[] }>('/users/agency-managers');
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

/** GET /users/team-members — returns active direct reports for the requesting manager (sales_manager / recruitment_manager only). */
export async function fetchTeamMembers(): Promise<ApiUser[]> {
  const res = await apiFetch<{ data: ApiUser[] }>('/users/team-members');
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

export type AgencyMemberRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  userType?: string;
};

/** GET /users/agency-members — all messageable agency colleagues (Messages list + New message). No users:read required. */
export async function fetchAgencyMembers(): Promise<AgencyMemberRow[]> {
  const res = await apiFetch<{ data: AgencyMemberRow[] }>('/users/agency-members');
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

/** GET /users/agency-share-recipients — all agency users incl. super users (snip share picker). */
export async function fetchAgencyShareRecipients(): Promise<AgencyMemberRow[]> {
  const res = await apiFetch<{ data: AgencyMemberRow[] }>('/users/agency-share-recipients');
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

export interface ManagedAgencyEntry {
  subCompanyId: string;
  agencyEmail: string | null;
  name?: string;
}

/** GET /users/me — OM: returns managedAgencies with sending emails. Other roles: []. */
export async function fetchMyManagedAgencies(): Promise<Array<ManagedAgencyEntry & { name: string }>> {
  const res = await apiFetch<{
    managedAgencies?: Array<{ subCompanyId: string; name: string; agencyEmail: string | null }>;
  }>('/users/me');
  if (!res.ok) return [];
  return (res.data?.managedAgencies ?? []).map((a) => ({
    subCompanyId: a.subCompanyId,
    name: a.name,
    agencyEmail: a.agencyEmail,
  }));
}

export interface SuperUserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  userType: string;
  subCompanyId: string;
  isActive: boolean;
  managedAgencies: ManagedAgencyEntry[];
  managedSubCompanyIds: string[];  // backward-compat
}

/** GET /users/super — super users only (super_admin, director, operations_manager). Requires super_admin or director. */
export async function fetchSuperUsers(): Promise<SuperUserRow[]> {
  const res = await apiFetch<{ data: SuperUserRow[] }>('/users/super');
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

/** POST /users/super — create a super user (Director or Operations Manager). Requires super_admin or director. Sends welcome email with login link and temp password. */
export async function createSuperUser(payload: {
  email: string;
  firstName: string;
  lastName: string;
  role: 'director' | 'company_director' | 'operations_manager';
  subCompanyId?: string;
  managedAgencies?: ManagedAgencyEntry[];
}): Promise<SuperUserRow> {
  const res = await fetch(`${API_PREFIX}/users/super`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to create super user');
  return data as SuperUserRow;
}

/** PATCH /users/super/:id — update name/email of a super user (super_admin only). */
export async function updateSuperUser(id: string, payload: { firstName: string; lastName: string; email: string }): Promise<void> {
  const res = await fetch(`${API_PREFIX}/users/super/${id}`, {
    method: 'PATCH',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to update super user');
}

/** DELETE /users/super/:id — remove a super user (super_admin only). */
export async function deleteSuperUser(id: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/users/super/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to delete super user');
}

export type DatabaseManagerRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  userType: string;
  subCompanyId: string | null;
  isActive: boolean;
  reportingManagerIds: string[];
  createdAt?: string;
};

export async function fetchDatabaseManagers(): Promise<DatabaseManagerRow[]> {
  const res = await apiFetch<{ data: DatabaseManagerRow[] }>('/users/database-managers');
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

export async function createDatabaseManager(payload: {
  email: string;
  firstName: string;
  lastName: string;
  reportingManagerIds?: string[];
}): Promise<{ data: DatabaseManagerRow; tempPassword?: string }> {
  const res = await fetch(`${API_PREFIX}/users/database-managers`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to create Database Manager');
  return data as { data: DatabaseManagerRow; tempPassword?: string };
}

/** PATCH /users/:id/managed-agencies — set which agencies an operations manager manages. Requires super_admin or director. */
export async function updateManagedAgencies(userId: string, managedAgencies: ManagedAgencyEntry[]): Promise<{ managedAgencies: ManagedAgencyEntry[]; managedSubCompanyIds: string[] }> {
  const res = await fetch(`${API_PREFIX}/users/${userId}/managed-agencies`, {
    method: 'PATCH',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ managedAgencies }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to update managed agencies');
  return data as { managedAgencies: ManagedAgencyEntry[]; managedSubCompanyIds: string[] };
}

/** GET /users/sub-companies */
export async function fetchSubCompanies(): Promise<
  {
    id: string;
    name: string;
    mainOrgId: string;
    appProjectName?: string | null;
    logoUrl?: string | null;
    agencyLogoUrl?: string | null;
    agencyEmail?: string | null;
    agencyPhone?: string | null;
    emailFooterText?: string | null;
    emailTagline?: string | null;
    emailFromAddress?: string | null;
    emailFromName?: string | null;
    emailSendAsDomain?: string | null;
    emailInboundDomain?: string | null;
    emailInboundLocalpart?: string | null;
    googleCalendarConnected?: boolean;
    googleConnectedEmail?: string | null;
    companyDirectorId?: string | null;
  }[]
> {
  const res = await apiFetch<{
    data: {
      id: string;
      name: string;
      mainOrgId: string;
      appProjectName?: string | null;
      logoUrl?: string | null;
      agencyLogoUrl?: string | null;
      agencyEmail?: string | null;
      agencyPhone?: string | null;
      emailFooterText?: string | null;
      emailTagline?: string | null;
      emailFromAddress?: string | null;
      emailFromName?: string | null;
      emailSendAsDomain?: string | null;
      emailInboundDomain?: string | null;
      emailInboundLocalpart?: string | null;
      googleCalendarConnected?: boolean;
      googleConnectedEmail?: string | null;
      companyDirectorId?: string | null;
    }[];
  }>('/users/sub-companies');
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

/** POST /users/sub-companies — create agency (super_admin only) */
export async function createSubCompany(payload: { name: string; mainOrgId: string }) {
  return fetchJsonWithData<{ id: string; name: string; mainOrgId: string }>(
    `${API_PREFIX}/users/sub-companies`,
    {
      method: 'POST',
      headers: getAuthHeaders() as HeadersInit,
      body: JSON.stringify(payload),
    },
    'Failed to create agency',
  );
}

/** PATCH /users/sub-companies/:id — update agency (super_admin; director/ops for own agency, limited fields) */
export async function updateSubCompany(
  id: string,
  payload: {
    name?: string;
    mainOrgId?: string;
    emailFooterText?: string | null;
    emailTagline?: string | null;
    logoUrl?: string | null;
    agencyLogoUrl?: string | null;
    agencyEmail?: string | null;
    agencyPhone?: string | null;
    appProjectName?: string | null;
    emailFromAddress?: string | null;
    emailFromName?: string | null;
    emailSendAsDomain?: string | null;
    emailInboundDomain?: string | null;
    emailInboundLocalpart?: string | null;
  },
) {
  return fetchJsonWithData<{
    id: string;
    name: string;
    mainOrgId: string;
    appProjectName?: string | null;
    logoUrl?: string | null;
    agencyLogoUrl?: string | null;
    agencyEmail?: string | null;
    agencyPhone?: string | null;
    emailFooterText?: string | null;
    emailTagline?: string | null;
    emailFromAddress?: string | null;
    emailFromName?: string | null;
    emailSendAsDomain?: string | null;
    emailInboundDomain?: string | null;
    emailInboundLocalpart?: string | null;
  }>(`${API_PREFIX}/users/sub-companies/${id}`, {
    method: 'PATCH',
    headers: getAuthHeaders() as HeadersInit,
    body: JSON.stringify(payload),
  }, 'Failed to update agency');
}

/** POST /users/sub-companies/:id/upload-logo — upload image file; returns CDN URL */
export async function uploadAgencyLogo(id: string, file: File): Promise<string> {
  const form = new FormData();
  form.append('logo', file);
  const token = getStoredToken();
  const res = await fetch(`${API_PREFIX}/users/sub-companies/${id}/upload-logo`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? 'Upload failed');
  return (json as { url: string }).url;
}

/** GET /users/locations */
export async function fetchLocations(): Promise<{ id: string; name: string; address?: string; country: string; isActive: boolean }[]> {
  const res = await apiFetch<{ data: { id: string; name: string; address?: string; country: string; isActive: boolean }[] }>('/users/locations');
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

export async function createLocation(data: { name: string; address?: string; country: string }): Promise<{ id: string; name: string; address?: string; country: string; isActive: boolean }> {
  const res = await fetch(`${API_PREFIX}/users/locations`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? 'Failed to create location');
  return json.data;
}

export async function updateLocation(id: string, data: { name?: string; address?: string; country?: string }): Promise<{ id: string; name: string; address?: string; country: string; isActive: boolean }> {
  const res = await fetch(`${API_PREFIX}/users/locations/${id}`, {
    method: 'PATCH',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? 'Failed to update location');
  return json.data;
}

export async function deleteLocation(id: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/users/locations/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error ?? 'Failed to delete location');
  }
}

// ——— Settings: Industries, Tags, Requests ———

export interface SettingsIndustry {
  id: string;
  name: string;
  count: number;
}

export interface SettingsTag {
  id: string;
  tag: string;
  count: number;
}

export async function fetchSettingsIndustries(params?: { subCompanyId?: string }): Promise<{ data: SettingsIndustry[]; totalCount: number }> {
  const q = params?.subCompanyId ? `?subCompanyId=${encodeURIComponent(params.subCompanyId)}` : '';
  const res = await apiFetch<{ data: SettingsIndustry[]; totalCount: number }>(`/settings/industries${q}`);
  if (!res.ok) return { data: [], totalCount: 0 };
  return { data: res.data?.data ?? [], totalCount: res.data?.totalCount ?? 0 };
}

export async function createSettingsIndustry(name: string, subCompanyId?: string): Promise<SettingsIndustry & { id: string }> {
  const res = await fetch(`${API_PREFIX}/settings/industries${subCompanyId ? `?subCompanyId=${encodeURIComponent(subCompanyId)}` : ''}`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ name: name.trim() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Failed to add industry');
  return data;
}

export async function updateSettingsIndustry(id: string, name: string): Promise<SettingsIndustry & { id: string }> {
  const res = await fetch(`${API_PREFIX}/settings/industries/${id}`, {
    method: 'PATCH',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ name: name.trim() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Failed to update industry');
  return data;
}

export async function deleteSettingsIndustry(id: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/settings/industries/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error ?? 'Failed to delete industry');
  }
}

export async function fetchSettingsTags(params?: { subCompanyId?: string }): Promise<{ data: SettingsTag[]; totalCount: number }> {
  const q = params?.subCompanyId ? `?subCompanyId=${encodeURIComponent(params.subCompanyId)}` : '';
  const res = await apiFetch<{ data: SettingsTag[]; totalCount: number }>(`/settings/tags${q}`);
  if (!res.ok) return { data: [], totalCount: 0 };
  return { data: res.data?.data ?? [], totalCount: res.data?.totalCount ?? 0 };
}

export async function createSettingsTag(tag: string, subCompanyId?: string): Promise<SettingsTag & { id: string }> {
  const res = await fetch(`${API_PREFIX}/settings/tags${subCompanyId ? `?subCompanyId=${encodeURIComponent(subCompanyId)}` : ''}`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ tag: tag.trim() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Failed to add tag');
  return data;
}

export async function updateSettingsTag(id: string, tag: string): Promise<SettingsTag & { id: string }> {
  const res = await fetch(`${API_PREFIX}/settings/tags/${id}`, {
    method: 'PATCH',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ tag: tag.trim() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Failed to update tag');
  return data;
}

export async function deleteSettingsTag(id: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/settings/tags/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error ?? 'Failed to delete tag');
  }
}

export interface ResourceRequest {
  id: string;
  subCompanyId: string;
  requestedById: string;
  name: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedById: string | null;
  decidedAt: string | null;
  createdAt: string;
  requestedBy: { id: string; firstName: string; lastName: string; email: string };
  subCompany: { name: string };
}

export async function fetchIndustryRequests(params?: { status?: string; subCompanyId?: string }): Promise<ResourceRequest[]> {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.subCompanyId) q.set('subCompanyId', params.subCompanyId);
  const res = await apiFetch<{ data: ResourceRequest[] }>(`/settings/industry-requests?${q.toString()}`);
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

export async function fetchIndustryRequestsPendingCount(subCompanyId?: string): Promise<number> {
  const q = subCompanyId ? `?subCompanyId=${encodeURIComponent(subCompanyId)}` : '';
  const res = await apiFetch<{ count: number }>(`/settings/industry-requests/pending-count${q}`);
  if (!res.ok) return 0;
  return res.data?.count ?? 0;
}

export async function createIndustryRequest(name: string): Promise<ResourceRequest> {
  const res = await fetch(`${API_PREFIX}/settings/industry-requests`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ name: name.trim() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Failed to submit industry request');
  return data;
}

export async function approveIndustryRequest(id: string): Promise<void> {
  const r = await fetch(`${API_PREFIX}/settings/industry-requests/${id}/approve`, {
    method: 'PATCH',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d?.error ?? 'Failed to approve');
  }
}

export async function rejectIndustryRequest(id: string): Promise<void> {
  const r = await fetch(`${API_PREFIX}/settings/industry-requests/${id}/reject`, {
    method: 'PATCH',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d?.error ?? 'Failed to reject');
  }
}

export async function fetchTagRequests(params?: { status?: string; subCompanyId?: string }): Promise<ResourceRequest[]> {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.subCompanyId) q.set('subCompanyId', params.subCompanyId);
  const res = await apiFetch<{ data: ResourceRequest[] }>(`/settings/tag-requests?${q.toString()}`);
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

export async function fetchTagRequestsPendingCount(subCompanyId?: string): Promise<number> {
  const q = subCompanyId ? `?subCompanyId=${encodeURIComponent(subCompanyId)}` : '';
  const res = await apiFetch<{ count: number }>(`/settings/tag-requests/pending-count${q}`);
  if (!res.ok) return 0;
  return res.data?.count ?? 0;
}

export async function createTagRequest(name: string): Promise<ResourceRequest> {
  const res = await fetch(`${API_PREFIX}/settings/tag-requests`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ name: name.trim() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Failed to submit tag request');
  return data;
}

export async function approveTagRequest(id: string): Promise<void> {
  const r = await fetch(`${API_PREFIX}/settings/tag-requests/${id}/approve`, {
    method: 'PATCH',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d?.error ?? 'Failed to approve');
  }
}

export async function rejectTagRequest(id: string): Promise<void> {
  const r = await fetch(`${API_PREFIX}/settings/tag-requests/${id}/reject`, {
    method: 'PATCH',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d?.error ?? 'Failed to reject');
  }
}

// ——— Settings: Job Titles ———
export interface SettingsJobTitle {
  id: string;
  name: string;
  count: number;
}

export async function fetchSettingsJobTitles(params?: { subCompanyId?: string }): Promise<{ data: SettingsJobTitle[]; totalCount: number }> {
  const q = params?.subCompanyId ? `?subCompanyId=${encodeURIComponent(params.subCompanyId)}` : '';
  const res = await apiFetch<{ data: SettingsJobTitle[]; totalCount: number }>(`/settings/job-titles${q}`);
  if (!res.ok) return { data: [], totalCount: 0 };
  return { data: res.data?.data ?? [], totalCount: res.data?.totalCount ?? 0 };
}

/** Populate allowed industries, tags, and job titles from current client data (and defaults if empty). */
export async function syncSettingsFromClients(params?: { subCompanyId?: string }): Promise<{
  industriesAdded: number;
  tagsAdded: number;
  jobTitlesAdded: number;
}> {
  const q = params?.subCompanyId ? `?subCompanyId=${encodeURIComponent(params.subCompanyId)}` : '';
  const res = await fetch(`${API_PREFIX}/settings/sync-from-clients${q}`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to sync from clients');
  return data as { industriesAdded: number; tagsAdded: number; jobTitlesAdded: number };
}

export async function createSettingsJobTitle(name: string, subCompanyId?: string): Promise<SettingsJobTitle & { id: string }> {
  const res = await fetch(`${API_PREFIX}/settings/job-titles${subCompanyId ? `?subCompanyId=${encodeURIComponent(subCompanyId)}` : ''}`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ name: name.trim() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Failed to add job title');
  return data;
}

export async function updateSettingsJobTitle(id: string, name: string): Promise<SettingsJobTitle & { id: string }> {
  const res = await fetch(`${API_PREFIX}/settings/job-titles/${id}`, {
    method: 'PATCH',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ name: name.trim() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Failed to update job title');
  return data;
}

export async function deleteSettingsJobTitle(id: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/settings/job-titles/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error ?? 'Failed to delete job title');
  }
}

// ─── Call Scripts ────────────────────────────────────────────────────────────

export interface ApiCallScript {
  id: string;
  subCompanyId: string;
  name: string;
  clientStatus?: string | null;
  content: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function fetchCallScripts(): Promise<ApiCallScript[]> {
  const res = await apiFetch<{ data: ApiCallScript[] }>('/settings/call-scripts');
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

export async function createCallScript(data: { name: string; content: string; clientStatus?: string | null; isActive?: boolean }): Promise<ApiCallScript> {
  const res = await fetch(`${API_PREFIX}/settings/call-scripts`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? 'Failed to create script');
  return json.data;
}

export async function updateCallScript(id: string, data: Partial<{ name: string; content: string; clientStatus: string | null; isActive: boolean }>): Promise<ApiCallScript> {
  const res = await fetch(`${API_PREFIX}/settings/call-scripts/${id}`, {
    method: 'PATCH',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? 'Failed to update script');
  return json.data;
}

export async function deleteCallScript(id: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/settings/call-scripts/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error ?? 'Failed to delete script');
  }
}

export async function fetchJobTitleRequests(params?: { status?: string; subCompanyId?: string }): Promise<ResourceRequest[]> {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.subCompanyId) q.set('subCompanyId', params.subCompanyId);
  const res = await apiFetch<{ data: ResourceRequest[] }>(`/settings/job-title-requests?${q.toString()}`);
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

export async function fetchJobTitleRequestsPendingCount(subCompanyId?: string): Promise<number> {
  const q = subCompanyId ? `?subCompanyId=${encodeURIComponent(subCompanyId)}` : '';
  const res = await apiFetch<{ count: number }>(`/settings/job-title-requests/pending-count${q}`);
  if (!res.ok) return 0;
  return res.data?.count ?? 0;
}

export async function createJobTitleRequest(name: string): Promise<ResourceRequest> {
  const res = await fetch(`${API_PREFIX}/settings/job-title-requests`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ name: name.trim() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Failed to submit job title request');
  return data;
}

export async function approveJobTitleRequest(id: string): Promise<void> {
  const r = await fetch(`${API_PREFIX}/settings/job-title-requests/${id}/approve`, {
    method: 'PATCH',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d?.error ?? 'Failed to approve');
  }
}

export async function rejectJobTitleRequest(id: string): Promise<void> {
  const r = await fetch(`${API_PREFIX}/settings/job-title-requests/${id}/reject`, {
    method: 'PATCH',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d?.error ?? 'Failed to reject');
  }
}

export interface CreateUserPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  country: Country;
  role: string;
  userType: string;
  subCompanyId: string;
  locationId?: string;
  reportingManagerIds?: string[];
  dailyCallsTarget?: number;
  dailyEmailsTarget?: number;
  dailyMeetingScheduleTarget?: number;
  isActive?: boolean;
  workStartTime?: string;
  workEndTime?: string;
}

/** POST /users — create user (requires users:write) */
export async function createUser(payload: CreateUserPayload) {
  const res = await fetch(`${API_PREFIX}/users`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Failed to create user');
  return data as ApiUser;
}

export interface UpdateUserPayload {
  firstName?: string;
  lastName?: string;
  phone?: string;
  country?: Country;
  role?: string;
  userType?: string;
  subCompanyId?: string;
  locationId?: string | null;
  reportingManagerIds?: string[];
  dailyCallsTarget?: number;
  dailyEmailsTarget?: number;
  dailyMeetingScheduleTarget?: number;
  isActive?: boolean;
  password?: string;
  workStartTime?: string;
  workEndTime?: string;
  sendAsEmail?: string | null;
  sendAsDisabled?: boolean;
}

/** PATCH /users/:id — edit fields (users:write); isActive (users:delete or legacy users:write) */
export async function updateUser(userId: string, payload: UpdateUserPayload) {
  const res = await fetch(`${API_PREFIX}/users/${userId}`, {
    method: 'PATCH',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Failed to update user');
  return data as ApiUser;
}

/** POST /users/:id/admin-set-password — set user password (super_admin, director, operations_manager only) */
export async function adminSetUserPassword(userId: string, newPassword: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/users/${userId}/admin-set-password`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ newPassword }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Failed to set password');
}

/** POST /users/:id/admin-send-reset-email — send password reset email to user (super_admin, director, operations_manager only) */
export async function adminSendUserResetEmail(userId: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/users/${userId}/admin-send-reset-email`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Failed to send reset email');
}

// ——— Messages (per-agency) ———

export interface ApiConversation {
  id: string;
  participantUserIds: string[];
  participantNames: string[];
  lastMessage: string | null;
  lastMessageTime: string;
  unreadCount: number;
}

/** GET /internal-calls/ice-config — ICE servers for staff WebRTC */
export async function fetchInternalCallIceConfig(): Promise<RTCIceServer[]> {
  const res = await apiFetch<{ iceServers: RTCIceServer[] }>('/internal-calls/ice-config');
  if (!res.ok || !res.data?.iceServers?.length) {
    return [{ urls: 'stun:stun.l.google.com:19302' }];
  }
  return res.data.iceServers;
}

/** GET /messages/unread-count */
export async function fetchUnreadMessagesCount(): Promise<number> {
  const res = await apiFetch<{ count: number }>('/messages/unread-count');
  if (!res.ok) return 0;
  return res.data?.count ?? 0;
}

/** GET /messages/conversations */
export async function fetchConversations(): Promise<ApiConversation[]> {
  const res = await apiFetch<{ data: ApiConversation[] }>('/messages/conversations');
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

/** POST /messages/conversations — find or create 1:1 with another user in agency */
export async function createOrGetConversation(participantUserId: string): Promise<ApiConversation> {
  const res = await fetch(`${API_PREFIX}/messages/conversations`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ participantUserId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to create conversation');
  return data as ApiConversation;
}

/** GET /messages/conversations/:id */
export async function fetchConversation(conversationId: string): Promise<ApiConversation | null> {
  const res = await apiFetch<ApiConversation>(`/messages/conversations/${conversationId}`);
  if (!res.ok) return null;
  return res.data ?? null;
}

export interface ApiMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  text: string | null;
  type?: 'text' | 'call' | string;
  metadata?: {
    mediaType?: 'audio' | 'video';
    outcome?: 'completed' | 'declined' | 'cancelled' | 'missed';
    durationSec?: number;
    callId?: string;
  } | null;
  createdAt: string;
  attachments: Array<{ id: string; name: string; fileUrl: string; mimeType: string | null; fileSize: number | null }>;
}

/** GET /messages/conversations/:id/messages */
export async function fetchConversationMessages(
  conversationId: string,
  params?: { before?: string; limit?: number }
): Promise<{ data: ApiMessage[]; hasMore: boolean }> {
  const search = new URLSearchParams();
  if (params?.before) search.set('before', params.before);
  if (params?.limit) search.set('limit', String(params.limit));
  const q = search.toString();
  const res = await apiFetch<{ data: ApiMessage[]; hasMore: boolean }>(
    `/messages/conversations/${conversationId}/messages${q ? `?${q}` : ''}`
  );
  if (!res.ok) return { data: [], hasMore: false };
  return { data: res.data?.data ?? [], hasMore: res.data?.hasMore ?? false };
}

/** POST /messages/conversations/:id/messages */
export async function sendConversationMessage(
  conversationId: string,
  payload: {
    text?: string;
    attachments?: Array<{ name: string; fileBase64: string; mimeType?: string }>;
    playSoundOnly?: boolean;
  }
): Promise<ApiMessage> {
  const res = await fetch(`${API_PREFIX}/messages/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to send message');
  return data as ApiMessage;
}

/** PATCH /messages/conversations/:id/read */
export async function markConversationRead(conversationId: string): Promise<void> {
  await fetch(`${API_PREFIX}/messages/conversations/${conversationId}/read`, {
    method: 'PATCH',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
}

/** Build a URL that serves a message attachment (streams from R2 via backend). Token passed as query param since <img> tags can't send auth headers. */
export function getMessageAttachmentUrl(attachmentId: string): string {
  const token = getStoredToken();
  const base = `${API_PREFIX}/messages/attachments/${encodeURIComponent(attachmentId)}`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

// ——— Notifications ———

export interface ApiNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  relatedId: string | null;
  readAt: string | null;
  createdAt: string;
  isReminder?: boolean;
  // Source identity — set by the backend for tabbed inbox UI
  sourceUserId: string;
  sourceFirstName: string;
  sourceLastName: string;
  sourceAgencyName: string;
  sourceUserColor: string | null; // null = own notification; frontend uses SELF_COLOR constant
  isOwn: boolean;
}

/** GET /notifications */
export async function fetchNotifications(limit?: number): Promise<ApiNotification[]> {
  const q = limit != null ? `?limit=${limit}` : '';
  const res = await apiFetch<{ data: ApiNotification[] }>(`/notifications${q}`);
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

/** GET /notifications/unread-count */
export async function fetchNotificationUnreadCount(): Promise<number> {
  const res = await apiFetch<{ count: number }>('/notifications/unread-count');
  if (!res.ok) return 0;
  return res.data?.count ?? 0;
}

/** SSE stream URL for real-time notification updates (EventSource). Returns null if no token. */
export function getNotificationStreamUrl(): string | null {
  const token = getStoredToken();
  if (!token) return null;
  return `${API_PREFIX}/notifications/stream?token=${encodeURIComponent(token)}`;
}

/** GET /dashboard/today-stats — server-side count of calls and emails sent today (no pagination). */
export async function fetchDashboardTodayStats(): Promise<{ callsToday: number; emailsToday: number }> {
  const res = await apiFetch<{ callsToday: number; emailsToday: number }>('/dashboard/today-stats');
  if (!res.ok) return { callsToday: 0, emailsToday: 0 };
  return res.data ?? { callsToday: 0, emailsToday: 0 };
}

// ——— Daily Agenda (API: /daily-activity) ———

export type DailyActivityFilter =
  | 'today'
  | 'action_today'
  | 'pending'
  | 'overdue'
  | 'completed_today'
  | 'awaiting_approval'
  | 'all';

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

export type DailyActivityItemStatus =
  | 'today'
  | 'pending'
  | 'overdue'
  | 'completed_today'
  | 'awaiting_approval';

export interface DailyActivityCountersDto {
  total: number;
  today: number;
  pending: number;
  overdue: number;
  awaiting_approval?: number;
  completed_today: number;
  action_today?: number;
  byKind?: Partial<Record<DailyActivityKind, number>>;
}

export interface DailyActivityItemDto {
  id: string;
  kind: DailyActivityKind;
  title: string;
  subtitle?: string;
  ownerId: string;
  ownerName: string;
  status: DailyActivityItemStatus;
  /** Calendar days past due (when status is overdue) */
  daysOverdue?: number;
  dueAt?: string;
  occurredAt?: string;
  entityId: string;
  link: string;
  quickActions?: Array<'complete' | 'snooze' | 'approve' | 'reject' | 'open' | 'call' | 'email'>;
  meta?: Record<string, unknown>;
}

export interface DailyActivityTreeUser {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  roleLabel: string;
  reportingManagerIds: string[];
}

export interface DailyActivityTreeNode {
  user: DailyActivityTreeUser;
  counters: {
    total: number;
    today: number;
    pending: number;
    overdue: number;
    awaiting_approval?: number;
    completed_today: number;
    action_today?: number;
  };
  children: DailyActivityTreeNode[];
  isUnassignedGroup?: boolean;
}

export interface DailyActivityHierarchyResponse {
  tree: DailyActivityTreeNode[];
  bounds: { startUTC: string; endUTC: string; dateLabel: string; timezone: string };
  totals: DailyActivityCountersDto;
}

async function fetchDailyActivityRaw<T>(path: string): Promise<T> {
  const res = await fetch(`${API_PREFIX}${path}`, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? 'Daily Agenda request failed');
  }
  return body as T;
}

/** GET /daily-activity/today-count — due today + overdue (header badge) */
export async function fetchDailyActivityTodayCount(
  agencyIds?: string[],
): Promise<{ count: number }> {
  const sp = new URLSearchParams();
  if (agencyIds?.length) sp.set('agencyIds', agencyIds.join(','));
  const q = sp.toString();
  return fetchDailyActivityRaw(`/daily-activity/today-count${q ? `?${q}` : ''}`);
}

/** GET /daily-activity/hierarchy */
export async function fetchDailyActivityHierarchy(
  agencyIds?: string[],
): Promise<DailyActivityHierarchyResponse> {
  const sp = new URLSearchParams();
  if (agencyIds?.length) sp.set('agencyIds', agencyIds.join(','));
  const q = sp.toString();
  return fetchDailyActivityRaw(`/daily-activity/hierarchy${q ? `?${q}` : ''}`);
}

/** GET /daily-activity/items */
export async function fetchDailyActivityItems(params?: {
  scope?: 'self' | 'team' | 'user';
  userId?: string;
  filter?: DailyActivityFilter;
  kinds?: DailyActivityKind[];
  q?: string;
  page?: number;
  limit?: number;
  agencyIds?: string[];
}): Promise<{
  data: DailyActivityItemDto[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  bounds: { startUTC: string; endUTC: string; dateLabel: string; timezone: string };
}> {
  const sp = new URLSearchParams();
  if (params?.scope) sp.set('scope', params.scope);
  if (params?.userId) sp.set('userId', params.userId);
  if (params?.filter) sp.set('filter', params.filter);
  if (params?.kinds?.length) sp.set('kinds', params.kinds.join(','));
  if (params?.q) sp.set('q', params.q);
  if (params?.page) sp.set('page', String(params.page));
  if (params?.limit) sp.set('limit', String(params.limit));
  if (params?.agencyIds?.length) sp.set('agencyIds', params.agencyIds.join(','));
  const q = sp.toString();
  return fetchDailyActivityRaw(`/daily-activity/items${q ? `?${q}` : ''}`);
}

/** GET /daily-activity/summary */
export async function fetchDailyActivitySummary(userIds: string[]): Promise<{
  byUserId: Record<string, DailyActivityCountersDto>;
  bounds: { startUTC: string; endUTC: string; dateLabel: string; timezone: string };
}> {
  return fetchDailyActivityRaw(
    `/daily-activity/summary?userIds=${encodeURIComponent(userIds.join(','))}`,
  );
}

/** GET /dashboard/lead-status-over-time — monthly lead status counts for the last 12 months. */
export async function fetchLeadStatusOverTime(): Promise<{ month: string; Won: number; Lost: number; Active: number; Open: number }[]> {
  const res = await apiFetch<{ month: string; Won: number; Lost: number; Active: number; Open: number }[]>('/dashboard/lead-status-over-time');
  if (!res.ok) return [];
  return res.data ?? [];
}

export interface DirectorStatsDivision {
  id: string;
  name: string;
  // All-time pipeline health
  totalLeads: number;
  activeLeads: number;
  wonLeads: number;
  lostLeads: number;
  conversionRate: number;
  // Month-over-month trend
  trend: 'up' | 'down' | 'neutral';
  trendValue: number;
  // Period-filtered activity
  calls: number;
  emails: number;
  meetings: number;
  // Period-filtered closed leads (for charts)
  periodWonLeads: number;
  periodLostLeads: number;
  // Team
  teamSize: number;
  totalUsers: number;
  // Clients
  totalClients: number;
  activeClients: number;
}

export interface DirectorStatsOverview {
  totalClients: number;
  activeClients: number;
  wonLeads: number;
  lostLeads: number;
  totalUsers: number;
  activeUsers: number;
  conversionRate: number;
  periodWonLeads: number;
  periodLostLeads: number;
}

export interface DirectorStatsResponse {
  subCompanies: { id: string; name: string }[];
  overview: DirectorStatsOverview;
  divisions: DirectorStatsDivision[];
  monthlyTrend: Record<string, number | string>[];
}

export type DirectorStatsPeriod = 'today' | 'month' | 'year' | 'custom';

const EMPTY_DIRECTOR_OVERVIEW: DirectorStatsOverview = {
  totalClients: 0, activeClients: 0, wonLeads: 0, lostLeads: 0,
  totalUsers: 0, activeUsers: 0, conversionRate: 0,
  periodWonLeads: 0, periodLostLeads: 0,
};

/** GET /dashboard/director-stats — cross-division stats for director / super_admin / operations_manager. */
export async function fetchDirectorStats(params: {
  period?: DirectorStatsPeriod;
  from?: string;
  to?: string;
}): Promise<DirectorStatsResponse> {
  const qs = new URLSearchParams();
  if (params.period) qs.set('period', params.period);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  const query = qs.toString() ? `?${qs.toString()}` : '';
  const res = await apiFetch<DirectorStatsResponse>(`/dashboard/director-stats${query}`);
  if (!res.ok) {
    return { subCompanies: [], overview: EMPTY_DIRECTOR_OVERVIEW, divisions: [], monthlyTrend: [] };
  }
  return res.data ?? { subCompanies: [], overview: EMPTY_DIRECTOR_OVERVIEW, divisions: [], monthlyTrend: [] };
}

// ——— Bug reports ———

export interface ApiBugReport {
  id: string;
  title: string | null;
  description: string;
  screenshotUrl: string | null;
  status: 'open' | 'closed';
  resolutionRemarks: string | null;
  metadata: { pageUrl?: string; userAgent?: string } | null;
  createdAt: string;
  resolvedAt: string | null;
  submittedBy: { id: string; name: string; email: string } | null;
  resolvedBy: { id: string; name: string } | null;
  subCompany: { id: string; name: string } | null;
}

export async function submitBugReport(payload: {
  title?: string;
  description: string;
  screenshotBase64?: string;
  mimeType?: string;
  pageUrl?: string;
  userAgent?: string;
}): Promise<{ id: string; title: string | null; description: string; screenshotUrl: string | null; status: string; createdAt: string }> {
  const res = await fetch(`${API_PREFIX}/bug-reports`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to submit bug report');
  return data as { id: string; title: string | null; description: string; screenshotUrl: string | null; status: string; createdAt: string };
}

export async function fetchBugReports(params?: { status?: 'open' | 'closed'; page?: number; limit?: number }): Promise<{
  data: ApiBugReport[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.page != null) q.set('page', String(params.page));
  if (params?.limit != null) q.set('limit', String(params.limit));
  const res = await apiFetch<{ data: ApiBugReport[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>(
    `/bug-reports?${q.toString()}`
  );
  if (!res.ok) return { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
  return { data: res.data?.data ?? [], pagination: res.data?.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 0 } };
}

/** URL to view a bug report screenshot (backend serves or redirects). Use this for the "View screenshot" link. */
export function getBugReportScreenshotUrl(bugReportId: string): string {
  return `${API_PREFIX}/bug-reports/${encodeURIComponent(bugReportId)}/screenshot`;
}

export async function closeBugReport(id: string, resolutionRemarks: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/bug-reports/${id}`, {
    method: 'PATCH',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ status: 'closed', resolutionRemarks }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to close bug report');
}

export interface BugReportRecipient {
  id: string;
  email: string;
  createdAt: string;
}

export async function fetchBugReportRecipients(): Promise<BugReportRecipient[]> {
  const res = await apiFetch<{ data: BugReportRecipient[] }>('/settings/bug-report-recipients');
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

export async function addBugReportRecipient(email: string): Promise<BugReportRecipient> {
  const res = await fetch(`${API_PREFIX}/settings/bug-report-recipients`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to add recipient');
  return data as BugReportRecipient;
}

export async function removeBugReportRecipient(id: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/settings/bug-report-recipients/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Failed to remove recipient');
  }
}

// ─── Proposal Default Files ───────────────────────────────────────────────────

export interface ProposalDefaultFile {
  id: string;
  name: string;
  fileUrl: string;
  mimeType: string | null;
  createdAt: string;
}

function withAgency(path: string, subCompanyId?: string): string {
  if (!subCompanyId) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}subCompanyId=${encodeURIComponent(subCompanyId)}`;
}

export async function fetchProposalDefaultSetting(subCompanyId?: string): Promise<number> {
  const res = await apiFetch<{ maxFiles: number }>(withAgency('/settings/proposal-default-setting', subCompanyId));
  if (!res.ok) return 5;
  return res.data?.maxFiles ?? 5;
}

export async function updateProposalDefaultSetting(maxFiles: number, subCompanyId?: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}${withAgency('/settings/proposal-default-setting', subCompanyId)}`, {
    method: 'PUT',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ maxFiles }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Failed to save setting');
  }
}

export async function fetchProposalAwaitingClientDays(subCompanyId?: string): Promise<number> {
  const res = await apiFetch<{ days: number }>(withAgency('/settings/proposal-awaiting-client', subCompanyId));
  if (!res.ok) return 7;
  return res.data?.days ?? 7;
}

export async function updateProposalAwaitingClientDays(days: number, subCompanyId?: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}${withAgency('/settings/proposal-awaiting-client', subCompanyId)}`, {
    method: 'PUT',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ days }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Failed to save setting');
  }
}

export async function fetchLeadDeadlineDays(subCompanyId?: string): Promise<number> {
  const res = await apiFetch<{ days: number }>(withAgency('/settings/lead-deadline', subCompanyId));
  if (!res.ok) return 7;
  return res.data?.days ?? 7;
}

export async function updateLeadDeadlineDays(days: number, subCompanyId?: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}${withAgency('/settings/lead-deadline', subCompanyId)}`, {
    method: 'PUT',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ days }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Failed to save lead deadline setting');
  }
}

export async function fetchProposalDefaultFiles(subCompanyId?: string): Promise<ProposalDefaultFile[]> {
  const res = await apiFetch<{ data: ProposalDefaultFile[] }>(withAgency('/settings/proposal-default-files', subCompanyId));
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

export async function uploadProposalDefaultFile(data: { name: string; fileBase64: string; mimeType?: string }, subCompanyId?: string): Promise<ProposalDefaultFile> {
  const res = await fetch(`${API_PREFIX}${withAgency('/settings/proposal-default-files', subCompanyId)}`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? 'Failed to upload file');
  return (json as { data: ProposalDefaultFile }).data;
}

export async function deleteProposalDefaultFile(id: string, subCompanyId?: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}${withAgency(`/settings/proposal-default-files/${id}`, subCompanyId)}`, {
    method: 'DELETE',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Failed to delete file');
  }
}

// ── Proposal Type Template Mappings ──

export interface ProposalTypeTemplates {
  tempTemplateId: string | null;
  tempTemplateName: string | null;
  directTemplateId: string | null;
  directTemplateName: string | null;
  bothTemplateId: string | null;
  bothTemplateName: string | null;
  employeeOnboardingTemplateId: string | null;
  employeeOnboardingTemplateName: string | null;
}

export async function fetchProposalTypeTemplates(subCompanyId?: string): Promise<ProposalTypeTemplates> {
  const empty: ProposalTypeTemplates = { tempTemplateId: null, tempTemplateName: null, directTemplateId: null, directTemplateName: null, bothTemplateId: null, bothTemplateName: null, employeeOnboardingTemplateId: null, employeeOnboardingTemplateName: null };
  const res = await apiFetch<ProposalTypeTemplates>(withAgency('/settings/proposal-type-templates', subCompanyId));
  if (!res.ok) return empty;
  return res.data ?? empty;
}

export async function updateProposalTypeTemplates(data: ProposalTypeTemplates, subCompanyId?: string): Promise<ProposalTypeTemplates> {
  const res = await fetch(`${API_PREFIX}${withAgency('/settings/proposal-type-templates', subCompanyId)}`, {
    method: 'PUT',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? 'Failed to save');
  return json as ProposalTypeTemplates;
}

/** GET /proposals/default-files — available to any authenticated user for proposal composition.
 *  Pass the lead's subCompanyId so an elevated user (super_admin, director) submitting on
 *  behalf of another agency's lead gets THAT agency's defaults — not their own. */
export async function fetchDefaultFilesForProposal(subCompanyId?: string): Promise<ProposalDefaultFile[]> {
  const res = await apiFetch<{ data: ProposalDefaultFile[] }>(withAgency('/proposals/default-files', subCompanyId));
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

export function getDefaultFilePreviewUrl(id: string, subCompanyId?: string): string {
  const token = getStoredToken();
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  // Explicit lead-agency override beats the global viewedSubCompanyId so previews
  // shown inside ProposalDialog always match the lead, not the viewer's context.
  const effectiveAgency = subCompanyId ?? useStore.getState().viewedSubCompanyId;
  if (effectiveAgency) params.set('subCompanyId', effectiveAgency);
  const query = params.toString();
  return `${API_PREFIX}/proposals/default-files/${id}/preview${query ? `?${query}` : ''}`;
}

export function getProposalDocPreviewUrl(docId: string): string {
  const token = getStoredToken();
  return `${API_PREFIX}/proposals/documents/${docId}/preview${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export function getProposalPandaDocPdfUrl(proposalId: string): string {
  const token = getStoredToken();
  return `${API_PREFIX}/proposals/${proposalId}/pandadoc-pdf${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export function getReviewPreviewUrl(proposalId: string): string {
  const token = getStoredToken();
  return `${API_PREFIX}/proposals/${proposalId}/review-preview${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export async function fetchReviewPreviewHtml(proposalId: string): Promise<string> {
  const token = getStoredToken();
  const url = `${API_PREFIX}/proposals/${proposalId}/review-preview?format=html${token ? `&token=${encodeURIComponent(token)}` : ''}`;
  const res = await fetch(url, { headers: getAuthHeaders() as HeadersInit, credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).error ?? 'Failed to load preview');
  }
  return res.text();
}

export async function fetchReviewPdfBlob(proposalId: string): Promise<Blob> {
  const { viewedSubCompanyId } = useStore.getState();
  const qs = viewedSubCompanyId
    ? `?subCompanyId=${encodeURIComponent(viewedSubCompanyId)}`
    : '';
  const res = await fetch(`${API_PREFIX}/proposals/${proposalId}/review-pdf-preview${qs}`, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).error ?? 'Failed to generate PDF preview');
  }
  return res.blob();
}

export async function fetchSentReviewPdfBlob(proposalId: string): Promise<Blob> {
  const { viewedSubCompanyId } = useStore.getState();
  const qs = viewedSubCompanyId
    ? `?subCompanyId=${encodeURIComponent(viewedSubCompanyId)}`
    : '';
  const res = await fetch(`${API_PREFIX}/proposals/${proposalId}/sent-review-pdf${qs}`, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).error ?? 'Failed to retrieve sent review PDF');
  }
  return res.blob();
}

export async function replaceProposalDocument(docId: string, data: { name: string; fileBase64: string; mimeType?: string }): Promise<any> {
  const res = await fetch(`${API_PREFIX}/proposals/documents/${docId}`, {
    method: 'PATCH',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to replace document');
  }
  return res.json();
}

/** PATCH /notifications/:id/read */
export async function markNotificationRead(id: string): Promise<void> {
  await fetch(`${API_PREFIX}/notifications/${id}/read`, {
    method: 'PATCH',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
}

/** PATCH /notifications/read-all */
export async function markAllNotificationsRead(): Promise<void> {
  await fetch(`${API_PREFIX}/notifications/read-all`, {
    method: 'PATCH',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
}

// ——— Emails ———

export interface ApiEmailListItem {
  id: string;
  from: { name: string; email: string; userId?: string };
  to: Array<{ name: string; email: string; clientId?: string; contactId?: string }>;
  subject: string;
  body: string;
  timestamp: string;
  isRead: boolean;
  folder: 'inbox' | 'sent' | 'drafts' | 'forwarded';
  clientId?: string;
  leadId?: string;
  inReplyTo?: string;
  subCompanyId?: string;
  attachmentCount?: number;
  forwardedFromUserId?: string;
  forwardedFromName?: string;
  sentBy?: { id: string; name: string };
}

export interface ApiEmailAttachment {
  id: string;
  filename: string;
  fileKey: string;
  mimeType: string;
  size?: number;
}

export interface ApiEmailDetail extends ApiEmailListItem {
  cc?: Array<{ name: string; email: string }>;
  attachments?: ApiEmailAttachment[];
  originalSentBy?: { id: string; name: string };
}

export async function fetchEmails(params: {
  folder: 'inbox' | 'sent' | 'drafts' | 'forwarded';
  page?: number;
  limit?: number;
  agencyIds?: string[];
  ownerIds?: string[]; ownerExact?: boolean;
}): Promise<{
  data: ApiEmailListItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  unreadCount: number;
}> {
  const q = new URLSearchParams({
    folder: params.folder,
    page: String(params.page ?? 1),
    limit: String(params.limit ?? 50),
  });
  if (params.agencyIds?.length) q.set('agencyIds', params.agencyIds.join(','));
  appendOwnerIds(q, params.ownerIds, params.ownerExact);
  const res = await apiFetch<{
    data: ApiEmailListItem[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
    unreadCount: number;
  }>(`/emails?${q.toString()}`);
  if (!res.ok) return { data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 }, unreadCount: 0 };
  return res.data ?? { data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 }, unreadCount: 0 };
}

export async function fetchEmailUnreadCount(): Promise<number> {
  const res = await apiFetch<{ count: number }>('/emails/unread-count');
  if (!res.ok) return 0;
  return res.data?.count ?? 0;
}

export async function fetchEmailById(id: string): Promise<ApiEmailDetail | null> {
  const res = await apiFetch<ApiEmailDetail>(`/emails/${id}`);
  if (!res.ok) return null;
  return res.data ?? null;
}

export function getEmailAttachmentUrl(emailId: string, attachmentId: string): string {
  return `${API_PREFIX}/emails/${emailId}/attachments/${attachmentId}`;
}

export async function downloadEmailAttachment(
  emailId: string,
  attachmentId: string,
  filename: string,
): Promise<{ ok: true } | { ok: false; status: number }> {
  const url = `${API_PREFIX}/emails/${emailId}/attachments/${attachmentId}`;
  const doFetch = () =>
    fetch(url, { headers: getAuthHeaders() as HeadersInit, credentials: 'include' });

  let res = await doFetch();

  if (res.status === 401) {
    const refreshed = getStoredRefreshToken() ? await refreshTokens() : false;
    if (refreshed) {
      res = await doFetch();
    } else {
      clearClientSessionData();
      window.location.href = '/login';
      return { ok: false, status: 401 };
    }
  }

  if (!res.ok) return { ok: false, status: res.status };

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
  return { ok: true };
}

async function fetchAuthenticatedBlob(url: string): Promise<Blob> {
  const doFetch = () =>
    fetch(url, { headers: getAuthHeaders() as HeadersInit, credentials: 'include' });

  let res = await doFetch();

  if (res.status === 401) {
    const refreshed = getStoredRefreshToken() ? await refreshTokens() : false;
    if (refreshed) {
      res = await doFetch();
    } else {
      clearClientSessionData();
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }
  }

  if (!res.ok) throw new Error('Failed to load attachment');
  return res.blob();
}

export async function fetchEmailAttachmentBlob(emailId: string, attachmentId: string): Promise<Blob> {
  return fetchAuthenticatedBlob(getEmailAttachmentUrl(emailId, attachmentId));
}

export async function fetchMessageAttachmentBlob(attachmentId: string): Promise<Blob> {
  return fetchAuthenticatedBlob(getMessageAttachmentUrl(attachmentId));
}

export async function markEmailRead(id: string): Promise<void> {
  await fetch(`${API_PREFIX}/emails/${id}/read`, {
    method: 'PATCH',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
}

export async function fetchReplyAsEligibleUsers(): Promise<Array<{ id: string; firstName: string; lastName: string; email: string; role: string; subCompanyId: string | null }>> {
  const res = await apiFetch<{ users: Array<{ id: string; firstName: string; lastName: string; email: string; role: string; subCompanyId: string | null }> }>('/emails/reply-as/eligible-users');
  if (!res.ok) return [];
  return res.data.users;
}

export async function sendEmail(payload: {
  to: Array<{ contactId?: string; clientId?: string; email?: string; name?: string }>;
  cc?: Array<{ email: string; name?: string }>;
  subject: string;
  body: string;
  clientId?: string;
  leadId?: string;
  inReplyTo?: string;
  subCompanyId?: string;  // OM: which agency to send from
  attachments?: Array<{ filename: string; mimeType: string; data: string }>;
  replyAsUserId?: string;  // emails:reply_as — send on behalf of a direct report
}): Promise<{ id: string; sent: boolean; message: string }> {
  const res = await apiFetch<{ id: string; sent: boolean; message: string }>('/emails/send', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(res.error || 'Failed to send email');
  return res.data;
}

export async function saveEmailDraft(payload: {
  to?: Array<{ contactId?: string; clientId?: string; email?: string; name?: string }>;
  subject?: string;
  body?: string;
  clientId?: string;
  leadId?: string;
  subCompanyId?: string;
}): Promise<{ id: string; subject: string; timestamp: string }> {
  const res = await apiFetch<{ id: string; subject: string; timestamp: string }>('/emails/draft', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to save draft');
  return res.data;
}

export async function updateEmailDraft(
  id: string,
  payload: {
    to?: Array<{ contactId?: string; clientId?: string; email?: string; name?: string }>;
    subject?: string;
    body?: string;
    clientId?: string;
    leadId?: string;
    subCompanyId?: string;
  }
): Promise<void> {
  const res = await apiFetch(`/emails/draft/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to update draft');
}

export async function deleteEmailDraft(id: string): Promise<void> {
  const res = await apiFetch(`/emails/draft/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete draft');
}

export async function deleteEmail(id: string): Promise<void> {
  const res = await apiFetch(`/emails/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Failed to delete email');
  }
}

// ——— Email templates ———

export interface ApiEmailTemplate {
  id: string;
  subCompanyId: string | null;
  ownerUserId: string | null;
  sourceTemplateId: string | null;
  name: string;
  subject: string;
  bodyHtml: string;
  headerHtml: string | null;
  footerHtml: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchEmailTemplates(params?: {
  subCompanyId?: string;
  /** shared = admin library; mine = personal; omit = compose (shared ∪ mine) */
  scope?: 'shared' | 'mine';
}): Promise<ApiEmailTemplate[]> {
  const qs = new URLSearchParams();
  if (params?.subCompanyId) qs.set('subCompanyId', params.subCompanyId);
  if (params?.scope) qs.set('scope', params.scope);
  const q = qs.toString();
  const path = q ? `/email-templates?${q}` : '/email-templates';
  const res = await apiFetch<{ data: ApiEmailTemplate[] }>(path);
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

export async function customizeEmailTemplate(sourceTemplateId: string): Promise<ApiEmailTemplate> {
  const res = await fetch(`${API_PREFIX}/email-templates/customize`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ sourceTemplateId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to customize template');
  return data as ApiEmailTemplate;
}

export async function fetchEmailTemplate(id: string): Promise<ApiEmailTemplate | null> {
  const res = await apiFetch<ApiEmailTemplate>(`/email-templates/${id}`);
  if (!res.ok) return null;
  return res.data ?? null;
}

export async function createEmailTemplate(payload: {
  name: string;
  subject: string;
  bodyHtml: string;
  headerHtml?: string;
  footerHtml?: string;
  subCompanyId?: string;
}): Promise<ApiEmailTemplate> {
  const res = await fetch(`${API_PREFIX}/email-templates`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to create template');
  return data as ApiEmailTemplate;
}

export async function updateEmailTemplate(
  id: string,
  payload: { name?: string; subject?: string; bodyHtml?: string; headerHtml?: string | null; footerHtml?: string | null }
): Promise<ApiEmailTemplate> {
  const res = await fetch(`${API_PREFIX}/email-templates/${id}`, {
    method: 'PATCH',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to update template');
  return data as ApiEmailTemplate;
}

export async function deleteEmailTemplate(id: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/email-templates/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Failed to delete template');
  }
}

export interface AgencySignatureResponse {
  emailSignatureTemplate: string | null;
  emailSignatureConfig: import('../types/signatureConfig').SignatureConfig | null;
  agencyLogoUrl?: string | null;
  isLegacy?: boolean;
  /** True when agency has no saved signature — universal default is in use */
  usingDefault?: boolean;
}

export async function fetchAgencySignature(
  subCompanyId?: string,
): Promise<AgencySignatureResponse> {
  const path = subCompanyId
    ? `/settings/email-signature?subCompanyId=${encodeURIComponent(subCompanyId)}`
    : '/settings/email-signature';
  const res = await apiFetch<AgencySignatureResponse>(path);
  if (!res.ok) {
    return { emailSignatureTemplate: null, emailSignatureConfig: null, isLegacy: false, usingDefault: true };
  }
  return {
    emailSignatureTemplate: res.data?.emailSignatureTemplate ?? null,
    emailSignatureConfig: res.data?.emailSignatureConfig ?? null,
    agencyLogoUrl: res.data?.agencyLogoUrl ?? null,
    isLegacy: !!res.data?.isLegacy,
    usingDefault: !!res.data?.usingDefault,
  };
}

/** @deprecated Prefer fetchAgencySignature */
export async function fetchAgencySignatureTemplate(subCompanyId?: string): Promise<string | null> {
  const data = await fetchAgencySignature(subCompanyId);
  return data.emailSignatureTemplate;
}

export async function updateAgencySignature(
  payload: {
    emailSignatureConfig?: import('../types/signatureConfig').SignatureConfig | null;
    emailSignatureTemplate?: string | null;
  },
  subCompanyId?: string,
): Promise<AgencySignatureResponse> {
  const path = subCompanyId
    ? `/settings/email-signature?subCompanyId=${encodeURIComponent(subCompanyId)}`
    : '/settings/email-signature';
  const res = await fetch(`${API_PREFIX}${path}`, {
    method: 'PATCH',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? 'Failed to save agency signature');
  }
  return data as AgencySignatureResponse;
}

/** @deprecated Prefer updateAgencySignature with config */
export async function updateAgencySignatureTemplate(template: string | null, subCompanyId?: string): Promise<void> {
  await updateAgencySignature({ emailSignatureTemplate: template }, subCompanyId);
}

export interface ApiEmailSignature {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function fetchEmailSignatures(): Promise<ApiEmailSignature[]> {
  const res = await apiFetch<ApiEmailSignature[]>('/email-signatures');
  return res.ok ? (res.data ?? []) : [];
}

export async function createEmailSignature(data: { name: string; content: string; isDefault?: boolean }): Promise<ApiEmailSignature> {
  const res = await fetch(`${API_PREFIX}/email-signatures`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? 'Failed to create signature');
  return json as ApiEmailSignature;
}

export async function updateEmailSignature(id: string, data: { name?: string; content?: string; isDefault?: boolean }): Promise<ApiEmailSignature> {
  const res = await fetch(`${API_PREFIX}/email-signatures/${id}`, {
    method: 'PATCH',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? 'Failed to update signature');
  return json as ApiEmailSignature;
}

export async function uploadSignatureImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('image', file);
  const token = getStoredToken();
  const res = await fetch(`${API_PREFIX}/email-signatures/upload-image`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? 'Upload failed');
  return (json as { url: string }).url;
}

export async function deleteEmailSignature(id: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/email-signatures/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error((json as { error?: string }).error ?? 'Failed to delete signature');
  }
}

export interface ClientLocationSearchResult {
  address: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  clientName: string;
}

/** GET /clients — list clients (agency-scoped). Paginated; use limit for “fetch all” when needed. */
export async function fetchClients(params?: {
  page?: number;
  limit?: number;
  status?: string;
  assignedScope?: 'mine' | 'team';
  lostScope?: 'mine' | 'team';
  contactedByMe?: boolean;
  contactedScope?: 'mine' | 'team';
  search?: string;
  industry?: string;
  location?: string;
  companySize?: string;
  tags?: string;
  hasLead?: boolean;
  ownershipType?: 'management' | 'associate';
  sortBy?: 'name' | 'industry' | 'location' | 'lastActivity' | 'updatedAt' | 'createdAt' | 'serialNumber';
  sortOrder?: 'asc' | 'desc';
  subCompanyId?: string;
  agencyIds?: string[];
  ownerIds?: string[]; ownerExact?: boolean;
  /** Global DB Clients tab — org-wide `visibility: global` only; ignores agency/owner scope. */
  globalDb?: boolean;
  /** Linked agency scope: show clients of a linked agency (validated server-side against link group). */
  linkedAgencyId?: string;
}) {
  const searchParams = new URLSearchParams();
  if (params?.page != null) searchParams.set('page', String(params.page));
  if (params?.limit != null) searchParams.set('limit', String(params.limit));
  if (params?.status) searchParams.set('status', params.status);
  if (params?.assignedScope) searchParams.set('assignedScope', params.assignedScope);
  if (params?.lostScope) searchParams.set('lostScope', params.lostScope);
  if (params?.contactedByMe === true) searchParams.set('contactedByMe', 'true');
  if (params?.contactedByMe === false) searchParams.set('contactedByMe', 'false');
  if (params?.contactedScope) searchParams.set('contactedScope', params.contactedScope);
  if (params?.search) searchParams.set('search', params.search);
  if (params?.industry) searchParams.set('industry', params.industry);
  if (params?.location) searchParams.set('location', params.location);
  if (params?.companySize) searchParams.set('companySize', params.companySize);
  if (params?.tags) searchParams.set('tags', params.tags);
  if (params?.hasLead === true) searchParams.set('hasLead', 'true');
  if (params?.hasLead === false) searchParams.set('hasLead', 'false');
  if (params?.ownershipType) searchParams.set('ownershipType', params.ownershipType);
  if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);
  if (params?.subCompanyId) searchParams.set('subCompanyId', params.subCompanyId);
  if (params?.agencyIds?.length) searchParams.set('agencyIds', params.agencyIds.join(','));
  appendOwnerIds(searchParams, params?.ownerIds, params?.ownerExact);
  if (params?.globalDb) searchParams.set('globalDb', 'true');
  if (params?.linkedAgencyId) searchParams.set('linkedAgencyId', params.linkedAgencyId);
  const res = await apiFetch<{
    data: Array<{
      id: string;
      corporateCode: string;
      name: string;
      industry: string | null;
      location: string | null;
      address: string | null;
      companySize: string | null;
      status: string;
      lastActivity: string | null;
      createdAt: string;
      contactedByMe?: boolean;
      contactedByName?: string;
      hasOutreach?: boolean;
      latestOutreachByName?: string;
      hasOpenLead?: boolean;
      activeLeadId?: string;
      activeLeadOwnerId?: string;
      activeLeadOwnerName?: string;
      activeLeadAgencyId?: string;
      activeLeadAgencyName?: string;
      assignedOwnerId?: string;
      assignedOwnerName?: string;
      latestLostLeadId?: string;
      latestLostById?: string;
      latestLostByName?: string;
      latestLostAgencyId?: string;
      latestLostAgencyName?: string;
      latestLostAt?: string;
      latestLossReason?: string;
      contacts: Array<{
        id: string;
        clientId: string;
        name: string;
        title: string | null;
        email: string | null;
        phone: string | null;
        phoneExtension: string | null;
        linkedin: string | null;
        website: string | null;
        isPrimary: boolean;
      }>;
      tags: string[];
      restrictedUsers?: string[];
      ownershipType?: 'management' | 'associate' | null;
      ownershipUserId?: string | null;
      ownershipUserName?: string | null;
    }>;
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>(`/clients?${searchParams.toString()}`);
  if (!res.ok) return { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
  return res.data ?? { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
}

export async function fetchClientFacets(params?: { subCompanyId?: string }): Promise<{
  industries: string[];
  cities: string[];
  provinces: string[];
  companySizes: string[];
}> {
  const searchParams = new URLSearchParams();
  if (params?.subCompanyId) searchParams.set('subCompanyId', params.subCompanyId);
  const res = await apiFetch<{
    industries: string[];
    cities: string[];
    provinces: string[];
    companySizes: string[];
  }>(`/clients/facets?${searchParams.toString()}`);
  if (!res.ok) return { industries: [], cities: [], provinces: [], companySizes: [] };
  return res.data ?? { industries: [], cities: [], provinces: [], companySizes: [] };
}

/** POST /clients — create client (Add Client flow). May return 202 when submission is queued for director approval. */
export type ClientStorageInfo = {
  subCompanyId: string;
  agencyName: string | null;
  visibility?: string;
  pending?: boolean;
};

export type CreateClientResult =
  | { pendingSubmission: true; id: string; name: string; message?: string; storage?: ClientStorageInfo }
  | {
      pendingSubmission: false;
      id?: string;
      name: string;
      corporateCode?: string;
      contacts?: unknown[];
      locations?: unknown[];
      tags?: string[];
      storage?: ClientStorageInfo;
      message?: string;
      autoApproved?: boolean;
      globalDatabase?: boolean;
    };

export async function createClient(payload: {
  name: string;
  industry?: string;
  location?: string;
  address?: string;
  companySize?: string;
  tags?: string[];
  contacts: Array<{
    name: string;
    title?: string;
    email?: string;
    phone?: string;
    phoneExtension?: string;
    linkedin?: string;
    website?: string;
    isPrimary?: boolean;
  }>;
  locationAddress?: {
    unit?: string;
    streetAddress?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  };
  subCompanyId?: string;
  /** Database Manager + both mode: global vs agency for this add. */
  databaseDestination?: 'global' | 'agency';
}): Promise<CreateClientResult> {
  const isGlobalDestination = payload.databaseDestination === 'global';
  const path =
    payload.subCompanyId && !isGlobalDestination
      ? `/clients?subCompanyId=${encodeURIComponent(payload.subCompanyId)}`
      : '/clients';
  const { subCompanyId: _subCompanyId, databaseDestination, ...body } = payload;
  void _subCompanyId;
  const requestBody = databaseDestination ? { ...body, databaseDestination } : body;
  const res = await fetch(`${API_PREFIX}${path}`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(requestBody),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 202) {
    const d = data as {
      id?: string;
      name?: string;
      message?: string;
      storage?: ClientStorageInfo;
    };
    if (!d.id) throw new Error('Invalid queued response from server');
    return {
      pendingSubmission: true,
      id: d.id,
      name: d.name ?? '',
      message: d.message,
      storage: d.storage,
    };
  }
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to create client');
  const row = data as {
    id?: string;
    name: string;
    corporateCode?: string;
    contacts?: unknown[];
    locations?: unknown[];
    tags?: string[];
    storage?: ClientStorageInfo;
    message?: string;
    autoApproved?: boolean;
    globalDatabase?: boolean;
  };
  return {
    pendingSubmission: false,
    id: row.id,
    name: row.name,
    corporateCode: row.corporateCode,
    contacts: row.contacts ?? [],
    locations: row.locations ?? [],
    tags: row.tags,
    storage: row.storage,
    message: row.message,
    autoApproved: row.autoApproved,
    globalDatabase: row.globalDatabase,
  };
}

export interface PendingImportContact {
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  extension?: string | null;
  linkedin?: string | null;
}

export interface PendingImportRecord {
  id: string;
  subCompanyId: string | null;
  importedById: string;
  name: string;
  industry: string | null;
  location: string | null;
  address: string | null;
  companySize: string | null;
  website: string | null;
  employees: string | null;
  sourceId: string | null;
  tags: string[];
  contacts: PendingImportContact[];
  importedAt: string;
  importedBy: { firstName: string; lastName: string };
}

export interface SavePendingImportClient {
  name: string;
  industry?: string | null;
  location?: string | null;
  address?: string | null;
  companySize?: string | null;
  website?: string | null;
  employees?: string | null;
  sourceId?: string | null;
  tags?: string[];
  contacts?: PendingImportContact[];
}

export async function savePendingImports(
  clients: SavePendingImportClient[],
  params?: { subCompanyId?: string; importDestination?: 'global' | 'agency' },
): Promise<{ count: number; autoApprovedCount?: number; destination?: string; agencyName?: string }> {
  const isGlobalImport = params?.importDestination === 'global';
  const search = new URLSearchParams();
  if (params?.subCompanyId && !isGlobalImport) search.set('subCompanyId', params.subCompanyId);
  const q = search.toString() ? `?${search.toString()}` : '';
  const body: {
    clients: SavePendingImportClient[];
    subCompanyId?: string;
    importDestination?: 'global' | 'agency';
  } = { clients };
  if (params?.subCompanyId && !isGlobalImport) body.subCompanyId = params.subCompanyId;
  if (params?.importDestination) body.importDestination = params.importDestination;
  const res = await fetch(`${API_PREFIX}/clients/pending-imports${q}`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const body = data as { error?: string; details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] } };
    let msg = body.error ?? `Failed to save pending imports (HTTP ${res.status})`;
    if (body.details?.fieldErrors) {
      const fieldMsgs = Object.entries(body.details.fieldErrors)
        .flatMap(([k, v]) => v.map((m) => `${k}: ${m}`))
        .slice(0, 3);
      if (fieldMsgs.length) msg += ` — ${fieldMsgs.join('; ')}`;
    }
    // Log full payload + response so dev can see exactly what failed in the console.
    console.error('savePendingImports failed', { status: res.status, body, sentClients: clients });
    throw new Error(msg);
  }
  return data as { count: number; autoApprovedCount?: number; destination?: string; agencyName?: string };
}

export async function fetchClientFlowConfig(params?: {
  subCompanyId?: string;
}): Promise<ClientFlowConfig> {
  const search = params?.subCompanyId
    ? `?subCompanyId=${encodeURIComponent(params.subCompanyId)}`
    : '';
  const res = await fetch(`${API_PREFIX}/clients/client-flow-config${search}`, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to load client flow config');
  return normalizeClientFlowConfig(data as Record<string, unknown>);
}

export async function fetchDatabaseManagerImportConfig(): Promise<DatabaseManagerImportConfig> {
  const config = await fetchClientFlowConfig();
  if (!isElevatedClientFlowConfig(config)) {
    throw new Error('Client flow config is not available for this role');
  }
  return config;
}

export interface ImportCheckResult {
  duplicateEmails: Array<{ email: string; clientName: string; clientId: string }>;
  duplicatePhones: Array<{ phone: string; clientName: string; clientId: string }>;
  duplicateCompanyNames: Array<{ name: string; clientName: string; clientId: string }>;
  inFileDuplicateEmails: string[];
  inFileDuplicatePhones: string[];
  hasConflicts: boolean;
}

export async function checkImportDuplicates(
  payload: {
    clients: SavePendingImportClient[];
    emails?: string[];
    phones?: string[];
    companyNames?: string[];
  },
  params?: {
    subCompanyId?: string;
    importDestination?: 'global' | 'agency';
  },
): Promise<ImportCheckResult> {
  const search = new URLSearchParams();
  if (params?.subCompanyId) search.set('subCompanyId', params.subCompanyId);
  const q = search.toString() ? `?${search.toString()}` : '';
  const res = await fetch(`${API_PREFIX}/clients/import-check${q}`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({
      clients: payload.clients,
      emails: payload.emails ?? [],
      phones: payload.phones ?? [],
      companyNames: payload.companyNames ?? [],
      subCompanyId: params?.subCompanyId,
      importDestination: params?.importDestination,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Import check failed');
  return data as ImportCheckResult;
}

export async function fetchPendingImports(params?: {
  subCompanyId?: string;
  scope?: 'global';
}): Promise<PendingImportRecord[]> {
  const search = new URLSearchParams();
  if (params?.subCompanyId) search.set('subCompanyId', params.subCompanyId);
  if (params?.scope) search.set('scope', params.scope);
  const q = search.toString() ? `?${search.toString()}` : '';
  const res = await fetch(`${API_PREFIX}/clients/pending-imports${q}`, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => []);
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to fetch pending imports');
  return data as PendingImportRecord[];
}

export interface PendingManualSubmissionRecord {
  id: string;
  subCompanyId: string | null;
  submissionSource?: 'agency' | 'global_database';
  submittedById: string;
  name: string;
  industry: string | null;
  location: string | null;
  address: string | null;
  companySize: string | null;
  tags: string[];
  contacts: unknown;
  locationAddress: unknown | null;
  submitterRole: string | null;
  submittedAt: string;
  currentStepIndex?: number;
  approvalChain?: unknown;
  managerApprovedAt?: string | null;
  managerApprovedById?: string | null;
  submittedBy: { id: string; firstName: string; lastName: string; email: string; role: string };
  managerApprovedBy?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
  } | null;
}

export async function fetchPendingClientSubmissions(params?: {
  subCompanyId?: string;
  scope?: 'global';
}): Promise<PendingManualSubmissionRecord[]> {
  const search = new URLSearchParams();
  if (params?.subCompanyId) search.set('subCompanyId', params.subCompanyId);
  if (params?.scope) search.set('scope', params.scope);
  const q = search.toString() ? `?${search.toString()}` : '';
  const res = await fetch(`${API_PREFIX}/clients/pending-submissions${q}`, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => []);
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to fetch pending submissions');
  return data as PendingManualSubmissionRecord[];
}

export async function managerApprovePendingClientSubmission(
  id: string,
): Promise<PendingManualSubmissionRecord> {
  const res = await fetch(
    `${API_PREFIX}/clients/pending-submissions/${encodeURIComponent(id)}/manager-approve`,
    {
      method: 'POST',
      headers: getAuthHeaders() as HeadersInit,
      credentials: 'include',
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to record manager approval');
  return data as PendingManualSubmissionRecord;
}

export async function approvePendingClientSubmission(
  id: string,
): Promise<Exclude<CreateClientResult, { pendingSubmission: true }>> {
  const res = await fetch(`${API_PREFIX}/clients/pending-submissions/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to approve submission');
  const row = data as {
    id: string;
    name: string;
    corporateCode: string;
    contacts?: unknown[];
    locations?: unknown[];
    tags?: string[];
  };
  return {
    pendingSubmission: false,
    id: row.id,
    name: row.name,
    corporateCode: row.corporateCode,
    contacts: row.contacts ?? [],
    locations: row.locations ?? [],
    tags: row.tags,
  };
}

export async function deletePendingClientSubmission(id: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/clients/pending-submissions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Failed to delete pending submission');
  }
}

export type UpdateClientResult =
  | { pendingEdit: true; id: string; clientId: string; name: string; message?: string }
  | {
      pendingEdit: false;
      id: string;
      name: string;
      contacts: unknown[];
      locations: unknown[];
      tags?: string[];
    };

export async function updateClient(
  clientId: string,
  payload: {
    name: string;
    industry?: string;
    location?: string;
    address?: string;
    companySize?: string;
    tags?: string[];
    contacts: Array<{
      id?: string;
      name: string;
      title?: string;
      email?: string;
      phone?: string;
      phoneExtension?: string;
      linkedin?: string;
      website?: string;
      isPrimary?: boolean;
    }>;
    locationAddress?: {
      unit?: string;
      streetAddress?: string;
      city?: string;
      region?: string;
      postalCode?: string;
      country?: string;
    };
    subCompanyId?: string;
  },
): Promise<UpdateClientResult> {
  const q = payload.subCompanyId
    ? `?subCompanyId=${encodeURIComponent(payload.subCompanyId)}`
    : '';
  const { subCompanyId: _subCompanyId, ...body } = payload;
  void _subCompanyId;
  const res = await fetch(`${API_PREFIX}/clients/${encodeURIComponent(clientId)}${q}`, {
    method: 'PATCH',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 202) {
    const d = data as { id?: string; clientId?: string; name?: string; message?: string };
    if (!d.id || !d.clientId) throw new Error('Invalid queued response from server');
    return {
      pendingEdit: true,
      id: d.id,
      clientId: d.clientId,
      name: d.name ?? '',
      message: d.message,
    };
  }
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to update client');
  const row = data as {
    id: string;
    name: string;
    contacts?: unknown[];
    locations?: unknown[];
    tags?: string[];
  };
  return {
    pendingEdit: false,
    id: row.id,
    name: row.name,
    contacts: row.contacts ?? [],
    locations: row.locations ?? [],
    tags: row.tags,
  };
}

export interface PendingClientEditRecord {
  id: string;
  subCompanyId: string;
  clientId: string;
  submittedById: string;
  name: string;
  industry: string | null;
  location: string | null;
  address: string | null;
  companySize: string | null;
  tags: string[];
  contacts: unknown;
  locationAddress: unknown | null;
  submitterRole: string | null;
  submittedAt: string;
  managerApprovedAt?: string | null;
  managerApprovedById?: string | null;
  client: {
    id: string;
    name: string;
    corporateCode: string;
    industry?: string | null;
    location?: string | null;
    address?: string | null;
    companySize?: string | null;
    tags?: string[];
    contacts?: Array<{
      id: string;
      name: string;
      title: string | null;
      email: string | null;
      phone: string | null;
      phoneExtension: string | null;
      linkedin: string | null;
      website: string | null;
      isPrimary: boolean;
    }>;
  };
  submittedBy: { id: string; firstName: string; lastName: string; email: string; role: string };
  managerApprovedBy?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
  } | null;
}

export async function fetchPendingClientEdits(params?: {
  subCompanyId?: string;
}): Promise<PendingClientEditRecord[]> {
  const search = new URLSearchParams();
  if (params?.subCompanyId) search.set('subCompanyId', params.subCompanyId);
  const q = search.toString() ? `?${search.toString()}` : '';
  const res = await fetch(`${API_PREFIX}/clients/pending-edits${q}`, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => []);
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to fetch pending edits');
  return data as PendingClientEditRecord[];
}

export async function managerApprovePendingClientEdit(
  id: string,
): Promise<PendingClientEditRecord> {
  const res = await fetch(
    `${API_PREFIX}/clients/pending-edits/${encodeURIComponent(id)}/manager-approve`,
    {
      method: 'POST',
      headers: getAuthHeaders() as HeadersInit,
      credentials: 'include',
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to record manager approval');
  return data as PendingClientEditRecord;
}

export async function approvePendingClientEdit(
  id: string,
): Promise<Exclude<UpdateClientResult, { pendingEdit: true }>> {
  const res = await fetch(`${API_PREFIX}/clients/pending-edits/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to approve edit');
  const row = data as {
    id: string;
    name: string;
    contacts?: unknown[];
    locations?: unknown[];
    tags?: string[];
  };
  return {
    pendingEdit: false,
    id: row.id,
    name: row.name,
    contacts: row.contacts ?? [],
    locations: row.locations ?? [],
    tags: row.tags,
  };
}

export async function deletePendingClientEdit(id: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/clients/pending-edits/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Failed to delete pending edit');
  }
}

export async function deletePendingImport(id: string, params?: { subCompanyId?: string }): Promise<void> {
  const search = new URLSearchParams();
  if (params?.subCompanyId) search.set('subCompanyId', params.subCompanyId);
  const q = search.toString() ? `?${search.toString()}` : '';
  const res = await fetch(`${API_PREFIX}/clients/pending-imports/${id}${q}`, {
    method: 'DELETE',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Failed to delete pending import');
  }
}

export type ApprovePendingImportMode = 'new' | 'append' | 'branch';

export async function bulkApprovePendingImports(
  ids: string[],
  params?: { subCompanyId?: string },
): Promise<{
  approved: number;
  failed: Array<{ id: string; name: string; error: string }>;
  clientIds: string[];
}> {
  const search = new URLSearchParams();
  if (params?.subCompanyId) search.set('subCompanyId', params.subCompanyId);
  const q = search.toString() ? `?${search.toString()}` : '';
  const res = await fetch(`${API_PREFIX}/clients/pending-imports/bulk-approve${q}`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ ids }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? 'Failed to bulk approve pending imports');
  }
  return data as {
    approved: number;
    failed: Array<{ id: string; name: string; error: string }>;
    clientIds: string[];
  };
}

export async function bulkRejectPendingImports(
  ids: string[],
  params?: { subCompanyId?: string },
): Promise<{ deleted: number }> {
  const search = new URLSearchParams();
  if (params?.subCompanyId) search.set('subCompanyId', params.subCompanyId);
  const q = search.toString() ? `?${search.toString()}` : '';
  const res = await fetch(`${API_PREFIX}/clients/pending-imports/bulk-reject${q}`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ ids }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? 'Failed to bulk reject pending imports');
  }
  return data as { deleted: number };
}

export async function approvePendingImport(
  id: string,
  payload: { mode: ApprovePendingImportMode; targetClientId?: string },
  params?: { subCompanyId?: string },
): Promise<{ mode: ApprovePendingImportMode; clientId: string; parentClientId?: string | null; appended?: number }> {
  const search = new URLSearchParams();
  if (params?.subCompanyId) search.set('subCompanyId', params.subCompanyId);
  const q = search.toString() ? `?${search.toString()}` : '';
  const res = await fetch(`${API_PREFIX}/clients/pending-imports/${id}/approve${q}`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to approve pending import');
  return data;
}

export interface ImportMappingTemplate {
  id: string;
  subCompanyId: string;
  name: string | null;
  headerFingerprint: string;
  mapping: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  createdBy?: { firstName: string; lastName: string; email: string } | null;
}

export async function fetchImportMappingTemplate(
  fingerprint: string,
  entityType: 'client' | 'contact' = 'client',
): Promise<ImportMappingTemplate | null> {
  const params = new URLSearchParams({
    fingerprint,
    entityType,
  });
  const res = await fetch(
    `${API_PREFIX}/clients/import-mapping-templates?${params.toString()}`,
    { headers: getAuthHeaders() as HeadersInit, credentials: 'include' },
  );
  const data = await res.json().catch(() => ({ template: null }));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to fetch mapping template');
  return (data as { template: ImportMappingTemplate | null }).template;
}

export async function saveImportMappingTemplate(payload: {
  headerFingerprint: string;
  mapping: Record<string, string>;
  name?: string | null;
  entityType?: 'client' | 'contact';
}): Promise<ImportMappingTemplate> {
  const res = await fetch(`${API_PREFIX}/clients/import-mapping-templates`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ entityType: 'client', ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to save mapping template');
  return (data as { template: ImportMappingTemplate }).template;
}

// ——— Contact-only CSV import ———

export interface ContactImportContact {
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  extension?: string | null;
  linkedin?: string | null;
  isPrimary?: boolean | null;
}

export interface ContactImportRow {
  corporateCode?: string | null;
  companyName?: string | null;
  importSourceId?: string | null;
  contacts: ContactImportContact[];
}

export interface ContactImportCheckResult {
  unmatched: Array<{
    rowIndex: number;
    corporateCode?: string | null;
    companyName?: string | null;
    importSourceId?: string | null;
    reason: string;
  }>;
  duplicateEmails: Array<{ email: string; clientName: string; clientId: string }>;
  duplicatePhones: Array<{ phone: string; clientName: string; clientId: string }>;
  inFileDuplicateEmails: string[];
  inFileDuplicatePhones: string[];
  ambiguousMatches: Array<{
    matchKey: string;
    matchValue: string;
    clientIds: string[];
  }>;
  matched: Array<{
    rowIndex: number;
    targetClientId: string;
    clientName: string;
    matchKey: string;
    matchValue: string;
    contactCount: number;
  }>;
  hasConflicts: boolean;
}

export interface PendingContactImportRecord {
  id: string;
  subCompanyId: string | null;
  submissionSource: 'agency' | 'global_database';
  importedById: string;
  targetClientId: string;
  matchKey: string;
  matchValue: string;
  contacts: ContactImportContact[];
  importedAt: string;
  currentStepIndex?: number;
  approvalChain?: string[];
  importedBy?: { firstName: string | null; lastName: string | null } | null;
  targetClient?: { id: string; name: string; corporateCode: string | null } | null;
}

export async function checkContactImportDuplicates(
  payload: {
    rows: ContactImportRow[];
    subCompanyId?: string;
    importDestination?: 'global' | 'agency';
  },
): Promise<ContactImportCheckResult> {
  const res = await fetch(`${API_PREFIX}/clients/contact-import-check`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Contact import check failed');
  return data as ContactImportCheckResult;
}

export async function savePendingContactImports(
  rows: ContactImportRow[],
  params?: { subCompanyId?: string; importDestination?: 'global' | 'agency' },
): Promise<{ count: number; autoApprovedCount?: number; ids?: string[] }> {
  const body: {
    rows: ContactImportRow[];
    subCompanyId?: string;
    importDestination?: 'global' | 'agency';
  } = { rows };
  if (params?.subCompanyId && params.importDestination !== 'global') {
    body.subCompanyId = params.subCompanyId;
  }
  if (params?.importDestination) body.importDestination = params.importDestination;
  const res = await fetch(`${API_PREFIX}/clients/pending-contact-imports`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data as { error?: string; conflicts?: ContactImportCheckResult };
    throw Object.assign(new Error(err.error ?? 'Failed to save pending contact imports'), {
      conflicts: err.conflicts,
    });
  }
  return data as { count: number; autoApprovedCount?: number; ids?: string[] };
}

export async function fetchPendingContactImports(params?: {
  subCompanyId?: string;
  scope?: 'global';
}): Promise<PendingContactImportRecord[]> {
  const search = new URLSearchParams();
  if (params?.subCompanyId) search.set('subCompanyId', params.subCompanyId);
  if (params?.scope) search.set('scope', params.scope);
  const q = search.toString() ? `?${search.toString()}` : '';
  const res = await fetch(`${API_PREFIX}/clients/pending-contact-imports${q}`, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => []);
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to load pending contact imports');
  return data as PendingContactImportRecord[];
}

export async function bulkApprovePendingContactImports(
  ids: string[],
  params?: { subCompanyId?: string },
): Promise<{ approved: number; failed: Array<{ id: string; error: string }>; totalAppended: number }> {
  const search = params?.subCompanyId
    ? `?subCompanyId=${encodeURIComponent(params.subCompanyId)}`
    : '';
  const res = await fetch(`${API_PREFIX}/clients/pending-contact-imports/bulk-approve${search}`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ ids }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Bulk approve failed');
  return data as { approved: number; failed: Array<{ id: string; error: string }>; totalAppended: number };
}

export async function bulkRejectPendingContactImports(
  ids: string[],
  params?: { subCompanyId?: string },
): Promise<{ rejected: number }> {
  const search = params?.subCompanyId
    ? `?subCompanyId=${encodeURIComponent(params.subCompanyId)}`
    : '';
  const res = await fetch(`${API_PREFIX}/clients/pending-contact-imports/bulk-reject${search}`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ ids }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Bulk reject failed');
  return data as { rejected: number };
}

export async function approvePendingContactImport(
  id: string,
  params?: { subCompanyId?: string },
): Promise<{ mode: string; clientId: string; appended: number }> {
  const search = params?.subCompanyId
    ? `?subCompanyId=${encodeURIComponent(params.subCompanyId)}`
    : '';
  const res = await fetch(`${API_PREFIX}/clients/pending-contact-imports/${id}/approve${search}`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Approve failed');
  return data as { mode: string; clientId: string; appended: number };
}

export async function deletePendingContactImport(
  id: string,
  params?: { subCompanyId?: string },
): Promise<void> {
  const search = params?.subCompanyId
    ? `?subCompanyId=${encodeURIComponent(params.subCompanyId)}`
    : '';
  const res = await fetch(`${API_PREFIX}/clients/pending-contact-imports/${id}${search}`, {
    method: 'DELETE',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Reject failed');
  }
}

/** GET /clients/location-search?q= — search existing addresses (throttle/debounce on caller). Min 2 chars. */
export async function searchClientLocations(q: string): Promise<ClientLocationSearchResult[]> {
  const trimmed = q.trim();
  if (trimmed.length < 2) return [];
  const res = await apiFetch<{ data: ClientLocationSearchResult[] }>(
    `/clients/location-search?${new URLSearchParams({ q: trimmed }).toString()}`
  );
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

/** GET /clients/check-address — check if address (street + unit + city + region + postalCode) already exists. */
export async function checkClientAddressExists(params: {
  unit?: string;
  streetAddress: string;
  city: string;
  region: string;
  postalCode: string;
}): Promise<{ exists: boolean; clientName?: string }> {
  const searchParams = new URLSearchParams();
  if (params.unit != null && params.unit !== '') searchParams.set('unit', params.unit);
  searchParams.set('streetAddress', params.streetAddress);
  searchParams.set('city', params.city);
  searchParams.set('region', params.region);
  searchParams.set('postalCode', params.postalCode);
  const res = await apiFetch<{ exists: boolean; clientName?: string }>(`/clients/check-address?${searchParams.toString()}`);
  if (!res.ok) return { exists: false };
  return res.data ?? { exists: false };
}

/** When true, director/super_admin receive merged client detail across allowed agencies. */
export type ClientDetailFetchOptions = { allAgencies?: boolean };

function appendClientDetailScope(path: string, opts?: ClientDetailFetchOptions): string {
  if (!opts?.allAgencies) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}allAgencies=true`;
}

/** GET /clients/:id — fetch single client (for detail sheet, after contact updates). */
export async function fetchClient(
  id: string,
  opts?: ClientDetailFetchOptions,
): Promise<{
  id: string;
  name: string;
  industry: string | null;
  location: string | null;
  address: string | null;
  companySize: string | null;
  status: string;
  lastActivity: string | null;
  createdAt: string;
  unsubscribeRestricted?: boolean;
  positionsClosed?: number;
  restrictedUsers?: string[];
  tags: string[];
  notes: Array<{
    id: string;
    clientId: string;
    userId: string;
    userName: string;
    userRole: string;
    content: string;
    isPublic: boolean;
    isPinned: boolean;
    createdAt: string;
  }>;
  contacts: Array<{
    id: string;
    clientId: string;
    name: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    phoneExtension: string | null;
    linkedin: string | null;
    website: string | null;
    isPrimary: boolean;
    isUnsubscribed?: boolean;
  }>;
} | null> {
  const res = await apiFetch<{
    id: string;
    name: string;
    industry: string | null;
    location: string | null;
    address: string | null;
    companySize: string | null;
    status: string;
    lastActivity: string | null;
    createdAt: string;
    restrictedUsers?: string[];
    hasOpenLead?: boolean;
    activeLeadId?: string;
    activeLeadOwnerId?: string;
    activeLeadOwnerName?: string;
    activeLeadAgencyId?: string;
    activeLeadAgencyName?: string;
    assignedOwnerId?: string;
    assignedOwnerName?: string;
    latestLostLeadId?: string;
    latestLostById?: string;
    latestLostByName?: string;
    latestLostAgencyId?: string;
    latestLostAgencyName?: string;
    latestLostAt?: string;
    latestLossReason?: string;
    unsubscribeRestricted?: boolean;
    positionsClosed?: number;
  notes?: Array<{
    id: string;
    clientId: string;
    userId: string;
    userName: string;
    userRole: string;
    content: string;
    isPublic: boolean;
    isPinned: boolean;
    createdAt: string;
  }>;
  contacts: Array<{
      id: string;
      clientId: string;
      name: string;
      title: string | null;
      email: string | null;
      phone: string | null;
      phoneExtension: string | null;
      linkedin: string | null;
      website: string | null;
      isPrimary: boolean;
      isUnsubscribed?: boolean;
    }>;
    tags?: Array<{ tag: string }>;
  }>(appendClientDetailScope(`/clients/${encodeURIComponent(id)}`, opts));
  if (!res.ok || !res.data) return null;
  const d = res.data;
  return {
    ...d,
    tags: Array.isArray(d.tags) ? d.tags.map((t: { tag: string }) => t.tag) : [],
    notes: Array.isArray(d.notes) ? d.notes : [],
    restrictedUsers: Array.isArray((d as { restrictedUsers?: string[] }).restrictedUsers)
      ? (d as { restrictedUsers: string[] }).restrictedUsers
      : [],
  };
}

/** PATCH /clients/:id/restrictions — super users block/allow agency users on a client. */
export async function updateClientRestriction(
  clientId: string,
  userId: string,
  restricted: boolean,
): Promise<string[]> {
  const res = await apiFetch<{ restrictedUsers: string[] }>(
    `/clients/${encodeURIComponent(clientId)}/restrictions`,
    {
      method: 'PATCH',
      body: JSON.stringify({ userId, restricted }),
    },
  );
  if (!res.ok) throw new Error('Failed to update client access');
  return res.data?.restrictedUsers ?? [];
}

/** GET /users/ownership-candidates — active users whose role does NOT have clients:ownership. */
export async function fetchOwnershipCandidates(params?: { subCompanyId?: string }): Promise<ApiUser[]> {
  const search = params?.subCompanyId ? `?subCompanyId=${encodeURIComponent(params.subCompanyId)}` : '';
  const res = await apiFetch<{ data: ApiUser[] }>(`/users/ownership-candidates${search}`);
  return res.data?.data ?? [];
}

export async function updateClientOwnership(
  clientId: string,
  ownershipType: 'management' | 'associate',
  ownershipUserId?: string | null,
): Promise<void> {
  const res = await apiFetch<{ success: boolean }>(
    `/clients/${encodeURIComponent(clientId)}/ownership`,
    {
      method: 'PATCH',
      body: JSON.stringify({ ownershipType, ownershipUserId: ownershipUserId ?? null }),
    },
  );
  if (!res.ok) throw new Error('Failed to update ownership');
}

/** Lead history entry from GET /clients/:id/lead-history */
export interface ApiLeadHistoryEntry {
  id: string;
  clientId: string;
  ownerId: string;
  subCompanyId: string;
  stage: string;
  status: string;
  temperature: string | null;
  value: string | null;
  notes: string | null;
  lossReason: string | null;
  closedAt: string | null;
  closedById: string | null;
  reassignedFromLeadId: string | null;
  reassignedById: string | null;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; firstName: string; lastName: string; email: string } | null;
  closedBy: { id: string; firstName: string; lastName: string; email: string } | null;
  /** Populated only for closed_won leads — creator of the winning (latest approved) proposal. */
  wonBy?: { id: string; firstName: string | null; lastName: string | null; email: string } | null;
  /** Populated only for reassigned leads — number of positions transferred. */
  numberOfPositions?: number | null;
}

/** GET /clients/:id/lead-history — agency-scoped lead attempt history for a client. */
export async function fetchLeadHistory(
  clientId: string,
  opts?: ClientDetailFetchOptions,
): Promise<ApiLeadHistoryEntry[]> {
  const res = await apiFetch<{ data: ApiLeadHistoryEntry[] }>(
    appendClientDetailScope(`/clients/${encodeURIComponent(clientId)}/lead-history`, opts),
  );
  if (!res.ok || !res.data) return [];
  return res.data.data ?? [];
}

/** GET /activity-logs — agency-scoped list; elevated roles may filter by userId; others receive own logs only. */
export async function fetchActivityLogs(params?: {
  page?: number;
  limit?: number;
  type?: string;
  userId?: string;
  from?: string;
  to?: string;
  subCompanyId?: string;
}): Promise<ActivityLog[]> {
  const searchParams = new URLSearchParams();
  if (params?.page != null) searchParams.set('page', String(params.page));
  if (params?.limit != null) searchParams.set('limit', String(params.limit));
  if (params?.type) searchParams.set('type', params.type);
  if (params?.userId) searchParams.set('userId', params.userId);
  if (params?.from) searchParams.set('from', params.from);
  if (params?.to) searchParams.set('to', params.to);
  if (params?.subCompanyId) searchParams.set('subCompanyId', params.subCompanyId);
  const qs = searchParams.toString();
  const res = await apiFetch<{
    data: Array<{
      id: string;
      type: string;
      userId: string;
      userName: string;
      subCompanyId: string;
      description: string;
      metadata?: Record<string, unknown> | null;
      timestamp: string;
    }>;
  }>(`/activity-logs${qs ? `?${qs}` : ''}`);
  if (!res.ok || !res.data) return [];
  return (res.data.data ?? []).map((a) => ({
    id: a.id,
    type: a.type as ActivityLog['type'],
    userId: a.userId,
    userName: a.userName,
    subCompanyId: a.subCompanyId,
    description: a.description,
    metadata: (a.metadata ?? undefined) as ActivityLog['metadata'],
    timestamp: new Date(a.timestamp),
  }));
}

/**
 * GET /activity-logs/mine — fetch the current user's own activity logs with optional type & date filter.
 * Does NOT require settings:read — works for all roles (associates, recruiters, etc.).
 */
export async function fetchMyActivityLogs(params?: {
  type?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<ActivityLog[]> {
  const sp = new URLSearchParams();
  if (params?.type)          sp.set('type',  params.type);
  if (params?.from)          sp.set('from',  params.from);
  if (params?.to)            sp.set('to',    params.to);
  if (params?.limit != null) sp.set('limit', String(params.limit));
  const qs = sp.toString();
  const res = await apiFetch<{
    data: Array<{
      id: string; type: string; userId: string; userName: string;
      subCompanyId: string; description: string;
      metadata?: Record<string, unknown> | null; timestamp: string;
    }>;
  }>(`/activity-logs/mine${qs ? `?${qs}` : ''}`);
  if (!res.ok || !res.data) return [];
  return (res.data.data ?? []).map((a) => ({
    id: a.id,
    type: a.type as ActivityLog['type'],
    userId: a.userId,
    userName: a.userName,
    subCompanyId: a.subCompanyId,
    description: a.description,
    metadata: (a.metadata ?? undefined) as ActivityLog['metadata'],
    timestamp: new Date(a.timestamp),
  }));
}

/** GET /activity-logs/my-time — fetch break & idle logs (no settings:read permission needed). */
export async function fetchMyTimeLogs(params?: {
  from?: string;
  to?: string;
  userId?: string;
  limit?: number;
  subCompanyId?: string;
}): Promise<ActivityLog[]> {
  const searchParams = new URLSearchParams();
  if (params?.from) searchParams.set('from', params.from);
  if (params?.to) searchParams.set('to', params.to);
  if (params?.userId) searchParams.set('userId', params.userId);
  if (params?.limit != null) searchParams.set('limit', String(params.limit));
  if (params?.subCompanyId) searchParams.set('subCompanyId', params.subCompanyId);
  const qs = searchParams.toString();
  const res = await apiFetch<Array<{
    id: string;
    type: string;
    userId: string;
    userName: string;
    subCompanyId: string;
    description: string;
    metadata?: Record<string, unknown> | null;
    timestamp: string;
  }>>(`/activity-logs/my-time${qs ? `?${qs}` : ''}`);
  if (!res.ok || !res.data) return [];
  return (res.data ?? []).map((a) => ({
    id: a.id,
    type: a.type as ActivityLog['type'],
    userId: a.userId,
    userName: a.userName,
    subCompanyId: a.subCompanyId,
    description: a.description,
    metadata: (a.metadata ?? undefined) as ActivityLog['metadata'],
    timestamp: new Date(a.timestamp),
  }));
}

/** POST /activity-logs/break — log completed break for current user. */
export async function logBreak(
  breakType: 'coaching' | 'meeting',
  durationSeconds: number,
  startedAt: string
): Promise<void> {
  const res = await fetch(`${API_PREFIX}/activity-logs/break`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ breakType, durationSeconds, startedAt }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Failed to log break');
  }
}

/** POST /activity-logs/idle — log detected idle period for current user. */
export async function logIdle(durationSeconds: number, startedAt: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/activity-logs/idle`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ durationSeconds, startedAt }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Failed to log idle time');
  }
}

/** GET /clients/:id/activity — client-specific activity timeline (agency-scoped). */
export async function fetchClientActivityLogs(
  clientId: string,
  params?: { page?: number; limit?: number },
  opts?: ClientDetailFetchOptions,
): Promise<ActivityLog[]> {
  const searchParams = new URLSearchParams();
  if (params?.page != null) searchParams.set('page', String(params.page));
  if (params?.limit != null) searchParams.set('limit', String(params.limit));
  if (opts?.allAgencies) searchParams.set('allAgencies', 'true');
  const qs = searchParams.toString();
  const path = `/clients/${encodeURIComponent(clientId)}/activity${qs ? `?${qs}` : ''}`;
  const res = await apiFetch<{
    data: Array<{
      id: string;
      type: string;
      userId: string;
      userName: string;
      subCompanyId: string;
      description: string;
      metadata?: Record<string, unknown> | null;
      timestamp: string;
    }>;
  }>(path);
  if (!res.ok || !res.data) return [];

  return (res.data.data ?? []).map((a) => ({
    id: a.id,
    type: a.type as ActivityLog['type'],
    userId: a.userId,
    userName: a.userName,
    subCompanyId: a.subCompanyId,
    description: a.description,
    metadata: (a.metadata ?? undefined) as ActivityLog['metadata'],
    timestamp: new Date(a.timestamp),
  }));
}

function withSubCompanyQuery(path: string, subCompanyId?: string): string {
  return subCompanyId ? `${path}?subCompanyId=${encodeURIComponent(subCompanyId)}` : path;
}

/** POST /clients/:id/contacts — add a contact (may queue for approval). */
export type ContactMutationResult =
  | { pendingEdit: true; id: string; clientId: string; name: string; message?: string }
  | { pendingEdit: false; autoApproved?: boolean; message?: string; [key: string]: unknown };

export async function addClientContact(
  clientId: string,
  payload: {
    name: string;
    title?: string;
    email?: string;
    phone?: string;
    phoneExtension?: string;
    linkedin?: string;
    website?: string;
    isPrimary?: boolean;
  },
  params?: { subCompanyId?: string },
): Promise<ContactMutationResult> {
  const res = await apiFetch<{
    pendingEdit?: boolean;
    id?: string;
    clientId?: string;
    name?: string;
    message?: string;
    autoApproved?: boolean;
    [key: string]: unknown;
  }>(withSubCompanyQuery(`/clients/${encodeURIComponent(clientId)}/contacts`, params?.subCompanyId), {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(res.error ?? 'Failed to add contact');
  const data = res.data;
  if (data.pendingEdit === true) {
    if (!data.id || !data.clientId) throw new Error('Invalid queued response from server');
    return {
      pendingEdit: true,
      id: data.id,
      clientId: data.clientId,
      name: data.name ?? '',
      message: data.message,
    };
  }
  return { pendingEdit: false, ...data };
}

/** PATCH /clients/:id/contacts/:contactId — update contact fields (may queue for approval). */
export async function updateClientContact(
  clientId: string,
  contactId: string,
  payload: {
    name?: string;
    title?: string | null;
    email?: string | null;
    phone?: string | null;
    phoneExtension?: string | null;
    linkedin?: string | null;
    website?: string | null;
    isPrimary?: boolean;
  },
  params?: { subCompanyId?: string },
): Promise<ContactMutationResult> {
  const res = await apiFetch<{
    pendingEdit?: boolean;
    id?: string;
    clientId?: string;
    name?: string;
    message?: string;
    autoApproved?: boolean;
    [key: string]: unknown;
  }>(
    withSubCompanyQuery(`/clients/${encodeURIComponent(clientId)}/contacts/${encodeURIComponent(contactId)}`, params?.subCompanyId),
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) throw new Error(res.error ?? 'Failed to update contact');
  const data = res.data;
  if (data.pendingEdit === true) {
    if (!data.id || !data.clientId) throw new Error('Invalid queued response from server');
    return {
      pendingEdit: true,
      id: data.id,
      clientId: data.clientId,
      name: data.name ?? '',
      message: data.message,
    };
  }
  return { pendingEdit: false, ...data };
}

/** PATCH /clients/:id/contacts/:contactId — set contact as primary. */
export async function setClientContactPrimary(clientId: string, contactId: string, params?: { subCompanyId?: string }): Promise<void> {
  const res = await apiFetch(
    withSubCompanyQuery(`/clients/${encodeURIComponent(clientId)}/contacts/${encodeURIComponent(contactId)}`, params?.subCompanyId),
    {
      method: 'PATCH',
      body: JSON.stringify({ isPrimary: true }),
    },
  );
  if (!res.ok) throw new Error('Failed to set primary contact');
}

/** PATCH /clients/:id/contacts/:contactId — toggle contact unsubscribed status. */
export async function updateContactUnsubscribed(clientId: string, contactId: string, isUnsubscribed: boolean, params?: { subCompanyId?: string }): Promise<void> {
  const res = await apiFetch(
    withSubCompanyQuery(`/clients/${encodeURIComponent(clientId)}/contacts/${encodeURIComponent(contactId)}`, params?.subCompanyId),
    {
      method: 'PATCH',
      body: JSON.stringify({ isUnsubscribed }),
    },
  );
  if (!res.ok) throw new Error('Failed to update contact');
}

/** POST /clients/:id/contacts/:contactId/unsubscribe — send unsub email and mark contact as unsubscribed. */
export async function unsubscribeContact(clientId: string, contactId: string, params?: { subCompanyId?: string }): Promise<{ message: string }> {
  const res = await apiFetch<{ message: string }>(
    withSubCompanyQuery(`/clients/${encodeURIComponent(clientId)}/contacts/${encodeURIComponent(contactId)}/unsubscribe`, params?.subCompanyId),
    { method: 'POST' },
  );
  if (!res.ok) throw new Error('Failed to unsubscribe contact');
  return res.data;
}

/** DELETE /clients/:id/contacts/:contactId — remove contact. Fails if last contact. */
export async function deleteClientContact(clientId: string, contactId: string, params?: { subCompanyId?: string }): Promise<void> {
  const res = await apiFetch(
    withSubCompanyQuery(`/clients/${encodeURIComponent(clientId)}/contacts/${encodeURIComponent(contactId)}`, params?.subCompanyId),
    { method: 'DELETE' },
  );
  if (!res.ok) throw new Error('Failed to remove contact');
}

/** POST /clients/:id/tags — add a tag to the client (agency-scoped). */
export async function addClientTag(clientId: string, tag: string, params?: { subCompanyId?: string }): Promise<void> {
  const res = await apiFetch(withSubCompanyQuery(`/clients/${encodeURIComponent(clientId)}/tags`, params?.subCompanyId), {
    method: 'POST',
    body: JSON.stringify({ tag: tag.trim() }),
  });
  if (!res.ok) throw new Error('Failed to add tag');
}

/** DELETE /clients/:id/tags/:tag — remove a tag from the client. */
export async function removeClientTag(clientId: string, tag: string, params?: { subCompanyId?: string }): Promise<void> {
  const res = await apiFetch(
    withSubCompanyQuery(`/clients/${encodeURIComponent(clientId)}/tags/${encodeURIComponent(tag)}`, params?.subCompanyId),
    { method: 'DELETE' },
  );
  if (!res.ok) throw new Error('Failed to remove tag');
}

/** API lead shape from GET /leads */
export interface ApiLead {
  id: string;
  clientId: string;
  ownerId: string;
  subCompanyId: string;
  stage: string;
  status: string;
  temperature: string | null;
  value?: number | null;
  lastActivity: string | null;
  nextFollowUp: string | null;
  notes: string | null;
  closedAt?: string | null;
  closedById?: string | null;
  lossReason?: string | null;
  reassignedFromLeadId?: string | null;
  reassignedById?: string | null;
  createdAt: string;
  updatedAt: string;
  client: { id: string; corporateCode: string; name: string; industry: string | null; location: string | null; contacts?: Array<{ name: string; title: string | null }> };
  owner: { id: string; firstName: string; lastName: string; email: string };
  latestProposalId?: string | null;
  latestProposalStatus?: 'pending' | 'approved' | 'rejected' | null;
  latestRejectionComment?: string | null;
  leadDeadline?: string | null;
  extensionRequested?: boolean;
  extensionReason?: string | null;
  extensionDays?: number | null;
  extensionStatus?: 'pending' | 'approved' | 'rejected' | null;
  extensionRequestedAt?: string | null;
  extensionReviewedAt?: string | null;
  reviewedBy?: string | null;
  managerRemarks?: string | null;
  reassignmentLocked?: boolean;
  lockedAssociateId?: string | null;
  requiresDeadlineAction?: boolean;
}

export interface ApiLeadExtensionRequest {
  id: string;
  leadId: string;
  requestedById: string;
  reason: string;
  requestedDays: number;
  status: 'pending' | 'approved' | 'rejected' | 'returned';
  managerRemarks?: string | null;
  requestedAt: string;
  reviewedAt?: string | null;
  reviewedById?: string | null;
  requestedBy?: { id: string; firstName: string; lastName: string; email?: string };
  reviewedBy?: { id: string; firstName: string; lastName: string; email?: string } | null;
  lead?: { id: string; status?: string; leadDeadline?: string | null; client: { id: string; name: string } };
}

/** GET /leads — list leads (agency-scoped; associates see own, managers see all). Pass agencyIds for elevated roles. */
export async function fetchLeads(params?: {
  page?: number;
  limit?: number;
  status?: string;
  stage?: string;
  ownerId?: string;
  subCompanyId?: string;
  agencyIds?: string[];
  ownerIds?: string[]; ownerExact?: boolean;
}): Promise<{ data: ApiLead[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  const searchParams = new URLSearchParams();
  if (params?.page != null) searchParams.set('page', String(params.page));
  if (params?.limit != null) searchParams.set('limit', String(params.limit));
  if (params?.status) searchParams.set('status', params.status);
  if (params?.stage) searchParams.set('stage', params.stage);
  if (params?.ownerId) searchParams.set('ownerId', params.ownerId);
  if (params?.subCompanyId) searchParams.set('subCompanyId', params.subCompanyId);
  if (params?.agencyIds?.length) searchParams.set('agencyIds', params.agencyIds.join(','));
  appendOwnerIds(searchParams, params?.ownerIds, params?.ownerExact);
  const res = await apiFetch<{ data: ApiLead[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>(
    `/leads?${searchParams.toString()}`
  );
  if (!res.ok) return { data: [], pagination: { page: 1, limit: 100, total: 0, totalPages: 0 } };
  return res.data ?? { data: [], pagination: { page: 1, limit: 100, total: 0, totalPages: 0 } };
}

/** API lead request shape from GET /lead-requests */
export interface ApiLeadRequest {
  id: string;
  clientId: string;
  clientName: string;
  primaryContactName: string;
  requestedBy: string;
  requestedByName: string;
  managerId: string;
  managerName: string;
  note: string;
  requestedAt: string;
  status: string;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  subCompanyId: string;
  comments: Array<{ id: string; userId: string; userName: string; text: string; createdAt: string }>;
  /** Present when Settings → Approvals bypasses the queue and the lead is assigned immediately. */
  autoApproved?: boolean;
}

/** GET /lead-requests — list lead requests (pending = requested, awaiting manager approval). */
export async function fetchLeadRequests(params?: { status?: 'pending' | 'approved' | 'rejected'; subCompanyId?: string; requestedByIds?: string[] }): Promise<ApiLeadRequest[]> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.subCompanyId) searchParams.set('subCompanyId', params.subCompanyId);
  if (params?.requestedByIds?.length) searchParams.set('requestedByIds', params.requestedByIds.join(','));
  const res = await apiFetch<{ data: ApiLeadRequest[] }>(`/lead-requests?${searchParams.toString()}`);
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

/** POST /lead-requests — request a lead (associate requests client; manager approves later). */
export async function createLeadRequest(payload: { clientId: string; managerId: string; note: string }): Promise<ApiLeadRequest> {
  const res = await fetch(`${API_PREFIX}/lead-requests`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to request lead');
  return data as ApiLeadRequest;
}

/** PATCH /lead-requests/:id/approve — approve request and create lead for requester. */
export async function approveLeadRequestApi(requestId: string, comments?: string): Promise<ApiLeadRequest> {
  const res = await fetch(`${API_PREFIX}/lead-requests/${requestId}/approve`, {
    method: 'PATCH',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ comments: comments ?? '' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to approve');
  return data as ApiLeadRequest;
}

/** PATCH /lead-requests/:id/reject */
export async function rejectLeadRequestApi(requestId: string, comments: string): Promise<ApiLeadRequest> {
  const res = await fetch(`${API_PREFIX}/lead-requests/${requestId}/reject`, {
    method: 'PATCH',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ comments }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to reject');
  return data as ApiLeadRequest;
}

/** POST /lead-requests/:id/comments — add a comment to an existing lead request */
export async function addLeadRequestCommentApi(requestId: string, text: string): Promise<{ id: string; userId: string; userName: string; text: string; createdAt: string }> {
  const res = await fetch(`${API_PREFIX}/lead-requests/${requestId}/comments`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ text }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to add comment');
  return data as { id: string; userId: string; userName: string; text: string; createdAt: string };
}

/** PATCH /leads/:id — update lead (stage, notes, etc.) */
export async function updateClientAgencyStatus(clientId: string, status: string, params?: { subCompanyId?: string }): Promise<void> {
  const res = await apiFetch(withSubCompanyQuery(`/clients/${encodeURIComponent(clientId)}/agency-status`, params?.subCompanyId), {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error('Failed to update client status');
}

export async function updateLeadApi(
  leadId: string,
  payload: { stage?: string; status?: string; notes?: string }
): Promise<ApiLead> {
  const res = await apiFetch<ApiLead>(`/leads/${encodeURIComponent(leadId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to update lead');
  return res.data;
}

/** POST /leads — create/assign a lead (manager assigns to sales associate). */
export async function createLead(payload: { clientId: string; ownerId: string; stage?: string; note?: string; subCompanyId?: string }): Promise<ApiLead> {
  const path = payload.subCompanyId ? `/leads?subCompanyId=${encodeURIComponent(payload.subCompanyId)}` : '/leads';
  const res = await apiFetch<ApiLead>(path, {
    method: 'POST',
    body: JSON.stringify({
      clientId: payload.clientId,
      ownerId: payload.ownerId,
      stage: payload.stage ?? 'new_lead',
      status: 'open',
      notes: payload.note ?? undefined,
    }),
  });
  if (!res.ok) throw new Error('Failed to assign lead');
  return res.data;
}

/** POST /leads/:id/reassign — clone a closed-lost lead into a new open lead for another owner. */
export async function reassignLostLead(payload: { leadId: string; ownerId: string; note?: string; subCompanyId?: string }): Promise<ApiLead> {
  const path = `/leads/${encodeURIComponent(payload.leadId)}/reassign${payload.subCompanyId ? `?subCompanyId=${encodeURIComponent(payload.subCompanyId)}` : ''}`;
  const res = await apiFetch<ApiLead>(path, {
    method: 'POST',
    body: JSON.stringify({
      ownerId: payload.ownerId,
      note: payload.note ?? undefined,
    }),
  });
  if (!res.ok) throw new Error('Failed to reassign lost lead');
  return res.data;
}

// ---------------------------------------------------------------------------
// Lead Reassignment Requests
// ---------------------------------------------------------------------------

export interface ApiLeadReassignmentRequest {
  id: string;
  leadId: string;
  requestedById: string;
  currentOwnerId: string;
  proposedOwnerId: string;
  note?: string | null;
  status: 'pending' | 'approved' | 'completed' | 'rejected' | 'cancelled' | 'superseded';
  reviewedById?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  subCompanyId: string;
  requestedAt: string;
  lead?: { id: string; stage: string; status: string; client?: { id: string; name: string } };
  requestedBy?: { id: string; firstName: string; lastName: string; email: string; role?: string };
  currentOwner?: { id: string; firstName: string; lastName: string; email?: string };
  proposedOwner?: { id: string; firstName: string; lastName: string; email?: string };
  reviewedBy?: { id: string; firstName: string; lastName: string } | null;
  subCompany?: { id: string; name: string };
}

export async function createLeadReassignmentRequest(payload: {
  leadId: string;
  proposedOwnerId: string;
  numberOfPositions?: number | null;
}): Promise<ApiLeadReassignmentRequest> {
  const res = await fetch(`${API_PREFIX}/lead-reassignment-requests`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to create reassignment request');
  return data as ApiLeadReassignmentRequest;
}

/** Case 2: super user reassigns immediately (no approval) */
export async function createSuperUserLeadReassignment(payload: {
  leadId: string;
  proposedOwnerId: string;
  numberOfPositions?: number | null;
}): Promise<{ newLeadId: string }> {
  const res = await fetch(`${API_PREFIX}/lead-reassignment-requests/super-user`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to reassign lead');
  return data as { newLeadId: string };
}

/** Super-user history view — all reassignment requests across accessible agencies */
export async function getAllLeadReassignmentRequests(): Promise<ApiLeadReassignmentRequest[]> {
  const res = await fetch(`${API_PREFIX}/lead-reassignment-requests/all`, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to fetch reassignment history');
  return data as ApiLeadReassignmentRequest[];
}

export async function getMyLeadReassignmentRequests(): Promise<ApiLeadReassignmentRequest[]> {
  const res = await fetch(`${API_PREFIX}/lead-reassignment-requests`, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to fetch reassignment requests');
  return data as ApiLeadReassignmentRequest[];
}

export async function getPendingLeadReassignmentRequests(): Promise<ApiLeadReassignmentRequest[]> {
  const res = await fetch(`${API_PREFIX}/lead-reassignment-requests/pending`, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to fetch pending reassignment requests');
  return data as ApiLeadReassignmentRequest[];
}

export async function getLeadReassignmentHistory(leadId: string): Promise<ApiLeadReassignmentRequest[]> {
  const res = await fetch(`${API_PREFIX}/lead-reassignment-requests/lead/${encodeURIComponent(leadId)}`, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to fetch reassignment history');
  return data as ApiLeadReassignmentRequest[];
}

export async function approveLeadReassignmentRequest(requestId: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/lead-reassignment-requests/${encodeURIComponent(requestId)}/approve`, {
    method: 'PATCH',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to approve reassignment request');
}

export async function rejectLeadReassignmentRequest(requestId: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/lead-reassignment-requests/${encodeURIComponent(requestId)}/reject`, {
    method: 'PATCH',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to reject reassignment request');
}

export async function cancelLeadReassignmentRequest(requestId: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/lead-reassignment-requests/${encodeURIComponent(requestId)}`, {
    method: 'DELETE',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to cancel reassignment request');
}

export async function submitLeadDeadlineDecision(payload: {
  leadId: string;
  requestExtension: boolean;
  reason: string;
  requestedDays?: number;
}): Promise<{ autoApproved?: boolean }> {
  const res = await fetch(`${API_PREFIX}/leads/${encodeURIComponent(payload.leadId)}/deadline-decision`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({
      requestExtension: payload.requestExtension,
      reason: payload.reason,
      requestedDays: payload.requestedDays,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to submit deadline decision');
  return data as { autoApproved?: boolean };
}

export async function fetchLeadExtensionRequests(
  status?: 'pending' | 'approved' | 'rejected' | 'returned'
): Promise<ApiLeadExtensionRequest[]> {
  const search = status ? `?status=${status}` : '';
  const res = await apiFetch<{ requests: ApiLeadExtensionRequest[] }>(`/leads/extension-requests/list${search}`);
  if (!res.ok) return [];
  return res.data?.requests ?? [];
}

export async function reviewLeadExtensionRequest(id: string, decision: 'approve' | 'reject', remarks?: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/leads/extension-requests/${encodeURIComponent(id)}/${decision}`, {
    method: 'PATCH',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ remarks }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Failed to ${decision} extension request`);
}

/** Document/attachment from API */
export interface ApiDocument {
  id: string;
  name: string;
  type: string;
  fileUrl: string | null;
  createdAt: string;
  clientId: string | null;
  leadId: string | null;
}

/** GET /documents — list by clientId or leadId */
export async function fetchDocuments(
  params: { clientId?: string; leadId?: string },
  opts?: ClientDetailFetchOptions,
): Promise<ApiDocument[]> {
  const searchParams = new URLSearchParams();
  if (params.clientId) searchParams.set('clientId', params.clientId);
  if (params.leadId) searchParams.set('leadId', params.leadId);
  if (opts?.allAgencies) searchParams.set('allAgencies', 'true');
  const res = await apiFetch<{ data: ApiDocument[] }>(`/documents?${searchParams.toString()}`);
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

/** POST /documents — upload attachment (base64). */
export async function uploadDocument(payload: {
  clientId?: string;
  leadId?: string;
  name: string;
  type?: string;
  fileBase64: string;
  mimeType?: string;
}): Promise<ApiDocument> {
  const res = await fetch(`${API_PREFIX}/documents`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({
      clientId: payload.clientId,
      leadId: payload.leadId,
      name: payload.name,
      type: payload.type ?? 'attachment',
      fileBase64: payload.fileBase64,
      mimeType: payload.mimeType,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Upload failed');
  return data as ApiDocument;
}

/** URL for document download (backend streams from R2). Use downloadDocument() to fetch with auth and trigger save. */
export function getDocumentDownloadUrl(documentId: string): string {
  return `${API_PREFIX}/documents/${encodeURIComponent(documentId)}/download`;
}

export async function fetchDocumentBlob(documentId: string): Promise<Blob> {
  return fetchAuthenticatedBlob(getDocumentDownloadUrl(documentId));
}

/** Fetch document with auth and trigger browser download. Use when fileUrl is relative (no R2 public URL). */
export async function downloadDocument(documentId: string, filename: string): Promise<void> {
  const url = getDocumentDownloadUrl(documentId);
  const res = await fetch(url, {
    method: 'GET',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Download failed');
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition');
  const match = disposition?.match(/filename="?([^";]+)"?/);
  const saveAs = match ? decodeURIComponent(match[1].trim()) : filename.replace(/[^\w.-]/g, '_');
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = saveAs;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

/** DELETE /documents/:id */
export async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/documents/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Delete failed');
  }
}

/** Task comment from API (GET /tasks, GET /tasks/:id, POST /tasks/:id/comments) */
export interface ApiTaskComment {
  id: string;
  taskId: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: string;
}

export interface ApiTaskAttachment {
  id: string;
  taskId: string;
  filename: string;
  mimeType: string;
  size?: number | null;
  uploadedBy: string;
  createdAt: string;
}

/** Task from API (GET /tasks, POST /tasks, PATCH /tasks/:id) */
export interface ApiTask {
  id: string;
  title: string;
  description: string | null;
  dueDate: string;
  priority: string;
  status: string;
  ownerId: string;
  ownerName: string;
  assignedById: string;
  assignedByName: string;
  subCompanyId: string;
  linkType: string | null;
  linkId: string | null;
  reminderEnabled: boolean;
  reminderDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  linkedClient?: { id: string; name: string; industry: string; location: string; status: string } | null;
  linkedLead?: { id: string; stage: string; status: string; temperature: string; ownerName: string; clientId: string; clientName: string; clientIndustry: string; clientLocation: string } | null;
  comments?: ApiTaskComment[];
  attachments?: ApiTaskAttachment[];
  forwardedFromName?: string | null;
  forwardedFromSubCompanyId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
}

export async function fetchTasks(params?: {
  page?: number;
  limit?: number;
  status?: string;
  ownerId?: string;
  subCompanyId?: string;
  agencyIds?: string[];
  ownerIds?: string[]; ownerExact?: boolean;
  scope?: 'mine' | 'team' | 'all';
  projectId?: string;
  includeProjectTasks?: boolean;
}): Promise<{ data: ApiTask[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  const searchParams = new URLSearchParams();
  if (params?.page != null) searchParams.set('page', String(params.page));
  if (params?.limit != null) searchParams.set('limit', String(params.limit));
  if (params?.status) searchParams.set('status', params.status);
  if (params?.ownerId) searchParams.set('ownerId', params.ownerId);
  if (params?.subCompanyId) searchParams.set('subCompanyId', params.subCompanyId);
  if (params?.agencyIds?.length) searchParams.set('agencyIds', params.agencyIds.join(','));
  appendOwnerIds(searchParams, params?.ownerIds, params?.ownerExact);
  if (params?.scope) searchParams.set('scope', params.scope);
  if (params?.projectId) searchParams.set('projectId', params.projectId);
  if (params?.includeProjectTasks) searchParams.set('includeProjectTasks', 'true');
  const res = await apiFetch<{ data: ApiTask[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>(
    `/tasks?${searchParams.toString()}`
  );
  if (!res.ok) return { data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } };
  return res.data ?? { data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } };
}

export async function createTask(payload: {
  title: string;
  description?: string;
  dueDate: string; // ISO datetime
  priority?: string;
  ownerId: string;
  linkType?: string | null;
  linkId?: string | null;
  subCompanyId?: string;
  projectId?: string | null;
}): Promise<ApiTask> {
  const path = payload.subCompanyId ? `/tasks?subCompanyId=${encodeURIComponent(payload.subCompanyId)}` : '/tasks';
  const res = await apiFetch<ApiTask>(path, {
    method: 'POST',
    body: JSON.stringify({
      title: payload.title,
      description: payload.description ?? undefined,
      dueDate: payload.dueDate,
      priority: payload.priority ?? 'medium',
      ownerId: payload.ownerId,
      linkType: payload.linkType ?? null,
      linkId: payload.linkId ?? null,
      projectId: payload.projectId ?? null,
    }),
  });
  if (!res.ok) throw new Error(res.error || 'Failed to create task');
  return res.data;
}

export async function updateTaskApi(
  taskId: string,
  payload: { title?: string; description?: string | null; dueDate?: string; priority?: string; status?: string; ownerId?: string; linkType?: string | null; linkId?: string | null }
): Promise<ApiTask> {
  const res = await apiFetch<ApiTask>(`/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to update task');
  return res.data;
}

export async function deleteTaskApi(taskId: string): Promise<void> {
  const res = await apiFetch(`/tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error('Delete failed');
  }
}

/** GET /tasks/:id — fetch single task with comments (e.g. for opening from notification). */
export async function fetchTaskById(taskId: string): Promise<ApiTask | null> {
  const res = await apiFetch<ApiTask>(`/tasks/${taskId}`);
  if (!res.ok) return null;
  return res.data ?? null;
}

/** POST /tasks/:id/comments — add comment; notifies task creator if different from commenter. */
export async function addTaskCommentApi(
  taskId: string,
  content: string
): Promise<ApiTaskComment> {
  const res = await apiFetch<ApiTaskComment>(`/tasks/${encodeURIComponent(taskId)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content: content.trim() }),
  });
  if (!res.ok) throw new Error('Failed to add comment');
  return res.data;
}

/** POST /tasks/:id/attachments — upload a file as base64. */
export async function uploadTaskAttachment(
  taskId: string,
  file: File
): Promise<ApiTaskAttachment> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] ?? result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const res = await fetch(`${API_PREFIX}/tasks/${taskId}/attachments`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ filename: file.name, mimeType: file.type || 'application/octet-stream', data }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? 'Upload failed');
  return json as ApiTaskAttachment;
}

/** DELETE /tasks/:id/attachments/:attachmentId */
export async function deleteTaskAttachment(taskId: string, attachmentId: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/tasks/${taskId}/attachments/${attachmentId}`, {
    method: 'DELETE',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error((json as { error?: string }).error ?? 'Delete failed');
  }
}

/** GET /tasks/:id/attachments/:attachmentId/download — returns a blob URL for the file. */
export function getTaskAttachmentDownloadUrl(taskId: string, attachmentId: string): string {
  return `${API_PREFIX}/tasks/${taskId}/attachments/${attachmentId}/download`;
}

export async function fetchTaskAttachmentBlob(taskId: string, attachmentId: string): Promise<Blob> {
  return fetchAuthenticatedBlob(getTaskAttachmentDownloadUrl(taskId, attachmentId));
}

/** Map API task to frontend Task type (with comments array from API or override). */
export function mapApiTaskToTask(
  api: ApiTask,
  commentsOverride?: { id: string; taskId: string; userId: string; userName: string; content: string; createdAt: Date }[]
): {
  id: string; title: string; description?: string; dueDate: Date; priority: string; status: string; ownerId: string; ownerName: string; assignedById: string; assignedByName: string; subCompanyId: string; subCompanyName: string; reminderEnabled: boolean; reminderDate?: Date; linkType?: string; linkId?: string; linkedClient?: { id: string; name: string; industry: string; location: string; status: string } | null; linkedLead?: { id: string; stage: string; status: string; temperature: string; ownerName: string; clientId: string; clientName: string; clientIndustry: string; clientLocation: string } | null; createdAt: Date; updatedAt: Date; completedAt?: Date; comments: Array<{ id: string; taskId: string; userId: string; userName: string; content: string; createdAt: Date }>; attachments: Array<{ id: string; taskId: string; filename: string; mimeType: string; size?: number | null; uploadedBy: string; createdAt: Date }>; forwardedFromName?: string | null; forwardedFromSubCompanyId?: string | null;
} {
  const comments = commentsOverride ?? (
    Array.isArray(api.comments)
      ? api.comments.map((c) => ({
          id: c.id,
          taskId: c.taskId,
          userId: c.userId,
          userName: c.userName,
          content: c.content,
          createdAt: new Date(c.createdAt),
        }))
      : []
  );
  const attachments = Array.isArray(api.attachments)
    ? api.attachments.map((a) => ({
        id: a.id,
        taskId: a.taskId,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        uploadedBy: a.uploadedBy,
        createdAt: new Date(a.createdAt),
      }))
    : [];
  return {
    id: api.id,
    title: api.title,
    description: api.description ?? undefined,
    dueDate: new Date(api.dueDate),
    priority: api.priority,
    status: api.status,
    ownerId: api.ownerId,
    ownerName: api.ownerName,
    assignedById: api.assignedById,
    assignedByName: api.assignedByName,
    subCompanyId: api.subCompanyId,
    subCompanyName: '',
    reminderEnabled: api.reminderEnabled,
    reminderDate: api.reminderDate ? new Date(api.reminderDate) : undefined,
    linkType: api.linkType ?? undefined,
    linkId: api.linkId ?? undefined,
    linkedClient: api.linkedClient ?? null,
    linkedLead: api.linkedLead ?? null,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
    completedAt: api.completedAt ? new Date(api.completedAt) : undefined,
    comments,
    attachments,
    forwardedFromName: api.forwardedFromName ?? null,
    forwardedFromSubCompanyId: api.forwardedFromSubCompanyId ?? null,
    projectId: api.projectId ?? null,
    projectName: api.projectName ?? null,
  };
}

/** Follow-up from API (GET /follow-ups, POST /follow-ups, PATCH /follow-ups/:id) */
export interface ApiFollowUp {
  id: string;
  clientId: string;
  leadId: string | null;
  contactId: string | null;
  subCompanyId: string;
  ownerId: string;
  ownerName: string;
  dueDate: string;
  notes: string;
  completed: boolean;
  outcome: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  clientName?: string;
  subCompanyName?: string | null;
  comments: Array<{
    id: string;
    followUpId: string;
    userId: string;
    userName: string;
    content: string;
    createdAt: string;
  }>;
  forwardedFromName?: string | null;
  forwardedFromSubCompanyId?: string | null;
}

export async function fetchFollowUps(params?: {
  page?: number;
  limit?: number;
  completed?: boolean;
  ownerId?: string;
  clientId?: string;
  subCompanyId?: string;
  agencyIds?: string[];
  ownerIds?: string[]; ownerExact?: boolean;
  allAgencies?: boolean;
}): Promise<{ data: ApiFollowUp[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  const searchParams = new URLSearchParams();
  if (params?.page != null) searchParams.set('page', String(params.page));
  if (params?.limit != null) searchParams.set('limit', String(params.limit));
  if (params?.completed === true) searchParams.set('completed', 'true');
  if (params?.completed === false) searchParams.set('completed', 'false');
  if (params?.ownerId) searchParams.set('ownerId', params.ownerId);
  if (params?.clientId) searchParams.set('clientId', params.clientId);
  if (params?.subCompanyId) searchParams.set('subCompanyId', params.subCompanyId);
  if (params?.agencyIds?.length) searchParams.set('agencyIds', params.agencyIds.join(','));
  appendOwnerIds(searchParams, params?.ownerIds, params?.ownerExact);
  if (params?.allAgencies) searchParams.set('allAgencies', 'true');
  const res = await apiFetch<{ data: ApiFollowUp[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>(
    `/follow-ups?${searchParams.toString()}`
  );
  if (!res.ok) return { data: [], pagination: { page: 1, limit: 100, total: 0, totalPages: 0 } };
  return res.data ?? { data: [], pagination: { page: 1, limit: 100, total: 0, totalPages: 0 } };
}

export async function createFollowUp(payload: {
  clientId?: string;
  employeeId?: string;
  leadId?: string | null;
  contactId?: string | null;
  dueDate: string;
  notes: string;
  subCompanyId?: string;
}): Promise<ApiFollowUp> {
  const path = payload.subCompanyId ? `/follow-ups?subCompanyId=${encodeURIComponent(payload.subCompanyId)}` : '/follow-ups';
  const res = await apiFetch<ApiFollowUp>(path, {
    method: 'POST',
    body: JSON.stringify({
      ...(payload.clientId ? { clientId: payload.clientId } : {}),
      ...(payload.employeeId ? { employeeId: payload.employeeId } : {}),
      leadId: payload.leadId ?? null,
      contactId: payload.contactId ?? null,
      dueDate: payload.dueDate,
      notes: payload.notes,
    }),
  });
  if (!res.ok) throw new Error(res.error || 'Failed to create follow-up');
  return res.data;
}

export async function updateFollowUpApi(
  followUpId: string,
  payload: { dueDate?: string; notes?: string; completed?: boolean; outcome?: string | null },
  actAsUserId?: string
): Promise<ApiFollowUp> {
  const res = await apiFetch<ApiFollowUp>(`/follow-ups/${encodeURIComponent(followUpId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    headers: actAsUserId ? { 'X-Act-As-User-Id': actAsUserId } : undefined,
  });
  if (!res.ok) throw new Error('Failed to update follow-up');
  return res.data;
}

export async function addFollowUpCommentApi(followUpId: string, content: string, actAsUserId?: string): Promise<ApiFollowUp> {
  const res = await apiFetch<ApiFollowUp>(`/follow-ups/${encodeURIComponent(followUpId)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content }),
    headers: actAsUserId ? { 'X-Act-As-User-Id': actAsUserId } : undefined,
  });
  if (!res.ok) throw new Error('Failed to add comment');
  return res.data;
}

export function mapApiFollowUpToFollowUp(api: ApiFollowUp): {
  id: string;
  clientId: string;
  clientName?: string;
  leadId?: string;
  contactId?: string;
  subCompanyId: string;
  subCompanyName?: string;
  ownerId: string;
  ownerName: string;
  dueDate: Date;
  notes: string;
  completed: boolean;
  outcome?: string;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  comments: Array<{ id: string; followUpId: string; userId: string; userName: string; content: string; createdAt: Date }>;
  forwardedFromName?: string | null;
  forwardedFromSubCompanyId?: string | null;
} {
  return {
    id: api.id,
    clientId: api.clientId,
    clientName: api.clientName,
    leadId: api.leadId ?? undefined,
    contactId: api.contactId ?? undefined,
    subCompanyId: api.subCompanyId,
    subCompanyName: api.subCompanyName ?? undefined,
    ownerId: api.ownerId,
    ownerName: api.ownerName,
    dueDate: new Date(api.dueDate),
    notes: api.notes,
    completed: api.completed,
    outcome: api.outcome ?? undefined,
    completedAt: api.completedAt ? new Date(api.completedAt) : undefined,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
    comments: (api.comments || []).map((c) => ({
      id: c.id,
      followUpId: c.followUpId,
      userId: c.userId,
      userName: c.userName,
      content: c.content,
      createdAt: new Date(c.createdAt),
    })),
    forwardedFromName: api.forwardedFromName ?? null,
    forwardedFromSubCompanyId: api.forwardedFromSubCompanyId ?? null,
  };
}

// ——— Calls (voice) ———

export interface ApiCall {
  id: string;
  clientId: string;
  clientName: string;
  leadId?: string;
  subCompanyId: string;
  ownerId: string;
  ownerName: string;
  outcome: string;
  duration?: number;
  notes?: string;
  recordingUrl?: string;
  transcription?: string;
  twilioCallSid?: string;
  timestamp: string;
  createdAt: string;
}

export async function fetchCalls(params?: {
  page?: number;
  limit?: number;
  scope?: 'mine' | 'all';
  clientId?: string;
  agencyIds?: string[];
  ownerIds?: string[]; ownerExact?: boolean;
  from?: string;
  to?: string;
  allAgencies?: boolean;
}): Promise<{
  data: ApiCall[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const searchParams = new URLSearchParams();
  if (params?.page != null) searchParams.set('page', String(params.page));
  if (params?.limit != null) searchParams.set('limit', String(params.limit));
  if (params?.scope) searchParams.set('scope', params.scope);
  if (params?.clientId) searchParams.set('clientId', params.clientId);
  if (params?.agencyIds?.length) searchParams.set('agencyIds', params.agencyIds.join(','));
  appendOwnerIds(searchParams, params?.ownerIds, params?.ownerExact);
  if (params?.from) searchParams.set('from', params.from);
  if (params?.to)   searchParams.set('to',   params.to);
  if (params?.allAgencies) searchParams.set('allAgencies', 'true');
  const res = await apiFetch<{
    data: ApiCall[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>(`/voice/calls?${searchParams.toString()}`);
  if (!res.ok) return { data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } };
  return res.data ?? { data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } };
}

export async function fetchCallById(id: string): Promise<ApiCall | null> {
  const res = await apiFetch<ApiCall>(`/voice/calls/${id}`);
  if (!res.ok) return null;
  return res.data ?? null;
}

export async function getVoiceConfig(subCompanyId?: string): Promise<{
  voiceEnabled: boolean;
  outboundEnabled: boolean;
  inboundEnabled: boolean;
  outboundCallerId: string | null;
  inboundDid: string | null;
}> {
  const qs = subCompanyId ? `?subCompanyId=${encodeURIComponent(subCompanyId)}` : '';
  const res = await apiFetch<{
    voiceEnabled: boolean;
    outboundEnabled: boolean;
    inboundEnabled: boolean;
    outboundCallerId: string | null;
    inboundDid: string | null;
  }>(`/voice/config${qs}`);
  if (!res.ok) {
    return {
      voiceEnabled: false,
      outboundEnabled: false,
      inboundEnabled: false,
      outboundCallerId: null,
      inboundDid: null,
    };
  }
  return {
    voiceEnabled: res.data?.voiceEnabled ?? false,
    outboundEnabled: res.data?.outboundEnabled ?? false,
    inboundEnabled: res.data?.inboundEnabled ?? false,
    outboundCallerId: res.data?.outboundCallerId ?? null,
    inboundDid: res.data?.inboundDid ?? null,
  };
}

/** Fetch a Twilio Voice access token for browser-based calling (per agency). */
export async function getVoiceToken(subCompanyId?: string): Promise<string> {
  const qs = subCompanyId ? `?subCompanyId=${encodeURIComponent(subCompanyId)}` : '';
  const res = await fetch(`${API_PREFIX}/voice/token${qs}`, {
    method: 'GET',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = (await res.json().catch(() => ({}))) as {
    token?: string;
    message?: string;
    error?: string;
  };
  if (!res.ok || !data.token) {
    const msg = data.message?.trim() || data.error || 'Failed to get voice token';
    throw new Error(msg);
  }
  return data.token;
}

/** Place outbound call via Twilio. Returns callId for later summary update. */
export async function placeOutboundCall(payload: {
  to: string;
  clientId: string;
  leadId?: string;
  subCompanyId?: string;
}): Promise<{ callId: string; message?: string }> {
  const res = await apiFetch<{ callId: string; message?: string }>('/voice/call', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to place call');
  return res.data;
}

/** Update existing call with summary (notes, outcome, duration). */
export async function updateCallSummary(
  callId: string,
  payload: { notes?: string; outcome?: string; duration?: number; twilioCallSid?: string }
): Promise<void> {
  const res = await apiFetch(`/voice/calls/${encodeURIComponent(callId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to save call summary');
}

/** Create a call log without placing a call (e.g. simulated call). */
export async function logCall(payload: {
  clientId: string;
  leadId?: string | null;
  outcome: string;
  duration?: number;
  notes?: string;
}): Promise<ApiCall> {
  const res = await apiFetch<ApiCall>('/voice/calls/log', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to save call');
  return res.data;
}

/** Update inbound call outcome when agent answers/declines from softphone. */
export async function patchInboundCall(
  inboundCallId: string,
  payload: { outcome?: string; durationSec?: number },
): Promise<void> {
  const res = await apiFetch(`/phone-system/inbound-calls/${encodeURIComponent(inboundCallId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to update inbound call');
}

export interface InboundIncomingContext {
  inboundCallId: string;
  conferenceRoom: string;
  fromNumber: string;
  toNumber: string;
  callerName?: string;
  departmentLabel?: string;
}

/** Metadata for a REST-rung conference inbound leg (browser Answer/Decline popup). */
export async function getIncomingContext(
  agentCallSid: string,
): Promise<InboundIncomingContext | null> {
  const res = await apiFetch<{ data: InboundIncomingContext }>(
    `/voice/inbound/incoming-context?agentCallSid=${encodeURIComponent(agentCallSid)}`,
    { method: 'GET' },
  );
  if (!res.ok) return null;
  return res.data.data ?? null;
}

/** Hold or resume the PSTN caller in their conference (plays hold music when held). */
export async function setInboundHold(inboundCallId: string, hold: boolean): Promise<void> {
  const res = await apiFetch(`/voice/inbound/${encodeURIComponent(inboundCallId)}/hold`, {
    method: 'POST',
    body: JSON.stringify({ hold }),
  });
  if (!res.ok) {
    const reason = (res.data as { reason?: string } | undefined)?.reason;
    throw new Error(reason ? `Failed to update hold state: ${reason}` : 'Failed to update hold state');
  }
}

/** Hold or resume the PSTN callee on an outbound conference call. */
export async function setOutboundHold(callRecordId: string, hold: boolean): Promise<void> {
  const res = await apiFetch(`/voice/call/${encodeURIComponent(callRecordId)}/hold`, {
    method: 'POST',
    body: JSON.stringify({ hold }),
  });
  if (!res.ok) {
    const reason = (res.data as { reason?: string } | undefined)?.reason;
    throw new Error(reason ? `Failed to update hold state: ${reason}` : 'Failed to update hold state');
  }
}

/** End an inbound conference — disconnect caller and agent legs. */
export async function endInboundCallApi(inboundCallId: string): Promise<void> {
  const res = await apiFetch(`/voice/inbound/${encodeURIComponent(inboundCallId)}/end`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw new Error('Failed to end inbound call');
  }
}

/** End an outbound conference — disconnect callee and agent legs. */
export async function endOutboundCall(callRecordId: string): Promise<void> {
  const res = await apiFetch(`/voice/call/${encodeURIComponent(callRecordId)}/end`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw new Error('Failed to end outbound call');
  }
}

export type AgentPresenceStatus = 'available' | 'busy' | 'away' | 'offline';

export interface AgentPresence {
  manualStatus: AgentPresenceStatus | null;
  effective: AgentPresenceStatus;
  activeCallCount: number;
  ringingLegs?: number;
  joinedLegs?: number;
  canAcceptRing?: boolean;
  canPickupFromQueue?: boolean;
}

/** Current agent phone availability. */
export async function getMyPresence(): Promise<AgentPresence> {
  const res = await apiFetch<AgentPresence>('/voice/presence/me', { method: 'GET' });
  if (!res.ok) throw new Error('Failed to load presence');
  return res.data;
}

/** Set (or clear with null) the agent's manual availability. */
export async function setMyPresence(
  status: AgentPresenceStatus | null,
): Promise<{ manualStatus: AgentPresenceStatus | null; effective: AgentPresenceStatus }> {
  const res = await apiFetch<{ manualStatus: AgentPresenceStatus | null; effective: AgentPresenceStatus }>(
    '/voice/presence/me',
    { method: 'PUT', body: JSON.stringify({ status }) },
  );
  if (!res.ok) throw new Error('Failed to update presence');
  return res.data;
}

/** Signal the agent has started a call (marks them busy for routing). */
export async function presenceCallStarted(): Promise<void> {
  await apiFetch('/voice/presence/call-started', { method: 'POST', body: '{}' }).catch(() => undefined);
}

/** Signal the agent's call ended (frees them and auto-connects the next queued caller). */
export async function presenceCallEnded(): Promise<void> {
  await apiFetch('/voice/presence/call-ended', { method: 'POST', body: '{}' }).catch(() => undefined);
}

export interface QueueEntry {
  id: string;
  ringGroupId: string | null;
  ringGroupName: string | null;
  callerNumber: string;
  callerName: string | null;
  enqueuedAt: string;
  status: string;
}

const AGENCY_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Callers currently waiting in the queue for the agent's ring groups. */
export async function getLiveQueue(subCompanyId?: string): Promise<QueueEntry[]> {
  const safeId = subCompanyId && AGENCY_UUID_RE.test(subCompanyId) ? subCompanyId : undefined;
  const qs = safeId ? `?subCompanyId=${encodeURIComponent(safeId)}` : '';
  const res = await apiFetch<{ data: QueueEntry[] }>(`/phone-system/queue/live${qs}`, { method: 'GET' });
  if (!res.ok) throw new Error('Failed to load queue');
  return res.data.data;
}

/** Agent manually picks up a waiting caller. */
export async function pickupQueueEntry(entryId: string): Promise<void> {
  const res = await apiFetch(`/phone-system/queue/${encodeURIComponent(entryId)}/pickup`, {
    method: 'POST',
    body: '{}',
  });
  if (!res.ok) {
    const msg = (res.data as { error?: string })?.error ?? 'Failed to pick up caller';
    throw new Error(msg);
  }
}

/** Agent removes a waiting/stale caller from the queue. */
export async function cancelQueueEntry(entryId: string): Promise<void> {
  const res = await apiFetch(`/phone-system/queue/${encodeURIComponent(entryId)}/cancel`, {
    method: 'POST',
    body: '{}',
  });
  if (!res.ok) {
    const msg = (res.data as { error?: string })?.error ?? 'Failed to remove caller';
    throw new Error(msg);
  }
}

/** Fetch a short-lived stream URL for a call recording. Pass AbortSignal to cancel. */
export async function fetchCallStreamToken(
  callId: string,
  signal?: AbortSignal
): Promise<string | null> {
  const result = await apiFetch<{ streamUrl: string }>(
    `/voice/calls/${callId}/recording-token`,
    { signal }
  );
  if (!result.ok) return null;
  return result.data.streamUrl;
}

/** Add a note to a client (agency-scoped). */
export async function addClientNote(
  clientId: string,
  payload: {
    content: string;
    isPublic?: boolean;
    isPinned?: boolean;
    visibility?: 'only_me' | 'public' | 'shared' | 'public_global';
    sharedWith?: string[];
  },
  params?: { subCompanyId?: string },
): Promise<void> {
  const res = await apiFetch(withSubCompanyQuery(`/clients/${encodeURIComponent(clientId)}/notes`, params?.subCompanyId), {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to add note');
}

/** PATCH /clients/:id/notes/:noteId — author-only edit (content + visibility + sharedWith). */
export async function editClientNote(
  clientId: string,
  noteId: string,
  patch: {
    content?: string;
    visibility?: 'only_me' | 'public' | 'shared' | 'public_global';
    sharedWith?: string[];
  },
  params?: { subCompanyId?: string },
): Promise<void> {
  const res = await apiFetch(
    withSubCompanyQuery(`/clients/${encodeURIComponent(clientId)}/notes/${encodeURIComponent(noteId)}`, params?.subCompanyId),
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
  if (!res.ok) throw new Error('Failed to update note');
}

/** DELETE /clients/:id/notes/:noteId — author-only delete. */
export async function deleteClientNote(
  clientId: string,
  noteId: string,
  params?: { subCompanyId?: string },
): Promise<void> {
  const res = await apiFetch(
    withSubCompanyQuery(`/clients/${encodeURIComponent(clientId)}/notes/${encodeURIComponent(noteId)}`, params?.subCompanyId),
    { method: 'DELETE' },
  );
  if (!res.ok) throw new Error('Failed to delete note');
}

/** PATCH /clients/:id/notes/:noteId/pin — toggles pin state, persists to DB. */
export async function setClientNotePin(
  clientId: string,
  noteId: string,
  isPinned: boolean,
  params?: { subCompanyId?: string },
): Promise<void> {
  const res = await apiFetch(
    withSubCompanyQuery(`/clients/${encodeURIComponent(clientId)}/notes/${encodeURIComponent(noteId)}/pin`, params?.subCompanyId),
    {
      method: 'PATCH',
      body: JSON.stringify({ isPinned }),
    },
  );
  if (!res.ok) throw new Error('Failed to update pin');
}

// ——— Settings: Client Visibility Delay ———

export async function fetchClientVisibilitySetting(params?: {
  subCompanyId?: string;
}): Promise<{ days: number }> {
  const q = params?.subCompanyId
    ? `?subCompanyId=${encodeURIComponent(params.subCompanyId)}`
    : '';
  const res = await apiFetch<{ days: number }>(
    `/settings/client-visibility${q}`,
  );
  if (!res.ok) return { days: 7 };
  return res.data ?? { days: 7 };
}

export async function updateClientVisibilitySetting(
  days: number,
  params?: { subCompanyId?: string },
): Promise<{ days: number }> {
  const q = params?.subCompanyId
    ? `?subCompanyId=${encodeURIComponent(params.subCompanyId)}`
    : '';
  const res = await fetch(`${API_PREFIX}/settings/client-visibility${q}`, {
    method: 'PUT',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ days }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to update setting');
  return data as { days: number };
}

// ——— Settings: Approval policy ———

export type ApprovalWorkflowType =
  | 'client_manual_add'
  | 'client_manual_edit'
  | 'client_import'
  | 'contact_import'
  | 'database_client_add'
  | 'database_client_import'
  | 'database_contact_import'
  | 'lead_request'
  | 'lead_extension'
  | 'lead_reassignment'
  | 'proposal_review'
  | 'proposal_extension'
  | 'employee_add'
  | 'employee_assignment';

export type OrgApprovalWorkflowType =
  | 'database_client_add'
  | 'database_client_import'
  | 'database_contact_import';

export const ORG_APPROVAL_WORKFLOW_TYPES: OrgApprovalWorkflowType[] = [
  'database_client_add',
  'database_client_import',
  'database_contact_import',
];

export const AGENCY_APPROVAL_WORKFLOW_TYPES: ApprovalWorkflowType[] = [
  'client_manual_add',
  'client_manual_edit',
  'client_import',
  'contact_import',
  'lead_request',
  'lead_extension',
  'lead_reassignment',
  'proposal_review',
  'proposal_extension',
  'employee_add',
  'employee_assignment',
];

export const ALL_APPROVAL_WORKFLOW_TYPES: ApprovalWorkflowType[] = [
  ...AGENCY_APPROVAL_WORKFLOW_TYPES,
  ...ORG_APPROVAL_WORKFLOW_TYPES,
];

export type ApprovalPolicyMode = 'bypass' | 'route';

export type ApprovalActorMode = 'none' | 'forward_only' | 'final_only' | 'forward_final';

export type WorkflowPolicyConfig =
  | { mode: 'bypass' }
  | { mode: 'route'; route: string[] };

export type ApprovalPolicyData = {
  subCompanyId: string;
  workflows: Record<(typeof AGENCY_APPROVAL_WORKFLOW_TYPES)[number], WorkflowPolicyConfig>;
  allowLeadSelfAssign: boolean;
  updatedAt: string | null;
};

export type OrgApprovalPolicyData = {
  workflows: Record<OrgApprovalWorkflowType, WorkflowPolicyConfig>;
  databaseImportDestination: 'global' | 'agency' | 'both';
  superUserClientDestination: 'global' | 'agency' | 'both';
  databaseImportAgencyId: string | null;
  databaseImportAgencyName: string | null;
  updatedAt: string | null;
};

export type DatabaseManagerImportConfig = import('./clientDestinationFlow').ClientDestinationConfig;
export type {
  ClientDestinationConfig,
  ClientFlowConfig,
  AgencyClientFlowConfig,
} from './clientDestinationFlow';
export {
  normalizeClientDestinationConfig,
  normalizeClientFlowConfig,
  describeClientDestinationFlow,
  describeClientFlow,
  isElevatedClientFlowConfig,
  isAgencyClientFlowConfig,
} from './clientDestinationFlow';

const DEFAULT_APPROVAL_WORKFLOW_POLICIES: Record<(typeof AGENCY_APPROVAL_WORKFLOW_TYPES)[number], WorkflowPolicyConfig> = {
  client_manual_add: { mode: 'route', route: ['sales_manager', 'company_director'] },
  client_manual_edit: { mode: 'route', route: ['sales_manager', 'company_director'] },
  client_import: { mode: 'route', route: ['sales_manager', 'company_director'] },
  contact_import: { mode: 'route', route: ['sales_manager', 'company_director'] },
  lead_request: { mode: 'route', route: ['sales_manager'] },
  lead_extension: { mode: 'route', route: ['sales_manager'] },
  lead_reassignment: { mode: 'route', route: ['sales_manager'] },
  proposal_review: { mode: 'route', route: ['sales_manager', 'company_director'] },
  proposal_extension: { mode: 'route', route: ['sales_manager'] },
  employee_add: { mode: 'route', route: ['recruitment_manager'] },
  employee_assignment: { mode: 'route', route: ['recruitment_manager'] },
};

const DEFAULT_ORG_APPROVAL_WORKFLOW_POLICIES: Record<OrgApprovalWorkflowType, WorkflowPolicyConfig> = {
  database_client_add: { mode: 'route', route: ['director'] },
  database_client_import: { mode: 'route', route: ['director'] },
  database_contact_import: { mode: 'route', route: ['director'] },
};

export function normalizeOrgApprovalPolicyData(data: OrgApprovalPolicyData): OrgApprovalPolicyData {
  const workflows = { ...DEFAULT_ORG_APPROVAL_WORKFLOW_POLICIES, ...data.workflows };
  for (const workflow of ORG_APPROVAL_WORKFLOW_TYPES) {
    if (!workflows[workflow]) {
      workflows[workflow] = DEFAULT_ORG_APPROVAL_WORKFLOW_POLICIES[workflow];
    }
  }
  return {
    ...data,
    workflows,
    databaseImportDestination:
      data.databaseImportDestination === 'agency'
        ? 'agency'
        : data.databaseImportDestination === 'both'
          ? 'both'
          : 'global',
    superUserClientDestination:
      data.superUserClientDestination === 'global'
        ? 'global'
        : data.superUserClientDestination === 'both'
          ? 'both'
          : 'agency',
    databaseImportAgencyId: data.databaseImportAgencyId ?? null,
    databaseImportAgencyName: data.databaseImportAgencyName ?? null,
  };
}

export function normalizeApprovalPolicyData(data: ApprovalPolicyData): ApprovalPolicyData {
  const workflows = { ...DEFAULT_APPROVAL_WORKFLOW_POLICIES, ...data.workflows };
  for (const workflow of AGENCY_APPROVAL_WORKFLOW_TYPES) {
    if (!workflows[workflow]) {
      workflows[workflow] = DEFAULT_APPROVAL_WORKFLOW_POLICIES[workflow];
    }
  }
  return { ...data, workflows };
}

export type ApprovalWorkflowMetadata = {
  workflow: ApprovalWorkflowType;
  label: string;
  forwardPermission: string;
  finalPermission: string;
  finalPermissionFallback: string | null;
};

export type AssignableRoleMetadata = {
  key: string;
  name: string;
};

export type ApprovalMetadataPayload = {
  workflows: ApprovalWorkflowMetadata[];
  actorModes: Array<{ value: string; label: string }>;
  assignableRoles: AssignableRoleMetadata[];
};

export async function fetchApprovalMetadata(): Promise<ApprovalMetadataPayload> {
  const res = await apiFetch<{ data: ApprovalMetadataPayload }>('/approvals/metadata');
  if (!res.ok || !res.data?.data) throw new Error('Failed to load approval metadata');
  return res.data.data;
}

export async function fetchApprovalPolicy(params?: {
  subCompanyId?: string;
}): Promise<ApprovalPolicyData> {
  const q = params?.subCompanyId
    ? `?subCompanyId=${encodeURIComponent(params.subCompanyId)}`
    : '';
  const res = await apiFetch<{ data: ApprovalPolicyData }>(`/settings/approval-policy${q}`);
  if (!res.ok || !res.data?.data) throw new Error('Failed to load approval policy');
  return normalizeApprovalPolicyData(res.data.data);
}

export async function updateApprovalPolicy(body: {
  subCompanyId?: string;
  allowLeadSelfAssign: boolean;
  workflows: Record<ApprovalWorkflowType, WorkflowPolicyConfig>;
}): Promise<ApprovalPolicyData> {
  const res = await fetch(`${API_PREFIX}/settings/approval-policy`, {
    method: 'PUT',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to save approval policy');
  return normalizeApprovalPolicyData((data as { data: ApprovalPolicyData }).data);
}

export async function resetApprovalPolicyToDefaults(params?: {
  subCompanyId?: string;
}): Promise<ApprovalPolicyData> {
  const res = await fetch(`${API_PREFIX}/settings/approval-policy/reset`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(params ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to restore defaults');
  return normalizeApprovalPolicyData((data as { data: ApprovalPolicyData }).data);
}

export async function fetchOrgApprovalPolicy(): Promise<OrgApprovalPolicyData> {
  const res = await apiFetch<{ data: OrgApprovalPolicyData }>('/settings/org-approval-policy');
  if (!res.ok || !res.data?.data) throw new Error('Failed to load org approval policy');
  return normalizeOrgApprovalPolicyData(res.data.data);
}

export async function updateOrgApprovalPolicy(body: {
  workflows: Record<OrgApprovalWorkflowType, WorkflowPolicyConfig>;
  databaseImportDestination?: 'global' | 'agency' | 'both';
  superUserClientDestination?: 'global' | 'agency' | 'both';
  databaseImportAgencyId?: string | null;
}): Promise<OrgApprovalPolicyData> {
  const res = await fetch(`${API_PREFIX}/settings/org-approval-policy`, {
    method: 'PUT',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to save org approval policy');
  return normalizeOrgApprovalPolicyData((data as { data: OrgApprovalPolicyData }).data);
}

export async function resetOrgApprovalPolicyToDefaults(): Promise<OrgApprovalPolicyData> {
  const res = await fetch(`${API_PREFIX}/settings/org-approval-policy/reset`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to restore org defaults');
  return normalizeOrgApprovalPolicyData((data as { data: OrgApprovalPolicyData }).data);
}

export type DatabaseManagerReportRow = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
};

export async function fetchDatabaseManagerReport(params?: {
  startDate?: string;
  endDate?: string;
  userIds?: string[];
}): Promise<{ startDate: string; endDate: string; managers: DatabaseManagerReportRow[] }> {
  const search = new URLSearchParams();
  if (params?.startDate) search.set('startDate', params.startDate);
  if (params?.endDate) search.set('endDate', params.endDate);
  if (params?.userIds?.length) search.set('userIds', params.userIds.join(','));
  const q = search.toString() ? `?${search.toString()}` : '';
  const res = await apiFetch<{ data: { startDate: string; endDate: string; managers: DatabaseManagerReportRow[] } }>(
    `/reports/database-managers${q}`,
  );
  if (!res.ok || !res.data?.data) throw new Error('Failed to load database manager report');
  return res.data.data;
}

export type ApprovalStatusResponse = {
  chain: string[];
  currentStepIndex: number;
  targetRoleKey: string | null;
  nextRoleKey: string | null;
  isFinalStep: boolean;
  totalSteps: number;
  allowedAction: 'forward' | 'approve' | 'reject' | null;
  isDirectApproval: boolean;
  canReject: boolean;
  skippedRoleKeys: string[];
  history: Array<{
    id: string;
    stepIndex: number;
    targetRoleKey: string;
    actorUserId: string;
    actorRoleKey: string;
    actorName: string;
    action: string;
    remarks: string | null;
    createdAt: string;
  }>;
};

export async function fetchApprovalStatus(
  workflow: ApprovalWorkflowType,
  entityId: string,
  subCompanyId?: string,
): Promise<ApprovalStatusResponse> {
  const q = subCompanyId ? `?subCompanyId=${encodeURIComponent(subCompanyId)}` : '';
  const res = await apiFetch<{ data: ApprovalStatusResponse }>(
    `/approvals/${workflow}/${encodeURIComponent(entityId)}/status${q}`,
  );
  if (!res.ok || !res.data?.data) throw new Error('Failed to load approval status');
  return res.data.data;
}

export async function postApprovalAction(
  workflow: ApprovalWorkflowType,
  entityId: string,
  action: 'forward' | 'approve' | 'reject',
  opts?: { subCompanyId?: string; remarks?: string },
): Promise<unknown> {
  const res = await fetch(
    `${API_PREFIX}/approvals/${workflow}/${encodeURIComponent(entityId)}/${action}`,
    {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
      credentials: 'include',
      body: JSON.stringify({
        subCompanyId: opts?.subCompanyId,
        remarks: opts?.remarks,
      }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Approval action failed');
  return (data as { data?: unknown }).data;
}

export async function fetchRoleApprovalCapabilities(roleId: string): Promise<
  Record<ApprovalWorkflowType, ApprovalActorMode>
> {
  const res = await apiFetch<{
    data: { capabilities: Record<ApprovalWorkflowType, ApprovalActorMode> };
  }>(`/roles/${encodeURIComponent(roleId)}/approval-capabilities`);
  if (!res.ok || !res.data?.data?.capabilities) throw new Error('Failed to load approval capabilities');
  return res.data.data.capabilities;
}

export async function updateRoleApprovalCapabilities(
  roleId: string,
  capabilities: Array<{ workflow: ApprovalWorkflowType; mode: ApprovalActorMode }>,
): Promise<void> {
  const res = await fetch(`${API_PREFIX}/roles/${encodeURIComponent(roleId)}/approval-capabilities`, {
    method: 'PUT',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ capabilities }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to save capabilities');
}

// ——— Settings: Idle Time Threshold ———

export async function fetchIdleTimeSetting(): Promise<{ thresholdMinutes: number }> {
  const res = await apiFetch<{ thresholdMinutes: number }>('/settings/idle-time');
  if (!res.ok) return { thresholdMinutes: 5 };
  return res.data ?? { thresholdMinutes: 5 };
}

export async function updateIdleTimeSetting(
  thresholdMinutes: number,
): Promise<{ thresholdMinutes: number }> {
  const res = await fetch(`${API_PREFIX}/settings/idle-time`, {
    method: 'PUT',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ thresholdMinutes }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to update idle time setting');
  return data as { thresholdMinutes: number };
}

/** Map API lead to frontend Lead shape (adds ownerName, subCompanyName). */
export function mapApiLeadToLead(
  apiLead: ApiLead,
  subCompanyName: string
): { id: string; clientId: string; ownerId: string; ownerName: string; subCompanyId: string; subCompanyName: string; stage: string; status: string; temperature: string; lastActivity?: Date; nextFollowUp?: Date; createdAt: Date; updatedAt: Date; notes?: string; closedAt?: Date; closedById?: string; lossReason?: string; reassignedFromLeadId?: string; reassignedById?: string; latestProposalId?: string | null; latestProposalStatus?: 'pending' | 'approved' | 'rejected' | null; latestRejectionComment?: string | null; leadDeadline?: Date; extensionRequested?: boolean; extensionReason?: string; extensionDays?: number; extensionStatus?: 'pending' | 'approved' | 'rejected' | null; extensionRequestedAt?: Date; extensionReviewedAt?: Date; reviewedBy?: string; managerRemarks?: string; reassignmentLocked?: boolean; lockedAssociateId?: string; requiresDeadlineAction?: boolean } {
  return {
    id: apiLead.id,
    clientId: apiLead.clientId,
    ownerId: apiLead.ownerId,
    ownerName: `${apiLead.owner.firstName} ${apiLead.owner.lastName}`.trim(),
    subCompanyId: apiLead.subCompanyId,
    subCompanyName,
    stage: apiLead.stage,
    status: apiLead.status,
    temperature: (apiLead.temperature as string) ?? 'warm',
    lastActivity: apiLead.lastActivity ? new Date(apiLead.lastActivity) : undefined,
    nextFollowUp: apiLead.nextFollowUp ? new Date(apiLead.nextFollowUp) : undefined,
    createdAt: new Date(apiLead.createdAt),
    updatedAt: new Date(apiLead.updatedAt),
    notes: apiLead.notes ?? undefined,
    closedAt: apiLead.closedAt ? new Date(apiLead.closedAt) : undefined,
    closedById: apiLead.closedById ?? undefined,
    lossReason: apiLead.lossReason ?? undefined,
    reassignedFromLeadId: apiLead.reassignedFromLeadId ?? undefined,
    reassignedById: apiLead.reassignedById ?? undefined,
    latestProposalId: apiLead.latestProposalId ?? null,
    latestProposalStatus: apiLead.latestProposalStatus ?? null,
    latestRejectionComment: apiLead.latestRejectionComment ?? null,
    leadDeadline: apiLead.leadDeadline ? new Date(apiLead.leadDeadline) : undefined,
    extensionRequested: apiLead.extensionRequested ?? undefined,
    extensionReason: apiLead.extensionReason ?? undefined,
    extensionDays: apiLead.extensionDays ?? undefined,
    extensionStatus: apiLead.extensionStatus ?? null,
    extensionRequestedAt: apiLead.extensionRequestedAt ? new Date(apiLead.extensionRequestedAt) : undefined,
    extensionReviewedAt: apiLead.extensionReviewedAt ? new Date(apiLead.extensionReviewedAt) : undefined,
    reviewedBy: apiLead.reviewedBy ?? undefined,
    managerRemarks: apiLead.managerRemarks ?? undefined,
    reassignmentLocked: apiLead.reassignmentLocked ?? undefined,
    lockedAssociateId: apiLead.lockedAssociateId ?? undefined,
    requiresDeadlineAction: apiLead.requiresDeadlineAction ?? false,
  };
}

/** GET /proposals/job-titles — returns the agency's allowed job titles as position options. */
export async function fetchProposalJobTitles(): Promise<{ id: string; name: string }[]> {
  const res = await apiFetch<{ data: { id: string; name: string }[] }>('/proposals/job-titles');
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

/** POST /proposals — submit a proposal for a lead. */
/** Upload a proposal attachment file to R2 before proposal submission. Returns the stored file key/url. */
export async function uploadProposalAttachment(file: File): Promise<{ fileKey: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const authHeaders = getAuthHeaders() as Record<string, string>;
  // Don't set Content-Type — browser sets it with correct boundary
  delete authHeaders['Content-Type'];
  const res = await fetch(`${API_PREFIX}/proposals/attachments/upload`, {
    method: 'POST',
    headers: authHeaders,
    credentials: 'include',
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Attachment upload failed');
  return { fileKey: (data as { fileKey: string }).fileKey };
}

export async function fetchProposalAttachmentBlob(attachmentId: string): Promise<Blob> {
  return fetchAuthenticatedBlob(`${API_PREFIX}/proposals/attachments/${attachmentId}`);
}

/** Download a proposal attachment via auth-gated backend endpoint. */
export async function downloadProposalAttachment(attachmentId: string, filename: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/proposals/attachments/${attachmentId}`, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

export async function submitProposal(payload: {
  leadId: string;
  locationType: string;
  agreementTypes: string[];
  tempPricingType?: string;
  tempPricingValue?: number;
  tempMinimumHours?: number;
  directPricingType?: string;
  directPricingValue?: number;
  paymentTerms: string;
  comment?: string;
  clientMessage?: string;
  attachments?: { name: string; size: number; type: string; url: string }[];
  selectedDefaultFileIds?: string[];
  selectedContactId?: string;
  pandaDocTemplateId?: string;
  pandaDocTemplateName?: string;
  positions?: { name: string; count: number }[];
  isForReview?: boolean;
  reviewTemplateId?: string;
}): Promise<void> {
  const res = await fetch(`${API_PREFIX}/proposals`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to submit proposal');
}

/** GET /proposals/:id/preview-email */
export async function previewProposalEmail(proposalId: string): Promise<{
  subject: string;
  html: string;
  to: string;
  contactName: string;
  documentLinkAvailable: boolean;
  missingFields: string[];
}> {
  const res = await fetch(`${API_PREFIX}/proposals/${proposalId}/preview-email`, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { message?: string; error?: string }).message ?? (data as { error?: string }).error ?? 'Failed to load email preview');
  return data as any;
}

/** POST /proposals/:id/approve */
export async function approveProposal(
  proposalId: string,
  opts?: { signed: boolean; signingAuthorityId?: string },
): Promise<void> {
  const res = await fetch(`${API_PREFIX}/proposals/${proposalId}/approve`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: opts ? JSON.stringify(opts) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to approve proposal');
}

/** POST /proposals/:id/reject */
export async function rejectProposal(proposalId: string, rejectionComment: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/proposals/${proposalId}/reject`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ rejectionComment }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to reject proposal');
}

/** POST /proposals/leads/:leadId/reset — reset rejected lead back to new_lead */
export async function resetLeadAfterRejection(leadId: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/proposals/leads/${leadId}/reset`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to reset lead');
}

/** GET /proposals — list proposals (manager view, or filtered by clientId) */
export interface ProposalDetail {
  id: string;
  agreementTypes: string[];
  paymentTerms: string;
  tempPricingType?: string | null;
  tempPricingValue?: number | null;
  tempMinimumHours?: number | null;
  directPricingType?: string | null;
  directPricingValue?: number | null;
  comment?: string | null;
  clientMessage?: string | null;
  isForReview?: boolean;
  selectedContactId?: string | null;
  selectedDefaultFiles: { id: string; defaultFileId: string | null; name: string }[];
  positions: { id: string; name: string; count: number }[];
  createdBy?: { id: string; firstName: string | null; lastName: string | null } | null;
}

export async function fetchProposalById(id: string): Promise<ProposalDetail | null> {
  const res = await apiFetch<ProposalDetail>(`/proposals/${id}`);
  if (!res.ok) return null;
  return res.data ?? null;
}

export async function fetchProposals(params?: { status?: string; page?: number; limit?: number; clientId?: string; pendingActivation?: boolean; ownerIds?: string[]; ownerExact?: boolean; documentReview?: boolean; isForReview?: boolean; allAgencies?: boolean; subCompanyId?: string }): Promise<{ proposals: any[]; total: number }> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.clientId) searchParams.set('clientId', params.clientId);
  if (params?.allAgencies) searchParams.set('allAgencies', 'true');
  if (params?.subCompanyId) searchParams.set('subCompanyId', params.subCompanyId);
  if (params?.pendingActivation !== undefined) searchParams.set('pendingActivation', String(params.pendingActivation));
  appendOwnerIds(searchParams, params?.ownerIds, params?.ownerExact);
  if (params?.documentReview !== undefined) searchParams.set('documentReview', String(params.documentReview));
  if (params?.isForReview !== undefined) searchParams.set('isForReview', String(params.isForReview));
  const res = await apiFetch<{ proposals: any[]; total: number }>(`/proposals?${searchParams.toString()}`);
  if (!res.ok) return { proposals: [], total: 0 };
  return res.data ?? { proposals: [], total: 0 };
}

export async function submitAwaitingClientDecision(
  proposalId: string,
  payload: { requestExtension: boolean; noResponseReason: string; extensionReason?: string; requestedDays?: number }
): Promise<void> {
  const res = await fetch(`${API_PREFIX}/proposals/${proposalId}/awaiting-client-decision`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? 'Failed to submit awaiting-client decision');
  }
}

export async function fetchProposalExtensionRequests(status: 'pending' | 'approved' | 'rejected' = 'pending'): Promise<any[]> {
  const res = await apiFetch<{ requests: any[] }>(`/proposals/awaiting-client-extension-requests?status=${status}`);
  if (!res.ok) return [];
  return res.data?.requests ?? [];
}

export async function reviewProposalExtensionRequest(id: string, decision: 'approve' | 'reject', comment?: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/proposals/awaiting-client-extension-requests/${id}/${decision}`, {
    method: 'PATCH',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(comment ? { comment } : {}),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `Failed to ${decision} extension request`);
  }
}

export async function approveForReview(proposalId: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/proposals/${proposalId}/approve-for-review`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? 'Failed to send review email');
  }
}

export interface ReviewTemplate {
  id: string;
  name: string;
  documentType: string;
  originalFilename: string;
  createdAt: string;
  uploadedBy?: { firstName: string | null; lastName: string | null };
}

export async function fetchReviewTemplates(subCompanyId?: string): Promise<ReviewTemplate[]> {
  const res = await fetch(`${API_PREFIX}${withAgency('/review-templates', subCompanyId)}`, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({ templates: [] }));
  return (data as any).templates ?? [];
}

export async function uploadReviewTemplate(documentType: string, file: File, subCompanyId?: string): Promise<ReviewTemplate> {
  const authHeaders = getAuthHeaders() as Record<string, string>;
  const formData = new FormData();
  formData.append('documentType', documentType);
  formData.append('file', file);
  const res = await fetch(`${API_PREFIX}${withAgency('/review-templates', subCompanyId)}`, {
    method: 'POST',
    headers: { Authorization: authHeaders['Authorization'] },
    credentials: 'include',
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error ?? 'Failed to upload template');
  return (data as any).template;
}

export async function deleteReviewTemplate(id: string, subCompanyId?: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}${withAgency(`/review-templates/${id}`, subCompanyId)}`, {
    method: 'DELETE',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).error ?? 'Failed to delete template');
  }
}

export async function previewReviewTemplate(id: string, subCompanyId?: string): Promise<Blob> {
  const res = await fetch(`${API_PREFIX}${withAgency(`/review-templates/${id}/preview`, subCompanyId)}`, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).error ?? 'Preview failed');
  }
  return res.blob();
}

export async function downloadReviewTemplate(id: string, subCompanyId?: string): Promise<Blob> {
  const res = await fetch(`${API_PREFIX}${withAgency(`/review-templates/${id}/download`, subCompanyId)}`, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).error ?? 'Download failed');
  }
  return res.blob();
}

export async function activateProposal(proposalId: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/proposals/${proposalId}/activate`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to activate');
  }
}

/** POST /proposals/:id/approve-and-activate — manager shortcut from the approval phase straight to Closed Won */
export async function approveAndActivateProposal(proposalId: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/proposals/${proposalId}/approve-and-activate`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'Failed to make lead active');
  }
}

export async function requestProposalReview(proposalId: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/proposals/${proposalId}/request-review`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to submit for review');
  }
}

export async function rejectProposalReview(proposalId: string, comment: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/proposals/${proposalId}/reject-review`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify({ comment }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to reject review');
  }
}

export async function uploadProposalDocument(proposalId: string, data: { category: string; name: string; fileBase64: string; mimeType?: string }): Promise<any> {
  const res = await fetch(`${API_PREFIX}/proposals/${proposalId}/documents`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to upload document');
  }
  return res.json();
}

export async function fetchProposalDocuments(proposalId: string): Promise<{ documents: any[] }> {
  const res = await apiFetch<{ documents: any[] }>(`/proposals/${proposalId}/documents`);
  if (!res.ok) return { documents: [] };
  return res.data ?? { documents: [] };
}

export async function fetchProposalContacts(proposalId: string): Promise<{ contacts: any[] }> {
  const res = await apiFetch<{ contacts: any[] }>(`/proposals/${proposalId}/contacts`);
  if (!res.ok) return { contacts: [] };
  return res.data ?? { contacts: [] };
}

export async function sendProposalDocumentsToClient(proposalId: string, data: {
  contactId: string;
  files: { name: string; fileBase64: string; mimeType?: string }[];
}): Promise<{ documents: any[]; emailSentTo: string }> {
  const res = await fetch(`${API_PREFIX}/proposals/${proposalId}/send-to-client`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to send documents');
  }
  return res.json();
}

// ── PandaDoc API ──

export type PandaDocTemplatesOpts = {
  /** Agency scope for mapped templates (Option A). Ignored when catalog / allAgencies. */
  subCompanyId?: string;
  /** Full PandaDoc catalog for Settings assign UI (requires settings:write). */
  catalog?: boolean;
  /** Union of mapped templates across all agencies the caller can access. */
  allAgencies?: boolean;
};

export async function pandaDocGetTemplates(
  opts?: PandaDocTemplatesOpts,
): Promise<{ id: string; name: string }[]> {
  let path = '/pandadoc/templates';
  if (opts?.catalog) {
    path = `${path}?catalog=1`;
  } else if (opts?.allAgencies) {
    path = `${path}?allAgencies=1`;
  } else if (opts?.subCompanyId) {
    path = withAgency(path, opts.subCompanyId);
  }
  const res = await apiFetch<{ templates: { id: string; name: string }[] }>(path);
  if (!res.ok) return [];
  return res.data?.templates ?? [];
}

export interface PandaDocTemplateField {
  uuid: string;
  name: string;
  type: string;
  merge_field?: string;
}

export interface PandaDocTemplateToken {
  name: string;
  value: string;
}

export interface PandaDocTemplateRole {
  id: string;
  name: string;
  signing_order?: number;
}

export interface PandaDocTemplateDetailed {
  id: string;
  name: string;
  date_created: string;
  date_modified: string;
  fields: PandaDocTemplateField[];
  tokens: PandaDocTemplateToken[];
  roles: PandaDocTemplateRole[];
  /** Proposal-type slots this template fills (temp / direct / both). */
  proposalTypes?: Array<'temp' | 'direct' | 'both'>;
  /** Agencies that map this template (All Agencies / single-agency metadata). */
  agencies?: Array<{
    id: string;
    name: string;
    roles?: Array<'temp' | 'direct' | 'both'>;
  }>;
}

export interface PandaDocSentDocument {
  id: string;
  pandaDocId: string;
  pandaDocStatus: string | null;
  pandaDocUpdatedAt: string | null;
  createdAt: string;
  lead: {
    id: string;
    client: { id: string; name: string };
  };
}

export async function pandaDocGetTemplatesDetailed(
  forceRefreshOrOpts: boolean | (PandaDocTemplatesOpts & { refresh?: boolean }) = false,
): Promise<{
  templates: PandaDocTemplateDetailed[];
  total: number;
}> {
  const opts: PandaDocTemplatesOpts & { refresh?: boolean } =
    typeof forceRefreshOrOpts === 'boolean'
      ? { refresh: forceRefreshOrOpts }
      : forceRefreshOrOpts;

  const params = new URLSearchParams();
  if (opts.refresh) params.set('refresh', 'true');
  if (opts.allAgencies) params.set('allAgencies', '1');
  else if (opts.subCompanyId) params.set('subCompanyId', opts.subCompanyId);
  const qs = params.toString() ? `?${params.toString()}` : '';

  const res = await apiFetch<{ templates: PandaDocTemplateDetailed[]; total: number }>(
    `/pandadoc/templates/details${qs}`,
  );
  if (!res.ok) {
    const msg = (res.data as { error?: string } | undefined)?.error ?? 'Failed to fetch PandaDoc templates';
    throw new Error(msg);
  }
  return res.data!;
}

export async function pandaDocGetSentDocuments(): Promise<{ documents: PandaDocSentDocument[] }> {
  const res = await apiFetch<{ documents: PandaDocSentDocument[] }>('/pandadoc/sent-documents');
  if (!res.ok) {
    const msg = (res.data as { error?: string } | undefined)?.error ?? 'Failed to fetch sent documents';
    throw new Error(msg);
  }
  return res.data!;
}

export interface PandaDocPrefillData {
  client: { name: string; industry: string; location: string; address: string; companySize: string };
  contact: { name: string; firstName: string; lastName: string; title: string; email: string; phone: string } | null;
  sender: { name: string; firstName: string; lastName: string; email: string; phone: string };
  agency: { name: string };
  lead: { value: string; stage: string };
  date: { today: string; todayShort: string; year: string };
  proposal: {
    paymentDays: string;       // "30" from net_30
    paymentTermsLabel: string; // "Net 30"
    minimumHours: string;      // tempMinimumHours as string
    billingRate: string;       // "45%" or "$28/hr"
    agreementTypeLabel: string;
  };
  contacts: Array<{ id: string; name: string; title: string | null; email: string | null; phone: string | null; isPrimary: boolean; isUnsubscribed: boolean }>;
  selectedContactId: string | null;
}

export async function pandaDocGetPrefill(proposalId: string, contactId?: string): Promise<PandaDocPrefillData> {
  const qs = contactId ? `?contactId=${encodeURIComponent(contactId)}` : '';
  const res = await apiFetch<PandaDocPrefillData>(`/pandadoc/prefill/${proposalId}${qs}`);
  if (!res.ok) {
    const msg = (res.data as { error?: string } | undefined)?.error ?? 'Failed to fetch prefill data';
    throw new Error(msg);
  }
  return res.data!;
}

export interface AgreementPreviewResult {
  pdfBase64: string;
  templateName: string;
  filledTokens: Array<{ name: string; value: string; filled: boolean }>;
  cached?: boolean;
  total: number;
  filled: number;
}

/** POST /pandadoc/agreement-preview — returns PDF result or { status: 'still_generating' } if background job is running */
export async function pandaDocAgreementPreview(proposalId: string): Promise<AgreementPreviewResult | { status: 'still_generating' }> {
  const res = await apiFetch<AgreementPreviewResult | { status: string }>('/pandadoc/agreement-preview', {
    method: 'POST',
    body: JSON.stringify({ proposalId }),
  });
  if (!res.ok) {
    const msg = (res.data as { error?: string } | undefined)?.error ?? 'Failed to generate agreement preview';
    throw new Error(msg);
  }
  const d = res.data! as any;
  if (d?.status === 'still_generating') {
    return { status: 'still_generating' };
  }
  return d as AgreementPreviewResult;
}

export async function pandaDocSendDocument(body: {
  proposalId: string;
  templateId: string;
  recipientEmail: string;
  recipientFirstName: string;
  recipientLastName: string;
  recipientRole: string;
  message?: string;
  tokens?: Array<{ name: string; value: string }>;
}): Promise<{ documentId: string; status: string }> {
  const res = await fetch(`${API_PREFIX}/pandadoc/documents`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to send document');
  return data;
}

export async function pandaDocVoidDocument(documentId: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/pandadoc/documents/${documentId}/void`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to void document');
}

export async function pandaDocSyncDocument(documentId: string): Promise<{ documentId: string; status: string; synced: boolean }> {
  const res = await fetch(`${API_PREFIX}/pandadoc/documents/${documentId}/sync`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to sync document');
  return data as { documentId: string; status: string; synced: boolean };
}

// ── Meetings API ──

export interface ApiMeeting {
  id: string;
  clientId: string;
  clientName: string | null;
  leadId: string | null;
  leadStage: string | null;
  ownerId: string;
  ownerName: string | null;
  title: string;
  startTime: string;
  endTime: string;
  location: string | null;
  meetingLink: string | null;
  agenda: string | null;
  notes: string | null;
  status: 'scheduled' | 'completed';
  subCompanyId: string;
  attendees: {
    id: string;
    userId: string | null;
    contactId: string | null;
    contactName: string | null;
    contactEmail: string | null;
    userName?: string | null;
    userEmail?: string | null;
    displayName?: string | null;
    displayEmail?: string | null;
  }[];
  createdAt: string;
  updatedAt: string;
  forwardedFromName?: string | null;
  forwardedFromSubCompanyId?: string | null;
}

export async function fetchMeetings(params?: {
  page?: number;
  limit?: number;
  ownerId?: string;
  clientId?: string;
  leadId?: string;
  scope?: 'mine' | 'team' | 'all';
  from?: string;
  to?: string;
  agencyIds?: string[];
  ownerIds?: string[]; ownerExact?: boolean;
}): Promise<{ data: ApiMeeting[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  const sp = new URLSearchParams();
  if (params?.page) sp.set('page', String(params.page));
  if (params?.limit) sp.set('limit', String(params.limit));
  if (params?.ownerId) sp.set('ownerId', params.ownerId);
  if (params?.clientId) sp.set('clientId', params.clientId);
  if (params?.leadId) sp.set('leadId', params.leadId);
  if (params?.scope) sp.set('scope', params.scope);
  if (params?.from) sp.set('from', params.from);
  if (params?.to) sp.set('to', params.to);
  if (params?.agencyIds?.length) sp.set('agencyIds', params.agencyIds.join(','));
  appendOwnerIds(sp, params?.ownerIds, params?.ownerExact);
  const res = await apiFetch<{ data: ApiMeeting[]; pagination: any }>(`/meetings?${sp.toString()}`);
  if (!res.ok) return { data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } };
  return res.data;
}

// ── Booked Meetings API ──

export interface ApiBookedMeeting {
  id: string;
  hostUserId: string;
  hostName: string | null;
  guestName: string;
  guestEmail: string;
  guestCompany: string | null;
  startTime: string;
  endTime: string;
  meetingLink: string | null;
  notes: string | null;
  status: 'scheduled' | 'completed' | 'cancelled';
  createdAt: string;
}

export async function fetchBookedMeetings(params?: {
  page?: number;
  limit?: number;
  status?: 'scheduled' | 'completed' | 'cancelled';
  from?: string;
  to?: string;
}): Promise<{ data: ApiBookedMeeting[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  const sp = new URLSearchParams();
  if (params?.page) sp.set('page', String(params.page));
  if (params?.limit) sp.set('limit', String(params.limit));
  if (params?.status) sp.set('status', params.status);
  if (params?.from) sp.set('from', params.from);
  if (params?.to) sp.set('to', params.to);
  const res = await apiFetch<{ data: ApiBookedMeeting[]; pagination: any }>(`/booked-meetings?${sp.toString()}`);
  if (!res.ok) return { data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } };
  return res.data;
}

export async function fetchMeeting(id: string): Promise<ApiMeeting | null> {
  const res = await apiFetch<ApiMeeting>(`/meetings/${id}`);
  return res.ok ? res.data : null;
}

export async function createMeeting(payload: {
  clientId: string;
  leadId?: string;
  title: string;
  startTime: string;
  endTime: string;
  location?: string;
  meetingLink?: string;
  agenda?: string;
  notes?: string;
  attendeeUserIds?: string[];
  attendeeContactIds?: string[];
  googleAutoMeetLink?: boolean;
  subCompanyId?: string;
}): Promise<ApiMeeting | null> {
  const path = payload.subCompanyId ? `/meetings?subCompanyId=${encodeURIComponent(payload.subCompanyId)}` : '/meetings';
  const { subCompanyId: _subCompanyId, ...body } = payload;
  void _subCompanyId;
  const res = await apiFetch<ApiMeeting>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.ok ? res.data : null;
}

/** Create meeting; surfaces 409 conflict errors for the UI. */
export async function createMeetingWithError(payload: {
  clientId: string;
  leadId?: string;
  title: string;
  startTime: string;
  endTime: string;
  location?: string;
  meetingLink?: string;
  agenda?: string;
  notes?: string;
  attendeeUserIds?: string[];
  attendeeContactIds?: string[];
  googleAutoMeetLink?: boolean;
  subCompanyId?: string;
}): Promise<{ meeting: ApiMeeting } | { error: string }> {
  const path = payload.subCompanyId ? `/meetings?subCompanyId=${encodeURIComponent(payload.subCompanyId)}` : '/meetings';
  const { subCompanyId: _subCompanyId, ...body } = payload;
  void _subCompanyId;
  const res = await apiFetch<ApiMeeting>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return {
      error:
        res.error ||
        (res.status === 409 ? 'Time conflict with an existing meeting' : 'Failed to schedule meeting'),
    };
  }
  return { meeting: res.data! };
}

export type MeetingAvailabilityConflict = {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  subCompanyId: string;
  subCompanyName: string | null;
};

export type MeetingAvailabilityResult = {
  userId: string;
  /** CRM overlap — hard conflict on create. */
  available: boolean;
  conflicts: MeetingAvailabilityConflict[];
  googleChecked?: boolean;
  /** Soft Google FreeBusy busy flag (does not hard-block create). */
  googleBusy?: boolean;
};

/** Soft conflict check for staff participants (Director/global scan all allowed agencies). */
export async function checkMeetingParticipantsAvailability(payload: {
  startTime: string;
  endTime: string;
  userIds: string[];
  excludeMeetingId?: string;
  subCompanyId?: string;
}): Promise<{ agencyCount: number; googleChecked?: boolean; results: MeetingAvailabilityResult[] } | null> {
  const res = await apiFetch<{ agencyCount: number; googleChecked?: boolean; results: MeetingAvailabilityResult[] }>(
    '/meetings/check-availability',
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return res.ok ? res.data : null;
}

export type MeetingParticipantCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  userType: string | null;
  subCompanyId: string | null;
  subCompanyName: string | null;
};

/** GET /meetings/participant-candidates — staff invite list (meetings:add_participants). */
export async function fetchMeetingParticipantCandidates(params?: {
  subCompanyId?: string;
}): Promise<MeetingParticipantCandidate[]> {
  const sp = new URLSearchParams();
  if (params?.subCompanyId) {
    sp.set('subCompanyId', params.subCompanyId);
  } else {
    // Prevent apiFetch from injecting viewedSubCompanyId (would wrongly narrow Director “all” scope).
    sp.set('globalDb', 'true');
  }
  const res = await apiFetch<{ data: MeetingParticipantCandidate[] }>(
    `/meetings/participant-candidates?${sp.toString()}`,
  );
  if (!res.ok) return [];
  return res.data?.data ?? [];
}

export async function updateMeeting(id: string, payload: {
  title?: string;
  startTime?: string;
  endTime?: string;
  location?: string | null;
  meetingLink?: string | null;
  agenda?: string | null;
  notes?: string | null;
  attendeeUserIds?: string[];
  attendeeContactIds?: string[];
}): Promise<ApiMeeting | null> {
  const res = await apiFetch<ApiMeeting>(`/meetings/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return res.ok ? res.data : null;
}

export async function deleteMeeting(id: string): Promise<boolean> {
  const res = await apiFetch(`/meetings/${id}`, { method: 'DELETE' });
  return res.ok;
}

export async function cancelBookedMeeting(id: string): Promise<boolean> {
  const res = await apiFetch(`/booked-meetings/${id}/cancel`, { method: 'PATCH' });
  return res.ok;
}

export async function completeMeeting(id: string): Promise<ApiMeeting | null> {
  const res = await apiFetch<ApiMeeting>(`/meetings/${id}/complete`, { method: 'PATCH' });
  return res.ok ? res.data : null;
}

export async function completeBookedMeeting(id: string): Promise<boolean> {
  const res = await apiFetch(`/booked-meetings/${id}/complete`, { method: 'PATCH' });
  return res.ok;
}

// ─── Daily Report Email Settings ────────────────────────────────────────────

export interface DailyReportSettings {
  enabled: boolean;
  sendHour: number;
  sendMinute: number;
  timezone: string;
  shiftHours: number;
}

/** GET /settings/daily-report */
export async function fetchDailyReportSettings(): Promise<DailyReportSettings> {
  const res = await apiFetch<DailyReportSettings>('/settings/daily-report');
  if (!res.ok || !res.data) {
    return { enabled: false, sendHour: 18, sendMinute: 0, timezone: 'America/Toronto', shiftHours: 8 };
  }
  return res.data;
}

/** PATCH /settings/daily-report */
export async function updateDailyReportSettings(data: Partial<DailyReportSettings>): Promise<DailyReportSettings | null> {
  const res = await apiFetch<DailyReportSettings>('/settings/daily-report', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  return res.ok && res.data ? res.data : null;
}

export interface EmailSendWindowSettings {
  enabled: boolean;
  startMinuteOfDay: number | null;
  cutoffMinuteOfDay: number | null;
  timezone: string;
}

/** GET /settings/email-send-window */
export async function fetchEmailSendWindowSettings(): Promise<EmailSendWindowSettings> {
  const res = await apiFetch<EmailSendWindowSettings>('/settings/email-send-window');
  if (!res.ok || !res.data) {
    return {
      enabled: false,
      startMinuteOfDay: null,
      cutoffMinuteOfDay: null,
      timezone: 'America/Toronto',
    };
  }
  return res.data;
}

/** PUT /settings/email-send-window */
export async function updateEmailSendWindowSettings(data: EmailSendWindowSettings): Promise<EmailSendWindowSettings | null> {
  const res = await apiFetch<EmailSendWindowSettings>('/settings/email-send-window', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  return res.ok && res.data ? res.data : null;
}

/** DELETE /settings/email-send-window */
export async function disableEmailSendWindowSettings(): Promise<EmailSendWindowSettings | null> {
  const res = await apiFetch<EmailSendWindowSettings>('/settings/email-send-window', {
    method: 'DELETE',
  });
  return res.ok && res.data ? res.data : null;
}

// ── Activity session API (server-authoritative idle tracking) ─────────────────

export interface ActivitySessionState {
  sessionId: string;
  state: 'active' | 'idle' | 'offline_suspected';
  idleSeconds: number;
  activeSeconds: number;
  serverTime: string;
  idleStartedAt: string | null;
}

export interface HeartbeatResponse {
  state: 'active' | 'idle' | 'offline_suspected';
  idleSeconds: number;
  serverTime: string;
  idleStartedAt: string | null;
}

/** GET /activity/current-session — called on every app boot to restore authoritative state. */
export async function fetchCurrentActivitySession(): Promise<ActivitySessionState | null> {
  const res = await apiFetch<ActivitySessionState>('/activity/current-session');
  if (!res.ok || !res.data) return null;
  return res.data;
}

/** POST /activity/heartbeat — sent every 20s by the tab leader. */
export async function sendActivityHeartbeat(
  sessionId: string,
  visibilityState: 'visible' | 'hidden',
  hadActivitySinceLastBeat: boolean,
): Promise<HeartbeatResponse | null> {
  const res = await apiFetch<HeartbeatResponse>('/activity/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ sessionId, visibilityState, hadActivitySinceLastBeat }),
  });
  if (!res.ok || !res.data) return null;
  return res.data;
}

/** POST /activity/event — lifecycle events (tab_hidden, tab_visible, etc.). */
export async function sendActivityEvent(
  sessionId: string,
  eventType: 'user_activity' | 'tab_hidden' | 'tab_visible' | 'before_unload' | 'manual_back' | 'session_start',
): Promise<void> {
  await apiFetch('/activity/event', {
    method: 'POST',
    body: JSON.stringify({ sessionId, eventType, clientTime: new Date().toISOString() }),
  });
}

/** POST /activity/manual-back — the ONLY way to clear idle state.
 *  Returns state; caller must check state === 'active' before closing modal. */
export async function sendManualBack(sessionId: string): Promise<{ state: string; serverTime: string } | null> {
  const res = await apiFetch<{ state: string; serverTime: string }>('/activity/manual-back', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok || !res.data) return null;
  return res.data;
}

// ─── Google Calendar OAuth ────────────────────────────────────────────────────

/** GET /auth/google?subCompanyId=<id> — returns the Google OAuth consent URL for a specific agency. */
export async function getGoogleAuthUrl(subCompanyId?: string): Promise<string | null> {
  const path = subCompanyId
    ? `/auth/google?subCompanyId=${encodeURIComponent(subCompanyId)}`
    : '/auth/google';
  const res = await apiFetch<{ url: string }>(path);
  return res.ok && res.data ? res.data.url : null;
}

// ─── Email Campaigns API ─────────────────────────────────────────────────────

export interface ApiCampaign {
  id: string;
  subCompanyId: string;
  name: string;
  listId: string;
  listName: string;
  subject: string;
  body: string;
  templateId: string | null;
  scheduledDate: string;
  sentAt: string | null;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';
  totalRecipients: number;
  createdAt: string;
  stats: {
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    failed: number;
  };
}

export interface ApiCampaignRecipient {
  id: string;
  campaignId: string;
  clientId: string;
  clientName: string;
  email: string;
  status: string;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  errorMessage: string | null;
}

export async function fetchCampaigns(params?: {
  page?: number;
  limit?: number;
  status?: string;
  subCompanyId?: string;
  ownerIds?: string[]; ownerExact?: boolean;
}): Promise<{ data: ApiCampaign[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  const sp = new URLSearchParams();
  if (params?.page) sp.set('page', String(params.page));
  if (params?.limit) sp.set('limit', String(params.limit));
  if (params?.status) sp.set('status', params.status);
  if (params?.subCompanyId) sp.set('subCompanyId', params.subCompanyId);
  appendOwnerIds(sp, params?.ownerIds, params?.ownerExact);
  const res = await apiFetch<{ data: ApiCampaign[]; pagination: any }>(`/campaigns?${sp.toString()}`);
  if (!res.ok) return { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
  return res.data;
}

export async function createCampaign(payload: {
  name: string;
  listId: string;
  listName: string;
  subject: string;
  body: string;
  templateId?: string | null;
  scheduledDate?: string;
  subCompanyId?: string;
}): Promise<ApiCampaign | null> {
  const path = payload.subCompanyId ? `/campaigns?subCompanyId=${encodeURIComponent(payload.subCompanyId)}` : '/campaigns';
  const { subCompanyId: _subCompanyId, ...body } = payload;
  void _subCompanyId;
  const res = await apiFetch<ApiCampaign>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.ok ? res.data : null;
}

export async function updateCampaign(id: string, payload: {
  name?: string;
  listId?: string;
  listName?: string;
  subject?: string;
  body?: string;
  templateId?: string | null;
  scheduledDate?: string;
  status?: string;
}): Promise<ApiCampaign | null> {
  const res = await apiFetch<ApiCampaign>(`/campaigns/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return res.ok ? res.data : null;
}

export async function deleteCampaign(id: string): Promise<boolean> {
  const res = await apiFetch(`/campaigns/${id}`, { method: 'DELETE' });
  return res.ok;
}

export async function fetchCampaignRecipients(id: string): Promise<ApiCampaignRecipient[]> {
  const res = await apiFetch<{ data: ApiCampaignRecipient[] }>(`/campaigns/${id}/recipients`);
  return res.ok ? (res.data?.data ?? []) : [];
}

export async function sendCampaign(id: string): Promise<ApiCampaign | null> {
  const res = await apiFetch<ApiCampaign>(`/campaigns/${id}/send`, { method: 'POST' });
  return res.ok ? res.data : null;
}

export async function refreshCampaignStats(id: string): Promise<ApiCampaign | null> {
  const res = await apiFetch<ApiCampaign>(`/campaigns/${id}/refresh-stats`);
  return res.ok ? res.data : null;
}

// ─── Mailing Lists ────────────────────────────────────────────────────────────

export interface ApiListPerson {
  id: string;
  firstName: string;
  lastName: string;
}

export interface ApiMailingList {
  id: string;
  subCompanyId: string;
  createdBy: ApiListPerson | null;
  assignedTo: ApiListPerson[];
  name: string;
  description: string | null;
  isArchived: boolean;
  memberCount: number;
  createdAt: string;
}

export interface ApiAssignableUser {
  id: string;
  firstName: string;
  lastName: string;
  roleLabel: string;
}

export interface ApiMailingListMember {
  id: string;
  clientId: string;
  clientName: string;
  industry: string | null;
  email: string | null;
  addedAt: string;
}

export async function fetchMailingLists(params?: { subCompanyId?: string; createdById?: string; createdByIds?: string[] }): Promise<ApiMailingList[]> {
  const qs = new URLSearchParams();
  if (params?.subCompanyId) qs.set('subCompanyId', params.subCompanyId);
  if (params?.createdByIds?.length) qs.set('createdByIds', params.createdByIds.join(','));
  else if (params?.createdById) qs.set('createdById', params.createdById);
  const path = qs.toString() ? `/lists?${qs.toString()}` : '/lists';
  const res = await apiFetch<{ data: ApiMailingList[] }>(path);
  return res.ok ? (res.data?.data ?? []) : [];
}

export async function createMailingList(payload: { name: string; description?: string; subCompanyId?: string; createdById?: string }): Promise<ApiMailingList | null> {
  const path = payload.subCompanyId ? `/lists?subCompanyId=${encodeURIComponent(payload.subCompanyId)}` : '/lists';
  const { subCompanyId: _subCompanyId, ...body } = payload;
  void _subCompanyId;
  const res = await apiFetch<ApiMailingList>(path, { method: 'POST', body: JSON.stringify(body) });
  return res.ok ? res.data : null;
}

export async function updateMailingList(id: string, payload: { name?: string; description?: string }): Promise<ApiMailingList | null> {
  const res = await apiFetch<ApiMailingList>(`/lists/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  return res.ok ? res.data : null;
}

export async function deleteMailingList(id: string): Promise<boolean> {
  const res = await apiFetch(`/lists/${id}`, { method: 'DELETE' });
  return res.ok;
}

export async function fetchMailingListMembers(listId: string): Promise<ApiMailingListMember[]> {
  const res = await apiFetch<{ data: ApiMailingListMember[] }>(`/lists/${listId}/members`);
  return res.ok ? (res.data?.data ?? []) : [];
}

export async function addMembersToList(listId: string, clientIds: string[]): Promise<boolean> {
  const res = await apiFetch(`/lists/${listId}/members`, { method: 'POST', body: JSON.stringify({ clientIds }) });
  return res.ok;
}

export async function removeMemberFromList(listId: string, clientId: string): Promise<boolean> {
  const res = await apiFetch(`/lists/${listId}/members/${clientId}`, { method: 'DELETE' });
  return res.ok;
}

export async function fetchAssignableUsers(listId: string): Promise<ApiAssignableUser[]> {
  const res = await apiFetch<{ data: ApiAssignableUser[] }>(`/lists/${listId}/assignable-users`);
  return res.ok ? (res.data?.data ?? []) : [];
}

export async function addListAssignees(listId: string, userIds: string[]): Promise<ApiMailingList | null> {
  const res = await apiFetch<ApiMailingList>(`/lists/${listId}/assignees`, { method: 'POST', body: JSON.stringify({ userIds }) });
  return res.ok ? res.data : null;
}

export async function removeListAssignee(listId: string, userId: string): Promise<ApiMailingList | null> {
  const res = await apiFetch<ApiMailingList>(`/lists/${listId}/assignees/${userId}`, { method: 'DELETE' });
  return res.ok ? res.data : null;
}

export async function archiveMailingList(id: string, archived: boolean): Promise<ApiMailingList | null> {
  const res = await apiFetch<ApiMailingList>(`/lists/${id}/archive`, { method: 'PATCH', body: JSON.stringify({ archived }) });
  return res.ok ? res.data : null;
}

/** POST /auth/google/disconnect — unlink Google Calendar for a specific agency. */
export async function disconnectGoogleCalendar(subCompanyId?: string): Promise<boolean> {
  const res = await apiFetch('/auth/google/disconnect', {
    method: 'POST',
    body: subCompanyId ? JSON.stringify({ subCompanyId }) : undefined,
  });
  return res.ok;
}

// ─── Performance Targets ───────────────────────────────────────────────────

export interface PerformanceTargetValues {
  emailsTarget: number;
  callsTarget: number;
  meetingScheduleCountTarget: number;
}

export interface PerformanceActivityPair {
  assigned: number;
  completed: number;
}

export interface PerformanceTargetRoleRow {
  role: string;
  label: string;
  target: PerformanceTargetValues | null;
}

export interface PerformanceTargetsResponse {
  roles: PerformanceTargetRoleRow[];
}

export interface PerformanceReportUserResult {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  subCompanyId: string;
  target: PerformanceTargetValues | null;
  actual: {
    emails: number;
    calls: number;
    tasks: PerformanceActivityPair;
    followUps: PerformanceActivityPair;
    meetingsScheduled: number;
  };
  percentages: {
    emails: number | null;
    calls: number | null;
    tasks: number | null;
    followUps: number | null;
    meetings: number | null;
  } | null;
  targetConfigured: boolean;
}

export interface MyPerformanceResult {
  target: PerformanceTargetValues | null;
  actual: {
    emails: number;
    calls: number;
    tasks: PerformanceActivityPair;
    followUps: PerformanceActivityPair;
    meetingsScheduled: number;
  };
  percentages: {
    emails: number | null;
    calls: number | null;
    tasks: number | null;
    followUps: number | null;
    meetings: number | null;
  } | null;
  targetConfigured: boolean;
}

/**
 * GET /reports/my-performance
 * Returns the caller's own actuals vs their role target for a date range (any authenticated user).
 */
export async function fetchMyPerformanceReport(params?: {
  startDate?: string;
  endDate?: string;
}): Promise<MyPerformanceResult | null> {
  const qs = new URLSearchParams();
  if (params?.startDate) qs.set('startDate', params.startDate);
  if (params?.endDate)   qs.set('endDate',   params.endDate);
  const query = qs.toString();
  const res = await apiFetch<MyPerformanceResult>(`/reports/my-performance${query ? `?${query}` : ''}`);
  if (!res.ok) return null;
  return res.data ?? null;
}

/**
 * GET /settings/my-performance-target
 * Returns the active target for the caller's own role (any authenticated user).
 */
export async function fetchMyPerformanceTarget(): Promise<PerformanceTargetValues | null> {
  const res = await apiFetch<PerformanceTargetValues | null>('/settings/my-performance-target');
  if (!res.ok) return null;
  return res.data ?? null;
}

/**
 * GET /settings/performance-targets
 * Fetch current targets for each measured role in the caller's agency.
 */
export async function fetchPerformanceTargets(params?: {
  subCompanyId?: string;
  asOf?: string; // YYYY-MM-DD
}): Promise<PerformanceTargetsResponse> {
  const qs = new URLSearchParams();
  if (params?.subCompanyId) qs.set('subCompanyId', params.subCompanyId);
  if (params?.asOf) qs.set('asOf', params.asOf);
  const query = qs.toString();
  const res = await apiFetch<PerformanceTargetsResponse>(`/settings/performance-targets${query ? `?${query}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch performance targets');
  return res.data!;
}

/**
 * PUT /settings/performance-targets
 * Save a new role-level snapshot (append-only). Body: { role, ...targets }
 */
export async function savePerformanceTarget(payload: {
  role: string;
} & PerformanceTargetValues): Promise<void> {
  const res = await apiFetch('/settings/performance-targets', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to save performance target');
}

/**
 * GET /reports/performance
 * Fetch performance-vs-target report for a date range.
 */
export async function fetchPerformanceReport(params?: {
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  userIds?: string[]; // will be joined as comma-separated
  agencyIds?: string[];
}): Promise<PerformanceReportUserResult[]> {
  const qs = new URLSearchParams();
  if (params?.startDate) qs.set('startDate', params.startDate);
  if (params?.endDate)   qs.set('endDate',   params.endDate);
  if (params?.userIds?.length)   qs.set('userIds',   params.userIds.join(','));
  if (params?.agencyIds?.length) qs.set('agencyIds', params.agencyIds.join(','));
  const query = qs.toString();
  const res = await apiFetch<PerformanceReportUserResult[]>(`/reports/performance${query ? `?${query}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch performance report');
  return res.data ?? [];
}

/**
 * GET /reports/user-positions
 * Returns a map of userId → total positions closed for Closed Won leads in the date range.
 * Elevated roles see all users in their agencies; others see only their own entry.
 */
export async function fetchUserPositions(params?: {
  startDate?: string;
  endDate?: string;
  agencyIds?: string[];
}): Promise<Record<string, number>> {
  const qs = new URLSearchParams();
  if (params?.startDate) qs.set('startDate', params.startDate);
  if (params?.endDate)   qs.set('endDate',   params.endDate);
  if (params?.agencyIds?.length) qs.set('agencyIds', params.agencyIds.join(','));
  const query = qs.toString();
  const res = await apiFetch<Record<string, number>>(`/reports/user-positions${query ? `?${query}` : ''}`);
  if (!res.ok) return {};
  return res.data ?? {};
}

// ─── Conversion Rate Report ───────────────────────────────────────────────────

export interface ConversionRateActivityResult {
  count: number;        // activities performed (denominator)
  conversions: number;  // distinct closed_won leads with a causal activity link (numerator)
  rate: number | null;  // null = count is 0 (display as "—"); otherwise 0.0–100.0
}

export interface ConversionRateUserResult {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  subCompanyId: string;
  calls: ConversionRateActivityResult;
}

/** Returned by GET /reports/my-conversion-rate (any authenticated user). */
export type MyConversionRateResult = {
  calls: ConversionRateActivityResult;
};

/** Returned by GET /reports/bulk-email-conversion-rate (agency-level). */
export type BulkEmailConversionRateResult = ConversionRateActivityResult;

/**
 * GET /reports/bulk-email-conversion-rate
 * Agency-level bulk email (campaign) conversion rate.
 * Bulk emails have no per-user ownership — only agency-level metrics are meaningful.
 */
export async function fetchBulkEmailConversionRate(params?: {
  startDate?: string;
  endDate?: string;
  agencyId?: string;
  source?: 'mail' | 'call';
  dateBasis?: 'activity' | 'assigned';
}): Promise<BulkEmailConversionRateResult | null> {
  const qs = new URLSearchParams();
  if (params?.startDate) qs.set('startDate', params.startDate);
  if (params?.endDate)   qs.set('endDate',   params.endDate);
  if (params?.agencyId)  qs.set('agencyId',  params.agencyId);
  if (params?.source)    qs.set('source',    params.source);
  if (params?.dateBasis) qs.set('dateBasis', params.dateBasis);
  const query = qs.toString();
  const res = await apiFetch<BulkEmailConversionRateResult>(`/reports/bulk-email-conversion-rate${query ? `?${query}` : ''}`);
  if (!res.ok) return null;
  return res.data ?? null;
}

/**
 * GET /reports/my-conversion-rate
 * Returns the caller's own conversion rate for a date range (any authenticated user).
 */
export async function fetchMyConversionRate(params?: {
  startDate?: string;
  endDate?: string;
  source?: 'mail' | 'call';
  dateBasis?: 'activity' | 'assigned';
}): Promise<MyConversionRateResult | null> {
  const qs = new URLSearchParams();
  if (params?.startDate) qs.set('startDate', params.startDate);
  if (params?.endDate)   qs.set('endDate',   params.endDate);
  if (params?.source)    qs.set('source',    params.source);
  if (params?.dateBasis) qs.set('dateBasis', params.dateBasis);
  const query = qs.toString();
  const res = await apiFetch<MyConversionRateResult>(`/reports/my-conversion-rate${query ? `?${query}` : ''}`);
  if (!res.ok) return null;
  return res.data ?? null;
}

/**
 * GET /reports/conversion-rates
 * Fetch causal conversion rate metrics for sales associates.
 * Access: director | super_admin | operations_manager | sales_manager | recruitment_manager
 */
export async function fetchConversionRates(params?: {
  startDate?: string;
  endDate?: string;
  agencyIds?: string[];
  userIds?: string[];
  source?: 'mail' | 'call';
  dateBasis?: 'activity' | 'assigned';
}): Promise<ConversionRateUserResult[]> {
  const qs = new URLSearchParams();
  if (params?.startDate)         qs.set('startDate', params.startDate);
  if (params?.endDate)           qs.set('endDate',   params.endDate);
  if (params?.agencyIds?.length) qs.set('agencyIds', params.agencyIds.join(','));
  if (params?.userIds?.length)   qs.set('userIds',   params.userIds.join(','));
  if (params?.source)            qs.set('source',    params.source);
  if (params?.dateBasis)         qs.set('dateBasis', params.dateBasis);
  const query = qs.toString();
  const res = await apiFetch<ConversionRateUserResult[]>(`/reports/conversion-rates${query ? `?${query}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch conversion rates');
  return res.data ?? [];
}

// ---------------------------------------------------------------------------
// Remarks
// ---------------------------------------------------------------------------

export type ApiRemark = {
  id: string;
  clientId: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  content: string;
  visibility: 'only_me' | 'public' | 'shared';
  scope: 'agency' | 'global' | null;
  sharedWith: string[];
  isPinned: boolean;
  createdAt: string;
};

export async function fetchRemarks(params: {
  clientId: string;
  page?: number;
  limit?: number;
}): Promise<{ data: ApiRemark[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  const qs = new URLSearchParams({ clientId: params.clientId });
  if (params.page != null) qs.set('page', String(params.page));
  if (params.limit != null) qs.set('limit', String(params.limit));
  const res = await apiFetch<{ data: ApiRemark[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>(
    `/remarks?${qs.toString()}`,
  );
  if (!res.ok) return { data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } };
  return res.data ?? { data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } };
}

export async function createRemark(payload: {
  clientId: string;
  content: string;
  visibility: 'only_me' | 'public' | 'shared';
  scope?: 'agency' | 'global';
  sharedWith?: string[];
}): Promise<ApiRemark> {
  const res = await apiFetch<ApiRemark>('/remarks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to create remark');
  return res.data!;
}

export async function deleteRemark(id: string): Promise<void> {
  const res = await apiFetch(`/remarks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete remark');
}

/** PATCH /remarks/:id/pin — toggles pin state, persists to DB. */
export async function setRemarkPin(id: string, isPinned: boolean): Promise<void> {
  const res = await apiFetch(`/remarks/${encodeURIComponent(id)}/pin`, {
    method: 'PATCH',
    body: JSON.stringify({ isPinned }),
  });
  if (!res.ok) throw new Error('Failed to update remark pin');
}

/** POST /activity/end-session — called on logout via sendBeacon for reliability. */
export function sendActivityEndSession(sessionId: string): void {
  const url = `${API_PREFIX}/activity/end-session`;
  const token = localStorage.getItem(TOKEN_KEY) ?? '';
  const body = JSON.stringify({ sessionId });
  void fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body,
    keepalive: true, // survives page unload
  }).catch(() => {});
}

// ─── Client Notes — Custom Field Definitions & Values ───────────────────────

export type ClientNoteFieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select';
export type ClientNoteFieldVisibility = 'global' | 'agency';

export interface ClientNoteFieldDef {
  id: string;
  key: string;
  label: string;
  fieldType: ClientNoteFieldType;
  options: string[] | null;
  visibility: ClientNoteFieldVisibility;
  subCompanyId: string | null;
  subCompanyName: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClientNoteFieldValue {
  fieldDefId: string;
  value: unknown;
  updatedAt: string;
  updatedBy: { id: string; name: string };
}

export interface CreateClientNoteFieldInput {
  key: string;
  label: string;
  fieldType: ClientNoteFieldType;
  options?: string[] | null;
  visibility: ClientNoteFieldVisibility;
  subCompanyId?: string | null;
  sortOrder?: number;
}

export interface UpdateClientNoteFieldInput {
  label?: string;
  options?: string[] | null;
  sortOrder?: number;
  isActive?: boolean;
}

async function postJsonOrThrow<T>(path: string, method: string, body: unknown): Promise<T> {
  const token = getStoredToken();
  const res = await fetch(`${API_PREFIX}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'include',
  });
  if (res.status === 204) return undefined as unknown as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string')
      ? (data as { error: string }).error
      : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

/** GET /client-note-fields — list field defs configurable by the caller. */
export async function fetchClientNoteFields(): Promise<ClientNoteFieldDef[]> {
  const res = await apiFetch<{ fields: ClientNoteFieldDef[] }>('/client-note-fields');
  return res.ok ? res.data.fields : [];
}

export async function createClientNoteField(input: CreateClientNoteFieldInput): Promise<ClientNoteFieldDef> {
  return postJsonOrThrow<ClientNoteFieldDef>('/client-note-fields', 'POST', input);
}

export async function updateClientNoteField(id: string, patch: UpdateClientNoteFieldInput): Promise<ClientNoteFieldDef> {
  return postJsonOrThrow<ClientNoteFieldDef>(`/client-note-fields/${id}`, 'PATCH', patch);
}

export async function deactivateClientNoteField(id: string): Promise<void> {
  await postJsonOrThrow<void>(`/client-note-fields/${id}`, 'DELETE', undefined);
}

/** GET /clients/:id/note-fields — defs + current values for a client. */
export async function fetchClientNoteFieldsForClient(
  clientId: string,
): Promise<{ fields: ClientNoteFieldDef[]; values: Record<string, ClientNoteFieldValue> }> {
  const res = await apiFetch<{ fields: ClientNoteFieldDef[]; values: Record<string, ClientNoteFieldValue> }>(
    `/clients/${clientId}/note-fields`,
  );
  return res.ok ? res.data : { fields: [], values: {} };
}

export async function setClientNoteFieldValue(
  clientId: string,
  fieldDefId: string,
  value: unknown,
): Promise<ClientNoteFieldValue> {
  return postJsonOrThrow<ClientNoteFieldValue>(
    `/clients/${clientId}/note-fields/${fieldDefId}`,
    'PUT',
    { value },
  );
}

// ——— Notification rules & preferences ———

export type NotificationCategory =
  | 'leads'
  | 'clients'
  | 'tasks'
  | 'follow_ups'
  | 'meetings'
  | 'proposals'
  | 'approvals'
  | 'settings'
  | 'bugs';

export interface ApiNotificationRule {
  eventKey: string;
  storeAsType: string;
  category: NotificationCategory;
  label: string;
  description: string;
  defaultTitle: string;
  defaultBody: string;
  placeholders: string[];
  sampleContext: Record<string, string>;
  defaultEnabled: boolean;
  enabled: boolean;
  titleTemplate: string | null;
  bodyTemplate: string | null;
  isCustomTitle: boolean;
  isCustomBody: boolean;
}

export async function fetchNotificationRules(params?: { subCompanyId?: string }): Promise<ApiNotificationRule[]> {
  const q = params?.subCompanyId ? `?subCompanyId=${encodeURIComponent(params.subCompanyId)}` : '';
  const res = await apiFetch<{ data: ApiNotificationRule[] }>(`/settings/notification-rules${q}`);
  if (!res.ok) return [];
  return res.data.data ?? [];
}

export async function updateNotificationRules(payload: {
  subCompanyId?: string;
  rules: Array<{
    eventKey: string;
    enabled?: boolean;
    titleTemplate?: string | null;
    bodyTemplate?: string | null;
  }>;
}): Promise<ApiNotificationRule[]> {
  const res = await fetch(`${API_PREFIX}/settings/notification-rules`, {
    method: 'PUT',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to save notification rules');
  return (data as { data: ApiNotificationRule[] }).data ?? [];
}

export async function previewNotificationRule(payload: {
  eventKey: string;
  titleTemplate?: string | null;
  bodyTemplate?: string | null;
  context?: Record<string, string>;
}): Promise<{ title: string; body: string }> {
  const res = await fetch(`${API_PREFIX}/settings/notification-rules/preview`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Preview failed');
  return (data as { data: { title: string; body: string } }).data;
}

// ─── Offboarding ─────────────────────────────────────────────────────────────

export interface OffboardingDataItem {
  id: string;
  title: string;
  subtitle?: string;
}

export interface OffboardingEmployeeData {
  user: { id: string; firstName: string; lastName: string; role: string; subCompanyId: string | null };
  emails: OffboardingDataItem[];
  clients: OffboardingDataItem[];
  pipeline: OffboardingDataItem[];
  leads: OffboardingDataItem[];
  tasks: OffboardingDataItem[];
  meetings: OffboardingDataItem[];
  followUps: OffboardingDataItem[];
}

export interface OffboardingItemAssignment {
  id: string;
  toUserId: string;
}

export interface OffboardingCommitPayload {
  departingUserId: string;
  emailForwardToUserId: string;
  clients: OffboardingItemAssignment[];
  pipeline: OffboardingItemAssignment[];
  leads: OffboardingItemAssignment[];
  tasks: OffboardingItemAssignment[];
  meetings: OffboardingItemAssignment[];
  followUps: OffboardingItemAssignment[];
  fallbackUserId: string;
  deactivateUser: boolean;
}

export async function fetchOffboardingData(userId: string): Promise<OffboardingEmployeeData> {
  const res = await fetch(`${API_PREFIX}/offboarding/employee/${userId}/data`, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to load employee data');
  return data as OffboardingEmployeeData;
}

export interface OffboardingPartialCommitPayload {
  departingUserId: string;
  fallbackUserId: string;
  emailForwardToUserId?: string;
  clients?: OffboardingItemAssignment[];
  pipeline?: OffboardingItemAssignment[];
  leads?: OffboardingItemAssignment[];
  tasks?: OffboardingItemAssignment[];
  meetings?: OffboardingItemAssignment[];
  followUps?: OffboardingItemAssignment[];
}

export async function partialCommitOffboarding(payload: OffboardingPartialCommitPayload): Promise<void> {
  const res = await fetch(`${API_PREFIX}/offboarding/partial-commit`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Partial commit failed');
}

export async function commitOffboarding(payload: OffboardingCommitPayload): Promise<void> {
  const res = await fetch(`${API_PREFIX}/offboarding/commit`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as HeadersInit,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Offboarding failed');
}

export interface OffboardingHistoryCounts {
  emailCount: number;
  clientCount: number;
  pipelineCount: number;
  leadCount: number;
  taskCount: number;
  meetingCount: number;
  followUpCount: number;
}

export interface OffboardingHistoryRecipient extends OffboardingHistoryCounts {
  userId: string;
  firstName: string;
  lastName: string;
}

export interface OffboardingHistoryEntry {
  id: string;
  committedAt: string;
  admin: { id: string; firstName: string; lastName: string };
  departingUser: { id: string; firstName: string; lastName: string; role: string };
  totalCounts: OffboardingHistoryCounts;
  // present on departed entries
  recipients?: OffboardingHistoryRecipient[];
  // present on received entries
  myReceivedCounts?: OffboardingHistoryCounts;
}

export interface OffboardingHistoryResponse {
  departed: OffboardingHistoryEntry[];
  received: OffboardingHistoryEntry[];
}

export async function fetchOffboardingHistory(userId: string): Promise<OffboardingHistoryResponse> {
  const res = await fetch(`${API_PREFIX}/offboarding/history/by-user/${userId}`, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to load history');
  return data as OffboardingHistoryResponse;
}

// ─── Offboarding initiate / cancel ───────────────────────────────────────────

export async function initiateOffboarding(userId: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/offboarding/initiate/${userId}`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Could not initiate offboarding');
}

export async function cancelOffboarding(userId: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/offboarding/cancel/${userId}`, {
    method: 'POST',
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Could not cancel offboarding');
  }
}

// ─── In-progress users ───────────────────────────────────────────────────────

export interface InProgressUserItem {
  id: string;
  subCompanyId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  location: string | null;
  country: string;
  phone: string | null;
  workStartTime: string;
  workEndTime: string;
  offboardingStartedAt: string;
  managerName: string | null;
}

export async function fetchInProgressUsers(): Promise<InProgressUserItem[]> {
  const res = await fetch(`${API_PREFIX}/offboarding/in-progress`, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => []);
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to load in-progress users');
  return data as InProgressUserItem[];
}

// ─── Past offboarded users ────────────────────────────────────────────────────

export interface PastUserItem {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  location: string | null;
  country: string;
  phone: string | null;
  workStartTime: string;
  workEndTime: string;
  departedAt: string;
  adminName: string;
  startDate: string | null;
}

export async function fetchPastUsers(): Promise<PastUserItem[]> {
  const res = await fetch(`${API_PREFIX}/offboarding/past`, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  const data = await res.json().catch(() => []);
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to load past users');
  return data as PastUserItem[];
}

// ─── Multi-Agency Link API ────────────────────────────────────────────────────

export interface LinkedAccount {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  country: string;
  subCompanyId: string;
  subCompanyName: string;
  role: string;
  isActive: boolean;
  /** Effective RBAC data scope for chip labels (· Team / · Agency). */
  dataScopeLevel?: 'own' | 'team' | 'agency' | 'global';
}

export interface SwitchAgencyResponse {
  user: ApiUser;
  token: string;
  refreshToken: string;
  expiresIn: string;
  roleLabel: string;
  permissions: string[];
  dataScopeLevel?: 'own' | 'team' | 'agency' | 'global';
  activitySessionId: string;
}

export interface LinkGroup {
  groupId: string;
  members: LinkedAccount[];
}

/** GET /agency-links — all link groups (admin, requires users:link_agency) */
export async function fetchAllLinkGroups(): Promise<LinkGroup[]> {
  const res = await apiFetch<LinkGroup[]>('/agency-links');
  if (!res.ok) return [];
  return res.data ?? [];
}

/** GET /agency-links/my-accounts — linked accounts for current user (self-service) */
export async function fetchMyLinkedAccounts(): Promise<LinkedAccount[]> {
  const res = await apiFetch<LinkedAccount[]>('/agency-links/my-accounts');
  if (!res.ok) return [];
  return Array.isArray(res.data) ? res.data : [];
}

/** POST /auth/switch-agency — swap session to a linked account */
export async function switchAgencyRequest(targetUserId: string, oldRefreshToken?: string): Promise<SwitchAgencyResponse> {
  const res = await apiFetch<SwitchAgencyResponse>('/auth/switch-agency', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetUserId, refreshToken: oldRefreshToken }),
  });
  if (!res.ok) {
    const err = new Error('Failed to switch agency');
    (err as any).status = (res as { ok: false; status: number }).status;
    throw err;
  }
  return res.data;
}

/** POST /agency-links — link two users (requires users:link_agency) */
export async function linkAgencyUsers(userIdA: string, userIdB: string): Promise<void> {
  const res = await apiFetch('/agency-links', {
    method: 'POST',
    body: JSON.stringify({ userIdA, userIdB }),
  });
  if (!res.ok) throw new Error((res.data as any)?.error ?? 'Failed to link users');
}

/** DELETE /agency-links/:targetUserId — unlink a user (requires users:link_agency) */
export async function unlinkAgencyUser(targetUserId: string): Promise<void> {
  const res = await apiFetch(`/agency-links/${targetUserId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error((res.data as any)?.error ?? 'Failed to unlink user');
}

/** DELETE /agency-links/groups/:groupId — dissolve entire link group */
export async function dissolveLinkGroup(groupId: string): Promise<void> {
  const res = await apiFetch(`/agency-links/groups/${groupId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error((res.data as any)?.error ?? 'Failed to delete link group');
}

/** GET /users/for-linking?subCompanyId= — users available to link in a given agency */
export async function fetchUsersForLinking(subCompanyId: string): Promise<LinkedAccount[]> {
  const res = await apiFetch<Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
    subCompanyId: string;
    subCompanyName: string;
    isActive: boolean;
    dataScopeLevel?: 'own' | 'team' | 'agency' | 'global';
  }>>(
    `/users/for-linking?subCompanyId=${encodeURIComponent(subCompanyId)}`,
  );
  if (!res.ok) return [];
  return (res.data ?? []).map((u) => ({ ...u, userId: u.id }));
}

// ─── Signing Authorities ──────────────────────────────────────────────────

export type SigningAuthority = {
  id: string;
  name: string;
  signatureData: string;
  fontFamily: string;
  isPrimary: boolean;
  createdAt: string;
};

export async function fetchSigningAuthorities(subCompanyId?: string): Promise<SigningAuthority[]> {
  const res = await apiFetch<SigningAuthority[]>(withAgency('/settings/signing-authorities', subCompanyId));
  if (!res.ok) return [];
  return res.data ?? [];
}

export async function createSigningAuthority(
  data: { name: string; signatureData: string; fontFamily: string },
  subCompanyId?: string,
): Promise<SigningAuthority> {
  const res = await apiFetch<SigningAuthority>(withAgency('/settings/signing-authorities', subCompanyId), {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((res.data as { error?: string })?.error ?? 'Failed to create signing authority');
  return res.data!;
}

export async function updateSigningAuthority(
  id: string,
  data: { name?: string; signatureData?: string; fontFamily?: string },
  subCompanyId?: string,
): Promise<SigningAuthority> {
  const res = await apiFetch<SigningAuthority>(withAgency(`/settings/signing-authorities/${id}`, subCompanyId), {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((res.data as { error?: string })?.error ?? 'Failed to update signing authority');
  return res.data!;
}

export async function setPrimarySigningAuthority(id: string, subCompanyId?: string): Promise<void> {
  const res = await apiFetch(withAgency(`/settings/signing-authorities/${id}/primary`, subCompanyId), {
    method: 'PATCH',
  });
  if (!res.ok) throw new Error((res.data as { error?: string })?.error ?? 'Failed to set primary');
}

export async function deleteSigningAuthority(id: string, subCompanyId?: string): Promise<void> {
  const res = await apiFetch(withAgency(`/settings/signing-authorities/${id}`, subCompanyId), {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error((res.data as { error?: string })?.error ?? 'Failed to delete signing authority');
}

// ─── Employees ───────────────────────────────────────────────────────────────

export async function fetchEmployees(params?: {
  page?: number;
  limit?: number;
  search?: string;
  approvalStatus?: string;
  workStatus?: string;
  pipelineBucket?: import('./employeeTypes').EmployeePipelineBucket;
  tags?: string;
  tagAny?: string;
  excludeTags?: string;
  city?: string;
  province?: string;
  employeeType?: string;
  agencyIds?: string[];
  /** Elevated "All agencies": omit agency filter and skip viewedSubCompanyId inject. */
  allAgencies?: boolean;
  ownerIds?: string[];
  ownerExact?: boolean;
}): Promise<{ data: Employee[]; total: number; page: number; limit: number }> {
  const sp = new URLSearchParams();
  if (params?.page) sp.set('page', String(params.page));
  if (params?.limit) sp.set('limit', String(params.limit));
  if (params?.search) sp.set('search', params.search);
  if (params?.approvalStatus) sp.set('approvalStatus', params.approvalStatus);
  if (params?.workStatus) sp.set('workStatus', params.workStatus);
  if (params?.pipelineBucket) sp.set('pipelineBucket', params.pipelineBucket);
  if (params?.tags) sp.set('tags', params.tags);
  if (params?.tagAny) sp.set('tagAny', params.tagAny);
  if (params?.excludeTags) sp.set('excludeTags', params.excludeTags);
  if (params?.city) sp.set('city', params.city);
  if (params?.province) sp.set('province', params.province);
  if (params?.employeeType) sp.set('employeeType', params.employeeType);
  if (params?.agencyIds?.length) sp.set('agencyIds', params.agencyIds.join(','));
  // Skip viewedSubCompanyId inject so elevated "All agencies" matches counts/list.
  else if (params?.allAgencies) sp.set('allAgencies', '1');
  if (params?.ownerIds?.length) {
    sp.set('ownerIds', params.ownerIds.join(','));
    if (params.ownerExact) sp.set('ownerExact', '1');
  }
  const q = sp.toString();
  const res = await apiFetch<{ data: Employee[]; total: number; page: number; limit: number }>(
    `/employees${q ? `?${q}` : ''}`,
  );
  if (!res.ok) throw new Error((res as { error?: string }).error ?? 'Failed to load employees');
  return res.data;
}

export async function fetchEmployeeCounts(params?: {
  agencyIds?: string[];
  /** Elevated "All agencies": omit agency filter and skip viewedSubCompanyId inject. */
  allAgencies?: boolean;
  ownerIds?: string[];
  ownerExact?: boolean;
}): Promise<EmployeeCounts> {
  const sp = new URLSearchParams();
  if (params?.agencyIds?.length) sp.set('agencyIds', params.agencyIds.join(','));
  else if (params?.allAgencies) sp.set('allAgencies', '1');
  if (params?.ownerIds?.length) {
    sp.set('ownerIds', params.ownerIds.join(','));
    if (params.ownerExact) sp.set('ownerExact', '1');
  }
  const q = sp.toString();
  const res = await apiFetch<{ data: EmployeeCounts }>(`/employees/counts${q ? `?${q}` : ''}`);
  if (!res.ok) throw new Error((res as { error?: string }).error ?? 'Failed to load employee counts');
  return res.data.data;
}

export async function submitEmployeeForApproval(id: string): Promise<Employee> {
  const res = await apiFetch<{ data: Employee }>(
    `/employees/${encodeURIComponent(id)}/submit-for-approval`,
    { method: 'POST' },
  );
  if (!res.ok) throw new Error((res as { error?: string }).error ?? 'Failed to submit for approval');
  return res.data.data;
}

export async function fetchEmployeeAssignments(employeeId: string): Promise<import('./employeeTypes').EmployeeAssignment[]> {
  const res = await apiFetch<{ data: import('./employeeTypes').EmployeeAssignment[] }>(
    `/employees/${encodeURIComponent(employeeId)}/assignments`,
  );
  if (!res.ok) throw new Error((res as { error?: string }).error ?? 'Failed to load assignments');
  return res.data.data;
}

export type CreateEmployeeAssignmentResult = {
  assignment: import('./employeeTypes').EmployeeAssignment;
  clientTraining?: {
    started: boolean;
    emailSent: boolean;
    warning?: string;
  };
  assignmentEmail?: {
    sent: boolean;
    warning?: string;
  };
};

export async function createEmployeeAssignmentRequest(
  employeeId: string,
  body: {
    targetType: 'client' | 'job';
    clientId?: string | null;
    activeClientId?: string | null;
    jobId?: string | null;
    /** Job targets only: request a backup-pool slot instead of primary. */
    isBackup?: boolean;
    /** User confirmed placing despite missing required skills. */
    allowSkillMismatch?: boolean;
  } & import('./employeeTypes').EmployeeAssignmentDetailsInput,
): Promise<CreateEmployeeAssignmentResult> {
  const res = await apiFetch<{
    data: import('./employeeTypes').EmployeeAssignment;
    clientTraining?: CreateEmployeeAssignmentResult['clientTraining'];
    assignmentEmail?: CreateEmployeeAssignmentResult['assignmentEmail'];
  }>(`/employees/${encodeURIComponent(employeeId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((res as { error?: string }).error ?? 'Failed to create assignment');
  return {
    assignment: res.data.data,
    clientTraining: res.data.clientTraining,
    assignmentEmail: res.data.assignmentEmail,
  };
}

export async function sendAssignmentTrainingMessage(
  employeeId: string,
  assignmentId: string,
  message: string,
  channel: 'email' | 'sms' = 'email',
): Promise<import('./employeeTypes').EmployeeAssignment> {
  const res = await apiFetch<{ data: import('./employeeTypes').EmployeeAssignment }>(
    `/employees/${encodeURIComponent(employeeId)}/assignments/${encodeURIComponent(assignmentId)}/training/send`,
    { method: 'POST', body: JSON.stringify({ message, channel }) },
  );
  if (!res.ok) throw new Error((res as { error?: string }).error ?? 'Failed to send training message');
  return res.data.data;
}

export async function uploadAssignmentTrainingCertificate(
  employeeId: string,
  assignmentId: string,
  body: { name?: string; fileBase64: string; mimeType?: string },
): Promise<import('./employeeTypes').EmployeeAssignment> {
  const res = await apiFetch<{ data: import('./employeeTypes').EmployeeAssignment }>(
    `/employees/${encodeURIComponent(employeeId)}/assignments/${encodeURIComponent(assignmentId)}/training/certificate`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  if (!res.ok) {
    throw new Error((res as { error?: string }).error ?? 'Failed to upload training certificate');
  }
  return res.data.data;
}

export async function fetchEmployeeTrainings(
  employeeId: string,
): Promise<import('./employeeTypes').EmployeeTraining[]> {
  const res = await apiFetch<{ data: import('./employeeTypes').EmployeeTraining[] }>(
    `/employees/${encodeURIComponent(employeeId)}/trainings`,
  );
  if (!res.ok) throw new Error((res as { error?: string }).error ?? 'Failed to load trainings');
  return res.data.data;
}

/** Create missing default trainings (Ontario 4 Steps + WHMIS) and return the list. */
export async function ensureEmployeeDefaultTrainings(
  employeeId: string,
): Promise<import('./employeeTypes').EmployeeTraining[]> {
  const res = await apiFetch<{ data: import('./employeeTypes').EmployeeTraining[] }>(
    `/employees/${encodeURIComponent(employeeId)}/trainings/ensure-defaults`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  if (!res.ok) {
    throw new Error((res as { error?: string }).error ?? 'Failed to ensure default trainings');
  }
  return res.data.data;
}

export async function sendEmployeeTrainingMessage(
  employeeId: string,
  url: string,
  channel: 'email' = 'email',
  title?: string | null,
): Promise<import('./employeeTypes').EmployeeTraining> {
  const res = await apiFetch<{ data: import('./employeeTypes').EmployeeTraining }>(
    `/employees/${encodeURIComponent(employeeId)}/trainings/send`,
    { method: 'POST', body: JSON.stringify({ url, channel, title: title ?? undefined }) },
  );
  if (!res.ok) throw new Error((res as { error?: string }).error ?? 'Failed to send training URL');
  return res.data.data;
}

export async function resendEmployeeTraining(
  employeeId: string,
  trainingId: string,
): Promise<import('./employeeTypes').EmployeeTraining> {
  const res = await apiFetch<{ data: import('./employeeTypes').EmployeeTraining }>(
    `/employees/${encodeURIComponent(employeeId)}/trainings/${encodeURIComponent(trainingId)}/resend`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  if (!res.ok) throw new Error((res as { error?: string }).error ?? 'Failed to resend training email');
  return res.data.data;
}

export async function uploadEmployeeTrainingCertificate(
  employeeId: string,
  trainingId: string,
  body: { name?: string; fileBase64: string; mimeType?: string },
): Promise<import('./employeeTypes').EmployeeTraining> {
  const res = await apiFetch<{ data: import('./employeeTypes').EmployeeTraining }>(
    `/employees/${encodeURIComponent(employeeId)}/trainings/${encodeURIComponent(trainingId)}/certificate`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  if (!res.ok) {
    throw new Error((res as { error?: string }).error ?? 'Failed to upload training certificate');
  }
  return res.data.data;
}

export async function fetchEmployee(id: string): Promise<Employee> {
  const res = await apiFetch<{ data: Employee }>(`/employees/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error((res as { error?: string }).error ?? 'Failed to load employee');
  return res.data.data;
}

export async function createEmployee(payload: CreateEmployeePayload): Promise<Employee> {
  const res = await apiFetch<{ data: Employee }>('/employees', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((res as { error?: string }).error ?? 'Failed to create employee');
  return res.data.data;
}

export async function updateEmployee(
  id: string,
  payload: Partial<CreateEmployeePayload> & {
    workStatus?: string | null;
    tags?: string[];
    position?: string | null;
    department?: string | null;
    hourlyRate?: number | null;
  },
): Promise<Employee> {
  const res = await apiFetch<{ data: Employee }>(`/employees/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((res as { error?: string }).error ?? 'Failed to update employee');
  return res.data.data;
}

export async function deleteEmployeeDocument(employeeId: string, docId: string): Promise<void> {
  const res = await apiFetch<unknown>(
    `/employees/${encodeURIComponent(employeeId)}/documents/${encodeURIComponent(docId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) throw new Error((res as { error?: string }).error ?? 'Failed to delete document');
}

export async function approveEmployee(id: string): Promise<Employee> {
  const res = await apiFetch<{ data: Employee }>(`/employees/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error((res as { error?: string }).error ?? 'Failed to approve employee');
  return res.data.data;
}

export async function rejectEmployee(id: string, reason: string): Promise<Employee> {
  const res = await apiFetch<{ data: Employee }>(`/employees/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error((res as { error?: string }).error ?? 'Failed to reject employee');
  return res.data.data;
}

export async function addEmployeeNote(id: string, content: string): Promise<Employee> {
  const res = await apiFetch<{ data: Employee }>(`/employees/${encodeURIComponent(id)}/notes`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error((res as { error?: string }).error ?? 'Failed to add note');
  return res.data.data;
}

export async function uploadEmployeeDocument(
  employeeId: string,
  payload: {
    name: string;
    fileBase64: string;
    mimeType?: string;
    type?: string;
    expiryDate?: string | null;
  },
): Promise<EmployeeDocument> {
  const res = await apiFetch<{ data: EmployeeDocument }>(
    `/employees/${encodeURIComponent(employeeId)}/documents`,
    {
      method: 'POST',
      body: JSON.stringify({
        name: payload.name,
        fileBase64: payload.fileBase64,
        mimeType: payload.mimeType,
        type: payload.type ?? 'resume',
        ...(payload.expiryDate !== undefined ? { expiryDate: payload.expiryDate || null } : {}),
      }),
    },
  );
  if (!res.ok) throw new Error((res as { error?: string }).error ?? 'Failed to upload document');
  return res.data.data;
}

export async function updateEmployeeDocumentExpiry(
  employeeId: string,
  docId: string,
  expiryDate: string | null,
): Promise<EmployeeDocument> {
  const res = await apiFetch<{ data: EmployeeDocument }>(
    `/employees/${encodeURIComponent(employeeId)}/documents/${encodeURIComponent(docId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ expiryDate }),
    },
  );
  if (!res.ok) throw new Error((res as { error?: string }).error ?? 'Failed to update document expiry');
  return res.data.data;
}

export type ExpiringEmployeeDocument = {
  documentId: string;
  documentName: string;
  documentType: string;
  expiryDate: string;
  status: 'expired' | 'expiring';
  daysUntil: number;
  employeeId: string;
  employeeFirstName: string;
  employeeLastName: string;
};

export type ExpiringEmployeeDocumentsResponse = {
  data: ExpiringEmployeeDocument[];
  total: number;
  page: number;
  limit: number;
  expiredCount: number;
  expiringCount: number;
};

export async function fetchExpiringEmployeeDocuments(params?: {
  withinDays?: number;
  page?: number;
  limit?: number;
}): Promise<ExpiringEmployeeDocumentsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.withinDays != null) searchParams.set('withinDays', String(params.withinDays));
  if (params?.page != null) searchParams.set('page', String(params.page));
  if (params?.limit != null) searchParams.set('limit', String(params.limit));
  const qs = searchParams.toString();
  const res = await apiFetch<ExpiringEmployeeDocumentsResponse>(
    `/employees/documents/expiring${qs ? `?${qs}` : ''}`,
  );
  if (!res.ok) {
    throw new Error((res as { error?: string }).error ?? 'Failed to load expiring documents');
  }
  return res.data;
}

export function getEmployeeDocumentDownloadUrl(employeeId: string, docId: string): string {
  return `${API_PREFIX}/employees/${encodeURIComponent(employeeId)}/documents/${encodeURIComponent(docId)}/download`;
}

/** POST /employees/:id/assignments/:assignmentId/end — end a placement with rating + reason. */
export async function endEmployeeAssignment(
  employeeId: string,
  assignmentId: string,
  body: {
    endReason: import('./employeeTypes').PlacementEndReason;
    endNotes?: string | null;
    rating: number;
  },
): Promise<void> {
  const res = await apiFetch<{ success: boolean }>(
    `/employees/${encodeURIComponent(employeeId)}/assignments/${encodeURIComponent(assignmentId)}/end`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  if (!res.ok) throw new Error((res as { error?: string }).error ?? 'Failed to end assignment');
}

// ─── Employee onboarding agreement (PandaDoc) ───────────────────────────────

export type EmployeeOnboardingStatus = {
  employeeId: string;
  pandaDocId: string | null;
  status: string | null;
  updatedAt: string | null;
  completed: boolean;
  agreementDocument?: { id: string; name: string; uploadedAt: string } | null;
  /** Present on POST /onboarding/send — whether the training email was delivered. */
  trainingEmailed?: boolean;
  /** Present on POST /onboarding/send when training email failed or was skipped. */
  trainingError?: string | null;
};

/** POST /employees/:id/onboarding/send — send the onboarding agreement package. */
export async function sendEmployeeOnboarding(employeeId: string): Promise<EmployeeOnboardingStatus> {
  const res = await apiFetch<{ data: EmployeeOnboardingStatus }>(
    `/employees/${encodeURIComponent(employeeId)}/onboarding/send`,
    { method: 'POST' },
  );
  if (!res.ok) {
    throw new Error((res as { error?: string }).error ?? 'Failed to send onboarding agreement');
  }
  return res.data.data;
}

/** GET /employees/:id/onboarding/status — current onboarding agreement status. */
export async function fetchEmployeeOnboardingStatus(
  employeeId: string,
): Promise<EmployeeOnboardingStatus> {
  const res = await apiFetch<{ data: EmployeeOnboardingStatus }>(
    `/employees/${encodeURIComponent(employeeId)}/onboarding/status`,
  );
  if (!res.ok) {
    throw new Error((res as { error?: string }).error ?? 'Failed to load onboarding status');
  }
  return res.data.data;
}

/** POST /employees/:id/onboarding/sync — pull the latest signature status from PandaDoc. */
export async function syncEmployeeOnboarding(employeeId: string): Promise<EmployeeOnboardingStatus> {
  const res = await apiFetch<{ data: EmployeeOnboardingStatus }>(
    `/employees/${encodeURIComponent(employeeId)}/onboarding/sync`,
    { method: 'POST' },
  );
  if (!res.ok) {
    throw new Error((res as { error?: string }).error ?? 'Failed to sync onboarding agreement');
  }
  return res.data.data;
}


// ── Notices ────────────────────────────────────────────────────────────────

export async function fetchNotices() {
  const res = await apiFetch<{ data: any[] }>('/notices');
  if (!res.ok) throw new Error('Failed to fetch notices');
  return res.data.data;
}

export async function createNotice(payload: {
  title: string;
  message: string;
  type: string;
  pinned: boolean;
  expiresAt: string;
}) {
  const res = await apiFetch<{ data: any }>('/notices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((res as any).data?.error ?? (res as any).error ?? 'Failed to create notice');
  return res.data.data;
}

export async function updateNotice(id: string, payload: Partial<{
  title: string;
  message: string;
  type: string;
  pinned: boolean;
  expiresAt: string;
}>) {
  const res = await apiFetch<{ data: any }>(`/notices/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((res as any).data?.error ?? (res as any).error ?? 'Failed to update notice');
  return res.data.data;
}

export async function deleteNotice(id: string) {
  const res = await apiFetch<{ success: boolean }>(`/notices/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete notice');
}
