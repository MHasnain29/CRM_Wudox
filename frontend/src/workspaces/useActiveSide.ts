import { useAuthStore } from '@/lib/authStore';
import { workspaceAccessFromPermissions, type WorkspaceSide } from './config';
import { useWorkspaceStore } from './store';

/**
 * Active workspace side: derived from the user's Settings → Roles permissions.
 * Switchable (and persisted) when the role has both marketing and recruitment modules.
 */
export function useActiveSide(): {
  side: WorkspaceSide;
  canSwitch: boolean;
  setSide: (side: WorkspaceSide) => void;
} {
  const permissions = useAuthStore((s) => s.permissions);
  const storedSide = useWorkspaceStore((s) => s.activeSide);
  const setSide = useWorkspaceStore((s) => s.setActiveSide);
  const { canSwitch, defaultSide } = workspaceAccessFromPermissions(permissions);
  return { side: canSwitch ? storedSide : defaultSide, canSwitch, setSide };
}
