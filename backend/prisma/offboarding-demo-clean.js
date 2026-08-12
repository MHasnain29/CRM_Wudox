/**
 * Delete ALL seeded offboarding demo data for Emily Johnson.
 * Removes clients, leads, tasks, meetings, follow-ups, emails created by seed-emily-test.js
 * and clears any offboarding logs. Emily is reactivated at the end.
 *
 * Run: node backend/prisma/offboarding-demo-clean.js
 */
const { PrismaClient } = require('../node_modules/@prisma/client');
const prisma = new PrismaClient();

const EMILY_ID = 'ce158add-c9c6-4019-ad71-6166f71ab3b1';
const SEEDED_CORPORATE_CODES = ['MTS-TEST-001', 'NBI-TEST-002', 'SHC-TEST-003'];

async function main() {
  console.log('Cleaning offboarding demo data for Emily Johnson...\n');

  // 1. Find seeded clients
  const clients = await prisma.client.findMany({
    where: { corporateCode: { in: SEEDED_CORPORATE_CODES } },
    select: { id: true, name: true },
  });
  const clientIds = clients.map(c => c.id);
  console.log(`  Found ${clients.length} seeded client(s): ${clients.map(c => c.name).join(', ')}`);

  // 2. Delete emails (inbox to Emily + sent/drafts from Emily)
  const emails = await prisma.email.deleteMany({
    where: {
      OR: [
        { toUserId: EMILY_ID },
        { fromUserId: EMILY_ID },
        { forwardedToUserId: EMILY_ID },
        { forwardedFromUserId: EMILY_ID },
      ],
    },
  });
  console.log(`  Deleted emails: ${emails.count}`);

  // 3. Delete follow-ups tied to seeded clients or owned by Emily
  const followUps = await prisma.followUp.deleteMany({
    where: {
      OR: [
        { clientId: { in: clientIds } },
        { ownerId: EMILY_ID },
        { forwardedFromUserId: EMILY_ID },
      ],
    },
  });
  console.log(`  Deleted follow-ups: ${followUps.count}`);

  // 4. Delete meetings tied to seeded clients or owned by Emily
  const meetings = await prisma.meeting.deleteMany({
    where: {
      OR: [
        { clientId: { in: clientIds } },
        { ownerId: EMILY_ID },
        { forwardedFromUserId: EMILY_ID },
      ],
    },
  });
  console.log(`  Deleted meetings: ${meetings.count}`);

  // 5. Delete tasks owned by Emily (or forwarded from her)
  const tasks = await prisma.task.deleteMany({
    where: {
      OR: [
        { ownerId: EMILY_ID },
        { forwardedFromUserId: EMILY_ID },
      ],
    },
  });
  console.log(`  Deleted tasks: ${tasks.count}`);

  // 6. Delete leads tied to seeded clients or owned by Emily
  const leads = await prisma.lead.deleteMany({
    where: {
      OR: [
        { clientId: { in: clientIds } },
        { ownerId: EMILY_ID },
        { forwardedFromUserId: EMILY_ID },
      ],
    },
  });
  console.log(`  Deleted leads: ${leads.count}`);

  // 7. Delete ClientSubCompany junction rows for seeded clients
  if (clientIds.length > 0) {
    const junctions = await prisma.clientSubCompany.deleteMany({
      where: { clientId: { in: clientIds } },
    });
    console.log(`  Deleted client-agency links: ${junctions.count}`);
  }

  // 8. Delete seeded clients
  const deletedClients = await prisma.client.deleteMany({
    where: { corporateCode: { in: SEEDED_CORPORATE_CODES } },
  });
  console.log(`  Deleted clients: ${deletedClients.count}`);

  // 9. Delete offboarding logs for Emily
  const logs = await prisma.offboardingLog.deleteMany({
    where: { departingUserId: EMILY_ID },
  });
  console.log(`  Deleted offboarding logs: ${logs.count}`);

  // 10. Reactivate Emily
  await prisma.user.update({
    where: { id: EMILY_ID },
    data: { isActive: true },
  });
  console.log('  Emily reactivated (isActive = true)');

  console.log('\nDone! All demo data removed. Run seed-emily-test.js to start fresh.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
