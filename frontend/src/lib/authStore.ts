/**
 * Auth state: token, refresh token, and user from API.
 * Persists tokens in localStorage; syncs currentUser with main store on login/load.
 */

import { create } from 'zustand';
import type { User, SubCompany } from './types';
import type { ApiUser } from './api';
import { login as apiLogin, logout as apiLogout, fetchMe, setMyPresence } from './api';
import { closeSocket } from './socket';
import { clearClientSessionData, TOKEN_KEY, REFRESH_KEY } from './sessionCache';
import { clearApprovalMetadataCache } from './approvalMetadataStore';
import { prefetchApprovalMetadata } from '@/hooks/useApprovalMetadata';
import { isAgencyIndependentRole } from './agencyIndependentRoles';

function mapApiUserToUser(api: ApiUser): User {
  return {
    id: api.id,
    email: api.email,
    firstName: api.firstName,
    lastName: api.lastName,
    name: `${api.firstName} ${api.lastName}`.trim(),
    phone: api.phone ?? '',
    country: api.country as 'Canada' | 'Pakistan',
    userType: api.userType as User['userType'],
    isActive: api.isActive,
    role: api.role as User['role'],
    subCompanyId: api.subCompanyId,
    locationId: api.locationId ?? '',
    reportingManagerIds: api.reportingManagerIds ?? [],
    googleCalendarConnected: (api as any).googleCalendarConnected ?? false,
    googleConnectedEmail: (api as any).googleConnectedEmail ?? null,
    workStartTime: api.workStartTime,
    workEndTime: api.workEndTime,
  };
}

export type DataScopeLevel = 'own' | 'team' | 'agency' | 'global';

interface AuthState {
  token: string | null;
  user: User | null;
  permissions: string[];
  dataScopeLevel: DataScopeLevel;
  roleLabel: string | null;
  hydrated: boolean;
  login: (email: string, password: string) => Promise<Awaited<ReturnType<typeof apiLogin>>>;
  logout: () => Promise<void>;
  loadSession: (setCurrentUser: (user: User) => void, setCurrentSubCompany?: (sub: SubCompany) => void) => Promise<boolean>;
  setUser: (user: User | null) => void;
  setPermissions: (permissions: string[]) => void;
  setDataScopeLevel: (level: DataScopeLevel) => void;
  /** Reload permissions + scope from GET /auth/me (e.g. after Settings → Roles save). */
  refreshPermissionsFromServer: () => Promise<void>;
  hydrate: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  permissions: [],
  dataScopeLevel: 'own',
  roleLabel: null,
  hydrated: false,

  hydrate: () => {
    const token = localStorage.getItem(TOKEN_KEY);
    set({ token: token || null, hydrated: true });
  },

  login: async (email: string, password: string) => {
    const data = await apiLogin(email, password);
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(REFRESH_KEY, data.refreshToken);
    const user = mapApiUserToUser(data.user);
    set({
      token: data.token,
      user,
      permissions: data.permissions ?? [],
      dataScopeLevel: (data.dataScopeLevel as DataScopeLevel) ?? 'own',
      roleLabel: data.roleLabel ?? null,
    });
    void prefetchApprovalMetadata();
    return data;
  },

  logout: async () => {
    const userId = get().user?.id;
    await setMyPresence('offline').catch(() => undefined);
    closeSocket();
    await apiLogout();
    clearClientSessionData({ userId });
    clearApprovalMetadataCache();
    set({ token: null, user: null, permissions: [], dataScopeLevel: 'own', roleLabel: null });
  },

  loadSession: async (setCurrentUser: (user: User) => void, setCurrentSubCompany?: (sub: SubCompany) => void) => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      set({ hydrated: true });
      return false;
    }
    const me = await fetchMe();
    if (!me) {
      set({ token: null, user: null, permissions: [], dataScopeLevel: 'own', roleLabel: null, hydrated: true });
      return false;
    }
    const user = mapApiUserToUser(me);
    const permissions = me.permissions ?? [];
    set({
      user,
      permissions,
      dataScopeLevel: (me.dataScopeLevel as DataScopeLevel) ?? 'own',
      roleLabel: me.roleLabel ?? null,
      hydrated: true,
    });
    setCurrentUser(user);
    if (setCurrentSubCompany && me.subCompany && !isAgencyIndependentRole(me.role)) {
      const sc = me.subCompany;
      setCurrentSubCompany({
        id: sc.id,
        name: sc.name,
        mainOrgId: sc.mainOrgId,
        appProjectName: sc.appProjectName ?? null,
        logoUrl: sc.logoUrl ?? null,
        agencyLogoUrl: sc.agencyLogoUrl ?? null,
        agencyEmail: sc.agencyEmail ?? null,
        agencyPhone: sc.agencyPhone ?? null,
        emailFooterText: sc.emailFooterText ?? null,
        emailTagline: sc.emailTagline ?? null,
        emailSendAsDomain: sc.emailSendAsDomain ?? null,
      });
    }
    void prefetchApprovalMetadata();
    return true;
  },

  setUser: (user) => set({ user }),
  setPermissions: (permissions) => set({ permissions }),
  setDataScopeLevel: (dataScopeLevel) => set({ dataScopeLevel }),

  refreshPermissionsFromServer: async () => {
    if (!localStorage.getItem(TOKEN_KEY)) return;
    const me = await fetchMe();
    if (!me) return;
    set({
      permissions: me.permissions ?? [],
      dataScopeLevel: (me.dataScopeLevel as DataScopeLevel) ?? 'own',
      roleLabel: me.roleLabel ?? null,
    });
  },
}));

export function getAuthUser(): User | null {
  return useAuthStore.getState().user;
}

export function setAuthUser(user: User | null): void {
  useAuthStore.setState({ user });
}

export function isAuthenticated(): boolean {
  return !!localStorage.getItem(TOKEN_KEY);
}
