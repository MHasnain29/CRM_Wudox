/**
 * Clear all leads data from the database.
 * Deletes in order: proposal attachments, proposals, then clears leadId from
 * calls/follow-ups/meetings/emails/documents, then deletes leads.
 * Optionally clears lead requests and related activity (use CLEAR_REQUESTS=1 to also clear lead_requests).
 *
 * Run: npx tsx scripts/clear-leads.ts
 * Or:  CLEAR_REQUESTS=1 npx tsx scripts/clear-leads.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const clearRequests = process.env.CLEAR_REQUESTS === '1';

  console.log('Clearing all leads data...');

  // 1. Delete proposal attachments (proposals are linked to leads)
  const proposals = await prisma.proposal.findMany({ select: { id: true } });
  const proposalIds = proposals.map((p) => p.id);
  if (proposalIds.length > 0) {
    const deletedAttachments = await prisma.proposalAttachment.deleteMany({
      where: { proposalId: { in: proposalIds } },
    });
    console.log(`  Deleted ${deletedAttachments.count} proposal attachment(s)`);
  }

  // 2. Delete proposals
  const deletedProposals = await prisma.proposal.deleteMany({});
  console.log(`  Deleted ${deletedProposals.count} proposal(s)`);

  // 3. Clear leadId from related tables (optional FKs)
  const [calls, followUps, meetings, emails, documents] = await Promise.all([
    prisma.call.updateMany({ where: { leadId: { not: null } }, data: { leadId: null } }),
    prisma.followUp.updateMany({ where: { leadId: { not: null } }, data: { leadId: null } }),
    prisma.meeting.updateMany({ where: { leadId: { not: null } }, data: { leadId: null } }),
    prisma.email.updateMany({ where: { leadId: { not: null } }, data: { leadId: null } }),
    prisma.document.updateMany({ where: { leadId: { not: null } }, data: { leadId: null } }),
  ]);
  console.log(`  Cleared leadId from: ${calls.count} call(s), ${followUps.count} follow-up(s), ${meetings.count} meeting(s), ${emails.count} email(s), ${documents.count} document(s)`);

  // 4. Delete all leads
  const deletedLeads = await prisma.lead.deleteMany({});
  console.log(`  Deleted ${deletedLeads.count} lead(s)`);

  if (clearRequests) {
    const deletedComments = await prisma.leadRequestComment.deleteMany({});
    const deletedReqs = await prisma.leadRequest.deleteMany({});
    console.log(`  Deleted ${deletedComments.count} lead request comment(s), ${deletedReqs.count} lead request(s)`);
  }

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
