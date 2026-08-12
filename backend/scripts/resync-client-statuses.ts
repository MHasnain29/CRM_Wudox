/**
 * One-off backfill: recompute ClientSubCompany.status from current lead outcomes.
 *
 * Run this once after deploying the Active-tag fix
 * See docs/SYSTEM_UNDERSTANDING.md §6 (status tags) to correct rows that were wrongly marked
 * `active` while their lead was still `open` / `closed_won_pending`.
 *
 * Usage: cd backend && npx tsx scripts/resync-client-statuses.ts
 *
 * Safe to run multiple times — the sync function is idempotent.
 */
import prisma from '../src/config/database';
import { syncClientStatusFromLeadOutcomes } from '../src/services/leadClientStatus';

async function main() {
  // Resync every (clientId, subCompanyId) view that currently claims `active`.
  // Anything that's truly Active (latest lead = closed_won) stays `active`;
  // anything that was incorrectly `active` because of an open lead drops to
  // `contacted` (or `lost` if the latest lead is closed_lost).
  const rows = await prisma.clientSubCompany.findMany({
    where: { status: 'active' },
    select: { clientId: true, subCompanyId: true },
  });

  console.log(`Found ${rows.length} ClientSubCompany rows currently flagged active. Resyncing…`);

  let unchanged = 0;
  let toContacted = 0;
  let toLost = 0;
  let other = 0;

  for (const r of rows) {
    const before = 'active';
    const after = await syncClientStatusFromLeadOutcomes({
      clientId: r.clientId,
      subCompanyId: r.subCompanyId,
    });

    if (after === before) unchanged++;
    else if (after === 'contacted') toContacted++;
    else if (after === 'lost') toLost++;
    else other++;
  }

  console.log('Done.');
  console.log(`  unchanged (still active):  ${unchanged}`);
  console.log(`  active -> contacted:       ${toContacted}`);
  console.log(`  active -> lost:            ${toLost}`);
  console.log(`  active -> other:           ${other}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
