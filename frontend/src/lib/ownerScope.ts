/**
 * Owner scope for agency → hierarchy drill-down pages.
 * URL params: agencyId, leaderId, managerId, userId.
 *
 * Unselected (no All / person chip) → current user's records only.
 * Explicit `all` on a row (param present in URL) = everyone in that tier.
 */
export interface OwnerScopeParams {
  /** Multi-agency elevated (All Agencies capable). Not the same as hierarchy viewer / SAL. */
  isElevated: boolean;
  isPureManager: boolean;
  /** Company director / single-agency lead — home agency forced, unselected = own. */
  isSingleAgencyLead?: boolean;
  /** Elevated with a single assigned agency — home forced, unselected = own. */
  isAgencyScopedElevated?: boolean;
  onlyMe: boolean;
  selectedAgencyId: string;
  selectedLeaderId?: string;
  selectedManagerId: string;
  selectedUserId: string;
  currentUserId: string | undefined;
  getAssociatesForManager: (managerId: string) => { id: string }[];
  getUsersForLeader?: (leaderId: string) => { id: string }[];
  /** Returns only the manager-tier users under a leader (no associates). Used for "All Managers" row. */
  getManagersForLeader?: (leaderId: string) => { id: string }[];
  /** All managers in the current agency scope. Used when "All Managers" is selected with no specific leader. */
  allManagers?: { id: string }[];
  /** True when `leaderId` is explicitly present in the URL (not defaulted). */
  leaderParamInUrl?: boolean;
  /** True when `managerId` is explicitly present in the URL (not defaulted). */
  managerParamInUrl?: boolean;
  /** True when `userId` is explicitly present in the URL (not defaulted). */
  userParamInUrl?: boolean;
}

function isSelfId(selected: string, currentUserId?: string): boolean {
  return selected === 'me' || (!!currentUserId && selected === currentUserId);
}

/** Stable key for query caches when hierarchy scope changes. */
export function buildScopeKey(params: {
  selectedAgencyId: string;
  selectedLeaderId: string;
  selectedManagerId: string;
  selectedUserId: string;
  onlyMe: boolean;
}): string {
  return [
    params.selectedAgencyId,
    params.selectedLeaderId,
    params.selectedManagerId,
    params.selectedUserId,
    params.onlyMe ? '1' : '0',
  ].join('|');
}

/**
 * No hierarchy All/person chip selected, and not viewing All Agencies.
 * → logged-in user's records only.
 */
export function isUnselectedOwnScope(params: {
  isElevated: boolean;
  isPureManager: boolean;
  isSingleAgencyLead?: boolean;
  isAgencyScopedElevated?: boolean;
  selectedAgencyId: string;
  leaderParamInUrl?: boolean;
  managerParamInUrl?: boolean;
  userParamInUrl?: boolean;
}): boolean {
  if (params.leaderParamInUrl || params.managerParamInUrl || params.userParamInUrl) {
    return false;
  }
  if (params.selectedAgencyId === 'all') return false;

  // Home-forced roles: concrete agency UUID is home, not a multi-agency drill.
  if (params.isPureManager || params.isSingleAgencyLead || params.isAgencyScopedElevated) {
    return true;
  }

  // Multi-agency elevated: a concrete agency chip = full that agency (not own-only).
  if (
    params.isElevated &&
    params.selectedAgencyId &&
    params.selectedAgencyId !== 'me'
  ) {
    return false;
  }

  // omit / me / empty → own records only
  return true;
}

/**
 * All Agencies + no narrowing hierarchy drill (explicit All Authorities or default under all).
 */
export function isAllAgenciesFullScope({
  selectedLeaderId = 'all',
  selectedManagerId,
  selectedUserId,
  currentUserId,
  leaderParamInUrl = false,
  managerParamInUrl = false,
  userParamInUrl = false,
}: Pick<
  OwnerScopeParams,
  | 'selectedLeaderId'
  | 'selectedManagerId'
  | 'selectedUserId'
  | 'currentUserId'
  | 'leaderParamInUrl'
  | 'managerParamInUrl'
  | 'userParamInUrl'
>): boolean {
  if (managerParamInUrl || userParamInUrl) return false;
  if (selectedUserId !== 'all' && !isSelfId(selectedUserId, currentUserId)) return false;
  if (selectedManagerId !== 'all' && !isSelfId(selectedManagerId, currentUserId)) return false;

  if (leaderParamInUrl) {
    return selectedLeaderId === 'all';
  }

  // No leader param under All Agencies → full org (own-default uses agencyId omit/me, not all).
  return selectedLeaderId === 'all' || isSelfId(selectedLeaderId, currentUserId);
}

function resolveAllAgenciesOwnerIds(
  params: OwnerScopeParams,
): string[] | undefined {
  const {
    onlyMe,
    selectedLeaderId = 'all',
    selectedManagerId,
    selectedUserId,
    currentUserId,
    getAssociatesForManager,
    getUsersForLeader,
    getManagersForLeader,
    allManagers,
    leaderParamInUrl,
    managerParamInUrl,
    userParamInUrl,
  } = params;

  if (
    isAllAgenciesFullScope({
      selectedLeaderId,
      selectedManagerId,
      selectedUserId,
      currentUserId,
      leaderParamInUrl,
      managerParamInUrl,
      userParamInUrl,
    })
  ) {
    return undefined;
  }

  if (!isSelfId(selectedUserId, currentUserId) && selectedUserId !== 'all') {
    return [selectedUserId];
  }

  if (userParamInUrl && selectedUserId === 'all') {
    if (!isSelfId(selectedManagerId, currentUserId) && selectedManagerId !== 'all') {
      // "All Team" under a specific manager → associates only, manager excluded
      return getAssociatesForManager(selectedManagerId).map((u) => u.id);
    }
    if (selectedLeaderId !== 'all' && !isSelfId(selectedLeaderId, currentUserId) && getUsersForLeader) {
      return getUsersForLeader(selectedLeaderId).map((u) => u.id);
    }
    return undefined;
  }

  if (!isSelfId(selectedManagerId, currentUserId) && selectedManagerId !== 'all') {
    return [selectedManagerId];
  }

  if (managerParamInUrl && selectedManagerId === 'all') {
    if (selectedLeaderId !== 'all' && !isSelfId(selectedLeaderId, currentUserId)) {
      const getter = getManagersForLeader ?? getUsersForLeader;
      if (getter) return getter(selectedLeaderId).map((u) => u.id);
    }
    if (allManagers && allManagers.length > 0) return allManagers.map((u) => u.id);
    return undefined;
  }

  if (onlyMe || isSelfId(selectedLeaderId, currentUserId)) {
    return currentUserId ? [currentUserId] : undefined;
  }

  if (selectedLeaderId !== 'all') {
    return [selectedLeaderId];
  }

  return undefined;
}

/**
 * Returns the `ownerIds` array to send to the API, or `undefined` for full scope in tier.
 */
export function resolveOwnerIds(params: OwnerScopeParams): string[] | undefined {
  const {
    isElevated,
    isPureManager,
    isSingleAgencyLead,
    isAgencyScopedElevated,
    onlyMe,
    selectedAgencyId,
    selectedLeaderId = 'all',
    selectedManagerId,
    selectedUserId,
    currentUserId,
    getAssociatesForManager,
    getUsersForLeader,
    getManagersForLeader,
    allManagers,
    leaderParamInUrl,
    managerParamInUrl,
    userParamInUrl,
  } = params;

  if (
    isUnselectedOwnScope({
      isElevated,
      isPureManager,
      isSingleAgencyLead,
      isAgencyScopedElevated,
      selectedAgencyId,
      leaderParamInUrl,
      managerParamInUrl,
      userParamInUrl,
    })
  ) {
    return currentUserId ? [currentUserId] : undefined;
  }

  // When no specific agency is drilled into (all, deselected/me, or empty) and a
  // hierarchy chip IS present, resolve cross-agency owner IDs instead of falling
  // through to `return undefined` at the bottom of the elevated branch.
  // Note: the agencyId='me'/'' + NO-chip case is already caught by isUnselectedOwnScope
  // above and never reaches here.
  if (isElevated && (selectedAgencyId === 'all' || selectedAgencyId === 'me' || !selectedAgencyId)) {
    return resolveAllAgenciesOwnerIds(params);
  }

  if (onlyMe) {
    return currentUserId ? [currentUserId] : undefined;
  }

  if (isPureManager) {
    if (!isSelfId(selectedUserId, currentUserId) && selectedUserId !== 'all') {
      return [selectedUserId];
    }
    const reportIds = currentUserId
      ? getAssociatesForManager(currentUserId).map((u) => u.id)
      : [];
    // "All Team" explicitly selected (userId=all in URL) → exclude manager's own records
    if (userParamInUrl && selectedUserId === 'all') {
      return reportIds.length > 0 ? reportIds : [];
    }
    return currentUserId ? [currentUserId] : undefined;
  }

  const agencyDrilled = selectedAgencyId !== 'all' && selectedAgencyId !== 'me' && !!selectedAgencyId;

  if (isElevated && agencyDrilled && !isSelfId(selectedUserId, currentUserId) && selectedUserId !== 'all') {
    return [selectedUserId];
  }

  if (
    isElevated &&
    agencyDrilled &&
    userParamInUrl &&
    selectedUserId === 'all'
  ) {
    if (!isSelfId(selectedManagerId, currentUserId) && selectedManagerId !== 'all') {
      // "All Team" under a specific manager → associates only, manager excluded
      return getAssociatesForManager(selectedManagerId).map((u) => u.id);
    }
    if (
      selectedLeaderId !== 'all' &&
      !isSelfId(selectedLeaderId, currentUserId) &&
      getUsersForLeader
    ) {
      return getUsersForLeader(selectedLeaderId).map((u) => u.id);
    }
    return undefined;
  }

  if (
    isElevated &&
    agencyDrilled &&
    !isSelfId(selectedManagerId, currentUserId) &&
    selectedManagerId !== 'all'
  ) {
    return [selectedManagerId];
  }

  if (
    isElevated &&
    agencyDrilled &&
    managerParamInUrl &&
    selectedManagerId === 'all'
  ) {
    if (
      selectedLeaderId !== 'all' &&
      !isSelfId(selectedLeaderId, currentUserId)
    ) {
      const getter = getManagersForLeader ?? getUsersForLeader;
      if (getter) return getter(selectedLeaderId).map((u) => u.id);
    }
    if (allManagers && allManagers.length > 0) return allManagers.map((u) => u.id);
    return undefined;
  }

  if (
    isElevated &&
    agencyDrilled &&
    isSelfId(selectedLeaderId, currentUserId)
  ) {
    return currentUserId ? [currentUserId] : undefined;
  }

  if (
    isElevated &&
    agencyDrilled &&
    selectedLeaderId !== 'all'
  ) {
    return [selectedLeaderId];
  }

  // Remaining elevated cases (e.g. concrete agency, no hierarchy chips) = full agency scope.
  // Own-default (omit/me) already returned above via isUnselectedOwnScope.
  if (isElevated) return undefined;

  if (!isPureManager && agencyDrilled) {
    if (!isSelfId(selectedUserId, currentUserId) && selectedUserId !== 'all') {
      return [selectedUserId];
    }
    if (userParamInUrl && selectedUserId === 'all') {
      if (!isSelfId(selectedManagerId, currentUserId) && selectedManagerId !== 'all') {
        return [
          selectedManagerId,
          ...getAssociatesForManager(selectedManagerId).map((u) => u.id),
        ];
      }
      if (isSelfId(selectedManagerId, currentUserId) && getUsersForLeader && currentUserId) {
        return getUsersForLeader(currentUserId).map((u) => u.id);
      }
      return undefined;
    }
    if (!isSelfId(selectedManagerId, currentUserId) && selectedManagerId !== 'all') {
      return [selectedManagerId];
    }
    if (managerParamInUrl && selectedManagerId === 'all') {
      return undefined;
    }
    if (
      isSelfId(selectedManagerId, currentUserId) &&
      selectedUserId === 'all' &&
      getUsersForLeader &&
      currentUserId
    ) {
      return getUsersForLeader(currentUserId).map((u) => u.id);
    }
    return currentUserId ? [currentUserId] : undefined;
  }

  return currentUserId ? [currentUserId] : undefined;
}

/** True when viewing only the logged-in user's records (unselected default or self chip). */
export function isViewingOwnDataOnly(params: {
  isSingleAgencyLead: boolean;
  isPureManager: boolean;
  isAgencyScopedElevated?: boolean;
  isElevated?: boolean;
  selectedAgencyId?: string;
  selectedLeaderId?: string;
  selectedManagerId: string;
  selectedUserId: string;
  viewerUserId?: string;
  leaderParamInUrl?: boolean;
  managerParamInUrl?: boolean;
  userParamInUrl?: boolean;
}): boolean {
  if (
    isUnselectedOwnScope({
      isElevated: !!params.isElevated,
      isPureManager: params.isPureManager,
      isSingleAgencyLead: params.isSingleAgencyLead,
      isAgencyScopedElevated: params.isAgencyScopedElevated,
      selectedAgencyId: params.selectedAgencyId ?? '',
      leaderParamInUrl: params.leaderParamInUrl,
      managerParamInUrl: params.managerParamInUrl,
      userParamInUrl: params.userParamInUrl,
    })
  ) {
    return true;
  }

  const selfId = params.viewerUserId;

  if (params.isPureManager) {
    return isSelfId(params.selectedUserId, selfId);
  }

  if (params.isSingleAgencyLead) {
    if (!isSelfId(params.selectedUserId, selfId) && params.selectedUserId !== 'all') {
      return false;
    }
    if (params.selectedManagerId === 'all') return false;
    if (!isSelfId(params.selectedManagerId, selfId)) return false;
    return isSelfId(params.selectedUserId, selfId);
  }

  if (params.isAgencyScopedElevated && isSelfId(params.selectedLeaderId ?? 'all', selfId)) {
    if (params.selectedManagerId !== 'all' && !isSelfId(params.selectedManagerId, selfId)) return false;
    if (params.selectedUserId !== 'all' && !isSelfId(params.selectedUserId, selfId)) return false;
    return true;
  }

  return false;
}

/** @deprecated Use isViewingOwnDataOnly */
export function isUserTierOnlyMe(params: {
  isSingleAgencyLead: boolean;
  isPureManager: boolean;
  selectedAgencyId: string;
  selectedLeaderId: string;
  selectedManagerId: string;
  selectedUserId: string;
  viewerUserId?: string;
}): boolean {
  return isViewingOwnDataOnly(params);
}
