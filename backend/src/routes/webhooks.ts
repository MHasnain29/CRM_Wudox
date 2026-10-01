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
  const field = EVENT_TIMESTAMP_FIELD[eventType];
  if (!field || !address.trim() || !Number.isFinite(timestamp)) return;
  await prisma.emailRecipient.updateMany({
    where: { emailId, emailAddress: { equals: address.trim(), mode: 'insensitive' }, [field]: null } as Prisma.EmailRecipientWhereInput,
    data: { [field]: new Date(timestamp * 1000) },
  }).catch(() => {});
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
  }).catch(() => {});
}

/**
 * Handles bounce and dropped events:
 *  - Sets emailBounced = true for hard bounces
 *  - Sets emailInvalid = true for invalid address drops
 */
async function handleBounce(email: string, eventType: string, reason?: string) {
  const isInvalid =
    eventType === 'dropped' &&
    typeof reason === 'string' &&
    /invalid/i.test(reason);

  const data = isInvalid
    ? { emailInvalid: true, emailBouncedAt: new Date(), emailBouncedReason: reason ?? null }
    : { emailBounced: true, emailBouncedAt: new Date(), emailBouncedReason: reason ?? null };

  await prisma.clientContact.updateMany({
    where: { email },
    data,
  }).catch(() => {});
}

/** POST /webhooks/sendgrid */
webhooksRouter.post('/sendgrid', async (req: Request, res: Response) => {
  // Acknowledge immediately — SendGrid retries if we don't respond quickly
  res.status(200).json({ received: true });

  const events: SendGridEvent[] = Array.isArray(req.body) ? req.body : [];
  if (events.length === 0) return;

  // Reports read this to tell "no results yet" apart from "the webhook is not reporting".
  const receivedAt = new Date();
  await prisma.webhookHeartbeat.upsert({
    where: { provider: 'sendgrid' },
    create: { provider: 'sendgrid', lastEventAt: receivedAt },
    update: { lastEventAt: receivedAt },
  }).catch(() => {});

  // Track which campaigns were touched so we can recompute their cached stats once at the end.
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
        }).catch(() => {});
      }
      continue;
    }

    // Bounce / dropped — flag the contact email so future sends skip it
    if (eventType === 'bounce' || eventType === 'dropped') {
      await handleBounce(event.email, eventType, event.reason);
    }

    // The endpoint is unauthenticated: only plain string ids/addresses reach Prisma filters.
    if (typeof event.crm_email_id === 'string') {
      if (typeof event.email === 'string') await recordPersonalEmailEvent(event.crm_email_id, event.email, eventType, event.timestamp);
      continue;
    }

    // All other events require a campaignId (they come from our bulk sends)
    if (!campaignId) continue;

    // Update per-recipient status
    if (recipientId) {
      const newStatus = EVENT_TO_STATUS[eventType];
      if (newStatus) {
        const updateData: Record<string, unknown> = { status: newStatus };
        const field = EVENT_TIMESTAMP_FIELD[eventType];
        if (field) updateData[field] = new Date(event.timestamp * 1000);
        if (eventType === 'bounce' || eventType === 'dropped') {
          if (event.reason) {
            updateData.errorMessage = event.reason;
            updateData.failureReason = event.reason;
          }
        }
        await prisma.emailCampaignRecipient.updateMany({
          where: { id: recipientId },
          data: updateData,
        }).catch(() => {});
      }
    }

    affectedCampaignIds.add(campaignId);
  }

  // Re-aggregate stats from the recipient table for each touched campaign.
  // This is the source of truth — increments would drift if a webhook arrived twice.
  for (const cid of affectedCampaignIds) {
    await recomputeCampaignStats(cid).catch(() => {});
  }
});
