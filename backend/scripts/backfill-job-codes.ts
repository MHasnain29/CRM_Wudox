/**
 * One-off / idempotent backfill: assign 6-digit sequential job codes
 * (000001, 000002, …) to any Job row that doesn't have one yet.
 *
 * Requires the jobs_job_code_seq sequence (see migration
 * 20260804140000_job_code_sequential).
 *
 * Usage: cd backend && npx tsx scripts/backfill-job-codes.ts
 *
 * Safe to run multiple times — only rows with a null jobCode are touched.
 */
import prisma from '../src/config/database';

async function nextJobCode(): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ nextval: bigint | number | string }>>`
    SELECT nextval('jobs_job_code_seq') AS nextval
  `;
  const n = Number(rows[0]?.nextval);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error('Failed to allocate job code sequence');
  }
  return String(n).padStart(6, '0');
}

async function main() {
  const jobs = await prisma.job.findMany({
    where: { jobCode: null },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  if (jobs.length === 0) {
    console.log('All jobs already have a job code. Nothing to do.');
    return;
  }

  console.log(`Found ${jobs.length} job(s) without a code. Assigning…`);

  let updated = 0;
  for (const job of jobs) {
    const jobCode = await nextJobCode();
    await prisma.job.update({ where: { id: job.id }, data: { jobCode } });
    console.log(`  ${job.id} -> ${jobCode}`);
    updated += 1;
  }

  console.log(`\nDone. Updated ${updated} job(s).`);
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
