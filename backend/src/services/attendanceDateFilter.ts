/**
 * Date-range + owner filter for GET /attendance and GET /attendance/me.
 *
 * `attendance.date` is a Postgres DATE (a calendar day, no time zone), so a range is exchanged as plain
 * `yyyy-MM-dd` days — NOT ISO instants like the campaign/email filters. An instant of a viewer's local
 * midnight lands on the previous UTC day for anyone east of UTC, which on a DATE column silently shifts the
 * whole range by a day. Prisma reads and writes DATE at UTC midnight, so the bounds are built the same way.
 *
 * Both bounds are inclusive. `month` (YYYY-MM) is the legacy selector and is kept exactly as it was so an
 * older cached frontend keeps working; with no bounds at all the range is the current month.
 */
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { MAX_FILTER_YEAR, MIN_FILTER_YEAR } from './campaignDateFilter';

/** Safety cap: the page groups and renders every row, so an enormous custom range must not return them all. */
export const ATTENDANCE_MAX_ROWS = 5000;
/** The ids travel in the query string (37 chars each, ~7.4 KB at the cap) — keep it under common 8 KB request-line limits. */
export const ATTENDANCE_MAX_OWNER_IDS = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A real calendar day as UTC midnight, or null (bad shape, Feb 30, year outside the supported window). */
export function parseCalendarDay(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < MIN_FILTER_YEAR || year > MAX_FILTER_YEAR) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC rolls Feb 30 over to Mar 2; reading the parts back catches it.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

const calendarDay = z.string().refine((s) => parseCalendarDay(s) !== null, { message: 'Must be a valid yyyy-MM-dd date' });

const ownerIdList = z
  .string()
  .transform((s) => s.split(',').map((id) => id.trim()).filter(Boolean))
  .pipe(z.array(z.string().regex(UUID_RE, 'Must be a UUID')).max(ATTENDANCE_MAX_OWNER_IDS));

export const attendanceQuerySchema = z
  .object({
    from: calendarDay.optional(),
    to: calendarDay.optional(),
    // Lenient on purpose (legacy): a malformed month falls back to the current month rather than a 400.
    month: z.string().optional(),
    // Who to narrow to: the page's scope chips resolve to this list. `userId` is the older single-user form.
    ownerIds: ownerIdList.optional(),
    userId: z.string().regex(UUID_RE, 'Must be a UUID').optional(),
  })
  .superRefine((q, ctx) => {
    if (q.from && q.to && q.from > q.to) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['from'], message: 'from must be before or equal to to' });
    }
  });

export type AttendanceQuery = z.infer<typeof attendanceQuerySchema>;

/** Empty values (`?from=&ownerIds=`) mean "absent", as on GET /campaigns. */
export function parseAttendanceQuery(rawQuery: unknown) {
  const cleaned = Object.fromEntries(Object.entries((rawQuery ?? {}) as Record<string, unknown>).filter(([, v]) => v !== ''));
  return attendanceQuerySchema.safeParse(cleaned);
}

/** Month selector: first of the month up to (excluding) the next, in server-local time. Unchanged legacy behaviour. */
function legacyMonthWhere(month: string | undefined, now: Date): Prisma.DateTimeFilter {
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split('-').map(Number);
    return { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) };
  }
  return { gte: new Date(now.getFullYear(), now.getMonth(), 1), lt: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
}

/** Where-clause for `attendance.date`: inclusive day bounds when given, else the legacy month / current month. */
export function attendanceDateWhere(q: Pick<AttendanceQuery, 'from' | 'to' | 'month'>, now = new Date()): Prisma.DateTimeFilter {
  if (!q.from && !q.to) return legacyMonthWhere(q.month, now);
  const range: Prisma.DateTimeFilter = {};
  if (q.from) range.gte = parseCalendarDay(q.from) as Date;
  if (q.to) range.lte = parseCalendarDay(q.to) as Date;
  return range;
}

/** `ownerIds` (CSV) and the older single `userId`, de-duplicated. */
export function attendanceOwnerIds(q: Pick<AttendanceQuery, 'ownerIds' | 'userId'>): string[] {
  return [...new Set([...(q.ownerIds ?? []), ...(q.userId ? [q.userId] : [])])];
}
