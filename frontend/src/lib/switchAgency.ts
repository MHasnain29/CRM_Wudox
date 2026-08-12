/**
 * switchAgency — full session swap to a linked agency account.
 *
 * Does NOT call clearClientSessionData() — that destroys tab-coordination
 * state (ACTIVITY_LEADER_KEY, Twilio Device) which must survive the switch.
 * Instead we do targeted resets only.
 */
import { toast } from 'sonner';
import { queryClient } from './queryClient';
import { TOKEN_KEY, REFRESH_KEY } from './sessionKeys';
import { closeSocket } from './socket';
import { switchAgencyRequest } from './api';
import { useCallStore } from './callStore';

const AGENCY_SWITCH_CHANNEL = 'agency_switch';

/**
 * Perform a seamless switch to a linked agency account.
 * Reloads the page after the switch so all React state is fresh.
 */
export async function switchAgency(targetUserId: string): Promise<void> {
  // Step 1: Guard — block if an active Twilio call is in progress (EC-9.2)
  const callState = useCallStore.getState();
  if (callState.activeCall) {
    toast.error('End your active call before switching agencies.');
    return;
  }

  // Step 2: Cancel all in-flight TanStack queries (EC-3.4)
  await queryClient.cancelQueries();

  // Step 3: Read old refresh token BEFORE the switch so the server can revoke it (EC-2.2)
  let oldRefreshToken: string | undefined;
  try {
    oldRefreshToken = localStorage.getItem(REFRESH_KEY) ?? undefined;
  } catch {
    // ignore storage errors
  }

  // Step 4: Call switch endpoint — handle expired token explicitly (EC-2.4)
  let response: Awaited<ReturnType<typeof switchAgencyRequest>>;
  try {
    response = await switchAgencyRequest(targetUserId, oldRefreshToken);
  } catch (err: any) {
    if (err?.status === 401) {
      toast.error('Your session expired. Please log in again.');
      return;
    }
    toast.error(err?.message ?? 'Failed to switch agency. Please try again.');
    return;
  }

  // Step 5: Persist new tokens — abort the switch if storage is unavailable (EC-5.1)
  try {
    localStorage.setItem(TOKEN_KEY, response.token);
    localStorage.setItem(REFRESH_KEY, response.refreshToken);
  } catch {
    toast.error('Unable to save credentials. Please try in a regular (non-private) browser window.');
    return;
  }

  // Queue a success toast to show after reload (toasts can't survive navigation)
  try {
    const name = `${(response.user as any)?.subCompany?.name ?? ''}`.trim() || 'new agency';
    sessionStorage.setItem('agency_switch_toast', name);
  } catch {
    // ignore
  }

  // Step 6: Broadcast to other tabs to force reload (EC-2.5)
  try {
    const bc = new BroadcastChannel(AGENCY_SWITCH_CHANNEL);
    bc.postMessage({ type: 'AGENCY_SWITCHED' });
    bc.close(); // prevent same-tab listener from receiving its own message
  } catch {
    // BroadcastChannel not available in all environments
  }

  // Step 7: Destroy Twilio Device for Agency A before reload (EC-9.1)
  try {
    callState.destroyDevice?.();
  } catch {
    // ignore
  }

  // Step 8: Disconnect socket — will reconnect with new token after reload (EC-3.2)
  try {
    closeSocket();
  } catch {
    // ignore
  }

  // Step 9: Clear TanStack Query cache (EC-3.4)
  try {
    queryClient.clear();
  } catch {
    // ignore
  }

  // Step 10: Navigate clean — strip linked/act-as + hierarchy params so the new
  // identity does not inherit the previous account's filter URL.
  const returnPath = (() => {
    try {
      const raw = sessionStorage.getItem('switchReturnPath') || '/';
      const url = new URL(raw, window.location.origin);
      for (const key of ['linkedScope', 'linkedUserId', 'leaderId', 'managerId', 'userId', 'agencyId']) {
        url.searchParams.delete(key);
      }
      const path = `${url.pathname}${url.search}${url.hash}`;
      return path || '/';
    } catch {
      return '/';
    }
  })();
  window.location.href = returnPath;
}

/**
 * Set up the BroadcastChannel listener so other tabs reload when any tab switches agency.
 * Call this once at app startup.
 */
export function initAgencySwitchListener(): () => void {
  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel(AGENCY_SWITCH_CHANNEL);
    bc.onmessage = (e: MessageEvent) => {
      if (e.data?.type === 'AGENCY_SWITCHED') {
        window.location.href = '/';
      }
    };
  } catch {
    // BroadcastChannel not available — skip
  }
  return () => {
    try {
      bc?.close();
    } catch {
      // ignore
    }
  };
}
