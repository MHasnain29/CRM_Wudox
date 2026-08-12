/**
 * Campaign Scheduler: every 60 seconds, find scheduled campaigns whose
 * scheduledDate has passed and send them via the shared campaignSender service.
 */
import prisma from '../config/database';
import { sendCampaignById } from '../services/campaignSender';

let timer: ReturnType<typeof setInterval> | null = null;

async function runScheduler() {
  try {
    const due = await prisma.emailCampaign.findMany({
      where: {
        status: 'scheduled',
        scheduledDate: { lte: new Date() },
      },
      select: { id: true },
    });

    for (const campaign of due) {
      // Fire-and-forget; errors are caught inside sendCampaignById
      sendCampaignById(campaign.id).catch((err) => {
        console.error(`[campaignScheduler] Failed to send campaign ${campaign.id}:`, err);
      });
    }
  } catch (err) {
    console.error('[campaignScheduler] Error querying due campaigns:', err);
  }
}

export function startCampaignScheduler() {
  if (timer) return;
  timer = setInterval(runScheduler, 60_000);
  console.log('[campaignScheduler] Started — checking every 60s');
}

export function stopCampaignScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
