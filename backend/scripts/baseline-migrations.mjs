/**
 * Baseline _prisma_migrations for a DB that already has the schema
 * but lost migration history. Marks all migrations as applied except
 * the ones listed in SKIP (still pending deploy).
 *
 * Usage: node scripts/baseline-migrations.mjs
 */
import { readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const SKIP = new Set(['20260620100000_super_user_client_destination']);

const migrationsDir = join(process.cwd(), 'prisma', 'migrations');
const names = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const toApply = names.filter((n) => !SKIP.has(n));
console.log(`Baselining ${toApply.length} migrations (skipping: ${[...SKIP].join(', ')})`);

for (const name of toApply) {
  try {
    execSync(`npx prisma migrate resolve --applied ${name}`, {
      stdio: 'pipe',
      encoding: 'utf8',
    });
    process.stdout.write('.');
  } catch (e) {
    const out = e.stdout?.toString() ?? '';
    const err = e.stderr?.toString() ?? '';
    if (out.includes('already recorded as applied') || err.includes('already recorded as applied')) {
      process.stdout.write('a');
    } else {
      console.error(`\nFailed on ${name}:`, err || out || e.message);
      process.exit(1);
    }
  }
}

console.log('\nDone. Run: npx prisma migrate deploy');
