/**
 * Idempotent approval policy + role capability seed.
 * Run: npx tsx prisma/seed-approval.ts
 */
import { PrismaClient } from '@prisma/client';
import { seedAgencyApprovalPolicies, seedRoleApprovalCapabilities } from '../src/services/approvalPolicy';

const prisma = new PrismaClient();

async function main() {
  console.log('⛓ Seeding approval policies and role capabilities...');
  const policies = await seedAgencyApprovalPolicies();
  console.log(`  ✓ ${policies} agency approval policies created`);
  const caps = await seedRoleApprovalCapabilities();
  console.log(`  ✓ ${caps} role approval capabilities upserted`);
  console.log('✅ Approval seed complete');
}

if (process.argv[1]?.includes('seed-approval')) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

export { main as seedApproval };
