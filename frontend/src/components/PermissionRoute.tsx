import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { usePermission } from '@/hooks/usePermission';

type PermissionRouteProps = {
  /** User needs at least one of these permissions. */
  permission: string | string[];
  children: ReactNode;
  redirectTo?: string;
};

/** Blocks route when user lacks permission(s); redirects to dashboard by default. */
export function PermissionRoute({
  permission,
  children,
  redirectTo = '/',
}: PermissionRouteProps) {
  const allowed = usePermission(
    ...(Array.isArray(permission) ? permission : [permission]),
  );
  if (!allowed) return <Navigate to={redirectTo} replace />;
  return <>{children}</>;
}
