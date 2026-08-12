/**
 * One-time script: insert/update Temp-to-Permanent, Direct Placement,
 * and Staffing Agreement email templates as global templates (subCompanyId null).
 *
 * Run with: npx tsx backend/prisma/insert-service-rate-templates.ts
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
    name: 'Temp-to-Permanent Rates',
    subject: 'Re: Temp-to-Permanent Staffing Rates & Services | {{agency_name}}',
    bodyHtml: emailWrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">{{agency_name}} Staffing Solutions</h1>
  <p style="margin:6px 0 0;color:#bfdbfe;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">Temp-to-Permanent Service</p>
</td></tr>
<tr><td style="padding:36px 40px;">
  <p style="margin:0 0 20px;color:#1a1a1a;font-size:15px;line-height:1.7;">Dear <strong>{{contact_name}}</strong>,</p>
  <p style="margin:0 0 28px;color:#374151;font-size:14px;line-height:1.8;">Thank you for reaching out and for your interest in <strong>{{agency_name}}</strong> staffing services. I am happy to walk you through our Temp-to-Permanent offering and pricing.</p>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr><td style="background:#1e40af;padding:10px 16px;border-radius:4px 4px 0 0;">
      <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">How It Works</p>
    </td></tr>
    <tr><td style="background:#eff6ff;padding:16px;border-radius:0 0 4px 4px;">
      <p style="margin:0;color:#374151;font-size:14px;line-height:1.8;">Under our Temp-to-Permanent model, the employee starts on agency payroll, giving you a trial period to evaluate fit before making any long-term commitment. After <strong>480 hours worked</strong>, you have the option to bring the employee onto your own payroll permanently at <strong>no additional conversion cost</strong>.</p>
    </td></tr>
  </table>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr><td style="background:#1e40af;padding:10px 16px;border-radius:4px 4px 0 0;">
      <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Our Rates</p>
    </td></tr>
    <tr><td style="background:#eff6ff;padding:16px;border-radius:0 0 4px 4px;">
      <p style="margin:0 0 12px;color:#374151;font-size:14px;line-height:1.8;">We charge <strong>--% + HST</strong> on top of the candidate's hourly wage. This covers:</p>
      <table cellpadding="0" cellspacing="0">
        <tr><td style="padding:3px 0;color:#374151;font-size:13px;line-height:1.7;">&#8226;&nbsp; Mandatory training (WHMIS, H&amp;S)</td></tr>
        <tr><td style="padding:3px 0;color:#374151;font-size:13px;line-height:1.7;">&#8226;&nbsp; Hiring cost coverage</td></tr>
        <tr><td style="padding:3px 0;color:#374151;font-size:13px;line-height:1.7;">&#8226;&nbsp; Payroll coverage</td></tr>
        <tr><td style="padding:3px 0;color:#374151;font-size:13px;line-height:1.7;">&#8226;&nbsp; WSIB coverage</td></tr>
        <tr><td style="padding:3px 0;color:#374151;font-size:13px;line-height:1.7;">&#8226;&nbsp; Comprehensive screening</td></tr>
        <tr><td style="padding:3px 0;color:#374151;font-size:13px;line-height:1.7;">&#8226;&nbsp; Criminal background &amp; reference checks</td></tr>
        <tr><td style="padding:3px 0;color:#374151;font-size:13px;line-height:1.7;">&#8226;&nbsp; 24/7 recruitment support</td></tr>
      </table>
    </td></tr>
  </table>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
    <tr>
      <td width="50%" style="padding:12px 16px;background:#f1f5f9;border-radius:4px 0 0 4px;border-right:2px solid #fff;">
        <p style="margin:0 0 2px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Payment Terms</p>
        <p style="margin:0;font-size:14px;font-weight:700;color:#1e40af;">15 Days</p>
      </td>
      <td width="50%" style="padding:12px 16px;background:#f1f5f9;border-radius:0 4px 4px 0;">
        <p style="margin:0 0 2px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Turnaround Time</p>
        <p style="margin:0;font-size:14px;font-weight:700;color:#1e40af;">Within 24 Hours</p>
      </td>
    </tr>
  </table>

  <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.8;">This model is especially popular with clients who want the flexibility to assess a worker's performance before fully committing, while keeping their administrative burden low in the meantime.</p>
  <p style="margin:0;color:#374151;font-size:14px;line-height:1.8;">I would be happy to set up a quick call to discuss your specific staffing needs and answer any other questions you may have.</p>
<!-- FOOTER --></td></tr>
${emailFooter()}`),
  },
  {
    name: 'Direct Placement Rates',
    subject: 'Re: Direct Placement Staffing Rates & Services | {{agency_name}}',
    bodyHtml: emailWrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">{{agency_name}} Staffing Solutions</h1>
  <p style="margin:6px 0 0;color:#bfdbfe;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">Direct Placement Service</p>
</td></tr>
<tr><td style="padding:36px 40px;">
  <p style="margin:0 0 20px;color:#1a1a1a;font-size:15px;line-height:1.7;">Dear <strong>{{contact_name}}</strong>,</p>
  <p style="margin:0 0 28px;color:#374151;font-size:14px;line-height:1.8;">Thank you for your interest in <strong>{{agency_name}}</strong> staffing solutions. Please find below the details of our Direct Placement (Permanent Placement) service, along with our pricing structure.</p>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr><td style="background:#1e40af;padding:10px 16px;border-radius:4px 4px 0 0;">
      <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">How It Works</p>
    </td></tr>
    <tr><td style="background:#eff6ff;padding:16px;border-radius:0 0 4px 4px;">
      <p style="margin:0;color:#374151;font-size:14px;line-height:1.8;">Our Direct Placement service is designed for businesses looking to hire full-time employees directly onto their own payroll from Day 1. We manage the entire process, including headhunting, screening, and onboarding, so you only meet candidates who are ready to join your team.</p>
    </td></tr>
  </table>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr><td style="background:#1e40af;padding:10px 16px;border-radius:4px 4px 0 0;">
      <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Our Rates</p>
    </td></tr>
    <tr><td style="background:#eff6ff;padding:16px;border-radius:0 0 4px 4px;">
      <p style="margin:0 0 12px;color:#374151;font-size:14px;line-height:1.8;">We charge a one-time placement fee of <strong>--% of the candidate's annual base salary</strong>, billed in two parts:</p>
      <table cellpadding="0" cellspacing="0">
        <tr><td style="padding:3px 0;color:#374151;font-size:13px;line-height:1.7;">&#8226;&nbsp; <strong>50%</strong> on the date of joining</td></tr>
        <tr><td style="padding:3px 0;color:#374151;font-size:13px;line-height:1.7;">&#8226;&nbsp; <strong>50%</strong> after successful completion of 3 months</td></tr>
      </table>
    </td></tr>
  </table>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr><td style="background:#1e40af;padding:10px 16px;border-radius:4px 4px 0 0;">
      <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">What Is Included</p>
    </td></tr>
    <tr><td style="background:#eff6ff;padding:16px;border-radius:0 0 4px 4px;">
      <table cellpadding="0" cellspacing="0">
        <tr><td style="padding:3px 0;color:#374151;font-size:13px;line-height:1.7;">&#8226;&nbsp; Candidate sourcing and headhunting</td></tr>
        <tr><td style="padding:3px 0;color:#374151;font-size:13px;line-height:1.7;">&#8226;&nbsp; Resume screening and candidate evaluation</td></tr>
        <tr><td style="padding:3px 0;color:#374151;font-size:13px;line-height:1.7;">&#8226;&nbsp; Criminal background and reference checks</td></tr>
        <tr><td style="padding:3px 0;color:#374151;font-size:13px;line-height:1.7;">&#8226;&nbsp; Interview coordination and scheduling</td></tr>
        <tr><td style="padding:3px 0;color:#374151;font-size:13px;line-height:1.7;">&#8226;&nbsp; Onboarding assistance</td></tr>
        <tr><td style="padding:3px 0;color:#374151;font-size:13px;line-height:1.7;">&#8226;&nbsp; 3-Month Placement Guarantee</td></tr>
      </table>
      <p style="margin:12px 0 0;color:#64748b;font-size:12px;font-style:italic;">Note: There is no charge for resume review or interviews. Fees apply only upon a successful hire.</p>
    </td></tr>
  </table>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
    <tr><td style="background:#fef3c7;border-left:4px solid #f59e0b;padding:14px 16px;border-radius:0 4px 4px 0;">
      <p style="margin:0 0 2px;font-size:12px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.5px;">Placement Guarantee</p>
      <p style="margin:0;font-size:13px;color:#374151;line-height:1.7;">If the candidate resigns or is terminated within the first three months, we provide one <strong>free replacement</strong> at no additional cost.</p>
    </td></tr>
  </table>

  <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.8;">This model works well for businesses looking to make a long-term hire without taking on the time and resources required to run the search internally.</p>
  <p style="margin:0;color:#374151;font-size:14px;line-height:1.8;">I would be happy to schedule a quick call to discuss your hiring needs in more detail.</p>
<!-- FOOTER --></td></tr>
${emailFooter()}`),
  },
  {
    name: 'Staffing Agreement',
    subject: '{{agency_name}} | Staffing Agreement for Your Signature',
    bodyHtml: emailWrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">{{agency_name}} Staffing Solutions</h1>
  <p style="margin:6px 0 0;color:#bfdbfe;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">Staffing Agreement</p>
</td></tr>
<tr><td style="padding:36px 40px;">
  <p style="margin:0 0 20px;color:#1a1a1a;font-size:15px;line-height:1.7;">Dear <strong>{{contact_name}}</strong>,</p>
  <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.8;">Thank you for choosing <strong>{{agency_name}}</strong> as your staffing partner. Please find attached the Staffing Agreement for your review.</p>
  <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.8;">Kindly review the terms and conditions outlined in the document. Once you are satisfied, please sign and send it back to us at your earliest convenience.</p>
  <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.8;">Upon receiving the signed copy, we will move forward by introducing you to our Recruitment Manager, who will begin presenting suitable candidate profiles for your review.</p>
  <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.8;">If you have any questions or need clarification on any clause of the agreement, please feel free to reach out. I am happy to assist.</p>
  <p style="margin:0;color:#374151;font-size:14px;line-height:1.8;">Looking forward to receiving the signed agreement and beginning our partnership.</p>
<!-- FOOTER --></td></tr>
${emailFooter()}`),
  },
];

async function main() {
  for (const t of templates) {
    const existing = await prisma.emailTemplate.findFirst({
      where: { subCompanyId: null, name: t.name },
    });
    if (existing) {
      await prisma.emailTemplate.update({
        where: { id: existing.id },
        data: { subject: t.subject, bodyHtml: t.bodyHtml },
      });
      console.log(`✅ ${t.name}: updated existing record`);
    } else {
      await prisma.emailTemplate.create({
        data: { subCompanyId: null, name: t.name, subject: t.subject, bodyHtml: t.bodyHtml },
      });
      console.log(`✅ ${t.name}: created new record`);
    }
  }
  console.log('Done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
