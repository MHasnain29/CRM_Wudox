/**
 * Revert Emily Johnson's offboarding — restore all records back to her ownership.
 * Run: node backend/prisma/revert-emily-offboarding.js
 */
const { PrismaClient } = require('../node_modules/@prisma/client');
const prisma = new PrismaClient();

const EMILY_ID = 'ce158add-c9c6-4019-ad71-6166f71ab3b1';

async function main() {
  console.log('Reverting Emily Johnson offboarding...\n');

  // 1. Reactivate Emily
  await prisma.user.update({
    where: { id: EMILY_ID },
    data: { isActive: true },
  });
  console.log('  Emily reactivated (isActive = true)');

  // 2. Clients — reassign back to Emily, clear forwarded flag
  const clients = await prisma.client.updateMany({
    where: { forwardedFromUserId: EMILY_ID },
    data: { ownershipUserId: EMILY_ID, ownershipType: 'associate', forwardedFromUserId: null },
  });
  console.log(`  Clients reverted: ${clients.count}`);

  // 3. Leads (pipeline + closed) — reassign back to Emily
  const leads = await prisma.lead.updateMany({
    where: { forwardedFromUserId: EMILY_ID },
    data: { ownerId: EMILY_ID, forwardedFromUserId: null },
  });
  console.log(`  Leads reverted: ${leads.count}`);

  // 4. Tasks
  const tasks = await prisma.task.updateMany({
    where: { forwardedFromUserId: EMILY_ID },
    data: { ownerId: EMILY_ID, forwardedFromUserId: null },
  });
  console.log(`  Tasks reverted: ${tasks.count}`);

  // 5. Meetings
  const meetings = await prisma.meeting.updateMany({
    where: { forwardedFromUserId: EMILY_ID },
    data: { ownerId: EMILY_ID, forwardedFromUserId: null },
  });
  console.log(`  Meetings reverted: ${meetings.count}`);

  // 6. Follow-ups
  const followUps = await (prisma.followUp).updateMany({
    where: { forwardedFromUserId: EMILY_ID },
    data: { ownerId: EMILY_ID, forwardedFromUserId: null },
  });
  console.log(`  Follow-ups reverted: ${followUps.count}`);

  // 7. Emails — clear forwarded flags
  const emails = await prisma.email.updateMany({
    where: { forwardedFromUserId: EMILY_ID },
    data: { forwardedFromUserId: null, forwardedToUserId: null },
  });
  console.log(`  Emails reverted: ${emails.count}`);

  // 8. Delete offboarding log for Emily
  const logs = await prisma.offboardingLog.deleteMany({
    where: { departingUserId: EMILY_ID },
  });
  console.log(`  Offboarding logs deleted: ${logs.count}`);

  console.log('\nDone! Emily is fully restored. You can now re-test the offboarding wizard.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
