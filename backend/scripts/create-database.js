/**
 * Creates the Wudox CRM database from DATABASE_URL if it doesn't exist (e.g. wudox_crm).
 * Connects to the default "postgres" database to run CREATE DATABASE.
 * Run: node scripts/create-database.js
 */
require('dotenv').config();

const { Client } = require('pg');

async function createDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ DATABASE_URL is not set in .env');
    process.exit(1);
  }

  const parsed = new URL(url);
  const config = {
    user: parsed.username,
    password: parsed.password,
    host: parsed.hostname,
    port: parsed.port || 5432,
    database: 'postgres',
    connectionTimeoutMillis: 5000,
  };

  const client = new Client(config);
  const dbName = parsed.pathname.slice(1).replace(/\?.*$/, '');

  try {
    await client.connect();
    const res = await client.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbName]
    );
    if (res.rows.length > 0) {
      console.log(`✅ Database "${dbName}" already exists.`);
      return;
    }
    await client.query(`CREATE DATABASE "${dbName}"`);
    console.log(`✅ Database "${dbName}" created successfully.`);
  } catch (err) {
    console.error('❌ Error creating database:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

createDatabase();
