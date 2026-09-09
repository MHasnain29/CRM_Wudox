/**
 * Aggregates per-recipient state into the campaign's cached stats columns.
 * The recipient table is the single source of truth — webhook events and the
 * sender mutate individual rows; this function rolls them up.
 */
import prisma from '../config/database';

export async function recomputeCampaignStats(campaignId: string): Promise<void> {
  const [recipients, campaign] = await Promise.all([
    prisma.emailCampaignRecipient.findMany({
      where: { campaignId },
      select: {
        status: true,
        sentAt: true,
        deliveredAt: true,
        openedAt: true,
        clickedAt: true,
      },
    }),
    prisma.emailCampaign.findUnique({
      where: { id: campaignId },
      select: { statsDelivered: true, statsOpened: true, statsClicked: true, statsBounced: true },
    }),
  ]);
  if (!campaign) return;

  let sent = 0;
  let delivered = 0;
  let opened = 0;
  let clicked = 0;
  let bounced = 0;
  let failed = 0;

  for (const r of recipients) {
    if (r.sentAt) sent++;
    if (r.deliveredAt) delivered++;
    if (r.openedAt) opened++;
    if (r.clickedAt) clicked++;
    if (r.status === 'bounced') bounced++;
    if (r.status === 'failed') failed++;
  }

  await prisma.emailCampaign.update({
    where: { id: campaignId },
    data: {
      // sent/failed reflect our own send outcome — the recipient table is authoritative.
      statsSent: sent,
      statsFailed: failed,
      // Engagement metrics are also written by the SendGrid Category-Stats poller
      // (aggregate source) and only ever grow. Take the max so neither source
      // regresses the other — e.g. a poller-backfilled value survives this recompute
      // for campaigns whose per-recipient events predate the Event Webhook.
      statsDelivered: Math.max(delivered, campaign.statsDelivered),
      statsOpened: Math.max(opened, campaign.statsOpened),
      statsClicked: Math.max(clicked, campaign.statsClicked),
      statsBounced: Math.max(bounced, campaign.statsBounced),
    },
  });
}
