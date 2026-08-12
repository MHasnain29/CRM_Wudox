/**
 * URL-driven scope filter state (agency + dynamic hierarchy tiers).
 * Covers elevated viewers, single-agency leads, and team-scope managers.
 */
import { useCallback, useMemo, useEffect } from 'react';
import type { ComponentProps } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  useCanAccessMultipleAgencies,
  useDataScopeLevel,
  useIsAgencyScopedElevated,
  useIsSingleAgencyLead,
  useIsTeamManagerOnly,
  useIsGlobalDatabaseWorkspace,
  useDatabaseManagerAgencyPathEnabled,
} from '@/lib/access';
import { useAuthStore } from '@/lib/authStore';
import { fetchScopeFilterUsers, fetchTeamMembers, type ApiUser } from '@/lib/api';
import { useAgencyFilter, type Agency } from '@/hooks/useAgencyFilter';
import { useHierarchyFilter } from '@/hooks/useManagerFilter';
import { buildTeamManagerFilter, type HierarchyFilterTier, type ScopeDomain } from '@/lib/hierarchyFilter';
import { buildScopeKey, isViewingOwnDataOnly } from '@/lib/ownerScope';
import { useAssignableRoles } from '@/hooks/useAssignableRoles';
import type { AgencyManagerUserFilterRows } from '@/components/AgencyManagerUserFilterRows';
import { useStore } from '@/lib/store';
import { useLinkedFilterOverride } from '@/hooks/useLinkedFilterOverride';

export type ScopeFilterState = {
  isElevated: boolean;
  isSingleAgencyLead: boolean;
  /** Elevated with exactly one assigned agency (home forced). */
  isAgencyScopedElevated: boolean;
  isAgencyHierarchyViewer: boolean;
  showHierarchyFilters: boolean;
  /** Agency picker only (Database Manager with org agency/both policy). */
  showAgencyFilterOnly: boolean;
  showAgencyFilterBar: boolean;
  isDatabaseManagerAgencyMode: boolean;
  isPureManager: boolean;
  agencies: Agency[];
  agenciesLoading: boolean;
  agencyUsersLoading: boolean;
  agencyUsers: ApiUser[];
  selectedAgencyId: string;
  selectedLeaderId: string;
  selectedManagerId: string;
  selectedUserId: string;
  setSelectedAgencyId: (id: string) => void;
  setSelectedLeaderId: (id: string) => void;
  setSelectedManagerId: (id: string) => void;
  setSelectedUserId: (id: string) => void;
  onClearLeaderId: () => void;
  onClearManagerId: () => void;
  onClearUserId: () => void;
  onlyMe: boolean;
  tiers: HierarchyFilterTier[];
  managers: ApiUser[];
  associates: ApiUser[];
  visibleAssociates: ApiUser[];
  getAssociatesForManager: (managerId: string) => ApiUser[];
  getUsersForLeader: (leaderId: string) => ApiUser[];
  getManagersForLeader: (leaderId: string) => ApiUser[];
  /**
   * Users to render as people sections (managers OR associates, depending on mode).
   * Empty when not in people-section mode.
   */
  teamUsers: ApiUser[];
  /** Alias of teamUsers — prefer this name in new code. */
  sectionUsers: ApiUser[];
  /** True when a specific manager is selected (not All / me / self). */
  isManagerDrilled: boolean;
  /**
   * People-section mode (manager sections OR team-member sections).
   * When true, agency section cards must hide.
   */
  showAllTeamView: boolean;
  /** All Agencies + no people mode + no specific person → per-agency cards. */
  showAgencySections: boolean;
  /** Concrete Team person selected (not all / me) → single-user data only. */
  hasSpecificUser: boolean;
  /** All Sales Managers on, All Team off → one section per manager (own data only). */
  showManagerSections: boolean;
  /** All Team on → one section per associate in scope. */
  showTeamMemberSections: boolean;
  filterRowProps: Omit<ComponentProps<typeof AgencyManagerUserFilterRows>, 'hideUserRows'>;
  /** Stable scope key for fetch/query dependency arrays. */
  scopeKey: string;
  leaderParamInUrl: boolean;
  managerParamInUrl: boolean;
  userParamInUrl: boolean;
};

function sortUsersByName(users: ApiUser[]): ApiUser[] {
  return [...users].sort((a, b) =>
    `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, undefined, {
      sensitivity: 'base',
    }),
  );
}

/** @deprecated Use ScopeFilterState */
export type ElevatedScopeFilterState = ScopeFilterState;

export function getScopeFilterRowProps(
  state: Pick<
    ScopeFilterState,
    | 'agencies'
    | 'agenciesLoading'
    | 'selectedAgencyId'
    | 'setSelectedAgencyId'
    | 'tiers'
    | 'selectedLeaderId'
    | 'selectedManagerId'
    | 'selectedUserId'
    | 'setSelectedLeaderId'
    | 'setSelectedManagerId'
    | 'setSelectedUserId'
    | 'onClearLeaderId'
    | 'onClearManagerId'
    | 'onClearUserId'
    | 'agencyUsersLoading'
    | 'leaderParamInUrl'
    | 'managerParamInUrl'
    | 'userParamInUrl'
  >,
  options?: { emptyAgenciesHint?: string },
) {
  return {
    agencies: state.agencies,
    agenciesLoading: state.agenciesLoading,
    selectedAgencyId: state.selectedAgencyId,
    onSelectAgency: state.setSelectedAgencyId,
    tiers: state.tiers,
    leaderParamInUrl: state.leaderParamInUrl,
    managerParamInUrl: state.managerParamInUrl,
    userParamInUrl: state.userParamInUrl,
    tierSelections: {
      leaderId: state.selectedLeaderId,
      managerId: state.selectedManagerId,
      userId: state.selectedUserId,
    },
    onSelectTier: (paramKey: 'leaderId' | 'managerId' | 'userId', id: string) => {
      if (paramKey === 'leaderId') state.setSelectedLeaderId(id);
      else if (paramKey === 'managerId') state.setSelectedManagerId(id);
      else state.setSelectedUserId(id);
    },
    onClearTier: (paramKey: 'leaderId' | 'managerId' | 'userId') => {
      if (paramKey === 'leaderId') state.onClearLeaderId();
      else if (paramKey === 'managerId') state.onClearManagerId();
      else state.onClearUserId();
    },
    usersLoading: state.agencyUsersLoading,
    emptyAgenciesHint: options?.emptyAgenciesHint,
  };
}

/** @deprecated Use getScopeFilterRowProps */
export const getElevatedFilterRowProps = getScopeFilterRowProps;

export function useScopeFilter(options?: { domain?: ScopeDomain }): ScopeFilterState {
  const domain = options?.domain;
  const isElevated = useCanAccessMultipleAgencies();
  const isSingleAgencyLead = useIsSingleAgencyLead();
  const isPureManager = useIsTeamManagerOnly();
  const viewerRole = useAuthStore((s) => s.user?.role);
  const useDbGlobalUi = useIsGlobalDatabaseWorkspace();
  const databaseManagerAgencyPathEnabled = useDatabaseManagerAgencyPathEnabled();
  const isDatabaseManagerAgencyMode =
    viewerRole === 'database_manager' && databaseManagerAgencyPathEnabled;
  const showAgencyFilterOnly = isDatabaseManagerAgencyMode;
  const isAgencyHierarchyViewer =
    (isElevated || isSingleAgencyLead || isDatabaseManagerAgencyMode) && !useDbGlobalUi;
  const isAgencyScopedElevated = useIsAgencyScopedElevated();
  const showHierarchyFilters =
    (isAgencyHierarchyViewer || isPureManager) && !useDbGlobalUi && !showAgencyFilterOnly;
  const showAgencyFilterBar = showHierarchyFilters || showAgencyFilterOnly;
  const viewerScope = useDataScopeLevel();
  const viewerUserId = useAuthStore((s) => s.user?.id);
  const { linkedOverrideActive, actAsActive } = useLinkedFilterOverride();
  // While act-as / linked override owns people, don't force the caller's home agency into the URL.
  const linkedOwnsScope = linkedOverrideActive || actAsActive;
  const authUser = useAuthStore((s) => s.user);
  const { currentSubCompany } = useStore();
  const { agencies, isLoading: agenciesLoading } = useAgencyFilter();
  const { assignableRoles } = useAssignableRoles();

  const [searchParams, setSearchParams] = useSearchParams();
  // Missing agencyId = unselected own (not All Agencies). Deselect writes `me`.
  const urlAgencyId = searchParams.get('agencyId') ?? '';
  // Missing hierarchy params = unselected; string `all` only when param is present.
  const selectedLeaderId = searchParams.get('leaderId') ?? 'all';
  const selectedManagerId = searchParams.get('managerId') ?? 'all';
  const selectedUserId = searchParams.get('userId') ?? 'all';
  const leaderParamInUrl = searchParams.has('leaderId');
  const managerParamInUrl = searchParams.has('managerId');
  const userParamInUrl = searchParams.has('userId');

  const selectedAgencyId = isPureManager
    ? (currentSubCompany?.id ?? urlAgencyId)
    : isSingleAgencyLead
      ? (currentSubCompany?.id ?? urlAgencyId)
      : urlAgencyId;

  const onlyMe = isViewingOwnDataOnly({
    isSingleAgencyLead,
    isPureManager,
    isAgencyScopedElevated,
    isElevated,
    selectedAgencyId,
    selectedLeaderId,
    selectedManagerId,
    selectedUserId,
    viewerUserId,
    leaderParamInUrl,
    managerParamInUrl,
    userParamInUrl,
  });

  useEffect(() => {
    if (!isSingleAgencyLead || !currentSubCompany?.id) return;
    if (urlAgencyId === 'all' || urlAgencyId === 'me' || urlAgencyId !== currentSubCompany.id) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('agencyId', currentSubCompany.id);
          return next;
        },
        { replace: true },
      );
    }
  }, [isSingleAgencyLead, currentSubCompany?.id, urlAgencyId, setSearchParams]);

  useEffect(() => {
    if (!isPureManager || !currentSubCompany?.id || linkedOwnsScope) return;
    if (urlAgencyId === 'all' || urlAgencyId === 'me' || urlAgencyId !== currentSubCompany.id) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('agencyId', currentSubCompany.id);
          return next;
        },
        { replace: true },
      );
    }
  }, [isPureManager, currentSubCompany?.id, urlAgencyId, setSearchParams, linkedOwnsScope]);

  useEffect(() => {
    if (!isAgencyScopedElevated || agenciesLoading || agencies.length !== 1) return;
    const onlyAgencyId = agencies[0]!.id;
    if (urlAgencyId === 'all' || urlAgencyId === 'me' || urlAgencyId !== onlyAgencyId) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('agencyId', onlyAgencyId);
          return next;
        },
        { replace: true },
      );
    }
  }, [isAgencyScopedElevated, agencies, agenciesLoading, urlAgencyId, setSearchParams]);

  const filterAgencies: Agency[] = isPureManager
    ? currentSubCompany
      ? [{ id: currentSubCompany.id, name: currentSubCompany.name, countries: [] }]
      : []
    : isAgencyScopedElevated || isElevated || showAgencyFilterOnly
      ? agencies
      : currentSubCompany
        ? [{ id: currentSubCompany.id, name: currentSubCompany.name, countries: [] }]
        : [];

  const clearBelowAgency = useCallback((next: URLSearchParams) => {
    next.delete('leaderId');
    next.delete('managerId');
    next.delete('userId');
  }, []);

  const clearBelowLeader = useCallback((next: URLSearchParams) => {
    next.delete('managerId');
    next.delete('userId');
  }, []);

  const clearBelowManager = useCallback((next: URLSearchParams) => {
    next.delete('userId');
  }, []);

  const setSelectedAgencyId = useCallback(
    (id: string) => {
      if (isPureManager || isSingleAgencyLead) return;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const current = prev.get('agencyId') ?? '';
          const switchingBetweenSpecific =
            current !== 'all' && current !== 'me' && current !== '' && id !== 'all' && id !== 'me';
          next.set('agencyId', id);
          if (switchingBetweenSpecific) clearBelowAgency(next);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, clearBelowAgency, isPureManager, isSingleAgencyLead],
  );

  const setSelectedLeaderId = useCallback(
    (id: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id === 'all') next.set('leaderId', 'all');
          else next.set('leaderId', id);
          clearBelowLeader(next);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, clearBelowLeader],
  );

  const setSelectedManagerId = useCallback(
    (id: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id === 'all') {
            // Toggle: deselect if already active, otherwise select
            if (prev.get('managerId') === 'all') {
              next.delete('managerId');
            } else {
              next.set('managerId', 'all');
            }
          } else {
            next.set('managerId', id);
          }
          clearBelowManager(next);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, clearBelowManager],
  );

  const setSelectedUserId = useCallback(
    (id: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id === 'all') {
            next.set('userId', 'all');
          } else {
            next.set('userId', id);
            // Concrete person = single-user view. Exit All Managers section mode
            // so chips/URL don't keep managerId=all while showing one teammate.
            if (prev.get('managerId') === 'all') next.delete('managerId');
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const onClearLeaderId = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('leaderId');
        clearBelowLeader(next);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams, clearBelowLeader]);

  const onClearManagerId = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('managerId');
        clearBelowManager(next);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams, clearBelowManager]);

  const onClearUserId = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('userId');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const agencyDrillEnabled =
    !!selectedAgencyId && selectedAgencyId !== 'all' && selectedAgencyId !== 'me';
  const scopeFilterAgencyId =
    isSingleAgencyLead && currentSubCompany?.id
      ? currentSubCompany.id
      : agencyDrillEnabled
        ? selectedAgencyId
        : null;
  const isAllAgenciesElevated =
    isElevated && selectedAgencyId === 'all' && filterAgencies.length > 1;
  const allAgenciesKey = filterAgencies.map((a) => a.id).join(',');

  const { data: singleAgencyUsersRaw, isLoading: singleAgencyUsersLoading } = useQuery<ApiUser[]>({
    queryKey: ['agency-users-scope-filter', scopeFilterAgencyId],
    queryFn: () => fetchScopeFilterUsers(scopeFilterAgencyId!),
    enabled: isAgencyHierarchyViewer && !!scopeFilterAgencyId,
    staleTime: 2 * 60 * 1000,
  });

  const { data: allAgenciesUsersRaw, isLoading: allAgenciesUsersLoading } = useQuery<ApiUser[]>({
    queryKey: ['agency-users-scope-filter-all', allAgenciesKey],
    queryFn: async () => {
      const lists = await Promise.all(filterAgencies.map((a) => fetchScopeFilterUsers(a.id)));
      const byId = new Map<string, ApiUser>();
      for (const list of lists) {
        for (const user of list) byId.set(user.id, user);
      }
      return Array.from(byId.values());
    },
    enabled: isAgencyHierarchyViewer && isAllAgenciesElevated,
    staleTime: 2 * 60 * 1000,
  });

  const agencyUsersRaw = isAllAgenciesElevated ? allAgenciesUsersRaw : singleAgencyUsersRaw;
  const agencyUsersLoading = isAllAgenciesElevated
    ? allAgenciesUsersLoading
    : singleAgencyUsersLoading;

  const { data: teamMembersRaw = [], isLoading: teamMembersLoading } = useQuery<ApiUser[]>({
    queryKey: ['team-members-scope-filter', viewerUserId],
    queryFn: () => fetchTeamMembers(),
    // Don't fetch (or poison cache) with act-as header while viewing a linked manager's world.
    enabled: isPureManager && !!viewerUserId && !actAsActive,
    staleTime: 2 * 60 * 1000,
  });

  const agencyUsers = useMemo(
    () => (agencyUsersRaw ?? []).filter((u) => u.isActive),
    [agencyUsersRaw],
  );

  const teamMembers = useMemo(
    () => (teamMembersRaw ?? []).filter((u) => u.isActive !== false),
    [teamMembersRaw],
  );

  const viewerApiUser = useMemo((): ApiUser | undefined => {
    if (!authUser) return undefined;
    const fromAgency = agencyUsers.find((u) => u.id === authUser.id);
    if (fromAgency) return fromAgency;
    return {
      id: authUser.id,
      email: authUser.email,
      firstName: authUser.firstName,
      lastName: authUser.lastName,
      phone: authUser.phone,
      country: authUser.country,
      role: authUser.role,
      userType: authUser.userType,
      subCompanyId: authUser.subCompanyId ?? '',
      locationId: authUser.locationId || null,
      isActive: authUser.isActive,
      reportingManagerIds: authUser.reportingManagerIds,
    };
  }, [authUser, agencyUsers]);

  const selections = useMemo(
    () => ({ leaderId: selectedLeaderId, managerId: selectedManagerId, userId: selectedUserId }),
    [selectedLeaderId, selectedManagerId, selectedUserId],
  );

  const elevatedHierarchy = useHierarchyFilter(agencyUsers, selections, {
    viewerRoleKey: viewerRole,
    viewerScope,
    viewerUserId,
    viewerHasCrossOrg: isElevated,
    viewerApiUser,
    domain,
  });

  const teamHierarchy = useMemo(
    () => buildTeamManagerFilter(teamMembers, assignableRoles, viewerApiUser),
    [teamMembers, assignableRoles, viewerApiUser],
  );

  const hierarchy = isPureManager ? teamHierarchy : elevatedHierarchy;
  const usersLoading = isPureManager ? teamMembersLoading : agencyUsersLoading;

  const isManagerDrilled =
    isAgencyHierarchyViewer &&
    !isPureManager &&
    selectedManagerId !== 'all' &&
    selectedManagerId !== 'me' &&
    selectedManagerId !== viewerUserId;

  /** Explicit "All Sales Managers" chip (managerId=all in URL). */
  const isAllManagersChipActive =
    isAgencyHierarchyViewer &&
    !isPureManager &&
    managerParamInUrl &&
    selectedManagerId === 'all';

  /** Explicit "All Team" chip (userId=all in URL). */
  const isAllTeamChipActive = userParamInUrl && selectedUserId === 'all';

  /** Managers in current agency/authority scope (for manager sections + building associate lists). */
  const managersInScope = useMemo(() => {
    if (isPureManager) return [] as ApiUser[];
    if (
      selectedLeaderId &&
      selectedLeaderId !== 'all' &&
      selectedLeaderId !== 'me' &&
      selectedLeaderId !== viewerUserId
    ) {
      return sortUsersByName(hierarchy.getManagersForLeader(selectedLeaderId));
    }
    return sortUsersByName(hierarchy.managers);
  }, [isPureManager, selectedLeaderId, viewerUserId, hierarchy]);

  /** Associates for team-member sections (scoped by agency / authority / drilled manager). */
  const associatesInScope = useMemo(() => {
    if (isPureManager) return sortUsersByName(teamMembers);
    if (isManagerDrilled) {
      return sortUsersByName(hierarchy.getAssociatesForManager(selectedManagerId));
    }
    const byId = new Map<string, ApiUser>();
    for (const manager of managersInScope) {
      for (const associate of hierarchy.getAssociatesForManager(manager.id)) {
        byId.set(associate.id, associate);
      }
    }
    return sortUsersByName(Array.from(byId.values()));
  }, [
    isPureManager,
    isManagerDrilled,
    teamMembers,
    selectedManagerId,
    managersInScope,
    hierarchy,
  ]);

  // Concrete Team person selected → normal single-user scope (not people sections).
  const hasSpecificUser = selectedUserId !== 'all' && selectedUserId !== 'me';

  // All Team wins over All Managers (locked 1A). Pure manager: explicit All Team only.
  // Elevated: All Team chip → associates (G2A: works even without All Managers).
  // Specific manager + All Team → that manager's associates only.
  // Act-as: never show the caller's people section cards — ActAsHierarchyFilterRows owns that UI.
  const showTeamMemberSections = actAsActive
    ? false
    : isPureManager
      ? isAllTeamChipActive && !onlyMe
      : isAgencyHierarchyViewer && isAllTeamChipActive && !hasSpecificUser;

  // All Managers chip, All Team not active, no specific teammate → one section per manager.
  const showManagerSections =
    !actAsActive &&
    !isPureManager &&
    isAllManagersChipActive &&
    !isAllTeamChipActive &&
    !hasSpecificUser;

  /** People mode — hides agency cards. True even when the section list is empty (show empty message). */
  const showAllTeamView = showManagerSections || showTeamMemberSections;

  const sectionUsers = useMemo(() => {
    if (showTeamMemberSections) return associatesInScope;
    if (showManagerSections) return managersInScope;
    return [] as ApiUser[];
  }, [showTeamMemberSections, showManagerSections, associatesInScope, managersInScope]);

  const teamUsers = sectionUsers;

  const showAgencySections =
    isElevated &&
    selectedAgencyId === 'all' &&
    filterAgencies.length > 0 &&
    !showAllTeamView &&
    !hasSpecificUser;

  const scopeKey = buildScopeKey({
    selectedAgencyId,
    selectedLeaderId,
    selectedManagerId,
    selectedUserId,
    onlyMe,
  });

  return {
    isElevated,
    isSingleAgencyLead,
    isAgencyScopedElevated,
    isAgencyHierarchyViewer,
    showHierarchyFilters,
    showAgencyFilterOnly,
    showAgencyFilterBar,
    isDatabaseManagerAgencyMode,
    isPureManager,
    agencies: filterAgencies,
    agenciesLoading: isPureManager ? false : agenciesLoading,
    agencyUsersLoading: usersLoading,
    agencyUsers: isPureManager ? teamMembers : agencyUsers,
    selectedAgencyId,
    selectedLeaderId,
    selectedManagerId,
    selectedUserId,
    setSelectedAgencyId,
    setSelectedLeaderId,
    setSelectedManagerId,
    setSelectedUserId,
    onClearLeaderId,
    onClearManagerId,
    onClearUserId,
    onlyMe,
    tiers: hierarchy.tiers,
    managers: hierarchy.managers,
    associates: hierarchy.associates,
    visibleAssociates: hierarchy.visibleAssociates,
    getAssociatesForManager: hierarchy.getAssociatesForManager,
    getUsersForLeader: hierarchy.getUsersForLeader,
    getManagersForLeader: hierarchy.getManagersForLeader,
    teamUsers,
    sectionUsers,
    isManagerDrilled,
    showAllTeamView,
    showAgencySections,
    hasSpecificUser,
    showManagerSections,
    showTeamMemberSections,
    filterRowProps: getScopeFilterRowProps(
      {
        agencies: filterAgencies,
        agenciesLoading: isPureManager ? false : agenciesLoading,
        selectedAgencyId,
        setSelectedAgencyId,
        tiers: hierarchy.tiers,
        selectedLeaderId,
        selectedManagerId,
        selectedUserId,
        setSelectedLeaderId,
        setSelectedManagerId,
        setSelectedUserId,
        onClearLeaderId,
        onClearManagerId,
        onClearUserId,
        agencyUsersLoading: usersLoading,
        leaderParamInUrl,
        managerParamInUrl,
        userParamInUrl,
      },
      {
        emptyAgenciesHint:
          isAgencyScopedElevated && !agenciesLoading && filterAgencies.length === 0
            ? 'No agencies assigned. Ask a Super Admin to assign agencies under Settings → Super Users.'
            : undefined,
      },
    ),
    scopeKey,
    leaderParamInUrl,
    managerParamInUrl,
    userParamInUrl,
  };
}

/** @deprecated Use useScopeFilter */
export const useElevatedScopeFilter = useScopeFilter;
