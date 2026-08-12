/**
 * Checks which migrations are missing on the live DB, logs them, then runs prisma migrate deploy.
 * Usage: npm run db:sync-live
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. Get all local migration folder names
  const migrationsDir = path.join(__dirname, '../prisma/migrations');
  const localMigrations = fs
    .readdirSync(migrationsDir)
    .filter((f) => fs.statSync(path.join(migrationsDir, f)).isDirectory() && f !== 'migration_lock.toml')
    .sort();

  // 2. Get applied migrations from DB
  let appliedMigrations: string[] = [];
  try {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name
    `;
    appliedMigrations = rows.map((r) => r.migration_name);
  } catch {
    console.error('❌  Could not read _prisma_migrations table. Is the DB reachable?');
    process.exit(1);
  }

  // 3. Find missing migrations
  const missing = localMigrations.filter((m) => !appliedMigrations.includes(m));

  if (missing.length === 0) {
    console.log('✅  All migrations are already applied on live. Nothing to do.');
  } else {
    console.log(`\n⚠️  ${missing.length} migration(s) missing on live:\n`);
    missing.forEach((m) => console.log(`   MISSING → ${m}`));
    console.log('\n▶  Running prisma migrate deploy...\n');
    execSync('npx prisma migrate deploy', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    console.log('\n✅  Done. All migrations applied.');
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
