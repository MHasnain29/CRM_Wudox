/**
 * Load .env before any other code. Must be the first import in server.ts
 * so that config/env sees the variables when it validates.
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const envPath = path.resolve(__dirname, '..', '.env');
dotenv.config({ path: envPath, override: true });

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
