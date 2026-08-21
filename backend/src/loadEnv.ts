/**
 * Load .env before any other code. Must be the first import in server.ts
 * so that config/env sees the variables when it validates.
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const envPath = path.resolve(__dirname, '..', '.env');
dotenv.config({ path: envPath, override: true });

/**
 * Duplicate keys in .env are resolved silently (last line wins), which is
 * disastrous for GOOGLE_TOKEN_ENCRYPTION_KEY: stored secrets encrypted under
 * the other value can no longer be decrypted. Warn loudly.
 */
function warnOnDuplicateEnvKeys(): void {
  if (!fs.existsSync(envPath)) return;
  const seen = new Map<string, number>();
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=/);
    if (m) seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
  }
  for (const [key, count] of seen) {
    if (count > 1) {
      console.warn(
        `⚠️  [env] "${key}" appears ${count} times in .env — the last value wins. ` +
          (key === 'GOOGLE_TOKEN_ENCRYPTION_KEY'
            ? 'Stored secrets encrypted under the other value CANNOT be decrypted. Remove the wrong line.'
            : 'Remove the duplicate to avoid surprises.'),
      );
    }
  }
}
warnOnDuplicateEnvKeys();

/** Dev-only: monorepo root dev-tunnel.env → PUBLIC_API_URL for Twilio webhooks. */
function applyDevTunnelEnv(): void {
  if (process.env.NODE_ENV === 'production') return;

  const tunnelPath = path.resolve(__dirname, '..', '..', 'dev-tunnel.env');
  if (!fs.existsSync(tunnelPath)) return;

  const tunnel = dotenv.parse(fs.readFileSync(tunnelPath));
  const url = tunnel.DEV_TUNNEL_URL?.trim().replace(/\/$/, '');
  if (!url) return;

  process.env.PUBLIC_API_URL = url;

  // Allow CORS if the frontend is ever served from the tunnel origin (Twilio dev only needs PUBLIC_API_URL).
  const existing = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (!existing.includes(url)) {
    process.env.CORS_ORIGIN = [...existing, url].join(',');
  }
}

applyDevTunnelEnv();
