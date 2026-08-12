/**
 * @deprecated Import from `@/lib/access` instead. Re-exports for gradual migration.
 */
import {
  canAccessMultipleAgencies,
  canViewTeamScope,
  getDataScopeLevel,
} from './access';

export {
  type DataScopeLevel,
  canAccessMultipleAgencies,
  canActOnLeads,
  canViewAgencyScope,
  canViewGlobalScope,
  canViewTeamScope,
  getDataScopeLevel,
  hasPermission,
  isOwnScope,
  useCanAccessMultipleAgencies,
  useCanActOnLeads,
  useCanViewAgencyScope,
  useCanViewGlobalScope,
  useCanViewTeamScope,
  useDataScopeLevel,
  useHasPermission,
  useIsOwnScope,
  usePermissions,
} from './access';

/** @deprecated Use `useIsOwnScope()` / `getDataScopeLevel() === 'own'` */
export function isAssociateRole(_role: string | undefined | null): boolean {
  return getDataScopeLevel() === 'own';
}

/** @deprecated Use `useCanAccessMultipleAgencies()` */
export function isElevatedRole(_role: string | undefined | null): boolean {
  return canAccessMultipleAgencies();
}

/** @deprecated Use `useCanViewTeamScope()` */
export function isManagerRole(_role: string | undefined | null): boolean {
  return canViewTeamScope();
}
