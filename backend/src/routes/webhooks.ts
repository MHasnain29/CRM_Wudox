/**
 * SendGrid Event Webhook
 * Receives delivery/open/click/bounce/unsubscribe events and updates campaign stats
 * and personal CRM email recipients (customArgs.crm_email_id).
 *
 * Configure in SendGrid dashboard:
 *   Settings → Mail Settings → Event Webhook
 *   URL: https://<your-domain>/api/v1/webhooks/sendgrid
 *   Events to enable: Delivered, Opened, Clicked, Bounced, Dropped, Deferred,
 *                     Unsubscribe, Group Unsubscribe, Spam Report
 *
 * No auth middleware — SendGrid calls this endpoint directly.
 */
import { Router, Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { recomputeCampaignStats } from '../services/campaignStats';

export const webhooksRouter = Router();

interface SendGridEvent {
  event: string;        // delivered | open | click | bounce | dropped | deferred | unsubscribe | group_unsubscribe | spamreport
  email: string;
  timestamp: number;
  campaignId?: string;  // from customArgs (legacy camelCase)
  recipientId?: string; // from customArgs (legacy camelCase)
  campaign_id?: string; // from customArgs (snake_case)
  recipient_id?: string; // from customArgs (snake_case)
  crm_email_id?: string; // from customArgs on personal CRM emails (Email.id)
  reason?: string;      // for bounced/dropped
  url?: string;         // for click events
}

/** The public endpoint must never pass JSON objects through as Prisma filters. */
function isSendGridEvent(value: unknown): value is SendGridEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (typeof event.event !== 'string' || typeof event.email !== 'string' || !event.email.trim()) return false;
  if (typeof event.timestamp !== 'number' || !Number.isFinite(event.timestamp) || event.timestamp < 0) return false;
  if (!Number.isFinite(new Date(event.timestamp * 1000).getTime())) return false;
  return ['campaignId', 'recipientId', 'campaign_id', 'recipient_id', 'crm_email_id', 'reason', 'url']
    .every((field) => event[field] === undefined || typeof event[field] === 'string');
}

const EVENT_TO_STATUS: Record<string, string> = {
  delivered: 'delivered',
  open:      'opened',
  click:     'clicked',
  bounce:    'bounced',
  dropped:   'failed',
  // 'deferred' intentionally omitted — SendGrid will retry; status should not regress
};

/** Event → recipient timestamp column (campaign and personal). A dropped message never reached the inbox. */
const EVENT_TIMESTAMP_FIELD: Record<string, 'deliveredAt' | 'openedAt' | 'clickedAt' | 'bouncedAt'> = {
  delivered: 'deliveredAt',
  open:      'openedAt',
  click:     'clickedAt',
  bounce:    'bouncedAt',
  dropped:   'bouncedAt',
};

/**
 * Records the first event of each kind for one recipient of a personal CRM email.
 * Webhook retries and repeat opens/clicks keep the original time.
 */
async function recordPersonalEmailEvent(emailId: string, address: string, eventType: string, timestamp: number) {
  if (!Object.hasOwn(EVENT_TIMESTAMP_FIELD, eventType)) return;
  const field = EVENT_TIMESTAMP_FIELD[eventType];
  const occurredAt = new Date(timestamp * 1000);
  await prisma.emailRecipient.updateMany({
    where: {
      emailId,
      emailAddress: { equals: address.trim(), mode: 'insensitive' },
      // The first event can arrive after a later open/click or a retried batch.
      // One conditional write keeps the earliest timestamp even under concurrency.
      OR: [{ [field]: null }, { [field]: { gt: occurredAt } }],
    } as Prisma.EmailRecipientWhereInput,
    data: { [field]: occurredAt },
  });
}

/**
 * Handles unsubscribe and spam-report events from SendGrid.
 * Marks only the specific contact email as isUnsubscribed — does NOT block the whole client.
 * The client-level "Unsubscribed" toggle is a separate manager-only action.
 */
async function handleUnsubscribe(email: string) {
  await prisma.clientContact.updateMany({
    where: { email },
    data: { isUnsubscribed: true },
  });
}

/**
 * Handles bounce and dropped events:
 *  - Sets emailBounced = true for hard bounces
 *  - Sets emailInvalid = true for invalid address drops
 */
async function handleBounce(email: string, eventType: string, timestamp: number, reason?: string) {
  const isInvalid =
    eventType === 'dropped' &&
    typeof reason === 'string' &&
    /invalid/i.test(reason);

  const data = isInvalid
    ? { emailInvalid: true, emailBouncedAt: new Date(timestamp * 1000), emailBouncedReason: reason ?? null }
    : { emailBounced: true, emailBouncedAt: new Date(timestamp * 1000), emailBouncedReason: reason ?? null };

  await prisma.clientContact.updateMany({
    where: { email },
    data,
  });
}

/** POST /webhooks/sendgrid */
webhooksRouter.post('/sendgrid', async (req: Request, res: Response) => {
  if (!Array.isArray(req.body)) {
    res.status(400).json({ error: 'Expected an array of SendGrid events' });
    return;
  }
  // Ignore malformed entries without discarding valid events in the same batch.
  const events: SendGridEvent[] = req.body.filter(isSendGridEvent);
  try {
    // Track campaigns for one recompute per batch; never increment cached counts.
    const affectedCampaignIds = new Set<string>();

    for (const event of events) {
      const campaignId = event.campaign_id ?? event.campaignId;
      const recipientId = event.recipient_id ?? event.recipientId;
      const eventType = event.event;

      // Unsubscribe — mark contact globally, no per-recipient update needed
      if (eventType === 'unsubscribe' || eventType === 'group_unsubscribe') {
        await handleUnsubscribe(event.email);
        continue;
      }

      // Spam report — mark contact as unsubscribed AND record timestamp on recipient
      if (eventType === 'spamreport') {
        await handleUnsubscribe(event.email);
        if (recipientId) {
          await prisma.emailCampaignRecipient.updateMany({
            where: { id: recipientId },
            data: { spamReportedAt: new Date(event.timestamp * 1000) },
          });
        }
        continue;
      }

      // Bounce / dropped — flag the contact email so future sends skip it
      if (eventType === 'bounce' || eventType === 'dropped') {
        await handleBounce(event.email, eventType, event.timestamp, event.reason);
      }

      if (event.crm_email_id) {
        await recordPersonalEmailEvent(event.crm_email_id, event.email, eventType, event.timestamp);
        continue;
      }

      // All other events require a campaignId (they come from our bulk sends)
      if (!campaignId) continue;

      // Update per-recipient status
      if (recipientId && Object.hasOwn(EVENT_TO_STATUS, eventType)) {
        const updateData: Record<string, unknown> = { status: EVENT_TO_STATUS[eventType] };
        updateData[EVENT_TIMESTAMP_FIELD[eventType]] = new Date(event.timestamp * 1000);
        if ((eventType === 'bounce' || eventType === 'dropped') && event.reason) {
          updateData.errorMessage = event.reason;
          updateData.failureReason = event.reason;
        }
        await prisma.emailCampaignRecipient.updateMany({
          where: { id: recipientId, campaignId },
          data: updateData,
        });
      }

      affectedCampaignIds.add(campaignId);
    }

    // Replays and partially persisted batches are safe: recipient rows remain
    // the source of truth, and recomputing them does not duplicate counts.
    for (const cid of affectedCampaignIds) {
      await recomputeCampaignStats(cid);
    }

    if (events.length > 0) {
      // A heartbeat means the batch was durably processed, not just received.
      const receivedAt = new Date();
      await prisma.webhookHeartbeat.upsert({
        where: { provider: 'sendgrid' },
        create: { provider: 'sendgrid', lastEventAt: receivedAt },
        update: { lastEventAt: receivedAt },
      });
    }

    // Acknowledge only after persistence. An early 200 permanently loses events
    // when a database write fails, because the provider will not retry them.
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('[webhooks/sendgrid] Failed to persist event batch:', error);
    res.status(503).json({ error: 'Unable to persist events; please retry' });
  }
});
