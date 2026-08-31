import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3001'),
  API_VERSION: z.string().default('v1'),
  API_PREFIX: z.string().default('/api'),
  
  DATABASE_URL: z.string().url(),
  
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  JWT_RESET_EXPIRES_IN: z.string().default('1h'),
  
  REDIS_URL: z.string().url().optional(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().default('6379'),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.string().default('0'),
  
  SENDGRID_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),
  EMAIL_FROM_NAME: z.string().optional(),
  /** Optional inbound parse domain for CRM replies (e.g. inbound.example.com). */
  EMAIL_INBOUND_DOMAIN: z.string().optional(),
  /** Optional local-part to use for inbound replies (default = local-part of EMAIL_FROM). */
  EMAIL_INBOUND_LOCALPART: z.string().optional(),
  /** Comma-separated domains for which we may set per-user From (must be SendGrid-authenticated). Empty → universal sender for everything. */
  SEND_AS_ALLOWED_DOMAINS: z.string().optional(),
  /** Dev/staging safety: if set, all per-user From addresses are redirected to this single inbox. */
  SEND_AS_OVERRIDE_EMAIL: z.string().email().optional(),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_API_KEY_SID: z.string().optional(),
  TWILIO_API_KEY_SECRET: z.string().optional(),
  TWILIO_TWIML_APP_SID: z.string().optional(),
  /** @deprecated One-time migration seed only — agency caller IDs live in Phone System (DB). Not used at runtime. */
  TWILIO_CALLER_ID: z.string().optional(),
  /** Voice Access Token / signaling region when your Twilio account is outside default US (e.g. ie1, au1). See Twilio regional docs. */
  TWILIO_REGION: z.string().optional(),
  
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_ENDPOINT: z.string().url().optional(),
  R2_PUBLIC_URL: z.string().url().optional(),
  
  MAX_FILE_SIZE: z.string().default('10485760'),
  ALLOWED_FILE_TYPES: z.string().default('pdf,doc,docx,jpg,jpeg,png'),
  
  /** Comma-separated IPs (and optional CIDRs) allowed to hit the API. Empty = no IP restriction. */
  IP_ALLOWLIST: z.string().optional(),
  /** Set to true when behind a reverse proxy so req.ip is taken from X-Forwarded-For. */
  TRUST_PROXY: z.string().optional(),
  
  PANDADOC_API_KEY: z.string().optional(),
  /** Secret used to verify PandaDoc webhook signatures (HMAC-SHA256 hex). */
  PANDADOC_WEBHOOK_SECRET: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  /** 64-char hex for AES-256-GCM of Google refresh tokens and Twilio auth secrets. Required in production. */
  GOOGLE_TOKEN_ENCRYPTION_KEY: z.string().length(64).optional(),
  /** If set, only Google Workspace accounts from this domain can connect (e.g. yourcompany.com). */
  GOOGLE_WORKSPACE_DOMAIN: z.string().optional(),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  APP_URL: z.string().url().default('http://localhost:3001'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  /**
   * Public origin of the API as Twilio hits it (e.g. https://staffing.example.com or an ngrok URL). No trailing slash.
   * Used for webhook signature validation and for building status/recording callback URLs when APP_URL is localhost
   * but Twilio POSTs to HTTPS on the real host. If unset, Host + X-Forwarded-Proto (or X-Forwarded-Host) on each
   * request is used — set TRUST_PROXY=true behind nginx so req.protocol is correct.
   */
  PUBLIC_API_URL: z.string().url().optional(),

  /**
   * JSON array of RTCIceServer objects for staff↔staff WebRTC (Messages).
   * Default public STUN if unset. For production NAT, add self-hosted TURN (coturn).
   * Example: [{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]
   */
  INTERNAL_CALL_ICE_SERVERS: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  try {
    const parsed = envSchema.parse(process.env);
    if (parsed.SEND_AS_ALLOWED_DOMAINS && parsed.SEND_AS_ALLOWED_DOMAINS.trim() && !parsed.EMAIL_INBOUND_DOMAIN) {
      console.warn('⚠️  SEND_AS_ALLOWED_DOMAINS is set but EMAIL_INBOUND_DOMAIN is not. Per-agency email config (DB-stored) will handle this; ensure each agency has an inbound domain configured.');
    }
    if (parsed.NODE_ENV === 'production' && !parsed.GOOGLE_TOKEN_ENCRYPTION_KEY) {
      console.error(
        '❌ GOOGLE_TOKEN_ENCRYPTION_KEY is required in production (64-char hex). Generate with: openssl rand -hex 32',
      );
      process.exit(1);
    }
    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Environment validation failed:');
      error.errors.forEach((err) => {
        console.error(`   ${err.path.join('.')}: ${err.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
}

export const env = validateEnv();
