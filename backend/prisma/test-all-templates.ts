/**
 * Test script: sends every global email template to a test address via the live API.
 * Run with: npx tsx backend/prisma/test-all-templates.ts
 *
 * Set TEST_EMAIL / CRM_EMAIL / CRM_PASSWORD env vars to override defaults.
 */

const BASE   = process.env.CRM_BASE_URL   ?? 'http://localhost:3001/api/v1';
const EMAIL  = process.env.CRM_EMAIL      ?? 'hassan.superadmin@hrglobal.ca';
const PASS   = process.env.CRM_PASSWORD   ?? 'password123';
const TO     = process.env.TEST_EMAIL     ?? 'zain@rondah.ai';

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as any;
  return data.token as string;
}

async function getTemplates(token: string): Promise<any[]> {
  const res = await fetch(`${BASE}/email-templates`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Fetch templates failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as any;
  return Array.isArray(data) ? data : (data.templates ?? data.data ?? []);
}

async function sendTemplate(token: string, template: any): Promise<void> {
  const res = await fetch(`${BASE}/emails/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: [{ email: TO, name: 'Test Recipient' }],
      subject: template.subject ?? `[TEST] ${template.name}`,
      body: template.bodyHtml ?? '',
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Send failed (${res.status}): ${txt}`);
  }
}

async function main() {
  console.log(`Logging in as ${EMAIL}...`);
  const token = await login();
  console.log('✅ Logged in\n');

  console.log('Fetching templates...');
  const templates = await getTemplates(token);
  // Only global templates (subCompanyId null)
  const globals = templates.filter((t: any) => !t.subCompanyId);
  console.log(`Found ${globals.length} global templates\n`);

  let ok = 0, fail = 0;
  for (const t of globals) {
    process.stdout.write(`  Sending "${t.name}"... `);
    try {
      await sendTemplate(token, t);
      console.log('✅ sent');
      ok++;
    } catch (e: any) {
      console.log(`❌ ${e.message}`);
      fail++;
    }
    // small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 800));
  }

  console.log(`\nDone. ${ok} sent, ${fail} failed.`);
  console.log(`Check inbox: ${TO}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
