/**
 * One-time script: update the global Follow-up and Check-in email templates
 * to the new newsletter-style versions provided by the client.
 *
 * Run with: npx tsx backend/prisma/update-followup-templates.ts
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

const templates = [
  {
    name: 'Follow-up',
    subject: 'Following Up | {{agency_name}} Staffing Solutions',
    bodyHtml: emailWrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">{{agency_name}} Staffing Solutions</h1>
  <p style="margin:6px 0 0;color:#bfdbfe;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">Following Up</p>
</td></tr>
<tr><td style="padding:36px 40px;">
  <p style="margin:0 0 20px;color:#1a1a1a;font-size:15px;line-height:1.7;">Dear <strong>{{contact_name}}</strong>,</p>
  <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.8;">I wanted to follow up on my previous email regarding our staffing services at <strong>{{agency_name}}</strong>. I understand you may have a busy schedule, so I just wanted to make sure my message did not get lost in the shuffle.</p>
  <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.8;">We would love the opportunity to connect and explore how <strong>{{agency_name}}</strong> can support your workforce needs. Whether it is temporary staffing, temp-to-permanent, or direct placement, we are confident we can add real value to your team.</p>
  <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.8;">Please let me know if you would be available for a brief call or meeting at your convenience. I am happy to work around your schedule.</p>
  <p style="margin:0;color:#374151;font-size:14px;line-height:1.8;">Looking forward to hearing from you.</p>
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
