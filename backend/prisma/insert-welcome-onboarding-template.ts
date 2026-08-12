/**
 * One-time script: insert the "Welcome — Operational Contacts" onboarding template.
 * Run with: npx tsx backend/prisma/insert-welcome-onboarding-template.ts
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

const contactRow = (role: string, placeholder: string) => `
    <tr><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;">
      <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.5px;">${role}</p>
      <p style="margin:0;font-size:13px;color:#6b7280;font-style:italic;">${placeholder}</p>
    </td></tr>`;

const requestRow = (text: string) =>
  `<tr><td style="padding:5px 0;color:#374151;font-size:13px;line-height:1.7;">&#8226;&nbsp; ${text}</td></tr>`;

const template = {
  name: 'Welcome — Operational Contacts',
  subject: 'Welcome to {{agency_name}} | Aligning on Operational Contacts',
  bodyHtml: emailWrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">Welcome to {{agency_name}}!</h1>
  <p style="margin:6px 0 0;color:#bfdbfe;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">Aligning on Operational Contacts</p>
</td></tr>
<tr><td style="padding:36px 40px;">
  <p style="margin:0 0 20px;color:#1a1a1a;font-size:15px;line-height:1.7;">Dear <strong>{{contact_name}}</strong>,</p>
  <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.8;">We are pleased to confirm receipt of the signed Staffing Agreement and would like to formally welcome you to the <strong>{{agency_name}}</strong> family. Thank you for placing your trust in us — we look forward to building a strong, long-term partnership with your team.</p>
  <p style="margin:0 0 28px;color:#374151;font-size:14px;line-height:1.8;">Following the completion of our signup, we would like to ensure a smooth and well-coordinated start to our partnership by aligning on key operational contact points between both teams. Clear ownership on each function will help streamline day-to-day activities, from staffing requests through invoicing and onboarding.</p>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr><td style="background:#1e40af;padding:10px 16px;border-radius:4px 4px 0 0;">
      <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">{{agency_name}} — Designated Contacts</p>
    </td></tr>
    <tr><td style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 4px 4px;overflow:hidden;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${contactRow('Accounts (Invoices / Payroll / Timecards)', '[Name] &nbsp;·&nbsp; [Email] &nbsp;·&nbsp; [Phone Number]')}
        ${contactRow('Staffing Requests, Timecards &amp; Recruitment Coordination', '[Name] &nbsp;·&nbsp; [Email] &nbsp;·&nbsp; [Phone Number]')}
        <tr><td style="padding:12px 16px;">
          <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.5px;">Operations &amp; Escalations</p>
          <p style="margin:0;font-size:13px;color:#6b7280;font-style:italic;">[Name] &nbsp;·&nbsp; [Email] &nbsp;·&nbsp; [Phone Number]</p>
        </td></tr>
      </table>
    </td></tr>
  </table>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
    <tr><td style="background:#1e40af;padding:10px 16px;border-radius:4px 4px 0 0;">
      <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">We Kindly Request Your Contacts For</p>
    </td></tr>
    <tr><td style="background:#eff6ff;padding:16px;border-radius:0 0 4px 4px;">
      <table cellpadding="0" cellspacing="0">
        ${requestRow('The individual who will place temporary staffing requests and receive candidate or worker details from our team')}
        ${requestRow('The individual responsible for reviewing, verifying, and approving weekly timecards')}
        ${requestRow('The contact who will receive and process invoices for payment')}
        ${requestRow('The warehouse or on-site contact responsible for welcoming new joiners on their first day and guiding them through employee entrance procedures')}
      </table>
    </td></tr>
  </table>

  <p style="margin:0;color:#374151;font-size:14px;line-height:1.8;">Once these points of contact are confirmed, it will allow both teams to communicate efficiently and avoid any delays during operations. We truly look forward to working closely with your team and supporting your staffing needs every step of the way.</p>
<!-- FOOTER --></td></tr>
${emailFooter()}`),
};

async function main() {
  const existing = await prisma.emailTemplate.findFirst({
    where: { subCompanyId: null, name: template.name },
  });
  if (existing) {
    await prisma.emailTemplate.update({
      where: { id: existing.id },
      data: { subject: template.subject, bodyHtml: template.bodyHtml },
    });
    console.log(`✅ ${template.name}: updated`);
  } else {
    await prisma.emailTemplate.create({
      data: { subCompanyId: null, name: template.name, subject: template.subject, bodyHtml: template.bodyHtml },
    });
    console.log(`✅ ${template.name}: created`);
  }
  console.log('Done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
