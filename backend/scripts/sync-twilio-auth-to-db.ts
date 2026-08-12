/**
 * Force-copy master .env Twilio credentials into every agency's phone_agency_configs row.
 * Use on production when webhooks fail signature validation due to a stale DB auth token.
 *
 * Run on the production server (with correct .env):
 *   npx tsx scripts/sync-twilio-auth-to-db.ts
 */
import '../src/loadEnv';
import prisma from '../src/config/database';
import { env } from '../src/config/env';
import { seedAgencyTwilioFromEnv } from '../src/services/agencyTwilioService';

async function main() {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    console.error('Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env first.');
    process.exit(1);
  }

  const agencies = await prisma.subCompany.findMany({ select: { id: true, name: true } });
  if (!agencies.length) {
    console.error('No agencies found.');
    process.exit(1);
  }

  console.log('Syncing Twilio creds from .env into', agencies.length, 'agenc(ies)...');
  for (const agency of agencies) {
    const ok = await seedAgencyTwilioFromEnv(agency.id, { force: true });
    console.log(ok ? '  OK' : '  SKIP', agency.name, `(${agency.id})`);
  }

  console.log('\nDone. Restart the backend, then test an inbound call.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
