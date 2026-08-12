/**
 * Generate a valid Twilio signature for production inbound URL and POST a test request.
 * Run: npx tsx scripts/test-prod-signature.ts
 */
import '../src/loadEnv';
import twilio from 'twilio';
import { env } from '../src/config/env';

const postUrl = 'https://staffing.wudox.ca/api/v1/voice/webhook/inbound';
const params: Record<string, string> = {
  AccountSid: env.TWILIO_ACCOUNT_SID ?? '',
  CallSid: 'CAtestsig123',
  From: '+15551234567',
  To: '+13653602614',
  CallStatus: 'ringing',
  Direction: 'inbound',
};

const signUrlCandidates = [
  postUrl,
  'https://cf31-2404-3100-1cf0-4578-a9c1-f3dd-b514-c2f1.ngrok-free.app/api/v1/voice/webhook/inbound',
  'http://staffing.wudox.ca/api/v1/voice/webhook/inbound',
];

async function main() {
  const token = env.TWILIO_AUTH_TOKEN;
  if (!token) {
    console.error('TWILIO_AUTH_TOKEN missing');
    process.exit(1);
  }

  const getSig = (twilio as unknown as { getExpectedTwilioSignature: (t: string, u: string, p: Record<string, string>) => string })
    .getExpectedTwilioSignature;
  if (typeof getSig !== 'function') {
    console.error('getExpectedTwilioSignature not found on twilio package');
    process.exit(1);
  }

  const body = new URLSearchParams(params).toString();
  console.log('POST', postUrl);
  console.log('Local PUBLIC_API_URL:', env.PUBLIC_API_URL ?? '(unset)');

  for (const signUrl of signUrlCandidates) {
    const sig = getSig(token, signUrl, params);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(postUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': sig,
        },
        body,
        signal: controller.signal,
      });
      const text = await res.text();
      const ok = !text.includes('administrator');
      console.log(
        ok ? 'PASS' : 'FAIL',
        'signed as',
        signUrl.replace('https://', '').slice(0, 60),
        '→',
        text.includes('<Gather') ? 'IVR Gather' : text.slice(0, 70),
      );
    } catch (e) {
      console.log('ERR signed as', signUrl, (e as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
