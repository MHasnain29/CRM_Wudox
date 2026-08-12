/**
 * Seed dummy offboarding test data for Emily Johnson (associate1@nastaffing.com)
 * Run: node backend/prisma/seed-emily-test.js
 */
const { PrismaClient } = require('../node_modules/@prisma/client');
const prisma = new PrismaClient();

const EMILY_ID = 'ce158add-c9c6-4019-ad71-6166f71ab3b1';
const EMILY_SUB_COMPANY_ID = '4362576b-7003-4e6f-9e56-4cef9c214fa6';

async function main() {
  console.log('Seeding Emily Johnson test data...\n');

  // ── 1. Create 3 Won Clients (ownershipType = associate, ownershipUserId = Emily) ──
  const clientData = [
    { name: 'Maple Tech Solutions', industry: 'Technology', location: 'Toronto, ON', corporateCode: 'MTS-TEST-001' },
    { name: 'Northern Builders Inc', industry: 'Construction', location: 'Toronto, ON', corporateCode: 'NBI-TEST-002' },
    { name: 'Sunrise Healthcare', industry: 'Healthcare', location: 'Mississauga, ON', corporateCode: 'SHC-TEST-003' },
  ];

  const clients = [];
  for (const cd of clientData) {
    const existing = await prisma.client.findUnique({ where: { corporateCode: cd.corporateCode } });
    if (existing) {
      console.log(`  Client already exists: ${cd.name}`);
      clients.push(existing);
      continue;
    }
    const client = await prisma.client.create({
      data: {
        name: cd.name,
        industry: cd.industry,
        location: cd.location,
        corporateCode: cd.corporateCode,
        status: 'active',
        ownershipType: 'associate',
        ownershipUserId: EMILY_ID,
        visibility: 'agency',
        clientSubCompanies: {
          create: {
            subCompanyId: EMILY_SUB_COMPANY_ID,
            status: 'active',
          },
        },
      },
    });
    console.log(`  Created client: ${client.name} (${client.id})`);
    clients.push(client);
  }

  // ── 2. Create 2 Pipeline Leads (status = open/active) ──
  const pipelineLeads = [
    { clientIdx: 0, stage: 'Discovery', status: 'open', value: 45000 },
    { clientIdx: 1, stage: 'Proposal Sent', status: 'active', value: 120000 },
  ];

  for (const pl of pipelineLeads) {
    const existing = await prisma.lead.findFirst({
      where: { clientId: clients[pl.clientIdx].id, ownerId: EMILY_ID, stage: pl.stage, status: pl.status },
    });
    if (existing) { console.log(`  Pipeline lead already exists: ${clients[pl.clientIdx].name} - ${pl.stage}`); continue; }
    const lead = await prisma.lead.create({
      data: {
        clientId: clients[pl.clientIdx].id,
        ownerId: EMILY_ID,
        subCompanyId: EMILY_SUB_COMPANY_ID,
        stage: pl.stage,
        status: pl.status,
        value: pl.value,
        temperature: 'warm',
        notes: `Test pipeline lead for ${clients[pl.clientIdx].name} - offboarding test data`,
      },
    });
    console.log(`  Created pipeline lead: ${clients[pl.clientIdx].name} [${pl.status}] (${lead.id})`);
  }

  // ── 3. Create 2 Leads (status = closed_won / closed_lost) ──
  const closedLeads = [
    { clientIdx: 2, stage: 'Closed', status: 'closed_won', value: 85000 },
    { clientIdx: 0, stage: 'Closed', status: 'closed_lost', value: 30000 },
  ];

  for (const cl of closedLeads) {
    const existing = await prisma.lead.findFirst({
      where: { clientId: clients[cl.clientIdx].id, ownerId: EMILY_ID, status: cl.status },
    });
    if (existing) { console.log(`  Closed lead already exists: ${clients[cl.clientIdx].name} - ${cl.status}`); continue; }
    const lead = await prisma.lead.create({
      data: {
        clientId: clients[cl.clientIdx].id,
        ownerId: EMILY_ID,
        subCompanyId: EMILY_SUB_COMPANY_ID,
        stage: cl.stage,
        status: cl.status,
        value: cl.value,
        temperature: 'cold',
        notes: `Test closed lead for ${clients[cl.clientIdx].name} - offboarding test data`,
        closedAt: new Date(),
      },
    });
    console.log(`  Created closed lead: ${clients[cl.clientIdx].name} [${cl.status}] (${lead.id})`);
  }

  // ── 4. Create 3 Tasks ──
  const taskItems = [
    { title: 'Send Q3 proposal to Maple Tech', priority: 'high', daysFromNow: 3 },
    { title: 'Follow up on Northern Builders contract review', priority: 'medium', daysFromNow: 7 },
    { title: 'Prepare onboarding docs for Sunrise Healthcare', priority: 'urgent', daysFromNow: 1 },
  ];

  for (const ti of taskItems) {
    const existing = await prisma.task.findFirst({ where: { title: ti.title, ownerId: EMILY_ID } });
    if (existing) { console.log(`  Task already exists: ${ti.title}`); continue; }
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + ti.daysFromNow);
    const task = await prisma.task.create({
      data: {
        title: ti.title,
        ownerId: EMILY_ID,
        assignedById: EMILY_ID,
        subCompanyId: EMILY_SUB_COMPANY_ID,
        priority: ti.priority,
        status: 'to_do',
        dueDate,
        description: `Test task - offboarding test data`,
      },
    });
    console.log(`  Created task: ${task.title} (${task.id})`);
  }

  // ── 5. Create 2 Meetings ──
  const meetingItems = [
    { clientIdx: 0, title: 'Kickoff Call - Maple Tech Solutions', daysFromNow: 2 },
    { clientIdx: 2, title: 'Contract Review - Sunrise Healthcare', daysFromNow: 5 },
  ];

  for (const mi of meetingItems) {
    const existing = await prisma.meeting.findFirst({ where: { title: mi.title, ownerId: EMILY_ID } });
    if (existing) { console.log(`  Meeting already exists: ${mi.title}`); continue; }
    const startTime = new Date();
    startTime.setDate(startTime.getDate() + mi.daysFromNow);
    startTime.setHours(10, 0, 0, 0);
    const endTime = new Date(startTime);
    endTime.setHours(11, 0, 0, 0);
    const meeting = await prisma.meeting.create({
      data: {
        title: mi.title,
        clientId: clients[mi.clientIdx].id,
        ownerId: EMILY_ID,
        subCompanyId: EMILY_SUB_COMPANY_ID,
        startTime,
        endTime,
        status: 'scheduled',
        agenda: 'Test meeting - offboarding test data',
      },
    });
    console.log(`  Created meeting: ${meeting.title} (${meeting.id})`);
  }

  // ── 6. Create 3 Follow-Ups ──
  const followUpItems = [
    { clientIdx: 0, notes: 'Check if they reviewed the proposal and gather feedback', daysFromNow: 2 },
    { clientIdx: 1, notes: 'Confirm site visit appointment and send confirmation email', daysFromNow: 4 },
    { clientIdx: 2, notes: 'Share updated pricing sheet and ask about timeline', daysFromNow: 6 },
  ];

  for (const fi of followUpItems) {
    const existing = await prisma.followUp.findFirst({
      where: { clientId: clients[fi.clientIdx].id, ownerId: EMILY_ID, completed: false },
    });
    if (existing) { console.log(`  Follow-up already exists for: ${clients[fi.clientIdx].name}`); continue; }
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + fi.daysFromNow);
    const fu = await prisma.followUp.create({
      data: {
        clientId: clients[fi.clientIdx].id,
        ownerId: EMILY_ID,
        subCompanyId: EMILY_SUB_COMPANY_ID,
        notes: fi.notes,
        dueDate,
        completed: false,
      },
    });
    console.log(`  Created follow-up: ${clients[fi.clientIdx].name} (${fu.id})`);
  }

  // ── 7. Create Emails: 10 inbox + 20 sent + 30 drafts ──
  const inboxSubjects = [
    'Re: Q3 staffing requirements for Maple Tech',
    'Meeting confirmed - Sunrise Healthcare onboarding',
    'Contract terms review - Northern Builders',
    'Follow-up on your proposal submission',
    'New placement request from Maple Tech Solutions',
    'Interview feedback - Senior Developer role',
    'Urgent: Candidate availability for next week',
    'Re: Background check status update',
    'Invoice query - services rendered October',
    'Re: Job description update needed',
  ];
  const sentSubjects = [
    'Proposal for Q4 staffing - Maple Tech Solutions',
    'Introduction: Our recruitment services',
    'Candidate profiles for Senior Developer role',
    'Follow-up: Contract renewal discussion',
    'Meeting request - Northern Builders',
    'Updated job descriptions for review',
    'Reference check completion notice',
    'Placement confirmation - Sarah Mitchell',
    'Invoice #1042 for staffing services',
    'Thank you for meeting with us today',
    'Candidate shortlist - Project Manager role',
    'Re: Onboarding timeline for new hire',
    'Staffing report - Week of June 9',
    'Interview schedule for Tuesday',
    'Proposal revision per your feedback',
    'Skills assessment results attached',
    'New candidate recommendation',
    'Re: Service agreement renewal',
    'Follow-up: Pending approvals',
    'Monthly performance summary',
  ];
  const draftSubjects = Array.from({ length: 30 }, (_, i) => `[DRAFT] ${[
    'Proposal for additional headcount',
    'Introduction to our executive search service',
    'Candidate update for ongoing search',
    'Monthly billing summary',
    'Job posting for QA Engineer role',
    'Follow-up on pending contract',
    'Interview availability request',
    'Talent pipeline update',
    'New hire onboarding checklist',
    'Reference verification request',
  ][i % 10]} ${i + 1}`);

  const senderNames = ['James Carter', 'Lisa Wong', 'David Smith', 'Priya Patel', 'Ahmed Hassan'];
  const senderEmails = ['james@client.com', 'lisa@client.com', 'david@client.com', 'priya@client.com', 'ahmed@client.com'];

  // Count existing emails to avoid duplicates
  const existingEmailCount = await prisma.email.count({
    where: { OR: [{ fromUserId: EMILY_ID }, { toUserId: EMILY_ID }], subject: { contains: 'Maple Tech' } },
  });

  if (existingEmailCount > 0) {
    console.log('  Emails already seeded, skipping.');
  } else {
    // Inbox: toUserId = Emily, folder = inbox
    for (let i = 0; i < 10; i++) {
      const ts = new Date();
      ts.setDate(ts.getDate() - (i + 1));
      await prisma.email.create({
        data: {
          toUserId: EMILY_ID,
          fromName: senderNames[i % senderNames.length],
          fromEmail: senderEmails[i % senderEmails.length],
          subject: inboxSubjects[i],
          body: `Hi Emily,\n\n${inboxSubjects[i]}.\n\nPlease review and respond at your earliest convenience.\n\nBest regards,\n${senderNames[i % senderNames.length]}`,
          folder: 'inbox',
          subCompanyId: EMILY_SUB_COMPANY_ID,
          isRead: i % 3 !== 0,
          timestamp: ts,
        },
      });
    }
    console.log('  Created 10 inbox emails');

    const attachmentTemplates = [
      { filename: 'Proposal_Q4_2026.pdf', mimeType: 'application/pdf', size: 245760 },
      { filename: 'Candidate_Profiles.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 102400 },
      { filename: 'Staffing_Report_June.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 87040 },
      { filename: 'Contract_Draft_v2.pdf', mimeType: 'application/pdf', size: 312320 },
      { filename: 'Interview_Schedule.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 51200 },
    ];

    // Sent: fromUserId = Emily, folder = sent — every email gets 1–2 attachments
    for (let i = 0; i < 20; i++) {
      const ts = new Date();
      ts.setDate(ts.getDate() - (i + 1));
      const attachCount = (i % 3 === 0) ? 2 : 1;
      const attachments = Array.from({ length: attachCount }, (_, a) => {
        const tpl = attachmentTemplates[(i + a) % attachmentTemplates.length];
        return {
          filename: tpl.filename,
          fileKey: `seed/emily/sent/${i}_${a}_${tpl.filename}`,
          mimeType: tpl.mimeType,
          size: tpl.size,
        };
      });
      await prisma.email.create({
        data: {
          fromUserId: EMILY_ID,
          fromName: 'Emily Johnson',
          fromEmail: 'ramshkhan.2625@gmail.com',
          subject: sentSubjects[i],
          body: `Dear ${senderNames[i % senderNames.length]},\n\n${sentSubjects[i]}.\n\nPlease find the attached document(s) and let me know if you have any questions.\n\nBest,\nEmily Johnson`,
          folder: 'sent',
          subCompanyId: EMILY_SUB_COMPANY_ID,
          isRead: true,
          timestamp: ts,
          attachments: { create: attachments },
        },
      });
    }
    console.log('  Created 20 sent emails (with attachments)');

    // Drafts: fromUserId = Emily, folder = drafts — every 3rd draft has an attachment
    for (let i = 0; i < 30; i++) {
      const ts = new Date();
      ts.setDate(ts.getDate() - (i % 7));
      const hasAttachment = i % 3 === 0;
      const tpl = attachmentTemplates[i % attachmentTemplates.length];
      await prisma.email.create({
        data: {
          fromUserId: EMILY_ID,
          fromName: 'Emily Johnson',
          fromEmail: 'ramshkhan.2625@gmail.com',
          subject: draftSubjects[i],
          body: `Hi,\n\nThis is a draft email about ${draftSubjects[i]}.\n\n[Draft content - not yet sent]`,
          folder: 'drafts',
          subCompanyId: EMILY_SUB_COMPANY_ID,
          isRead: true,
          timestamp: ts,
          ...(hasAttachment && {
            attachments: {
              create: [{
                filename: tpl.filename,
                fileKey: `seed/emily/drafts/${i}_${tpl.filename}`,
                mimeType: tpl.mimeType,
                size: tpl.size,
              }],
            },
          }),
        },
      });
    }
    console.log('  Created 30 draft emails (every 3rd has attachment)');
  }

  console.log('\nDone! Emily Johnson now has:');
  console.log('  3 Won Clients (Maple Tech, Northern Builders, Sunrise Healthcare)');
  console.log('  2 Pipeline leads (open/active)');
  console.log('  2 Closed leads (closed_won / closed_lost)');
  console.log('  3 Tasks (to_do)');
  console.log('  2 Meetings (scheduled)');
  console.log('  3 Follow-ups (pending)');
  console.log('  10 Inbox + 20 Sent + 30 Draft emails');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
