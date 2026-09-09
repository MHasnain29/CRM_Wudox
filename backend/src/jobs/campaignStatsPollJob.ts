/**
 * Campaign Stats Poll Job — every 5 minutes, pulls aggregate engagement stats from
 * SendGrid's Category Stats API for recently-sent campaigns and rolls them into the
 * cached stats columns.
 *
 * Each campaign is sent tagged with `categories: [campaign.id]` (see campaignSender),
 * so GET /v3/categories/stats?categories=<campaignId> returns that campaign's
 * delivered / opens / clicks / bounces — even for campaigns sent BEFORE the SendGrid
 * Event Webhook was enabled. That is what backfills historical stats.
 *
 * Complements the real-time Event Webhook (webhooks.ts): the webhook updates
 * per-recipient rows instantly; this job is the aggregate backfill + safety net.
 * Both feed the same columns via Math.max (see recomputeCampaignStats), so neither
 * source regresses the other.
 */
import prisma from '../config/database';
import { env } from '../config/env';

let timer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const LOOKBACK_DAYS = 30;
const CATEGORY_BATCH_SIZE = 10; // SendGrid caps categories per stats request

interface CategoryMetrics {
  delivered?: number;
  unique_opens?: number;
  unique_clicks?: number;
  bounces?: number;
}
interface CategoryStatDay {
  date: string;
  stats?: { name: string; metrics: CategoryMetrics }[];
}
interface CampaignTotals {
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Sum per-campaign metrics across the returned days for a batch of campaign ids. */
async function fetchCategoryTotals(
  campaignIds: string[],
  startDate: string,
  endDate: string,
): Promise<Map<string, CampaignTotals>> {
  const totals = new Map<string, CampaignTotals>();

  const params = new URLSearchParams({ start_date: startDate, end_date: endDate, aggregated_by: 'day' });
  for (const id of campaignIds) params.append('categories', id);

  const resp = await fetch(`https://api.sendgrid.com/v3/categories/stats?${params.toString()}`, {
    headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY}` },
  });
  if (!resp.ok) {
    // Surface auth/rate-limit/5xx failures — otherwise the backfill silently no-ops forever.
    console.error(`[campaignStatsPoll] SendGrid category stats failed: ${resp.status} ${resp.statusText}`);
    return totals;
  }

  const days = (await resp.json()) as CategoryStatDay[];
  if (!Array.isArray(days)) return totals;

  for (const day of days) {
    for (const s of day.stats ?? []) {
      const m = s.metrics ?? {};
      const cur = totals.get(s.name) ?? { delivered: 0, opened: 0, clicked: 0, bounced: 0 };
      cur.delivered += m.delivered ?? 0;
      // unique_opens/unique_clicks count distinct recipients — matches the
      // per-recipient openedAt/clickedAt semantics used by recomputeCampaignStats.
      cur.opened += m.unique_opens ?? 0;
      cur.clicked += m.unique_clicks ?? 0;
      cur.bounced += m.bounces ?? 0;
      totals.set(s.name, cur);
    }
  }
  return totals;
}

async function runPoll() {
  if (isRunning) return;
  isRunning = true;
  try {
    const lookback = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const campaigns = await prisma.emailCampaign.findMany({
      where: { status: 'sent', sentAt: { gte: lookback } },
      select: { id: true, statsDelivered: true, statsOpened: true, statsClicked: true, statsBounced: true },
    });
    if (campaigns.length === 0) return;

    const startDate = toDateOnly(lookback);
    const endDate = toDateOnly(new Date());

    for (let i = 0; i < campaigns.length; i += CATEGORY_BATCH_SIZE) {
      const batch = campaigns.slice(i, i + CATEGORY_BATCH_SIZE);
      const totals = await fetchCategoryTotals(batch.map((c) => c.id), startDate, endDate).catch(() => new Map<string, CampaignTotals>());

      for (const c of batch) {
        const t = totals.get(c.id);
        if (!t) continue;

        // Never regress a value already set by the real-time webhook path.
        const delivered = Math.max(t.delivered, c.statsDelivered);
        const opened = Math.max(t.opened, c.statsOpened);
        const clicked = Math.max(t.clicked, c.statsClicked);
        const bounced = Math.max(t.bounced, c.statsBounced);

        if (
          delivered === c.statsDelivered &&
          opened === c.statsOpened &&
          clicked === c.statsClicked &&
          bounced === c.statsBounced
        ) {
          continue; // no change — skip the write
        }

        await prisma.emailCampaign.update({
          where: { id: c.id },
          data: {
            statsDelivered: delivered,
            statsOpened: opened,
            statsClicked: clicked,
            statsBounced: bounced,
          },
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[campaignStatsPoll] Error:', err);
  } finally {
    isRunning = false;
  }
}

export function startCampaignStatsPoll() {
  if (!env.SENDGRID_API_KEY) {
    console.log('[campaignStatsPoll] Skipped — SENDGRID_API_KEY not configured');
    return;
  }
  if (timer) return;
  // Run immediately so a fresh deploy backfills recent campaigns, then every 5 min.
  runPoll();
  timer = setInterval(runPoll, POLL_INTERVAL_MS);
  console.log('[campaignStatsPoll] Started — polling SendGrid category stats every 5 minutes');
}

export function stopCampaignStatsPoll() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
