/**
 * One-time: copy master .env Twilio creds into agency DB rows.
 *
 * Usage:
 *   npx tsx scripts/seed-agency-phone-defaults.ts
 *   npx tsx scripts/seed-agency-phone-defaults.ts --agency-id=<uuid> --force
 *   npx tsx scripts/seed-agency-phone-defaults.ts --all
 */
import '../src/loadEnv';
import prisma from '../src/config/database';
import {
  seedAgencyTwilioDefaultsIfEmpty,
  seedAgencyTwilioFromEnv,
} from '../src/services/agencyTwilioService';
import { backfillPhoneNumbersFromEnv } from '../src/services/phoneSystemService';

async function main() {
  const agencyIdArg = process.argv.find((a) => a.startsWith('--agency-id='))?.split('=')[1];
  const seedAll = process.argv.includes('--all');
  const force = process.argv.includes('--force');

  const agencies = await prisma.subCompany.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  if (agencies.length === 0) {
    console.log('No agencies found');
    return;
  }

  const targets = agencyIdArg
    ? agencies.filter((a) => a.id === agencyIdArg)
  : seedAll
    ? agencies
    : agencies.length === 1
      ? agencies
      : [];

  if (targets.length === 0) {
    console.log('Multiple agencies — pass --agency-id=<uuid> or --all to seed from .env');
    agencies.forEach((a) => console.log(`  ${a.name}: ${a.id}`));
    return;
  }

  for (const agency of targets) {
    const seeded =
      agencyIdArg || seedAll
        ? await seedAgencyTwilioFromEnv(agency.id, { force })
        : await seedAgencyTwilioDefaultsIfEmpty(agency.id);
    console.log(`Twilio credentials seeded for ${agency.name}: ${seeded}`);
    const phoneCount = await backfillPhoneNumbersFromEnv(agency.id);
    console.log(`Phone numbers backfilled for ${agency.name}: ${phoneCount}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
