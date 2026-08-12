/**
 * One-time script: insert industry-specific outreach email templates.
 * Run with: npx tsx backend/prisma/insert-industry-templates.ts
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

const bullet = (text: string) =>
  `<tr><td style="padding:4px 0;color:#374151;font-size:13px;line-height:1.7;">&#8226;&nbsp; ${text}</td></tr>`;

const whyChooseSection = (bullets: string[]) => `
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr><td style="background:#1e40af;padding:10px 16px;border-radius:4px 4px 0 0;">
      <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Why Choose {{agency_name}}</p>
    </td></tr>
    <tr><td style="background:#eff6ff;padding:16px;border-radius:0 0 4px 4px;">
      <table cellpadding="0" cellspacing="0">
        ${bullets.map(bullet).join('\n        ')}
      </table>
    </td></tr>
  </table>`;

const rateBeatClosing = `  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
    <tr><td style="background:#fef3c7;border-left:4px solid #f59e0b;padding:14px 16px;border-radius:0 4px 4px 0;">
      <p style="margin:0;font-size:13px;color:#374151;line-height:1.7;"><strong>We will beat the rate you are currently paying.</strong> Just share your current bill rate and we will come back with a better deal.</p>
    </td></tr>
  </table>`;

const templates = [
  {
    name: 'Introduction — General Outreach',
    subject: 'Introducing {{agency_name}} | Your Staffing Partner',
    bodyHtml: emailWrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">Introducing {{agency_name}}</h1>
  <p style="margin:6px 0 0;color:#bfdbfe;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">Your Staffing Partner</p>
</td></tr>
<tr><td style="padding:36px 40px;">
  <p style="margin:0 0 20px;color:#1a1a1a;font-size:15px;line-height:1.7;">Hi,</p>
  <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.8;">My name is <strong>{{sender_name}}</strong> and I am reaching out from <strong>{{agency_name}}</strong>, a staffing agency specializing in connecting businesses with reliable, skilled talent across a wide range of industries.</p>
  <p style="margin:0 0 24px;color:#374151;font-size:14px;line-height:1.8;">We understand that finding the right workforce, quickly and reliably, can be one of the biggest operational challenges a business faces. That is exactly where we come in.</p>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr><td style="background:#1e40af;padding:10px 16px;border-radius:4px 4px 0 0;">
      <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Positions We Place</p>
    </td></tr>
    <tr><td style="background:#eff6ff;padding:16px;border-radius:0 0 4px 4px;">
      <table cellpadding="0" cellspacing="0">
        ${bullet('General Labor')}
        ${bullet('Warehouse &amp; Forklift Operators')}
        ${bullet('Machine Operators')}
        ${bullet('Packaging &amp; Production Line Workers')}
      </table>
    </td></tr>
  </table>

  <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.8;">We pride ourselves on quick turnaround times, compliance with labor regulations, and providing 24/7 support to ensure your staffing requirements are met seamlessly.</p>
  <p style="margin:0;color:#374151;font-size:14px;line-height:1.8;">I would be delighted to discuss how <strong>{{agency_name}}</strong> can assist your organization in achieving its workforce goals. Please let me know a convenient time for a conversation.</p>
<!-- FOOTER --></td></tr>
${emailFooter()}`),
  },
  {
    name: 'Food Industry Staffing',
    subject: 'Specialized Food Industry Staffing | {{agency_name}}',
    bodyHtml: emailWrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">{{agency_name}} Staffing Solutions</h1>
  <p style="margin:6px 0 0;color:#bfdbfe;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">Specialized Food Industry Staffing</p>
</td></tr>
<tr><td style="padding:36px 40px;">
  <p style="margin:0 0 20px;color:#1a1a1a;font-size:15px;line-height:1.7;">Good Morning,</p>
  <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.8;"><strong>{{agency_name}}</strong> specializes in providing staffing solutions for the food industry, with expertise in GMP training and experience working in cold and temperature-controlled environments. Our ongoing partnerships with food companies demonstrate our ability to deliver quality, consistency, and compliance.</p>
  <p style="margin:0 0 24px;color:#374151;font-size:14px;line-height:1.8;">We understand the unique demands of food manufacturing, from strict hygiene standards to the physical requirements of working on a fast-paced production floor. Our candidates arrive prepared.</p>

  ${whyChooseSection([
    'Temp-to-Permanent: We supply full-time workers who can be transitioned onto your payroll after 480 hours at no additional cost.',
    'No Part-Time Workers: We understand part-time workers require additional training and can disrupt operations if they leave early.',
    'Low Turnover Rate: Our turnover rate has been less than 8% in 2025.',
    'High Fill Rate: Candidates placed within 24 hours of your request.',
    'GMP Trained Candidates: Every worker we place has a solid understanding of Good Manufacturing Practices, reducing your compliance risk from day one.',
    'Cold Environment Ready: Our candidates are experienced working in refrigerated and freezer environments, so there is no adjustment period.',
    'Food Safety Awareness: Workers are briefed on hygiene protocols, allergen handling, and sanitation standards before they step on your floor.',
    'Criminal Background Check: Every candidate is thoroughly screened before placement.',
    'On-Site Representative: A dedicated coordinator to manage attendance and floor performance.',
    'GTA Coverage: We serve clients in and around the Greater Toronto Area.',
  ])}

  <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.8;">I would love to set up a quick meeting in the coming week to discuss your current staffing needs and share some of our success stories from the food sector.</p>
  ${rateBeatClosing}
  <p style="margin:0;color:#374151;font-size:14px;line-height:1.8;">Looking forward to your response.</p>
<!-- FOOTER --></td></tr>
${emailFooter()}`),
  },
  {
    name: 'Warehouse Staffing',
    subject: 'Reliable Warehouse Staffing Solutions | {{agency_name}}',
    bodyHtml: emailWrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">{{agency_name}} Staffing Solutions</h1>
  <p style="margin:6px 0 0;color:#bfdbfe;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">Reliable Warehouse Staffing</p>
</td></tr>
<tr><td style="padding:36px 40px;">
  <p style="margin:0 0 20px;color:#1a1a1a;font-size:15px;line-height:1.7;">Dear,</p>
  <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.8;"><strong>{{agency_name}}</strong> specializes in staffing solutions for the warehousing sector, with a strong track record of placing reliable general labor workers in fast-paced distribution and fulfillment environments. We understand that in warehousing, every empty position on the floor impacts your output.</p>
  <p style="margin:0 0 24px;color:#374151;font-size:14px;line-height:1.8;">From order picking and packing to forklift operation and inventory management, we have a ready pool of experienced warehouse workers who can hit the ground running.</p>

  ${whyChooseSection([
    'Temp-to-Permanent: We supply full-time workers who can be transitioned onto your payroll after 480 hours at no additional cost.',
    'No Part-Time Workers: We place only committed, full-time candidates to ensure stability on your floor.',
    'Low Turnover Rate: Our turnover rate has been less than 8% in 2025.',
    'High Fill Rate: Candidates placed within 24 hours of your request.',
    'Mass Hiring Capability: We can deploy hundreds of workers across multiple shifts with minimal lead time, ideal for peak seasons and sudden volume increases.',
    'Forklift Certified Workers: We maintain a pool of certified forklift operators ready to be deployed immediately.',
    'Shift Flexibility: We staff for days, afternoons, and overnight shifts to keep your operation running around the clock.',
    'Criminal Background Check: Every candidate is thoroughly screened before placement.',
    'On-Site Representative: A dedicated coordinator to oversee attendance and workforce performance.',
    'GTA Coverage: We serve clients in and around the Greater Toronto Area.',
  ])}

  <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.8;">I would love to set up a quick meeting in the coming week to discuss your staffing needs and share some of our success stories from the warehousing sector.</p>
  ${rateBeatClosing}
  <p style="margin:0;color:#374151;font-size:14px;line-height:1.8;">Looking forward to your response.</p>
<!-- FOOTER --></td></tr>
${emailFooter()}`),
  },
  {
    name: 'Packaging Industry Staffing',
    subject: 'Packaging Industry Staffing Solutions | {{agency_name}}',
    bodyHtml: emailWrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">{{agency_name}} Staffing Solutions</h1>
  <p style="margin:6px 0 0;color:#bfdbfe;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">Packaging Industry Staffing</p>
</td></tr>
<tr><td style="padding:36px 40px;">
  <p style="margin:0 0 20px;color:#1a1a1a;font-size:15px;line-height:1.7;">Good Morning,</p>
  <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.8;"><strong>{{agency_name}}</strong> has extensive experience placing skilled workers in the packaging industry, supporting both high-volume production lines and specialized packaging operations. We know that downtime on a packaging line is costly, and our team is built to respond fast.</p>
  <p style="margin:0 0 24px;color:#374151;font-size:14px;line-height:1.8;">Our candidates are experienced in manual and automated packaging, quality control, line operation, and material handling, ensuring minimal disruption when they join your team.</p>

  ${whyChooseSection([
    'Temp-to-Permanent: We supply full-time workers who can be transitioned onto your payroll after 480 hours at no additional cost.',
    'No Part-Time Workers: We place only committed, full-time candidates who are ready to contribute long-term.',
    'Low Turnover Rate: Our turnover rate has been less than 8% in 2025.',
    'High Fill Rate: Candidates placed within 24 hours of your request.',
    'Production Line Ready: Our workers are experienced in keeping up with the pace of high-speed packaging lines without compromising accuracy.',
    'Quality Control Awareness: Candidates understand the importance of inspection, reject handling, and maintaining product standards.',
    'Machine Operation Experience: We place workers familiar with labeling machines, filling equipment, and wrapping systems, reducing your training time significantly.',
    'Criminal Background Check: Every candidate is thoroughly screened before placement.',
    'On-Site Representative: A dedicated coordinator to manage your workforce on the production floor.',
    'GTA Coverage: We serve clients in and around the Greater Toronto Area.',
  ])}

  <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.8;">I would love to set up a quick meeting in the coming week to discuss your current staffing requirements and share some of our success stories from the packaging sector.</p>
  ${rateBeatClosing}
  <p style="margin:0;color:#374151;font-size:14px;line-height:1.8;">Looking forward to your response.</p>
<!-- FOOTER --></td></tr>
${emailFooter()}`),
  },
  {
    name: 'Automotive Staffing',
    subject: 'Automotive Staffing Solutions | {{agency_name}}',
    bodyHtml: emailWrap(`
<tr><td style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">{{agency_name}} Staffing Solutions</h1>
  <p style="margin:6px 0 0;color:#bfdbfe;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">Automotive Staffing</p>
</td></tr>
<tr><td style="padding:36px 40px;">
  <p style="margin:0 0 20px;color:#1a1a1a;font-size:15px;line-height:1.7;">Good Morning,</p>
  <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.8;"><strong>{{agency_name}}</strong> has a strong history of supporting automotive manufacturers and suppliers with dependable, skilled labor. We understand that precision, safety, and reliability are non-negotiable on the automotive floor, and our staffing process is built around those standards.</p>
  <p style="margin:0 0 24px;color:#374151;font-size:14px;line-height:1.8;">From assembly line operators and machine operators to quality inspectors and material handlers, we place workers who are experienced in the demands of automotive production environments.</p>

  ${whyChooseSection([
    'Temp-to-Permanent: We supply full-time workers who can be transitioned onto your payroll after 480 hours at no additional cost.',
    'No Part-Time Workers: We place only committed, full-time candidates who align with the discipline required in automotive settings.',
    'Low Turnover Rate: Our turnover rate has been less than 8% in 2025.',
    'High Fill Rate: Candidates placed within 24 hours of your request.',
    'Health and Safety Oriented: All candidates are briefed on workplace safety standards and are experienced working in environments where PPE compliance and safety protocols are strictly enforced.',
    'Assembly Line Experience: We place workers who understand production targets, line speed, and the importance of zero defects.',
    'Torque Tool and Equipment Familiarity: Our candidates have hands-on experience with the tools and equipment commonly used in automotive assembly and parts manufacturing.',
    'Criminal Background Check: Every candidate is thoroughly screened before placement.',
    'On-Site Representative: A dedicated coordinator to manage workforce performance and attendance.',
    'GTA Coverage: We serve clients in and around the Greater Toronto Area.',
  ])}

  <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.8;">I would love to set up a quick meeting in the coming week to discuss your staffing needs and walk you through our success stories from the automotive sector.</p>
  ${rateBeatClosing}
  <p style="margin:0;color:#374151;font-size:14px;line-height:1.8;">Looking forward to your response.</p>
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
      console.log(`✅ ${t.name}: updated`);
    } else {
      await prisma.emailTemplate.create({
        data: { subCompanyId: null, name: t.name, subject: t.subject, bodyHtml: t.bodyHtml },
      });
      console.log(`✅ ${t.name}: created`);
    }
  }
  console.log('Done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
