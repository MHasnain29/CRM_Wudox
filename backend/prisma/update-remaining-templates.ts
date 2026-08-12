/**
 * One-time script: update the 6 remaining old-style templates to newsletter style.
 * Run with: npx tsx backend/prisma/update-remaining-templates.ts
 */
import prisma from '../src/config/database';

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

const emailFooter = (text = '{{agency_footer}}') =>
  `<tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
  <p style="margin:0;color:#94a3b8;font-size:11px;text-align:center;">${text}</p>
</td></tr>`;

const sectionHeader = (title: string) =>
  `<tr><td style="background:#1e40af;padding:10px 16px;border-radius:4px 4px 0 0;">
      <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">${title}</p>
    </td></tr>`;

const templates = [
  {
    name: 'Introduction',
    subject: 'Staffing Solutions for {{company_name}} | {{agency_name}}',
    bodyHtml: emailWrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">{{agency_name}} Staffing Solutions</h1>
  <p style="margin:6px 0 0;color:#bfdbfe;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">Introduction</p>
</td></tr>
<tr><td style="padding:36px 40px;">
  <p style="margin:0 0 20px;color:#1a1a1a;font-size:15px;line-height:1.7;">Hello <strong>{{contact_name}}</strong>,</p>
  <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.8;">My name is <strong>{{sender_name}}</strong> from <strong>{{agency_name}}</strong>. I'm reaching out because we help companies like <strong>{{company_name}}</strong> find exceptional talent quickly and efficiently.</p>
  <p style="margin:0 0 28px;color:#374151;font-size:14px;line-height:1.8;">We specialize in connecting businesses with reliable, skilled workers across general labor, warehousing, packaging, and production — with placements typically completed within 24 hours.</p>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
    <tr>
      <td width="33%" style="padding:16px 8px;text-align:center;background:#eff6ff;border-radius:4px 0 0 4px;border-right:2px solid #fff;">
        <p style="margin:0;font-size:24px;font-weight:700;color:#1e40af;">500+</p>
        <p style="margin:4px 0 0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Placements</p>
      </td>
      <td width="33%" style="padding:16px 8px;text-align:center;background:#eff6ff;border-right:2px solid #fff;">
        <p style="margin:0;font-size:24px;font-weight:700;color:#1e40af;">98%</p>
        <p style="margin:4px 0 0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Retention Rate</p>
      </td>
      <td width="33%" style="padding:16px 8px;text-align:center;background:#eff6ff;border-radius:0 4px 4px 0;">
        <p style="margin:0;font-size:24px;font-weight:700;color:#1e40af;">24hr</p>
        <p style="margin:4px 0 0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Fill Time</p>
      </td>
    </tr>
  </table>

  <p style="margin:0;color:#374151;font-size:14px;line-height:1.8;">I'd love the opportunity to learn more about your staffing needs at <strong>{{company_name}}</strong>. Please let me know if you'd be open to a brief 15-minute call this week.</p>
<!-- FOOTER --></td></tr>
${emailFooter()}`),
  },
  {
    name: 'Thank You',
    subject: 'Thank You for Your Time — {{agency_name}}',
    bodyHtml: emailWrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">{{agency_name}} Staffing Solutions</h1>
  <p style="margin:6px 0 0;color:#bfdbfe;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">Thank You</p>
</td></tr>
<tr><td style="padding:36px 40px;">
  <p style="margin:0 0 20px;color:#1a1a1a;font-size:15px;line-height:1.7;">Thank you, <strong>{{contact_name}}</strong>!</p>
  <p style="margin:0 0 24px;color:#374151;font-size:14px;line-height:1.8;">I truly appreciate you taking the time to meet with me today. It was great learning more about <strong>{{company_name}}</strong> and your current staffing needs.</p>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    ${sectionHeader('Key Takeaways')}
    <tr><td style="background:#eff6ff;padding:16px;border-radius:0 0 4px 4px;">
      <table cellpadding="0" cellspacing="0">
        <tr><td style="padding:4px 0;color:#374151;font-size:13px;line-height:1.7;">&#8226;&nbsp; Your priority is filling [role/position] by [timeline]</td></tr>
        <tr><td style="padding:4px 0;color:#374151;font-size:13px;line-height:1.7;">&#8226;&nbsp; You're looking for candidates with [specific skills]</td></tr>
        <tr><td style="padding:4px 0;color:#374151;font-size:13px;line-height:1.7;">&#8226;&nbsp; Budget range discussed for this engagement</td></tr>
      </table>
    </td></tr>
  </table>

  <p style="margin:0;color:#374151;font-size:14px;line-height:1.8;">I'll be sending over a detailed proposal within the next 48 hours. In the meantime, don't hesitate to reach out with any questions.</p>
<!-- FOOTER --></td></tr>
${emailFooter()}`),
  },
  {
    name: 'Meeting Confirmation',
    subject: 'Meeting Confirmed — {{contact_name}} | {{agency_name}}',
    bodyHtml: emailWrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">{{agency_name}} Staffing Solutions</h1>
  <p style="margin:6px 0 0;color:#bfdbfe;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">Meeting Confirmed</p>
</td></tr>
<tr><td style="padding:36px 40px;">
  <p style="margin:0 0 20px;color:#1a1a1a;font-size:15px;line-height:1.7;">Hi <strong>{{contact_name}}</strong>,</p>
  <p style="margin:0 0 24px;color:#374151;font-size:14px;line-height:1.8;">Your meeting has been confirmed. Please find the details below.</p>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    ${sectionHeader('Meeting Details')}
    <tr><td style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 4px 4px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:14px 16px;border-bottom:1px solid #e2e8f0;">
          <p style="margin:0 0 3px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Date</p>
          <p style="margin:0;font-size:14px;font-weight:600;color:#1a1a1a;">{{date}}</p>
        </td></tr>
        <tr><td style="padding:14px 16px;border-bottom:1px solid #e2e8f0;">
          <p style="margin:0 0 3px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Location</p>
          <p style="margin:0;font-size:14px;color:#1a1a1a;">Video Call (link will be sent separately)</p>
        </td></tr>
        <tr><td style="padding:14px 16px;">
          <p style="margin:0 0 3px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Attendees</p>
          <p style="margin:0;font-size:14px;color:#1a1a1a;">{{sender_name}} ({{agency_name}}) &amp; {{contact_name}} ({{company_name}})</p>
        </td></tr>
      </table>
    </td></tr>
  </table>

  <p style="margin:0;color:#374151;font-size:14px;line-height:1.8;">If you need to reschedule, please let me know at least 24 hours in advance.</p>
<!-- FOOTER --></td></tr>
${emailFooter()}`),
  },
  {
    name: 'Proposal Delivery',
    subject: 'Your Staffing Proposal Is Ready — {{company_name}} | {{agency_name}}',
    bodyHtml: emailWrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">{{agency_name}} Staffing Solutions</h1>
  <p style="margin:6px 0 0;color:#bfdbfe;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">Proposal Ready for Review</p>
</td></tr>
<tr><td style="padding:36px 40px;">
  <p style="margin:0 0 20px;color:#1a1a1a;font-size:15px;line-height:1.7;">Dear <strong>{{contact_name}}</strong>,</p>
  <p style="margin:0 0 24px;color:#374151;font-size:14px;line-height:1.8;">Thank you for the opportunity to present our staffing solutions to <strong>{{company_name}}</strong>. Based on our discussions, we have prepared a comprehensive proposal tailored to your specific needs.</p>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    ${sectionHeader('Proposal Summary')}
    <tr><td style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 4px 4px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="50%" style="padding:16px;text-align:center;border-right:1px solid #e2e8f0;">
            <p style="margin:0 0 3px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Prepared For</p>
            <p style="margin:0;font-size:14px;font-weight:700;color:#1e40af;">{{company_name}}</p>
          </td>
          <td width="50%" style="padding:16px;text-align:center;">
            <p style="margin:0 0 3px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Date</p>
            <p style="margin:0;font-size:14px;font-weight:700;color:#1e40af;">{{date}}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>

  <p style="margin:0;color:#374151;font-size:14px;line-height:1.8;">Please find the detailed proposal attached. I am available to discuss any questions at your convenience — please feel free to reply to this email or give me a call.</p>
<!-- FOOTER --></td></tr>
${emailFooter('{{agency_footer}} · This proposal is confidential and intended solely for {{company_name}}')}`),
  },
  {
    name: 'Welcome / Onboarding',
    subject: "Welcome to {{agency_name}} — Let's Get Started!",
    bodyHtml: emailWrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">Welcome to {{agency_name}}!</h1>
  <p style="margin:6px 0 0;color:#bfdbfe;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">We're excited to partner with you</p>
</td></tr>
<tr><td style="padding:36px 40px;">
  <p style="margin:0 0 20px;color:#1a1a1a;font-size:15px;line-height:1.7;">Hi <strong>{{contact_name}}</strong>,</p>
  <p style="margin:0 0 24px;color:#374151;font-size:14px;line-height:1.8;">Welcome aboard! We're thrilled to have <strong>{{company_name}}</strong> as a new client. Here's what happens next:</p>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
    ${sectionHeader("What Happens Next")}
    <tr><td style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 4px 4px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:14px 16px;border-bottom:1px solid #e2e8f0;">
          <p style="margin:0 0 3px;font-size:13px;font-weight:700;color:#1e40af;">Step 1 — Discovery Call</p>
          <p style="margin:0;font-size:13px;color:#374151;line-height:1.7;">We'll schedule a call to understand your staffing needs in detail.</p>
        </td></tr>
        <tr><td style="padding:14px 16px;border-bottom:1px solid #e2e8f0;">
          <p style="margin:0 0 3px;font-size:13px;font-weight:700;color:#1e40af;">Step 2 — Talent Search</p>
          <p style="margin:0;font-size:13px;color:#374151;line-height:1.7;">Our team will source and screen candidates matching your requirements.</p>
        </td></tr>
        <tr><td style="padding:14px 16px;border-bottom:1px solid #e2e8f0;">
          <p style="margin:0 0 3px;font-size:13px;font-weight:700;color:#1e40af;">Step 3 — Candidate Presentation</p>
          <p style="margin:0;font-size:13px;color:#374151;line-height:1.7;">We'll present top candidates with detailed profiles for your review.</p>
        </td></tr>
        <tr><td style="padding:14px 16px;">
          <p style="margin:0 0 3px;font-size:13px;font-weight:700;color:#10b981;">Step 4 — Placement &amp; Support</p>
          <p style="margin:0;font-size:13px;color:#374151;line-height:1.7;">Once you select a candidate, we handle onboarding and provide ongoing support.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>

  <p style="margin:0;color:#374151;font-size:14px;line-height:1.8;">I'll be your dedicated point of contact throughout the process. Let's schedule that first call!</p>
<!-- FOOTER --></td></tr>
${emailFooter()}`),
  },
  {
    name: 'Candidate Introduction',
    subject: 'Candidate Profile for {{company_name}} | {{agency_name}}',
    bodyHtml: emailWrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">{{agency_name}} Staffing Solutions</h1>
  <p style="margin:6px 0 0;color:#bfdbfe;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">Candidate Presentation</p>
</td></tr>
<tr><td style="padding:36px 40px;">
  <p style="margin:0 0 20px;color:#1a1a1a;font-size:15px;line-height:1.7;">Hi <strong>{{contact_name}}</strong>,</p>
  <p style="margin:0 0 24px;color:#374151;font-size:14px;line-height:1.8;">I'm excited to present a strong candidate for the open position at <strong>{{company_name}}</strong>.</p>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    ${sectionHeader('Candidate Profile')}
    <tr><td style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 4px 4px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="120" style="font-size:12px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;padding:2px 0;">Name</td>
            <td style="font-size:13px;color:#1a1a1a;font-weight:600;padding:2px 0;">[Candidate Name]</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="120" style="font-size:12px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;padding:2px 0;">Experience</td>
            <td style="font-size:13px;color:#1a1a1a;padding:2px 0;">[X] years in [field]</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="120" style="font-size:12px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;padding:2px 0;">Key Skills</td>
            <td style="font-size:13px;color:#1a1a1a;padding:2px 0;">[Skill 1], [Skill 2], [Skill 3]</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="120" style="font-size:12px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;padding:2px 0;">Availability</td>
            <td style="font-size:13px;color:#1a1a1a;padding:2px 0;">Immediate / [Date]</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:12px 16px;">
          <p style="margin:0 0 4px;font-size:12px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Summary</p>
          <p style="margin:0;font-size:13px;color:#374151;line-height:1.7;">[Brief candidate summary highlighting relevant experience and qualifications for the role.]</p>
        </td></tr>
      </table>
    </td></tr>
  </table>

  <p style="margin:0;color:#374151;font-size:14px;line-height:1.8;">I believe this candidate would be an excellent fit for your team. Would you like to schedule an interview?</p>
<!-- FOOTER --></td></tr>
${emailFooter()}`),
  },
  {
    name: 'Check-in',
    subject: 'Checking In | Your Staffing Requirements',
    bodyHtml: emailWrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">{{agency_name}} Staffing Solutions</h1>
  <p style="margin:6px 0 0;color:#bfdbfe;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">Checking In</p>
</td></tr>
<tr><td style="padding:36px 40px;">
  <p style="margin:0 0 20px;color:#1a1a1a;font-size:15px;line-height:1.7;">Dear <strong>{{contact_name}}</strong>,</p>
  <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.8;">I hope you are doing well. I wanted to circle back as we had previously connected regarding your staffing needs, and I wanted to check in to see if you are still looking for support in that area.</p>
  <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.8;">We understand that priorities can shift, and we are here whenever you are ready to move forward. At <strong>{{agency_name}}</strong>, we remain committed to providing you with a fast, reliable, and tailored staffing solution that fits your business requirements.</p>
  <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.8;">If there is anything we can clarify or if your needs have changed, please do not hesitate to reach out. We would be happy to revisit the conversation at a time that works best for you.</p>
  <p style="margin:0;color:#374151;font-size:14px;line-height:1.8;">Looking forward to reconnecting.</p>
<!-- FOOTER --></td></tr>
${emailFooter()}`),
  },
];

async function main() {
  for (const t of templates) {
    const updated = await prisma.emailTemplate.updateMany({
      where: { subCompanyId: null, name: t.name },
      data: { subject: t.subject, bodyHtml: t.bodyHtml },
    });
    console.log(`✅ ${t.name}: updated ${updated.count} record(s)`);
  }
  console.log('Done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
