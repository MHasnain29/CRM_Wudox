import sgMail from '@sendgrid/mail';
import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import {
  claimDueQueuedEmails,
  markQueuedEmailFailed,
  markQueuedEmailSent,
} from '../services/emailSendWindow';
import prisma from '../config/database';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

const CHECK_MS = 30_000;
const BATCH_SIZE = 100;
const CONCURRENCY = 10;

interface QueuePayload {
  message: Record<string, unknown>;
}

async function processOne(id: string, attemptCount: number, payload: unknown): Promise<void> {
  try {
    const parsed = payload as QueuePayload;
    if (!parsed || typeof parsed !== 'object' || !parsed.message) {
      throw new Error('Invalid queue payload');
    }
    await sgMail.send(parsed.message as any);
    await markQueuedEmailSent(id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown email send error';
    await markQueuedEmailFailed(id, msg, attemptCount);
  }
}

async function runProcessor(): Promise<void> {
  if (running) return;
  if (!env.SENDGRID_API_KEY) return;
  running = true;
  try {
    sgMail.setApiKey(env.SENDGRID_API_KEY);
    const rows = await claimDueQueuedEmails(BATCH_SIZE);
    if (!rows.length) return;

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map((row) => processOne(row.id, row.attempt_count, row.payload))
      );
    }
  } catch (err) {
    console.error('[outboundEmailQueue] processor error:', err);
  } finally {
    running = false;
  }
}

async function recoverStuckSendingRows(): Promise<void> {
  try {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE outbound_email_queue
      SET status = 'queued', next_eligible_at = NOW(), updated_at = NOW()
      WHERE status = 'sending'
        AND last_attempt_at < NOW() - INTERVAL '5 minutes'
    `);
  } catch {
    // Non-fatal: if table doesn't exist yet, skip silently.
  }
}

export function startOutboundEmailQueueProcessor(): void {
  if (timer) return;
  recoverStuckSendingRows().catch((err) => {
    console.error('[outboundEmailQueue] recovery error:', err);
  });
  timer = setInterval(() => {
    runProcessor().catch((err) => {
      console.error('[outboundEmailQueue] unhandled processor error:', err);
    });
  }, CHECK_MS);
  console.log('[outboundEmailQueue] Started — checking every 30s');
}

export function stopOutboundEmailQueueProcessor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

