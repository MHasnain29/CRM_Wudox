/**
 * Import Twilio subaccounts / numbers into per-agency phone config.
 *
 * Usage:
 *   npx tsx scripts/import-twilio-agencies.ts
 *   npx tsx scripts/import-twilio-agencies.ts --map scripts/twilio-agency-map.json
 *
 * Map file format:
 *   { "+13653602614": "agency-uuid", "ACxxxx": "agency-uuid" }
 */
import '../src/loadEnv';
import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import prisma from '../src/config/database';
import { env } from '../src/config/env';
import { saveAgencyTwilioCredentials, syncPhoneNumbersFromTwilio } from '../src/services/agencyTwilioService';

type MapFile = Record<string, string>;

async function main() {
  const mapArg = process.argv.find((a) => a.startsWith('--map='))?.split('=')[1]
    ?? (process.argv.includes('--map') ? process.argv[process.argv.indexOf('--map') + 1] : null);

  let map: MapFile = {};
  if (mapArg) {
    const raw = fs.readFileSync(path.resolve(mapArg), 'utf8');
    map = JSON.parse(raw) as MapFile;
  }

  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  if (!accountSid || !authToken) {
    console.error('Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env (master account for import)');
    process.exit(1);
  }

  const client = twilio(accountSid, authToken);
  const agencies = await prisma.subCompany.findMany({ select: { id: true, name: true } });
  const agencyByName = new Map(agencies.map((a) => [a.name.toLowerCase(), a.id]));

  // List subaccounts or use master account
  let accounts: Array<{ sid: string; friendlyName: string }> = [];
  try {
    const subs = await client.api.accounts.list({ status: 'active', limit: 50 });
    accounts = subs.map((s) => ({ sid: s.sid, friendlyName: s.friendlyName }));
  } catch {
    accounts = [{ sid: accountSid, friendlyName: 'Master' }];
  }

  if (accounts.length === 0) {
    accounts = [{ sid: accountSid, friendlyName: 'Master' }];
  }

  console.log(`Found ${accounts.length} Twilio account(s) to process`);

  for (const account of accounts) {
    const subClient = account.sid === accountSid ? client : twilio(accountSid, authToken, { accountSid: account.sid });
    const numbers = await subClient.incomingPhoneNumbers.list({ limit: 20 });

    let targetAgencyId =
      map[account.sid] ??
      map[numbers[0]?.phoneNumber ?? ''] ??
      agencyByName.get(account.friendlyName.toLowerCase()) ??
      null;

    if (!targetAgencyId && agencies.length === 1) {
      targetAgencyId = agencies[0]!.id;
    }

    if (!targetAgencyId) {
      console.warn(`Skip account ${account.sid} (${account.friendlyName}) — no agency mapping`);
      continue;
    }

    await saveAgencyTwilioCredentials(targetAgencyId, {
      accountSid: account.sid,
      authToken: account.sid === accountSid ? authToken : undefined,
      apiKeySid: env.TWILIO_API_KEY_SID?.trim() ?? null,
      apiKeySecret: env.TWILIO_API_KEY_SECRET?.trim() ?? null,
      twimlAppSid: env.TWILIO_TWIML_APP_SID?.trim() ?? null,
      region: env.TWILIO_REGION?.trim() ?? null,
    });

    if (numbers.length > 0) {
      await syncPhoneNumbersFromTwilio(targetAgencyId);
    }

    const agency = agencies.find((a) => a.id === targetAgencyId);
    console.log(`Imported ${account.sid} → agency ${agency?.name ?? targetAgencyId} (${numbers.length} number(s))`);
  }

  console.log('Done. Remove TWILIO_CALLER_ID from .env after verifying agencies in Phone System UI.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
