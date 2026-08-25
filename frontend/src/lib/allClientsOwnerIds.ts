/**
 * All Clients is the approved visibility pool:
 * - agency-locked clients → only that agency's users
 * - after Client Visibility days (or global-DB add) → every agency
 *
 * Other tabs (Active, Contacted, …) stay people-scoped.
 * Hierarchy / linked / act-as chips still narrow All Clients when explicit.
 */

export function hasExplicitPeopleOwnerFilter(opts: {
  linkedUserIdsRaw?: string | null;
  actAsActive: boolean;
  leaderParamInUrl?: boolean;
  managerParamInUrl?: boolean;
  userParamInUrl?: boolean;
}): boolean {
  if (opts.actAsActive) return true;
  if (opts.linkedUserIdsRaw?.trim()) return true;
  return Boolean(opts.leaderParamInUrl || opts.managerParamInUrl || opts.userParamInUrl);
}

export function ownerIdsForClientsTab(opts: {
  tab: string;
  ownerIds: string[] | undefined;
  explicitPeopleFilter: boolean;
}): string[] | undefined {
  if (opts.tab === 'management') return undefined;
  if (opts.tab === 'all' && !opts.explicitPeopleFilter) return undefined;
  return opts.ownerIds;
}
