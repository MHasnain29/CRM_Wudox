// Professional email starter templates for Wudox CRM
// All templates use inline CSS + table-based layout for email client compatibility

export interface StarterTemplate {
  key: string;
  name: string;
  description: string;
  category: 'outreach' | 'follow-up' | 'meeting' | 'proposal' | 'notification' | 'marketing' | 'general';
  subject: string;
  html: string;
}

const wrap = (body: string, headerBg = '#1e40af') => `<!DOCTYPE html>
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

const header = (title: string, subtitle?: string, bg = '#1e40af') =>
  `<tr><td style="background:${bg};padding:24px 32px;">
  <h1 style="margin:0;color:#fff;font-size:20px;font-weight:600;">${title}</h1>
  ${subtitle ? `<p style="margin:4px 0 0;color:#93c5fd;font-size:13px;">${subtitle}</p>` : ''}
</td></tr>`;

const heroHeader = (title: string, subtitle: string, bg = 'linear-gradient(135deg,#1e40af,#3b82f6)') =>
  `<tr><td style="background:${bg};padding:40px 32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:28px;font-weight:700;">${title}</h1>
  <p style="margin:8px 0 0;color:#bfdbfe;font-size:15px;">${subtitle}</p>
</td></tr>`;

const footer = (text = '{{agency_footer}}') =>
  `<tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
  <p style="margin:0;color:#94a3b8;font-size:11px;text-align:center;">${text}</p>
</td></tr>`;

const cta = (label: string, color = '#1e40af') =>
  `<table cellpadding="0" cellspacing="0"><tr><td style="background:${color};border-radius:6px;padding:12px 28px;">
  <a href="#" style="color:#fff;text-decoration:none;font-size:14px;font-weight:600;">${label}</a>
</td></tr></table>`;

// Signature is now auto-injected by the backend from agency Settings → Auto-Signature
const signature = '';

export const starterTemplates: StarterTemplate[] = [
  // ───────── BLANK ─────────
  {
    key: 'blank',
    name: 'Blank',
    description: 'Empty body with agency header and footer',
    category: 'general',
    subject: '',
    html: wrap(`
${header('{{agency_name}}')}
<tr><td style="padding:32px;">
  <p style="margin:0;color:#4a4a4a;font-size:14px;line-height:1.7;">&nbsp;</p>
</td></tr>
${footer()}
`),
  },

  // ───────── FOLLOW-UP ─────────
  {
    key: 'follow-up',
    name: 'Follow-up',
    description: 'Professional follow-up email with CTA button',
    category: 'follow-up',
    subject: 'Following up on our conversation — {{company_name}}',
    html: wrap(`
${header('Wudox', 'Talent Solutions')}
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
  ${cta('Schedule a Call')}
  ${signature}
</td></tr>
${footer()}
`),
  },

  // ───────── INTRODUCTION / COLD OUTREACH ─────────
  {
    key: 'introduction',
    name: 'Introduction',
    description: 'First contact / cold outreach with stats',
    category: 'outreach',
    subject: 'Staffing solutions for {{company_name}}',
    html: wrap(`
${heroHeader('Wudox', 'Your Trusted Staffing Partner')}
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
  <div style="text-align:center;">${cta("Let's Connect")}</div>
  ${signature}
</td></tr>
${footer()}
`),
  },

  // ───────── MEETING CONFIRMATION ─────────
  {
    key: 'meeting-confirmation',
    name: 'Meeting Confirmation',
    description: 'Meeting details card with date, time, location',
    category: 'meeting',
    subject: 'Meeting confirmed — {{contact_name}}',
    html: wrap(`
${header('Wudox')}
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
  <p style="margin:16px 0 0;color:#4a4a4a;font-size:14px;">Best,<br><strong>{{sender_name}}</strong></p>
</td></tr>
${footer()}
`),
  },

  // ───────── PROPOSAL DELIVERY ─────────
  {
    key: 'proposal',
    name: 'Proposal Delivery',
    description: 'Formal proposal email with key metrics',
    category: 'proposal',
    subject: 'Your staffing proposal is ready — {{company_name}}',
    html: wrap(`
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
  ${cta('View Full Proposal')}
  <p style="margin:24px 0 0;color:#4a4a4a;font-size:14px;">Regards,<br><strong>{{sender_name}}</strong><br><span style="color:#71717a;">{{sender_title}}</span></p>
</td></tr>
${footer('{{agency_footer}} · This proposal is confidential and intended solely for {{company_name}}')}
`),
  },

  // ───────── NEWSLETTER ─────────
  {
    key: 'newsletter',
    name: 'Newsletter',
    description: 'Multi-section newsletter with hero and 3-column grid',
    category: 'marketing',
    subject: 'Monthly Workforce Insights — Wudox',
    html: wrap(`
<tr><td style="background:#1e40af;padding:20px 32px;text-align:center;">
  <h1 style="margin:0;color:#fff;font-size:20px;">Wudox Newsletter</h1>
</td></tr>
<tr><td style="background:linear-gradient(135deg,#1e3a5f,#2563eb);padding:40px 32px;text-align:center;">
  <h2 style="margin:0;color:#fff;font-size:22px;font-weight:700;">Monthly Workforce Insights</h2>
  <p style="margin:8px 0 0;color:#bfdbfe;font-size:14px;">Industry trends, tips, and staffing updates</p>
</td></tr>
<tr><td style="padding:32px;">
  <h3 style="margin:0 0 12px;color:#1a1a1a;font-size:16px;">This Month's Highlights</h3>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
    <tr>
      <td width="33%" style="padding:8px;vertical-align:top;">
        <div style="background:#f8fafc;border-radius:8px;padding:16px;text-align:center;min-height:100px;">
          <p style="margin:0;font-size:28px;">📈</p>
          <p style="margin:8px 0 0;font-size:13px;font-weight:600;color:#1a1a1a;">Market Report</p>
          <p style="margin:4px 0 0;font-size:11px;color:#71717a;">Q1 hiring trends</p>
        </div>
      </td>
      <td width="33%" style="padding:8px;vertical-align:top;">
        <div style="background:#f8fafc;border-radius:8px;padding:16px;text-align:center;min-height:100px;">
          <p style="margin:0;font-size:28px;">💡</p>
          <p style="margin:8px 0 0;font-size:13px;font-weight:600;color:#1a1a1a;">Best Practices</p>
          <p style="margin:4px 0 0;font-size:11px;color:#71717a;">Retention strategies</p>
        </div>
      </td>
      <td width="33%" style="padding:8px;vertical-align:top;">
        <div style="background:#f8fafc;border-radius:8px;padding:16px;text-align:center;min-height:100px;">
          <p style="margin:0;font-size:28px;">🏆</p>
          <p style="margin:8px 0 0;font-size:13px;font-weight:600;color:#1a1a1a;">Success Story</p>
          <p style="margin:4px 0 0;font-size:11px;color:#71717a;">Client spotlight</p>
        </div>
      </td>
    </tr>
  </table>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">Hi {{contact_name}}, here's your monthly dose of workforce insights from Wudox. We've compiled the latest trends and tips to help {{company_name}} stay ahead.</p>
  <div style="text-align:center;">${cta('Read More')}</div>
</td></tr>
<tr><td style="background:#0f172a;padding:24px 32px;text-align:center;">
  <p style="margin:0 0 8px;color:#94a3b8;font-size:12px;">{{agency_footer}}</p>
  <p style="margin:0;color:#64748b;font-size:11px;">You received this because you're subscribed to our newsletter.</p>
</td></tr>
`),
  },

  // ───────── THANK YOU ─────────
  {
    key: 'thank-you',
    name: 'Thank You',
    description: 'Post-meeting or post-call thank you note',
    category: 'follow-up',
    subject: 'Thank you for your time — {{sender_name}}',
    html: wrap(`
${header('Wudox', 'Talent Solutions')}
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
  ${cta('View Our Services')}
  ${signature}
</td></tr>
${footer()}
`),
  },

  // ───────── MEETING REMINDER ─────────
  {
    key: 'meeting-reminder',
    name: 'Meeting Reminder',
    description: 'Gentle reminder before a scheduled meeting',
    category: 'meeting',
    subject: 'Reminder: Our meeting is tomorrow — {{sender_name}}',
    html: wrap(`
${header('Wudox')}
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
${footer()}
`),
  },

  // ───────── JOB CANDIDATE INTRO ─────────
  {
    key: 'candidate-intro',
    name: 'Candidate Introduction',
    description: 'Introduce a candidate to a client with profile summary',
    category: 'notification',
    subject: 'Candidate profile for {{company_name}} — Wudox',
    html: wrap(`
${header('Wudox', 'Candidate Presentation')}
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
  ${cta('Schedule Interview')}
  ${signature}
</td></tr>
${footer()}
`),
  },

  // ───────── WELCOME / ONBOARDING ─────────
  {
    key: 'welcome',
    name: 'Welcome / Onboarding',
    description: 'Welcome email for new clients with next steps',
    category: 'outreach',
    subject: 'Welcome to Wudox — Let\'s get started!',
    html: wrap(`
${heroHeader('Welcome to Wudox!', 'We\'re excited to partner with you')}
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
      <p style="margin:0;color:#15803d;font-size:13px;font-weight:600;">Step 4 — Placement & Support</p>
      <p style="margin:4px 0 0;color:#4a4a4a;font-size:13px;">Once you select a candidate, we handle onboarding and provide ongoing support.</p>
    </td></tr>
  </table>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">I'll be your dedicated point of contact throughout the process. Let's schedule that first call!</p>
  <div style="text-align:center;">${cta('Book Discovery Call')}</div>
  ${signature}
</td></tr>
${footer()}
`),
  },

  // ───────── CHECK-IN ─────────
  {
    key: 'check-in',
    name: 'Check-in',
    description: 'Periodic check-in with existing clients',
    category: 'follow-up',
    subject: 'Checking in — How\'s everything going, {{contact_name}}?',
    html: wrap(`
${header('Wudox', 'Talent Solutions')}
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
  ${cta('Schedule a Quick Call')}
  ${signature}
</td></tr>
${footer()}
`),
  },

  // ───────── INVOICE / PAYMENT REMINDER ─────────
  {
    key: 'payment-reminder',
    name: 'Payment Reminder',
    description: 'Professional invoice or payment reminder',
    category: 'notification',
    subject: 'Payment reminder — Invoice #[INV-NUMBER]',
    html: wrap(`
${header('Wudox', 'Accounts Department')}
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
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">If payment has already been sent, please disregard this reminder. If you have any questions about this invoice, don't hesitate to reach out.</p>
  ${cta('View Invoice')}
  <p style="margin:24px 0 0;color:#4a4a4a;font-size:14px;">Thank you,<br><strong>Wudox Accounts</strong></p>
</td></tr>
${footer()}
`),
  },

  // ───────── SEASONAL HIRING ─────────
  {
    key: 'seasonal-hiring',
    name: 'Seasonal Hiring',
    description: 'Promote seasonal staffing solutions',
    category: 'marketing',
    subject: 'Prepare for peak season — Staffing solutions from Wudox',
    html: wrap(`
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
  <div style="text-align:center;">${cta('Plan Your Staffing', '#ea580c')}</div>
  ${signature}
</td></tr>
${footer()}
`),
  },

  // ───────── RE-ENGAGEMENT ─────────
  {
    key: 're-engagement',
    name: 'Re-engagement',
    description: 'Win back inactive clients',
    category: 'outreach',
    subject: 'We miss working with {{company_name}}!',
    html: wrap(`
${header('Wudox', 'Talent Solutions')}
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hi {{contact_name}},</h2>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">It's been a while since we last connected, and I wanted to reach out. A lot has changed at Wudox, and we'd love the chance to work with <strong>{{company_name}}</strong> again.</p>
  <div style="background:#eff6ff;border-radius:8px;padding:24px;margin:0 0 24px;">
    <p style="margin:0 0 12px;color:#1e40af;font-size:15px;font-weight:600;">What's new at Wudox:</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:6px 0;font-size:13px;color:#4a4a4a;">✅ Expanded our talent pool across new industries</td></tr>
      <tr><td style="padding:6px 0;font-size:13px;color:#4a4a4a;">✅ Faster placement times — average 48-hour turnaround</td></tr>
      <tr><td style="padding:6px 0;font-size:13px;color:#4a4a4a;">✅ Enhanced candidate vetting and screening process</td></tr>
      <tr><td style="padding:6px 0;font-size:13px;color:#4a4a4a;">✅ Dedicated account management for returning clients</td></tr>
    </table>
  </div>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">I'd love to reconnect and see how we can support your current staffing needs. How about a quick 10-minute call this week?</p>
  <div style="text-align:center;">${cta("Let's Reconnect")}</div>
  ${signature}
</td></tr>
${footer()}
`),
  },

  // ───────── REFERRAL REQUEST ─────────
  {
    key: 'referral',
    name: 'Referral Request',
    description: 'Ask for referrals from satisfied clients',
    category: 'follow-up',
    subject: 'Know someone who needs staffing help?',
    html: wrap(`
${header('Wudox', 'Talent Solutions')}
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hi {{contact_name}},</h2>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">Thank you for being a valued client of Wudox. We've really enjoyed working with <strong>{{company_name}}</strong> and are glad we could help build your team.</p>
  <div style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border-radius:12px;padding:28px;margin:0 0 24px;text-align:center;">
    <p style="margin:0;font-size:32px;">🤝</p>
    <p style="margin:12px 0 4px;color:#1e40af;font-size:18px;font-weight:700;">Refer & Reward</p>
    <p style="margin:0;color:#4a4a4a;font-size:13px;line-height:1.6;">Know a business that could benefit from our staffing services?<br>We'd love an introduction — and we'll make it worth your while.</p>
  </div>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">Simply reply with their name and contact info, or forward this email. We'll take it from there and keep you in the loop.</p>
  <div style="text-align:center;">${cta('Refer a Business')}</div>
  ${signature}
</td></tr>
${footer()}
`),
  },

  // ───────── JOB OPENING ANNOUNCEMENT ─────────
  {
    key: 'job-opening',
    name: 'Job Opening',
    description: 'Announce an open position to your network',
    category: 'marketing',
    subject: 'We\'re hiring! {{company_name}} is looking for top talent',
    html: wrap(`
${header('Wudox', 'Job Opportunity')}
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
    <li>[Requirement 1]</li>
    <li>[Requirement 2]</li>
    <li>[Requirement 3]</li>
  </ul>
  <div style="text-align:center;">${cta('Apply Now')}</div>
  <p style="margin:24px 0 0;color:#71717a;font-size:12px;text-align:center;">Know someone who'd be great? Forward this email to them!</p>
</td></tr>
${footer()}
`),
  },

  // ───────── PLACEMENT CONFIRMATION ─────────
  {
    key: 'placement-confirmation',
    name: 'Placement Confirmation',
    description: 'Confirm a successful candidate placement with the client',
    category: 'notification',
    subject: 'Placement confirmed — {{company_name}}',
    html: wrap(`
${header('Wudox', 'Placement Update')}
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
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">We'll be in touch during the onboarding period to ensure everything goes smoothly. Please don't hesitate to reach out if you need anything.</p>
  ${signature}
</td></tr>
${footer()}
`),
  },

  // ───────── CONTRACT RENEWAL ─────────
  {
    key: 'contract-renewal',
    name: 'Contract Renewal',
    description: 'Remind clients about upcoming contract renewals',
    category: 'notification',
    subject: 'Your staffing contract is up for renewal — {{company_name}}',
    html: wrap(`
${header('Wudox', 'Contract Services')}
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hi {{contact_name}},</h2>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">I'm writing to let you know that your staffing contract with Wudox is approaching its renewal date.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;overflow:hidden;margin:0 0 24px;">
    <tr><td style="padding:20px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="120" style="color:#92400e;font-size:13px;padding:6px 0;font-weight:600;">Contract:</td>
          <td style="color:#1a1a1a;font-size:13px;padding:6px 0;">{{company_name}} — Staffing Services</td>
        </tr>
        <tr>
          <td style="color:#92400e;font-size:13px;padding:6px 0;font-weight:600;">Expires:</td>
          <td style="color:#1a1a1a;font-size:13px;padding:6px 0;font-weight:700;">[Expiry Date]</td>
        </tr>
        <tr>
          <td style="color:#92400e;font-size:13px;padding:6px 0;font-weight:600;">Action needed:</td>
          <td style="color:#1a1a1a;font-size:13px;padding:6px 0;">Review &amp; renew before expiry</td>
        </tr>
      </table>
    </td></tr>
  </table>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">We've enjoyed working with <strong>{{company_name}}</strong> and would love to continue our partnership. I'd like to schedule a quick call to discuss renewal terms and any adjustments to better serve your needs.</p>
  ${cta('Schedule Renewal Call')}
  ${signature}
</td></tr>
${footer()}
`),
  },

  // ───────── HOLIDAY GREETING ─────────
  {
    key: 'holiday-greeting',
    name: 'Holiday Greeting',
    description: 'Seasonal holiday greeting to clients and contacts',
    category: 'marketing',
    subject: 'Happy Holidays from Wudox!',
    html: wrap(`
<tr><td style="background:linear-gradient(135deg,#0f172a,#1e3a5f);padding:48px 32px;text-align:center;">
  <p style="margin:0 0 8px;font-size:36px;">🎄</p>
  <h1 style="margin:0;color:#fff;font-size:26px;font-weight:700;">Happy Holidays!</h1>
  <p style="margin:12px 0 0;color:#94a3b8;font-size:15px;">From all of us at Wudox</p>
</td></tr>
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Dear {{contact_name}},</h2>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">As the year comes to a close, we want to take a moment to express our sincere gratitude for the partnership we've built with <strong>{{company_name}}</strong>.</p>
  <div style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border-radius:12px;padding:28px;margin:0 0 24px;text-align:center;">
    <p style="margin:0;color:#1e40af;font-size:16px;font-weight:600;line-height:1.6;">Wishing you and your team a wonderful holiday season<br>and a prosperous New Year!</p>
  </div>
  <p style="margin:0 0 16px;color:#4a4a4a;font-size:14px;line-height:1.7;">We look forward to continuing to support your staffing needs in the year ahead. Our offices will be closed from [Date] to [Date] and we'll be back refreshed and ready to help.</p>
  <p style="margin:0;color:#4a4a4a;font-size:14px;line-height:1.7;">Warm regards,<br><strong>The Wudox Team</strong></p>
</td></tr>
<tr><td style="background:#0f172a;padding:24px 32px;text-align:center;">
  <p style="margin:0;color:#94a3b8;font-size:12px;">{{agency_footer}}</p>
  <p style="margin:8px 0 0;color:#64748b;font-size:11px;">Thank you for a great year!</p>
</td></tr>
`),
  },

  // ───────── SERVICE OVERVIEW ─────────
  {
    key: 'service-overview',
    name: 'Service Overview',
    description: 'Showcase all staffing services with icons',
    category: 'outreach',
    subject: 'How Wudox can help {{company_name}}',
    html: wrap(`
${heroHeader('Wudox', 'Complete Staffing Solutions')}
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hi {{contact_name}},</h2>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">I wanted to share an overview of how Wudox can support <strong>{{company_name}}</strong> across all your workforce needs.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
    <tr>
      <td width="50%" style="padding:8px;vertical-align:top;">
        <div style="border:1px solid #e2e8f0;border-radius:8px;padding:20px;min-height:120px;">
          <p style="margin:0;font-size:24px;">👥</p>
          <p style="margin:8px 0 4px;font-size:14px;font-weight:600;color:#1a1a1a;">Temporary Staffing</p>
          <p style="margin:0;font-size:12px;color:#71717a;line-height:1.5;">Flexible workforce solutions for seasonal demands, projects, or coverage needs.</p>
        </div>
      </td>
      <td width="50%" style="padding:8px;vertical-align:top;">
        <div style="border:1px solid #e2e8f0;border-radius:8px;padding:20px;min-height:120px;">
          <p style="margin:0;font-size:24px;">🎯</p>
          <p style="margin:8px 0 4px;font-size:14px;font-weight:600;color:#1a1a1a;">Direct Hire</p>
          <p style="margin:0;font-size:12px;color:#71717a;line-height:1.5;">Full recruitment for permanent positions. We find, screen, and present top talent.</p>
        </div>
      </td>
    </tr>
    <tr>
      <td width="50%" style="padding:8px;vertical-align:top;">
        <div style="border:1px solid #e2e8f0;border-radius:8px;padding:20px;min-height:120px;">
          <p style="margin:0;font-size:24px;">📋</p>
          <p style="margin:8px 0 4px;font-size:14px;font-weight:600;color:#1a1a1a;">Temp-to-Hire</p>
          <p style="margin:0;font-size:12px;color:#71717a;line-height:1.5;">Try before you commit. Evaluate candidates on the job before making a permanent offer.</p>
        </div>
      </td>
      <td width="50%" style="padding:8px;vertical-align:top;">
        <div style="border:1px solid #e2e8f0;border-radius:8px;padding:20px;min-height:120px;">
          <p style="margin:0;font-size:24px;">⚙️</p>
          <p style="margin:8px 0 4px;font-size:14px;font-weight:600;color:#1a1a1a;">Workforce Management</p>
          <p style="margin:0;font-size:12px;color:#71717a;line-height:1.5;">End-to-end payroll, compliance, and HR support for your contingent workforce.</p>
        </div>
      </td>
    </tr>
  </table>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">Let me know which service interests you most — I'd love to walk you through how we can customize a solution for {{company_name}}.</p>
  <div style="text-align:center;">${cta('Get a Custom Quote')}</div>
  ${signature}
</td></tr>
${footer()}
`),
  },

  // ───────── TESTIMONIAL / CASE STUDY ─────────
  {
    key: 'case-study',
    name: 'Case Study',
    description: 'Share a success story or client testimonial',
    category: 'marketing',
    subject: 'How we helped a company like {{company_name}} — Wudox',
    html: wrap(`
${header('Wudox', 'Success Story')}
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hi {{contact_name}},</h2>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">I wanted to share a recent success story that I think resonates with what <strong>{{company_name}}</strong> is going through right now.</p>
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
    <div style="border-left:3px solid #3b82f6;padding-left:16px;margin-top:16px;">
      <p style="margin:0;color:#4a4a4a;font-size:13px;font-style:italic;line-height:1.6;">"Wudox completely transformed our hiring process. They understood our culture and delivered candidates that fit perfectly."</p>
      <p style="margin:8px 0 0;color:#64748b;font-size:12px;font-weight:600;">— [Client Name], [Title]</p>
    </div>
  </div>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">I'd love to achieve similar results for {{company_name}}. Can we schedule a quick call to discuss?</p>
  <div style="text-align:center;">${cta("Let's Talk")}</div>
  ${signature}
</td></tr>
${footer()}
`),
  },

  // ───────── SURVEY / FEEDBACK REQUEST ─────────
  {
    key: 'feedback-request',
    name: 'Feedback Request',
    description: 'Request feedback or satisfaction survey from clients',
    category: 'follow-up',
    subject: 'How are we doing? We\'d love your feedback — Wudox',
    html: wrap(`
${header('Wudox', 'Your Opinion Matters')}
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:18px;">Hi {{contact_name}},</h2>
  <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.7;">At Wudox, we're always striving to improve. We'd love to hear about your experience working with us at <strong>{{company_name}}</strong>.</p>
  <div style="text-align:center;margin:0 0 24px;">
    <p style="margin:0 0 12px;color:#1a1a1a;font-size:14px;font-weight:600;">How would you rate your experience?</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
      <tr>
        <td style="padding:0 6px;"><a href="#" style="text-decoration:none;font-size:32px;">😟</a></td>
        <td style="padding:0 6px;"><a href="#" style="text-decoration:none;font-size:32px;">😐</a></td>
        <td style="padding:0 6px;"><a href="#" style="text-decoration:none;font-size:32px;">🙂</a></td>
        <td style="padding:0 6px;"><a href="#" style="text-decoration:none;font-size:32px;">😊</a></td>
        <td style="padding:0 6px;"><a href="#" style="text-decoration:none;font-size:32px;">🤩</a></td>
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
  ${signature}
</td></tr>
${footer()}
`),
  },
];

export const templateCategories = [
  { key: 'all', label: 'All Templates' },
  { key: 'outreach', label: 'Outreach' },
  { key: 'follow-up', label: 'Follow-up' },
  { key: 'meeting', label: 'Meeting' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'notification', label: 'Notification' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'general', label: 'General' },
] as const;

export const placeholders = [
  { key: '{{contact_name}}', label: 'Contact Name', sample: 'John Smith' },
  { key: '{{company_name}}', label: 'Company Name', sample: 'Acme Corp' },
  { key: '{{sender_name}}', label: 'Sender Name', sample: 'Sarah Johnson' },
  { key: '{{sender_title}}', label: 'Sender Title', sample: 'Senior Staffing Consultant' },
  { key: '{{sender_phone}}', label: 'Sender Phone', sample: '(555) 123-4567' },
  { key: '{{sender_email}}', label: 'Sender Email', sample: 'sarah@wudox.com' },
  { key: '{{date}}', label: 'Date', sample: 'March 28, 2026' },
  { key: '{{agency_name}}', label: 'Agency Name', sample: 'Wudox' },
  { key: '{{agency_footer}}', label: 'Agency Footer', sample: 'Confidential' },
] as const;

/**
 * Fillable fields for non-technical template editors.
 * Labels are user-facing; keys match backend renderTemplate / campaign vars.
 * Only includes variables that are actually filled when sending CRM emails.
 */
export const emailTemplateFillFields = [
  { key: '{{contact_name}}', label: 'Contact name', hint: 'Recipient contact' },
  { key: '{{company_name}}', label: 'Company name', hint: 'Client company' },
  { key: '{{sender_name}}', label: 'Your name', hint: 'Who is sending' },
  { key: '{{user_email}}', label: 'Your email', hint: 'Sender email' },
  { key: '{{agency_name}}', label: 'Agency name', hint: 'Your agency' },
  { key: '{{date}}', label: 'Date', hint: "Today's date when sent" },
  { key: '{{agency_footer}}', label: 'Agency footer', hint: 'Agency tagline / footer' },
] as const;

/** Replace only {{agency_footer}} — preserves all other placeholders intact (for compose/editor contexts). */
export function applyAgencyFooter(html: string, agencyFooterText?: string | null): string {
  let result = html;
  const footer = agencyFooterText?.trim() ?? '';
  if (!footer) {
    result = result.replace(/\{\{agency_footer\}\}\s*[·\-–—•]\s*/g, '');
  }
  result = result.replace(/\{\{agency_footer\}\}/g, footer);
  if (!footer) {
    result = result.replace(/<p[^>]*>\s*<\/p>/g, '');
    // Do NOT strip empty <tr> rows — the seed #f8fafc footer <tr> is the inject
    // anchor for sender signatures. Removing it puts the signature outside the card.
  }
  return result;
}

export function fillPlaceholders(html: string, agencyFooterText?: string | null, agencyName?: string | null): string {
  let result = html;
  const footer = agencyFooterText?.trim() ?? '';
  if (!footer) {
    // Pre-fill: strip "{{agency_footer}} · " so proposal-style footers don't leave a dangling separator
    result = result.replace(/\{\{agency_footer\}\}\s*[·\-–—•]\s*/g, '');
  }
  for (const p of placeholders) {
    result = result.replace(new RegExp(p.key.replace(/[{}]/g, '\\$&'), 'g'), p.sample);
  }
  result = result.replace(/\{\{agency_footer\}\}/g, footer);
  result = result.replace(/\{\{agency_name\}\}/g, agencyName?.trim() || 'Agency');
  if (!footer) {
    // Strip empty <p> only. Keep the footer <tr> so signature inject stays inside the card.
    result = result.replace(/<p[^>]*>\s*<\/p>/g, '');
  }
  return result;
}
