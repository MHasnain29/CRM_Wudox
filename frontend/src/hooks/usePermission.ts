import { useAuthStore } from '@/lib/authStore';

/**
 * Returns true if the current user has at least one of the given permissions.
 * Super admin is inferred when all permissions are present (login payload).
 */
export function usePermission(...required: string[]): boolean {
  const permissions = useAuthStore((s) => s.permissions);
  if (required.length === 0) return true;
  return required.some((p) => permissions.includes(p));
}

export function useHasAllPermissions(...required: string[]): boolean {
  const permissions = useAuthStore((s) => s.permissions);
  if (required.length === 0) return true;
  return required.every((p) => permissions.includes(p));
}
