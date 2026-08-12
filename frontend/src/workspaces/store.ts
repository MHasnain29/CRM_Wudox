import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WorkspaceSide } from './config';

interface WorkspaceSideState {
  activeSide: WorkspaceSide;
  setActiveSide: (side: WorkspaceSide) => void;
}

/** Persisted active side for super users (non-super roles ignore it — see useActiveSide). */
export const useWorkspaceStore = create<WorkspaceSideState>()(
  persist(
    (set) => ({
      activeSide: 'marketing',
      setActiveSide: (activeSide) => set({ activeSide }),
    }),
    { name: 'crm-workspace-side' },
  ),
);
