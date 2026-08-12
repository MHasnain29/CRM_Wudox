/**
 * Universal helper for filter-button-driven data fetching (Pattern A).
 *
 * Pass the result of useScopeFilter() so the hook runs only once per component.
 * Uses isAgencyHierarchyViewer as isElevated and isPureManager as-is.
 *
 * Proposals (Pattern B: isPureManager: false with guard) and
 * Clients (Pattern C: actual isElevated, database_manager extension) compute
 * ownerIds differently — do not use this hook for those pages.
 *
 * Returns:
 *   agencyId  — pass as subCompanyId (Tasks) or agencyIds:[id] (FollowUps/Emails/…)
 *   ownerIds  — pass as ownerIds to the API; undefined = no filter; never []; empty→sentinel
 *   scopeKey  — include in every filter-sensitive queryKey
 */
import { useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useScopeFilter } from '@/hooks/useElevatedScopeFilter';
import { useAuthStore } from '@/lib/authStore';
import { useActAs } from '@/hooks/useActAs';
import { resolveLinkedAwareOwnerIds, EMPTY_OWNER_SENTINEL } from '@/lib/linkedAwareOwnerIds';
import { ownerExactFlag } from '@/lib/ownerExactFlag';

export { EMPTY_OWNER_SENTINEL };

export function useScopeQueryParams(f: ReturnType<typeof useScopeFilter>) {
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [searchParams] = useSearchParams();
  const actAs = useActAs();
  const linkedUserIdsRaw = searchParams.get('linkedUserId') ?? undefined;

  const resolved = useMemo(
    () =>
      resolveLinkedAwareOwnerIds({
        linkedUserIdsRaw,
        actAsActive: actAs.isActive,
        currentUserId,
        scopeFilter: f,
      }),
    [
      linkedUserIdsRaw,
      actAs.isActive,
      currentUserId,
      f.isElevated,
      f.isAgencyHierarchyViewer,
      f.isPureManager,
      f.isSingleAgencyLead,
      f.isAgencyScopedElevated,
      f.onlyMe,
      f.selectedAgencyId,
      f.selectedLeaderId,
      f.selectedManagerId,
      f.selectedUserId,
      f.getAssociatesForManager,
      f.getUsersForLeader,
      f.getManagersForLeader,
      f.managers,
      f.leaderParamInUrl,
      f.managerParamInUrl,
      f.userParamInUrl,
    ],
  );

  // Keep ownerIds referentially stable when contents are unchanged (avoids effect refetch loops).
  const ownerIdsKey =
    resolved.ownerIds === undefined ? undefined : resolved.ownerIds.join(',');
  const ownerIds = useMemo(
    () =>
      ownerIdsKey === undefined
        ? undefined
        : ownerIdsKey === ''
          ? []
          : ownerIdsKey.split(','),
    [ownerIdsKey],
  );

  useEffect(() => {
    ownerExactFlag.set(resolved.ownerExact);
    return () => ownerExactFlag.set(false);
  }, [resolved.ownerExact]);

  const agencyId = useMemo(() => {
    const id = f.selectedAgencyId;
    if (!id || id === 'all' || id === 'me') return undefined;
    return id;
  }, [f.selectedAgencyId]);

  return {
    agencyId,
    ownerIds,
    ownerExact: resolved.ownerExact,
    scopeKey: `${f.scopeKey}|${linkedUserIdsRaw ?? ''}|${actAs.isActive ? actAs.userId ?? 'act' : ''}|exact:${resolved.ownerExact ? 1 : 0}`,
  };
}
