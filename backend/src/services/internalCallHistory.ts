/**
 * Persist internal WebRTC call outcomes as chat messages in the conversation.
 */
import prisma from '../config/database';
import type { InternalCallMedia, InternalCallSession } from './internalCallPresence';

export type CallHistoryOutcome = 'completed' | 'declined' | 'cancelled' | 'missed';

const loggedCallIds = new Set<string>();

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function historyText(
  mediaType: InternalCallMedia,
  outcome: CallHistoryOutcome,
  durationSec: number,
): string {
  const kind = mediaType === 'video' ? 'Video call' : 'Audio call';
  switch (outcome) {
    case 'completed':
      return `${kind} · ${formatDuration(durationSec)}`;
    case 'declined':
      return `${kind} · Declined`;
    case 'cancelled':
      return `${kind} · Cancelled`;
    case 'missed':
      return `${kind} · Missed`;
    default:
      return kind;
  }
}

export async function recordInternalCallHistory(
  session: InternalCallSession,
  outcome: CallHistoryOutcome,
): Promise<void> {
  if (loggedCallIds.has(session.callId)) return;
  loggedCallIds.add(session.callId);
  if (loggedCallIds.size > 5000) {
    const first = loggedCallIds.values().next().value;
    if (first) loggedCallIds.delete(first);
  }

  const durationSec =
    outcome === 'completed' && session.answeredAt
      ? Math.max(0, Math.round((Date.now() - session.answeredAt) / 1000))
      : 0;

  const text = historyText(session.mediaType, outcome, durationSec);
  const metadata = {
    mediaType: session.mediaType,
    outcome,
    durationSec,
    callId: session.callId,
  };

  try {
    const message = await prisma.message.create({
      data: {
        conversationId: session.conversationId,
        senderId: session.callerId,
        text,
        type: 'call',
        metadata,
      },
      include: {
        sender: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    await prisma.conversation.update({
      where: { id: session.conversationId },
      data: { updatedAt: new Date() },
    });

    const participants = await prisma.conversationParticipant.findMany({
      where: { conversationId: session.conversationId },
      select: { userId: true },
    });

    const payload = {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderName: `${message.sender.firstName} ${message.sender.lastName}`.trim(),
      text: message.text,
      type: 'call' as const,
      metadata,
      createdAt: message.createdAt,
      attachments: [] as Array<{
        id: string;
        name: string;
        fileUrl: string;
        mimeType: string | null;
        fileSize: number | null;
      }>,
    };

    // Lazy import avoids circular dependency with socket/index.ts
    const { emitToUsers } = await import('../socket');
    emitToUsers(
      participants.map((p) => p.userId),
      'message:new',
      { conversationId: session.conversationId, message: payload },
    );
  } catch (err) {
    console.error('[internal-call] failed to record call history', err);
  }
}

/** Derive outcome when a session is cleared without an explicit reject/cancel. */
export function outcomeForClearedSession(
  session: InternalCallSession,
): CallHistoryOutcome {
  if (session.phase === 'active') return 'completed';
  return 'missed';
}
