/**
 * One-time (idempotent) setup: enable the SendGrid Event Webhook so
 * delivery/open/click/bounce/suppression events are POSTed to our handler at
 * /api/v1/webhooks/sendgrid — the source that populates campaign engagement stats.
 *
 * Run on the server (where the public origin is set via env):
 *   npx tsx scripts/configureSendgridWebhook.ts
 *
 * The webhook URL is derived from PUBLIC_API_URL (falling back to APP_URL). The
 * script refuses to run against a non-https / localhost origin so it can never
 * point SendGrid at a dev box.
 */
import '../src/loadEnv';
import { env } from '../src/config/env';

const SETTINGS_URL = 'https://api.sendgrid.com/v3/user/webhooks/event/settings';

// Every event our webhook handler (webhooks.ts) knows how to process.
const EVENT_FLAGS = {
  enabled: true,
  delivered: true,
  open: true,
  click: true,
  bounce: true,
  dropped: true,
  deferred: true,
  spam_report: true,
  unsubscribe: true,
  group_unsubscribe: true,
  group_resubscribe: true,
  processed: false,
};

async function main() {
  if (!env.SENDGRID_API_KEY) {
    console.error('SENDGRID_API_KEY is not set — aborting.');
    process.exit(1);
  }

  const base = (env.PUBLIC_API_URL ?? env.APP_URL).replace(/\/+$/, '');
  const webhookUrl = `${base}/api/v1/webhooks/sendgrid`;

  if (!base.startsWith('https://') || /localhost|127\.0\.0\.1/.test(base)) {
    console.error(`Refusing to configure the webhook with a non-public URL: ${webhookUrl}`);
    console.error('Set PUBLIC_API_URL (or APP_URL) to the public https origin and re-run on the server.');
    process.exit(1);
  }

  const headers = {
    Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
    'Content-Type': 'application/json',
  };

  const before = await fetch(SETTINGS_URL, { headers });
  console.log('Current settings:', JSON.stringify(await before.json()));

  const resp = await fetch(SETTINGS_URL, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ url: webhookUrl, ...EVENT_FLAGS }),
  });
  if (!resp.ok) {
    console.error(`Failed to update webhook settings: ${resp.status} ${await resp.text()}`);
    process.exit(1);
  }

  console.log('Updated settings:', JSON.stringify(await resp.json()));
  console.log(`✅ SendGrid Event Webhook enabled → ${webhookUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
