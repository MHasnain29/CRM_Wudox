/**
 * Hubstaff background sync.
 *
 * Every 30 minutes, reconciles the last 31 dates of daily activity for every agency
 * with an enabled Hubstaff connection. The rolling window re-upserts recent
 * days because Hubstaff totals keep changing while people are tracking.
 */
import prisma from '../config/database';
import { runHubstaffSync } from '../services/hubstaff';

const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const LOOKBACK_DAYS = 30;
const INITIAL_HISTORY_DAYS = 90;

let intervalTimer: ReturnType<typeof setInterval> | null = null;
let running = false;
let bootTimer: ReturnType<typeof setTimeout> | null = null;

async function syncAllConfigs(): Promise<void> {
  if (running) return; // never overlap runs
  running = true;
  try {
    const configs = await prisma.hubstaffConfig.findMany({ where: { syncEnabled: true } });
    if (configs.length === 0) return;

    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    for (const config of configs) {
      try {
        const historyDue =
          !config.lastHistoryReconciledAt ||
          Date.now() - config.lastHistoryReconciledAt.getTime() > 7 * 86400_000;
        let effectiveStart = startDate;
        if (historyDue) {
          const earliest = await prisma.hubstaffTaskActivity.aggregate({
            where: { configId: config.id },
            _min: { date: true },
          });
          const initialStart = new Date(Date.now() - INITIAL_HISTORY_DAYS * 86400_000)
            .toISOString()
            .slice(0, 10);
          const historyStart = earliest._min.date?.toISOString().slice(0, 10) ?? initialStart;
          effectiveStart = historyStart < initialStart ? historyStart : initialStart;
          // The provider only exposes the last three years of daily activity.
          const retentionStart = new Date();
          retentionStart.setUTCFullYear(retentionStart.getUTCFullYear() - 3);
          retentionStart.setUTCDate(retentionStart.getUTCDate() + 1);
          const oldest = retentionStart.toISOString().slice(0, 10);
          if (effectiveStart < oldest) effectiveStart = oldest;
        }
        const { upserted } = await runHubstaffSync(config, effectiveStart, endDate);
        if (historyDue)
          await prisma.hubstaffConfig.update({
            where: { id: config.id },
            data: { lastHistoryReconciledAt: new Date() },
          });
        console.log(
          `[hubstaff] Synced org ${config.hubstaffOrgId} (${config.subCompanyId}): ${upserted} rows`
        );
      } catch (err) {
        // runHubstaffSync already stored lastSyncError; keep going for other agencies
        console.error(
          `[hubstaff] Sync failed for org ${config.hubstaffOrgId}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  } catch (err) {
    console.error('[hubstaff] Sync job error:', err);
  } finally {
    running = false;
  }
}

export function startHubstaffSync(): void {
  if (intervalTimer) return;
  // Initial run shortly after boot so a restart doesn't delay data by 30 min
  bootTimer = setTimeout(() => {
    bootTimer = null;
    void syncAllConfigs();
  }, 15 * 1000);
  intervalTimer = setInterval(() => void syncAllConfigs(), SYNC_INTERVAL_MS);
  console.log('⏱️  Hubstaff sync started (30-min interval)');
}

export function stopHubstaffSync(): void {
  if (bootTimer) {
    clearTimeout(bootTimer);
    bootTimer = null;
  }
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}
