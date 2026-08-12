/**
 * Repair: inbound_calls migration was marked applied but tables are missing.
 * Run: npx tsx scripts/repair-inbound-tables.ts
 */
import '../src/loadEnv';
import prisma from '../src/config/database';
import fs from 'fs';
import path from 'path';

async function tableExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

async function main() {
  const hasInbound = await tableExists('inbound_calls');
  if (hasInbound) {
    console.log('inbound_calls already exists — nothing to repair');
    return;
  }

  console.log('Creating missing inbound_calls tables...');
  const sqlPath = path.join(
    __dirname,
    '../prisma/migrations/20260625150000_inbound_calls/migration.sql',
  );
  const sql = fs
    .readFileSync(sqlPath, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    try {
      await prisma.$executeRawUnsafe(stmt);
      console.log('OK:', stmt.slice(0, 60).replace(/\s+/g, ' ') + '...');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('already exists')) {
        console.log('SKIP (exists):', stmt.slice(0, 50));
      } else {
        throw e;
      }
    }
  }

  console.log('Repair complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
