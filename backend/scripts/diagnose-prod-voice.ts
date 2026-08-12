/**
 * Diagnose production inbound voice: DB tokens vs env, signature test against live URL.
 * Uses PROD_DATABASE_URL if set, else the commented production URL pattern from .env.
 *
 * Run: PROD_DATABASE_URL="postgresql://..." npx tsx scripts/diagnose-prod-voice.ts
 */
import fs from 'fs';
import path from 'path';
import twilio from 'twilio';

const PROD_INBOUND = 'https://staffing.wudox.ca/api/v1/voice/webhook/inbound';

async function main() {
  // Load local .env for env token + encryption key
  await import('../src/loadEnv');
  const { env } = await import('../src/config/env');
  const { resolveWebhookAuthTokenCandidates } = await import('../src/services/agencyTwilioService');

  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  if (!accountSid) {
    console.error('Set TWILIO_ACCOUNT_SID in .env for this script.');
    process.exit(1);
  }

  const prodDbUrl = process.env.PROD_DATABASE_URL?.trim();
  if (!prodDbUrl) {
    console.error('Set PROD_DATABASE_URL to the production Postgres URL for this script.');
    process.exit(1);
  }

  // Point Prisma at production for this process only
  process.env.DATABASE_URL = prodDbUrl;
  const prisma = (await import('../src/config/database')).default;

  const params: Record<string, string> = {
    AccountSid: accountSid,
    CallSid: 'CAdiag123',
    From: '+15551234567',
    To: '+13653602614',
    CallStatus: 'ringing',
    Direction: 'inbound',
  };

  const getSig = (twilio as unknown as { getExpectedTwilioSignature: (t: string, u: string, p: Record<string, string>) => string })
    .getExpectedTwilioSignature;

  console.log('=== Production voice diagnostic ===\n');
  console.log('Target:', PROD_INBOUND);
  console.log('Local env PUBLIC_API_URL:', env.PUBLIC_API_URL ?? '(unset)');

  const configs = await prisma.phoneAgencyConfig.findMany({
    select: {
      subCompanyId: true,
      twilioAccountSid: true,
      inboundEnabled: true,
      outboundEnabled: true,
      syncStatus: true,
    },
  });
  console.log('\nProduction phone_agency_configs:');
  for (const c of configs) {
    console.log(
      `  agency=${c.subCompanyId} account=${c.twilioAccountSid} inbound=${c.inboundEnabled} sync=${c.syncStatus}`,
    );
  }

  const numbers = await prisma.phoneNumber.findMany({
    where: { isActive: true },
    select: { e164: true, subCompanyId: true },
  });
  console.log('\nActive phone_numbers:', numbers.length ? '' : '(none)');
  for (const n of numbers) {
    console.log(`  ${n.e164} → agency ${n.subCompanyId}`);
  }

  const tokenCandidates = await resolveWebhookAuthTokenCandidates(params);
  const envToken = env.TWILIO_AUTH_TOKEN?.trim();
  console.log('\nAuth token candidates for webhook:', tokenCandidates.length);
  console.log('  env token matches first DB candidate:', tokenCandidates[0] === envToken);

  const signUrls = [
    PROD_INBOUND,
    env.PUBLIC_API_URL
      ? `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1/voice/webhook/inbound`
      : null,
  ].filter(Boolean) as string[];

  const body = new URLSearchParams(params).toString();
  let anyPass = false;

  for (let i = 0; i < tokenCandidates.length; i++) {
    for (const signUrl of signUrls) {
      const sig = getSig(tokenCandidates[i], signUrl, params);
      const res = await fetch(PROD_INBOUND, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': sig,
        },
        body,
      });
      const text = await res.text();
      const ok = !text.includes('administrator');
      if (ok) anyPass = true;
      console.log(
        ok ? '  PASS' : '  FAIL',
        `token#${i + 1} signed as ${signUrl.replace('https://', '').slice(0, 55)}`,
      );
    }
  }

  console.log('\n=== Result ===');
  if (anyPass) {
    console.log('At least one token+URL combo validates on production — real calls should work.');
  } else {
    console.log('ALL signature tests FAILED on production.');
    console.log('Fix: update Auth Token in production Settings OR production .env, ensure PUBLIC_API_URL=https://staffing.wudox.ca on server, restart.');
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
