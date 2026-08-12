/**
 * Meeting reminder system.
 *
 * Runs every 2 minutes. Finds meetings starting within the next hour
 * and sends a reminder notification to the owner (and attendee users).
 * Deduplication: only one reminder per meeting × user per calendar day.
 */
import prisma from '../config/database';
import type { NotificationType } from '../services/notifications';
import { dispatchNotification, dispatchNotificationToUser } from '../services/notificationDispatch';
import { getRegistryEntry } from '../services/notificationRegistry';

const CHECK_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const REMINDER_TYPE: NotificationType = 'meeting_reminder_1h';

let intervalTimer: ReturnType<typeof setInterval> | null = null;

function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * Batch check which (userId, relatedId) pairs have already been notified today.
 * Returns a Set of "userId:relatedId" strings that already exist.
 */
async function getAlreadyNotifiedSet(
  pairs: { userId: string; relatedId: string }[]
): Promise<Set<string>> {
  if (pairs.length === 0) return new Set();

  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const userIds = [...new Set(pairs.map(p => p.userId))];
  const relatedIds = [...new Set(pairs.map(p => p.relatedId))];

  const existing = await prisma.notification.findMany({
    where: {
      type: REMINDER_TYPE,
      userId: { in: userIds },
      relatedId: { in: relatedIds },
      createdAt: { gte: dayStart, lt: dayEnd },
    },
    select: { userId: true, relatedId: true },
  });

  return new Set(existing.map(n => `${n.userId}:${n.relatedId}`));
}

async function checkMeetingManagerReminders(
  now: Date,
  oneHourFromNow: Date,
  twoHoursFromNow: Date
): Promise<void> {
  const [meetings, bookedMeetings] = await Promise.all([
    prisma.meeting.findMany({
      where: { startTime: { gt: oneHourFromNow, lte: twoHoursFromNow } },
      select: {
        id: true, title: true, startTime: true, subCompanyId: true, meetingLink: true,
        client: { select: { name: true } },
        owner: { select: { firstName: true, lastName: true, reportingManagerIds: true } },
      },
    }),
    prisma.bookedMeeting.findMany({
      where: { status: 'scheduled', startTime: { gt: oneHourFromNow, lte: twoHoursFromNow } },
      select: {
        id: true, guestName: true, guestCompany: true, startTime: true,
        host: { select: { user: { select: { subCompanyId: true, firstName: true, lastName: true, reportingManagerIds: true } } } },
      },
    }),
  ]);

  const managerType =
    getRegistryEntry('meeting_reminder_2h_manager')?.storeAsType ?? 'meeting_reminder_2h_manager';

  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const pairs: { userId: string; relatedId: string }[] = [];
  for (const m of meetings) {
    for (const mid of m.owner.reportingManagerIds) {
      pairs.push({ userId: mid, relatedId: m.id });
    }
  }
  for (const b of bookedMeetings) {
    const hostUser = b.host?.user;
    if (!hostUser) continue;
    for (const mid of hostUser.reportingManagerIds) {
      pairs.push({ userId: mid, relatedId: b.id });
    }
  }
  if (pairs.length === 0) return;

  const existing = await prisma.notification.findMany({
    where: {
      type: managerType,
      userId: { in: [...new Set(pairs.map(p => p.userId))] },
      relatedId: { in: [...new Set(pairs.map(p => p.relatedId))] },
      createdAt: { gte: dayStart, lt: dayEnd },
    },
    select: { userId: true, relatedId: true },
  });
  const alreadySent = new Set(existing.map(n => `${n.userId}:${n.relatedId}`));

  for (const meeting of meetings) {
    if (!meeting.owner.reportingManagerIds.length) continue;
    const startTime = new Date(meeting.startTime);
    const ownerName = `${meeting.owner.firstName} ${meeting.owner.lastName}`;
    const clientName = meeting.client?.name ?? 'a client';
    const managerIds = meeting.owner.reportingManagerIds.filter(
      (id) => !alreadySent.has(`${id}:${meeting.id}`),
    );
    if (managerIds.length === 0) continue;

    await dispatchNotification({
      eventKey: 'meeting_reminder_2h_manager',
      userIds: managerIds,
      subCompanyId: meeting.subCompanyId,
      context: {
        meetingTitle: meeting.title,
        ownerName,
        clientName,
        dueTime: fmtTime(startTime),
        meetingLinkNote: meeting.meetingLink ? ' Meeting link is ready.' : '',
      },
      link: '/meetings',
      relatedId: meeting.id,
    });
  }

  for (const booked of bookedMeetings) {
    const hostUser = booked.host?.user;
    if (!hostUser || !hostUser.reportingManagerIds.length) continue;
    const startTime = new Date(booked.startTime);
    const hostName = `${hostUser.firstName} ${hostUser.lastName}`;
    const managerIds = hostUser.reportingManagerIds.filter(
      (id) => !alreadySent.has(`${id}:${booked.id}`),
    );
    if (managerIds.length === 0) continue;

    await dispatchNotification({
      eventKey: 'meeting_reminder_2h_manager_booked',
      userIds: managerIds,
      subCompanyId: hostUser.subCompanyId ?? '',
      context: {
        guestName: booked.guestName,
        ownerName: hostName,
        dueTime: fmtTime(startTime),
        guestCompanyNote: booked.guestCompany ? ` (${booked.guestCompany})` : '',
      },
      link: '/meetings',
      relatedId: booked.id,
    });
  }
}

async function checkMeetingReminders(): Promise<void> {
  try {
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

    const [meetings, bookedMeetings] = await Promise.all([
      prisma.meeting.findMany({
        where: { startTime: { gt: now, lte: oneHourFromNow } },
        select: {
          id: true, title: true, startTime: true, ownerId: true,
          subCompanyId: true, meetingLink: true,
          client: { select: { name: true } },
          attendees: { select: { userId: true } },
        },
      }),
      prisma.bookedMeeting.findMany({
        where: { status: 'scheduled', startTime: { gt: now, lte: oneHourFromNow } },
        select: {
          id: true, hostUserId: true, guestName: true, guestCompany: true,
          startTime: true, meetingLink: true,
          host: { select: { user: { select: { subCompanyId: true } } } },
        },
      }),
    ]);

    const pairs: { userId: string; relatedId: string }[] = [];

    for (const m of meetings) {
      const userIds = new Set<string>([m.ownerId]);
      for (const a of m.attendees) { if (a.userId) userIds.add(a.userId); }
      for (const uid of userIds) pairs.push({ userId: uid, relatedId: m.id });
    }
    for (const b of bookedMeetings) {
      pairs.push({ userId: b.hostUserId, relatedId: b.id });
    }

    const alreadySent = await getAlreadyNotifiedSet(pairs);

    for (const meeting of meetings) {
      const startTime = new Date(meeting.startTime);
      const minutesUntil = String(Math.round((startTime.getTime() - now.getTime()) / 60000));

      const userIds = new Set<string>([meeting.ownerId]);
      for (const a of meeting.attendees) { if (a.userId) userIds.add(a.userId); }

      for (const userId of userIds) {
        if (alreadySent.has(`${userId}:${meeting.id}`)) continue;

        await dispatchNotificationToUser({
          userId,
          subCompanyId: meeting.subCompanyId,
          eventKey: 'meeting_reminder_1h',
          context: {
            minutesUntil,
            meetingTitle: meeting.title,
            dueTime: fmtTime(startTime),
          },
          link: '/meetings',
          relatedId: meeting.id,
        });
      }
    }

    for (const booked of bookedMeetings) {
      const subCompanyId = booked.host?.user?.subCompanyId;
      if (!subCompanyId) continue;
      if (alreadySent.has(`${booked.hostUserId}:${booked.id}`)) continue;

      const startTime = new Date(booked.startTime);
      const minutesUntil = String(Math.round((startTime.getTime() - now.getTime()) / 60000));

      await dispatchNotificationToUser({
        userId: booked.hostUserId,
        subCompanyId,
        eventKey: 'meeting_reminder_1h',
        context: {
          minutesUntil,
          meetingTitle: booked.guestName,
          dueTime: fmtTime(startTime),
        },
        link: '/meetings',
        relatedId: booked.id,
      });
    }
    const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    await checkMeetingManagerReminders(now, oneHourFromNow, twoHoursFromNow);
  } catch (err) {
    console.error('[meetingReminderChecker] Error:', err);
  }
}

export function startMeetingReminderChecker(): void {
  if (intervalTimer) return;
  checkMeetingReminders();
  intervalTimer = setInterval(checkMeetingReminders, CHECK_INTERVAL_MS);
  console.log('⏰ Meeting reminder checker started (2-min interval)');
}

export function stopMeetingReminderChecker(): void {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}
