/**
 * Agency scope for the recruitment demo pages (Employees / Jobs / Active Clients).
 *
 * Resolution order:
 * 1. Elevated / URL-driven selection from useScopeFilter + useScopeQueryParams
 *    (?agencyId=, act-as, agency picker).
 * 2. Fallback to the user's own sub-company so regular users always have a
 *    concrete agency — required for seeding and strict agency filters.
 */
import { useScopeFilter } from '@/hooks/useElevatedScopeFilter';
import { useScopeQueryParams } from '@/hooks/useScopeQueryParams';
import { useStore } from '@/lib/store';

export function useRecruitmentAgencyId(): {
  agencyId: string;
  agencyName: string;
  scopeKey: string;
  /** Owner ("my records") ids from the recruitment scope chips; undefined = no owner filter. */
  ownerIds: string[] | undefined;
  /** true → API must not expand team/agency (own-default / single person). */
  ownerExact: boolean;
} {
  const scopeFilter = useScopeFilter({ domain: 'recruitment' });
  const { agencyId: scopeAgencyId, ownerIds, ownerExact, scopeKey } =
    useScopeQueryParams(scopeFilter);
  const { currentUser, currentSubCompany } = useStore();

  const agencyId =
    scopeAgencyId ?? currentSubCompany?.id ?? currentUser?.subCompanyId ?? '';

  const agencyName =
    (agencyId === currentSubCompany?.id ? currentSubCompany?.name : undefined) ??
    scopeFilter.agencies?.find((a) => a.id === agencyId)?.name ??
    '';

  return { agencyId, agencyName, scopeKey, ownerIds, ownerExact };
}
