import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/lib/authStore';
import { useStore } from '@/lib/store';
import { confirmBreakTransition } from '@/lib/activityBreak';
import { WORKING_HOURS_TIME_ZONE } from '@/lib/workingHours';
import {
  ActivityTrackingScope,
  canClaimActivityLease,
  ownsActivityLease,
  type ActivityInputBuffer,
  type ActivityLease,
  type ScopedActivitySnapshot,
} from '@/lib/activityMeasurement';
import {
  fetchCurrentActivitySession,
  sendActivityHeartbeat,
  sendActivityBreak,
  sendManualBack,
  type ActivityMeasurement,
  type ActivitySessionState,
  type ActivityBreakType,
} from '@/lib/api';

const HEARTBEAT_INTERVAL_MS = 20_000;
const FALLBACK_POLL_INTERVAL_MS = 30_000;
const LEADER_CHECK_MS = 5_000;
const LEADER_TTL_MS = 30_000;

export interface IdleState {
  isIdle: boolean;
  idleSeconds: number;
  isTrackingPaused: boolean;
  handleImBack: () => Promise<void>;
  handleBreakChange: (onBreak: boolean, breakType?: ActivityBreakType) => Promise<void>;
}

type ActivityMessage =
  | { type: 'input'; at: number }
  | { type: 'request_inputs' }
  | { type: 'inputs'; observations: ReturnType<ActivityInputBuffer['share']> }
  | { type: 'acknowledged'; through: number | null }
  | { type: 'leader_released' }
  | { type: 'resume_tracking' }
  | { type: 'state'; state: ActivitySessionState };

/** CRM inactivity is measured by the server from observed input boundaries, not UI timers. */
export function useIdleDetection(): IdleState {
  const userId = useAuthStore((state) => state.user?.id);
  const [isIdle, setIsIdle] = useState(false);
  const [idleSeconds, setIdleSeconds] = useState(0);
  const [isTrackingPaused, setIsTrackingPaused] = useState(false);
  const manualBackRef = useRef<() => Promise<void>>(async () => {});
  const changeBreakRef = useRef<IdleState['handleBreakChange']>(async () => { throw new Error('Activity session is loading. Please try again.'); });

  useEffect(() => {
    if (!userId) return;
    const key = `crm-activity:v2:${userId}`;
    const leaderKey = `${key}:leader`;
    const messageKey = `${key}:message`;
    const owner = crypto.randomUUID();
    let clientId: string = crypto.randomUUID();
    try {
      const stored = localStorage.getItem(`${key}:client`);
      if (stored) clientId = stored;
      else {
        localStorage.setItem(`${key}:client`, clientId);
        clientId = localStorage.getItem(`${key}:client`) || clientId;
      }
    } catch { /* A separate observer ID makes unavailable cross-tab storage conservative. */ }
    let observerId = clientId;
    const timeZone = WORKING_HOURS_TIME_ZONE;
    const inputs = new ActivityTrackingScope();
    let channel: BroadcastChannel | null = null;
    let sessionId: string | null = null;
    let cancelled = false;
    let isLeader = false;
    let pageHidden = false;
    let storageAvailable = true;
    let leadershipRequest: Promise<void> | null = null;
    let heartbeatInFlight = false;
    let heartbeatRequested = false;
    let breakInFlight = false;
    let confirmedOnBreak: boolean | null = null;
    let lastServerTime = 0;
    let sessionRequest: Promise<ActivitySessionState | null> | null = null;

    setIsIdle(false);
    setIdleSeconds(0);
    setIsTrackingPaused(false);

    function broadcast(message: ActivityMessage) {
      if (cancelled || (message.type !== 'state' && !inputs.enabled)) return;
      try {
        if (channel) channel.postMessage(message);
        else localStorage.setItem(messageKey, JSON.stringify({ ...message, nonce: crypto.randomUUID() }));
      } catch { /* Other tabs can still report their own inputs when storage is unavailable. */ }
    }

    function applyState(state: ActivitySessionState, relay = false) {
      if (cancelled) return;
      const serverTime = Date.parse(state.serverTime);
      // An earlier HTTP response must not undo a newer socket update or break change.
      if (!Number.isFinite(serverTime) || serverTime < lastServerTime) return;
      lastServerTime = serverTime;
      if (state.sessionId) sessionId = state.sessionId;
      const scopeChanged = inputs.setEnabled(state.trackingEnabled, Date.now());
      if (scopeChanged && !inputs.enabled) releaseLease();
      const breakChanged = confirmedOnBreak !== null && confirmedOnBreak !== state.onBreak;
      const resumed = confirmedOnBreak === true && state.onBreak === false;
      confirmedOnBreak = state.onBreak;
      if (breakChanged) inputs.reset(Date.now());
      if (scopeChanged || breakChanged) observerId = `${clientId}:${crypto.randomUUID()}`;
      const measuredIdle = inputs.enabled && state.state === 'idle' && !state.onBreak;
      setIsIdle(measuredIdle);
      setIdleSeconds(measuredIdle && Number.isFinite(state.currentIdleSeconds)
        ? Math.max(0, Math.floor(state.currentIdleSeconds)) : 0);
      setIsTrackingPaused(inputs.enabled && (state.trackingPaused === true || state.state === 'offline_suspected'));
      if (typeof state.onBreak === 'boolean') {
        useStore.getState().setIsOnBreak(state.onBreak);
        window.dispatchEvent(new CustomEvent('activity:break_state', {
          detail: { onBreak: state.onBreak, startedAt: state.breakStartedAt, breakType: state.breakType, serverTime: state.serverTime },
        }));
      }
      if (relay) broadcast({ type: 'state', state });
      if (scopeChanged && inputs.enabled) {
        broadcast({ type: 'request_inputs' });
      }
      if ((scopeChanged || resumed) && inputs.enabled) requestHeartbeat();
    }

    function requestHeartbeat() {
      if (cancelled || !inputs.enabled) return;
      heartbeatRequested = true;
      queueMicrotask(() => {
        void checkLeadership().then(() => heartbeat());
      });
    }

    function captureMeasurement() {
      const captured = inputs.capture();
      if (!captured) return null;
      const { snapshot } = captured;
      const measurement: ActivityMeasurement = {
        measurementVersion: 2,
        clientId: observerId,
        clientTime: new Date().toISOString(),
        firstActivityAt: snapshot.firstActivityAt,
        lastActivityAt: snapshot.lastActivityAt,
        timeZone,
      };
      return { ...captured, measurement };
    }

    function acknowledge(captured: ScopedActivitySnapshot) {
      if (inputs.acknowledge(captured)) {
        broadcast({ type: 'acknowledged', through: captured.snapshot.acknowledgedThrough });
      }
    }

    async function refreshSession(force = false): Promise<ActivitySessionState | null> {
      if (sessionRequest) {
        if (!force) return sessionRequest;
        await sessionRequest;
        if (cancelled) return null;
      }
      sessionRequest = fetchCurrentActivitySession()
        .then((state) => {
          if (state && !cancelled) {
            applyState(state);
          }
          return state;
        })
        .catch(() => null)
        .finally(() => { sessionRequest = null; });
      return sessionRequest;
    }

    async function changeBreak(onBreak: boolean, breakType?: ActivityBreakType) {
      if (cancelled) throw new Error('Activity session is unavailable. Please reload and try again.');
      if (breakInFlight) throw new Error('A break update is already in progress.');
      breakInFlight = true;
      try {
        if (!sessionId) await refreshSession();
        if (!sessionId || cancelled) throw new Error('Could not load your activity session. Please try again.');
        const captured = captureMeasurement();
        const state = await confirmBreakTransition(onBreak,
          () => sendActivityBreak(sessionId!, onBreak, timeZone, captured?.measurement, breakType),
          () => refreshSession(true));
        if (cancelled) throw new Error('Activity session changed. Please reload to confirm your break status.');
        applyState(state, true);
        if (captured) acknowledge(captured);
        if (!onBreak) {
          // Establish the resumed observation now, including when another tab owns heartbeats.
          broadcast({ type: 'resume_tracking' });
          requestHeartbeat();
        }
      } finally {
        breakInFlight = false;
        if (heartbeatRequested) requestHeartbeat();
      }
    }

    async function heartbeat() {
      if (cancelled || !inputs.enabled || !isLeader || heartbeatInFlight || breakInFlight) return;
      if (!verifyLeadership()) return;
      heartbeatRequested = false;
      heartbeatInFlight = true;
      try {
        if (!sessionId) await refreshSession();
        if (!sessionId || cancelled || !inputs.enabled || !verifyLeadership() || breakInFlight) return;
        const captured = captureMeasurement();
        if (!captured) return;
        const { snapshot, measurement } = captured;
        const state = await sendActivityHeartbeat(
          sessionId,
          document.visibilityState === 'visible' ? 'visible' : 'hidden',
          snapshot.firstActivityAt !== null,
          measurement,
        );
        if (cancelled) return;
        if (!state) {
          setIsTrackingPaused(true);
          sessionId = null;
          await refreshSession();
          return; // Keep pending observations for a retry; never discard input on failure.
        }
        applyState(state, true);
        acknowledge(captured);
      } catch {
        if (!cancelled) setIsTrackingPaused(true);
      } finally {
        heartbeatInFlight = false;
        if (heartbeatRequested) requestHeartbeat();
      }
    }

    function receive(message: ActivityMessage) {
      if (cancelled || !message || typeof message !== 'object') return;
      if (message.type === 'state') { applyState(message.state); return; }
      if (!inputs.enabled) return;
      if (message.type === 'leader_released') {
        if (document.visibilityState === 'visible') void checkLeadership();
        return;
      }
      if (message.type === 'resume_tracking') { requestHeartbeat(); return; }
      if (confirmedOnBreak) return;
      if (message.type === 'input' && Number.isFinite(message.at)) inputs.record(message.at);
      else if (message.type === 'request_inputs') {
        const observations = inputs.share();
        if (observations) broadcast({ type: 'inputs', observations });
      }
      else if (message.type === 'inputs' && Array.isArray(message.observations?.pending)) inputs.merge(message.observations);
      else if (message.type === 'acknowledged') inputs.acknowledgeRelay(message.through);
    }

    function onStorage(event: StorageEvent) {
      if (event.key !== messageKey || !event.newValue) return;
      try { receive(JSON.parse(event.newValue) as ActivityMessage); } catch { /* Ignore invalid messages. */ }
    }

    try {
      channel = new BroadcastChannel(key);
      channel.onmessage = (event: MessageEvent<ActivityMessage>) => receive(event.data);
    } catch { /* The storage event transport supports browsers without BroadcastChannel. */ }
    window.addEventListener('storage', onStorage);
    broadcast({ type: 'request_inputs' });

    function recordInput(event: Event) {
      if (!inputs.enabled || confirmedOnBreak || !event.isTrusted) return;
      const at = Date.now();
      if (!inputs.record(at)) return; // Only confirmed non-IT scope may retain input.
      broadcast({ type: 'input', at });
      if (!isLeader) void checkLeadership();
    }
    const inputEvents = ['pointermove', 'pointerdown', 'keydown', 'click', 'touchstart', 'touchmove', 'wheel', 'input'] as const;
    inputEvents.forEach((name) => window.addEventListener(name, recordInput, { passive: true, capture: true }));
    // Visibility/focus alone is not evidence of a user input and never resets inactivity.
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void refreshSession();
        void checkLeadership();
      } else releaseLease();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    function readLease(): ActivityLease | null {
      try {
        const raw = localStorage.getItem(leaderKey);
        storageAvailable = true;
        return raw ? JSON.parse(raw) as ActivityLease : null;
      } catch { storageAvailable = false; return null; }
    }
    function verifyLeadership() {
      if (cancelled || pageHidden || !inputs.enabled || !isLeader) return false;
      const lease = readLease();
      if (storageAvailable && !ownsActivityLease(lease, owner, Date.now())) isLeader = false;
      return isLeader;
    }
    function claimLease() {
      if (cancelled || pageHidden || !inputs.enabled) return;
      const now = Date.now();
      const visibility = document.visibilityState === 'visible' ? 'visible' : 'hidden';
      const previous = readLease();
      const wasLeader = isLeader && (!storageAvailable || ownsActivityLease(previous, owner, now));
      try {
        if (canClaimActivityLease(previous, owner, now, visibility)) {
          localStorage.setItem(leaderKey, JSON.stringify({ owner, expiresAt: now + LEADER_TTL_MS, visibility }));
          storageAvailable = true;
          isLeader = ownsActivityLease(readLease(), owner, Date.now());
        } else isLeader = false;
      } catch {
        // Independent observer IDs keep storage-blocked tabs conservative on the server.
        storageAvailable = false;
        isLeader = true;
      }
      if (cancelled || pageHidden || !inputs.enabled) { releaseLease(); return; }
      if (isLeader && !wasLeader) {
        // Peer inputs arrive asynchronously. A handoff is unmeasured until this
        // leader establishes its own observation, even when all tabs share a browser.
        observerId = `${clientId}:${crypto.randomUUID()}`;
        broadcast({ type: 'request_inputs' });
        void heartbeat();
      }
    }
    function checkLeadership(): Promise<void> {
      if (cancelled || pageHidden || !inputs.enabled) return Promise.resolve();
      if (leadershipRequest) return leadershipRequest;
      // Hold the Web Lock only for this synchronous lease update. A frozen tab
      // cannot retain it and block the visible tab for the lifetime of the page.
      const claim = async () => {
        if ('locks' in navigator) {
          try {
            await navigator.locks.request(`${leaderKey}:claim`, {
              mode: 'exclusive', ifAvailable: true,
            }, (lock) => { if (lock) claimLease(); });
            return;
          } catch {
            if (cancelled) return;
            // The renewable lease also works where Web Locks are denied.
          }
        }
        claimLease();
      };
      leadershipRequest = claim().finally(() => { leadershipRequest = null; });
      return leadershipRequest;
    }
    function releaseLease() {
      const wasLeader = isLeader;
      isLeader = false;
      if (readLease()?.owner === owner) {
        try { localStorage.removeItem(leaderKey); } catch { /* Best effort on unload. */ }
      }
      if (wasLeader) broadcast({ type: 'leader_released' });
    }

    const heartbeatTimer = setInterval(() => { void heartbeat(); }, HEARTBEAT_INTERVAL_MS);
    const leaderTimer = setInterval(() => { void checkLeadership(); }, LEADER_CHECK_MS);
    const pollTimer = setInterval(() => {
      void refreshSession();
    }, FALLBACK_POLL_INTERVAL_MS);
    // Unloading one tab must never close the shared user session.
    function onPageHide() { pageHidden = true; releaseLease(); }
    function onPageShow() { pageHidden = false; void checkLeadership(); void refreshSession(); }
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);

    const socket = getSocket();
    const onServerState = (state: ActivitySessionState) => applyState(state);
    const onReconnect = () => { void refreshSession(); };
    const onTrackingPaused = () => { void refreshSession(); };
    socket?.on('activity:state_changed', onServerState);
    socket?.on('activity:tracking_paused', onTrackingPaused);
    socket?.on('connect', onReconnect);

    manualBackRef.current = async () => {
      // The explicit return button is a real interaction; its timestamp joins the next heartbeat.
      const at = Date.now();
      if (inputs.record(at)) broadcast({ type: 'input', at });
      if (!sessionId) await refreshSession();
      if (!sessionId || cancelled) return;
      const captured = captureMeasurement();
      const result = await sendManualBack(sessionId, captured?.measurement);
      if (cancelled) return;
      if (result?.state === 'active') {
        await refreshSession();
        if (captured) acknowledge(captured);
      }
      else {
        sessionId = null;
        await refreshSession();
      }
    };
    changeBreakRef.current = changeBreak;
    void refreshSession();

    return () => {
      cancelled = true;
      manualBackRef.current = async () => {};
      changeBreakRef.current = async () => { throw new Error('Activity session is unavailable. Please reload and try again.'); };
      clearInterval(heartbeatTimer);
      clearInterval(leaderTimer);
      clearInterval(pollTimer);
      inputEvents.forEach((name) => window.removeEventListener(name, recordInput, { capture: true }));
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      socket?.off('activity:state_changed', onServerState);
      socket?.off('activity:tracking_paused', onTrackingPaused);
      socket?.off('connect', onReconnect);
      releaseLease();
      channel?.close();
    };
  }, [userId]);

  const handleImBack = useCallback(() => manualBackRef.current(), []);
  const handleBreakChange = useCallback<IdleState['handleBreakChange']>((onBreak, breakType) => changeBreakRef.current(onBreak, breakType), []);
  return { isIdle, idleSeconds, isTrackingPaused, handleImBack, handleBreakChange };
}
