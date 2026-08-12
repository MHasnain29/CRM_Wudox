/**
 * One-time backfill: seed PhoneNumber from TWILIO_CALLER_ID for agencies missing a DID.
 * Run after migration: npm run prisma:backfill-phone-system
 */
import '../src/loadEnv';
import { backfillPhoneNumbersFromEnv } from '../src/services/phoneSystemService';
import prisma from '../src/config/database';

async function main() {
  const count = await backfillPhoneNumbersFromEnv();
  console.log(`Backfilled phone numbers for ${count} agencies from TWILIO_CALLER_ID`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
