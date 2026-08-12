/**
 * Resolve ownerIds for list queries when linked filters and/or act-as hierarchy drill apply.
 *
 * Unselected / own-default → logged-in user records only (ownerExact).
 * All Team under a manager: expand / reports — manager is not listed in the team chip row.
 */
import { isUnselectedOwnScope, resolveOwnerIds } from '@/lib/ownerScope';
import type { useScopeFilter } from '@/hooks/useElevatedScopeFilter';

/** Causes the API to return 0 results cleanly when scope resolves to nobody. */
export const EMPTY_OWNER_SENTINEL = '00000000-0000-0000-0000-000000000000';

export type LinkedOwnerResolveResult = {
  ownerIds: string[] | undefined;
  /** true → API must not expand team/agency (manager = own records only). */
  ownerExact: boolean;
};

export function resolveLinkedAwareOwnerIds(opts: {
  linkedUserIdsRaw: string | undefined;
  actAsActive: boolean;
  currentUserId: string | undefined;
  scopeFilter: ReturnType<typeof useScopeFilter>;
}): LinkedOwnerResolveResult {
  const { linkedUserIdsRaw, actAsActive, currentUserId, scopeFilter: f } = opts;

  const linkedIds = linkedUserIdsRaw
    ? linkedUserIdsRaw.split(',').filter(Boolean)
    : [];

  // Act-as + hierarchy drill: narrow inside the target's world.
  if (actAsActive && linkedIds.length === 1) {
    const uid = f.selectedUserId;
    if (uid && uid !== 'all' && uid !== 'me' && f.userParamInUrl) {
      // Specific teammate — exact that person.
      return { ownerIds: [uid], ownerExact: true };
    }

    const mid = f.selectedManagerId;
    if (mid && mid !== 'all' && mid !== 'me' && f.managerParamInUrl && !f.userParamInUrl) {
      return { ownerIds: [mid], ownerExact: true };
    }

    // All Team under act-as → expand manager's full team on the server.
    if (f.userParamInUrl && uid === 'all') {
      return { ownerIds: linkedIds, ownerExact: false };
    }

    // Manager chip only → that manager's data only (not team).
    return { ownerIds: linkedIds, ownerExact: true };
  }

  // Legacy: single linked id that is self ("You" chip) — treat as own-exact / hierarchy under self.
  if (
    linkedIds.length === 1 &&
    currentUserId &&
    linkedIds[0] === currentUserId
  ) {
    if (f.userParamInUrl && f.selectedUserId && f.selectedUserId !== 'all' && f.selectedUserId !== 'me') {
      return { ownerIds: [f.selectedUserId], ownerExact: true };
    }
    if (f.userParamInUrl && f.selectedUserId === 'all') {
      const reportIds = f.getAssociatesForManager(currentUserId).map((u) => u.id);
      return {
        ownerIds: reportIds.length > 0 ? reportIds : [EMPTY_OWNER_SENTINEL],
        ownerExact: true,
      };
    }
    return { ownerIds: linkedIds, ownerExact: true };
  }

  if (linkedIds.length > 0) {
    // All linked / multi → expand each anchor's normal scope.
    return { ownerIds: linkedIds, ownerExact: false };
  }

  const ids = resolveOwnerIds({
    isElevated: f.isElevated,
    isPureManager: f.isPureManager,
    isSingleAgencyLead: f.isSingleAgencyLead,
    isAgencyScopedElevated: f.isAgencyScopedElevated,
    onlyMe: f.onlyMe,
    selectedAgencyId: f.selectedAgencyId,
    selectedLeaderId: f.selectedLeaderId,
    selectedManagerId: f.selectedManagerId,
    selectedUserId: f.selectedUserId,
    currentUserId,
    getAssociatesForManager: f.getAssociatesForManager,
    getUsersForLeader: f.getUsersForLeader,
    getManagersForLeader: f.getManagersForLeader,
    allManagers: f.managers,
    leaderParamInUrl: f.leaderParamInUrl,
    managerParamInUrl: f.managerParamInUrl,
    userParamInUrl: f.userParamInUrl,
  });
  if (ids !== undefined && ids.length === 0) {
    return { ownerIds: [EMPTY_OWNER_SENTINEL], ownerExact: true };
  }

  const ownDefault = isUnselectedOwnScope({
    isElevated: f.isElevated,
    isPureManager: f.isPureManager,
    isSingleAgencyLead: f.isSingleAgencyLead,
    isAgencyScopedElevated: f.isAgencyScopedElevated,
    selectedAgencyId: f.selectedAgencyId,
    leaderParamInUrl: f.leaderParamInUrl,
    managerParamInUrl: f.managerParamInUrl,
    userParamInUrl: f.userParamInUrl,
  });

  // Single concrete person (or own-default self) must not expand team via linked-owner backend.
  const singleExact =
    ownDefault ||
    (!!ids &&
      ids.length === 1 &&
      ((f.userParamInUrl && f.selectedUserId === ids[0]) ||
        (f.managerParamInUrl &&
          f.selectedManagerId === ids[0] &&
          !f.userParamInUrl) ||
        (f.leaderParamInUrl &&
          f.selectedLeaderId === ids[0] &&
          !f.managerParamInUrl &&
          !f.userParamInUrl) ||
        (!!currentUserId && ids[0] === currentUserId && f.onlyMe)));

  return { ownerIds: ids, ownerExact: singleExact };
}
