/** Apply only the reviewed leave migration on databases with incomplete old history. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import pg from 'pg';

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationName = '20261003000000_half_day_leave';
const migrationFile = join(backendDir, 'prisma', 'migrations', migrationName, 'migration.sql');
const quantities = new Set([
  'leave_types.days_per_year', 'leave_types.max_carry_over',
  'leave_balances.entitled', 'leave_balances.used', 'leave_balances.carried_over',
  'leave_requests.days',
]);
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
class CheckError extends Error {}

async function inspect(client, schema, checksum) {
  const { rows: columns } = await client.query(`
    SELECT table_name, column_name, udt_name, udt_schema, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = $1
      AND table_name IN ('leave_types', 'leave_balances', 'leave_requests')
  `, [schema]);
  const numeric = columns.filter((column) => quantities.has(`${column.table_name}.${column.column_name}`));
  const session = columns.find((column) => column.table_name === 'leave_requests' && column.column_name === 'session');
  const { rows: types } = await client.query(`
    SELECT t.typtype, array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
      FILTER (WHERE e.enumlabel IS NOT NULL) AS labels
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    LEFT JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = $1 AND t.typname = 'LeaveSession'
    GROUP BY t.oid, t.typtype
  `, [schema]);
  const oldState = numeric.length === quantities.size && numeric.every((column) => column.udt_name === 'int4')
    && !session && types.length === 0;
  const validDefault = session && ["'full_day'::\"LeaveSession\"", `'full_day'::${quoteIdentifier(schema)}."LeaveSession"`, `'full_day'::${schema}."LeaveSession"`]
    .includes(session.column_default);
  const newState = numeric.length === quantities.size && numeric.every((column) => column.udt_name === 'float8')
    && session?.udt_name === 'LeaveSession' && session.udt_schema === schema
    && session.is_nullable === 'NO' && validDefault
    && types.length === 1 && types[0].typtype === 'e'
    && JSON.stringify(types[0].labels) === JSON.stringify(['full_day', 'first_half', 'second_half']);
  if (!oldState && !newState) {
    throw new CheckError('Leave schema is incomplete or unexpected. Review it before applying any migration.');
  }

  const { rows: [history] } = await client.query('SELECT to_regclass($1) IS NOT NULL AS present', [`${quoteIdentifier(schema)}."_prisma_migrations"`]);
  const receipts = history.present ? (await client.query(`
    SELECT migration_name, checksum, finished_at, rolled_back_at
    FROM "_prisma_migrations" WHERE rolled_back_at IS NULL
  `)).rows : [];
  if (receipts.some((row) => !row.finished_at && row.migration_name !== migrationName)) {
    throw new CheckError('An unrelated migration has an unresolved failure. Review and recover that failed attempt first; this script does not baseline or roll back old migrations.');
  }
  const targetReceipts = receipts.filter((row) => row.migration_name === migrationName);
  if (targetReceipts.some((row) => row.checksum !== checksum)) {
    throw new CheckError('The recorded leave migration checksum differs from the SQL file. Review migration history first.');
  }
  const recorded = targetReceipts.some((row) => row.finished_at);
  if (recorded && !newState) {
    throw new CheckError('Leave migration is recorded as applied, but its schema is missing. Review database drift first.');
  }
  return { state: oldState ? 'pending' : 'applied', recorded };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--check') || args.length > 1) {
    throw new CheckError('Usage: npm run prisma:migrate:leave -- [--check]');
  }
  const checkOnly = args.includes('--check');
  // Match Prisma CLI precedence: an exported DATABASE_URL wins over backend/.env.
  dotenv.config({ path: join(backendDir, '.env') });
  dotenv.config({ path: join(backendDir, 'prisma', '.env') });
  if (!process.env.DATABASE_URL) throw new CheckError('DATABASE_URL is not configured.');
  const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
  const sql = readFileSync(migrationFile, 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query("SELECT set_config('search_path', $1, false)", [quoteIdentifier(schema)]);
    if (!checkOnly) {
      const { rows: [lock] } = await client.query('SELECT pg_try_advisory_lock(732041, 61003) AS acquired');
      if (!lock.acquired) throw new CheckError('Another leave migration is running. Retry after it finishes.');
    }
    await client.query(checkOnly ? 'BEGIN READ ONLY' : 'BEGIN');
    transactionOpen = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    let result = await inspect(client, schema, checksum);
    if (checkOnly) {
      console.log(`Leave schema: ${result.state}; migration receipt: ${result.recorded ? 'verified' : 'not recorded'}. No changes made.`);
    } else if (result.state === 'pending') {
      await client.query('LOCK TABLE "leave_types", "leave_balances", "leave_requests" IN ACCESS EXCLUSIVE MODE');
      result = await inspect(client, schema, checksum);
      if (result.state !== 'pending') throw new CheckError('Leave schema changed during the check. Retry after reviewing the other migration.');
      await client.query(sql);
      result = await inspect(client, schema, checksum);
      if (result.state !== 'applied') throw new CheckError('Leave schema verification failed; the SQL transaction will be rolled back.');
    }
    await client.query('COMMIT');
    transactionOpen = false;
    if (!checkOnly && !result.recorded) {
      const resolved = spawnSync(process.execPath, [
        join(backendDir, 'node_modules', 'prisma', 'build', 'index.js'),
        'migrate', 'resolve', '--schema', join(backendDir, 'prisma', 'schema.prisma'),
        '--applied', migrationName,
      ], { cwd: backendDir, env: process.env, encoding: 'utf8', timeout: 60000 });
      // Keep CLI diagnostics private: they may contain database connection details.
      if (resolved.error || resolved.status !== 0) {
        throw new CheckError('Leave schema is upgraded, but recording its migration failed. Review Prisma configuration, then rerun this command safely.');
      }
      result = await inspect(client, schema, checksum);
      if (!result.recorded) throw new CheckError('Leave migration receipt was not found after recording it. Review migration history.');
    }
    if (!checkOnly) console.log('Half-day leave schema and migration receipt verified. Existing migration history was not baselined.');
  } finally {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof CheckError ? error.message : 'Leave migration could not complete. Check database connectivity and schema permissions; no credentials are printed.');
  process.exitCode = 1;
});
