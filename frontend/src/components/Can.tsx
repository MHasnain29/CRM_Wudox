import type { ReactNode } from 'react';
import { useHasAllPermissions, usePermission } from '@/hooks/usePermission';

type CanProps = {
  /** User must have at least one of these permissions (nothing rendered if not). */
  permission?: string | string[];
  /** User must have all listed permissions. */
  allPermissions?: string[];
  children: ReactNode;
};

/**
 * Renders children only when the user has the required permission(s).
 * Unauthorized: renders nothing (no disabled buttons).
 */
export function Can({ permission, allPermissions, children }: CanProps) {
  const required = permission
    ? Array.isArray(permission)
      ? permission
      : [permission]
    : [];
  const hasAny = usePermission(...required);
  const hasAll = useHasAllPermissions(...(allPermissions ?? []));

  if (required.length > 0 && !hasAny) return null;
  if ((allPermissions?.length ?? 0) > 0 && !hasAll) return null;

  return <>{children}</>;
}
