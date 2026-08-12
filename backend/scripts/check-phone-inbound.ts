/**
 * Pre-IVR inbound readiness check — DB config, Twilio webhook URLs, and HTTP self-test.
 * Run: npx tsx scripts/check-phone-inbound.ts
 */
import '../src/loadEnv';
import twilio from 'twilio';
import prisma from '../src/config/database';
import { env } from '../src/config/env';

const API_PREFIX = '/api/v1';

function pass(label: string, detail?: string) {
  console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label: string, detail?: string) {
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

function warn(label: string, detail?: string) {
  console.log(`  WARN  ${label}${detail ? ` — ${detail}` : ''}`);
}

function publicApiBase(): string | null {
  const base = (env.PUBLIC_API_URL || env.APP_URL || '').replace(/\/$/, '');
  if (!base || base.startsWith('http://localhost')) return null;
  return base;
}

async function checkTwilioWebhookUrls(expectedInbound: string): Promise<{ allMatch: boolean; twilioDid: string | null }> {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    warn('Twilio credentials missing — skipped URL comparison');
    return { allMatch: true, twilioDid: null };
  }

  const client = twilio(sid, token);
  const numbers = await client.incomingPhoneNumbers.list({ limit: 50 });
  if (!numbers.length) {
    warn('No Twilio incoming phone numbers on account');
    return { allMatch: true, twilioDid: null };
  }

  let allMatch = true;
  let twilioDid: string | null = null;
  for (const n of numbers) {
    twilioDid = n.phoneNumber;
    const match = n.voiceUrl === expectedInbound;
    if (match) {
      pass(`Twilio voiceUrl for ${n.phoneNumber}`, n.voiceUrl);
    } else {
      fail(`Twilio voiceUrl for ${n.phoneNumber}`, `got ${n.voiceUrl} | expected ${expectedInbound}`);
      allMatch = false;
    }
    if (n.voiceApplicationSid) {
      fail(
        `Twilio voiceApplicationSid for ${n.phoneNumber}`,
        `${n.voiceApplicationSid} — PSTN inbound will hit /webhook/twiml instead of /inbound. Run npm run tunnel:sync.`,
      );
      allMatch = false;
    } else {
      pass(`Twilio voiceApplicationSid for ${n.phoneNumber}`, 'unset (inbound uses voiceUrl)');
    }
  }
  return { allMatch, twilioDid };
}

async function selfTestInboundWebhook(base: string, testDid: string): Promise<boolean> {
  const url = `${base}${API_PREFIX}/voice/webhook/inbound`;
  const callSid = `CAcheck${Date.now()}`;
  const body = new URLSearchParams({
    CallSid: callSid,
    From: '+15551234567',
    To: testDid,
  });

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'ngrok-skip-browser-warning': '1',
      },
      body,
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    fail('HTTP self-test', `${url} — ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }

  const ms = Date.now() - started;
  const text = await res.text();
  const hasSay = /<Say/i.test(text);
  const hasGather = /<Gather/i.test(text);

  if (res.status === 200 && hasSay && hasGather && ms < 15000) {
    pass('HTTP self-test initial webhook', `${ms}ms — Say + Gather present`);
    return true;
  }

  if (res.status !== 200) {
    fail('HTTP self-test status', `${res.status} in ${ms}ms`);
  } else if (!hasSay || !hasGather) {
    fail('HTTP self-test TwiML', `missing ${!hasSay ? 'Say' : ''}${!hasSay && !hasGather ? ' and ' : ''}${!hasGather ? 'Gather' : ''} — ${text.slice(0, 120)}`);
  } else {
    warn('HTTP self-test slow', `${ms}ms (Twilio times out around 10s)`);
  }
  return false;
}

async function main() {
  const numbers = await prisma.phoneNumber.findMany({
    select: { subCompanyId: true, e164: true, isActive: true, label: true },
  });
  const configs = await prisma.phoneAgencyConfig.findMany({
    select: {
      subCompanyId: true,
      inboundEnabled: true,
      outboundEnabled: true,
      outboundCallerId: true,
      defaultsSeededAt: true,
      publishedFlow: true,
      ringGroups: true,
    },
  });
  let inbound = -1;
  let sessions = -1;
  try {
    inbound = await prisma.inboundCall.count();
  } catch {
    console.warn('WARN: inbound_calls table missing — run prisma migrate deploy');
  }
  try {
    sessions = await prisma.phoneCallSession.count();
  } catch {
    console.warn('WARN: phone_call_sessions table missing — run prisma migrate deploy');
  }

  console.log('=== Pre-IVR readiness checklist ===\n');

  const base = publicApiBase();
  if (base) {
    pass('PUBLIC_API_URL', base);
  } else {
    fail('PUBLIC_API_URL', 'set to your HTTPS ngrok/tunnel origin (not localhost)');
  }

  const expectedInbound = base ? `${base}${API_PREFIX}/voice/webhook/inbound` : '';
  let twilioDid: string | null = null;
  let preIvrOk = !!base;
  if (base) {
    console.log('\nExpected Twilio inbound URL:', expectedInbound);
    const twilioCheck = await checkTwilioWebhookUrls(expectedInbound);
    twilioDid = twilioCheck.twilioDid;
    if (!twilioCheck.allMatch) preIvrOk = false;
  }

  console.log('\n=== Phone numbers in DB ===');
  console.log(JSON.stringify(numbers, null, 2));

  const activeDid =
    (twilioDid && numbers.find((n) => n.e164 === twilioDid)?.e164) ||
    twilioDid ||
    numbers.find((n) => n.isActive)?.e164;

  for (const c of configs) {
    const rg = (Array.isArray(c.ringGroups) ? c.ringGroups : []) as Array<{
      name: string;
      extension: string;
      members?: Array<{ userId: string; userName: string }>;
    }>;
    const members = rg.flatMap((g) => g.members ?? []);
    const pub = c.publishedFlow as { nodes?: unknown[] } | null;
    const nodeCount = pub?.nodes?.length ?? 0;

    console.log('\n=== Agency', c.subCompanyId, '===');
    console.log({
      inboundEnabled: c.inboundEnabled,
      outboundEnabled: c.outboundEnabled,
      outboundCallerId: c.outboundCallerId,
      defaultsSeededAt: c.defaultsSeededAt,
      publishedNodeCount: nodeCount,
      ringGroupCount: rg.length,
      ringGroupMemberCount: members.length,
      ringGroups: rg.map((g) => ({ name: g.name, ext: g.extension, members: g.members?.length ?? 0 })),
    });

    if (!c.inboundEnabled) {
      fail('inboundEnabled', c.subCompanyId);
      preIvrOk = false;
    } else {
      pass('inboundEnabled', c.subCompanyId);
    }
    if (nodeCount === 0) {
      fail('publishedFlow nodes', c.subCompanyId);
      preIvrOk = false;
    } else {
      pass('publishedFlow nodes', `${nodeCount} nodes`);
    }
    if (members.length === 0) {
      warn('ring group members', 'none — IVR works but menu dial will not reach agents');
    }
  }

  const agencyDid = activeDid;
  if (base && agencyDid) {
    console.log('\n=== HTTP self-test ===');
    const httpOk = await selfTestInboundWebhook(base, agencyDid);
    preIvrOk = preIvrOk && httpOk;
  } else if (!agencyDid) {
    fail('active DID in DB', 'add a phone number in Phone System');
    preIvrOk = false;
  }

  console.log('\nInbound calls:', inbound, '| IVR sessions:', sessions);
  console.log('\n=== Result ===');
  if (preIvrOk) {
    console.log('All pre-IVR checks passed. Place a test call — backend should log [webhook/inbound] OK <ms>.');
  } else {
    console.log('Some pre-IVR checks failed. Fix above FAIL lines before testing inbound calls.');
    console.log('If Twilio URL mismatch: npm run tunnel:sync (from repo root after ngrok restarts).');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
