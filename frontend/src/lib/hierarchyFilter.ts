/**
 * Dynamic scope filter tiers from Settings → Roles (RBAC hierarchy + scopeLevel).
 * Each user appears in exactly one chip row: leader → team → own.
 */
import type { ApiUser } from '@/lib/api';
import type { AssignableRoleOption, DataScopeLevel } from '@/lib/rbacApi';
import { ROLE_OPTIONS } from '@/lib/roleOptions';
import { getRoleLabel } from '@/lib/roleLabels';

/** Agency-scope roles shown as a flat list (no hierarchy filter row). */
const AGENCY_FLAT_ROLE_KEYS = new Set(['dev_team', 'it']);

/** Roles never shown as per-agency filter chips (viewer-only / support). */
const CHIP_HIDDEN_ROLE_KEYS = new Set(['super_admin', 'dev_team']);

/** Leader row: agency-scope leaders + team roles that report to director in RBAC tree. */
const LEADER_TIER_ALL_LABEL = 'All Authorities';

/** Static scope fallback when /roles/assignable has not loaded yet. */
const STATIC_SCOPE_FALLBACK: Record<string, DataScopeLevel> = Object.fromEntries(
  ROLE_OPTIONS.map((o) => {
    const key = o.role;
    if (key === 'super_admin' || key === 'database_manager') return [key, 'global' as const];
    if (['director', 'company_director', 'dev_team', 'it'].includes(key)) return [key, 'agency' as const];
    if (['sales_manager', 'recruitment_manager', 'operations_manager'].includes(key)) return [key, 'team' as const];
    return [key, 'own' as const];
  }),
) as Record<string, DataScopeLevel>;

/** RBAC tree fallback until GET /roles/assignable resolves (first paint / offline). */
export const STATIC_ASSIGNABLE_ROLES: AssignableRoleOption[] = [
  { key: 'super_admin', name: 'Super Admin', scopeLevel: 'global', sortOrder: 0, isSystem: true, parentKey: null },
  { key: 'director', name: 'Director', scopeLevel: 'agency', sortOrder: 2, isSystem: true, parentKey: 'super_admin' },
  { key: 'company_director', name: 'Company Director', scopeLevel: 'agency', sortOrder: 25, isSystem: true, parentKey: 'director' },
  { key: 'operations_manager', name: 'Operations Manager', scopeLevel: 'team', sortOrder: 5, isSystem: true, parentKey: 'director' },
  { key: 'recruitment_manager', name: 'Recruitment Manager', scopeLevel: 'team', sortOrder: 6, isSystem: true, parentKey: 'director' },
  { key: 'sales_manager', name: 'Sales Manager', scopeLevel: 'team', sortOrder: 10, isSystem: true, parentKey: 'company_director' },
  { key: 'sales_associate', name: 'Sales Associate', scopeLevel: 'own', sortOrder: 11, isSystem: true, parentKey: 'sales_manager' },
  { key: 'sales_executive', name: 'Sales Executive', scopeLevel: 'own', sortOrder: 12, isSystem: true, parentKey: 'sales_manager' },
  { key: 'marketing', name: 'Marketing', scopeLevel: 'own', sortOrder: 13, isSystem: true, parentKey: 'sales_manager' },
  { key: 'recruiter', name: 'Recruiter', scopeLevel: 'own', sortOrder: 14, isSystem: true, parentKey: 'recruitment_manager' },
  { key: 'sr_recruiter', name: 'Senior Recruiter', scopeLevel: 'own', sortOrder: 15, isSystem: true, parentKey: 'recruitment_manager' },
  { key: 'data_entry_specialist', name: 'Data Entry Specialist', scopeLevel: 'own', sortOrder: 16, isSystem: true, parentKey: 'sales_manager' },
  { key: 'database_manager', name: 'Database Manager', scopeLevel: 'global', sortOrder: 20, isSystem: true, parentKey: 'super_admin' },
  { key: 'dev_team', name: 'Dev Team', scopeLevel: 'agency', sortOrder: 1, isSystem: true, parentKey: 'super_admin' },
  { key: 'it', name: 'IT', scopeLevel: 'agency', sortOrder: 3, isSystem: true, parentKey: 'super_admin' },
];

export type HierarchyFilterTierId = 'leader' | 'team' | 'own';

export type HierarchyFilterTier = {
  id: HierarchyFilterTierId;
  paramKey: 'leaderId' | 'managerId' | 'userId';
  allLabel: string;
  roleKeys: string[];
  users: ApiUser[];
  visibleUsers: ApiUser[];
  /** Logged-in user chip on their home row (selected by default). */
  viewerSelfChip?: ApiUser;
};

const TIER_RANK: Record<HierarchyFilterTierId, number> = {
  leader: 0,
  team: 1,
  own: 2,
};

function isSelfSelection(selected: string, selfId?: string): boolean {
  return selected === 'me' || (!!selfId && selected === selfId);
}

function isDrilledToPerson(selected: string, selfId?: string): boolean {
  return selected !== 'all' && !isSelfSelection(selected, selfId);
}

/** Viewer’s home row in the filter (leader / team / own). */
export function resolveViewerHomeTier(
  viewerRoleKey: string | undefined,
  assignableRoles: AssignableRoleOption[],
  options?: { isCompanyDirectorViewer?: boolean; showLeader?: boolean },
): HierarchyFilterTierId {
  if (options?.isCompanyDirectorViewer) return 'team';
  if (viewerRoleKey) {
    const tier = userFilterTier({ role: viewerRoleKey } as ApiUser, assignableRoles);
    if (tier === 'leader' && options?.showLeader !== false) return 'leader';
    if (tier === 'team') return 'team';
    if (tier === 'own') return 'own';
  }
  return options?.showLeader ? 'leader' : 'team';
}

const SCOPE_RANK: Record<DataScopeLevel, number> = {
  global: 4,
  agency: 3,
  team: 2,
  own: 1,
};

function roleMeta(
  roleKey: string,
  assignableRoles: AssignableRoleOption[],
): AssignableRoleOption | undefined {
  return assignableRoles.find((r) => r.key === roleKey);
}

function scopeForRoleKey(
  roleKey: string,
  assignableRoles: AssignableRoleOption[],
): DataScopeLevel {
  const fromRbac = roleMeta(roleKey, assignableRoles);
  if (fromRbac) return fromRbac.scopeLevel;
  return STATIC_SCOPE_FALLBACK[roleKey] ?? 'own';
}

function roleParentKey(
  roleKey: string,
  assignableRoles: AssignableRoleOption[],
): string | null {
  return roleMeta(roleKey, assignableRoles)?.parentKey ?? null;
}

/** Role key plus all ancestor role keys via parentKey chain. */
function roleAncestorKeys(
  roleKey: string,
  assignableRoles: AssignableRoleOption[],
): Set<string> {
  const keys = new Set<string>();
  let current: string | null = roleKey;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    keys.add(current);
    current = roleParentKey(current, assignableRoles);
  }
  return keys;
}

/** Team-scope roles that sit on the leader row (direct children of director in RBAC). */
const STATIC_DIRECTOR_BRANCH_TEAM_KEYS = ['operations_manager', 'recruitment_manager'];

/** True when role is a direct child of director in Settings → Roles (e.g. OM, recruitment manager). */
function isDirectorBranchRole(
  roleKey: string,
  assignableRoles: AssignableRoleOption[],
): boolean {
  const parent = roleParentKey(roleKey, assignableRoles);
  if (parent === 'director') return true;
  if (assignableRoles.length === 0) {
    return STATIC_DIRECTOR_BRANCH_TEAM_KEYS.includes(roleKey);
  }
  return false;
}

/** Filter domain for the Recruitment vs Marketing scope split (recruitment pages show recruiters only). */
export type ScopeDomain = 'marketing' | 'recruitment';

/** Role keys that belong to the Recruitment branch (recruitment_manager + its reports). */
function isRecruitmentRoleKey(roleKey: string, assignableRoles: AssignableRoleOption[]): boolean {
  if (roleKey === 'recruitment_manager' || roleKey === 'recruiter' || roleKey === 'sr_recruiter') {
    return true;
  }
  return roleAncestorKeys(roleKey, assignableRoles).has('recruitment_manager');
}

/** Role keys that belong to the Marketing / Sales branch. */
function isMarketingRoleKey(roleKey: string, assignableRoles: AssignableRoleOption[]): boolean {
  if (roleKey === 'sales_manager') return true;
  const anc = roleAncestorKeys(roleKey, assignableRoles);
  return anc.has('sales_manager');
}

/**
 * Restrict the hierarchy to a single domain's people + role tree.
 *
 * Recruitment: keep only recruitment roles and reparent `recruitment_manager`
 * off the director branch so it becomes the manager (team) tier — otherwise it
 * is classified as a leader and the manager/team rows come out empty.
 * `domain` undefined → inputs returned unchanged (every non-recruitment page).
 */
function applyHierarchyDomain(
  agencyUsers: ApiUser[],
  assignableRoles: AssignableRoleOption[],
  domain: ScopeDomain | undefined,
): { users: ApiUser[]; roles: AssignableRoleOption[] } {
  if (!domain) return { users: agencyUsers, roles: assignableRoles };
  // Use the canonical tree on first paint (before /roles/assignable resolves) so
  // domain classification + reparenting are correct even without loaded roles.
  const baseRoles = assignableRoles.length ? assignableRoles : STATIC_ASSIGNABLE_ROLES;
  const inDomain = (roleKey: string) =>
    domain === 'recruitment'
      ? isRecruitmentRoleKey(roleKey, baseRoles)
      : isMarketingRoleKey(roleKey, baseRoles);
  const users = agencyUsers.filter((u) => inDomain(u.role));
  const roles =
    domain === 'recruitment'
      ? baseRoles.map((r) =>
          r.key === 'recruitment_manager' && r.parentKey === 'director'
            ? { ...r, parentKey: 'company_director' }
            : r,
        )
      : baseRoles;
  return { users, roles };
}

/** Exactly one filter tier per user (priority: leader > team > own). */
export function userFilterTier(
  user: ApiUser,
  assignableRoles: AssignableRoleOption[],
): HierarchyFilterTierId | null {
  const scope = scopeForRoleKey(user.role, assignableRoles);
  if (scope === 'global' || AGENCY_FLAT_ROLE_KEYS.has(user.role)) return null;
  if (scope === 'agency') {
    if (CHIP_HIDDEN_ROLE_KEYS.has(user.role) || AGENCY_FLAT_ROLE_KEYS.has(user.role)) return null;
    return 'leader';
  }
  if (scope === 'team') {
    if (isDirectorBranchRole(user.role, assignableRoles)) return 'leader';
    return 'team';
  }
  if (scope === 'own') return 'own';
  return null;
}

function pluralizeRoleLabel(name: string): string {
  if (name.endsWith('s')) return name;
  if (name.endsWith('Recruiter')) return name.replace(/Recruiter$/, 'Recruiters');
  if (name.endsWith('Manager')) return name.replace(/Manager$/, 'Managers');
  if (name.endsWith('Director')) return name.replace(/Director$/, 'Directors');
  if (name.endsWith('Associate')) return name.replace(/Associate$/, 'Associates');
  if (name.endsWith('Executive')) return name.replace(/Executive$/, 'Executives');
  if (name.endsWith('Specialist')) return name.replace(/Specialist$/, 'Specialists');
  return `${name}s`;
}

export function buildTierAllLabel(
  roleKeys: string[],
  assignableRoles: AssignableRoleOption[],
  fallback: string,
): string {
  if (roleKeys.length === 0) return fallback;
  if (roleKeys.length === 1) {
    const name = getRoleLabel(roleKeys[0]!, assignableRoles);
    return `All ${pluralizeRoleLabel(name)}`;
  }
  const scopes = new Set(roleKeys.map((k) => scopeForRoleKey(k, assignableRoles)));
  if (scopes.size === 1) {
    const scope = [...scopes][0]!;
    if (scope === 'team') return 'All Managers';
    if (scope === 'own') return 'All Team';
    if (scope === 'agency') return 'All Leaders';
  }
  return fallback;
}

function roleKeysForLeaderTier(assignableRoles: AssignableRoleOption[]): string[] {
  const keys = new Set<string>();
  for (const r of assignableRoles) {
    if (CHIP_HIDDEN_ROLE_KEYS.has(r.key) || AGENCY_FLAT_ROLE_KEYS.has(r.key)) continue;
    if (r.scopeLevel === 'agency') keys.add(r.key);
    if (r.scopeLevel === 'team' && r.parentKey === 'director') keys.add(r.key);
  }
  if (keys.size === 0) {
    keys.add('director');
    keys.add('company_director');
    for (const k of STATIC_DIRECTOR_BRANCH_TEAM_KEYS) keys.add(k);
  }
  return [...keys];
}

function roleKeysForScope(
  assignableRoles: AssignableRoleOption[],
  scope: DataScopeLevel,
  exclude: Set<string> = new Set(),
): string[] {
  const keys = new Set<string>();
  for (const r of assignableRoles) {
    if (r.scopeLevel === scope && !exclude.has(r.key)) keys.add(r.key);
  }
  if (keys.size === 0) {
    for (const [key, level] of Object.entries(STATIC_SCOPE_FALLBACK)) {
      if (level === scope && !exclude.has(key)) keys.add(key);
    }
  }
  if (scope === 'team') {
    for (const k of [...keys]) {
      if (isDirectorBranchRole(k, assignableRoles)) keys.delete(k);
    }
  }
  return [...keys];
}

/** Leader row chip order (matches Settings → Roles tree under director). */
const LEADER_TIER_ROLE_ORDER: Record<string, number> = {
  director: 0,
  company_director: 10,
  operations_manager: 20,
  recruitment_manager: 30,
};

function leaderTierSortRank(roleKey: string): number {
  return LEADER_TIER_ROLE_ORDER[roleKey] ?? 50;
}

function partitionUsers(
  agencyUsers: ApiUser[],
  assignableRoles: AssignableRoleOption[],
): { leaders: ApiUser[]; managers: ApiUser[]; associates: ApiUser[] } {
  const leaders: ApiUser[] = [];
  const managers: ApiUser[] = [];
  const associates: ApiUser[] = [];
  for (const u of agencyUsers) {
    const tier = userFilterTier(u, assignableRoles);
    if (tier === 'leader') leaders.push(u);
    else if (tier === 'team') managers.push(u);
    else if (tier === 'own') associates.push(u);
  }
  const byName = (a: ApiUser, b: ApiUser) => fullName(a).localeCompare(fullName(b));
  leaders.sort((a, b) => {
    const byRole = leaderTierSortRank(a.role) - leaderTierSortRank(b.role);
    return byRole !== 0 ? byRole : byName(a, b);
  });
  managers.sort(byName);
  associates.sort(byName);
  return { leaders, managers, associates };
}

/** Agency leader row — when viewer can see agency-scope leaders below them. */
export function shouldShowLeaderTier(
  viewerRoleKey: string | undefined,
  viewerScope: DataScopeLevel,
  agencyUsers: ApiUser[],
  assignableRoles: AssignableRoleOption[],
  viewerHasCrossOrg = false,
): boolean {
  if (!viewerRoleKey || viewerRoleKey === 'company_director') return false;
  const canViewLeaderRow =
    SCOPE_RANK[viewerScope] >= SCOPE_RANK.agency || viewerHasCrossOrg || viewerRoleKey === 'super_admin';
  if (!canViewLeaderRow) return false;
  const { leaders } = partitionUsers(agencyUsers, assignableRoles);
  return leaders.length > 0;
}

/** Users who report (directly or indirectly) to rootId. */
function reportingSubtreeIds(rootId: string, agencyUsers: ApiUser[]): Set<string> {
  const ids = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const u of agencyUsers) {
      if (u.reportingManagerIds?.some((mid) => ids.has(mid)) && !ids.has(u.id)) {
        ids.add(u.id);
        changed = true;
      }
    }
  }
  return ids;
}

function isManagerUnderLeader(
  leader: ApiUser,
  manager: ApiUser,
  agencyUsers: ApiUser[],
  assignableRoles: AssignableRoleOption[],
): boolean {
  if (manager.reportingManagerIds?.includes(leader.id)) return true;

  const subtree = reportingSubtreeIds(leader.id, agencyUsers);
  if (manager.reportingManagerIds?.some((id) => subtree.has(id))) return true;

  const parentKey = roleParentKey(manager.role, assignableRoles);
  if (parentKey === leader.role) {
    const ancestorKeys = roleAncestorKeys(manager.role, assignableRoles);
    return (
      manager.reportingManagerIds?.some((rmid) => {
        const rep = agencyUsers.find((u) => u.id === rmid);
        return rep != null && ancestorKeys.has(rep.role);
      }) ?? false
    );
  }

  return false;
}

function managersUnderLeader(
  leaderId: string,
  allManagers: ApiUser[],
  agencyUsers: ApiUser[],
  assignableRoles: AssignableRoleOption[],
): ApiUser[] {
  const leader = agencyUsers.find((u) => u.id === leaderId);
  if (!leader) return allManagers;
  return allManagers.filter((m) => isManagerUnderLeader(leader, m, agencyUsers, assignableRoles));
}

function ownScopeUnderManager(ownUsers: ApiUser[], managerId: string): ApiUser[] {
  return ownUsers.filter((u) => u.reportingManagerIds?.includes(managerId));
}

function ownScopeUnderManagers(ownUsers: ApiUser[], managerIds: Set<string>): ApiUser[] {
  if (managerIds.size === 0) return ownUsers;
  return ownUsers.filter((u) => u.reportingManagerIds?.some((id) => managerIds.has(id)));
}

export type HierarchyFilterSelections = {
  leaderId: string;
  managerId: string;
  userId: string;
};

export type HierarchyFilterResult = {
  tiers: HierarchyFilterTier[];
  managers: ApiUser[];
  associates: ApiUser[];
  visibleAssociates: ApiUser[];
  getAssociatesForManager: (managerId: string) => ApiUser[];
  getUsersForLeader: (leaderId: string) => ApiUser[];
  getManagersForLeader: (leaderId: string) => ApiUser[];
};

export type BuildHierarchyFilterOptions = {
  viewerUserId?: string;
  viewerHasCrossOrg?: boolean;
  /** Fallback when viewer is not in agencyUsers (e.g. org-level role). */
  viewerApiUser?: ApiUser;
  /** Restrict chips to a single domain (recruitment pages show recruiters only). */
  domain?: ScopeDomain;
};

function usersInReportingSubtree(rootId: string, agencyUsers: ApiUser[]): ApiUser[] {
  const subtree = reportingSubtreeIds(rootId, agencyUsers);
  return agencyUsers.filter((u) => subtree.has(u.id));
}

export function buildHierarchyFilter(
  agencyUsersInput: ApiUser[],
  assignableRolesInput: AssignableRoleOption[],
  viewerRoleKey: string | undefined,
  viewerScope: DataScopeLevel,
  selections: HierarchyFilterSelections,
  options?: BuildHierarchyFilterOptions | string,
): HierarchyFilterResult {
  const opts: BuildHierarchyFilterOptions =
    typeof options === 'string' ? { viewerUserId: options } : (options ?? {});
  const viewerUserId = opts.viewerUserId;
  const viewerHasCrossOrg = opts.viewerHasCrossOrg ?? false;
  const domain = opts.domain;

  // Recruitment/Marketing split: narrow users + role tree before any tier work.
  const { users: agencyUsers, roles: assignableRoles } = applyHierarchyDomain(
    agencyUsersInput,
    assignableRolesInput,
    domain,
  );

  const teamRoleKeys = roleKeysForScope(assignableRoles, 'team');
  const ownRoleKeys = roleKeysForScope(assignableRoles, 'own');
  const leaderRoleKeys = roleKeysForLeaderTier(assignableRoles);

  const { leaders: allLeaders, managers: allManagers, associates: allAssociates } = partitionUsers(
    agencyUsers,
    assignableRoles,
  );

  // Recruitment view is a hard filter: managers (recruitment managers) + team
  // (recruiters) only — no leader row (no director / ops chips).
  const showLeader =
    domain === 'recruitment'
      ? false
      : shouldShowLeaderTier(
          viewerRoleKey,
          viewerScope,
          agencyUsers,
          assignableRoles,
          viewerHasCrossOrg,
        );
  const isCompanyDirectorViewer = viewerRoleKey === 'company_director' && !!viewerUserId;
  const managerDrilled = isDrilledToPerson(selections.managerId, viewerUserId);
  const leaderViewingSelf = showLeader && isSelfSelection(selections.leaderId, viewerUserId);

  let visibleManagers = allManagers;
  let visibleAssociates = allAssociates;

  if (isCompanyDirectorViewer) {
    visibleManagers = managersUnderLeader(
      viewerUserId!,
      allManagers,
      agencyUsers,
      assignableRoles,
    );
    const viewingSelf = isSelfSelection(selections.managerId, viewerUserId);
    const mgrIds = new Set(visibleManagers.map((m) => m.id));
    mgrIds.add(viewerUserId!);
    if (selections.managerId !== 'all' && !viewingSelf) {
      visibleAssociates = ownScopeUnderManager(allAssociates, selections.managerId);
    } else {
      visibleAssociates = ownScopeUnderManagers(allAssociates, mgrIds);
    }
  } else if (leaderViewingSelf) {
    // Viewer on leader row selected self — keep full manager list; show team when drilling managers
    visibleManagers = allManagers;
    if (managerDrilled) {
      visibleAssociates = ownScopeUnderManager(allAssociates, selections.managerId);
    } else if (selections.managerId === 'all') {
      visibleAssociates = ownScopeUnderManagers(
        allAssociates,
        new Set(allManagers.map((m) => m.id)),
      );
    } else {
      visibleAssociates = [];
    }
  } else if (showLeader && selections.leaderId !== 'all') {
    visibleManagers = managersUnderLeader(
      selections.leaderId,
      allManagers,
      agencyUsers,
      assignableRoles,
    );
    if (selections.managerId !== 'all') {
      visibleAssociates = ownScopeUnderManager(allAssociates, selections.managerId);
    } else {
      const mgrIds = new Set(visibleManagers.map((m) => m.id));
      mgrIds.add(selections.leaderId);
      visibleAssociates = ownScopeUnderManagers(allAssociates, mgrIds);
    }
  } else if (selections.managerId !== 'all') {
    visibleAssociates = ownScopeUnderManager(allAssociates, selections.managerId);
  }

  const tiers: HierarchyFilterTier[] = [];
  const homeTier = resolveViewerHomeTier(viewerRoleKey, assignableRoles, {
    isCompanyDirectorViewer,
    showLeader,
  });
  // Full director → manager → associate chain whenever managers and associates exist
  const showManagerTier = TIER_RANK[homeTier] <= TIER_RANK.team && allManagers.length > 0;
  const showUserTier = showManagerTier && allAssociates.length > 0;

  if (TIER_RANK[homeTier] <= TIER_RANK.leader && showLeader && allLeaders.length > 0) {
    tiers.push({
      id: 'leader',
      paramKey: 'leaderId',
      allLabel: LEADER_TIER_ALL_LABEL,
      roleKeys: leaderRoleKeys,
      users: allLeaders,
      visibleUsers: chipUsers(allLeaders, viewerUserId),
      // Lead is not listed inside their own subordinate row (same rule as managers).
      viewerSelfChip: undefined,
    });
  }

  if (TIER_RANK[homeTier] <= TIER_RANK.team && allManagers.length > 0) {
    tiers.push({
      id: 'team',
      paramKey: 'managerId',
      allLabel:
        domain === 'recruitment'
          ? 'All Recruitment Managers'
          : buildTierAllLabel(teamRoleKeys, assignableRoles, 'All Managers'),
      roleKeys: teamRoleKeys,
      users: allManagers,
      visibleUsers: chipUsers(visibleManagers, viewerUserId),
      // Director/manager is the lead — never show "Me" inside Sales Managers.
      viewerSelfChip: undefined,
    });
  }

  if (showUserTier) {
    tiers.push({
      id: 'own',
      paramKey: 'userId',
      allLabel:
        domain === 'recruitment'
          ? 'All Recruiters'
          : buildTierAllLabel(ownRoleKeys, assignableRoles, 'All Team'),
      roleKeys: ownRoleKeys,
      users: allAssociates,
      visibleUsers: chipUsers(visibleAssociates, viewerUserId),
      viewerSelfChip: undefined,
    });
  }

  const getAssociatesForManager = (managerId: string): ApiUser[] =>
    ownScopeUnderManager(allAssociates, managerId);

  const getUsersForLeader = (leaderId: string): ApiUser[] => {
    const leader = agencyUsers.find((u) => u.id === leaderId);
    if (!leader) return [];

    const ids = new Set<string>([leaderId]);
    for (const u of usersInReportingSubtree(leaderId, agencyUsers)) ids.add(u.id);

    const mgrs = managersUnderLeader(leaderId, allManagers, agencyUsers, assignableRoles);
    for (const m of mgrs) ids.add(m.id);

    const scopeIds = new Set([leaderId, ...mgrs.map((m) => m.id)]);
    for (const u of ownScopeUnderManagers(allAssociates, scopeIds)) ids.add(u.id);

    return agencyUsers.filter((u) => ids.has(u.id));
  };

  const getManagersForLeader = (leaderId: string): ApiUser[] =>
    managersUnderLeader(leaderId, allManagers, agencyUsers, assignableRoles);

  return {
    tiers,
    managers: allManagers,
    associates: allAssociates,
    visibleAssociates,
    getAssociatesForManager,
    getUsersForLeader,
    getManagersForLeader,
  };
}

/** Single user-tier filter for team-scope managers (sales_manager, etc.). */
export function buildTeamManagerFilter(
  teamMembers: ApiUser[],
  assignableRoles: AssignableRoleOption[],
  viewerApiUser?: ApiUser,
): HierarchyFilterResult {
  const ownRoleKeys = roleKeysForScope(assignableRoles, 'own');
  const sorted = [...teamMembers].sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const associateChips = chipUsers(sorted, viewerApiUser?.id);

  const tier: HierarchyFilterTier = {
    id: 'own',
    paramKey: 'userId',
    allLabel: 'All Team',
    roleKeys: ownRoleKeys,
    users: sorted,
    visibleUsers: associateChips,
    // Manager is the lead — not listed in the team row (same as act-as Michelle's Team).
    viewerSelfChip: undefined,
  };

  const getAssociatesForManager = (managerId: string): ApiUser[] => {
    // teamMembers are already direct reports for this manager
    if (!viewerApiUser || managerId === viewerApiUser.id) return sorted;
    return ownScopeUnderManager(sorted, managerId);
  };

  return {
    tiers: viewerApiUser || sorted.length > 0 ? [tier] : [],
    managers: [],
    associates: sorted,
    visibleAssociates: sorted,
    getAssociatesForManager,
    getUsersForLeader: () => sorted,
    getManagersForLeader: () => [],
  };
}

function fullName(u: ApiUser): string {
  return `${u.firstName} ${u.lastName}`.trim();
}

/** Chips list people at this tier excluding the viewer (viewer uses linked/own chip, not "Me" in subordinates). */
function chipUsers(users: ApiUser[], viewerUserId?: string): ApiUser[] {
  if (!viewerUserId) return users;
  return users.filter((u) => u.id !== viewerUserId);
}
