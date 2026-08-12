import '../src/loadEnv';
import { env } from '../src/config/env';
import { sendClientEmail } from '../src/services/email';

async function main() {
  const fromEmail = env.EMAIL_FROM;
  const fromName = env.EMAIL_FROM_NAME ?? 'NA Staffing CRM';
  const toEmail = env.EMAIL_FROM;

  const ok = await sendClientEmail({
    to: [{ email: toEmail, name: 'Test Recipient' }],
    from: { email: fromEmail, name: fromName },
    subject: 'NA Staffing CRM — Test email (SendGrid)',
    html: `<div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; line-height:1.5">
      <h2 style="margin:0 0 12px">SendGrid test</h2>
      <p style="margin:0 0 12px">If you received this, your SendGrid config is working.</p>
      <p style="margin:0;color:#6b7280;font-size:12px">Sent at: ${new Date().toISOString()}</p>
    </div>`,
  });

  // eslint-disable-next-line no-console
  console.log(ok ? '✅ Sent (SendGrid configured and accepted request).' : '⚠️ Not sent (SendGrid not configured).');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('❌ Failed to send test email:', err instanceof Error ? err.message : err);
  process.exit(1);
});

