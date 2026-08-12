/**
 * One-time script: Replace old plain-text global email templates with new professional HTML templates.
 * Run with: npx tsx scripts/upgrade-email-templates.ts
 *
 * Safe to run multiple times — it deletes all global templates (subCompanyId IS NULL) and re-creates them.
 * Agency-specific templates (subCompanyId NOT NULL) are NOT touched.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const wrap = (body: string) => `<!DOCTYPE html>
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

const header = (title: string, subtitle?: string) =>
  `<tr><td style="background:#1e40af;padding:24px 32px;">
  <h1 style="margin:0;color:#fff;font-size:20px;font-weight:600;">${title}</h1>
  ${subtitle ? `<p style="margin:4px 0 0;color:#93c5fd;font-size:13px;">${subtitle}</p>` : ''}
</td></tr>`;

const footer = (text = '{{agency_footer}}') =>
  `<tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
  <p style="margin:0;color:#94a3b8;font-size:11px;text-align:center;">${text}</p>
</td></tr>`;

const cta = (label: string) =>
  `<table cellpadding="0" cellspacing="0"><tr><td style="background:#1e40af;border-radius:6px;padding:12px 28px;">
  <a href="#" style="color:#fff;text-decoration:none;font-size:14px;font-weight:600;">${label}</a>
</td></tr></table>`;


const templates = [
  {
    name: 'Introduction',
    subject: 'Staffing solutions for {{company_name}}',
    bodyHtml: wrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#3b82f6);padding:40px 32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:28px;font-weight:700;">NA Staffing</h1>
  <p style="margin:8px 0 0;color:#bfdbfe;font-size:15px;">Your Trusted Staffing Partner</p>
</td></tr>
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hello {{contact_name}},</h2>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">My name is {{sender_name}} from <strong>NA Staffing</strong>. I'm reaching out because we help companies like <strong>{{company_name}}</strong> find exceptional talent quickly and efficiently.</p>
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
  <div style="text-align:center;">${cta("Let's Connect")}</div>
</td></tr>
${footer()}`),
  },
  {
    name: 'Follow-up',
    subject: 'Following up on our conversation — {{company_name}}',
    bodyHtml: wrap(`
${header('NA Staffing', 'Talent Solutions')}
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hi {{contact_name}},</h2>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">I wanted to follow up on our recent conversation about staffing solutions for <strong>{{company_name}}</strong>.</p>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">Based on our discussion, I believe we can help you with:</p>
  <ul style="margin:0 0 16px;padding-left:20px;color:#4a4a4a;font-size:14px;line-height:1.9;">
    <li>Temporary and contract staffing</li>
    <li>Direct hire placements</li>
    <li>Workforce management solutions</li>
  </ul>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">I'd love to schedule a follow-up call to discuss your specific needs in more detail.</p>
  ${cta('Schedule a Call')}
</td></tr>
${footer()}`),
  },
  {
    name: 'Thank You',
    subject: 'Thank you for your time — {{sender_name}}',
    bodyHtml: wrap(`
${header('NA Staffing', 'Talent Solutions')}
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
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">I'll be sending over a detailed proposal within the next 48 hours.</p>
  ${cta('View Our Services')}
</td></tr>
${footer()}`),
  },
  {
    name: 'Meeting Confirmation',
    subject: 'Meeting confirmed — {{contact_name}}',
    bodyHtml: wrap(`
${header('NA Staffing')}
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
      <p style="margin:0;font-size:14px;color:#1a1a1a;">{{sender_name}} (NA Staffing) &amp; {{contact_name}} ({{company_name}})</p>
    </td></tr>
  </table>
  <p style="margin:24px 0 0;color:#4a4a4a;font-size:14px;line-height:1.7;">If you need to reschedule, please let me know at least 24 hours in advance.</p>
  <p style="margin:16px 0 0;color:#4a4a4a;font-size:14px;">Best,<br><strong>{{sender_name}}</strong></p>
</td></tr>
${footer()}`),
  },
  {
    name: 'Proposal Delivery',
    subject: 'Your staffing proposal is ready — {{company_name}}',
    bodyHtml: wrap(`
<tr><td style="background:linear-gradient(135deg,#0f172a,#1e3a5f);padding:40px 32px;text-align:center;">
  <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:2px;">Staffing Proposal</p>
  <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;">Prepared for {{company_name}}</h1>
  <p style="margin:8px 0 0;color:#64748b;font-size:13px;">{{date}}</p>
</td></tr>
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Dear {{contact_name}},</h2>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">Thank you for the opportunity to present our staffing solutions. We've prepared a comprehensive proposal tailored to your needs.</p>
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
  ${cta('View Full Proposal')}
  <p style="margin:24px 0 0;color:#4a4a4a;font-size:14px;">Regards,<br><strong>{{sender_name}}</strong><br><span style="color:#71717a;">{{sender_title}}</span></p>
</td></tr>
${footer('{{agency_footer}} · This proposal is confidential and intended solely for {{company_name}}')}`),
  },
  {
    name: 'Welcome / Onboarding',
    subject: "Welcome to NA Staffing — Let's get started!",
    bodyHtml: wrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#3b82f6);padding:40px 32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:28px;font-weight:700;">Welcome to NA Staffing!</h1>
  <p style="margin:8px 0 0;color:#bfdbfe;font-size:15px;">We're excited to partner with you</p>
</td></tr>
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hi {{contact_name}},</h2>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">Welcome aboard! We're thrilled to have <strong>{{company_name}}</strong> as a new client. Here's what happens next:</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
    <tr><td style="padding:12px 16px;border-left:3px solid #3b82f6;background:#eff6ff;border-radius:0 8px 8px 0;">
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
  <div style="text-align:center;">${cta('Book Discovery Call')}</div>
</td></tr>
${footer()}`),
  },
  {
    name: 'Check-in',
    subject: "Checking in — How's everything going, {{contact_name}}?",
    bodyHtml: wrap(`
${header('NA Staffing', 'Talent Solutions')}
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
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">Your satisfaction is our top priority.</p>
  ${cta('Schedule a Quick Call')}
</td></tr>
${footer()}`),
  },
  {
    name: 'Candidate Introduction',
    subject: 'Candidate profile for {{company_name}} — NA Staffing',
    bodyHtml: wrap(`
${header('NA Staffing', 'Candidate Presentation')}
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hi {{contact_name}},</h2>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">I'm excited to present a strong candidate for the open position at <strong>{{company_name}}</strong>.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:24px;">
    <tr><td style="padding:20px 24px;background:#1e40af;">
      <p style="margin:0;font-size:16px;font-weight:600;color:#fff;">Candidate Profile</p>
    </td></tr>
    <tr><td style="padding:20px 24px;border-bottom:1px solid #e2e8f0;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td width="120" style="color:#94a3b8;font-size:13px;padding:4px 0;">Name:</td><td style="color:#1a1a1a;font-size:13px;font-weight:600;padding:4px 0;">[Candidate Name]</td></tr>
        <tr><td style="color:#94a3b8;font-size:13px;padding:4px 0;">Experience:</td><td style="color:#1a1a1a;font-size:13px;padding:4px 0;">[X] years in [field]</td></tr>
        <tr><td style="color:#94a3b8;font-size:13px;padding:4px 0;">Key Skills:</td><td style="color:#1a1a1a;font-size:13px;padding:4px 0;">[Skill 1], [Skill 2], [Skill 3]</td></tr>
        <tr><td style="color:#94a3b8;font-size:13px;padding:4px 0;">Availability:</td><td style="color:#1a1a1a;font-size:13px;padding:4px 0;">Immediate / [Date]</td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:16px 24px;">
      <p style="margin:0;color:#4a4a4a;font-size:13px;line-height:1.6;"><strong>Summary:</strong> [Brief candidate summary.]</p>
    </td></tr>
  </table>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">Would you like to schedule an interview?</p>
  ${cta('Schedule Interview')}
</td></tr>
${footer()}`),
  },
  {
    name: 'Meeting Reminder',
    subject: 'Reminder: Our meeting is tomorrow — {{sender_name}}',
    bodyHtml: wrap(`
${header('NA Staffing')}
<tr><td style="padding:32px;">
  <div style="text-align:center;margin-bottom:24px;">
    <div style="display:inline-block;background:#fef3c7;border-radius:50%;width:56px;height:56px;line-height:56px;font-size:28px;">⏰</div>
  </div>
  <h2 style="margin:0 0 8px;color:#1a1a1a;font-size:18px;text-align:center;">Meeting Reminder</h2>
  <p style="margin:0 0 24px;color:#71717a;font-size:13px;text-align:center;">Hi {{contact_name}}, just a friendly reminder about our upcoming meeting.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;overflow:hidden;margin-bottom:24px;">
    <tr><td style="padding:20px 24px;text-align:center;">
      <p style="margin:0 0 4px;font-size:11px;color:#92400e;text-transform:uppercase;letter-spacing:1px;">Scheduled For</p>
      <p style="margin:0;font-size:18px;font-weight:700;color:#92400e;">{{date}} at 2:00 PM EST</p>
    </td></tr>
  </table>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">Please have any relevant documents or questions ready. If you need to reschedule, just reply to this email.</p>
  <div style="text-align:center;">${cta('Add to Calendar')}</div>
  <p style="margin:24px 0 0;color:#4a4a4a;font-size:14px;">See you soon,<br><strong>{{sender_name}}</strong></p>
</td></tr>
${footer()}`),
  },
  {
    name: 'Payment Reminder',
    subject: 'Payment reminder — Invoice #[INV-NUMBER]',
    bodyHtml: wrap(`
${header('NA Staffing', 'Accounts Department')}
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Payment Reminder</h2>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">Hi {{contact_name}}, this is a friendly reminder regarding the following outstanding invoice for <strong>{{company_name}}</strong>.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:24px;">
    <tr style="background:#f8fafc;">
      <td style="padding:12px 20px;font-size:12px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Invoice #</td>
      <td style="padding:12px 20px;font-size:12px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Date</td>
      <td style="padding:12px 20px;font-size:12px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;text-align:right;">Amount</td>
    </tr>
    <tr>
      <td style="padding:16px 20px;font-size:14px;color:#1a1a1a;font-weight:600;">[INV-NUMBER]</td>
      <td style="padding:16px 20px;font-size:14px;color:#4a4a4a;">{{date}}</td>
      <td style="padding:16px 20px;font-size:14px;color:#1e40af;font-weight:700;text-align:right;">$[AMOUNT]</td>
    </tr>
  </table>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">If payment has already been sent, please disregard this reminder.</p>
  ${cta('View Invoice')}
  <p style="margin:24px 0 0;color:#4a4a4a;font-size:14px;">Thank you,<br><strong>NA Staffing Accounts</strong></p>
</td></tr>
${footer()}`),
  },
  {
    name: 'Seasonal Hiring',
    subject: 'Prepare for peak season — Staffing solutions from NA Staffing',
    bodyHtml: wrap(`
<tr><td style="background:linear-gradient(135deg,#ea580c,#f97316);padding:40px 32px;text-align:center;">
  <p style="margin:0 0 4px;font-size:11px;color:#fed7aa;text-transform:uppercase;letter-spacing:2px;">Seasonal Staffing</p>
  <h1 style="margin:0;color:#fff;font-size:26px;font-weight:700;">Peak Season is Coming!</h1>
  <p style="margin:8px 0 0;color:#fed7aa;font-size:14px;">Don't get caught short-staffed</p>
</td></tr>
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hi {{contact_name}},</h2>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">Peak season is approaching, and now is the perfect time to plan your staffing strategy for <strong>{{company_name}}</strong>.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td width="50%" style="padding:8px;vertical-align:top;">
        <div style="background:#fff7ed;border-radius:8px;padding:20px;text-align:center;min-height:100px;">
          <p style="margin:0;font-size:28px;">⚡</p>
          <p style="margin:8px 0 0;font-size:14px;font-weight:600;color:#9a3412;">Quick Turnaround</p>
          <p style="margin:4px 0 0;font-size:12px;color:#71717a;">Candidates ready in 48 hours</p>
        </div>
      </td>
      <td width="50%" style="padding:8px;vertical-align:top;">
        <div style="background:#fff7ed;border-radius:8px;padding:20px;text-align:center;min-height:100px;">
          <p style="margin:0;font-size:28px;">📋</p>
          <p style="margin:8px 0 0;font-size:14px;font-weight:600;color:#9a3412;">Pre-screened Talent</p>
          <p style="margin:4px 0 0;font-size:12px;color:#71717a;">Fully vetted and ready to work</p>
        </div>
      </td>
    </tr>
  </table>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">Let's connect before the rush begins. Early planning means better candidates and smoother onboarding.</p>
  <div style="text-align:center;">${cta('Plan Your Staffing')}</div>
</td></tr>
${footer()}`),
  },
  {
    name: 'Re-engagement',
    subject: 'We miss working with {{company_name}}!',
    bodyHtml: wrap(`
${header('NA Staffing', 'Talent Solutions')}
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hi {{contact_name}},</h2>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">It's been a while since we last connected, and I wanted to reach out. A lot has changed at NA Staffing, and we'd love the chance to work with <strong>{{company_name}}</strong> again.</p>
  <div style="background:#eff6ff;border-radius:8px;padding:24px;margin:0 0 24px;">
    <p style="margin:0 0 12px;color:#1e40af;font-size:15px;font-weight:600;">What's new at NA Staffing:</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:6px 0;font-size:13px;color:#4a4a4a;">✅ Expanded our talent pool across new industries</td></tr>
      <tr><td style="padding:6px 0;font-size:13px;color:#4a4a4a;">✅ Faster placement times — average 48-hour turnaround</td></tr>
      <tr><td style="padding:6px 0;font-size:13px;color:#4a4a4a;">✅ Enhanced candidate vetting and screening process</td></tr>
      <tr><td style="padding:6px 0;font-size:13px;color:#4a4a4a;">✅ Dedicated account management for returning clients</td></tr>
    </table>
  </div>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">How about a quick 10-minute call this week?</p>
  <div style="text-align:center;">${cta("Let's Reconnect")}</div>
</td></tr>
${footer()}`),
  },
  {
    name: 'Referral Request',
    subject: 'Know someone who needs staffing help?',
    bodyHtml: wrap(`
${header('NA Staffing', 'Talent Solutions')}
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hi {{contact_name}},</h2>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">Thank you for being a valued client of NA Staffing. We've really enjoyed working with <strong>{{company_name}}</strong>.</p>
  <div style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border-radius:12px;padding:28px;margin:0 0 24px;text-align:center;">
    <p style="margin:0;font-size:32px;">🤝</p>
    <p style="margin:12px 0 4px;color:#1e40af;font-size:18px;font-weight:700;">Refer &amp; Reward</p>
    <p style="margin:0;color:#4a4a4a;font-size:13px;line-height:1.6;">Know a business that could benefit from our staffing services?<br>We'd love an introduction — and we'll make it worth your while.</p>
  </div>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">Simply reply with their name and contact info, or forward this email.</p>
  <div style="text-align:center;">${cta('Refer a Business')}</div>
</td></tr>
${footer()}`),
  },
  {
    name: 'Job Opening',
    subject: "We're hiring! {{company_name}} is looking for top talent",
    bodyHtml: wrap(`
${header('NA Staffing', 'Job Opportunity')}
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hi {{contact_name}},</h2>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">We have an exciting new opening that might be a perfect fit for someone in your network.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border:2px solid #bfdbfe;border-radius:8px;overflow:hidden;margin-bottom:24px;">
    <tr><td style="padding:24px;">
      <p style="margin:0 0 4px;font-size:11px;color:#3b82f6;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Now Hiring</p>
      <p style="margin:0 0 12px;font-size:20px;font-weight:700;color:#1e40af;">[Job Title]</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:4px 0;font-size:13px;color:#64748b;">📍 Location:</td><td style="padding:4px 0;font-size:13px;color:#1a1a1a;">[City, State / Remote]</td></tr>
        <tr><td style="padding:4px 0;font-size:13px;color:#64748b;">💼 Type:</td><td style="padding:4px 0;font-size:13px;color:#1a1a1a;">[Full-time / Contract / Temp]</td></tr>
        <tr><td style="padding:4px 0;font-size:13px;color:#64748b;">💰 Range:</td><td style="padding:4px 0;font-size:13px;color:#1a1a1a;">[$XX - $XX / hour or year]</td></tr>
        <tr><td style="padding:4px 0;font-size:13px;color:#64748b;">🗓️ Start:</td><td style="padding:4px 0;font-size:13px;color:#1a1a1a;">[ASAP / Date]</td></tr>
      </table>
    </td></tr>
  </table>
  <p style="margin:0 0 8px;color:#1a1a1a;font-size:14px;font-weight:600;">Key Requirements:</p>
  <ul style="margin:0 0 24px;padding-left:20px;color:#4a4a4a;font-size:13px;line-height:1.9;">
    <li>[Requirement 1]</li><li>[Requirement 2]</li><li>[Requirement 3]</li>
  </ul>
  <div style="text-align:center;">${cta('Apply Now')}</div>
  <p style="margin:24px 0 0;color:#71717a;font-size:12px;text-align:center;">Know someone who'd be great? Forward this email!</p>
</td></tr>
${footer()}`),
  },
  {
    name: 'Placement Confirmation',
    subject: 'Placement confirmed — {{company_name}}',
    bodyHtml: wrap(`
${header('NA Staffing', 'Placement Update')}
<tr><td style="padding:32px;">
  <div style="text-align:center;margin-bottom:24px;">
    <div style="display:inline-block;background:#f0fdf4;border-radius:50%;width:56px;height:56px;line-height:56px;font-size:28px;">✅</div>
  </div>
  <h2 style="margin:0 0 8px;color:#1a1a1a;font-size:18px;text-align:center;">Placement Confirmed!</h2>
  <p style="margin:0 0 24px;color:#71717a;font-size:13px;text-align:center;">Great news, {{contact_name}}! A candidate has been successfully placed.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:24px;">
    <tr><td style="padding:20px 24px;border-bottom:1px solid #e2e8f0;">
      <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Candidate</p>
      <p style="margin:0;font-size:15px;font-weight:600;color:#1a1a1a;">[Candidate Name]</p>
    </td></tr>
    <tr><td style="padding:20px 24px;border-bottom:1px solid #e2e8f0;">
      <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Position</p>
      <p style="margin:0;font-size:14px;color:#1a1a1a;">[Job Title]</p>
    </td></tr>
    <tr><td style="padding:20px 24px;border-bottom:1px solid #e2e8f0;">
      <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Start Date</p>
      <p style="margin:0;font-size:14px;color:#1a1a1a;">{{date}}</p>
    </td></tr>
    <tr><td style="padding:20px 24px;">
      <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Company</p>
      <p style="margin:0;font-size:14px;color:#1a1a1a;">{{company_name}}</p>
    </td></tr>
  </table>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">We'll be in touch during the onboarding period to ensure everything goes smoothly.</p>
</td></tr>
${footer()}`),
  },
  {
    name: 'Contract Renewal',
    subject: 'Your staffing contract is up for renewal — {{company_name}}',
    bodyHtml: wrap(`
${header('NA Staffing', 'Contract Services')}
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hi {{contact_name}},</h2>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">Your staffing contract with NA Staffing is approaching its renewal date.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;overflow:hidden;margin:0 0 24px;">
    <tr><td style="padding:20px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td width="120" style="color:#92400e;font-size:13px;padding:6px 0;font-weight:600;">Contract:</td><td style="color:#1a1a1a;font-size:13px;padding:6px 0;">{{company_name}} — Staffing Services</td></tr>
        <tr><td style="color:#92400e;font-size:13px;padding:6px 0;font-weight:600;">Expires:</td><td style="color:#1a1a1a;font-size:13px;padding:6px 0;font-weight:700;">[Expiry Date]</td></tr>
        <tr><td style="color:#92400e;font-size:13px;padding:6px 0;font-weight:600;">Action needed:</td><td style="color:#1a1a1a;font-size:13px;padding:6px 0;">Review &amp; renew before expiry</td></tr>
      </table>
    </td></tr>
  </table>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">We've enjoyed working with <strong>{{company_name}}</strong> and would love to continue our partnership.</p>
  ${cta('Schedule Renewal Call')}
</td></tr>
${footer()}`),
  },
  {
    name: 'Holiday Greeting',
    subject: 'Happy Holidays from NA Staffing!',
    bodyHtml: wrap(`
<tr><td style="background:linear-gradient(135deg,#0f172a,#1e3a5f);padding:48px 32px;text-align:center;">
  <p style="margin:0 0 8px;font-size:36px;">🎄</p>
  <h1 style="margin:0;color:#fff;font-size:26px;font-weight:700;">Happy Holidays!</h1>
  <p style="margin:12px 0 0;color:#94a3b8;font-size:15px;">From all of us at NA Staffing</p>
</td></tr>
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Dear {{contact_name}},</h2>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">As the year comes to a close, we want to express our sincere gratitude for the partnership we've built with <strong>{{company_name}}</strong>.</p>
  <div style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border-radius:12px;padding:28px;margin:0 0 24px;text-align:center;">
    <p style="margin:0;color:#1e40af;font-size:16px;font-weight:600;line-height:1.6;">Wishing you and your team a wonderful holiday season<br>and a prosperous New Year!</p>
  </div>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">We look forward to continuing to support your staffing needs in the year ahead.</p>
  <p style="margin:0;color:#4a4a4a;font-size:14px;line-height:1.7;">Warm regards,<br><strong>The NA Staffing Team</strong></p>
</td></tr>
<tr><td style="background:#0f172a;padding:24px 32px;text-align:center;">
  <p style="margin:0;color:#94a3b8;font-size:12px;">{{agency_footer}}</p>
  <p style="margin:8px 0 0;color:#64748b;font-size:11px;">Thank you for a great year!</p>
</td></tr>`),
  },
  {
    name: 'Service Overview',
    subject: 'How NA Staffing can help {{company_name}}',
    bodyHtml: wrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#3b82f6);padding:40px 32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:28px;font-weight:700;">NA Staffing</h1>
  <p style="margin:8px 0 0;color:#bfdbfe;font-size:15px;">Complete Staffing Solutions</p>
</td></tr>
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hi {{contact_name}},</h2>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">Here's how NA Staffing can support <strong>{{company_name}}</strong> across all your workforce needs.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
    <tr>
      <td width="50%" style="padding:8px;vertical-align:top;">
        <div style="border:1px solid #e2e8f0;border-radius:8px;padding:20px;min-height:120px;">
          <p style="margin:0;font-size:24px;">👥</p>
          <p style="margin:8px 0 4px;font-size:14px;font-weight:600;color:#1a1a1a;">Temporary Staffing</p>
          <p style="margin:0;font-size:12px;color:#71717a;line-height:1.5;">Flexible workforce for seasonal demands, projects, or coverage.</p>
        </div>
      </td>
      <td width="50%" style="padding:8px;vertical-align:top;">
        <div style="border:1px solid #e2e8f0;border-radius:8px;padding:20px;min-height:120px;">
          <p style="margin:0;font-size:24px;">🎯</p>
          <p style="margin:8px 0 4px;font-size:14px;font-weight:600;color:#1a1a1a;">Direct Hire</p>
          <p style="margin:0;font-size:12px;color:#71717a;line-height:1.5;">Full recruitment for permanent positions with top talent.</p>
        </div>
      </td>
    </tr>
    <tr>
      <td width="50%" style="padding:8px;vertical-align:top;">
        <div style="border:1px solid #e2e8f0;border-radius:8px;padding:20px;min-height:120px;">
          <p style="margin:0;font-size:24px;">📋</p>
          <p style="margin:8px 0 4px;font-size:14px;font-weight:600;color:#1a1a1a;">Temp-to-Hire</p>
          <p style="margin:0;font-size:12px;color:#71717a;line-height:1.5;">Try before you commit. Evaluate candidates on the job.</p>
        </div>
      </td>
      <td width="50%" style="padding:8px;vertical-align:top;">
        <div style="border:1px solid #e2e8f0;border-radius:8px;padding:20px;min-height:120px;">
          <p style="margin:0;font-size:24px;">⚙️</p>
          <p style="margin:8px 0 4px;font-size:14px;font-weight:600;color:#1a1a1a;">Workforce Management</p>
          <p style="margin:0;font-size:12px;color:#71717a;line-height:1.5;">Payroll, compliance, and HR support for contingent workforce.</p>
        </div>
      </td>
    </tr>
  </table>
  <div style="text-align:center;">${cta('Get a Custom Quote')}</div>
</td></tr>
${footer()}`),
  },
  {
    name: 'Case Study',
    subject: 'How we helped a company like {{company_name}} — NA Staffing',
    bodyHtml: wrap(`
${header('NA Staffing', 'Success Story')}
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hi {{contact_name}},</h2>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">I wanted to share a recent success story that I think resonates with <strong>{{company_name}}</strong>.</p>
  <div style="background:#f8fafc;border-radius:12px;padding:24px;margin:0 0 24px;">
    <p style="margin:0 0 4px;font-size:11px;color:#3b82f6;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Case Study</p>
    <p style="margin:0 0 16px;font-size:18px;font-weight:700;color:#1a1a1a;">[Client Industry] Company Fills 15 Roles in 3 Weeks</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
      <tr>
        <td width="33%" style="text-align:center;padding:8px;">
          <p style="margin:0;font-size:22px;font-weight:700;color:#1e40af;">15</p>
          <p style="margin:2px 0 0;font-size:11px;color:#64748b;">Positions Filled</p>
        </td>
        <td width="33%" style="text-align:center;padding:8px;">
          <p style="margin:0;font-size:22px;font-weight:700;color:#1e40af;">3 wks</p>
          <p style="margin:2px 0 0;font-size:11px;color:#64748b;">Time to Fill</p>
        </td>
        <td width="33%" style="text-align:center;padding:8px;">
          <p style="margin:0;font-size:22px;font-weight:700;color:#1e40af;">95%</p>
          <p style="margin:2px 0 0;font-size:11px;color:#64748b;">Retention at 6mo</p>
        </td>
      </tr>
    </table>
    <div style="border-left:3px solid #3b82f6;padding-left:16px;">
      <p style="margin:0;color:#4a4a4a;font-size:13px;font-style:italic;line-height:1.6;">"NA Staffing completely transformed our hiring process."</p>
      <p style="margin:8px 0 0;color:#64748b;font-size:12px;font-weight:600;">— [Client Name], [Title]</p>
    </div>
  </div>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">I'd love to achieve similar results for {{company_name}}.</p>
  <div style="text-align:center;">${cta("Let's Talk")}</div>
</td></tr>
${footer()}`),
  },
  {
    name: 'Feedback Request',
    subject: "How are we doing? We'd love your feedback — NA Staffing",
    bodyHtml: wrap(`
${header('NA Staffing', 'Your Opinion Matters')}
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hi {{contact_name}},</h2>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">We'd love to hear about your experience working with us at <strong>{{company_name}}</strong>.</p>
  <div style="text-align:center;margin:0 0 24px;">
    <p style="margin:0 0 12px;color:#1a1a1a;font-size:14px;font-weight:600;">How would you rate your experience?</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
      <tr>
        <td style="padding:0 6px;font-size:32px;">😟</td>
        <td style="padding:0 6px;font-size:32px;">😐</td>
        <td style="padding:0 6px;font-size:32px;">🙂</td>
        <td style="padding:0 6px;font-size:32px;">😊</td>
        <td style="padding:0 6px;font-size:32px;">🤩</td>
      </tr>
    </table>
  </div>
  <div style="background:#f8fafc;border-radius:8px;padding:20px;margin:0 0 24px;">
    <p style="margin:0 0 8px;color:#1a1a1a;font-size:14px;font-weight:600;">We'd also love to know:</p>
    <ul style="margin:0;padding-left:16px;color:#4a4a4a;font-size:13px;line-height:1.9;">
      <li>Were candidates a good match for your needs?</li>
      <li>How was our communication throughout the process?</li>
      <li>What could we do better next time?</li>
    </ul>
  </div>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">Your feedback directly shapes how we serve our clients. It only takes 2 minutes!</p>
  <div style="text-align:center;">${cta('Share Feedback')}</div>
</td></tr>
${footer()}`),
  },
];

async function main() {
  console.log('🗑️  Deleting old global templates (subCompanyId IS NULL)...');
  const deleted = await prisma.emailTemplate.deleteMany({
    where: { subCompanyId: null },
  });
  console.log(`   Deleted ${deleted.count} old global templates.`);

  console.log('📧 Creating new professional templates...');
  for (const t of templates) {
    await prisma.emailTemplate.create({
      data: {
        subCompanyId: null,
        name: t.name,
        subject: t.subject,
        bodyHtml: t.bodyHtml,
        headerHtml: null,
        footerHtml: null,
      },
    });
    console.log(`   ✅ ${t.name}`);
  }
  console.log(`\n🎉 Done! ${templates.length} professional templates created.`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
