import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useScopeFilter, getScopeFilterRowProps } from './useElevatedScopeFilter';
import { useActAs } from './useActAs';
import { useAssignableRoles } from './useAssignableRoles';
import { useStore } from '@/lib/store';
import { resolveLinkedAwareOwnerIds } from '@/lib/linkedAwareOwnerIds';
import { changeEmailFilter, resetEmailFilters, resolveEmailFilterScope, type EmailFilterKey } from '@/lib/emailFilterScope';
import type { HierarchyFilterTier } from '@/lib/hierarchyFilter';

/** Email-only policy; the shared hierarchy keeps its defaults on every other page. */
export function useEmailScopeFilter() {
  const base = useScopeFilter({ emailFilters: true });
  const [params, setParams] = useSearchParams();
  const currentUserId = useStore((s) => s.currentUser?.id);
  const actAs = useActAs();
  const { isLoading: rolesLoading } = useAssignableRoles();
  const linkedIds = params.get('linkedUserId') || undefined;
  const linkedScope = params.get('linkedScope');
  const linked = !!linkedIds || (!!linkedScope && linkedScope !== 'own');
  const resolved = resolveEmailFilterScope(base, currentUserId);
  const linkedResolved = linked ? resolveLinkedAwareOwnerIds({
    linkedUserIdsRaw: linkedIds,
    actAsActive: actAs.isActive,
    currentUserId,
    scopeFilter: base,
  }) : undefined;

  const change = useCallback((key: EmailFilterKey, value?: string) => {
    setParams((prev) => changeEmailFilter(prev, key, value), { replace: true });
  }, [setParams]);
  const setSelectedAgencyId = useCallback((id: string) => {
    if (base.isPureManager || base.isSingleAgencyLead) return;
    // The shared row initializes a hidden single agency. Initialization must
    // preserve a person restored from the URL after a refresh.
    if (base.agencies.length === 1) {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('agencyId', id);
        return next;
      }, { replace: true });
    } else change('agencyId', id);
  }, [base.isPureManager, base.isSingleAgencyLead, base.agencies.length, setParams, change]);
  const setSelectedLeaderId = useCallback((id: string) => change('leaderId', id), [change]);
  const setSelectedManagerId = useCallback((id: string) => change('managerId', id), [change]);
  const setSelectedUserId = useCallback((id: string) => change('userId', id), [change]);
  const onClearLeaderId = useCallback(() => change('leaderId'), [change]);
  const onClearManagerId = useCallback(() => change('managerId'), [change]);
  const onClearUserId = useCallback(() => change('userId'), [change]);

  const tiers: HierarchyFilterTier[] = base.tiers.map((tier) => ({
    ...tier,
    visibleUsers: tier.paramKey === 'managerId'
      ? resolved.managers.filter((u) => u.id !== currentUserId)
      : tier.paramKey === 'userId'
        ? resolved.members.filter((u) => u.id !== currentUserId)
        : tier.visibleUsers,
  }));
  // An agency can contain unassigned team members and no managers at all.
  if (!tiers.some((tier) => tier.paramKey === 'userId') && base.associates.length && base.showHierarchyFilters) {
    tiers.push({
      id: 'own', paramKey: 'userId', allLabel: 'All Team', roleKeys: [],
      users: base.associates, visibleUsers: resolved.members.filter((u) => u.id !== currentUserId),
    });
  }
  // Keep an explicitly selected All chip clickable even when its group becomes
  // empty, so the user can deselect it without changing a parent first.
  for (const [id, paramKey, allLabel] of [
    ['leader', 'leaderId', 'All Authorities'],
    ['team', 'managerId', 'All Managers'],
    ['own', 'userId', 'All Team'],
  ] as const) {
    if (params.get(paramKey) === 'all' && !tiers.some((tier) => tier.paramKey === paramKey)) {
      tiers.push({ id, paramKey, allLabel, roleKeys: [], users: [], visibleUsers: [] });
    }
  }
  const tierOrder = { leader: 0, team: 1, own: 2 };
  tiers.sort((a, b) => tierOrder[a.id] - tierOrder[b.id]);

  const hasPeopleFilter = base.leaderParamInUrl || base.managerParamInUrl || base.userParamInUrl;
  const loading = !currentUserId || (base.isElevated && base.agenciesLoading) ||
    (!linked && hasPeopleFilter && (base.agencyUsersLoading || rolesLoading));
  const error = !linked && hasPeopleFilter && !!base.agencyUsersError;
  let invalidId: string | undefined;
  if (!linked && !loading && !error) {
    for (const key of ['leaderId', 'managerId', 'userId'] as const) {
      const id = params.get(key);
      if (!id || id === 'all' || id === 'me' || id === currentUserId) continue;
      if (!tiers.find((tier) => tier.paramKey === key)?.visibleUsers.some((u) => u.id === id)) {
        invalidId = id;
        break;
      }
    }
  }
  const knownNames = useRef(new Map<string, string>());
  useEffect(() => {
    for (const user of base.agencyUsers) knownNames.current.set(user.id, `${user.firstName} ${user.lastName}`.trim());
  }, [base.agencyUsers]);
  const notified = useRef<string>();
  useEffect(() => {
    if (!invalidId) { notified.current = undefined; return; }
    if (notified.current === invalidId) return;
    notified.current = invalidId;
    toast.info(`${knownNames.current.get(invalidId) || 'Selected user'} is no longer available. Showing your emails.`);
    setParams((prev) => resetEmailFilters(prev), { replace: true });
  }, [invalidId, setParams]);

  const ownerIds = linked ? linkedResolved?.ownerIds : resolved.ownerIds;
  const agencyIds = linked
    ? (base.selectedAgencyId && !['all', 'me'].includes(base.selectedAgencyId) ? [base.selectedAgencyId] : undefined)
    : resolved.agencyIds;
  const scopeKey = [currentUserId, ...['agencyId', 'leaderId', 'managerId', 'userId', 'linkedScope', 'linkedUserId'].map((key) =>
    `${key}=${params.get(key) ?? ''}`), `owners=${ownerIds?.join(',') ?? '*'}`, `agencies=${agencyIds?.join(',') ?? '*'}`].join('|');
  const state = {
    ...base, tiers, setSelectedAgencyId, setSelectedLeaderId, setSelectedManagerId, setSelectedUserId,
    onClearLeaderId, onClearManagerId, onClearUserId, scopeKey,
  };
  const showAllTeamView = linked ? base.showAllTeamView : !!resolved.peopleMode;
  return {
    ...state,
    filterRowProps: {
      ...getScopeFilterRowProps(state),
      validateSelections: linked,
      emptyAgenciesHint: base.filterRowProps.emptyAgenciesHint,
    },
    ready: !loading && !error && !invalidId,
    error,
    query: { ownerIds, agencyIds, ownerExact: linked ? linkedResolved?.ownerExact : true,
      filterMode: linked ? undefined : 'chips' as const },
    showAllTeamView,
    showManagerSections: linked ? base.showManagerSections : resolved.peopleMode === 'managers',
    teamUsers: linked ? base.teamUsers : resolved.sectionUsers,
    showAgencySections: linked ? base.showAgencySections :
      base.showAgencySections && !showAllTeamView &&
      !(base.leaderParamInUrl && base.selectedLeaderId !== 'all') &&
      !(base.managerParamInUrl && base.selectedManagerId !== 'all'),
  };
}
