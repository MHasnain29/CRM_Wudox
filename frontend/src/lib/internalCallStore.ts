/**
 * Staff↔staff WebRTC calling (Messages). Separate from Twilio CRM callStore.
 */
import { create } from 'zustand';
import { toast } from 'sonner';
import { fetchInternalCallIceConfig } from './api';
import { useStore } from './store';
import {
  emitInternalCallAccept,
  emitInternalCallBusyHere,
  emitInternalCallCancel,
  emitInternalCallEnded,
  emitInternalCallInvite,
  emitInternalCallReject,
  emitInternalCallSignal,
  waitForSocket,
  onInternalCallAccepted,
  onInternalCallBusy,
  onInternalCallCancelled,
  onInternalCallEnded,
  onInternalCallError,
  onInternalCallIncoming,
  onInternalCallRejected,
  onInternalCallSignal,
  type InternalCallMedia,
} from './socket';
import { startIncomingRing, startOutgoingDialTone, stopCallSounds } from './callRing';

export type InternalCallStatus = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'in_call';

export interface InternalCallState {
  status: InternalCallStatus;
  callId: string | null;
  conversationId: string | null;
  peerUserId: string | null;
  peerName: string | null;
  mediaType: InternalCallMedia;
  muted: boolean;
  cameraOff: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  error: string | null;

  startCall: (args: {
    conversationId: string;
    peerUserId: string;
    peerName: string;
    mediaType: InternalCallMedia;
  }) => Promise<void>;
  accept: () => Promise<void>;
  reject: () => void;
  cancel: () => void;
  hangup: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  bindListeners: () => () => void;
}

let pc: RTCPeerConnection | null = null;
let iceCache: RTCIceServer[] | null = null;
let makingOffer = false;
let bindCount = 0;
let activeUnsubs: Array<() => void> = [];
const pendingRemoteIce: RTCIceCandidateInit[] = [];

function newCallId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ic-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function getIceServers(): Promise<RTCIceServer[]> {
  if (iceCache) return iceCache;
  iceCache = await fetchInternalCallIceConfig();
  return iceCache;
}

function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {
      // ignore
    }
  });
}

function cleanupMedia(): void {
  if (pc) {
    try {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    } catch {
      // ignore
    }
    pc = null;
  }
  pendingRemoteIce.length = 0;
  makingOffer = false;
}

async function flushPendingIce(): Promise<void> {
  if (!pc?.remoteDescription) return;
  while (pendingRemoteIce.length > 0) {
    const c = pendingRemoteIce.shift();
    if (!c) continue;
    try {
      await pc.addIceCandidate(c);
    } catch {
      // ignore stale candidates
    }
  }
}

async function ensurePeerConnection(
  get: () => InternalCallState,
  set: (partial: Partial<InternalCallState>) => void,
): Promise<RTCPeerConnection> {
  if (pc) return pc;
  const iceServers = await getIceServers();
  pc = new RTCPeerConnection({ iceServers });

  pc.onicecandidate = (ev) => {
    const callId = get().callId;
    if (!callId || !ev.candidate) return;
    emitInternalCallSignal({
      callId,
      type: 'ice',
      candidate: ev.candidate.toJSON(),
    });
  };

  pc.ontrack = (ev) => {
    const [stream] = ev.streams;
    if (stream) {
      set({ remoteStream: stream });
    } else {
      const remote = get().remoteStream ?? new MediaStream();
      remote.addTrack(ev.track);
      set({ remoteStream: remote });
    }
  };

  pc.onconnectionstatechange = () => {
    const state = pc?.connectionState;
    if (state === 'connected') {
      set({ status: 'in_call' });
    } else if (state === 'failed' || state === 'closed') {
      const callId = get().callId;
      if (callId && get().status !== 'idle') {
        get().hangup();
      }
    }
  };

  return pc;
}

async function attachLocalMedia(
  mediaType: InternalCallMedia,
  get: () => InternalCallState,
  set: (partial: Partial<InternalCallState>) => void,
): Promise<MediaStream> {
  const existing = get().localStream;
  if (existing) return existing;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: mediaType === 'video',
  });
  set({ localStream: stream });

  const connection = await ensurePeerConnection(get, set);
  for (const track of stream.getTracks()) {
    connection.addTrack(track, stream);
  }
  return stream;
}

function setLocalAudioEnabled(stream: MediaStream | null, enabled: boolean): void {
  stream?.getAudioTracks().forEach((t) => {
    t.enabled = enabled;
  });
  // RTCRtpSender tracks are what the peer actually receives
  pc?.getSenders().forEach((sender) => {
    if (sender.track?.kind === 'audio') {
      sender.track.enabled = enabled;
    }
  });
}

function setLocalVideoEnabled(stream: MediaStream | null, enabled: boolean): void {
  stream?.getVideoTracks().forEach((t) => {
    t.enabled = enabled;
  });
  pc?.getSenders().forEach((sender) => {
    if (sender.track?.kind === 'video') {
      sender.track.enabled = enabled;
    }
  });
}

function resetCallState(
  set: (partial: Partial<InternalCallState>) => void,
  localStream: MediaStream | null,
): void {
  stopCallSounds();
  stopTracks(localStream);
  cleanupMedia();
  set({
    status: 'idle',
    callId: null,
    conversationId: null,
    peerUserId: null,
    peerName: null,
    mediaType: 'audio',
    muted: false,
    cameraOff: false,
    localStream: null,
    remoteStream: null,
    error: null,
  });
}

export const useInternalCallStore = create<InternalCallState>((set, get) => ({
  status: 'idle',
  callId: null,
  conversationId: null,
  peerUserId: null,
  peerName: null,
  mediaType: 'audio',
  muted: false,
  cameraOff: false,
  localStream: null,
  remoteStream: null,
  error: null,

  startCall: async ({ conversationId, peerUserId, peerName, mediaType }) => {
    if (get().status !== 'idle') {
      toast.error('You are already on a call');
      return;
    }

    const sock = await waitForSocket();
    if (!sock?.connected) {
      toast.error('Not connected — refresh the page and try again');
      return;
    }

    const callId = newCallId();
    set({
      status: 'outgoing',
      callId,
      conversationId,
      peerUserId,
      peerName,
      mediaType,
      muted: false,
      cameraOff: false,
      error: null,
      remoteStream: null,
    });
    startOutgoingDialTone();

    try {
      await attachLocalMedia(mediaType, get, set);
    } catch {
      resetCallState(set, get().localStream);
      toast.error('Microphone/camera permission denied');
      return;
    }

    emitInternalCallInvite({ callId, conversationId, calleeId: peerUserId, mediaType });
  },

  accept: async () => {
    const { status, callId, mediaType } = get();
    if (status !== 'incoming' || !callId) return;

    stopCallSounds();
    set({ status: 'connecting' });
    try {
      await attachLocalMedia(mediaType, get, set);
    } catch {
      emitInternalCallReject(callId);
      resetCallState(set, get().localStream);
      toast.error('Microphone/camera permission denied');
      return;
    }

    emitInternalCallAccept(callId);
  },

  reject: () => {
    const { callId, localStream, status } = get();
    if (status !== 'incoming' || !callId) return;
    emitInternalCallReject(callId);
    resetCallState(set, localStream);
  },

  cancel: () => {
    const { callId, localStream, status } = get();
    if (status !== 'outgoing' || !callId) return;
    emitInternalCallCancel(callId);
    resetCallState(set, localStream);
  },

  hangup: () => {
    const { callId, localStream, status } = get();
    if (status === 'idle') return;
    if (callId && (status === 'connecting' || status === 'in_call' || status === 'outgoing')) {
      if (status === 'outgoing') {
        emitInternalCallCancel(callId);
      } else {
        emitInternalCallEnded(callId);
      }
    }
    resetCallState(set, localStream);
  },

  toggleMute: () => {
    const { localStream, muted } = get();
    const next = !muted;
    setLocalAudioEnabled(localStream, !next);
    set({ muted: next });
  },

  toggleCamera: () => {
    const { localStream, cameraOff, mediaType } = get();
    if (mediaType !== 'video') return;
    const next = !cameraOff;
    setLocalVideoEnabled(localStream, !next);
    set({ cameraOff: next });
  },

  bindListeners: () => {
    if (bindCount === 0) {
      activeUnsubs = [
      onInternalCallIncoming(async (payload) => {
        const state = get();
        // Same callId = echo of our own invite (must not auto-reject / clear session)
        if (state.callId === payload.callId) return;
        // Room echo to linked self
        const myId = useStore.getState().currentUser?.id;
        if (myId && payload.callerId === myId) return;
        if (state.status !== 'idle') {
          // Already on a call — tell caller "busy", not declined/offline
          emitInternalCallBusyHere(payload.callId);
          return;
        }
        set({
          status: 'incoming',
          callId: payload.callId,
          conversationId: payload.conversationId,
          peerUserId: payload.callerId,
          peerName: payload.callerName,
          mediaType: payload.mediaType,
          muted: false,
          cameraOff: false,
          error: null,
          localStream: null,
          remoteStream: null,
        });
        startIncomingRing();
      }),

      onInternalCallAccepted(async (payload) => {
        const state = get();
        if (state.callId !== payload.callId || state.status !== 'outgoing') return;
        stopCallSounds();
        set({ status: 'connecting' });
        try {
          const connection = await ensurePeerConnection(get, set);
          makingOffer = true;
          const offer = await connection.createOffer();
          await connection.setLocalDescription(offer);
          emitInternalCallSignal({
            callId: payload.callId,
            type: 'offer',
            sdp: connection.localDescription ?? offer,
          });
        } catch {
          toast.error('Could not start call');
          get().hangup();
        } finally {
          makingOffer = false;
        }
      }),

      onInternalCallRejected((payload) => {
        if (get().callId !== payload.callId) return;
        toast.message('Call declined');
        resetCallState(set, get().localStream);
      }),

      onInternalCallBusy((payload) => {
        if (get().callId && get().callId !== payload.callId) return;
        toast.error('User is on another call');
        resetCallState(set, get().localStream);
      }),

      onInternalCallCancelled((payload) => {
        if (get().callId !== payload.callId) return;
        toast.message('Call cancelled');
        resetCallState(set, get().localStream);
      }),

      onInternalCallEnded((payload) => {
        if (get().callId !== payload.callId) return;
        resetCallState(set, get().localStream);
      }),

      onInternalCallError((payload) => {
        if (payload.callId && get().callId && payload.callId !== get().callId) return;
        const reason = payload.reason;
        if (reason === 'callee_offline') {
          toast.error('User is offline');
        } else if (reason === 'not_participant') {
          toast.error('Cannot call this user');
        } else {
          toast.error('Could not place call');
        }
        resetCallState(set, get().localStream);
      }),

      onInternalCallSignal(async (payload) => {
        const state = get();
        if (state.callId !== payload.callId) return;
        if (state.status === 'idle' || state.status === 'outgoing') {
          // Wait until accepted / connecting before applying signals (except we may get early ice)
          if (state.status === 'outgoing' && payload.type !== 'ice') return;
        }

        try {
          const connection = await ensurePeerConnection(get, set);

          if (payload.type === 'offer' && payload.sdp) {
            if (makingOffer) return;
            await connection.setRemoteDescription(payload.sdp);
            await flushPendingIce();
            if (!get().localStream) {
              await attachLocalMedia(get().mediaType, get, set);
            }
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            emitInternalCallSignal({
              callId: payload.callId,
              type: 'answer',
              sdp: connection.localDescription ?? answer,
            });
            set({ status: 'connecting' });
          } else if (payload.type === 'answer' && payload.sdp) {
            await connection.setRemoteDescription(payload.sdp);
            await flushPendingIce();
            set({ status: 'connecting' });
          } else if (payload.type === 'ice' && payload.candidate) {
            if (connection.remoteDescription) {
              await connection.addIceCandidate(payload.candidate);
            } else {
              pendingRemoteIce.push(payload.candidate);
            }
          }
        } catch {
          // Ignore signaling races; hangup cleans up if connection fails
        }
      }),
      ];
    }
    bindCount += 1;
    return () => {
      bindCount = Math.max(0, bindCount - 1);
      if (bindCount === 0) {
        activeUnsubs.forEach((u) => u());
        activeUnsubs = [];
      }
    };
  },
}));
