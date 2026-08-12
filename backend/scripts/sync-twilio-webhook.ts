/**
 * One command to (re)point Twilio at your current dev tunnel after ngrok restarts.
 *
 * Run from repo root: `npm run tunnel:sync`
 *
 * Steps (all automatic):
 *  1. Detect the live ngrok public HTTPS URL from ngrok's local API (http://127.0.0.1:4040).
 *     Falls back to DEV_TUNNEL_URL / PUBLIC_API_URL if ngrok's API isn't reachable.
 *  2. Write the URL into repo-root dev-tunnel.env (so the backend loads it as PUBLIC_API_URL).
 *  3. Point the Twilio inbound DID + TwiML App voice URLs at that origin and clear
 *     voiceApplicationSid on the DID (so PSTN inbound hits /webhook/inbound, not /webhook/twiml).
 *  4. Touch src/server.ts so `tsx watch` reloads the backend with the fresh PUBLIC_API_URL —
 *     required, otherwise Twilio signature validation fails and callers hear
 *     "Call setup failed. Please contact your administrator."
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import '../src/loadEnv';
import twilio from 'twilio';
import { env } from '../src/config/env';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TUNNEL_ENV_PATH = path.join(REPO_ROOT, 'dev-tunnel.env');
const SERVER_ENTRY = path.resolve(__dirname, '..', 'src', 'server.ts');
const NGROK_API = 'http://127.0.0.1:4040/api/tunnels';

/** Query ngrok's local API for the current public HTTPS URL. Returns null if ngrok isn't running. */
function detectNgrokUrl(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.get(NGROK_API, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data) as {
            tunnels?: Array<{ public_url?: string; config?: { addr?: string } }>;
          };
          const tunnels = json.tunnels ?? [];
          // Prefer an https tunnel pointing at the backend port; otherwise first https.
          const backendPort = env.PORT;
          const preferred =
            tunnels.find(
              (t) => t.public_url?.startsWith('https://') && t.config?.addr?.includes(backendPort),
            ) ?? tunnels.find((t) => t.public_url?.startsWith('https://'));
          resolve(preferred?.public_url?.replace(/\/$/, '') ?? null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

function writeTunnelEnv(url: string): void {
  fs.writeFileSync(TUNNEL_ENV_PATH, `DEV_TUNNEL_URL=${url}\n`, 'utf8');
  console.log('Wrote dev-tunnel.env →', url);
}

/** tsx watch restarts on any src change — bump server.ts mtime so the backend reloads PUBLIC_API_URL. */
function restartBackend(): void {
  try {
    const now = new Date();
    fs.utimesSync(SERVER_ENTRY, now, now);
    console.log('Touched src/server.ts — tsx watch will reload the backend with the new URL.');
  } catch (e) {
    console.warn(
      'Could not touch src/server.ts; restart the backend manually so PUBLIC_API_URL updates.',
      (e as Error).message,
    );
  }
}

async function resolveBaseUrl(): Promise<string> {
  const detected = await detectNgrokUrl();
  if (detected) {
    console.log('Detected live ngrok URL:', detected);
    writeTunnelEnv(detected);
    return detected;
  }

  const fallback = (env.PUBLIC_API_URL || env.APP_URL || '').replace(/\/$/, '').trim();
  if (!fallback || fallback.startsWith('http://localhost')) {
    console.error(
      'ngrok API not reachable at 127.0.0.1:4040 and no usable PUBLIC_API_URL.\n' +
        'Start ngrok (pointing at the backend), or set DEV_TUNNEL_URL in dev-tunnel.env, then re-run.',
    );
    process.exit(1);
  }
  console.warn('ngrok API not reachable — falling back to existing PUBLIC_API_URL:', fallback);
  return fallback;
}

async function main() {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const twimlAppSid = env.TWILIO_TWIML_APP_SID;
  if (!sid || !token) {
    console.error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN');
    process.exit(1);
  }

  const base = await resolveBaseUrl();
  const prefix = env.API_PREFIX.replace(/^\//, '').replace(/\/$/, '');
  const webhookBase = `${base}/${prefix}/${env.API_VERSION}/voice/webhook`;
  const inboundUrl = `${webhookBase}/inbound`;
  const inboundStatusUrl = `${webhookBase}/inbound/status`;
  const outboundTwimlUrl = `${webhookBase}/twiml`;

  const client = twilio(sid, token);

  console.log('PUBLIC_API_URL:', base);
  console.log('Inbound voice URL:', inboundUrl);
  console.log('Outbound TwiML URL:', outboundTwimlUrl);

  const numbers = await client.incomingPhoneNumbers.list({ limit: 50 });
  if (!numbers.length) {
    console.warn('No incoming phone numbers on this account.');
  }
  for (const n of numbers) {
    await client.incomingPhoneNumbers(n.sid).update({
      voiceUrl: inboundUrl,
      voiceMethod: 'POST',
      // Must clear — when set, Twilio routes PSTN inbound to the TwiML App URL (/twiml) instead of voiceUrl.
      voiceApplicationSid: '',
      statusCallback: inboundStatusUrl,
      statusCallbackMethod: 'POST',
    });
    console.log(`Updated DID ${n.phoneNumber} (${n.sid}) — voiceUrl only (TwiML App unlinked from DID)`);
  }

  if (twimlAppSid) {
    await client.applications(twimlAppSid).update({
      voiceUrl: outboundTwimlUrl,
      voiceMethod: 'POST',
    });
    console.log(`Updated TwiML App ${twimlAppSid}`);
  } else {
    console.warn('TWILIO_TWIML_APP_SID not set — skipped TwiML App update');
  }

  restartBackend();
  console.log('\nDone. Twilio + dev-tunnel.env + backend are all pointed at:', base);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
