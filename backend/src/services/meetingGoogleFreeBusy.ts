/**
 * Soft Google FreeBusy enrichment for meeting availability checks.
 * Uses the agency-connected Google account. Does not hard-block scheduling;
 * CRM overlap remains the source of truth for create/update conflicts.
 */
import prisma from '../config/database';
import { decryptToken, queryCalendarFreeBusy } from './googleCalendar';
import type { MeetingAvailabilityResult } from './meetingAvailability';

export async function enrichAvailabilityWithGoogleFreeBusy(opts: {
  subCompanyId: string | null | undefined;
  userIds: string[];
  startTime: Date;
  endTime: Date;
  results: MeetingAvailabilityResult[];
}): Promise<{ results: MeetingAvailabilityResult[]; googleChecked: boolean }> {
  const uniqueIds = [...new Set(opts.userIds.filter(Boolean))];
  if (!opts.subCompanyId || uniqueIds.length === 0) {
    return { results: opts.results, googleChecked: false };
  }

  const agency = await prisma.subCompany.findUnique({
    where: { id: opts.subCompanyId },
    select: { googleCalendarConnected: true, googleRefreshToken: true },
  });
  if (!agency?.googleCalendarConnected || !agency.googleRefreshToken) {
    return { results: opts.results, googleChecked: false };
  }

  const users = await prisma.user.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, email: true },
  });
  const emailByUser = new Map<string, string>();
  for (const u of users) {
    const email = u.email?.trim().toLowerCase();
    if (email) emailByUser.set(u.id, email);
  }
  if (emailByUser.size === 0) {
    return { results: opts.results, googleChecked: false };
  }

  const freeBusy = await queryCalendarFreeBusy({
    refreshToken: decryptToken(agency.googleRefreshToken),
    timeMin: opts.startTime,
    timeMax: opts.endTime,
    calendarIds: [...emailByUser.values()],
  });
  if (!freeBusy.ok) {
    return { results: opts.results, googleChecked: false };
  }

  const byUser = new Map(opts.results.map((r) => [r.userId, { ...r }]));
  for (const userId of uniqueIds) {
    const email = emailByUser.get(userId);
    const googleBusy = email ? Boolean(freeBusy.busyByCalendar[email]) : false;
    const existing = byUser.get(userId) ?? { userId, available: true, conflicts: [] };
    byUser.set(userId, {
      ...existing,
      googleChecked: true,
      googleBusy,
    });
  }

  return {
    googleChecked: true,
    results: uniqueIds.map((userId) => byUser.get(userId)!),
  };
}
