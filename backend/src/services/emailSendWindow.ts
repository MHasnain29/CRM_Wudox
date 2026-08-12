import { Prisma } from '@prisma/client';
import prisma from '../config/database';

export interface EmailSendWindowSetting {
  subCompanyId: string;
  enabled: boolean;
  startMinuteOfDay: number | null;
  cutoffMinuteOfDay: number | null;
  timezone: string;
}

interface QueueRow {
  id: string;
  dedupe_key: string | null;
  sub_company_id: string;
  kind: string;
  payload: unknown;
  requested_send_at: Date | null;
  next_eligible_at: Date;
  status: string;
  attempt_count: number;
  last_error: string | null;
}

const DEFAULT_TIMEZONE = 'America/Toronto';
const MAX_ATTEMPTS = 8;

function isMissingRelationError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; meta?: { code?: string; message?: string } };
  return e.code === 'P2010' && e.meta?.code === '42P01';
}

function safeTimezone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function localMinuteOfDay(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return h * 60 + m;
}

function localDateParts(date: Date, timezone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parseInt(parts.find((p) => p.type === 'year')?.value ?? '1970', 10);
  const m = parseInt(parts.find((p) => p.type === 'month')?.value ?? '1', 10);
  const d = parseInt(parts.find((p) => p.type === 'day')?.value ?? '1', 10);
  return { y, m, d };
}

function toUtcFromLocalParts(parts: { y: number; m: number; d: number }, minuteOfDay: number, timezone: string): Date {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const utcGuess = new Date(Date.UTC(parts.y, parts.m - 1, parts.d, hour, minute, 0, 0));
  const utcStr = utcGuess.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = utcGuess.toLocaleString('en-US', { timeZone: timezone });
  const utcDate = new Date(utcStr);
  const tzDate = new Date(tzStr);
  const offsetMs = utcDate.getTime() - tzDate.getTime();
  return new Date(utcGuess.getTime() + offsetMs);
}

function plusLocalDays(parts: { y: number; m: number; d: number }, days: number): { y: number; m: number; d: number } {
  const dt = new Date(Date.UTC(parts.y, parts.m - 1, parts.d + days, 12, 0, 0, 0));
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
  };
}

export function isWithinAllowedWindow(setting: EmailSendWindowSetting, date: Date): boolean {
  if (!setting.enabled || setting.startMinuteOfDay == null || setting.cutoffMinuteOfDay == null) return true;
  const minute = localMinuteOfDay(date, safeTimezone(setting.timezone));
  return minute >= setting.startMinuteOfDay && minute < setting.cutoffMinuteOfDay;
}

export function computeNextEligibleAt(setting: EmailSendWindowSetting, intendedAt: Date): Date {
  if (!setting.enabled || setting.startMinuteOfDay == null || setting.cutoffMinuteOfDay == null) {
    return intendedAt;
  }
  const tz = safeTimezone(setting.timezone);
  const minute = localMinuteOfDay(intendedAt, tz);
  if (minute >= setting.startMinuteOfDay && minute < setting.cutoffMinuteOfDay) return intendedAt;

  const day = localDateParts(intendedAt, tz);
  if (minute < setting.startMinuteOfDay) {
    return toUtcFromLocalParts(day, setting.startMinuteOfDay, tz);
  }
  const nextDay = plusLocalDays(day, 1);
  return toUtcFromLocalParts(nextDay, setting.startMinuteOfDay, tz);
}

export async function getEmailSendWindowSetting(subCompanyId: string): Promise<EmailSendWindowSetting | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{
      sub_company_id: string;
      enabled: boolean;
      start_minute_of_day: number | null;
      cutoff_minute_of_day: number | null;
      timezone: string;
    }>>(Prisma.sql`
      SELECT sub_company_id, enabled, start_minute_of_day, cutoff_minute_of_day, timezone
      FROM email_send_window_settings
      WHERE sub_company_id = ${subCompanyId}
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) return null;
    return {
      subCompanyId: row.sub_company_id,
      enabled: row.enabled,
      startMinuteOfDay: row.start_minute_of_day,
      cutoffMinuteOfDay: row.cutoff_minute_of_day,
      timezone: safeTimezone(row.timezone),
    };
  } catch (err) {
    if (isMissingRelationError(err)) {
      // Migration not applied yet: feature stays safely disabled.
      return null;
    }
    throw err;
  }
}

export async function upsertEmailSendWindowSetting(input: {
  subCompanyId: string;
  enabled: boolean;
  startMinuteOfDay: number | null;
  cutoffMinuteOfDay: number | null;
  timezone: string;
}): Promise<EmailSendWindowSetting> {
  const timezone = safeTimezone(input.timezone);
  try {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO email_send_window_settings (
        sub_company_id, enabled, start_minute_of_day, cutoff_minute_of_day, timezone, created_at, updated_at
      )
      VALUES (
        ${input.subCompanyId}, ${input.enabled}, ${input.startMinuteOfDay}, ${input.cutoffMinuteOfDay}, ${timezone}, NOW(), NOW()
      )
      ON CONFLICT (sub_company_id)
      DO UPDATE SET
        enabled = EXCLUDED.enabled,
        start_minute_of_day = EXCLUDED.start_minute_of_day,
        cutoff_minute_of_day = EXCLUDED.cutoff_minute_of_day,
        timezone = EXCLUDED.timezone,
        updated_at = NOW()
    `);
  } catch (err) {
    if (isMissingRelationError(err)) {
      throw new Error('Email send window tables are missing. Run Prisma migrations.');
    }
    throw err;
  }
  const setting = await getEmailSendWindowSetting(input.subCompanyId);
  if (!setting) {
    throw new Error('Failed to save email send window setting');
  }
  return setting;
}

export async function enqueueOutboundEmail(params: {
  subCompanyId: string;
  kind: string;
  payload: unknown;
  requestedSendAt?: Date | null;
  dedupeKey?: string;
}): Promise<{ queued: boolean; id?: string }> {
  const setting = await getEmailSendWindowSetting(params.subCompanyId);
  const intendedAt = params.requestedSendAt ?? new Date();
  const nextEligibleAt = setting ? computeNextEligibleAt(setting, intendedAt) : intendedAt;

  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO outbound_email_queue (
        dedupe_key, sub_company_id, kind, payload, requested_send_at, next_eligible_at, status, created_at, updated_at
      )
      VALUES (
        ${params.dedupeKey ?? null},
        ${params.subCompanyId},
        ${params.kind},
        ${params.payload as Prisma.JsonObject},
        ${params.requestedSendAt ?? null},
        ${nextEligibleAt},
        'queued',
        NOW(),
        NOW()
      )
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      RETURNING id
    `);
    return { queued: rows.length > 0, id: rows[0]?.id };
  } catch (err) {
    if (isMissingRelationError(err)) {
      // Safe fallback before migration: do not queue.
      return { queued: false };
    }
    throw err;
  }
}

export async function recomputeQueuedEmailSchedule(subCompanyId: string): Promise<void> {
  const setting = await getEmailSendWindowSetting(subCompanyId);
  let rows: Array<{ id: string; requested_send_at: Date | null; created_at: Date }> = [];
  try {
    rows = await prisma.$queryRaw<Array<{ id: string; requested_send_at: Date | null; created_at: Date }>>(Prisma.sql`
      SELECT id, requested_send_at, created_at
      FROM outbound_email_queue
      WHERE sub_company_id = ${subCompanyId}
        AND status = 'queued'
    `);
  } catch (err) {
    if (isMissingRelationError(err)) return;
    throw err;
  }
  await Promise.all(
    rows.map((r) => {
      const intended = r.requested_send_at ?? r.created_at;
      const next = setting ? computeNextEligibleAt(setting, intended) : intended;
      return prisma.$executeRaw(Prisma.sql`
        UPDATE outbound_email_queue
        SET next_eligible_at = ${next}, updated_at = NOW()
        WHERE id = ${r.id}
      `);
    })
  );
}

export async function flushQueuedEmailsNow(subCompanyId: string): Promise<void> {
  try {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE outbound_email_queue
      SET next_eligible_at = NOW(), updated_at = NOW()
      WHERE sub_company_id = ${subCompanyId}
        AND status = 'queued'
    `);
  } catch (err) {
    if (isMissingRelationError(err)) return;
    throw err;
  }
}

export async function claimDueQueuedEmails(limit: number): Promise<QueueRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  try {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<QueueRow>>(Prisma.sql`
        WITH picked AS (
          SELECT id
          FROM outbound_email_queue
          WHERE status = 'queued'
            AND next_eligible_at <= NOW()
          ORDER BY next_eligible_at ASC
          LIMIT ${safeLimit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE outbound_email_queue q
        SET status = 'sending',
            attempt_count = q.attempt_count + 1,
            last_attempt_at = NOW(),
            updated_at = NOW()
        FROM picked
        WHERE q.id = picked.id
        RETURNING q.id, q.dedupe_key, q.sub_company_id, q.kind, q.payload, q.requested_send_at, q.next_eligible_at, q.status, q.attempt_count, q.last_error
      `);
      return rows;
    });
  } catch (err) {
    if (isMissingRelationError(err)) return [];
    throw err;
  }
}

export async function markQueuedEmailSent(id: string): Promise<void> {
  try {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE outbound_email_queue
      SET status = 'sent', sent_at = NOW(), updated_at = NOW(), last_error = NULL
      WHERE id = ${id}
    `);
  } catch (err) {
    if (isMissingRelationError(err)) return;
    throw err;
  }
}

export async function markQueuedEmailFailed(id: string, errMsg: string, attemptCount: number): Promise<void> {
  const safeErr = errMsg.slice(0, 2000);
  if (attemptCount >= MAX_ATTEMPTS) {
    try {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE outbound_email_queue
        SET status = 'dead_letter', last_error = ${safeErr}, updated_at = NOW()
        WHERE id = ${id}
      `);
    } catch (err) {
      if (isMissingRelationError(err)) return;
      throw err;
    }
    return;
  }
  const backoffMs = Math.min(60_000 * Math.pow(2, attemptCount - 1), 60 * 60 * 1000);
  const retryAt = new Date(Date.now() + backoffMs);

  // Respect the send window: if the retry time falls outside the allowed window, push it to next start.
  let nextEligibleAt = retryAt;
  try {
    const rows = await prisma.$queryRaw<Array<{ sub_company_id: string }>>(Prisma.sql`
      SELECT sub_company_id FROM outbound_email_queue WHERE id = ${id} LIMIT 1
    `);
    if (rows[0]?.sub_company_id) {
      const setting = await getEmailSendWindowSetting(rows[0].sub_company_id);
      if (setting) nextEligibleAt = computeNextEligibleAt(setting, retryAt);
    }
  } catch {
    // Non-fatal: fall back to plain retryAt
  }

  try {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE outbound_email_queue
      SET status = 'queued',
          next_eligible_at = ${nextEligibleAt},
          last_error = ${safeErr},
          updated_at = NOW()
      WHERE id = ${id}
    `);
  } catch (err) {
    if (isMissingRelationError(err)) return;
    throw err;
  }
}

export async function shouldSendNow(subCompanyId: string, intendedAt?: Date): Promise<{ allow: boolean; nextEligibleAt: Date }> {
  const when = intendedAt ?? new Date();
  const setting = await getEmailSendWindowSetting(subCompanyId);
  if (!setting) return { allow: true, nextEligibleAt: when };
  const nextEligibleAt = computeNextEligibleAt(setting, when);
  return { allow: nextEligibleAt.getTime() <= Date.now(), nextEligibleAt };
}

