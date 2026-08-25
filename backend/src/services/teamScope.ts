/**
 * Team / hierarchy scope for daily activity and other cross-module views.
 */
import prisma from '../config/database';
import type { JwtPayload } from '../middleware/auth';
import { getUserRoleTitleSync } from './rbac';
import { resolveAllowedSubCompanyIds } from '../config/agencyScope';
import {
  buildAccessContext,
  canAccessMultipleAgencies,
  canViewAllDataInAgency,
  canViewTeamData,
  getUserRoleEnumKeysForScopeLevels,
  type AccessContext,
} from './accessContext';
import { getDataScopeLevelForRoleKey } from './rbac';
import { findOrgDirectorForAgency, findOrgDirectorIdsForAgency } from './companyDirectorReporting';

export type VisibilityTier = 'own' | 'team' | 'agency_tree' | 'agency_flat';

const AGENCY_FLAT_ROLE_KEYS = ['dev_team', 'it'] as const;

export interface ScopedUser {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  roleLabel: string;
  reportingManagerIds: string[];
}

export interface TeamTreeCounters {
  total: number;
  today: number;
  pending: number;
  overdue: number;
  awaiting_approval: number;
  completed_today: number;
  action_today: number;
}

export interface TeamTreeNode {
  user: ScopedUser;
  counters: TeamTreeCounters;
  children: TeamTreeNode[];
  isUnassignedGroup?: boolean;
}

export function getVisibilityTierFromContext(ctx: AccessContext): VisibilityTier {
  if ((AGENCY_FLAT_ROLE_KEYS as readonly string[]).includes(ctx.roleKey)) {
    return 'agency_flat';
  }
  if (canViewAllDataInAgency(ctx)) return 'agency_tree';
  if (canViewTeamData(ctx)) return 'team';
  return 'own';
}

/** Resolve visibility tier from effective RBAC scope (permissions + DB scope_level). */
export async function getVisibilityTier(
  role: string | undefined,
  viewer?: JwtPayload,
): Promise<VisibilityTier> {
  if (!role) return 'own';
  if (viewer?.sub) {
    const ctx = await buildAccessContext(viewer);
    return getVisibilityTierFromContext(ctx);
  }
  const scope = await getDataScopeLevelForRoleKey(role);
  if (!scope) return 'own';
  const ctx: AccessContext = {
    userId: '',
    roleKey: role,
    subCompanyId: '',
    permissions: [],
    scopeLevel: scope,
  };
  return getVisibilityTierFromContext(ctx);
}

export function formatUserName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim() || 'Unknown';
}

function toScopedUser(u: {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  userType?: string | null;
  reportingManagerIds: string[];
}): ScopedUser {
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    roleLabel: getUserRoleTitleSync(u),
    reportingManagerIds: u.reportingManagerIds ?? [],
  };
}

/** Active users in one or more agencies (excludes global-scope roles from hierarchy display). */
export async function fetchAgencyUsers(subCompanyIds: string | string[]): Promise<ScopedUser[]> {
  const ids = Array.isArray(subCompanyIds) ? subCompanyIds : [subCompanyIds];
  if (ids.length === 0) return [];

  const excludeRoles = await getUserRoleEnumKeysForScopeLevels(['global']);

  const rows = await prisma.user.findMany({
    where: {
      subCompanyId: ids.length === 1 ? ids[0] : { in: ids },
      isActive: true,
      ...(excludeRoles.length > 0 ? { role: { notIn: excludeRoles } } : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
      userType: true,
      reportingManagerIds: true,
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  return rows.map(toScopedUser);
}

/** Directors / ops leads for agency tree root (not in fetchAgencyUsers). */
export async function fetchAgencyDirectors(subCompanyIds: string | string[]): Promise<ScopedUser[]> {
  const ids = Array.isArray(subCompanyIds) ? subCompanyIds : [subCompanyIds];
  if (ids.length === 0) return [];

  const leaderRoles = await getUserRoleEnumKeysForScopeLevels(['agency', 'global']);
  const rows = await prisma.user.findMany({
    where: {
      subCompanyId: ids.length === 1 ? ids[0] : { in: ids },
      isActive: true,
      ...(leaderRoles.length > 0 ? { role: { in: leaderRoles } } : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
      userType: true,
      reportingManagerIds: true,
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  return rows.map(toScopedUser);
}

/**
 * Org Director user for cross-org hierarchy when the agency has no director-tier user
 * in that sub-company (e.g. Vancouver — John Director lives in Toronto).
 */
async function fetchOrgDirectorForCrossOrgTree(
  agencyId: string,
  viewerCtx: AccessContext,
): Promise<ScopedUser | null> {
  if (!canAccessMultipleAgencies(viewerCtx)) return null;

  const orgDirectorId = await findOrgDirectorForAgency(agencyId);
  if (!orgDirectorId) return null;

  const row = await prisma.user.findUnique({
    where: { id: orgDirectorId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
      userType: true,
      reportingManagerIds: true,
    },
  });
  return row ? toScopedUser(row) : null;
}

const scopeFilterUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  userType: true,
  subCompanyId: true,
  locationId: true,
  country: true,
  phone: true,
  isActive: true,
  dailyCallsTarget: true,
  dailyEmailsTarget: true,
  dailyMeetingScheduleTarget: true,
  reportingManagerIds: true,
  accessibleLocationIds: true,
  workStartTime: true,
  workEndTime: true,
} as const;

/**
 * Active users for page scope-filter chips (agency → leaders → managers → field staff).
 * Includes in-agency users plus org Director and OMs assigned to this agency (cross-org).
 * Excludes global-scope roles only (super_admin, database_manager).
 */
export async function fetchScopeFilterMembers(subCompanyId: string) {
  const excludeRoles = await getUserRoleEnumKeysForScopeLevels(['global']);

  const base = await prisma.user.findMany({
    where: {
      subCompanyId,
      isActive: true,
      ...(excludeRoles.length > 0 ? { role: { notIn: excludeRoles } } : {}),
    },
    select: scopeFilterUserSelect,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });

  const byId = new Map(base.map((u) => [u.id, u]));

  const orgDirectorIds = await findOrgDirectorIdsForAgency(subCompanyId);
  for (const directorId of orgDirectorIds) {
    if (byId.has(directorId)) continue;
    const row = await prisma.user.findUnique({
      where: { id: directorId },
      select: scopeFilterUserSelect,
    });
    if (row?.isActive) byId.set(row.id, row);
  }

  const assignedOpsManagers = await prisma.user.findMany({
    where: {
      role: 'operations_manager',
      isActive: true,
      OR: [
        { managedSubCompanies: { some: { subCompanyId } } },
        { subCompanyId },
        ...(orgDirectorIds.length > 0
          ? [{ subCompanyId: null, reportingManagerIds: { hasSome: orgDirectorIds } }]
          : []),
      ],
    },
    select: scopeFilterUserSelect,
  });
  for (const u of assignedOpsManagers) {
    byId.set(u.id, u);
  }

  return [...byId.values()].sort((a, b) => {
    const ln = a.lastName.localeCompare(b.lastName);
    if (ln !== 0) return ln;
    return a.firstName.localeCompare(b.firstName);
  });
}

/** Self + direct reportees for managers. */
export async function fetchTeamUserIds(managerId: string, subCompanyId: string): Promise<string[]> {
  const reportees = await prisma.user.findMany({
    where: {
      subCompanyId,
      isActive: true,
      reportingManagerIds: { has: managerId },
    },
    select: { id: true },
  });
  return [managerId, ...reportees.map((u) => u.id)];
}

/**
 * Agencies included in daily activity (and tree).
 * - super_admin, no filter → all agencies in org
 * - director / operations_manager, no filter → home agency only (not whole org)
 * - explicit ?agencyIds= → intersection with allowed
 */
export async function resolveEffectiveAgencyIds(
  viewer: JwtPayload,
  requestedAgencyIds: string[] = [],
): Promise<string[]> {
  const allowed = await resolveAllowedSubCompanyIds(viewer);
  const homeId = viewer.subCompanyId;

  if (requestedAgencyIds.length > 0) {
    const filtered = requestedAgencyIds.filter((id) => allowed.includes(id));
    if (filtered.length > 0) return filtered;
    return homeId && allowed.includes(homeId) ? [homeId] : allowed;
  }

  const ctx = await buildAccessContext(viewer);
  if (ctx.scopeLevel === 'global') return allowed;

  if (canAccessMultipleAgencies(ctx) && homeId && allowed.includes(homeId)) {
    return [homeId];
  }

  return allowed;
}

async function includeOrgLeadersForAgencies(ids: Set<string>, agencyIds: string[]): Promise<void> {
  for (const agencyId of agencyIds) {
    const orgDirectorIds = await findOrgDirectorIdsForAgency(agencyId);
    for (const dId of orgDirectorIds) ids.add(dId);

    const opsManagers = await prisma.user.findMany({
      where: {
        role: 'operations_manager',
        isActive: true,
        OR: [
          { managedSubCompanies: { some: { subCompanyId: agencyId } } },
          ...(orgDirectorIds.length > 0
            ? [{ subCompanyId: null, reportingManagerIds: { hasSome: orgDirectorIds } }]
            : []),
        ],
      },
      select: { id: true },
    });
    for (const om of opsManagers) ids.add(om.id);
  }
}

export async function getVisibleUserIds(
  viewer: JwtPayload,
  requestedAgencyIds: string[] = [],
): Promise<string[]> {
  const userId = viewer.sub;
  if (!userId) return [];

  const tier = await getVisibilityTier(viewer.role, viewer);
  const ctx = await buildAccessContext(viewer);
  const subCompanyId = viewer.subCompanyId;
  const allowedAgencyIds = await resolveEffectiveAgencyIds(viewer, requestedAgencyIds);

  if (tier === 'own') {
    return [userId];
  }

  if (tier === 'team') {
    const teamAgencyId = subCompanyId ?? allowedAgencyIds[0];
    if (!teamAgencyId) return [userId];
    return fetchTeamUserIds(userId, teamAgencyId);
  }

  // agency_tree | agency_flat — all non-super users across allowed (optionally filtered) agencies
  const users = await fetchAgencyUsers(allowedAgencyIds);
  const ids = new Set(users.map((u) => u.id));
  ids.add(userId);
  await includeOrgLeadersForAgencies(ids, allowedAgencyIds);
  if (canViewAllDataInAgency(ctx)) {
    ids.add(userId);
  }
  return [...ids];
}

/** Returns false if targetUserId is outside viewer's visible set. */
export async function assertUserVisible(
  viewer: JwtPayload,
  targetUserId: string,
): Promise<boolean> {
  const visible = await getVisibleUserIds(viewer);
  return visible.includes(targetUserId);
}

/** Intersect requested IDs with visible set (managers cannot pass foreign userId). */
export async function filterVisibleUserIds(
  viewer: JwtPayload,
  requestedIds: string[],
  requestedAgencyIds: string[] = [],
): Promise<string[]> {
  const visible = new Set(await getVisibleUserIds(viewer, requestedAgencyIds));
  return requestedIds.filter((id) => visible.has(id));
}

/**
 * Build Director → Managers → Associates tree for agency_tree tier.
 * For team tier: single root (viewer) with reportee children.
 * For own: single node (viewer).
 */
export async function buildReportingTree(
  viewer: JwtPayload,
  requestedAgencyIds: string[] = [],
): Promise<TeamTreeNode[]> {
  const userId = viewer.sub!;
  const subCompanyId = viewer.subCompanyId!;
  const tier = await getVisibilityTier(viewer.role, viewer);
  const emptyCounters = (): TeamTreeCounters => ({
    total: 0,
    today: 0,
    pending: 0,
    overdue: 0,
    awaiting_approval: 0,
    completed_today: 0,
    action_today: 0,
  });

  if (tier === 'own') {
    const self = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, role: true, userType: true, reportingManagerIds: true },
    });
    if (!self) return [];
    return [
      {
        user: toScopedUser(self),
        counters: emptyCounters(),
        children: [],
      },
    ];
  }

  if (tier === 'team') {
    const self = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, role: true, userType: true, reportingManagerIds: true },
    });
    if (!self) return [];
    const reportees = await prisma.user.findMany({
      where: {
        subCompanyId,
        isActive: true,
        reportingManagerIds: { has: userId },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        userType: true,
        reportingManagerIds: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return [
      {
        user: toScopedUser(self),
        counters: emptyCounters(),
        children: reportees.map((r) => ({
          user: toScopedUser(r),
          counters: emptyCounters(),
          children: [],
        })),
      },
    ];
  }

  const agencyIds = await resolveEffectiveAgencyIds(viewer, requestedAgencyIds);

  if (tier === 'agency_flat') {
    const users = await fetchAgencyUsers(agencyIds);
    return users.map((u) => ({
      user: u,
      counters: emptyCounters(),
      children: [],
    }));
  }

  const trees: TeamTreeNode[] = [];
  for (const agencyId of agencyIds) {
    trees.push(...(await buildSingleAgencyTree(viewer, agencyId, emptyCounters)));
  }
  return trees;
}

function mapAssociatesToNodes(
  list: ScopedUser[],
  emptyCounters: () => TeamTreeCounters,
): TeamTreeNode[] {
  return list
    .sort((a, b) =>
      formatUserName(a.firstName, a.lastName).localeCompare(
        formatUserName(b.firstName, b.lastName),
      ),
    )
    .map((assoc) => ({
      user: assoc,
      counters: emptyCounters(),
      children: [],
    }));
}

function buildManagerNodes(
  managers: ScopedUser[],
  childrenByManager: Map<string, ScopedUser[]>,
  emptyCounters: () => TeamTreeCounters,
): TeamTreeNode[] {
  return managers.map((mgr) => ({
    user: mgr,
    counters: emptyCounters(),
    children: mapAssociatesToNodes(childrenByManager.get(mgr.id) ?? [], emptyCounters),
  }));
}

function buildUnassignedNode(
  orphans: ScopedUser[],
  emptyCounters: () => TeamTreeCounters,
  filter?: (u: ScopedUser) => boolean,
): TeamTreeNode[] {
  const list = filter ? orphans.filter(filter) : orphans;
  if (list.length === 0) return [];
  return [
    {
      user: {
        id: '__unassigned__',
        firstName: 'Unassigned',
        lastName: '',
        role: 'group',
        roleLabel: 'Team',
        reportingManagerIds: [],
      },
      counters: emptyCounters(),
      isUnassignedGroup: true,
      children: mapAssociatesToNodes(list, emptyCounters),
    },
  ];
}

/**
 * Agency hierarchy: Org Director → Company Director(s) → Sales Managers → associates;
 * other managers and direct reportees sit under Org Director when present.
 */
function buildNestedAgencyTree(
  directors: ScopedUser[],
  managers: ScopedUser[],
  childrenByManager: Map<string, ScopedUser[]>,
  childrenByDirector: Map<string, ScopedUser[]>,
  orphans: ScopedUser[],
  emptyCounters: () => TeamTreeCounters,
  orphanFilter?: (u: ScopedUser) => boolean,
): TeamTreeNode[] {
  const orgDirector = directors.find((d) => d.role === 'director');
  const companyDirectors = directors.filter((d) => d.role === 'company_director');
  const assignedMgrIds = new Set<string>();

  const buildCompanyDirectorNode = (cd: ScopedUser): TeamTreeNode => {
    const salesUnder = managers.filter((m) => {
      if (m.role !== 'sales_manager') return false;
      if (m.reportingManagerIds.includes(cd.id)) return true;
      // Legacy rows: SM still reporting to org Director belongs under agency CD.
      return Boolean(orgDirector && m.reportingManagerIds.includes(orgDirector.id));
    });
    for (const m of salesUnder) assignedMgrIds.add(m.id);
    return {
      user: cd,
      counters: emptyCounters(),
      children: [
        ...buildManagerNodes(salesUnder, childrenByManager, emptyCounters),
        ...mapAssociatesToNodes(childrenByDirector.get(cd.id) ?? [], emptyCounters),
      ],
    };
  };

  const orphanNodes = buildUnassignedNode(orphans, emptyCounters, orphanFilter);

  if (orgDirector) {
    const cdNodes = companyDirectors.map(buildCompanyDirectorNode);
    const managersUnderOrg = managers.filter(
      (m) =>
        !assignedMgrIds.has(m.id) &&
        m.reportingManagerIds.includes(orgDirector.id) &&
        !(m.role === 'sales_manager' && companyDirectors.length > 0),
    );
    for (const m of managersUnderOrg) assignedMgrIds.add(m.id);
    const unassignedMgrs = managers.filter((m) => !assignedMgrIds.has(m.id));

    return [
      {
        user: orgDirector,
        counters: emptyCounters(),
        children: [
          ...cdNodes,
          ...buildManagerNodes(managersUnderOrg, childrenByManager, emptyCounters),
          ...mapAssociatesToNodes(
            (childrenByDirector.get(orgDirector.id) ?? []).filter(
              (u) => u.role !== 'company_director',
            ),
            emptyCounters,
          ),
          ...buildManagerNodes(unassignedMgrs, childrenByManager, emptyCounters),
          ...orphanNodes,
        ],
      },
    ];
  }

  if (companyDirectors.length === 1) {
    const cdNode = buildCompanyDirectorNode(companyDirectors[0]!);
    const remainingManagers = managers.filter(
      (m) => !assignedMgrIds.has(m.id) && m.role !== 'sales_manager',
    );
    return [
      {
        ...cdNode,
        children: [
          ...cdNode.children,
          ...buildManagerNodes(remainingManagers, childrenByManager, emptyCounters),
        ],
      },
      ...orphanNodes,
    ];
  }

  if (companyDirectors.length > 1) {
    const cdNodes = companyDirectors.map(buildCompanyDirectorNode);
    const remainingManagers = managers.filter((m) => !assignedMgrIds.has(m.id));
    return [
      ...cdNodes,
      ...buildManagerNodes(remainingManagers, childrenByManager, emptyCounters),
      ...orphanNodes,
    ];
  }

  return [
    ...buildManagerNodes(managers, childrenByManager, emptyCounters),
    ...orphanNodes,
  ];
}

/** One agency only — never mix users from other sub-companies. */
async function buildSingleAgencyTree(
  viewer: JwtPayload,
  agencyId: string,
  emptyCounters: () => TeamTreeCounters,
): Promise<TeamTreeNode[]> {
  const viewerId = viewer.sub!;
  const allUsers = await fetchAgencyUsers([agencyId]);
  let directors = await fetchAgencyDirectors([agencyId]);
  const viewerCtx = await buildAccessContext(viewer);

  if (!directors.some((d) => d.role === 'director')) {
    const orgDirector = await fetchOrgDirectorForCrossOrgTree(agencyId, viewerCtx);
    if (orgDirector) {
      directors = [orgDirector, ...directors];
    }
  }

  const directorIds = new Set(directors.map((d) => d.id));
  const managerRoleKeys = new Set<string>(
    (await getUserRoleEnumKeysForScopeLevels(['team'])).map((r) => String(r)),
  );
  const managerIds = new Set(
    allUsers.filter((u) => managerRoleKeys.has(u.role)).map((u) => u.id),
  );

  const childrenByManager = new Map<string, ScopedUser[]>();
  const childrenByDirector = new Map<string, ScopedUser[]>();
  const orphans: ScopedUser[] = [];

  for (const u of allUsers) {
    if (managerRoleKeys.has(u.role)) continue;
    // Agency/global leaders appear in fetchAgencyDirectors — never treat as associates or orphans.
    if (directorIds.has(u.id)) continue;
    const mgrId = u.reportingManagerIds.find((id) => managerIds.has(id));
    if (mgrId) {
      const list = childrenByManager.get(mgrId) ?? [];
      list.push(u);
      childrenByManager.set(mgrId, list);
      continue;
    }
    const dirId = u.reportingManagerIds.find((id) => directorIds.has(id));
    if (dirId) {
      const list = childrenByDirector.get(dirId) ?? [];
      list.push(u);
      childrenByDirector.set(dirId, list);
      continue;
    }
    orphans.push(u);
  }

  const managers = allUsers
    .filter((u) => managerRoleKeys.has(u.role))
    .sort((a, b) =>
      formatUserName(a.firstName, a.lastName).localeCompare(
        formatUserName(b.firstName, b.lastName),
      ),
    );

  const selfAsDirector = directors.find((d) => d.id === viewerId);

  if (viewerCtx.roleKey === 'company_director' && selfAsDirector) {
    const salesManagers = managers.filter((m) => m.role === 'sales_manager');
    const salesOrphans = orphans.filter((u) =>
      ['sales_associate', 'sales_executive', 'marketing'].includes(u.role),
    );
    return [
      {
        user: selfAsDirector,
        counters: emptyCounters(),
        children: [
          ...buildManagerNodes(salesManagers, childrenByManager, emptyCounters),
          ...buildUnassignedNode(salesOrphans, emptyCounters),
        ],
      },
    ];
  }

  return buildNestedAgencyTree(
    directors,
    managers,
    childrenByManager,
    childrenByDirector,
    orphans,
    emptyCounters,
  );
}
