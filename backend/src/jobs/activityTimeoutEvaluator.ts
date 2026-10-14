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
 * This never counts missing observations as idle or changes the last observed timestamp.
 */

import prisma from '../config/database';
import { emitToUsers } from '../socket';
import { OFFLINE_THRESHOLD_S } from '../services/activitySession';
import { SOFTWARE_REPORT_ROLES } from '../services/reportMetrics';

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

export async function runEvaluator(): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - OFFLINE_THRESHOLD_S * 1000);
  const staleSessions = await prisma.userActivitySession.findMany({
    where: { endedAt: null, onBreak: false, currentState: { not: 'offline_suspected' }, lastSeenAt: { lt: cutoff },
      user: { isActive: true, role: { notIn: SOFTWARE_REPORT_ROLES } } },
    select: { id: true, userId: true, version: true, lastSeenAt: true },
  });
  for (const session of staleSessions) {
    // Do not move lastSeenAt: this job has not observed the browser. Missing
    // heartbeats are unknown coverage, never measured CRM inactivity.
    const updated = await prisma.userActivitySession.updateMany({
      where: { id: session.id, version: session.version, endedAt: null, onBreak: false,
        user: { isActive: true, role: { notIn: SOFTWARE_REPORT_ROLES } } },
      data: { currentState: 'offline_suspected', idleStartedAt: null, version: { increment: 1 } },
    });
    if (!updated.count) continue;
    emitToUsers([session.userId], 'activity:state_changed', {
      sessionId: session.id, trackingEnabled: true, state: 'offline_suspected', currentIdleSeconds: 0,
      idleStartedAt: null, onBreak: false, trackingPaused: true, serverTime: now.toISOString(),
    });
  }
}
