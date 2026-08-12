/** Compare env vs per-agency Twilio DID webhook URLs. */
import '../src/loadEnv';
import twilio from 'twilio';
import prisma from '../src/config/database';
import { env } from '../src/config/env';
import { getAgencyTwilioCredentials } from '../src/services/agencyTwilioService';

const DID = '+13653602614';

async function fetchDid(client: ReturnType<typeof twilio>, label: string) {
  const nums = await client.incomingPhoneNumbers.list({ phoneNumber: DID, limit: 5 });
  if (!nums.length) {
    console.log(`  ${label}: number not found on this account`);
    return;
  }
  for (const n of nums) {
    console.log(`  ${label}:`);
    console.log('    voiceUrl:', n.voiceUrl);
    console.log('    voiceApplicationSid:', n.voiceApplicationSid || '(unset)');
    console.log('    statusCallback:', n.statusCallback);
  }
}

async function main() {
  const expected = env.PUBLIC_API_URL
    ? `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1/voice/webhook/inbound`
    : '(PUBLIC_API_URL unset)';

  console.log('Expected inbound URL:', expected);

  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
    console.log('\nEnv account', env.TWILIO_ACCOUNT_SID);
    await fetchDid(twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN), 'env');
  }

  const agencies = await prisma.phoneAgencyConfig.findMany({
    select: { subCompanyId: true, twilioAccountSid: true, inboundEnabled: true },
  });

  for (const a of agencies) {
    console.log(`\nAgency ${a.subCompanyId} inbound=${a.inboundEnabled}`);
    const creds = await getAgencyTwilioCredentials(a.subCompanyId);
    if (!creds) {
      console.log('  no agency Twilio credentials');
      continue;
    }
    console.log('  accountSid:', creds.accountSid);
    if (creds.accountSid === env.TWILIO_ACCOUNT_SID) {
      console.log('  (same as env — already checked above)');
      continue;
    }
    await fetchDid(twilio(creds.accountSid, creds.authToken), 'agency');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
