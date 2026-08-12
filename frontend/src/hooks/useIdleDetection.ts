import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/lib/authStore';
import {
  fetchCurrentActivitySession,
  sendActivityHeartbeat,
  sendActivityEvent,
  sendManualBack,
  sendActivityEndSession,
} from '@/lib/api';

const HEARTBEAT_INTERVAL_MS = 20 * 1000;
const FALLBACK_POLL_INTERVAL_MS = 30 * 1000;
const ACTIVITY_THROTTLE_MS = 5 * 1000;
const LEADER_KEY = 'activity_leader';
const LEADER_TTL_MS = 25 * 1000;

export interface IdleState {
  isIdle: boolean;
  idleSeconds: number;
  isTrackingPaused: boolean;
  handleImBack: () => Promise<void>;
}

function tryClaimLeader(): boolean {
  try {
    const now = Date.now();
    const raw = localStorage.getItem(LEADER_KEY);
    if (raw) {
      const { ts } = JSON.parse(raw) as { ts: number };
      if (now - ts < LEADER_TTL_MS) return false;
    }
    localStorage.setItem(LEADER_KEY, JSON.stringify({ ts: now }));
    const confirmed = JSON.parse(localStorage.getItem(LEADER_KEY) ?? '{}') as { ts?: number };
    return confirmed.ts === now;
  } catch {
    return true;
  }
}

function renewLeader(): void {
  try {
    localStorage.setItem(LEADER_KEY, JSON.stringify({ ts: Date.now() }));
  } catch { /* ignore */ }
}

function releaseLeader(): void {
  try {
    localStorage.removeItem(LEADER_KEY);
  } catch { /* ignore */ }
}

// Returns true when `now` falls inside [startStr, endStr) interpreted as wall-clock HH:mm
// in the browser's local timezone — matches how working hours are entered/displayed elsewhere
// in the app (no per-user timezone field exists). When either field is missing, returns true
// so behavior is unchanged for users without configured working hours.
function isInsideWorkingHours(
  startStr: string | undefined,
  endStr: string | undefined,
  now: Date,
): boolean {
  if (!startStr || !endStr) return true;
  const [sH, sM] = startStr.split(':').map(Number);
  const [eH, eM] = endStr.split(':').map(Number);
  if (Number.isNaN(sH) || Number.isNaN(sM) || Number.isNaN(eH) || Number.isNaN(eM)) return true;
  const startMin = sH * 60 + sM;
  const endMin = eH * 60 + eM;
  if (startMin === endMin) return true; // 24/7
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin; // overnight window
}

export function useIdleDetection(isOnBreak: boolean): IdleState {
  const [isIdle, setIsIdle] = useState(false);
  const [idleSeconds, setIdleSeconds] = useState(0);
  const [isTrackingPaused, setIsTrackingPaused] = useState(false);

  const workStartTime = useAuthStore((s) => s.user?.workStartTime);
  const workEndTime = useAuthStore((s) => s.user?.workEndTime);

  const sessionIdRef = useRef<string | null>(null);
  const isLeaderRef = useRef(false);
  const hadActivityRef = useRef(false);
  const lastActivityThrottleRef = useRef(0);
  const idleStartedAtRef = useRef<Date | null>(null);
  const isIdleRef = useRef(false);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const prevIsOnBreakRef = useRef(isOnBreak);

  // Frozen state — set when the live working-hours check (every tick) flips outside hours.
  // `frozenIdleSecondsRef` is the carry-over total of in-hours seconds across freeze cycles;
  // it is preserved across unfreezes and only zeroed on full return-to-active. This is what
  // makes edge case D (idle across an entire off-hours gap) log the correct cumulative total.
  const isManuallyFrozenRef = useRef(false);
  const frozenIdleSecondsRef = useRef(0);

  // Freeze the segment at the working-hours boundary: fold the current segment into
  // the carry-over and stop the visible timer.
  const freezeIdleModal = useCallback(() => {
    const segmentSeconds = idleStartedAtRef.current
      ? Math.floor((Date.now() - idleStartedAtRef.current.getTime()) / 1000)
      : 0;
    frozenIdleSecondsRef.current += segmentSeconds;
    idleStartedAtRef.current = null;
    isManuallyFrozenRef.current = true;
    setIsTrackingPaused(true);
    setIdleSeconds(frozenIdleSecondsRef.current);
  }, []);

  const clearFrozenState = useCallback(() => {
    isManuallyFrozenRef.current = false;
    frozenIdleSecondsRef.current = 0;
    setIsTrackingPaused(false);
  }, []);

  // 1s tick: re-evaluates working hours every second so freeze/unfreeze transitions are
  // automatic and require no user action. This is the single source of truth for the
  // "only count if idle AND inside hours" rule.
  const syncIdleTimer = useCallback(() => {
    if (!isIdleRef.current) return;

    const insideHours = isInsideWorkingHours(workStartTime, workEndTime, new Date());

    if (!insideHours) {
      if (!isManuallyFrozenRef.current) freezeIdleModal();
      return;
    }

    if (isManuallyFrozenRef.current) {
      // Inside hours again while still idle — start a fresh visual segment from this moment.
      // Carry-over is preserved so the eventual log total covers all in-hours portions.
      isManuallyFrozenRef.current = false;
      setIsTrackingPaused(false);
      idleStartedAtRef.current = new Date();
      setIdleSeconds(0);
      return;
    }

    if (!idleStartedAtRef.current) return;
    const elapsed = Math.floor((Date.now() - idleStartedAtRef.current.getTime()) / 1000);
    setIdleSeconds(elapsed);
  }, [workStartTime, workEndTime, freezeIdleModal]);

  const applyServerState = useCallback(
    (state: string, idleStartedAt: string | null, serverTime: string) => {
      const shouldBeIdle = state === 'idle' || state === 'offline_suspected';
      if (shouldBeIdle) {
        const insideHours = isInsideWorkingHours(workStartTime, workEndTime, new Date());

        if (insideHours) {
          if (isManuallyFrozenRef.current) {
            // Frozen → active-idle transition. Fresh anchor; carry-over preserved.
            isManuallyFrozenRef.current = false;
            setIsTrackingPaused(false);
            idleStartedAtRef.current = new Date();
          } else if (!idleStartedAtRef.current) {
            // First idle entry inside hours — adopt server's authoritative timestamp.
            // Guard prevents a later applyServerState (e.g. from the 30s fallback poll)
            // from overwriting a fresh post-unfreeze anchor with the server's stale value.
            const serverTs = new Date(serverTime).getTime();
            const clockDriftMs = Date.now() - serverTs;
            idleStartedAtRef.current = idleStartedAt
              ? new Date(new Date(idleStartedAt).getTime() + clockDriftMs)
              : new Date(serverTs);
          }
        } else {
          // Edge cases B & E: entering idle while already outside hours — leave anchor null
          // and don't start a local timer segment yet. The first counted segment doesn't begin
          // until working hours resume (handled by syncIdleTimer's unfreeze branch).
          idleStartedAtRef.current = null;
        }

        isIdleRef.current = true;
        setIsIdle(true);
        syncIdleTimer();
      } else {
        // Server says active. If we're frozen, ignore (manual back is still required).
        if (isManuallyFrozenRef.current) return;
        idleStartedAtRef.current = null;
        isIdleRef.current = false;
        setIsIdle(false);
        setIdleSeconds(0);
        frozenIdleSecondsRef.current = 0;
      }
    },
    [syncIdleTimer, workStartTime, workEndTime],
  );

  // Boot: fetch authoritative state before rendering idle UI
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const session = await fetchCurrentActivitySession();
      if (cancelled || !session) return;
      sessionIdRef.current = session.sessionId;
      applyServerState(session.state, session.idleStartedAt, session.serverTime);
      await sendActivityEvent(session.sessionId, 'session_start');
    }
    void boot();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Socket.IO: receive server-pushed state changes
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onStateChanged = (payload: { state: string; idleStartedAt: string | null; serverTime: string }) => {
      applyServerState(payload.state, payload.idleStartedAt, payload.serverTime);
    };
    // Shift ended — freeze modal if idle, otherwise suppress.
    const onTrackingPaused = () => {
      if (isIdleRef.current) {
        if (!isManuallyFrozenRef.current) freezeIdleModal();
      } else {
        idleStartedAtRef.current = null;
        isIdleRef.current = false;
        setIsIdle(false);
        setIdleSeconds(0);
      }
    };
    socket.on('activity:state_changed', onStateChanged);
    socket.on('activity:tracking_paused', onTrackingPaused);
    return () => {
      socket.off('activity:state_changed', onStateChanged);
      socket.off('activity:tracking_paused', onTrackingPaused);
    };
  }, [applyServerState, freezeIdleModal]);

  // Activity listeners — all tabs track activity; non-leaders relay to leader via BroadcastChannel
  useEffect(() => {
    if (isOnBreak) return;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastActivityThrottleRef.current >= ACTIVITY_THROTTLE_MS) {
        hadActivityRef.current = true;
        lastActivityThrottleRef.current = now;
        if (!isLeaderRef.current && broadcastChannelRef.current) {
          try { broadcastChannelRef.current.postMessage({ type: 'activity_detected' }); } catch { /* ignore */ }
        }
      }
    };
    const bubbleEvents = ['mousemove', 'keydown', 'click', 'touchstart', 'input', 'focus'] as const;
    bubbleEvents.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    window.addEventListener('scroll', onActivity, { passive: true, capture: true });
    return () => {
      bubbleEvents.forEach((e) => window.removeEventListener(e, onActivity));
      window.removeEventListener('scroll', onActivity, { capture: true });
    };
  }, [isOnBreak]);

  // Visibility change: re-fetch state on focus; mark activity when switching back
  useEffect(() => {
    const onVisibilityChange = () => {
      const sid = sessionIdRef.current;
      if (document.visibilityState === 'hidden') {
        if (sid) void sendActivityEvent(sid, 'tab_hidden');
        return;
      }
      hadActivityRef.current = true;
      void fetchCurrentActivitySession().then((session) => {
        if (!session) return;
        if (!sessionIdRef.current) {
          sessionIdRef.current = session.sessionId;
          void sendActivityEvent(session.sessionId, 'session_start');
        } else if (sid) {
          void sendActivityEvent(sid, 'tab_visible');
        }
        applyServerState(session.state, session.idleStartedAt, session.serverTime);
      });
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [applyServerState]);

  // Best-effort end-session on page close
  useEffect(() => {
    const onUnload = () => {
      const sid = sessionIdRef.current;
      if (sid) sendActivityEndSession(sid);
      if (isLeaderRef.current && !('locks' in navigator)) releaseLeader();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  // Heartbeat loop — one leader tab only.
  // Uses Web Locks API for a true cross-tab exclusive lock (no race conditions).
  // Falls back to the localStorage CAS approach on browsers that lack Web Locks.
  useEffect(() => {
    if (isOnBreak) return;
    let cancelled = false;
    // Refs to cancel the inter-beat sleep early when the effect is torn down,
    // so the lock is released promptly instead of waiting up to 20 s.
    let wakeUp: (() => void) | null = null;
    let sleepTimer: ReturnType<typeof setTimeout> | null = null;

    async function runHeartbeats() {
      while (!cancelled) {
        await new Promise<void>((resolve) => {
          wakeUp = resolve;
          sleepTimer = setTimeout(resolve, HEARTBEAT_INTERVAL_MS);
        });
        wakeUp = null;
        sleepTimer = null;
        if (cancelled) break;

        const sid = sessionIdRef.current;
        if (!sid) {
          const session = await fetchCurrentActivitySession();
          if (!cancelled && session) {
            sessionIdRef.current = session.sessionId;
            applyServerState(session.state, session.idleStartedAt, session.serverTime);
            void sendActivityEvent(session.sessionId, 'session_start');
          }
          continue;
        }

        const visibilityState = document.visibilityState === 'visible' ? 'visible' : 'hidden';
        const hadActivity = hadActivityRef.current;
        const result = await sendActivityHeartbeat(sid, visibilityState, hadActivity);
        if (!result) {
          if (hadActivity) hadActivityRef.current = true;
          continue;
        }
        hadActivityRef.current = false;
        applyServerState(result.state, result.idleStartedAt, result.serverTime);
      }
      isLeaderRef.current = false;
    }

    function cancelSleep() {
      if (sleepTimer !== null) { clearTimeout(sleepTimer); sleepTimer = null; }
      if (wakeUp) { wakeUp(); wakeUp = null; }
    }

    if ('locks' in navigator) {
      const ac = new AbortController();
      void navigator.locks.request(
        'activity_leader',
        { mode: 'exclusive', signal: ac.signal },
        async () => {
          if (cancelled) return;
          isLeaderRef.current = true;
          await runHeartbeats();
        },
      ).catch(() => {});
      return () => {
        cancelled = true;
        cancelSleep();
        ac.abort();
        isLeaderRef.current = false;
      };
    }

    // Fallback: localStorage CAS (has a rare multi-tab race but still works)
    isLeaderRef.current = tryClaimLeader();
    if (isLeaderRef.current) void runHeartbeats();
    return () => {
      cancelled = true;
      cancelSleep();
      if (isLeaderRef.current) releaseLeader();
      isLeaderRef.current = false;
    };
  }, [isOnBreak, applyServerState, freezeIdleModal]);

  // BroadcastChannel: leader re-election + cross-tab activity relay
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('activity');
      broadcastChannelRef.current = bc;
      bc.onmessage = (e: MessageEvent<{ type: string }>) => {
        if (e.data?.type === 'leader_released' && !('locks' in navigator)) {
          isLeaderRef.current = tryClaimLeader();
        } else if (e.data?.type === 'activity_detected') {
          hadActivityRef.current = true;
        }
      };
    } catch {
      // BroadcastChannel unavailable (Firefox private mode) — ignore
    }
    const onUnload = () => {
      if (isLeaderRef.current && bc && !('locks' in navigator)) {
        bc.postMessage({ type: 'leader_released' });
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      bc?.close();
      broadcastChannelRef.current = null;
    };
  }, []);

  // When break ends while idle — clear idle state silently (break time logged separately).
  useEffect(() => {
    const wasOnBreak = prevIsOnBreakRef.current;
    prevIsOnBreakRef.current = isOnBreak;
    if (wasOnBreak && !isOnBreak && isIdleRef.current) {
      const sid = sessionIdRef.current;
      if (sid) {
        void sendManualBack(sid).then((result) => {
          if (result?.state === 'active') {
            idleStartedAtRef.current = null;
            isIdleRef.current = false;
            setIsIdle(false);
            setIdleSeconds(0);
            clearFrozenState();
          }
        });
      }
    }
  }, [isOnBreak, clearFrozenState]);

  // Idle timer: tick every second while modal is open
  useEffect(() => {
    if (!isIdle) return;
    const interval = setInterval(syncIdleTimer, 1000);
    return () => clearInterval(interval);
  }, [isIdle, syncIdleTimer]);

  // Fallback poll: re-sync if Socket.IO is down
  useEffect(() => {
    if (!isIdle) return;
    const interval = setInterval(async () => {
      const session = await fetchCurrentActivitySession();
      if (!session) return;
      applyServerState(session.state, session.idleStartedAt, session.serverTime);
    }, FALLBACK_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isIdle, applyServerState]);

  const handleImBack = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;

    const result = await sendManualBack(sid);
    if (result?.state === 'active') {
      idleStartedAtRef.current = null;
      isIdleRef.current = false;
      setIsIdle(false);
      setIdleSeconds(0);
      clearFrozenState();
    }
  }, [clearFrozenState]);

  return { isIdle, idleSeconds, isTrackingPaused, handleImBack };
}
