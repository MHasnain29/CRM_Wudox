/**
 * Revert ALL offboarding logs — restore every record back to the original departed user.
 * Run: node backend/prisma/revert-all-offboarding.js
 */
const { PrismaClient } = require('../node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.offboardingLog.findMany({
    include: { departingUser: { select: { id: true, firstName: true, lastName: true } } },
  });

  if (logs.length === 0) {
    console.log('No offboarding logs found. Nothing to revert.');
    return;
  }

  console.log(`Found ${logs.length} offboarding log(s). Reverting...\n`);

  for (const log of logs) {
    const uid = log.departingUserId;
    const name = `${log.departingUser.firstName} ${log.departingUser.lastName}`;
    console.log(`--- Reverting: ${name} (${uid})`);

    await prisma.user.update({ where: { id: uid }, data: { isActive: true } });
    console.log('  reactivated');

    const clients = await prisma.client.updateMany({
      where: { forwardedFromUserId: uid },
      data: { ownershipUserId: uid, ownershipType: 'associate', forwardedFromUserId: null },
    });
    console.log(`  clients: ${clients.count}`);

    const leads = await prisma.lead.updateMany({
      where: { forwardedFromUserId: uid },
      data: { ownerId: uid, forwardedFromUserId: null },
    });
    console.log(`  leads: ${leads.count}`);

    const tasks = await prisma.task.updateMany({
      where: { forwardedFromUserId: uid },
      data: { ownerId: uid, forwardedFromUserId: null },
    });
    console.log(`  tasks: ${tasks.count}`);

    const meetings = await prisma.meeting.updateMany({
      where: { forwardedFromUserId: uid },
      data: { ownerId: uid, forwardedFromUserId: null },
    });
    console.log(`  meetings: ${meetings.count}`);

    const followUps = await prisma.followUp.updateMany({
      where: { forwardedFromUserId: uid },
      data: { ownerId: uid, forwardedFromUserId: null },
    });
    console.log(`  follow-ups: ${followUps.count}`);

    const emails = await prisma.email.updateMany({
      where: { forwardedFromUserId: uid },
      data: { forwardedFromUserId: null, forwardedToUserId: null },
    });
    console.log(`  emails: ${emails.count}`);

    console.log(`  Done: ${name}\n`);
  }

  const deleted = await prisma.offboardingLog.deleteMany({});
  console.log(`Deleted ${deleted.count} offboarding log(s).`);
  console.log('\nAll offboardings reverted. Ready for fresh recording.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
