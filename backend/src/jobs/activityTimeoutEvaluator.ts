/**
 * Activity Timeout Evaluator
 *
 * Runs every 30 seconds. Finds sessions where the last heartbeat arrived more
 * than 90 seconds ago and transitions them to `offline_suspected`.
 *
 * This catches tabs that closed without sending end-session, browser crashes,
 * and extended network outages. It is the backstop that ensures no session is
 * silently stuck in `active` while the user is gone.
 *
 * All timing thresholds here are infrastructure constants, not business values.
 * The only business-configurable value is the idle threshold in IdleTimeSetting.
 */

import prisma from '../config/database';
import { emitToUsers } from '../socket';
import { OFFLINE_THRESHOLD_S, getIdleThresholdMinutes } from '../services/activitySession';

// How often the evaluator scans for stale sessions (infrastructure constant)
const EVALUATOR_INTERVAL_MS = 30 * 1000;

let evaluatorTimer: ReturnType<typeof setInterval> | null = null;

export function startActivityTimeoutEvaluator(): void {
  if (evaluatorTimer) return;
  evaluatorTimer = setInterval(() => {
    void runEvaluator().catch((err) => {
      console.error('[activityEvaluator] error:', err);
    });
  }, EVALUATOR_INTERVAL_MS);
  console.log('✅ Activity timeout evaluator started (interval: 30s, offline threshold: 90s)');
}

export function stopActivityTimeoutEvaluator(): void {
  if (evaluatorTimer) {
    clearInterval(evaluatorTimer);
    evaluatorTimer = null;
  }
}

async function runEvaluator(): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - OFFLINE_THRESHOLD_S * 1000);

  // Find all open sessions that haven't sent a heartbeat within the offline threshold
  const staleSessions = await prisma.userActivitySession.findMany({
    where: {
      endedAt: null,
      currentState: { not: 'offline_suspected' },
      lastSeenAt: { lt: cutoff },
    },
    select: {
      id: true,
      userId: true,
      subCompanyId: true,
      currentState: true,
      lastSeenAt: true,
      idleStartedAt: true,
      activeSeconds: true,
      idleSeconds: true,
      offlineSeconds: true,
      version: true,
    },
  });

  if (staleSessions.length === 0) return;

  for (const session of staleSessions) {
    const elapsedS = Math.floor((now.getTime() - session.lastSeenAt.getTime()) / 1000);

    // Respect the director-configured idle threshold before showing the modal.
    // Total idle duration is measured from when idle tracking began (or the last heartbeat).
    const thresholdMinutes = await getIdleThresholdMinutes(session.subCompanyId);
    const thresholdS = thresholdMinutes * 60;
    const idleStartRef = session.idleStartedAt ?? session.lastSeenAt;
    const totalIdleForS = Math.floor((now.getTime() - idleStartRef.getTime()) / 1000);
    const shouldShowModal = totalIdleForS >= thresholdS;

    // Always flush offline seconds. Update lastSeenAt to prevent double-counting on
    // subsequent evaluator runs when the session hasn't reached the threshold yet.
    await prisma.userActivitySession.updateMany({
      where: { id: session.id, version: session.version },
      data: {
        currentState: shouldShowModal ? 'offline_suspected' : session.currentState,
        lastSeenAt: now,
        idleStartedAt: idleStartRef,
        offlineSeconds: { increment: elapsedS },
        version: { increment: 1 },
      },
    });

    if (shouldShowModal) {
      await prisma.userActivityEvent.create({
        data: {
          sessionId: session.id,
          eventType: 'state_change',
          reasonCode: 'heartbeat_timeout',
          metadata: {
            previousState: session.currentState,
            newState: 'offline_suspected',
            elapsedSeconds: elapsedS,
            lastSeenAt: session.lastSeenAt.toISOString(),
          },
        },
      });

      // Push the new state to any open tabs via Socket.IO
      emitToUsers([session.userId], 'activity:state_changed', {
        state: 'offline_suspected',
        idleSeconds: session.idleSeconds,
        idleStartedAt: idleStartRef.toISOString(),
        serverTime: now.toISOString(),
      });
    }
  }
}
