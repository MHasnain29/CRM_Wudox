/**
 * Agency-local "today" boundaries for daily activity filters.
 */
import prisma from '../config/database';

const DEFAULT_TIMEZONE = 'America/Toronto';

export interface DayBounds {
  startUTC: Date;
  endUTC: Date;
  dateLabel: string;
  timezone: string;
}

export async function getAgencyTimezone(subCompanyId: string): Promise<string> {
  const setting = await prisma.dailyReportSetting.findUnique({
    where: { subCompanyId },
    select: { timezone: true },
  });
  return setting?.timezone ?? DEFAULT_TIMEZONE;
}

/** Calendar day in agency timezone → UTC [start, end). */
export function getDayBoundsForTimezone(timezone: string, refDate = new Date()): DayBounds {
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(refDate);

  const tempDate = new Date(`${dateStr}T12:00:00Z`);
  const utcStr = tempDate.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = tempDate.toLocaleString('en-US', { timeZone: timezone });
  const offsetMs = new Date(utcStr).getTime() - new Date(tzStr).getTime();

  const midnightLocal = new Date(`${dateStr}T00:00:00Z`);
  const startUTC = new Date(midnightLocal.getTime() + offsetMs);
  const endUTC = new Date(startUTC.getTime() + 24 * 60 * 60 * 1000);

  return {
    startUTC,
    endUTC,
    dateLabel: dateStr,
    timezone,
  };
}

export async function getAgencyDayBounds(subCompanyId: string): Promise<DayBounds> {
  const timezone = await getAgencyTimezone(subCompanyId);
  return getDayBoundsForTimezone(timezone);
}

/**
 * Day bounds for daily activity. Uses the selected agency when one is filtered;
 * when several agencies share a timezone, uses that zone; otherwise labels vary.
 */
function parseYmdToUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

/** Calendar days past due in agency timezone (minimum 1 when overdue). */
export function computeDaysOverdue(dueAt: Date, bounds: DayBounds): number {
  const tz = bounds.timezone || 'America/Toronto';
  const dueDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dueAt);
  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.floor((parseYmdToUtcMs(bounds.dateLabel) - parseYmdToUtcMs(dueDateStr)) / msPerDay);
  return Math.max(1, days);
}

export async function resolveDayBoundsForAgencies(
  agencyIds: string[],
  fallbackSubCompanyId: string,
): Promise<DayBounds> {
  const ids = agencyIds.length > 0 ? agencyIds : [fallbackSubCompanyId];
  if (ids.length === 1) {
    return getAgencyDayBounds(ids[0]!);
  }

  const timezones = await Promise.all(ids.map((id) => getAgencyTimezone(id)));
  const unique = [...new Set(timezones)];

  if (unique.length === 1) {
    return getDayBoundsForTimezone(unique[0]!);
  }

  const bounds = await getAgencyDayBounds(fallbackSubCompanyId);
  return {
    ...bounds,
    timezone: '',
  };
}
