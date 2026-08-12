/**
 * Linked-aware agency scope for recruitment list pages (Jobs / Active Clients).
 *
 * Mirrors the Employees page resolution order:
 * 1. Concrete agency selection (?agencyId=, act-as, agency picker) wins.
 * 2. Linked-account mode (?linkedUserId=a,b) → union of the linked users' agencies.
 * 3. Explicit All Agencies (`agencyId=all`) → undefined (no filter).
 * 4. Unselected / everyone else → home agency (never silent all-agencies).
 */
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useScopeFilter } from '@/hooks/useElevatedScopeFilter';
import { useScopeQueryParams } from '@/hooks/useScopeQueryParams';
import { useLinkedAccounts } from '@/hooks/useLinkedAccounts';
import { useRecruitmentAgencyId } from '@/hooks/useRecruitmentAgencyId';

export function useLinkedAgencyScope(): {
  /** Pass as agencyIds to list APIs; undefined = no agency filter (elevated "all"). */
  agencyIds: string[] | undefined;
  /** Owner ("my records") ids from the recruitment scope chips; undefined = no owner filter. */
  ownerIds: string[] | undefined;
  /** true → API must not expand team/agency (own-default / single person). */
  ownerExact: boolean;
  /** Include in every filter-sensitive queryKey. */
  scopeKey: string;
} {
  const scopeFilter = useScopeFilter({ domain: 'recruitment' });
  const { agencyId, ownerIds, ownerExact, scopeKey } = useScopeQueryParams(scopeFilter);
  const { agencyId: ownAgencyId } = useRecruitmentAgencyId();
  const [searchParams] = useSearchParams();
  const linkedUserIdParam = searchParams.get('linkedUserId') ?? '';
  const { data: linkedAccounts = [] } = useLinkedAccounts();

  const agencyIds = useMemo(() => {
    if (agencyId) return [agencyId];
    const linkedIds = linkedUserIdParam.split(',').filter(Boolean);
    if (linkedIds.length > 0) {
      const agencies = new Set<string>();
      for (const a of linkedAccounts) {
        if (a.isActive && linkedIds.includes(a.userId) && a.subCompanyId) {
          agencies.add(a.subCompanyId);
        }
      }
      if (agencies.size > 0) return [...agencies];
    }
    if (scopeFilter.selectedAgencyId === 'all') {
      return undefined;
    }
    return ownAgencyId ? [ownAgencyId] : undefined;
  }, [
    agencyId,
    linkedUserIdParam,
    linkedAccounts,
    scopeFilter.selectedAgencyId,
    ownAgencyId,
  ]);

  return {
    agencyIds,
    ownerIds,
    ownerExact,
    scopeKey: `${scopeKey}|agencies:${agencyIds?.join(',') ?? 'all'}`,
  };
}
