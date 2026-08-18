/**
 * Marketing / Recruiter side split — single source of truth (UI/product layer only).
 * Maps nav routes and permission-catalog modules to a workspace side.
 * Side access is derived from RBAC permissions (Settings → Roles), not hardcoded role keys.
 */

export type WorkspaceSide = 'marketing' | 'recruitment';
export type WorkspaceSideOrShared = WorkspaceSide | 'shared';
export type WorkspaceAccessSide = WorkspaceSide | 'both' | 'none';

export const SIDE_LABELS: Record<WorkspaceSideOrShared, string> = {
  marketing: 'Marketing',
  recruitment: 'Recruitment',
  shared: 'Shared',
};

/** Sidebar route → side. Routes not listed are shared ('/' is the pinned Dashboard). */
const ROUTE_SIDES: Record<string, WorkspaceSide> = {
  '/clients': 'marketing',
  '/leads': 'marketing',
  '/proposals': 'marketing',
  '/pipeline': 'marketing',
  '/documents': 'marketing',
  '/active-clients': 'recruitment',
  '/jobs': 'recruitment',
  '/employees': 'recruitment',
  '/employee-job-matches': 'recruitment',
};

export function routeSide(route: string): WorkspaceSideOrShared {
  return ROUTE_SIDES[route] ?? 'shared';
}

/** Permission-catalog module (RBAC `module` field) → side; unmapped modules are shared. */
const MODULE_SIDES: Record<string, WorkspaceSideOrShared> = {
  clients: 'marketing',
  client_notes: 'marketing',
  leads: 'marketing',
  pipeline: 'marketing',
  proposals: 'marketing',
  lists: 'marketing',
  /** Shared — every role gets email/calls access by default. */
  calls: 'shared',
  emails: 'shared',
  jobs: 'recruitment',
  employees: 'recruitment',
};

export function permissionModuleSide(module: string | null | undefined): WorkspaceSideOrShared {
  return (module && MODULE_SIDES[module]) || 'shared';
}

/** Map a permission key (`module:action`) to a workspace side via its module prefix. */
export function permissionKeySide(key: string): WorkspaceSideOrShared {
  const module = key.includes(':') ? key.slice(0, key.indexOf(':')) : key;
  return permissionModuleSide(module);
}

export function sidesFromPermissions(keys: readonly string[]): {
  marketing: boolean;
  recruitment: boolean;
} {
  let marketing = false;
  let recruitment = false;
  for (const key of keys) {
    const side = permissionKeySide(key);
    if (side === 'marketing') marketing = true;
    else if (side === 'recruitment') recruitment = true;
    if (marketing && recruitment) break;
  }
  return { marketing, recruitment };
}

export type WorkspaceAccess = {
  canSwitch: boolean;
  /** Side to lock to when not switchable; marketing when both or neither. */
  defaultSide: WorkspaceSide;
  side: WorkspaceAccessSide;
};

/** Derive Marketing / Recruitment switcher access from granted permission keys. */
export function workspaceAccessFromPermissions(keys: readonly string[]): WorkspaceAccess {
  const { marketing, recruitment } = sidesFromPermissions(keys);
  if (marketing && recruitment) {
    return { canSwitch: true, defaultSide: 'marketing', side: 'both' };
  }
  if (recruitment) {
    return { canSwitch: false, defaultSide: 'recruitment', side: 'recruitment' };
  }
  if (marketing) {
    return { canSwitch: false, defaultSide: 'marketing', side: 'marketing' };
  }
  return { canSwitch: false, defaultSide: 'marketing', side: 'none' };
}

export type NavSection<T> = {
  key: string;
  /** null → no header (pinned Dashboard section). */
  label: string | null;
  items: T[];
  /** Rendered as a collapsed/secondary group (other side's items when not switchable). */
  secondary?: boolean;
};

/**
 * Group already-permission-filtered nav items into sections for the active side.
 * Switchable users: the inactive side is hidden entirely (the tabs flip it).
 * Non-switchable: the other side's items they can access show as a secondary collapsed group.
 */
export function groupNavItemsBySide<T extends { to: string }>(
  items: T[],
  activeSide: WorkspaceSide,
  canSwitchSides: boolean,
): NavSection<T>[] {
  const otherSide: WorkspaceSide = activeSide === 'marketing' ? 'recruitment' : 'marketing';
  const pinned = items.filter((i) => i.to === '/');
  const active = items.filter((i) => routeSide(i.to) === activeSide);
  const other = items.filter((i) => routeSide(i.to) === otherSide);
  const shared = items.filter((i) => i.to !== '/' && routeSide(i.to) === 'shared');

  const sections: NavSection<T>[] = [];
  if (pinned.length) sections.push({ key: 'pinned', label: null, items: pinned });
  if (active.length) sections.push({ key: activeSide, label: SIDE_LABELS[activeSide], items: active });
  if (!canSwitchSides && other.length) {
    sections.push({ key: otherSide, label: SIDE_LABELS[otherSide], items: other, secondary: true });
  }
  if (shared.length) sections.push({ key: 'shared', label: SIDE_LABELS.shared, items: shared });
  return sections;
}

/** Group permission-catalog top-level modules under Marketing / Recruiter / Shared headers. */
export function groupPermissionModulesBySide<T>(
  modules: T[],
  moduleOf: (m: T) => string | null | undefined,
): Array<{ key: WorkspaceSideOrShared; label: string; items: T[] }> {
  const order: WorkspaceSideOrShared[] = ['marketing', 'recruitment', 'shared'];
  return order
    .map((side) => ({
      key: side,
      label: side === 'recruitment' ? 'Recruiter' : SIDE_LABELS[side],
      items: modules.filter((m) => permissionModuleSide(moduleOf(m)) === side),
    }))
    .filter((g) => g.items.length > 0);
}
