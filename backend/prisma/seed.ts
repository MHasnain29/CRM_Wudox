import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { getSeedLoginPassword, seedUsers, seedWorkflowDemos } from './seedDemoData';

const prisma = new PrismaClient();

/** Parse a CSV line respecting quoted fields (e.g. "a, b", c) */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      const end = line.indexOf('"', i);
      const value = end === -1 ? line.slice(i) : line.slice(i, end);
      result.push(value.trim());
      i = end === -1 ? line.length : end + 1;
      if (line[i] === ',') i++;
    } else {
      const end = line.indexOf(',', i);
      const value = end === -1 ? line.slice(i) : line.slice(i, end);
      result.push(value.trim());
      i = end === -1 ? line.length : end + 1;
    }
  }
  return result;
}

/** Parse full address string to extract region and postal (e.g. "... Brampton, ON L6S 6C6, Canada") */
function parseAddressParts(fullAddress: string, cityColumn: string): { street: string; city: string; region: string; postalCode: string } {
  const parts = fullAddress.split(',').map((s) => s.trim());
  const street = parts[0] || fullAddress;
  const city = cityColumn || (parts[1] ?? '');
  const lastPart = parts[parts.length - 2] ?? '';
  const sp = lastPart.split(/\s+/).filter(Boolean);
  const region = sp[0] ?? '';
  const postalCode = sp.slice(1).join(' ') ?? '';
  return { street, city, region, postalCode };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const seedNow = new Date('2026-05-26T12:00:00.000Z');

function daysFromSeed(days: number, hour = 10): Date {
  const date = new Date(seedNow.getTime() + days * DAY_MS);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

function displayUserName(user: { firstName: string; lastName: string }): string {
  return `${user.firstName} ${user.lastName}`.trim();
}

type SeedClient = Awaited<ReturnType<typeof prisma.client.create>>;

async function main() {
  console.log('🌱 Starting database seed...');

  // Clear existing data
  console.log('🧹 Cleaning existing data...');
  await prisma.$executeRawUnsafe(`
    DO $$ DECLARE
      r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$;
  `);

  // Create Sub Company (single-agency demo)
  console.log('📦 Creating sub company...');
  const subCompany = await prisma.subCompany.create({
    data: {
      name: 'Wudox - Mississauga',
      appProjectName: 'Wudox CRM',
      logoUrl: 'https://wudox.ca/favicon.ico',
      agencyEmail: 'mississauga@wudox.ca',
      agencyPhone: '+1-905-555-1000',
      emailFooterText: 'Wudox Mississauga Office',
      emailTagline: 'Custom software across the GTA',
      emailFromAddress: 'mississauga@wudox.ca',
      emailFromName: 'Wudox Mississauga',
      emailSendAsDomain: 'wudox.ca',
      mainOrgId: 'main-org-001',
    },
  });

  // Create Locations
  console.log('📍 Creating locations...');
  const locationToronto = await prisma.location.create({
    data: {
      name: 'Toronto Office',
      address: '123 Main St, Toronto, ON',
      country: 'Canada',
      isActive: true,
    },
  });

  const locationPakistan = await prisma.location.create({
    data: {
      name: 'Lahore Office',
      address: '789 Business Park, Lahore',
      country: 'Pakistan',
      isActive: true,
    },
  });

  console.log('👥 Creating users...');
  const {
    director,
    salesManager1,
    salesAssociate1,
    salesAssociate2,
    recruiter1,
    pakistanUser,
    recruitmentManager,
    srRecruiter,
    databaseManager,
    allSeedUsers,
  } = await seedUsers(prisma, {
    subCompanyId: subCompany.id,
    locationTorontoId: locationToronto.id,
    locationPakistanId: locationPakistan.id,
  });

  // Create Pipeline Stages
  console.log('🎯 Creating pipeline stages...');
  const pipelineStages = [
    { id: 'new_lead', label: 'New Lead', color: '#06b6d4', orderIndex: 0, isFixed: false },
    { id: 'contact_made', label: 'Contact Made', color: '#3b82f6', orderIndex: 1, isFixed: false },
    { id: 'meeting_scheduled', label: 'Meeting Scheduled', color: '#8b5cf6', orderIndex: 2, isFixed: false },
    { id: 'qualified', label: 'Qualified', color: '#f59e0b', orderIndex: 3, isFixed: false },
    { id: 'proposal_sent', label: 'Proposal Sent', color: '#ec4899', orderIndex: 4, isFixed: false },
    { id: 'negotiation', label: 'Negotiation', color: '#f97316', orderIndex: 5, isFixed: false },
    { id: 'awaiting_client_approval', label: 'Awaiting Client Approval', color: '#f97316', orderIndex: 6, isFixed: false },
    { id: 'closed_won', label: 'Closed Won', color: '#10b981', orderIndex: 7, isFixed: true },
    { id: 'closed_lost', label: 'Closed Lost', color: '#ef4444', orderIndex: 8, isFixed: true },
  ];

  for (const stage of pipelineStages) {
    await prisma.pipelineStage.create({
      data: stage,
    });
  }

  // Create default email templates (global: subCompanyId null) — professional HTML templates
  console.log('📧 Creating default email templates...');
  const emailWrap = (body: string) => `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
${body}
</table>
</td></tr>
</table>
</body>
</html>`;

  const emailHeader = (title: string, subtitle?: string) =>
    `<tr><td style="background:#1e40af;padding:24px 32px;">
  <h1 style="margin:0;color:#fff;font-size:20px;font-weight:600;">${title}</h1>
  ${subtitle ? `<p style="margin:4px 0 0;color:#93c5fd;font-size:13px;">${subtitle}</p>` : ''}
</td></tr>`;

  const emailFooter = (text = '{{agency_footer}}') =>
    `<tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
  <p style="margin:0;color:#94a3b8;font-size:11px;text-align:center;">${text}</p>
</td></tr>`;

  const emailCta = (label: string) =>
    `<table cellpadding="0" cellspacing="0"><tr><td style="background:#1e40af;border-radius:6px;padding:12px 28px;">
  <a href="#" style="color:#fff;text-decoration:none;font-size:14px;font-weight:600;">${label}</a>
</td></tr></table>`;

  // emailSignature is intentionally removed — the "Best regards, [name]" footer is
  // now auto-appended by the send path for every outbound email.
  const emailSignature = '';

  const defaultTemplates = [
    {
      name: 'Introduction',
      subject: 'Staffing solutions for {{company_name}}',
      headerHtml: null,
      footerHtml: null,
      bodyHtml: emailWrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#3b82f6);padding:40px 32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:28px;font-weight:700;">Wudox</h1>
  <p style="margin:8px 0 0;color:#bfdbfe;font-size:15px;">Your Trusted Staffing Partner</p>
</td></tr>
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hello {{contact_name}},</h2>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">My name is {{sender_name}} from <strong>Wudox</strong>. I'm reaching out because we help companies like <strong>{{company_name}}</strong> find exceptional talent quickly and efficiently.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr>
    <td width="33%" style="padding:12px;text-align:center;background:#eff6ff;border-radius:8px 0 0 8px;">
      <p style="margin:0;font-size:24px;font-weight:700;color:#1e40af;">500+</p>
      <p style="margin:4px 0 0;font-size:11px;color:#64748b;">Placements</p>
    </td>
    <td width="33%" style="padding:12px;text-align:center;background:#eff6ff;">
      <p style="margin:0;font-size:24px;font-weight:700;color:#1e40af;">98%</p>
      <p style="margin:4px 0 0;font-size:11px;color:#64748b;">Retention Rate</p>
    </td>
    <td width="33%" style="padding:12px;text-align:center;background:#eff6ff;border-radius:0 8px 8px 0;">
      <p style="margin:0;font-size:24px;font-weight:700;color:#1e40af;">24hr</p>
      <p style="margin:4px 0 0;font-size:11px;color:#64748b;">Response Time</p>
    </td>
  </tr></table>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">I'd love the opportunity to learn more about your staffing needs. Can we schedule a brief 15-minute call this week?</p>
  <div style="text-align:center;">${emailCta("Let's Connect")}</div>
  ${emailSignature}
</td></tr>
${emailFooter()}`),
    },
    {
      name: 'Follow-up',
      subject: 'Following up on our conversation — {{company_name}}',
      headerHtml: null,
      footerHtml: null,
      bodyHtml: emailWrap(`
${emailHeader('Wudox', 'Software Solutions')}
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hi {{contact_name}},</h2>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">I wanted to follow up on our recent conversation about staffing solutions for <strong>{{company_name}}</strong>.</p>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">At Wudox, we specialize in connecting businesses with top-tier talent. Based on our discussion, I believe we can help you with:</p>
  <ul style="margin:0 0 16px;padding-left:20px;color:#4a4a4a;font-size:14px;line-height:1.9;">
    <li>Temporary and contract staffing</li>
    <li>Direct hire placements</li>
    <li>Workforce management solutions</li>
  </ul>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">I'd love to schedule a follow-up call to discuss your specific needs in more detail.</p>
  ${emailCta('Schedule a Call')}
  ${emailSignature}
</td></tr>
${emailFooter()}`),
    },
    {
      name: 'Thank You',
      subject: 'Thank you for your time — {{sender_name}}',
      headerHtml: null,
      footerHtml: null,
      bodyHtml: emailWrap(`
${emailHeader('Wudox', 'Software Solutions')}
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Thank you, {{contact_name}}!</h2>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">I truly appreciate you taking the time to meet with me today. It was great learning more about <strong>{{company_name}}</strong> and your current staffing needs.</p>
  <div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:16px 20px;border-radius:0 8px 8px 0;margin:0 0 16px;">
    <p style="margin:0;color:#15803d;font-size:14px;font-weight:600;">Key Takeaways</p>
    <ul style="margin:8px 0 0;padding-left:16px;color:#4a4a4a;font-size:13px;line-height:1.8;">
      <li>Your priority is filling [role/position] by [timeline]</li>
      <li>You're looking for candidates with [specific skills]</li>
      <li>Budget range discussed for this engagement</li>
    </ul>
  </div>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">I'll be sending over a detailed proposal within the next 48 hours. In the meantime, don't hesitate to reach out with any questions.</p>
  ${emailCta('View Our Services')}
  ${emailSignature}
</td></tr>
${emailFooter()}`),
    },
    {
      name: 'Meeting Confirmation',
      subject: 'Meeting confirmed — {{contact_name}}',
      headerHtml: null,
      footerHtml: null,
      bodyHtml: emailWrap(`
${emailHeader('Wudox')}
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 8px;color:#1a1a1a;font-size:18px;">Meeting Confirmed</h2>
  <p style="margin:0 0 24px;color:#71717a;font-size:13px;">Hi {{contact_name}}, your meeting has been scheduled.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
    <tr><td style="padding:20px 24px;border-bottom:1px solid #e2e8f0;">
      <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Date &amp; Time</p>
      <p style="margin:0;font-size:16px;font-weight:600;color:#1a1a1a;">{{date}} at 2:00 PM EST</p>
    </td></tr>
    <tr><td style="padding:20px 24px;border-bottom:1px solid #e2e8f0;">
      <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Location</p>
      <p style="margin:0;font-size:14px;color:#1a1a1a;">Video Call (link will be sent separately)</p>
    </td></tr>
    <tr><td style="padding:20px 24px;">
      <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Attendees</p>
      <p style="margin:0;font-size:14px;color:#1a1a1a;">{{sender_name}} (Wudox) &amp; {{contact_name}} ({{company_name}})</p>
    </td></tr>
  </table>
  <p style="margin:24px 0 0;color:#4a4a4a;font-size:14px;line-height:1.7;">If you need to reschedule, please let me know at least 24 hours in advance.</p>
</td></tr>
${emailFooter()}`),
    },
    {
      name: 'Proposal Delivery',
      subject: 'Your staffing proposal is ready — {{company_name}}',
      headerHtml: null,
      footerHtml: null,
      bodyHtml: emailWrap(`
<tr><td style="background:linear-gradient(135deg,#0f172a,#1e3a5f);padding:40px 32px;text-align:center;">
  <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:2px;">Staffing Proposal</p>
  <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;">Prepared for {{company_name}}</h1>
  <p style="margin:8px 0 0;color:#64748b;font-size:13px;">{{date}}</p>
</td></tr>
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Dear {{contact_name}},</h2>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">Thank you for the opportunity to present our staffing solutions. Based on our discussions, we've prepared a comprehensive proposal tailored to your needs.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td width="50%" style="padding:16px;background:#eff6ff;border-radius:8px 0 0 8px;text-align:center;">
        <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;">Positions</p>
        <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:#1e40af;">5-10</p>
      </td>
      <td width="50%" style="padding:16px;background:#eff6ff;border-radius:0 8px 8px 0;text-align:center;">
        <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;">Timeline</p>
        <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:#1e40af;">2 Weeks</p>
      </td>
    </tr>
  </table>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">Please find the detailed proposal attached. I'm available to discuss any questions at your convenience.</p>
  ${emailCta('View Full Proposal')}
</td></tr>
${emailFooter('{{agency_footer}} · This proposal is confidential and intended solely for {{company_name}}')}`),
    },
    {
      name: 'Welcome / Onboarding',
      subject: "Welcome to Wudox — Let's get started!",
      headerHtml: null,
      footerHtml: null,
      bodyHtml: emailWrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#3b82f6);padding:40px 32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:28px;font-weight:700;">Welcome to Wudox!</h1>
  <p style="margin:8px 0 0;color:#bfdbfe;font-size:15px;">We're excited to partner with you</p>
</td></tr>
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hi {{contact_name}},</h2>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">Welcome aboard! We're thrilled to have <strong>{{company_name}}</strong> as a new client. Here's what happens next:</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
    <tr><td style="padding:12px 16px;border-left:3px solid #3b82f6;background:#eff6ff;border-radius:0 8px 8px 0;margin-bottom:8px;">
      <p style="margin:0;color:#1e40af;font-size:13px;font-weight:600;">Step 1 — Discovery Call</p>
      <p style="margin:4px 0 0;color:#4a4a4a;font-size:13px;">We'll schedule a call to understand your staffing needs in detail.</p>
    </td></tr>
    <tr><td style="padding:4px;"></td></tr>
    <tr><td style="padding:12px 16px;border-left:3px solid #3b82f6;background:#eff6ff;border-radius:0 8px 8px 0;">
      <p style="margin:0;color:#1e40af;font-size:13px;font-weight:600;">Step 2 — Talent Search</p>
      <p style="margin:4px 0 0;color:#4a4a4a;font-size:13px;">Our team will source and screen candidates matching your requirements.</p>
    </td></tr>
    <tr><td style="padding:4px;"></td></tr>
    <tr><td style="padding:12px 16px;border-left:3px solid #3b82f6;background:#eff6ff;border-radius:0 8px 8px 0;">
      <p style="margin:0;color:#1e40af;font-size:13px;font-weight:600;">Step 3 — Candidate Presentation</p>
      <p style="margin:4px 0 0;color:#4a4a4a;font-size:13px;">We'll present top candidates with detailed profiles for your review.</p>
    </td></tr>
    <tr><td style="padding:4px;"></td></tr>
    <tr><td style="padding:12px 16px;border-left:3px solid #16a34a;background:#f0fdf4;border-radius:0 8px 8px 0;">
      <p style="margin:0;color:#15803d;font-size:13px;font-weight:600;">Step 4 — Placement &amp; Support</p>
      <p style="margin:4px 0 0;color:#4a4a4a;font-size:13px;">Once you select a candidate, we handle onboarding and provide ongoing support.</p>
    </td></tr>
  </table>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">I'll be your dedicated point of contact throughout the process. Let's schedule that first call!</p>
  <div style="text-align:center;">${emailCta('Book Discovery Call')}</div>
  ${emailSignature}
</td></tr>
${emailFooter()}`),
    },
    {
      name: 'Check-in',
      subject: "Checking in — How's everything going, {{contact_name}}?",
      headerHtml: null,
      footerHtml: null,
      bodyHtml: emailWrap(`
${emailHeader('Wudox', 'Software Solutions')}
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hi {{contact_name}},</h2>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">I hope everything is going well at <strong>{{company_name}}</strong>. I wanted to check in and see how things are going with your current team members we placed.</p>
  <div style="background:#f8fafc;border-radius:8px;padding:20px;margin:0 0 16px;">
    <p style="margin:0 0 8px;color:#1a1a1a;font-size:14px;font-weight:600;">A few things I'd love to hear about:</p>
    <ul style="margin:0;padding-left:16px;color:#4a4a4a;font-size:13px;line-height:1.9;">
      <li>How are the placed candidates performing?</li>
      <li>Are there any additional roles you're looking to fill?</li>
      <li>Any feedback on our service we can improve on?</li>
    </ul>
  </div>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">Your satisfaction is our top priority. Feel free to reply to this email or schedule a quick call.</p>
  ${emailCta('Schedule a Quick Call')}
  ${emailSignature}
</td></tr>
${emailFooter()}`),
    },
    {
      name: 'Candidate Introduction',
      subject: 'Candidate profile for {{company_name}} — Wudox',
      headerHtml: null,
      footerHtml: null,
      bodyHtml: emailWrap(`
${emailHeader('Wudox', 'Candidate Presentation')}
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hi {{contact_name}},</h2>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">I'm excited to present a strong candidate for the open position at <strong>{{company_name}}</strong>.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:24px;">
    <tr><td style="padding:20px 24px;background:#1e40af;">
      <p style="margin:0;font-size:16px;font-weight:600;color:#fff;">Candidate Profile</p>
    </td></tr>
    <tr><td style="padding:20px 24px;border-bottom:1px solid #e2e8f0;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="120" style="color:#94a3b8;font-size:13px;padding:4px 0;">Name:</td>
          <td style="color:#1a1a1a;font-size:13px;font-weight:600;padding:4px 0;">[Candidate Name]</td>
        </tr>
        <tr>
          <td style="color:#94a3b8;font-size:13px;padding:4px 0;">Experience:</td>
          <td style="color:#1a1a1a;font-size:13px;padding:4px 0;">[X] years in [field]</td>
        </tr>
        <tr>
          <td style="color:#94a3b8;font-size:13px;padding:4px 0;">Key Skills:</td>
          <td style="color:#1a1a1a;font-size:13px;padding:4px 0;">[Skill 1], [Skill 2], [Skill 3]</td>
        </tr>
        <tr>
          <td style="color:#94a3b8;font-size:13px;padding:4px 0;">Availability:</td>
          <td style="color:#1a1a1a;font-size:13px;padding:4px 0;">Immediate / [Date]</td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="padding:16px 24px;">
      <p style="margin:0;color:#4a4a4a;font-size:13px;line-height:1.6;"><strong>Summary:</strong> [Brief candidate summary highlighting relevant experience and qualifications for the role.]</p>
    </td></tr>
  </table>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">I believe this candidate would be an excellent fit for your team. Would you like to schedule an interview?</p>
  ${emailCta('Schedule Interview')}
  ${emailSignature}
</td></tr>
${emailFooter()}`),
    },
  ];
  for (const t of defaultTemplates) {
    await prisma.emailTemplate.create({
      data: {
        subCompanyId: null,
        name: t.name,
        subject: t.subject,
        bodyHtml: t.bodyHtml,
        headerHtml: t.headerHtml,
        footerHtml: t.footerHtml,
      },
    });
  }

  const agencyEmailTemplates = new Map<string, Awaited<ReturnType<typeof prisma.emailTemplate.create>>>();
  {
    const agency = { subCompany, label: 'Mississauga', color: '#1e40af' };
    const template = await prisma.emailTemplate.create({
      data: {
        subCompanyId: agency.subCompany.id,
        name: `${agency.label} Local Outreach`,
        subject: `${agency.label} staffing support for {{company_name}}`,
        headerHtml: null,
        footerHtml: null,
        bodyHtml: emailWrap(`
<tr><td style="background:${agency.color};padding:28px 32px;">
  <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">Wudox ${agency.label}</h1>
</td></tr>
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hi {{contact_name}},</h2>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">Our ${agency.label} team is ready to support <strong>{{company_name}}</strong> with local staffing coverage and quick turnaround.</p>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">Would you be open to a short conversation this week?</p>
  ${emailCta('Book a Local Call')}
</td></tr>
${emailFooter()}`),
      },
    });
    agencyEmailTemplates.set(agency.subCompany.id, template);
  }

  // Create Clients from Sample Data -- CRM.csv (ID = corporateCode; Concerned Person = contact name, Designation = title, Phone, Extension, Email, Linkedin Profile, Website; first contact primary; no tags)
  console.log('🏢 Creating clients from CRM sample data...');
  const possibleCsvPaths = [
    path.join(__dirname, '..', '..', 'Sample Data -- CRM.csv'),
    path.join(process.cwd(), 'Sample Data -- CRM.csv'),
    path.join(process.cwd(), '..', 'Sample Data -- CRM.csv'),
  ];
  let csvContent: string = '';
  for (const csvPath of possibleCsvPaths) {
    try {
      csvContent = fs.readFileSync(csvPath, 'utf-8');
      console.log('   Using CSV at:', csvPath);
      break;
    } catch {
      continue;
    }
  }
  if (!csvContent) {
    console.warn('⚠️ Sample Data -- CRM.csv not found at any of:', possibleCsvPaths.map((p) => path.resolve(p)).join(', '));
  }

  const createdClients: SeedClient[] = [];
  const subCompanyId = subCompany.id;
  const statuses = ['contacted', 'active', 'lost', 'ex'] as const;

  const rememberClient = (client: SeedClient) => {
    createdClients.push(client);
  };

  if (csvContent) {
    const lines = csvContent.split(/\r?\n/).filter((l) => l.trim());
    const header = parseCsvLine(lines[0]);
    const col = (name: string) => {
      const i = header.indexOf(name);
      return i >= 0 ? i : -1;
    };
    const idx = {
      sr: col('Sr #'),
      id: col('ID'),
      industry: col('Industry'),
      companyName: col('Company Name'),
      concernedPerson: col('Concerned Person'),
      designation: col('Designation'),
      phone: col('Phone'),
      extension: col('Extension'),
      email: col('Email'),
      linkedin: col('Linkedin Profile'),
      address: col('Address'),
      city: col('City'),
      website: col('Website'),
    };
    if (idx.id < 0 || idx.companyName < 0) {
      console.warn('⚠️ CSV missing ID or Company Name column, skipping client seed');
    } else {
      const rows = lines.slice(1).map((line) => parseCsvLine(line));
      const byId = new Map<string, typeof rows>();
      for (const row of rows) {
        const id = row[idx.id]?.trim();
        if (!id) continue;
        if (!byId.has(id)) byId.set(id, []);
        byId.get(id)!.push(row);
      }

      for (const [clientIndex, [corporateCode, groupRows]] of Array.from(byId.entries()).entries()) {
        const first = groupRows[0];
        const companyName = (first[idx.companyName] ?? '').trim() || corporateCode;
        const industry = (first[idx.industry] ?? '').trim() || null;
        const city = (first[idx.city] ?? '').trim();
        const fullAddress = (first[idx.address] ?? '').trim();
        const { street, region, postalCode } = parseAddressParts(fullAddress, city);
        const locationSummary = city && region ? `${city}, ${region}` : city || region || null;
        const isGlobal = clientIndex % 3 === 0;

        const client = await prisma.client.create({
          data: {
            corporateCode,
            name: companyName,
            industry,
            location: locationSummary,
            address: fullAddress || null,
            companySize: null,
            status: 'contacted',
            lastActivity: new Date(),
            visibility: isGlobal ? 'global' : 'agency',
            createdByRole: isGlobal ? 'director' : 'sales_associate',
            contacts: {
              create: groupRows.map((row, i) => ({
                name: (row[idx.concernedPerson] ?? '').trim() || 'Unknown',
                title: (row[idx.designation] ?? '').trim() || null,
                email: (row[idx.email] ?? '').trim() || null,
                phone: (row[idx.phone] ?? '').trim() || null,
                phoneExtension: (row[idx.extension] ?? '').trim() || null,
                linkedin: (row[idx.linkedin] ?? '').trim() || null,
                website: (row[idx.website] ?? '').trim() || null,
                isPrimary: i === 0,
              })),
            },
            locations: {
              create: [
                {
                  name: city ? `${companyName} - ${city}` : companyName,
                  address: street || fullAddress || null,
                  city: city || null,
                  region: region || null,
                  postalCode: postalCode || null,
                  country: 'Canada',
                  isPrimary: true,
                },
              ],
            },
          },
        });
        rememberClient(client);

        await prisma.clientSubCompany.create({
          data: {
            clientId: client.id,
            subCompanyId,
            status: statuses[clientIndex % statuses.length],
            lastActivity: daysFromSeed(-(clientIndex % 15)),
          },
        });
      }
      console.log(`   Created ${createdClients.length} clients from CSV for Wudox - Mississauga.`);
    }
  }

  if (createdClients.length === 0) {
    console.warn('⚠️ No clients created; creating one placeholder for leads/calls.');
    const placeholder = await prisma.client.create({
      data: {
        corporateCode: 'SEED_PLACEHOLDER',
        name: 'Placeholder Client',
        industry: 'Other',
        location: 'Toronto, ON',
        address: '123 Seed St',
        companySize: null,
        status: 'contacted',
        lastActivity: new Date(),
        visibility: 'global',
        createdByRole: 'director',
        contacts: { create: [{ name: 'Placeholder Contact', title: 'HR', email: 'placeholder@example.com', isPrimary: true }] },
      },
    });
    rememberClient(placeholder);
    await prisma.clientSubCompany.create({
      data: { clientId: placeholder.id, subCompanyId, status: 'contacted' },
    });
  }

  // Seed allowed industries from current clients + defaults (per subcompany)
  console.log('🏭 Seeding allowed industries and tags...');
  const distinctIndustries = await prisma.client.findMany({
    distinct: ['industry'],
    select: { industry: true },
    where: { industry: { not: null } },
  });
  const industrySet = new Set<string>(
    distinctIndustries.map((r) => (r.industry ?? '').trim()).filter(Boolean)
  );
  const defaultIndustries = [
    'Technology',
    'Healthcare',
    'Finance',
    'Manufacturing',
    'Retail',
    'Construction',
    'Food & Beverage',
    'Professional Services',
    'Education',
    'Other',
  ];
  defaultIndustries.forEach((name) => industrySet.add(name));
  const defaultTags = [
    'High Priority',
    'Follow-up',
    'Hot Lead',
    'Key Account',
    'Prospect',
    'VIP',
    'Decision Maker',
    'Champion',
    'New Lead',
    'Nurture',
    'At Risk',
    'Contract',
    'Temp',
    'Inactive',
    'Closed Won',
    'Do Not Contact',
  ];
  for (const subId of [subCompanyId]) {
    for (const name of industrySet) {
      await prisma.allowedIndustry.upsert({
        where: { subCompanyId_name: { subCompanyId: subId, name } },
        create: { subCompanyId: subId, name },
        update: {},
      });
    }
    for (const tag of defaultTags) {
      await prisma.allowedTag.upsert({
        where: { subCompanyId_tag: { subCompanyId: subId, tag } },
        create: { subCompanyId: subId, tag },
        update: {},
      });
    }
    const distinctTitles = await prisma.clientContact.findMany({
      distinct: ['title'],
      select: { title: true },
      where: { title: { not: null } },
    });
    const jobTitleSet = new Set<string>(
      distinctTitles.map((r) => (r.title ?? '').trim()).filter(Boolean)
    );
    const defaultJobTitles = [
      'CEO',
      'President',
      'Vice President',
      'Director',
      'Manager',
      'HR Manager',
      'HR Director',
      'Operations Manager',
      'Recruiter',
      'Other',
    ];
    defaultJobTitles.forEach((name) => jobTitleSet.add(name));
    for (const jobTitle of jobTitleSet) {
      await prisma.allowedJobTitle.upsert({
        where: { subCompanyId_name: { subCompanyId: subId, name: jobTitle } },
        create: { subCompanyId: subId, name: jobTitle },
        update: {},
      });
    }
  }

  // Add sample client tags to first few clients (so tags appear in UI)
  if (createdClients.length > 0) {
    const tagClients = createdClients.slice(0, 6);
    const sampleTagSets = [
      ['High Priority', 'Key Account'],
      ['Hot Lead'],
      ['Follow-up', 'Prospect'],
      ['VIP'],
      ['Nurture'],
      ['At Risk'],
    ];
    for (let clientIndex = 0; clientIndex < tagClients.length; clientIndex++) {
      const c = tagClients[clientIndex];
      const tagNames = sampleTagSets[clientIndex % sampleTagSets.length];
      for (const tag of tagNames) {
        await prisma.clientTag.upsert({
          where: {
            clientId_subCompanyId_tag: { clientId: c.id, subCompanyId, tag },
          },
          create: { clientId: c.id, subCompanyId, tag },
          update: {},
        });
      }
    }
    console.log('   Added agency-specific sample tags.');
  }

  const getPrimaryContactId = async (clientId: string): Promise<string | undefined> => {
    const contact = await prisma.clientContact.findFirst({
      where: { clientId },
      orderBy: { isPrimary: 'desc' },
      select: { id: true },
    });
    return contact?.id;
  };

  const agencyDatasets = [
    {
      key: 'mississauga',
      label: 'Mississauga',
      subCompany,
      manager: salesManager1,
      associates: [salesAssociate1, salesAssociate2],
      recruiter: recruiter1,
      clients: createdClients.slice(0, 14),
      meetingBaseUrl: 'https://meet.wudox.test/mississauga',
    },
  ];

  // Create Leads
  console.log('🎯 Creating leads...');
  const leadPlans = [
    { stage: 'new_lead', status: 'open' as const, temperature: 'warm' as const, value: 18000 },
    { stage: 'contact_made', status: 'open' as const, temperature: 'cold' as const, value: 22000 },
    { stage: 'meeting_scheduled', status: 'open' as const, temperature: 'warm' as const, value: 30000 },
    { stage: 'qualified', status: 'open' as const, temperature: 'hot' as const, value: 50000 },
    { stage: 'proposal_sent', status: 'open' as const, temperature: 'warm' as const, value: 42000 },
    { stage: 'negotiation', status: 'open' as const, temperature: 'hot' as const, value: 75000 },
    { stage: 'awaiting_client_approval', status: 'open' as const, temperature: 'hot' as const, value: 65000 },
    { stage: 'closed_won', status: 'closed_won' as const, temperature: 'hot' as const, value: 90000 },
    { stage: 'closed_lost', status: 'closed_lost' as const, temperature: 'cold' as const, value: 0 },
  ];

  const createdLeads: Awaited<ReturnType<typeof prisma.lead.create>>[] = [];
  const leadsByAgency = new Map<string, Awaited<ReturnType<typeof prisma.lead.create>>[]>();
  for (const agency of agencyDatasets) {
    const agencyClients = agency.clients.length ? agency.clients : createdClients;
    const agencyLeads: Awaited<ReturnType<typeof prisma.lead.create>>[] = [];
    for (let i = 0; i < Math.min(leadPlans.length, agencyClients.length); i++) {
      const plan = leadPlans[i];
      const client = agencyClients[i];
      const owner = agency.associates[i % agency.associates.length];
      const isClosed = plan.status === 'closed_won' || plan.status === 'closed_lost';
      const lead = await prisma.lead.create({
        data: {
          clientId: client.id,
          ownerId: owner.id,
          subCompanyId: agency.subCompany.id,
          stage: plan.stage,
          status: plan.status,
          temperature: plan.temperature,
          value: plan.value,
          lastActivity: daysFromSeed(-i - 1, 14),
          nextFollowUp: isClosed ? null : daysFromSeed(i + 1, 15),
          leadDeadline: isClosed ? null : daysFromSeed(i + 7, 17),
          closedAt: isClosed ? daysFromSeed(-i, 16) : null,
          closedById: isClosed ? agency.manager.id : null,
          lossReason: plan.status === 'closed_lost' ? 'Client selected another vendor' : null,
          notes: `${agency.label} seed lead for ${client.name} in ${plan.stage.replace(/_/g, ' ')}`,
        },
      });
      createdLeads.push(lead);
      agencyLeads.push(lead);
    }
    leadsByAgency.set(agency.subCompany.id, agencyLeads);
  }

  // Create Calls
  console.log('📞 Creating calls...');
  let callCount = 0;
  const outcomes: Array<'answered' | 'no_answer' | 'voicemail' | 'busy'> = ['answered', 'no_answer', 'voicemail', 'busy'];
  for (const agency of agencyDatasets) {
    const agencyLeads = leadsByAgency.get(agency.subCompany.id) ?? [];
    const agencyClients = agency.clients.length ? agency.clients : createdClients;
    for (let i = 0; i < 10; i++) {
      const client = agencyClients[i % agencyClients.length];
      const lead = agencyLeads.find((l) => l.clientId === client.id);
      const owner = i % 3 === 0 ? agency.manager : agency.associates[i % agency.associates.length];
      await prisma.call.create({
        data: {
          clientId: client.id,
          leadId: lead?.id,
          subCompanyId: agency.subCompany.id,
          ownerId: owner.id,
          outcome: outcomes[i % outcomes.length],
          duration: 120 + i * 45,
          notes: `${agency.label} call ${i + 1} for ${client.name}`,
          timestamp: daysFromSeed(-i - 1, 13),
        },
      });
      callCount++;
    }
  }

  // Create Follow-ups
  console.log('📅 Creating follow-ups...');
  let followUpCount = 0;
  for (const agency of agencyDatasets) {
    const agencyLeads = leadsByAgency.get(agency.subCompany.id) ?? [];
    const agencyClients = agency.clients.length ? agency.clients : createdClients;
    for (let i = 0; i < 8; i++) {
      const client = agencyClients[i % agencyClients.length];
      const lead = agencyLeads.find((l) => l.clientId === client.id);
      const owner = agency.associates[i % agency.associates.length];
      const contactId = await getPrimaryContactId(client.id);
      const completed = i % 4 === 0;
      await prisma.followUp.create({
        data: {
          clientId: client.id,
          leadId: lead?.id,
          contactId,
          subCompanyId: agency.subCompany.id,
          ownerId: owner.id,
          dueDate: daysFromSeed(completed ? -i : i + 1, 11),
          notes: `${agency.label} follow-up ${i + 1} for ${client.name}`,
          completed,
          completedAt: completed ? daysFromSeed(-i, 12) : null,
          outcome: completed ? 'next_follow_up' : undefined,
        },
      });
      followUpCount++;
    }
  }

  // Create Tasks
  console.log('✅ Creating tasks...');
  let taskCount = 0;
  const taskTitles = [
    'Prepare staffing proposal',
    'Schedule discovery meeting',
    'Follow up on quote',
    'Review contract terms',
    'Update client profile',
    'Send thank you email',
  ];
  const taskPriorities = ['low', 'medium', 'high', 'urgent'] as const;
  const taskStatuses = ['to_do', 'in_progress', 'done'] as const;
  for (const agency of agencyDatasets) {
    const agencyLeads = leadsByAgency.get(agency.subCompany.id) ?? [];
    const agencyClients = agency.clients.length ? agency.clients : createdClients;
    for (let i = 0; i < 8; i++) {
      const client = agencyClients[i % agencyClients.length];
      const lead = agencyLeads.find((l) => l.clientId === client.id);
      const owner = i % 3 === 0 ? agency.manager : agency.associates[i % agency.associates.length];
      const status = taskStatuses[i % taskStatuses.length];
      await prisma.task.create({
        data: {
          title: `${agency.label}: ${taskTitles[i % taskTitles.length]}`,
          description: `Seed task ${i + 1} for ${client.name}`,
          dueDate: daysFromSeed(i - 2, 10),
          priority: taskPriorities[i % taskPriorities.length],
          status,
          completedAt: status === 'done' ? daysFromSeed(-i, 16) : null,
          ownerId: owner.id,
          assignedById: agency.manager.id,
          subCompanyId: agency.subCompany.id,
          linkType: lead ? 'lead' : 'client',
          linkId: lead?.id || client.id,
        },
      });
      taskCount++;
    }
  }

  // Create Meetings
  console.log('📆 Creating meetings...');
  let meetingCount = 0;
  for (const agency of agencyDatasets) {
    const agencyLeads = leadsByAgency.get(agency.subCompany.id) ?? [];
    const agencyClients = agency.clients.length ? agency.clients : createdClients;
    for (let i = 0; i < 5; i++) {
      const client = agencyClients[i % agencyClients.length];
      const lead = agencyLeads.find((l) => l.clientId === client.id);
      const owner = i % 2 === 0 ? agency.manager : agency.associates[i % agency.associates.length];
      const contactId = await getPrimaryContactId(client.id);
      const startTime = daysFromSeed(i + 2, 15);
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
      await prisma.meeting.create({
        data: {
          clientId: client.id,
          leadId: lead?.id,
          subCompanyId: agency.subCompany.id,
          ownerId: owner.id,
          title: `${agency.label} meeting with ${client.name}`,
          startTime,
          endTime,
          location: i % 2 === 0 ? `${agency.label} Office` : 'Virtual - Zoom',
          meetingLink: `${agency.meetingBaseUrl}/${i + 1}`,
          agenda: `Discuss staffing needs for ${client.name}`,
          status: i === 0 ? 'completed' : 'scheduled',
          notes: i === 0 ? 'Completed seed meeting with next steps captured.' : null,
          ...(contactId ? { attendees: { create: [{ contactId }] } } : {}),
        },
      });
      meetingCount++;
    }
  }

  // Jobs / employees / assignments: seedRecruitmentDemo (after approval policies).
  let jobCount = 0;
  let employeeCount = 0;
  let jobAssignmentCount = 0;
  let employeeAssignmentCount = 0;

  // Create Activity Logs
  console.log('📊 Creating activity logs...');
  let activityLogCount = 0;
  const activityTypes = [
    'call_made',
    'email_sent',
    'task_completed',
    'meeting_scheduled',
    'follow_up_created',
    'pipeline_moved',
    'lead_request',
  ];

  for (const agency of agencyDatasets) {
    const agencyLeads = leadsByAgency.get(agency.subCompany.id) ?? [];
    const agencyClients = agency.clients.length ? agency.clients : createdClients;
    const users = [agency.manager, ...agency.associates];
    for (let i = 0; i < 16; i++) {
      const user = users[i % users.length];
      const client = agencyClients[i % agencyClients.length];
      const lead = agencyLeads.find((l) => l.clientId === client.id);
      await prisma.activityLog.create({
        data: {
          type: activityTypes[i % activityTypes.length],
          userId: user.id,
          userName: displayUserName(user),
          subCompanyId: agency.subCompany.id,
          description: `${agency.label} activity ${i + 1} for ${client.name}`,
          metadata: {
            clientId: client.id,
            clientName: client.name,
            leadId: lead?.id,
          },
          timestamp: daysFromSeed(-i, 9),
        },
      });
      activityLogCount++;
    }
  }

  // Create Client Notes
  console.log('📝 Creating client notes...');
  let clientNoteCount = 0;
  for (const agency of agencyDatasets) {
    const agencyClients = agency.clients.length ? agency.clients : createdClients;
    const noteUsers = [agency.associates[0], agency.manager, director];
    for (let i = 0; i < Math.min(6, agencyClients.length); i++) {
      const client = agencyClients[i];
      const user = noteUsers[i % noteUsers.length];
      const isPublic = user.role === 'director' && client.visibility === 'global';
      await prisma.clientNote.create({
        data: {
          clientId: client.id,
          subCompanyId: agency.subCompany.id,
          userId: user.id,
          userName: displayUserName(user),
          userRole: user.role,
          content: `${agency.label} note for ${client.name}: ${isPublic ? 'public director note' : 'agency-private follow-up details'}.`,
          isPublic,
          isPinned: i === 0,
          createdAt: daysFromSeed(-i, 8),
        },
      });
      clientNoteCount++;
    }
  }

  // Lead requests and reassignment requests are seeded in seedWorkflowDemos (after approval policies).

  // Create proposal settings, mailing lists, and campaigns per agency
  console.log('📨 Creating proposal defaults, mailing lists, and campaigns...');
  let proposalDefaultFileCount = 0;
  let mailingListCount = 0;
  let campaignCount = 0;
  let campaignRecipientCount = 0;

  const recipientForClient = async (client: SeedClient) => {
    const contact = await prisma.clientContact.findFirst({
      where: { clientId: client.id },
      orderBy: { isPrimary: 'desc' },
      select: { name: true, email: true },
    });
    const safeCode = client.corporateCode.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') || 'client';
    return {
      clientId: client.id,
      clientName: client.name,
      email: contact?.email || `${safeCode}@example.test`,
      contactName: contact?.name || client.name,
    };
  };

  for (const agency of agencyDatasets) {
    await prisma.clientVisibilitySetting.create({
      data: {
        subCompanyId: agency.subCompany.id,
        days: 7,
      },
    });
    await prisma.proposalDefaultSetting.create({
      data: {
        subCompanyId: agency.subCompany.id,
        maxFiles: 5,
      },
    });
    await prisma.proposalAwaitingClientSetting.create({
      data: {
        subCompanyId: agency.subCompany.id,
        days: 7,
      },
    });
    await prisma.leadDeadlineSetting.create({
      data: {
        subCompanyId: agency.subCompany.id,
        days: 7,
      },
    });

    const defaultFiles = [
      {
        name: `${agency.label} Service Agreement`,
        fileUrl: `https://example.com/seed/${agency.key}-service-agreement.pdf`,
        mimeType: 'application/pdf',
      },
      {
        name: `${agency.label} Rate Card`,
        fileUrl: `https://example.com/seed/${agency.key}-rate-card.pdf`,
        mimeType: 'application/pdf',
      },
    ];
    for (const file of defaultFiles) {
      await prisma.proposalDefaultFile.create({
        data: {
          subCompanyId: agency.subCompany.id,
          ...file,
        },
      });
      proposalDefaultFileCount++;
    }

    const listClients = (agency.clients.length ? agency.clients : createdClients).slice(0, 6);
    const localList = await prisma.mailingList.create({
      data: {
        subCompanyId: agency.subCompany.id,
        name: `${agency.label} Priority Outreach`,
        description: `Seed list for ${agency.label} local and shared clients`,
        members: {
          create: listClients.map((client) => ({ clientId: client.id })),
        },
      },
    });
    mailingListCount++;

    const recipients = await Promise.all(listClients.map(recipientForClient));
    const template = agencyEmailTemplates.get(agency.subCompany.id);
    const sentAt = daysFromSeed(-3, 16);
    await prisma.emailCampaign.create({
      data: {
        subCompanyId: agency.subCompany.id,
        name: `${agency.label} May Outreach - Sent`,
        listId: localList.id,
        listName: localList.name,
        subject: `${agency.label} staffing support`,
        body: template?.bodyHtml ?? '<p>Local staffing outreach</p>',
        templateId: template?.id ?? null,
        scheduledDate: sentAt,
        status: 'sent',
        sentAt,
        totalRecipients: recipients.length,
        statsSent: recipients.length,
        statsDelivered: Math.max(0, recipients.length - 1),
        statsOpened: Math.max(0, recipients.length - 2),
        statsClicked: Math.max(0, recipients.length - 4),
        statsBounced: recipients.length > 0 ? 1 : 0,
        statsFailed: 0,
        createdById: agency.manager.id,
        recipients: {
          create: recipients.map((recipient, index) => ({
            clientId: recipient.clientId,
            clientName: recipient.clientName,
            email: recipient.email,
            status: index === recipients.length - 1 ? 'bounced' : index % 2 === 0 ? 'opened' : 'delivered',
            sentAt,
            deliveredAt: index === recipients.length - 1 ? null : daysFromSeed(-3, 17),
            openedAt: index % 2 === 0 && index !== recipients.length - 1 ? daysFromSeed(-2, 11) : null,
            bouncedAt: index === recipients.length - 1 ? daysFromSeed(-3, 18) : null,
            failureReason: index === recipients.length - 1 ? 'Seed bounced recipient' : null,
          })),
        },
      },
    });
    campaignCount++;
    campaignRecipientCount += recipients.length;

    await prisma.emailCampaign.create({
      data: {
        subCompanyId: agency.subCompany.id,
        name: `${agency.label} Follow-up Draft`,
        listId: localList.id,
        listName: localList.name,
        subject: `${agency.label} follow-up campaign`,
        body: template?.bodyHtml ?? '<p>Draft follow-up outreach</p>',
        templateId: template?.id ?? null,
        scheduledDate: daysFromSeed(3, 10),
        status: 'draft',
        totalRecipients: recipients.length,
        createdById: agency.manager.id,
      },
    });
    campaignCount++;
  }

  // Create User Availability
  console.log('⏰ Creating user availability...');
  await prisma.userAvailability.create({
    data: {
      userId: salesManager1.id,
      meetingDuration: 30,
      bufferTime: 15,
      bookingLinkSlug: `book-${salesManager1.id.substring(0, 8)}`,
      timezone: 'America/Toronto',
      timeSlots: {
        create: [
          {
            dayOfWeek: 'monday',
            startTime: '09:00',
            endTime: '17:00',
            isEnabled: true,
          },
          {
            dayOfWeek: 'tuesday',
            startTime: '09:00',
            endTime: '17:00',
            isEnabled: true,
          },
          {
            dayOfWeek: 'wednesday',
            startTime: '09:00',
            endTime: '17:00',
            isEnabled: true,
          },
          {
            dayOfWeek: 'thursday',
            startTime: '09:00',
            endTime: '17:00',
            isEnabled: true,
          },
          {
            dayOfWeek: 'friday',
            startTime: '09:00',
            endTime: '17:00',
            isEnabled: true,
          },
        ],
      },
    },
  });

  await prisma.userAvailability.create({
    data: {
      userId: salesAssociate1.id,
      meetingDuration: 30,
      bufferTime: 15,
      bookingLinkSlug: `book-${salesAssociate1.id.substring(0, 8)}`,
      timezone: 'America/Toronto',
      timeSlots: {
        create: [
          { dayOfWeek: 'monday', startTime: '09:00', endTime: '17:00', isEnabled: true },
          { dayOfWeek: 'tuesday', startTime: '09:00', endTime: '17:00', isEnabled: true },
          { dayOfWeek: 'wednesday', startTime: '09:00', endTime: '17:00', isEnabled: true },
          { dayOfWeek: 'thursday', startTime: '09:00', endTime: '17:00', isEnabled: true },
          { dayOfWeek: 'friday', startTime: '09:00', endTime: '17:00', isEnabled: true },
        ],
      },
    },
  });

  // Bug report email recipients (super_admin manages in Settings; default recipient)
  await prisma.bugReportRecipient.upsert({
    where: { email: 'hassan@wudox.ca' },
    create: { email: 'hassan@wudox.ca' },
    update: {},
  });

  // ─── Call Scripts ──────────────────────────────────────────────────────────
  console.log('📝 Creating call scripts...');
  const scriptData = [
    {
      name: 'Active Client Script',
      clientStatus: 'active',
      content: `**Opening:**\n"Hi [Contact Name], this is [Your Name] from Wudox. How are you today?"\n\n**Purpose:**\n"I'm calling to check in on your current staffing needs and see how our partnership has been working for you."\n\n**Key Questions:**\n• How has your experience been with our recent placements?\n• Are there any upcoming projects that might require additional staff?\n• Is there anything we could be doing better to support your team?\n\n**Value Proposition:**\n"We've recently expanded our talent pool in [relevant industry], and I thought of your company..."\n\n**Closing:**\n"Thank you for your time. I'll follow up with [specific action]. Is there anything else I can help with today?"`,
    },
    {
      name: 'Ex-Client Win-Back Script',
      clientStatus: 'ex',
      content: `**Opening:**\n"Hi [Contact Name], this is [Your Name] from Wudox. I hope I'm not catching you at a bad time."\n\n**Acknowledge History:**\n"I noticed it's been a while since we last worked together, and I wanted to personally reach out."\n\n**Discovery:**\n"May I ask what led to the change? We value your feedback and want to understand how we can improve."\n\n**Win-Back Offer:**\n"Since your last experience with us, we've made several improvements including [specific improvements]. We'd love the opportunity to earn your business back."\n\n**Special Incentive:**\n"As a returning client, we're offering [special rate/service] for your next placement."\n\n**Closing:**\n"Would you be open to a brief meeting to discuss how we can better serve your needs this time?"`,
    },
    {
      name: 'Lost Client Recovery Script',
      clientStatus: 'lost',
      content: `**Opening:**\n"Hi [Contact Name], this is [Your Name] from Wudox. I appreciate you taking my call."\n\n**Be Direct:**\n"I understand we weren't able to meet your needs previously, and I wanted to personally follow up."\n\n**Listen First:**\n"Could you share what factors influenced your decision? Your honest feedback helps us improve."\n\n**Address Concerns:**\n[After listening] "I understand. Since then, we've [specific changes made to address their concern]."\n\n**New Value:**\n"We now offer [new service/capability] that I believe could address your previous concerns."\n\n**Soft Close:**\n"I'm not asking for a commitment today. Would you be open to a brief conversation about your current situation?"`,
    },
    {
      name: 'New Contact Introduction Script',
      clientStatus: 'contacted',
      content: `**Opening:**\n"Hi [Contact Name], this is [Your Name] from Wudox. Thank you for taking my call."\n\n**Introduction:**\n"We specialize in [staffing services] and have been helping companies in [industry] find top talent."\n\n**Qualification Questions:**\n• "What does your current hiring process look like?"\n• "What are your biggest staffing challenges right now?"\n• "How do you typically source candidates?"\n\n**Value Statement:**\n"Based on what you've shared, I think we could help by [specific benefit]. We've helped similar companies achieve [specific result]."\n\n**Next Steps:**\n"I'd love to schedule a brief meeting to learn more about your needs. Would [specific time] work for you?"`,
    },
  ];

  for (const agency of [subCompany]) {
    for (const script of scriptData) {
      await prisma.callScript.upsert({
        where: { subCompanyId_name: { subCompanyId: agency.id, name: script.name } },
        create: { subCompanyId: agency.id, ...script },
        update: {},
      });
    }
  }

  console.log('\n🔐 Seeding RBAC roles & permissions...');
  const { seedRbac } = await import('./seed-rbac');
  await seedRbac(prisma);
  console.log('  ✓ RBAC roles and permission catalog');

  console.log('\n⛓ Seeding agency approval policies...');
  const { seedApproval } = await import('./seed-approval');
  await seedApproval();
  console.log('  ✓ Agency approval policies and role capabilities');

  console.log('\n⚙️ Seeding org global-database approval policy...');
  await prisma.orgApprovalPolicy.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      workflows: {
        database_client_add: { mode: 'route', route: ['director'] },
        database_client_import: { mode: 'route', route: ['director'] },
        database_contact_import: { mode: 'route', route: ['director'] },
      },
      databaseImportDestination: 'global',
      databaseImportAgencyId: null,
    },
    update: {
      databaseImportDestination: 'global',
      databaseImportAgencyId: null,
    },
  });
  console.log('  ✓ Org approval policy (global database destination)');

  const workflowDemoCounts = await seedWorkflowDemos(prisma, {
    subCompany,
    salesAssociate1,
    salesAssociate2,
    salesManager1,
    databaseManager,
    clients: createdClients,
    leadsByAgency,
    daysFromSeed,
  });

  const { seedRecruitmentDemo } = await import('./seedRecruitmentDemo');
  const recruitmentDemoCounts = await seedRecruitmentDemo(prisma, {
    recruiter1,
    srRecruiter,
    pakistanUser,
    recruitmentManager,
    subCompanyTorontoId: subCompany.id,
    daysFromSeed,
  });
  jobCount = recruitmentDemoCounts.jobCount;
  employeeCount = recruitmentDemoCounts.employeeCount;
  jobAssignmentCount = recruitmentDemoCounts.jobAssignmentCount;
  employeeAssignmentCount = recruitmentDemoCounts.employeeAssignmentCount;

  console.log('✅ Database seed completed successfully!');
  console.log('\n📊 Summary:');
  console.log(`   - Sub Companies: 1`);
  console.log(`   - Locations: 2`);
  console.log(`   - Users: ${allSeedUsers.length}`);
  console.log(`   - Clients: ${createdClients.length}`);
  console.log(`   - Leads: ${createdLeads.length}`);
  console.log(`   - Calls: ${callCount}`);
  console.log(`   - Follow-ups: ${followUpCount}`);
  console.log(`   - Tasks: ${taskCount}`);
  console.log(`   - Meetings: ${meetingCount}`);
  console.log(`   - Active Clients (recruitment): ${recruitmentDemoCounts.activeClientCount}`);
  console.log(`   - Jobs: ${jobCount}`);
  console.log(`   - Employees: ${employeeCount}`);
  console.log(`   - Job Assignments: ${jobAssignmentCount}`);
  console.log(`   - Pending Employee Assignments: ${employeeAssignmentCount}`);
  console.log(`   - Activity Logs: ${activityLogCount}`);
  console.log(`   - Client Notes: ${clientNoteCount}`);
  console.log(`   - Lead Requests: ${workflowDemoCounts.leadRequestCount}`);
  console.log(`   - Lead Reassignment Requests: ${workflowDemoCounts.leadReassignmentCount}`);
  console.log(`   - Pending Client Adds: ${workflowDemoCounts.pendingClientAddCount}`);
  console.log(`   - Pending Client Edits: ${workflowDemoCounts.pendingClientEditCount}`);
  console.log(`   - Pending Client Imports: ${workflowDemoCounts.pendingClientImportCount}`);
  console.log(`   - Pending Database Adds: ${workflowDemoCounts.pendingDatabaseClientAddCount}`);
  console.log(`   - Pending Database Imports: ${workflowDemoCounts.pendingDatabaseClientImportCount}`);
  console.log(`   - Lead Extension Requests: ${workflowDemoCounts.leadExtensionCount}`);
  console.log(`   - Proposals Pending Review: ${workflowDemoCounts.proposalReviewCount}`);
  console.log(`   - Proposal Extension Requests: ${workflowDemoCounts.proposalExtensionCount}`);
  console.log(`   - Offboarding Demo Clients: ${workflowDemoCounts.offboardingClientCount}`);
  console.log(`   - Offboarding Demo Leads: ${workflowDemoCounts.offboardingLeadCount}`);
  console.log(`   - Offboarding Demo Tasks: ${workflowDemoCounts.offboardingTaskCount}`);
  console.log(`   - Proposal Default Files: ${proposalDefaultFileCount}`);
  console.log(`   - Mailing Lists: ${mailingListCount}`);
  console.log(`   - Campaigns: ${campaignCount}`);
  console.log(`   - Campaign Recipients: ${campaignRecipientCount}`);
  console.log('\n🔑 Default login credentials:');
  const loginPassword = getSeedLoginPassword();
  console.log(`   All users: password ${loginPassword}`);
  console.log('   Sample accounts:');
  for (const u of allSeedUsers.slice(0, 8)) {
    console.log(`     - ${u.email}`);
  }
  console.log(`     ... and ${Math.max(0, allSeedUsers.length - 8)} more (see backend/SETUP.md)`);
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
