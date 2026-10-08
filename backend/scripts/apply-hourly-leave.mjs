/** Apply only hourly leave on databases with incomplete historical migration receipts. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import pg from 'pg';

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationName = '20261006000000_hourly_leave';
const migrationFile = join(backendDir, 'prisma', 'migrations', migrationName, 'migration.sql');
const quantities = new Set([
  'leave_types.days_per_year', 'leave_types.max_carry_over',
  'leave_balances.entitled', 'leave_balances.used', 'leave_balances.carried_over',
  'leave_requests.days',
]);
const hourlyColumns = new Map([
  ['hourly_category', 'LeaveHourlyCategory'],
  ['start_time', 'text'], ['end_time', 'text'], ['duration_minutes', 'int4'],
  ['timezone', 'text'], ['work_day_start_time', 'text'], ['work_day_end_time', 'text'],
]);
const originalSessions = ['full_day', 'first_half', 'second_half'];
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
class CheckError extends Error {}

async function inspect(client, schema, checksum) {
  const { rows: columns } = await client.query(`
    SELECT table_name, column_name, udt_name, udt_schema, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = $1
      AND table_name IN ('leave_types', 'leave_balances', 'leave_requests')
  `, [schema]);
  const requestColumns = new Map(columns.filter((column) => column.table_name === 'leave_requests')
    .map((column) => [column.column_name, column]));
  const numeric = columns.filter((column) => quantities.has(`${column.table_name}.${column.column_name}`));
  const { rows: types } = await client.query(`
    SELECT t.typname, t.typtype, array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
      FILTER (WHERE e.enumlabel IS NOT NULL) AS labels
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    LEFT JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = $1 AND t.typname IN ('LeaveSession', 'LeaveHourlyCategory', 'LeaveStatus')
    GROUP BY t.oid, t.typname, t.typtype
  `, [schema]);
  const isEnum = (name, labels) => types.some((type) => type.typname === name && type.typtype === 'e'
    && JSON.stringify(type.labels) === JSON.stringify(labels));
  const session = requestColumns.get('session');
  const status = requestColumns.get('status');
  const validSessionDefault = session && ["'full_day'::\"LeaveSession\"", `'full_day'::${quoteIdentifier(schema)}."LeaveSession"`, `'full_day'::${schema}."LeaveSession"`]
    .includes(session.column_default);
  const baseColumns = new Map([
    ['id', 'text'], ['user_id', 'text'], ['leave_type_id', 'text'],
    ['start_date', 'timestamp'], ['end_date', 'timestamp'],
  ]);
  const baseValid = numeric.length === quantities.size && numeric.every((column) => column.udt_name === 'float8'
    && column.udt_schema === 'pg_catalog' && column.is_nullable === 'NO')
    && [...baseColumns].every(([name, type]) => {
      const column = requestColumns.get(name);
      return column?.udt_name === type && column.udt_schema === 'pg_catalog' && column.is_nullable === 'NO';
    })
    && session?.udt_name === 'LeaveSession' && session.udt_schema === schema
    && session.is_nullable === 'NO' && validSessionDefault
    && status?.udt_name === 'LeaveStatus' && status.udt_schema === schema && status.is_nullable === 'NO'
    && isEnum('LeaveStatus', ['pending', 'approved', 'rejected', 'cancelled']);
  if (!baseValid) {
    throw new CheckError('The prerequisite half-day leave schema is incomplete or unexpected. Review and apply its migration before hourly leave.');
  }
  const oldState = isEnum('LeaveSession', originalSessions)
    && !types.some((type) => type.typname === 'LeaveHourlyCategory')
    && [...hourlyColumns.keys()].every((name) => !requestColumns.has(name));
  const newState = isEnum('LeaveSession', [...originalSessions, 'hourly'])
    && isEnum('LeaveHourlyCategory', ['time_away', 'late_arrival'])
    && [...hourlyColumns].every(([name, type]) => {
      const column = requestColumns.get(name);
      return column?.udt_name === type && column.udt_schema === (name === 'hourly_category' ? schema : 'pg_catalog')
        && column.is_nullable === 'YES' && column.column_default === null;
    });
  if (!oldState && !newState) {
    throw new CheckError('Hourly leave schema is partially applied or unexpected. Review database drift before applying any migration.');
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
    throw new CheckError('The recorded hourly leave migration checksum differs from the SQL file. Review migration history first.');
  }
  const recorded = targetReceipts.some((row) => row.finished_at);
  if (recorded && !newState) {
    throw new CheckError('Hourly leave migration is recorded as applied, but its schema is missing. Review database drift first.');
  }
  return { state: oldState ? 'pending' : 'applied', recorded };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--check') || args.length > 1) {
    throw new CheckError('Usage: npm run prisma:migrate:leave-hourly -- [--check]');
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
      // Share the half-day helper's lock because both change leave schema.
      const { rows: [lock] } = await client.query('SELECT pg_try_advisory_lock(732041, 61003) AS acquired');
      if (!lock.acquired) throw new CheckError('Another leave migration is running. Retry after it finishes.');
    }
    await client.query(checkOnly ? 'BEGIN READ ONLY' : 'BEGIN');
    transactionOpen = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    let result = await inspect(client, schema, checksum);
    if (checkOnly) {
      console.log(`Hourly leave schema: ${result.state}; migration receipt: ${result.recorded ? 'verified' : 'not recorded'}. No changes made.`);
    } else if (result.state === 'pending') {
      await client.query('LOCK TABLE "leave_types", "leave_balances", "leave_requests" IN ACCESS EXCLUSIVE MODE');
      result = await inspect(client, schema, checksum);
      if (result.state !== 'pending') throw new CheckError('Leave schema changed during the check. Retry after reviewing the other migration.');
      await client.query(sql);
      result = await inspect(client, schema, checksum);
      if (result.state !== 'applied') throw new CheckError('Hourly leave schema verification failed; the SQL transaction will be rolled back.');
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
        throw new CheckError('Hourly leave schema is upgraded, but recording its migration failed. Review Prisma configuration, then rerun this command safely.');
      }
      result = await inspect(client, schema, checksum);
      if (!result.recorded) throw new CheckError('Hourly leave migration receipt was not found after recording it. Review migration history.');
    }
    if (!checkOnly) console.log('Hourly leave schema and migration receipt verified. Existing migration history was not baselined.');
  } finally {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof CheckError ? error.message : 'Hourly leave migration could not complete. Check database connectivity and schema permissions; no credentials are printed.');
  process.exitCode = 1;
});
