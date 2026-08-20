/**
 * Clears all client-side session data on logout so the next login starts fresh
 * (agency filters, user filters, React Query cache, in-memory store, etc.).
 */
import { queryClient } from './queryClient';
import { useStore } from './store';
import { useCallStore } from './callStore';
import { clearShown } from './toastTracker';
import {
  TOKEN_KEY,
  REFRESH_KEY,
  SELECTED_AGENCY_KEY,
  AGENCY_FILTER_KEY,
  USER_FILTER_PREFIX,
} from './sessionKeys';

const ACTIVITY_LEADER_KEY = 'activity_leader';

const ZUSTAND_PERSIST_KEYS = [
  // Legacy keys from removed features, kept so logout purges stale data
  // still persisted in existing browsers. 'document-templates-storage' is
  // the only key with a live producer (documentStore.ts).
  'job-store',
  'document-templates-storage',
  'calculator-quotes-storage', // calculators feature removed 2026-08
  'employee-storage',
] as const;

function collectLocalStorageKeys(predicate: (key: string) => boolean): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && predicate(key)) keys.push(key);
    }
  } catch {
    // ignore
  }
  return keys;
}

export function clearClientSessionData(options?: { userId?: string }): void {
  const userId = options?.userId;

  if (userId) clearShown(userId);

  const keysToRemove = new Set<string>([
    TOKEN_KEY,
    REFRESH_KEY,
    SELECTED_AGENCY_KEY,
    AGENCY_FILTER_KEY,
    ACTIVITY_LEADER_KEY,
    ...ZUSTAND_PERSIST_KEYS,
  ]);

  for (const key of collectLocalStorageKeys(
    (k) => k.startsWith(USER_FILTER_PREFIX) || k.startsWith('notif_toasted_'),
  )) {
    keysToRemove.add(key);
  }

  for (const key of keysToRemove) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }

  try {
    sessionStorage.clear();
  } catch {
    // ignore
  }

  try {
    queryClient.clear();
  } catch {
    // ignore
  }

  try {
    const callState = useCallStore.getState();
    callState.destroyDevice();
    if (callState.activeCall) callState.endCall();
    callState.closeCallInterface();
  } catch {
    // ignore
  }

  try {
    useStore.getState().resetSessionData();
  } catch {
    // ignore
  }
}

export { TOKEN_KEY, REFRESH_KEY, SELECTED_AGENCY_KEY, AGENCY_FILTER_KEY, USER_FILTER_PREFIX } from './sessionKeys';
