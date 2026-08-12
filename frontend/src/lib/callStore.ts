import { create } from 'zustand';
import { Device, Call } from '@twilio/voice-sdk';
import { toast } from 'sonner';
import { Client, ClientContact } from './types';
import {
  getVoiceToken,
  patchInboundCall,
  presenceCallStarted,
  presenceCallEnded,
  setInboundHold,
  setOutboundHold,
  getIncomingContext,
  endInboundCallApi,
  endOutboundCall,
} from './api';
import type { VoiceCallEndedPayload } from './socket';
import { useStore } from './store';

let activeVoiceLegCount = 0;
let tearingDownInboundCalls = false;

/** Twilio Voice SDK 2.x passes `<Parameter>` values on `customParameters` (Map), not `parameters`. */
function inboundCallParams(call: Call): {
  direction?: string;
  inboundCallId: string;
  fromNumber: string;
  toNumber?: string;
  callerName?: string;
  departmentLabel?: string;
} {
  const std = call.parameters as Record<string, string>;
  const custom = call.customParameters;
  const fromCustom = (key: string) =>
    (typeof custom?.get === 'function' ? custom.get(key) : undefined) ??
    (custom as unknown as Record<string, string> | undefined)?.[key];

  return {
    direction: fromCustom('direction') ?? std.direction ?? std.Direction,
    inboundCallId: fromCustom('inboundCallId') ?? std.inboundCallId ?? std.InboundCallId ?? '',
    fromNumber: fromCustom('fromNumber') ?? std.fromNumber ?? std.From ?? 'Unknown',
    toNumber: fromCustom('toNumber') ?? std.toNumber ?? std.To,
    callerName: fromCustom('callerName') ?? std.callerName ?? std.CallerName,
    departmentLabel: fromCustom('departmentLabel') ?? std.departmentLabel ?? std.DepartmentLabel,
  };
}

/** True when Twilio rings the agent with inbound Client-leg custom parameters. */
function isInboundAgentRing(call: Call): boolean {
  const { inboundCallId } = inboundCallParams(call);
  return Boolean(inboundCallId?.trim());
}

async function resolveIncomingContext(agentCallSid: string, maxAttempts = 5) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ctx = await getIncomingContext(agentCallSid);
    if (ctx) return ctx;
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  return null;
}

/** Prefer the inbound leg reference when an inbound call is active. */
function activeSdkCall(state: CallState): Call | null {
  return state.activeInboundCall?.twilioCall ?? state.twilioCall;
}

/** Mute/unmute audio the agent hears from the remote party (local playback only). */
function setRemoteAudioMuted(call: Call | null | undefined, muted: boolean): void {
  if (!call || typeof call.getRemoteStream !== 'function') return;
  try {
    const stream = call.getRemoteStream();
    stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  } catch {
    // Remote stream may not be ready yet.
  }
}

function setSdkLegAudio(
  call: Call | null | undefined,
  opts: { muteMic: boolean; muteRemote: boolean },
): void {
  if (!call) return;
  call.mute(opts.muteMic);
  setRemoteAudioMuted(call, opts.muteRemote);
}

function focusInboundLegs(active: PendingInboundCall, held: PendingInboundCall | null): void {
  setSdkLegAudio(active.twilioCall, { muteMic: false, muteRemote: false });
  if (held?.twilioCall) {
    setSdkLegAudio(held.twilioCall, { muteMic: true, muteRemote: true });
  }
}

/** Promote a held inbound leg to active — unhold PSTN caller and restore agent audio. */
async function promoteHeldToActive(held: PendingInboundCall): Promise<void> {
  if (held.inboundCallId) {
    await setInboundHold(held.inboundCallId, false);
  }
  focusInboundLegs(held, null);
}

function markVoiceLegStarted(): void {
  const wasZero = activeVoiceLegCount === 0;
  activeVoiceLegCount += 1;
  if (wasZero) {
    void presenceCallStarted();
  }
}

function markVoiceLegEnded(): void {
  if (activeVoiceLegCount <= 0) return;
  activeVoiceLegCount -= 1;
  if (activeVoiceLegCount === 0) {
    void presenceCallEnded();
  }
}

function createVoiceDeviceOptions(edge?: string): ConstructorParameters<typeof Device>[1] {
  return {
    codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
    // Required for call waiting — otherwise Twilio drops invites while on a call.
    allowIncomingWhileBusy: true,
    logLevel: 1,
    ...(edge ? { edge } : {}),
  };
}

function inviteConnectToken(invite: Call): string | undefined {
  return invite.connectToken;
}

function deviceEdge(device: Device | null | undefined): string | undefined {
  if (!device) return undefined;
  const edge = (device as Device & { edge?: string | null }).edge;
  return edge ?? undefined;
}

function destroyInboundLegDevice(legDevice: Device | null | undefined): void {
  if (!legDevice) return;
  try {
    legDevice.destroy();
  } catch {
    // Already destroyed.
  }
}

/**
 * Accept an inbound invite. When the agent is already on a call, Twilio requires
 * forwarding via connectToken to a dedicated Device so both legs stay live.
 */
async function connectInboundLeg(
  invite: Call,
  agencyId: string | null | undefined,
  useIsolatedLeg: boolean,
  connectTokenOverride?: string,
  mainDevice?: Device | null,
): Promise<{ call: Call; legDevice: Device | null }> {
  const connectToken = connectTokenOverride ?? inviteConnectToken(invite);
  if (useIsolatedLeg) {
    if (!connectToken) {
      throw new Error('Call waiting is unavailable for this ring. Please refresh and try again.');
    }
    const token = await getVoiceToken(agencyId ?? undefined);
    const legDevice = new Device(token, createVoiceDeviceOptions(deviceEdge(mainDevice ?? null)));
    legDevice.on('tokenWillExpire', async () => {
      try {
        legDevice.updateToken(await getVoiceToken(agencyId ?? undefined));
      } catch (err) {
        console.error('[callStore] leg device token refresh failed:', err);
      }
    });
    const call = await legDevice.connect({ connectToken });
    return { call, legDevice };
  }

  invite.accept();
  return { call: invite, legDevice: null };
}

function attachPendingInviteHandlers(
  incomingCall: Call,
  set: (partial: Partial<CallState> | ((state: CallState) => Partial<CallState>)) => void,
  get: () => CallState,
) {
  incomingCall.on('cancel', () => {
    const state = get();
    const pending = state.pendingInboundCall;
    if (!pending) return;
    if (pending.twilioCall !== incomingCall && pending.inviteCall !== incomingCall) return;

    // Preconnected waiting leg stays alive even if the original invite cancels.
    if (pending.awaitingAccept && pending.legDevice) {
      return;
    }

    set({ pendingInboundCall: null, swapInProgress: false });
  });
}

function attachAcceptedInboundHandlers(
  incomingCall: Call,
  set: (partial: Partial<CallState> | ((state: CallState) => Partial<CallState>)) => void,
  get: () => CallState,
) {
  incomingCall.on('disconnect', () => {
    const state = get();
    markVoiceLegEnded();

    // Active talking call ended — promote a held call if one exists.
    if (state.activeInboundCall?.twilioCall === incomingCall) {
      destroyInboundLegDevice(state.activeInboundCall.legDevice);
      const duration = state.activeInboundCall.acceptedAt
        ? Math.floor((Date.now() - state.activeInboundCall.acceptedAt.getTime()) / 1000)
        : undefined;
      if (state.activeInboundCall.inboundCallId) {
        void patchInboundCall(state.activeInboundCall.inboundCallId, {
          outcome: 'answered',
          durationSec: duration,
        }).catch(() => undefined);
      }

      if (tearingDownInboundCalls) {
        return;
      }

      const held = state.heldInboundCall;
      if (held) {
        void promoteHeldToActive(held)
          .then(() => {
            set({
              activeInboundCall: held,
              heldInboundCall: null,
              twilioCall: held.twilioCall ?? null,
              inboundOnHold: false,
              inboundMuted: false,
              inboundCallDuration: 0,
            });
          })
          .catch((err) => {
            console.error('[callStore] promoteHeldToActive failed:', err);
            toast.error(err instanceof Error ? err.message : 'Failed to resume held caller');
          });
      } else {
        set({
          activeInboundCall: null,
          twilioCall: null,
          isInboundCallPanelOpen: false,
          inboundOnHold: false,
          inboundMuted: false,
          inboundCallDuration: 0,
        });
      }
      return;
    }

    // A held (waiting/on-hold) call ended.
    if (state.heldInboundCall?.twilioCall === incomingCall) {
      const held = state.heldInboundCall;
      destroyInboundLegDevice(held.legDevice);
      const duration = held.acceptedAt
        ? Math.floor((Date.now() - held.acceptedAt.getTime()) / 1000)
        : undefined;
      if (held.inboundCallId) {
        void patchInboundCall(held.inboundCallId, {
          outcome: 'answered',
          durationSec: duration,
        }).catch(() => undefined);
      }
      set({ heldInboundCall: null });
    }
  });
}

/** Pre-connect a call-waiting leg so Twilio does not cancel the ring during hold/swap setup. */
async function showCallWaitingPreconnect(
  invite: Call,
  ctx: {
    inboundCallId: string;
    fromNumber: string;
    toNumber?: string;
    callerName?: string;
    departmentLabel?: string;
  },
  set: (partial: Partial<CallState> | ((state: CallState) => Partial<CallState>)) => void,
  get: () => CallState,
) {
  const connectToken = inviteConnectToken(invite);
  if (!connectToken) {
    toast.error('Call waiting is unavailable for this ring');
    showPendingFromConferenceContext(invite, ctx, set, get);
    return;
  }

  set({
    pendingInboundCall: {
      twilioCall: invite,
      inviteCall: invite,
      connectToken,
      inboundCallId: ctx.inboundCallId,
      fromNumber: ctx.fromNumber,
      toNumber: ctx.toNumber,
      callerName: ctx.callerName,
      departmentLabel: ctx.departmentLabel,
      awaitingAccept: true,
    },
    isInboundCallPanelOpen: true,
    swapInProgress: true,
  });
  attachPendingInviteHandlers(invite, set, get);
  toast.info('Call waiting');

  try {
    const { call, legDevice } = await connectInboundLeg(
      invite,
      get().deviceAgencyId,
      true,
      connectToken,
      get().twilioDevice,
    );
    markVoiceLegStarted();
    attachAcceptedInboundHandlers(call, set, get);
    call.mute(true);
    setRemoteAudioMuted(call, true);
    try {
      invite.ignore();
    } catch {
      // Invite may already be handled.
    }

    set({
      pendingInboundCall: {
        twilioCall: call,
        inviteCall: invite,
        legDevice,
        connectToken,
        inboundCallId: ctx.inboundCallId,
        fromNumber: ctx.fromNumber,
        toNumber: ctx.toNumber,
        callerName: ctx.callerName,
        departmentLabel: ctx.departmentLabel,
        awaitingAccept: true,
      },
      swapInProgress: false,
    });
  } catch (err) {
    console.error('[callStore] call waiting preconnect failed:', err);
    toast.error(err instanceof Error ? err.message : 'Failed to connect waiting call');
    // Fall back to showing the invite so the agent can still try Answer.
    set({
      pendingInboundCall: {
        twilioCall: invite,
        inviteCall: invite,
        connectToken,
        inboundCallId: ctx.inboundCallId,
        fromNumber: ctx.fromNumber,
        toNumber: ctx.toNumber,
        callerName: ctx.callerName,
        departmentLabel: ctx.departmentLabel,
      },
      swapInProgress: false,
    });
  }
}

function showPendingFromConferenceContext(
  incomingCall: Call,
  ctx: {
    inboundCallId: string;
    fromNumber: string;
    toNumber?: string;
    callerName?: string;
    departmentLabel?: string;
  },
  set: (partial: Partial<CallState> | ((state: CallState) => Partial<CallState>)) => void,
  get: () => CallState,
) {
  const hasActive = Boolean(get().activeInboundCall);
  set({
    pendingInboundCall: {
      twilioCall: incomingCall,
      connectToken: inviteConnectToken(incomingCall),
      inboundCallId: ctx.inboundCallId,
      fromNumber: ctx.fromNumber,
      toNumber: ctx.toNumber,
      callerName: ctx.callerName,
      departmentLabel: ctx.departmentLabel,
    },
    ...(hasActive ? { isInboundCallPanelOpen: true } : {}),
  });
  if (hasActive) {
    toast.info('Call waiting');
  }
  attachPendingInviteHandlers(incomingCall, set, get);
}

/** Best-effort pending UI when conference context lookup fails (still show Answer/Decline). */
function showPendingConferenceFallback(
  incomingCall: Call,
  set: (partial: Partial<CallState> | ((state: CallState) => Partial<CallState>)) => void,
  get: () => CallState,
) {
  const params = inboundCallParams(incomingCall);
  const std = incomingCall.parameters as Record<string, string>;
  const ctx = {
    inboundCallId: params.inboundCallId || '',
    fromNumber: params.fromNumber || std.From || 'Unknown',
    toNumber: params.toNumber || std.To,
    callerName: params.callerName,
    departmentLabel: params.departmentLabel,
  };
  const isCallWaiting = Boolean(get().activeInboundCall && !get().heldInboundCall);
  if (isCallWaiting) {
    void showCallWaitingPreconnect(incomingCall, ctx, set, get);
    return;
  }
  showPendingFromConferenceContext(incomingCall, ctx, set, get);
}

function agentCallSidFromIncoming(call: Call): string | undefined {
  return (call.parameters as Record<string, string>)?.CallSid ?? undefined;
}

function showPendingInboundCall(
  incomingCall: Call,
  set: (partial: Partial<CallState> | ((state: CallState) => Partial<CallState>)) => void,
  get: () => CallState,
) {
  const { inboundCallId, fromNumber, toNumber, callerName, departmentLabel } =
    inboundCallParams(incomingCall);
  const hasActive = Boolean(get().activeInboundCall);
  const isCallWaiting = Boolean(hasActive && !get().heldInboundCall);
  if (isCallWaiting) {
    void showCallWaitingPreconnect(
      incomingCall,
      { inboundCallId, fromNumber, toNumber, callerName, departmentLabel },
      set,
      get,
    );
    return;
  }
  set({
    pendingInboundCall: {
      twilioCall: incomingCall,
      connectToken: inviteConnectToken(incomingCall),
      inboundCallId,
      fromNumber,
      toNumber,
      callerName,
      departmentLabel,
    },
    ...(hasActive ? { isInboundCallPanelOpen: true } : {}),
  });
  attachPendingInviteHandlers(incomingCall, set, get);
}

/** Reject a 3rd+ inbound ring when the agent is at max waiting capacity. */
function rejectOverflowInboundRing(incomingCall: Call): void {
  try {
    incomingCall.reject();
  } catch {
    incomingCall.ignore?.();
  }
}

function isAtInboundWaitingCapacity(state: CallState): boolean {
  return Boolean(
    state.activeInboundCall && (state.heldInboundCall || state.pendingInboundCall),
  );
}

export interface PendingInboundCall {
  twilioCall: Call;
  /** Original invite on the receiver device (call waiting pre-connect). */
  inviteCall?: Call;
  /** Captured at ring time for connectToken forwarding. */
  connectToken?: string;
  /** Call waiting leg is connected but agent has not confirmed attend yet. */
  awaitingAccept?: boolean;
  /** Secondary Device when this leg was forwarded via connectToken (call waiting). */
  legDevice?: Device | null;
  inboundCallId: string;
  fromNumber: string;
  toNumber?: string;
  callerName?: string;
  departmentLabel?: string;
  acceptedAt?: Date;
}

export interface ActiveCall {
  id: string;
  /** Backend call id (from POST /voice/call or null for simulated call). Used when saving summary. */
  backendCallId: string | null;
  /** Twilio CallSid captured from SDK on accept — sent with call summary so backend can fetch recording. */
  twilioCallSid?: string | null;
  /** Present for client softphone calls. */
  client?: Client;
  contact?: ClientContact;
  /** Present for employee softphone calls. */
  employee?: { id: string; firstName: string; lastName: string; phone: string };
  /** Display name / phone for bubble UI (client contact or employee). */
  partyName: string;
  partyPhone: string;
  startTime: Date;
  status: 'connecting' | 'active' | 'on_hold' | 'ended';
  duration: number;
}

interface CallState {
  activeCall: ActiveCall | null;
  isCallInterfaceOpen: boolean;
  isMinimized: boolean;
  defaultTab: string;

  // Twilio Voice SDK
  twilioDevice: Device | null;
  twilioCall: Call | null;
  deviceAgencyId: string | null;
  deviceReady: boolean;
  pendingInboundCall: PendingInboundCall | null;
  activeInboundCall: PendingInboundCall | null;
  /** A second answered call placed on hold while the agent talks on another (call swap). */
  heldInboundCall: PendingInboundCall | null;
  swapInProgress: boolean;
  isInboundCallPanelOpen: boolean;
  inboundCallDuration: number;
  inboundOnHold: boolean;
  inboundMuted: boolean;
  outboundMuted: boolean;

  // Actions
  initDevice: (subCompanyId?: string) => Promise<void>;
  destroyDevice: () => void;
  /** Connect the agent's browser to a conference room via device.connect() */
  connectToConference: (conferenceRoom: string) => Promise<void>;
  /** Outbound PSTN: bridges the agent WebRTC leg to `to` via the TwiML app (must pass CRM call row id). */
  connectOutboundCall: (to: string, callRecordId: string, subCompanyId?: string) => Promise<void>;
  /** backendCallId: from API when real call placed, or null for simulated call */
  startCall: (client: Client, contact: ClientContact, backendCallId?: string | null, twilioCallInstance?: Call | null) => void;
  /** Start an employee (or arbitrary party) outbound call without a Client. */
  startEmployeeCall: (
    employee: { id: string; firstName: string; lastName: string; phone: string },
    backendCallId?: string | null,
    twilioCallInstance?: Call | null,
  ) => void;
  endCall: () => void;
  holdCall: () => void;
  resumeCall: () => void;
  updateDuration: () => void;
  sendDigits: (digits: string) => void;
  muteCall: (muted: boolean) => void;
  openCallInterface: (client?: Client) => void;
  closeCallInterface: () => void;
  minimizeCall: () => void;
  maximizeCall: () => void;
  setDefaultTab: (tab: string) => void;
  setTwilioCall: (call: Call | null) => void;
  acceptInboundCall: () => void;
  /** Answer a second incoming call, automatically holding the current one (call waiting). */
  answerSecondCall: () => void;
  /** Swap the active call with the held call. */
  swapCalls: () => void;
  rejectInboundCall: () => void;
  endInboundCall: () => void;
  minimizeInboundCall: () => void;
  maximizeInboundCall: () => void;
  updateInboundDuration: () => void;
  holdInboundCall: () => void;
  resumeInboundCall: () => void;
  /** Remote caller/callee hung up — clear local state (socket backup when SDK event is missed). */
  handleRemotePartyHangup: (payload: VoiceCallEndedPayload) => void;
}

export const useCallStore = create<CallState>((set, get) => ({
  activeCall: null,
  isCallInterfaceOpen: false,
  isMinimized: false,
  defaultTab: 'notes',
  twilioDevice: null,
  twilioCall: null,
  deviceAgencyId: null,
  deviceReady: false,
  pendingInboundCall: null,
  activeInboundCall: null,
  heldInboundCall: null,
  swapInProgress: false,
  isInboundCallPanelOpen: false,
  inboundCallDuration: 0,
  inboundOnHold: false,
  inboundMuted: false,
  outboundMuted: false,

  initDevice: async (subCompanyId?: string) => {
    const agencyId =
      subCompanyId ?? useStore.getState().currentSubCompany?.id ?? undefined;
    const existing = get().twilioDevice;
    if (existing && get().deviceAgencyId === agencyId) return;

    if (existing) {
      existing.destroy();
      set({ twilioDevice: null, twilioCall: null, deviceReady: false, deviceAgencyId: null });
    }

    try {
      const token = await getVoiceToken(agencyId);
      const device = new Device(token, createVoiceDeviceOptions());

      device.on('registered', () => {
        set({ deviceReady: true });
      });

      device.on('error', (err) => {
        console.error('Twilio Device error:', err);
      });

      // Incoming calls — conference bridge rings agents via REST; legacy Client dial passes custom params.
      device.on('incoming', (incomingCall: Call) => {
        void (async () => {
          if (get().pendingInboundCall?.twilioCall === incomingCall) return;
          if (get().pendingInboundCall?.inviteCall === incomingCall) return;

          const state = get();
          const looksInbound =
            Boolean(agentCallSidFromIncoming(incomingCall)) || isInboundAgentRing(incomingCall);
          if (looksInbound && isAtInboundWaitingCapacity(state)) {
            rejectOverflowInboundRing(incomingCall);
            return;
          }

          const agentCallSid = agentCallSidFromIncoming(incomingCall);
          const isCallWaiting = Boolean(get().activeInboundCall && !get().heldInboundCall);

          if (agentCallSid) {
            const ctx = await resolveIncomingContext(agentCallSid);
            if (ctx) {
              if (isCallWaiting) {
                await showCallWaitingPreconnect(incomingCall, ctx, set, get);
              } else {
                showPendingFromConferenceContext(incomingCall, ctx, set, get);
              }
              return;
            }
            // Conference REST ring often has no custom params — still show UI so call waiting works.
            showPendingConferenceFallback(incomingCall, set, get);
            return;
          }

          if (isInboundAgentRing(incomingCall)) {
            showPendingInboundCall(incomingCall, set, get);
            return;
          }

          // Outbound conference auto-join only while placing an outbound call.
          const current = get().activeCall;
          if (!current || current.status !== 'connecting') return;

          incomingCall.accept();
          incomingCall.on('accept', () => {
            set({ twilioCall: incomingCall });
            markVoiceLegStarted();
            const live = get().activeCall;
            if (live && live.status === 'connecting') {
              set({ activeCall: { ...live, status: 'active', startTime: new Date() } });
            }
          });
          incomingCall.on('disconnect', () => {
            markVoiceLegEnded();
            const live = get().activeCall;
            if (live && live.status !== 'ended') {
              set({ activeCall: { ...live, status: 'ended' }, twilioCall: null });
            }
          });
        })();
      });

      device.on('tokenWillExpire', async () => {
        try {
          const newToken = await getVoiceToken(get().deviceAgencyId ?? agencyId);
          device.updateToken(newToken);
        } catch (e) {
          console.error('Failed to refresh voice token:', e);
        }
      });

      await device.register();
      set({ twilioDevice: device, deviceReady: true, deviceAgencyId: agencyId ?? null });
    } catch (err) {
      console.error('Failed to initialize Twilio Device:', err);
      set({ deviceReady: false });
    }
  },

  destroyDevice: () => {
    const device = get().twilioDevice;
    if (device) {
      device.destroy();
    }
    set({ twilioDevice: null, twilioCall: null, deviceReady: false, deviceAgencyId: null });
  },

  connectToConference: async (conferenceRoom: string) => {
    const device = get().twilioDevice;
    if (!device) {
      console.error('[callStore] Cannot connect to conference — device not initialized');
      return;
    }
    try {
      const call = await device.connect({ params: { ConferenceRoom: conferenceRoom } });
      set({ twilioCall: call });

      call.on('accept', () => {
        console.log('[callStore] Agent connected to conference:', conferenceRoom);
        markVoiceLegStarted();
        const current = get().activeCall;
        if (current && current.status === 'connecting') {
          set({ activeCall: { ...current, status: 'active' } });
        }
      });

      call.on('disconnect', () => {
        markVoiceLegEnded();
        const current = get().activeCall;
        if (current && current.status !== 'ended') {
          set({
            activeCall: { ...current, status: 'ended' },
            twilioCall: null,
          });
        }
      });
    } catch (err) {
      console.error('[callStore] Failed to connect to conference:', err);
    }
  },

  connectOutboundCall: async (to: string, callRecordId: string, subCompanyId?: string) => {
    if (subCompanyId && get().deviceAgencyId !== subCompanyId) {
      get().destroyDevice();
    }
    let device = get().twilioDevice;
    if (!device) {
      await get().initDevice(subCompanyId);
      device = get().twilioDevice;
    }
    if (!device) {
      throw new Error('Twilio Device not available');
    }

    const deadline = Date.now() + 20000;
    while (!get().deviceReady && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!get().deviceReady) {
      throw new Error('Twilio Device not registered — check microphone permission and network');
    }

    try {
      const conferenceRoom = `outbound-${callRecordId}`;
      const params: Record<string, string> = {
        ConferenceRoom: conferenceRoom,
        To: to,
        callRecordId,
        CrmCallId: callRecordId,
      };
      if (subCompanyId) {
        params.subCompanyId = subCompanyId;
        params.SubCompanyId = subCompanyId;
      }
      const call = await device.connect({ params });
      set({ twilioCall: call });

      call.on('accept', () => {
        markVoiceLegStarted();
        const twilioCallSid = (call.parameters as Record<string, string>)?.CallSid ?? null;
        const current = get().activeCall;
        if (current && current.status === 'connecting') {
          set({ activeCall: { ...current, status: 'active', startTime: new Date(), twilioCallSid } });
        }
      });

      call.on('disconnect', () => {
        markVoiceLegEnded();
        const current = get().activeCall;
        if (current && current.status !== 'ended') {
          set({ activeCall: { ...current, status: 'ended' }, twilioCall: null, outboundMuted: false });
        }
      });

      call.on('error', (err) => {
        console.error('[callStore] Outbound call error:', err);
      });
    } catch (err) {
      console.error('[callStore] connectOutboundCall failed:', err);
      throw err;
    }
  },

  startCall: (client, contact, backendCallId = null, twilioCallInstance = null) => {
    const callId = `call-${Date.now()}`;
    set({
      activeCall: {
        id: callId,
        backendCallId: backendCallId ?? null,
        client,
        contact,
        partyName: contact.name,
        partyPhone: contact.phone,
        startTime: new Date(),
        status: 'connecting',
        duration: 0,
      },
      twilioCall: twilioCallInstance ?? null,
      defaultTab: 'notes',
      outboundMuted: false,
    });
  },

  startEmployeeCall: (employee, backendCallId = null, twilioCallInstance = null) => {
    const callId = `call-${Date.now()}`;
    const partyName = `${employee.firstName} ${employee.lastName}`.trim() || 'Employee';
    set({
      activeCall: {
        id: callId,
        backendCallId: backendCallId ?? null,
        employee,
        partyName,
        partyPhone: employee.phone,
        startTime: new Date(),
        status: 'connecting',
        duration: 0,
      },
      twilioCall: twilioCallInstance ?? null,
      defaultTab: 'notes',
      outboundMuted: false,
    });
  },

  endCall: () => {
    const currentCall = get().activeCall;
    const call = get().twilioCall;
    const backendCallId = currentCall?.backendCallId;
    if (backendCallId) {
      void endOutboundCall(backendCallId).catch((err) => {
        console.error('[callStore] endOutboundCall failed:', err);
      });
    }
    if (call) {
      call.disconnect();
    }
    if (currentCall) {
      set({
        activeCall: { ...currentCall, status: 'ended' },
        twilioCall: null,
        outboundMuted: false,
      });
    }
  },

  holdCall: () => {
    const currentCall = get().activeCall;
    if (!currentCall?.backendCallId) return;
    const snapshot = currentCall;
    set({ activeCall: { ...snapshot, status: 'on_hold' } });
    void setOutboundHold(snapshot.backendCallId, true).catch((err) => {
      console.error('[callStore] outbound hold failed:', err);
      const live = get().activeCall;
      if (live?.id === snapshot.id) {
        set({ activeCall: { ...live, status: 'active' } });
      }
    });
  },

  resumeCall: () => {
    const currentCall = get().activeCall;
    if (!currentCall?.backendCallId) return;
    const snapshot = currentCall;
    set({ activeCall: { ...snapshot, status: 'active' } });
    void setOutboundHold(snapshot.backendCallId, false).catch((err) => {
      console.error('[callStore] outbound resume failed:', err);
    });
  },

  updateDuration: () => {
    const currentCall = get().activeCall;
    if (currentCall && (currentCall.status === 'active' || currentCall.status === 'on_hold')) {
      const elapsed = Math.floor((Date.now() - currentCall.startTime.getTime()) / 1000);
      set({ activeCall: { ...currentCall, duration: elapsed } });
    }
  },

  sendDigits: (digits: string) => {
    const call = get().twilioCall;
    if (call) {
      call.sendDigits(digits);
    }
  },

  muteCall: (muted: boolean) => {
    const state = get();
    const call = activeSdkCall(state);
    if (call) {
      call.mute(muted);
    }
    if (state.activeInboundCall) {
      set({ inboundMuted: muted });
    } else if (state.activeCall && state.activeCall.status !== 'ended') {
      set({ outboundMuted: muted });
    }
  },

  openCallInterface: (_client) => {
    set({
      isCallInterfaceOpen: true,
      isMinimized: false,
    });
  },

  closeCallInterface: () => {
    const currentCall = get().activeCall;
    if (!currentCall || currentCall.status === 'ended') {
      set({
        isCallInterfaceOpen: false,
        activeCall: null,
        twilioCall: null,
        outboundMuted: false,
      });
    } else {
      set({ isMinimized: true });
    }
  },

  minimizeCall: () => set({ isMinimized: true }),

  maximizeCall: () => set({ isMinimized: false, isCallInterfaceOpen: true }),

  setDefaultTab: (tab) => set({ defaultTab: tab }),

  setTwilioCall: (call) => set({ twilioCall: call }),

  acceptInboundCall: () => {
    void (async () => {
      const pending = get().pendingInboundCall;
      if (!pending) return;
      try {
        const { call, legDevice } = await connectInboundLeg(
          pending.twilioCall,
          get().deviceAgencyId,
          false,
          pending.connectToken,
          get().twilioDevice,
        );
        markVoiceLegStarted();
        attachAcceptedInboundHandlers(call, set, get);
        const accepted: PendingInboundCall = {
          ...pending,
          twilioCall: call,
          legDevice,
          awaitingAccept: false,
          acceptedAt: new Date(),
        };
        focusInboundLegs(accepted, null);
        set({
          pendingInboundCall: null,
          activeInboundCall: accepted,
          twilioCall: call,
          isInboundCallPanelOpen: true,
          inboundOnHold: false,
          inboundMuted: false,
          inboundCallDuration: 0,
        });
        if (pending.inboundCallId) {
          void patchInboundCall(pending.inboundCallId, { outcome: 'answered' }).catch(() => undefined);
        }
      } catch (err) {
        console.error('[callStore] acceptInboundCall failed:', err);
        toast.error(err instanceof Error ? err.message : 'Failed to answer call');
      }
    })();
  },

  answerSecondCall: () => {
    void (async () => {
      const state = get();
      const pending = state.pendingInboundCall;
      const active = state.activeInboundCall;
      if (!pending) return;
      if (!active) {
        get().acceptInboundCall();
        return;
      }
      if (state.heldInboundCall) {
        toast.error('You can only handle two inbound calls at once');
        return;
      }
      if (state.swapInProgress) return;

      set({ swapInProgress: true });
      try {
        if (!active.inboundCallId) {
          throw new Error('Current call cannot be placed on hold');
        }

        // Call waiting leg was pre-connected when the invite arrived.
        if (pending.awaitingAccept && pending.legDevice) {
          await setInboundHold(active.inboundCallId, true);
          const accepted: PendingInboundCall = {
            ...pending,
            awaitingAccept: false,
            acceptedAt: new Date(),
          };
          focusInboundLegs(accepted, active);
          set({
            pendingInboundCall: null,
            heldInboundCall: active,
            activeInboundCall: accepted,
            twilioCall: pending.twilioCall,
            isInboundCallPanelOpen: true,
            inboundOnHold: false,
            inboundMuted: false,
            inboundCallDuration: 0,
          });
          if (pending.inboundCallId) {
            void patchInboundCall(pending.inboundCallId, { outcome: 'answered' }).catch(() => undefined);
          }
          return;
        }

        const [, connectResult] = await Promise.all([
          setInboundHold(active.inboundCallId, true),
          connectInboundLeg(
            pending.twilioCall,
            get().deviceAgencyId,
            true,
            pending.connectToken,
            get().twilioDevice,
          ),
        ]);
        const { call, legDevice } = connectResult;
        markVoiceLegStarted();
        attachAcceptedInboundHandlers(call, set, get);
        if (pending.inviteCall && pending.inviteCall !== call) {
          try {
            pending.inviteCall.ignore();
          } catch {
            // Original invite may already be ignored.
          }
        }
        const accepted: PendingInboundCall = {
          ...pending,
          twilioCall: call,
          legDevice,
          awaitingAccept: false,
          acceptedAt: new Date(),
        };
        focusInboundLegs(accepted, active);
        set({
          pendingInboundCall: null,
          heldInboundCall: active,
          activeInboundCall: accepted,
          twilioCall: call,
          isInboundCallPanelOpen: true,
          inboundOnHold: false,
          inboundMuted: false,
          inboundCallDuration: 0,
        });
        if (pending.inboundCallId) {
          void patchInboundCall(pending.inboundCallId, { outcome: 'answered' }).catch(() => undefined);
        }
      } catch (err) {
        console.error('[callStore] answerSecondCall failed:', err);
        toast.error(err instanceof Error ? err.message : 'Failed to answer waiting call');
      } finally {
        set({ swapInProgress: false });
      }
    })();
  },

  swapCalls: () => {
    void (async () => {
      const state = get();
      if (state.swapInProgress) return;
      const active = state.activeInboundCall;
      const held = state.heldInboundCall;
      if (!active || !held) return;
      set({ swapInProgress: true });
      try {
        if (!active.inboundCallId || !held.inboundCallId) {
          throw new Error('Swap is unavailable for this call');
        }
        await setInboundHold(active.inboundCallId, true);
        await setInboundHold(held.inboundCallId, false);
        focusInboundLegs(held, active);
        set({
          activeInboundCall: held,
          heldInboundCall: active,
          twilioCall: held.twilioCall ?? null,
          inboundOnHold: false,
          inboundMuted: false,
        });
      } catch (err) {
        console.error('[callStore] swapCalls failed:', err);
        focusInboundLegs(active, held);
        toast.error(err instanceof Error ? err.message : 'Failed to swap calls');
      } finally {
        set({ swapInProgress: false });
      }
    })();
  },

  rejectInboundCall: () => {
    const pending = get().pendingInboundCall;
    if (!pending) return;

    if (pending.awaitingAccept) {
      markVoiceLegEnded();
      try {
        pending.twilioCall.disconnect();
      } catch {
        // Already disconnected.
      }
      destroyInboundLegDevice(pending.legDevice);
      try {
        pending.inviteCall?.reject();
      } catch {
        // Invite may already be gone.
      }
      set({ pendingInboundCall: null, swapInProgress: false });
      return;
    }

    pending.twilioCall.reject();
    set({ pendingInboundCall: null });
  },

  endInboundCall: () => {
    const active = get().activeInboundCall;
    const held = get().heldInboundCall;
    const pending = get().pendingInboundCall;
    tearingDownInboundCalls = true;

    const patchEndedCall = (call: PendingInboundCall) => {
      const duration = call.acceptedAt
        ? Math.floor((Date.now() - call.acceptedAt.getTime()) / 1000)
        : undefined;
      if (call.inboundCallId) {
        void patchInboundCall(call.inboundCallId, {
          outcome: 'answered',
          durationSec: duration,
        }).catch(() => undefined);
      }
    };

    if (pending?.awaitingAccept) {
      try {
        pending.twilioCall.disconnect();
      } catch {
        // Already disconnected.
      }
      destroyInboundLegDevice(pending.legDevice);
    }

    if (held) {
      patchEndedCall(held);
      if (held.inboundCallId) {
        void endInboundCallApi(held.inboundCallId).catch((err) => {
          console.error('[callStore] endInboundCallApi failed:', err);
        });
      }
      if (held.twilioCall) {
        held.twilioCall.disconnect();
      }
      destroyInboundLegDevice(held.legDevice);
    }

    if (active) {
      patchEndedCall(active);
      if (active.inboundCallId) {
        void endInboundCallApi(active.inboundCallId).catch((err) => {
          console.error('[callStore] endInboundCallApi failed:', err);
        });
      }
      if (active.twilioCall) {
        active.twilioCall.disconnect();
      }
      destroyInboundLegDevice(active.legDevice);
    }

    set({
      activeInboundCall: null,
      heldInboundCall: null,
      twilioCall: null,
      pendingInboundCall: null,
      isInboundCallPanelOpen: false,
      inboundOnHold: false,
      inboundMuted: false,
      inboundCallDuration: 0,
      swapInProgress: false,
    });
    setTimeout(() => {
      tearingDownInboundCalls = false;
    }, 500);
  },

  minimizeInboundCall: () => set({ isInboundCallPanelOpen: false }),

  maximizeInboundCall: () => set({ isInboundCallPanelOpen: true }),

  updateInboundDuration: () => {
    const active = get().activeInboundCall;
    if (active?.acceptedAt) {
      const elapsed = Math.floor((Date.now() - active.acceptedAt.getTime()) / 1000);
      set({ inboundCallDuration: elapsed });
    }
  },

  holdInboundCall: () => {
    const active = get().activeInboundCall;
    if (!active?.inboundCallId) {
      toast.error('Hold is unavailable for this call');
      return;
    }
    set({ inboundOnHold: true });
    void setInboundHold(active.inboundCallId, true).catch((err) => {
      console.error('[callStore] inbound hold failed:', err);
      set({ inboundOnHold: false });
      toast.error(err instanceof Error ? err.message : 'Failed to put caller on hold');
    });
  },

  resumeInboundCall: () => {
    const active = get().activeInboundCall;
    if (!active?.inboundCallId) return;
    set({ inboundOnHold: false });
    void setInboundHold(active.inboundCallId, false).catch((err) => {
      console.error('[callStore] inbound resume failed:', err);
      set({ inboundOnHold: true });
      toast.error(err instanceof Error ? err.message : 'Failed to resume caller');
    });
  },

  handleRemotePartyHangup: (payload) => {
    if (payload.type === 'inbound' && payload.inboundCallId) {
      const inboundCallId = payload.inboundCallId;
      const state = get();

      if (state.pendingInboundCall?.inboundCallId === inboundCallId) {
        const pending = state.pendingInboundCall;
        if (pending.awaitingAccept) {
          markVoiceLegEnded();
        }
        try {
          pending.twilioCall.disconnect();
        } catch {
          // Already disconnected.
        }
        destroyInboundLegDevice(pending.legDevice);
        set({ pendingInboundCall: null, swapInProgress: false });
        return;
      }

      if (state.activeInboundCall?.inboundCallId === inboundCallId) {
        const active = state.activeInboundCall;
        const duration = active.acceptedAt
          ? Math.floor((Date.now() - active.acceptedAt.getTime()) / 1000)
          : undefined;
        if (active.inboundCallId) {
          void patchInboundCall(active.inboundCallId, {
            outcome: 'answered',
            durationSec: duration,
          }).catch(() => undefined);
        }
        try {
          active.twilioCall?.disconnect();
        } catch {
          // Already disconnected.
        }
        destroyInboundLegDevice(active.legDevice);

        const held = state.heldInboundCall;
        if (held) {
          void promoteHeldToActive(held)
            .then(() => {
              set({
                activeInboundCall: held,
                heldInboundCall: null,
                twilioCall: held.twilioCall ?? null,
                isInboundCallPanelOpen: true,
                inboundOnHold: false,
                inboundMuted: false,
                inboundCallDuration: 0,
              });
            })
            .catch((err) => {
              console.error('[callStore] remote hangup promote failed:', err);
              toast.error(err instanceof Error ? err.message : 'Failed to resume held caller');
            });
        } else {
          set({
            activeInboundCall: null,
            twilioCall: null,
            isInboundCallPanelOpen: false,
            inboundOnHold: false,
            inboundMuted: false,
            inboundCallDuration: 0,
          });
        }
        return;
      }

      if (state.heldInboundCall?.inboundCallId === inboundCallId) {
        const held = state.heldInboundCall;
        const duration = held.acceptedAt
          ? Math.floor((Date.now() - held.acceptedAt.getTime()) / 1000)
          : undefined;
        if (held.inboundCallId) {
          void patchInboundCall(held.inboundCallId, {
            outcome: 'answered',
            durationSec: duration,
          }).catch(() => undefined);
        }
        try {
          held.twilioCall?.disconnect();
        } catch {
          // Already disconnected.
        }
        destroyInboundLegDevice(held.legDevice);
        set({ heldInboundCall: null });
      }
      return;
    }

    if (payload.type === 'outbound' && payload.callRecordId) {
      const state = get();
      if (state.activeCall?.backendCallId !== payload.callRecordId) return;
      if (state.activeCall.status === 'ended') return;
      try {
        state.twilioCall?.disconnect();
      } catch {
        // Already disconnected.
      }
      set({
        activeCall: { ...state.activeCall, status: 'ended' },
        twilioCall: null,
        outboundMuted: false,
      });
    }
  },
}));
