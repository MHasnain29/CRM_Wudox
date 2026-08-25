/**
 * Wipe CRM business data. Keeps only KEEP_EMAIL (default hassan@wudox.ca)
 * and system scaffolding so login still works.
 *
 * Usage (from backend/):
 *   npx tsx scripts/wipe-crm-keep-hassan.ts
 *   npx tsx scripts/wipe-crm-keep-hassan.ts --confirm
 */

import {
  DEFAULT_KEEP_EMAIL,
  executeCrmWipe,
  previewCrmWipe,
} from '../src/services/dangerousAdminWipe';
import prisma from '../src/config/database';

const KEEP_EMAIL = (process.env.KEEP_EMAIL ?? process.env.DANGEROUS_ADMIN_KEEP_EMAIL ?? DEFAULT_KEEP_EMAIL).trim();
const confirm = process.argv.includes('--confirm');

async function main() {
  const preview = await previewCrmWipe(KEEP_EMAIL);

  console.log('=== CRM wipe (keep Hassan) ===');
  console.log(`Keep user: ${preview.keepEmail} found=${preview.keepUserFound}`);
  console.log(
    `Current: users=${preview.users} clients=${preview.clients} leads=${preview.leads} pending_imports=${preview.pendingImports}`,
  );
  console.log(`Will truncate ${preview.wipeTableCount} table(s). Other users: ${preview.otherUsers}`);

  if (!preview.keepUserFound) {
    console.error(`Keep user not found: ${KEEP_EMAIL}`);
    process.exit(1);
  }

  if (!confirm) {
    console.log('\nDRY RUN — no changes made.');
    console.log('Re-run with --confirm to wipe:');
    console.log('  npx tsx scripts/wipe-crm-keep-hassan.ts --confirm');
    return;
  }

  console.log('\nWiping…');
  const result = await executeCrmWipe(KEEP_EMAIL);
  console.log('\nDone.');
  console.log(
    `  deletedUsers=${result.deletedUsers} truncatedTables=${result.truncatedTables}`,
  );
  console.log(
    `  users=${result.usersAfter} clients=${result.clientsAfter} leads=${result.leadsAfter} pending_imports=${result.pendingImportsAfter}`,
  );
}

main()
  .catch((err) => {
    console.error('Wipe failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
