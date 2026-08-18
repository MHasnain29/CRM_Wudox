import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { usePermission } from '@/hooks/usePermission';
import { useAuthStore } from '@/lib/authStore';

type PermissionRouteProps = {
  /** User needs at least one of these permissions. */
  permission: string | string[];
  children: ReactNode;
  redirectTo?: string;
  /** Redirect if the user's role is in this set (e.g. block software roles from sales routes). */
  excludeRoles?: Set<string>;
};

/** Blocks route when user lacks permission(s) or their role is excluded; redirects to dashboard by default. */
export function PermissionRoute({
  permission,
  children,
  redirectTo = '/',
  excludeRoles,
}: PermissionRouteProps) {
  const allowed = usePermission(
    ...(Array.isArray(permission) ? permission : [permission]),
  );
  const role = useAuthStore((s) => s.user?.role);
  if (!allowed || (excludeRoles && role && excludeRoles.has(role))) {
    return <Navigate to={redirectTo} replace />;
  }
  return <>{children}</>;
}
