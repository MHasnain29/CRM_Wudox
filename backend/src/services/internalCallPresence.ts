/**
 * In-memory presence for staff↔staff WebRTC calls (chat module).
 * Separate from Twilio CRM agentPhonePresence.
 */

export type InternalCallMedia = 'audio' | 'video';

export type InternalCallPhase = 'ringing' | 'active';

export interface InternalCallSession {
  callId: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  mediaType: InternalCallMedia;
  phase: InternalCallPhase;
  startedAt: number;
  /** Set when callee accepts */
  answeredAt?: number;
}

/** userId → active/ringing session */
const byUser = new Map<string, InternalCallSession>();
/** callId → session */
const byCall = new Map<string, InternalCallSession>();

export function getSessionByCallId(callId: string): InternalCallSession | undefined {
  return byCall.get(callId);
}

export function getSessionForUser(userId: string): InternalCallSession | undefined {
  return byUser.get(userId);
}

export function getAllSessions(): InternalCallSession[] {
  return Array.from(byCall.values());
}

export function isInternalCallBusy(userId: string): boolean {
  return byUser.has(userId);
}

export function startRinging(session: Omit<InternalCallSession, 'phase' | 'startedAt'>): InternalCallSession {
  const full: InternalCallSession = {
    ...session,
    phase: 'ringing',
    startedAt: Date.now(),
  };
  byCall.set(full.callId, full);
  byUser.set(full.callerId, full);
  byUser.set(full.calleeId, full);
  return full;
}

export function markActive(callId: string): InternalCallSession | undefined {
  const session = byCall.get(callId);
  if (!session) return undefined;
  session.phase = 'active';
  session.answeredAt = Date.now();
  byCall.set(callId, session);
  byUser.set(session.callerId, session);
  byUser.set(session.calleeId, session);
  return session;
}

export function clearCall(callId: string): InternalCallSession | undefined {
  const session = byCall.get(callId);
  if (!session) return undefined;
  byCall.delete(callId);
  if (byUser.get(session.callerId)?.callId === callId) byUser.delete(session.callerId);
  if (byUser.get(session.calleeId)?.callId === callId) byUser.delete(session.calleeId);
  return session;
}

/** Clear any ringing/active session involving this user (e.g. socket disconnect). */
export function clearCallsForUser(userId: string): InternalCallSession | undefined {
  const session = byUser.get(userId);
  if (!session) return undefined;
  return clearCall(session.callId);
}

export function peerIdFor(session: InternalCallSession, userId: string): string | null {
  if (userId === session.callerId) return session.calleeId;
  if (userId === session.calleeId) return session.callerId;
  return null;
}
