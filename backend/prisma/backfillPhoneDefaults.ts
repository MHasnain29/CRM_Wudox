/**
 * Backfill reference phone defaults for agencies with empty configs.
 * Run: npm run prisma:backfill-phone-defaults
 */
import '../src/loadEnv';
import { backfillPhoneDefaults } from '../src/services/phoneSystemService';
import prisma from '../src/config/database';

async function main() {
  const count = await backfillPhoneDefaults();
  console.log(`Seeded reference phone defaults for ${count} agencies`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
