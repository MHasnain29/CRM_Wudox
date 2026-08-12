/**
 * Export staffopia_crm database to a plain SQL file using Node + pg (no pg_dump binary required).
 * Run: node scripts/export-database.js
 * Output: staffopia_crm_export_YYYYMMDD_HHMMSS.sql in backend directory.
 * On new server: create DB, run "prisma migrate deploy", then psql -d staffopia_crm -f <export>.sql
 */
require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

function escapeLiteral(val) {
  if (val === null) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number' && !Number.isNaN(val)) return String(val);
  if (Buffer.isBuffer(val)) return "'" + val.toString('hex').replace(/'/g, "''") + "'";
  return "'" + String(val).replace(/'/g, "''").replace(/\\/g, '\\\\') + "'";
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ DATABASE_URL is not set in .env');
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  const outDir = process.env.EXPORT_DIR || path.join(__dirname, '..');
  const now = new Date();
const timestamp = now.toISOString().slice(0, 10).replace(/-/g, '') + '_' + now.toTimeString().slice(0, 8).replace(/:/g, '');
  const outFile = path.join(outDir, `staffopia_crm_export_${timestamp}.sql`);

  try {
    await client.connect();
  } catch (e) {
    console.error('❌ Could not connect to database:', e.message);
    process.exit(1);
  }

  const lines = [
    '-- Staffopia CRM database export (data)',
    '-- Apply schema first on new server: prisma migrate deploy',
    '-- Then run this file: psql -U postgres -d staffopia_crm -f this_file.sql',
    '',
    'SET session_replication_role = replica;',
    '',
  ];

  const tablesRes = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const tables = tablesRes.rows.map((r) => r.table_name);

  for (const table of tables) {
    const colsRes = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
      [table]
    );
    const columns = colsRes.rows.map((r) => r.column_name);
    const colList = columns.map((c) => `"${c}"`).join(', ');

    const res = await client.query(`SELECT * FROM "${table}"`);
    if (res.rows.length === 0) {
      lines.push(`-- Table: ${table} (0 rows)`);
      lines.push('');
      continue;
    }

    lines.push(`-- Table: ${table} (${res.rows.length} rows)`);
    for (const row of res.rows) {
      const values = columns.map((col) => escapeLiteral(row[col]));
      lines.push(`INSERT INTO "${table}" (${colList}) VALUES (${values.join(', ')});`);
    }
    lines.push('');
  }

  lines.push('SET session_replication_role = DEFAULT;');
  lines.push('');

  fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
  await client.end();

  console.log('✅ Export complete:', outFile);
  console.log('');
  console.log('To import on a new PostgreSQL server:');
  console.log('  1. Create DB:     psql -U postgres -c "CREATE DATABASE staffopia_crm;"');
  console.log('  2. Apply schema:  cd backend && npx prisma migrate deploy');
  console.log('  3. Import data:   psql -U postgres -d staffopia_crm -f', path.basename(outFile));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
