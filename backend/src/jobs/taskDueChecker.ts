/**
 * Due-date notification system for tasks and follow-ups.
 *
 * Runs a background check every 5 minutes to find tasks/follow-ups that are:
 * - due within 1 hour (1h warning)
 * - due right now (at-due-time)
 * - overdue
 *
 * Deduplication: only one notification per item × user × type per calendar day.
 */
import prisma from '../config/database';
import type { NotificationType } from '../services/notifications';
import { dispatchNotification, dispatchNotificationToUser } from '../services/notificationDispatch';
import { getRegistryEntry } from '../services/notificationRegistry';

const CHECK_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

let intervalTimer: ReturnType<typeof setInterval> | null = null;

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

async function alreadyNotifiedToday(userId: string, type: NotificationType, relatedId: string): Promise<boolean> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);
  const count = await prisma.notification.count({
    where: { userId, type, relatedId, createdAt: { gte: startOfDay, lt: endOfDay } },
  });
  return count > 0;
}

const TASK_OWNER_EVENT: Record<string, string> = {
  task_due_1h: 'task_due_1h_owner',
  task_due_today: 'task_due_today_owner',
  task_overdue: 'task_overdue_owner',
};

const TASK_ASSIGNER_EVENT: Record<string, string> = {
  task_due_1h: 'task_due_1h_assigner',
  task_due_today: 'task_due_today_assigner',
  task_overdue: 'task_overdue_assigner',
};

const FOLLOW_UP_EVENT: Record<string, string> = {
  follow_up_due_1h: 'follow_up_due_1h',
  follow_up_due_today: 'follow_up_due_today',
  follow_up_overdue: 'follow_up_overdue',
};

function storeTypeForEvent(eventKey: string): NotificationType {
  return getRegistryEntry(eventKey)?.storeAsType ?? 'task_due_1h';
}

// ─── Notification senders ───────────────────────────────────────────────────

async function sendTaskDueNotification(
  taskId: string,
  type: NotificationType
): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true, title: true, dueDate: true, status: true,
      ownerId: true, assignedById: true, subCompanyId: true,
      owner: { select: { firstName: true, lastName: true } },
    },
  });
  if (!task || task.status === 'done') return;

  const dueDate = new Date(task.dueDate);
  const ownerName = `${task.owner.firstName} ${task.owner.lastName}`;
  const context = {
    taskTitle: task.title,
    dueTime: fmtTime(dueDate),
    dueDate: fmtDate(dueDate),
    ownerName,
  };
  const link = `/tasks?openTask=${task.id}`;

  const ownerEventKey = TASK_OWNER_EVENT[type];
  if (ownerEventKey && !(await alreadyNotifiedToday(task.ownerId, type, task.id))) {
    await dispatchNotificationToUser({
      userId: task.ownerId,
      subCompanyId: task.subCompanyId,
      eventKey: ownerEventKey,
      context,
      link,
      relatedId: task.id,
    });
  }

  if (task.assignedById !== task.ownerId) {
    const assignerEventKey = TASK_ASSIGNER_EVENT[type];
    if (assignerEventKey && !(await alreadyNotifiedToday(task.assignedById, type, task.id))) {
      await dispatchNotificationToUser({
        userId: task.assignedById,
        subCompanyId: task.subCompanyId,
        eventKey: assignerEventKey,
        context,
        link,
        relatedId: task.id,
      });
    }
  }
}

async function sendFollowUpDueNotification(
  followUpId: string,
  type: NotificationType
): Promise<void> {
  const followUp = await prisma.followUp.findUnique({
    where: { id: followUpId },
    select: {
      id: true, dueDate: true, completed: true, notes: true,
      ownerId: true, subCompanyId: true,
      client: { select: { name: true } },
    },
  });
  if (!followUp || followUp.completed) return;

  const dueDate = new Date(followUp.dueDate);
  const eventKey = FOLLOW_UP_EVENT[type];
  if (!eventKey) return;

  if (!(await alreadyNotifiedToday(followUp.ownerId, type, followUp.id))) {
    await dispatchNotificationToUser({
      userId: followUp.ownerId,
      subCompanyId: followUp.subCompanyId,
      eventKey,
      context: {
        clientName: followUp.client.name,
        dueTime: fmtTime(dueDate),
        dueDate: fmtDate(dueDate),
      },
      link: '/follow-ups',
      relatedId: followUp.id,
    });
  }
}

// ─── Manager notification senders ───────────────────────────────────────────

async function sendTaskManagerNotification(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true, title: true, dueDate: true, status: true, subCompanyId: true,
      owner: { select: { firstName: true, lastName: true, reportingManagerIds: true } },
    },
  });
  if (!task || task.status === 'done') return;
  if (!task.owner.reportingManagerIds.length) return;

  const dueDate = new Date(task.dueDate);
  const ownerName = `${task.owner.firstName} ${task.owner.lastName}`;
  const managerType = storeTypeForEvent('task_due_2h_manager');
  const eligibleManagerIds: string[] = [];

  for (const managerId of task.owner.reportingManagerIds) {
    if (await alreadyNotifiedToday(managerId, managerType, task.id)) continue;
    eligibleManagerIds.push(managerId);
  }

  if (eligibleManagerIds.length === 0) return;

  await dispatchNotification({
    eventKey: 'task_due_2h_manager',
    userIds: eligibleManagerIds,
    subCompanyId: task.subCompanyId,
    context: {
      taskTitle: task.title,
      ownerName,
      dueTime: fmtTime(dueDate),
      dueDate: fmtDate(dueDate),
    },
    link: `/tasks?openTask=${task.id}`,
    relatedId: task.id,
  });
}

async function sendFollowUpManagerNotification(followUpId: string): Promise<void> {
  const followUp = await prisma.followUp.findUnique({
    where: { id: followUpId },
    select: {
      id: true, dueDate: true, completed: true, subCompanyId: true,
      client: { select: { name: true } },
      owner: { select: { firstName: true, lastName: true, reportingManagerIds: true } },
    },
  });
  if (!followUp || followUp.completed) return;
  if (!followUp.owner.reportingManagerIds.length) return;

  const dueDate = new Date(followUp.dueDate);
  const ownerName = `${followUp.owner.firstName} ${followUp.owner.lastName}`;
  const clientName = followUp.client.name;
  const managerType = storeTypeForEvent('follow_up_due_2h_manager');
  const eligibleManagerIds: string[] = [];

  for (const managerId of followUp.owner.reportingManagerIds) {
    if (await alreadyNotifiedToday(managerId, managerType, followUp.id)) continue;
    eligibleManagerIds.push(managerId);
  }

  if (eligibleManagerIds.length === 0) return;

  await dispatchNotification({
    eventKey: 'follow_up_due_2h_manager',
    userIds: eligibleManagerIds,
    subCompanyId: followUp.subCompanyId,
    context: {
      clientName,
      ownerName,
      dueTime: fmtTime(dueDate),
      dueDate: fmtDate(dueDate),
    },
    link: '/follow-ups',
    relatedId: followUp.id,
  });
}

// ─── 5-minute Background Checker ────────────────────────────────────────────

async function checkAllDueItems(): Promise<void> {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    // ── Tasks ──
    const tasks = await prisma.task.findMany({
      where: { status: { not: 'done' }, dueDate: { lte: twoHoursFromNow } },
      select: { id: true, dueDate: true },
    });

    for (const task of tasks) {
      const dueDate = new Date(task.dueDate);
      const isOverdue = dueDate < startOfToday;
      const isDueToday = dueDate >= startOfToday && dueDate < endOfToday;
      const isDueWithin1h = dueDate > now && dueDate <= oneHourFromNow;

      if (isOverdue) {
        await sendTaskDueNotification(task.id, 'task_overdue');
      } else if (isDueToday && dueDate <= now) {
        await sendTaskDueNotification(task.id, 'task_due_today');
      }
      if (isDueWithin1h) {
        await sendTaskDueNotification(task.id, 'task_due_1h');
      }
      const isTaskDueWithin2h = dueDate > oneHourFromNow && dueDate <= twoHoursFromNow;
      if (isTaskDueWithin2h) {
        await sendTaskManagerNotification(task.id);
      }
    }

    // ── Follow-ups ──
    const followUps = await prisma.followUp.findMany({
      where: { completed: false, dueDate: { lte: twoHoursFromNow } },
      select: { id: true, dueDate: true },
    });

    for (const fu of followUps) {
      const dueDate = new Date(fu.dueDate);
      const isOverdue = dueDate < startOfToday;
      const isDueToday = dueDate >= startOfToday && dueDate < endOfToday;
      const isDueWithin1h = dueDate > now && dueDate <= oneHourFromNow;

      if (isOverdue) {
        await sendFollowUpDueNotification(fu.id, 'follow_up_overdue');
      } else if (isDueToday && dueDate <= now) {
        await sendFollowUpDueNotification(fu.id, 'follow_up_due_today');
      }
      if (isDueWithin1h) {
        await sendFollowUpDueNotification(fu.id, 'follow_up_due_1h');
      }
      const isFuDueWithin2h = dueDate > oneHourFromNow && dueDate <= twoHoursFromNow;
      if (isFuDueWithin2h) {
        await sendFollowUpManagerNotification(fu.id);
      }
    }
  } catch (err) {
    console.error('[dueChecker] Error:', err);
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function startTaskDueChecker(): void {
  if (intervalTimer) return;
  // Run immediately on startup (catches overdue + due-today)
  checkAllDueItems();
  // Start 5-min interval
  intervalTimer = setInterval(checkAllDueItems, CHECK_INTERVAL_MS);
  console.log('🔔 Due-date checker started (2-min interval)');
}

export function stopTaskDueChecker(): void {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}
