/**
 * Aggregates per-recipient state into the campaign's cached stats columns.
 * The recipient table is the single source of truth — webhook events and the
 * sender mutate individual rows; this function rolls them up.
 */
import prisma from '../config/database';

export async function recomputeCampaignStats(campaignId: string): Promise<void> {
  const recipients = await prisma.emailCampaignRecipient.findMany({
    where: { campaignId },
    select: {
      status: true,
      sentAt: true,
      deliveredAt: true,
      openedAt: true,
      clickedAt: true,
    },
  });

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
      statsSent: sent,
      statsDelivered: delivered,
      statsOpened: opened,
      statsClicked: clicked,
      statsBounced: bounced,
      statsFailed: failed,
    },
  });
}
