import '../src/loadEnv';
import twilio from 'twilio';
import { env } from '../src/config/env';

async function main() {
  const c = twilio(env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!);
  const nums = await c.incomingPhoneNumbers.list({ limit: 10 });
  for (const n of nums) {
    console.log({
      phone: n.phoneNumber,
      voiceUrl: n.voiceUrl,
      voiceMethod: n.voiceMethod,
      voiceApplicationSid: n.voiceApplicationSid,
      trunkSid: n.trunkSid,
    });
  }
}

main().catch(console.error);
