/**
 * Campaign Stats Refresher: every 30 seconds, re-aggregate cached stats columns
 * from the email_campaign_recipients table for campaigns sent in the last 7 days.
 *
 * Per-recipient state is updated in real-time via the SendGrid Event Webhook at
 * /api/v1/webhooks/sendgrid (which also recomputes stats); this job is a safety
 * net to keep cached stats consistent if a webhook handler partially failed.
 */
import prisma from '../config/database';
import { recomputeCampaignStats } from '../services/campaignStats';

let timer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

async function runRefresher() {
  if (isRunning) return;
  isRunning = true;
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const campaigns = await prisma.emailCampaign.findMany({
      where: { status: 'sent', sentAt: { gte: sevenDaysAgo } },
      select: { id: true },
    });

    for (const campaign of campaigns) {
      await recomputeCampaignStats(campaign.id).catch(() => {});
    }
  } catch (err) {
    console.error('[campaignStatsRefresher] Error:', err);
  } finally {
    isRunning = false;
  }
}

export function startCampaignStatsRefresher() {
  if (timer) return;
  timer = setInterval(runRefresher, 30_000);
  console.log('[campaignStatsRefresher] Started — refreshing every 30s');
}

export function stopCampaignStatsRefresher() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
