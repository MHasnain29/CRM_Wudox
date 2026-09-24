import sgMail from '@sendgrid/mail';
import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import {
  claimDueQueuedEmails,
  markQueuedEmailFailed,
  markQueuedEmailSent,
} from '../services/emailSendWindow';
import prisma from '../config/database';
import { hasEmailRecipientAcceptance, recordEmailSendOutcomeBestEffort } from '../services/emailSendEvidence';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

const CHECK_MS = 30_000;
const BATCH_SIZE = 100;
const CONCURRENCY = 10;

interface QueuePayload {
  message: Record<string, unknown>;
  crmEmailId?: string;
  recipientEmails?: string[];
}

export async function processOne(id: string, attemptCount: number, payload: unknown): Promise<void> {
  const parsed = payload as QueuePayload;
  const recordOutcome = (status: 'queued' | 'accepted' | 'failed', at?: Date) =>
    typeof parsed?.crmEmailId === 'string' && Array.isArray(parsed.recipientEmails)
      ? recordEmailSendOutcomeBestEffort({
        emailId: parsed.crmEmailId, recipientEmails: parsed.recipientEmails, status, at,
      }) : Promise.resolve();
  // A worker may have persisted provider acceptance before failing to mark its queue row sent.
  if (typeof parsed?.crmEmailId === 'string' && Array.isArray(parsed.recipientEmails)
      && await hasEmailRecipientAcceptance(parsed.crmEmailId, parsed.recipientEmails)) {
    await markQueuedEmailSent(id);
    return;
  }
  try {
    if (!parsed || typeof parsed !== 'object' || !parsed.message) {
      throw new Error('Invalid queue payload');
    }
    await sgMail.send(parsed.message as any);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown email send error';
    await markQueuedEmailFailed(id, msg, attemptCount);
    const queue = await prisma.outboundEmailQueue.findUnique({ where: { id }, select: { status: true } });
    await recordOutcome(queue?.status === 'dead_letter' ? 'failed' : 'queued');
    return;
  }
  // Persistence failures after provider acceptance must not enter the provider-failure branch.
  const acceptedAt = new Date();
  await recordOutcome('accepted', acceptedAt);
  await markQueuedEmailSent(id);
}

/** Retry evidence persistence from durable queue receipts, without sending another email. */
export async function reconcileQueuedEmailEvidence(): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ payload: QueuePayload; sent_at: Date }>>(Prisma.sql`
    SELECT q.payload, q.sent_at FROM outbound_email_queue q
    WHERE q.status = 'sent' AND q.sent_at IS NOT NULL
      AND q.payload->>'crmEmailId' IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM email_recipients r
        WHERE r.email_id = q.payload->>'crmEmailId'
          AND r.send_status IS DISTINCT FROM 'accepted'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(q.payload->'recipientEmails') AS a(address)
            WHERE LOWER(r.email) = LOWER(a.address)
          )
      )
    ORDER BY q.sent_at ASC LIMIT 100
  `);
  for (const row of rows) {
    await recordEmailSendOutcomeBestEffort({
      emailId: row.payload.crmEmailId!, recipientEmails: row.payload.recipientEmails!,
      status: 'accepted', at: row.sent_at,
    });
  }
}

async function runProcessor(): Promise<void> {
  if (running) return;
  if (!env.SENDGRID_API_KEY) return;
  running = true;
  try {
    sgMail.setApiKey(env.SENDGRID_API_KEY);
    await reconcileQueuedEmailEvidence();
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
