import prisma from '../config/database';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_DAYS = 7;

let intervalTimer: ReturnType<typeof setInterval> | null = null;

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

async function runOnce(): Promise<void> {
  try {
    const settings = await prisma.clientVisibilitySetting.findMany({
      select: { subCompanyId: true, days: true },
    });

    const now = new Date();

    // Promote for agencies with explicit setting
    for (const s of settings) {
      const cutoff = s.days <= 0 ? now : daysAgo(s.days);
      await prisma.client.updateMany({
        where: {
          visibility: 'agency',
          createdAt: { lte: cutoff },
          clientSubCompanies: { some: { subCompanyId: s.subCompanyId } },
        },
        data: { visibility: 'global', visibilityPromotedAt: now },
      });
    }

    // Promote for agencies without a setting (default delay)
    const settingSubCompanyIds = settings.map(s => s.subCompanyId);
    const defaultCutoff = daysAgo(DEFAULT_DAYS);

    await prisma.client.updateMany({
      where: {
        visibility: 'agency',
        createdAt: { lte: defaultCutoff },
        clientSubCompanies: settingSubCompanyIds.length
          ? { some: { subCompanyId: { notIn: settingSubCompanyIds } } }
          : { some: {} },
      },
      data: { visibility: 'global', visibilityPromotedAt: now },
    });
  } catch (err) {
    console.error('[clientVisibilityPromoter] Error:', err);
  }
}

export function startClientVisibilityPromoter(): void {
  if (intervalTimer) return;
  void runOnce();
  intervalTimer = setInterval(() => void runOnce(), CHECK_INTERVAL_MS);
  console.log('👁️ Client visibility promoter started (1-hour interval)');
}

export function stopClientVisibilityPromoter(): void {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}
