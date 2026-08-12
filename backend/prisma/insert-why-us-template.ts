/**
 * One-time script: insert the "Why Us" company overview email template.
 * Run with: npx tsx backend/prisma/insert-why-us-template.ts
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

const differentiator = (title: string, body: string) =>
  `<tr><td style="padding:12px 0;border-bottom:1px solid #e2e8f0;">
    <p style="margin:0 0 3px;font-size:13px;font-weight:700;color:#1e40af;">${title}</p>
    <p style="margin:0;font-size:13px;color:#374151;line-height:1.7;">${body}</p>
  </td></tr>`;

const template = {
  name: 'Why Choose Us — Company Overview',
  subject: 'Why {{agency_name}} | Unmatched Staffing Solutions Across Canada',
  bodyHtml: emailWrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">{{agency_name}} Staffing Solutions</h1>
  <p style="margin:6px 0 0;color:#bfdbfe;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">Unmatched Staffing Solutions Across Canada</p>
</td></tr>
<tr><td style="padding:36px 40px;">
  <p style="margin:0 0 28px;color:#374151;font-size:14px;line-height:1.8;">Dear,</p>
  <p style="margin:0 0 28px;color:#374151;font-size:14px;line-height:1.8;">Thank you for taking the time to consider <strong>{{agency_name}}</strong> as your staffing partner. I'd like to share an overview of what sets us apart and why leading organizations across Canada trust us to meet their workforce needs.</p>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr><td style="background:#1e40af;padding:10px 16px;border-radius:4px 4px 0 0;">
      <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Who We Are</p>
    </td></tr>
    <tr><td style="background:#eff6ff;padding:16px;border-radius:0 0 4px 4px;">
      <p style="margin:0;color:#374151;font-size:14px;line-height:1.8;"><strong>{{agency_name}}</strong> is a specialized staffing firm with over 10 years of industry experience, focused on general labor, logistics, and warehousing. We combine a robust talent pipeline with a data-driven recruitment process to deliver fast, reliable, and scalable workforce solutions.</p>
    </td></tr>
  </table>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr><td style="background:#1e40af;padding:10px 16px;border-radius:4px 4px 0 0;">
      <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">What Makes Us Different</p>
    </td></tr>
    <tr><td style="background:#ffffff;border:1px solid #e2e8f0;border-top:none;padding:0 16px;border-radius:0 0 4px 4px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${differentiator('Extensive Talent Pool', 'We maintain a vast, up-to-date database of pre-screened candidates, allowing us to match the right people to the right roles based on skill, availability, and location in record time.')}
        ${differentiator('Exceptional Speed &amp; Fill Rate', 'Our streamlined process enables us to fill general labor positions in under 24 hours, ensuring your operations run without interruption even during peak seasons or unexpected surges.')}
        ${differentiator('Rigorous Screening', 'Every candidate undergoes a thorough vetting process, including criminal background checks and reference verification, so you receive only reliable, qualified individuals.')}
        ${differentiator('On-Site Management &amp; Support', 'Our dedicated on-site coordinators integrate seamlessly with your team, managing day-to-day workforce operations and providing daily attendance updates so you\'re always informed.')}
        ${differentiator('Attendance &amp; Retention Strategy', 'We implement proactive measures to minimize no-shows and turnover, delivering a stable, consistent workforce you can count on.')}
        ${differentiator('Pre-Assignment Training', 'Candidates are trained to your specific operational requirements before they arrive, reducing onboarding time and improving productivity from day one.')}
        ${differentiator('Flexible &amp; Scalable Deployments', 'From a handful of workers to hundreds across multiple shifts, we scale to meet your needs nationwide.')}
        ${differentiator('Competitive &amp; Transparent Pricing', 'Our cost-effective models and flexible payment terms (including 30-day windows and split billing for direct placements) are designed to work with your budget, not against it.')}
        ${differentiator('24/7 Availability', 'Our support team is available around the clock, weekdays, weekends, and holidays, for both urgent needs and routine inquiries.')}
        ${differentiator('Compliance &amp; Risk Management', 'All our staffing practices adhere to applicable legal and regulatory standards, giving you peace of mind at every step.')}
        <tr><td style="padding:12px 0;">
          <p style="margin:0 0 3px;font-size:13px;font-weight:700;color:#1e40af;">Workforce Intelligence</p>
          <p style="margin:0;font-size:13px;color:#374151;line-height:1.7;">We provide customized reports, labor market analysis, and regular performance reviews to help you make informed, strategic staffing decisions.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
    <tr><td style="background:#eff6ff;border-left:4px solid #1e40af;padding:16px 20px;border-radius:0 4px 4px 0;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.5px;">Our Commitment</p>
      <p style="margin:0;font-size:13px;color:#374151;line-height:1.7;">At <strong>{{agency_name}}</strong>, we don't just fill positions — we build partnerships. Our goal is to understand your unique operational needs and deliver a workforce solution that drives real results.</p>
    </td></tr>
  </table>

  <p style="margin:0;color:#374151;font-size:14px;line-height:1.8;">I would welcome the opportunity to connect and explore how <strong>{{agency_name}}</strong> can add value to your organization. Please feel free to reach out at your convenience to schedule a brief call or meeting.</p>
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
