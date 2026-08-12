/**
 * Socket.IO server for real-time messaging and notifications.
 *
 * Architecture (multi-agency, large company):
 * - Per-user rooms (user:${userId}): each socket joins one room per user. No agency
 *   room; we only emit to specific user IDs (conversation participants). This keeps
 *   agencies isolated: user A in agency 1 never receives events for agency 2.
 * - Messages: when a message is sent, we emit only to that conversation's participants
 *   (conversations are already agency-scoped in DB). So chat and unread updates are
 *   real-time without cross-agency leakage.
 * - Internal calls: same room delivery as chat (supports agency-linked sockets).
 * - Scale: one connection per logged-in client; broadcast only to participant userIds.
 */
import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { corsOriginDelegate } from '../config/corsOrigins';
import { env } from '../config/env';
import type { JwtPayload } from '../middleware/auth';
import prisma from '../config/database';
import {
  clearCall,
  clearCallsForUser,
  getAllSessions,
  getSessionByCallId,
  isInternalCallBusy,
  markActive,
  startRinging,
  type InternalCallMedia,
} from '../services/internalCallPresence';
import {
  outcomeForClearedSession,
  recordInternalCallHistory,
} from '../services/internalCallHistory';

const USER_ROOM_PREFIX = 'user:';

let io: Server | null = null;

type AuthedSocket = Socket & { userId: string };

async function areConversationParticipants(
  conversationId: string,
  userA: string,
  userB: string,
): Promise<boolean> {
  const participants = await prisma.conversationParticipant.findMany({
    where: { conversationId },
    select: { userId: true },
  });
  const ids = new Set(participants.map((p) => p.userId));
  return ids.has(userA) && ids.has(userB);
}

/**
 * Resolve who is placing the call: JWT user, or their linked identity that is
 * actually a conversation participant (agency-link / act-as style sessions).
 */
async function resolveCallerParticipant(
  conversationId: string,
  socketUserId: string,
  calleeId: string,
): Promise<string | null> {
  const participants = await prisma.conversationParticipant.findMany({
    where: { conversationId },
    select: { userId: true },
  });
  const ids = participants.map((p) => p.userId);
  if (!ids.includes(calleeId)) return null;
  if (ids.includes(socketUserId) && socketUserId !== calleeId) return socketUserId;

  try {
    const link = await prisma.userAgencyLink.findFirst({
      where: { userId: socketUserId },
      select: { groupId: true },
    });
    if (!link) return null;
    const members = await prisma.userAgencyLink.findMany({
      where: { groupId: link.groupId },
      select: { userId: true },
    });
    const linked = new Set(members.map((m) => m.userId));
    return ids.find((id) => id !== calleeId && linked.has(id)) ?? null;
  } catch {
    return null;
  }
}

async function displayName(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true },
  });
  if (!user) return 'Colleague';
  const name = `${user.firstName} ${user.lastName}`.trim();
  return name || user.email || 'Colleague';
}

/** True if this socket is the user, or has joined their room (agency link). */
function socketRepresentsUser(socket: AuthedSocket, targetUserId: string): boolean {
  if (socket.userId === targetUserId) return true;
  return socket.rooms.has(USER_ROOM_PREFIX + targetUserId);
}

/** Reachable the same way chat is: exact socket or anyone in user:{id} room. */
function isUserReachable(userId: string): boolean {
  if (!io) return false;
  for (const sock of io.sockets.sockets.values()) {
    if ((sock as AuthedSocket).userId === userId) return true;
  }
  const room = io.sockets.adapter.rooms.get(USER_ROOM_PREFIX + userId);
  return Boolean(room && room.size > 0);
}

/** Busy if canonical id or any connected socket sitting in their room is in a call. */
function isCalleeEffectivelyBusy(calleeId: string): boolean {
  if (isInternalCallBusy(calleeId)) return true;
  if (!io) return false;
  const room = io.sockets.adapter.rooms.get(USER_ROOM_PREFIX + calleeId);
  if (!room) return false;
  for (const sid of room) {
    const sock = io.sockets.sockets.get(sid) as AuthedSocket | undefined;
    if (sock?.userId && isInternalCallBusy(sock.userId)) return true;
  }
  return false;
}

function attachInternalCallHandlers(socket: AuthedSocket): void {
  socket.on(
    'internal-call:invite',
    async (payload: {
      callId?: string;
      conversationId?: string;
      calleeId?: string;
      mediaType?: InternalCallMedia;
    }) => {
      const socketUserId = socket.userId;
      const callId = typeof payload?.callId === 'string' ? payload.callId.trim() : '';
      const conversationId =
        typeof payload?.conversationId === 'string' ? payload.conversationId.trim() : '';
      const calleeId = typeof payload?.calleeId === 'string' ? payload.calleeId.trim() : '';
      const mediaType: InternalCallMedia =
        payload?.mediaType === 'video' ? 'video' : 'audio';

      if (!callId || !conversationId || !calleeId) {
        socket.emit('internal-call:error', { callId, reason: 'invalid_invite' });
        return;
      }

      const callerId = await resolveCallerParticipant(conversationId, socketUserId, calleeId);
      if (!callerId || callerId === calleeId) {
        // Fallback: classic 1:1 participant check with JWT user
        const ok = await areConversationParticipants(conversationId, socketUserId, calleeId);
        if (!ok || socketUserId === calleeId) {
          socket.emit('internal-call:error', { callId, reason: 'not_participant' });
          return;
        }
      }

      const resolvedCallerId = callerId ?? socketUserId;

      if (isInternalCallBusy(socketUserId) || isInternalCallBusy(resolvedCallerId)) {
        socket.emit('internal-call:busy', { callId, reason: 'self_busy' });
        return;
      }

      if (isCalleeEffectivelyBusy(calleeId)) {
        socket.emit('internal-call:busy', { callId, reason: 'callee_busy' });
        return;
      }

      if (!isUserReachable(calleeId)) {
        socket.emit('internal-call:error', { callId, reason: 'callee_offline' });
        return;
      }

      startRinging({
        callId,
        conversationId,
        callerId: resolvedCallerId,
        calleeId,
        mediaType,
      });

      const callerName = await displayName(resolvedCallerId);
      // Same delivery path as chat messages (rooms include agency-linked sockets)
      emitToUsers([calleeId], 'internal-call:incoming', {
        callId,
        conversationId,
        callerId: resolvedCallerId,
        callerName,
        mediaType,
      });
    },
  );

  socket.on('internal-call:accept', (payload: { callId?: string }) => {
    const callId = typeof payload?.callId === 'string' ? payload.callId.trim() : '';
    const session = getSessionByCallId(callId);
    if (!session || !socketRepresentsUser(socket, session.calleeId)) return;

    markActive(callId);
    emitToUsers([session.callerId], 'internal-call:accepted', {
      callId,
      conversationId: session.conversationId,
      mediaType: session.mediaType,
      peerId: session.calleeId,
    });
  });

  socket.on('internal-call:busy-here', (payload: { callId?: string }) => {
    const callId = typeof payload?.callId === 'string' ? payload.callId.trim() : '';
    const session = getSessionByCallId(callId);
    if (!session || !socketRepresentsUser(socket, session.calleeId)) return;

    clearCall(callId);
    emitToUsers([session.callerId], 'internal-call:busy', {
      callId,
      reason: 'callee_busy',
    });
    void recordInternalCallHistory(session, 'missed');
  });

  socket.on('internal-call:reject', (payload: { callId?: string }) => {
    const callId = typeof payload?.callId === 'string' ? payload.callId.trim() : '';
    const session = getSessionByCallId(callId);
    if (!session || !socketRepresentsUser(socket, session.calleeId)) return;

    clearCall(callId);
    emitToUsers([session.callerId], 'internal-call:rejected', { callId });
    void recordInternalCallHistory(session, 'declined');
  });

  socket.on('internal-call:cancel', (payload: { callId?: string }) => {
    const callId = typeof payload?.callId === 'string' ? payload.callId.trim() : '';
    const session = getSessionByCallId(callId);
    if (!session || !socketRepresentsUser(socket, session.callerId)) return;

    clearCall(callId);
    emitToUsers([session.calleeId], 'internal-call:cancelled', { callId });
    void recordInternalCallHistory(session, 'cancelled');
  });

  socket.on('internal-call:ended', (payload: { callId?: string }) => {
    const callId = typeof payload?.callId === 'string' ? payload.callId.trim() : '';
    const session = getSessionByCallId(callId);
    if (!session) return;
    if (
      !socketRepresentsUser(socket, session.callerId) &&
      !socketRepresentsUser(socket, session.calleeId)
    ) {
      return;
    }

    const peer = socketRepresentsUser(socket, session.callerId)
      ? session.calleeId
      : session.callerId;
    clearCall(callId);
    emitToUsers([peer], 'internal-call:ended', { callId });
    void recordInternalCallHistory(session, outcomeForClearedSession(session));
  });

  socket.on(
    'internal-call:signal',
    (payload: {
      callId?: string;
      type?: 'offer' | 'answer' | 'ice';
      sdp?: { type?: string; sdp?: string };
      candidate?: Record<string, unknown> | null;
    }) => {
      const callId = typeof payload?.callId === 'string' ? payload.callId.trim() : '';
      const session = getSessionByCallId(callId);
      if (!session) return;
      if (
        !socketRepresentsUser(socket, session.callerId) &&
        !socketRepresentsUser(socket, session.calleeId)
      ) {
        return;
      }

      const peer = socketRepresentsUser(socket, session.callerId)
        ? session.calleeId
        : session.callerId;

      const type = payload?.type;
      if (type !== 'offer' && type !== 'answer' && type !== 'ice') return;

      emitToUsers([peer], 'internal-call:signal', {
        callId,
        type,
        sdp: payload.sdp,
        candidate: payload.candidate,
      });
    },
  );

  socket.on('disconnect', () => {
    let session = clearCallsForUser(socket.userId);
    if (!session) {
      for (const s of getAllSessions()) {
        if (
          socketRepresentsUser(socket, s.callerId) ||
          socketRepresentsUser(socket, s.calleeId)
        ) {
          session = clearCall(s.callId);
          break;
        }
      }
    }
    if (!session) return;
    const peer = socketRepresentsUser(socket, session.callerId)
      ? session.calleeId
      : session.callerId;
    emitToUsers([peer], 'internal-call:ended', { callId: session.callId });
    void recordInternalCallHistory(session, outcomeForClearedSession(session));
  });
}

export function attachSocketIO(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: corsOriginDelegate,
      credentials: true,
    },
    path: '/socket.io',
  });

  io.use((socket: Socket, next) => {
    const token =
      (socket.handshake.auth?.token as string) ||
      (socket.handshake.query?.token as string);
    if (!token) {
      return next(new Error('Missing token'));
    }
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
      (socket as AuthedSocket).userId = decoded.sub;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const userId = (socket as AuthedSocket).userId;
    if (!userId) return;
    socket.join(USER_ROOM_PREFIX + userId);

    try {
      const link = await prisma.userAgencyLink.findFirst({
        where: { userId },
        select: { groupId: true },
      });
      if (link) {
        const members = await prisma.userAgencyLink.findMany({
          where: { groupId: link.groupId, userId: { not: userId } },
          select: { userId: true },
        });
        for (const m of members) {
          socket.join(USER_ROOM_PREFIX + m.userId);
        }
      }
    } catch {
      // Never block a connection because of a link-lookup failure
    }

    attachInternalCallHandlers(socket as AuthedSocket);
  });

  return io;
}

export function getIO(): Server | null {
  return io;
}

/** Emit an event to specific users (e.g. conversation participants). Used for messages and read receipts. */
export function emitToUsers(
  userIds: string[],
  event: string,
  payload: unknown
): void {
  if (!io) return;
  const rooms = userIds.map((id) => USER_ROOM_PREFIX + id);
  rooms.forEach((room) => io!.to(room).emit(event, payload));
}

/**
 * Emit only to sockets whose authenticated userId matches.
 * Returns how many sockets received the event.
 */
export function emitToExactUsers(
  userIds: string[],
  event: string,
  payload: unknown,
): number {
  if (!io) return 0;
  const targets = new Set(userIds);
  let sent = 0;
  for (const sock of io.sockets.sockets.values()) {
    const uid = (sock as AuthedSocket).userId;
    if (uid && targets.has(uid)) {
      sock.emit(event, payload);
      sent += 1;
    }
  }
  return sent;
}
