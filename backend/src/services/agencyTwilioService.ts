/**
 * Per-agency Twilio subaccount credentials — DB source of truth (Settings → Phone System per agency).
 */
import twilio from 'twilio';
import prisma from '../config/database';
import { env } from '../config/env';
import { encryptSecret, decryptSecret, tryDecryptSecret } from '../utils/secretsCrypto';
import { isValidE164, normalizeToE164 } from '../utils/phoneE164';

function twilioStr(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t && t.length > 0 ? t : undefined;
}

/** Twilio edge region only — reject emails/timezones pasted by mistake. */
function sanitizeTwilioRegion(region: string | null | undefined): string | null {
  if (!region?.trim()) return null;
  const trimmed = region.trim();
  if (trimmed.includes('@') || /\s/.test(trimmed)) return null;
  return trimmed;
}

export interface AgencyTwilioCredentials {
  accountSid: string;
  authToken: string;
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
  region?: string;
  source: 'agency' | 'env';
}

export interface AgencyTwilioPublicConfig {
  accountSid: string | null;
  apiKeySid: string | null;
  twimlAppSid: string | null;
  region: string | null;
  hasAuthToken: boolean;
  hasApiKeySecret: boolean;
  credentialsConfigured: boolean;
}

export interface SaveAgencyTwilioInput {
  accountSid?: string | null;
  authToken?: string | null;
  apiKeySid?: string | null;
  apiKeySecret?: string | null;
  twimlAppSid?: string | null;
  region?: string | null;
}

function envCredentials(): AgencyTwilioCredentials | null {
  const accountSid = twilioStr(env.TWILIO_ACCOUNT_SID);
  const authToken = twilioStr(env.TWILIO_AUTH_TOKEN);
  const apiKeySid = twilioStr(env.TWILIO_API_KEY_SID);
  const apiKeySecret = twilioStr(env.TWILIO_API_KEY_SECRET);
  const twimlAppSid = twilioStr(env.TWILIO_TWIML_APP_SID);
  if (!accountSid || !authToken || !apiKeySid || !apiKeySecret || !twimlAppSid) return null;
  return {
    accountSid,
    authToken,
    apiKeySid,
    apiKeySecret,
    twimlAppSid,
    region: twilioStr(env.TWILIO_REGION),
    source: 'env',
  };
}

function rowToCredentials(row: {
  twilioAccountSid: string | null;
  twilioAuthTokenEnc: string | null;
  twilioApiKeySid: string | null;
  twilioApiKeySecretEnc: string | null;
  twilioTwimlAppSid: string | null;
  twilioRegion: string | null;
}): AgencyTwilioCredentials | null {
  const accountSid = twilioStr(row.twilioAccountSid ?? undefined);
  // tryDecryptSecret: a key mismatch must degrade to "not configured", not crash the request
  const authToken = row.twilioAuthTokenEnc
    ? twilioStr(tryDecryptSecret(row.twilioAuthTokenEnc) ?? undefined)
    : null;
  const apiKeySid = twilioStr(row.twilioApiKeySid ?? undefined);
  const apiKeySecret = row.twilioApiKeySecretEnc
    ? twilioStr(tryDecryptSecret(row.twilioApiKeySecretEnc) ?? undefined)
    : null;
  const twimlAppSid = twilioStr(row.twilioTwimlAppSid ?? undefined);
  if (!accountSid || !authToken || !apiKeySid || !apiKeySecret || !twimlAppSid) return null;
  return {
    accountSid,
    authToken,
    apiKeySid,
    apiKeySecret,
    twimlAppSid,
    region: twilioStr(row.twilioRegion ?? undefined),
    source: 'agency',
  };
}

/** Twilio auth tokens and API key secrets are 32 characters; reject truncated DB copies. */
function hasPlausibleTwilioSecrets(creds: AgencyTwilioCredentials): boolean {
  return creds.authToken.length === 32 && creds.apiKeySecret.length === 32;
}

export function isAgencyTwilioConfigured(creds: AgencyTwilioCredentials | null): boolean {
  return Boolean(
    creds?.accountSid?.startsWith('AC') &&
      creds.apiKeySid?.startsWith('SK') &&
      creds.twimlAppSid?.startsWith('AP') &&
      creds.authToken &&
      creds.apiKeySecret &&
      hasPlausibleTwilioSecrets(creds),
  );
}

// Tracks subCompanies where a one-time force-repair of corrupt DB secrets has already been
// attempted this process. Prevents a per-request DB write storm when secrets fail the
// plausibility check (e.g. wrong encryption key or truncated value).
const _secretRepairAttempted = new Set<string>();

export async function getAgencyTwilioCredentials(
  subCompanyId: string,
): Promise<AgencyTwilioCredentials | null> {
  const envCreds = envCredentials();
  const row = await prisma.phoneAgencyConfig.findUnique({
    where: { subCompanyId },
    select: {
      twilioAccountSid: true,
      twilioAuthTokenEnc: true,
      twilioApiKeySid: true,
      twilioApiKeySecretEnc: true,
      twilioTwimlAppSid: true,
      twilioRegion: true,
    },
  });
  if (row) {
    const creds = rowToCredentials(row);
    if (creds) {
      if (hasPlausibleTwilioSecrets(creds)) return creds;
      // Corrupt/truncated DB secrets — prefer .env for same subaccount.
      // Attempt DB repair at most once per process to avoid a write on every poll request.
      if (envCreds && creds.accountSid === envCreds.accountSid) {
        if (!_secretRepairAttempted.has(subCompanyId)) {
          _secretRepairAttempted.add(subCompanyId);
          void seedAgencyTwilioFromEnv(subCompanyId, { force: true }).catch(() => {});
        }
        return envCreds;
      }
      return creds;
    }
  }
  return envCreds;
}

export async function getAgencyTwilioPublicConfig(
  subCompanyId: string,
): Promise<AgencyTwilioPublicConfig> {
  const row = await prisma.phoneAgencyConfig.findUnique({
    where: { subCompanyId },
    select: {
      twilioAccountSid: true,
      twilioAuthTokenEnc: true,
      twilioApiKeySid: true,
      twilioApiKeySecretEnc: true,
      twilioTwimlAppSid: true,
      twilioRegion: true,
    },
  });
  const creds = await getAgencyTwilioCredentials(subCompanyId);

  return {
    accountSid: row?.twilioAccountSid ?? creds?.accountSid ?? null,
    apiKeySid: row?.twilioApiKeySid ?? creds?.apiKeySid ?? null,
    twimlAppSid: row?.twilioTwimlAppSid ?? creds?.twimlAppSid ?? null,
    region: row?.twilioRegion ?? creds?.region ?? null,
    hasAuthToken: Boolean(row?.twilioAuthTokenEnc) || Boolean(creds?.authToken),
    hasApiKeySecret: Boolean(row?.twilioApiKeySecretEnc) || Boolean(creds?.apiKeySecret),
    credentialsConfigured: isAgencyTwilioConfigured(creds),
  };
}

/** Copy master .env Twilio creds into one agency's DB row (skips if agency already has Account SID). */
export async function seedAgencyTwilioFromEnv(
  subCompanyId: string,
  options?: { force?: boolean },
): Promise<boolean> {
  if (!options?.force) {
    const row = await prisma.phoneAgencyConfig.findUnique({
      where: { subCompanyId },
      select: { twilioAccountSid: true },
    });
    if (row?.twilioAccountSid) return false;
  }

  const envCreds = envCredentials();
  if (!envCreds) return false;

  await saveAgencyTwilioCredentials(subCompanyId, {
    accountSid: envCreds.accountSid,
    authToken: envCreds.authToken,
    apiKeySid: envCreds.apiKeySid,
    apiKeySecret: envCreds.apiKeySecret,
    twimlAppSid: envCreds.twimlAppSid,
    region: envCreds.region ?? null,
  });
  return true;
}

/**
 * One-time bootstrap: copy master .env Twilio creds into the sole agency's DB row (local/dev migration only).
 * Multi-agency installs must use Settings → Phone System or `scripts/seed-agency-phone-defaults.ts --agency-id=`.
 */
export async function seedAgencyTwilioDefaultsIfEmpty(subCompanyId: string): Promise<boolean> {
  const agencyCount = await prisma.subCompany.count();
  if (agencyCount !== 1) return false;
  return seedAgencyTwilioFromEnv(subCompanyId);
}

export async function saveAgencyTwilioCredentials(
  subCompanyId: string,
  input: SaveAgencyTwilioInput,
): Promise<AgencyTwilioPublicConfig> {
  const existing = await prisma.phoneAgencyConfig.findUnique({
    where: { subCompanyId },
    select: {
      twilioAccountSid: true,
      twilioAuthTokenEnc: true,
      twilioApiKeySid: true,
      twilioApiKeySecretEnc: true,
      twilioTwimlAppSid: true,
      twilioRegion: true,
    },
  });

  const accountSid = input.accountSid !== undefined
    ? twilioStr(input.accountSid ?? undefined) ?? null
    : existing?.twilioAccountSid ?? null;
  const apiKeySid = input.apiKeySid !== undefined
    ? twilioStr(input.apiKeySid ?? undefined) ?? null
    : existing?.twilioApiKeySid ?? null;
  const twimlAppSid = input.twimlAppSid !== undefined
    ? twilioStr(input.twimlAppSid ?? undefined) ?? null
    : existing?.twilioTwimlAppSid ?? null;
  const region = input.region !== undefined
    ? sanitizeTwilioRegion(input.region)
    : existing?.twilioRegion ?? null;

  if (accountSid && !accountSid.startsWith('AC')) {
    throw new Error('Account SID must start with AC');
  }
  if (apiKeySid && !apiKeySid.startsWith('SK')) {
    throw new Error('API Key SID must start with SK');
  }
  if (twimlAppSid && !twimlAppSid.startsWith('AP')) {
    throw new Error('TwiML App SID must start with AP');
  }

  let authTokenEnc = existing?.twilioAuthTokenEnc ?? null;
  if (input.authToken !== undefined) {
    const token = twilioStr(input.authToken ?? undefined);
    if (token) {
      authTokenEnc = encryptSecret(token);
    }
    // Blank authToken in request = keep existing encrypted value
  }

  let apiKeySecretEnc = existing?.twilioApiKeySecretEnc ?? null;
  if (input.apiKeySecret !== undefined) {
    const secret = twilioStr(input.apiKeySecret ?? undefined);
    if (secret) {
      apiKeySecretEnc = encryptSecret(secret);
    }
  }

  await prisma.phoneAgencyConfig.update({
    where: { subCompanyId },
    data: {
      twilioAccountSid: accountSid,
      twilioAuthTokenEnc: authTokenEnc,
      twilioApiKeySid: apiKeySid,
      twilioApiKeySecretEnc: apiKeySecretEnc,
      twilioTwimlAppSid: twimlAppSid,
      twilioRegion: region,
    },
  });

  return getAgencyTwilioPublicConfig(subCompanyId);
}

export async function resolveAgencyIdByTwilioAccountSid(
  accountSid: string,
): Promise<string | null> {
  const row = await prisma.phoneAgencyConfig.findFirst({
    where: { twilioAccountSid: accountSid },
    select: { subCompanyId: true },
  });
  return row?.subCompanyId ?? null;
}

/** Auth tokens to try for webhook signature validation (DB per agency, then env fallback). */
export async function resolveWebhookAuthTokenCandidates(
  body: Record<string, unknown>,
): Promise<string[]> {
  const out: string[] = [];
  const add = (token: string | null | undefined) => {
    const s = twilioStr(token ?? undefined);
    if (s && !out.includes(s)) out.push(s);
  };

  const accountSid = typeof body.AccountSid === 'string' ? body.AccountSid.trim() : null;
  if (accountSid) {
    const row = await prisma.phoneAgencyConfig.findFirst({
      where: { twilioAccountSid: accountSid },
      select: { twilioAuthTokenEnc: true },
    });
    if (row?.twilioAuthTokenEnc) {
      try {
        add(decryptSecret(row.twilioAuthTokenEnc));
      } catch (err) {
        console.warn('[resolveWebhookAuthToken] Failed to decrypt agency auth token:', err);
      }
    }
  }

  const envSid = twilioStr(env.TWILIO_ACCOUNT_SID);
  const envToken = twilioStr(env.TWILIO_AUTH_TOKEN);
  if (envToken && (!accountSid || accountSid === envSid)) {
    add(envToken);
  }

  return out;
}

/** Resolve auth token for Twilio webhook signature validation. */
export async function resolveWebhookAuthToken(
  body: Record<string, unknown>,
): Promise<string | null> {
  const candidates = await resolveWebhookAuthTokenCandidates(body);
  return candidates[0] ?? null;
}

/** REST Basic auth pair for downloading recordings from Twilio media URLs. */
export async function resolveTwilioRestAuth(
  body: Record<string, unknown>,
  subCompanyId?: string | null,
): Promise<{ accountSid: string; authToken: string } | null> {
  if (subCompanyId) {
    const creds = await getAgencyTwilioCredentials(subCompanyId);
    if (creds) return { accountSid: creds.accountSid, authToken: creds.authToken };
  }
  const accountSid = typeof body.AccountSid === 'string' ? body.AccountSid.trim() : null;
  if (accountSid) {
    const agencyId = await resolveAgencyIdByTwilioAccountSid(accountSid);
    if (agencyId) {
      const creds = await getAgencyTwilioCredentials(agencyId);
      if (creds) return { accountSid: creds.accountSid, authToken: creds.authToken };
    }
  }
  return null;
}

export function getTwilioRestClient(creds: AgencyTwilioCredentials): ReturnType<typeof twilio> {
  return twilio(creds.accountSid, creds.authToken);
}

/** Twilio returns 20003/401 (or an "authenticate" message) when credentials are rejected. */
function isTwilioAuthError(e: unknown): boolean {
  const rest = e as { code?: number; status?: number; message?: string };
  const code = rest?.code ?? rest?.status;
  return code === 20003 || code === 401 || /authenticate/i.test(rest?.message ?? '');
}

function twilioErrorMessage(e: unknown, fallback: string): string {
  const rest = e as { message?: string };
  return rest?.message ?? (e instanceof Error ? e.message : fallback);
}

export async function testAgencyTwilioConnection(subCompanyId: string): Promise<{
  ok: boolean;
  message: string;
  phoneNumberCount?: number;
}> {
  const creds = await getAgencyTwilioCredentials(subCompanyId);
  if (!isAgencyTwilioConfigured(creds)) {
    return { ok: false, message: 'Twilio credentials incomplete for this agency' };
  }

  const markError = () =>
    prisma.phoneAgencyConfig
      .update({ where: { subCompanyId }, data: { syncStatus: 'error', lastSyncedAt: new Date() } })
      .catch(() => {});

  // Check 1: API Key SID + API Key Secret (fetches the TwiML app).
  try {
    const apiKeyClient = twilio(creds!.apiKeySid, creds!.apiKeySecret, {
      accountSid: creds!.accountSid,
    });
    await apiKeyClient.applications(creds!.twimlAppSid).fetch();
  } catch (e) {
    await markError();
    if (isTwilioAuthError(e)) {
      return {
        ok: false,
        message:
          'Twilio rejected the API Key SID / API Key Secret. Re-enter the API Key Secret in ' +
          'Integrations → Save credentials — it is only shown once, when the SK key is created. ' +
          'Confirm the API Key SID (SK…) and TwiML App SID (AP…) belong to this agency’s subaccount.',
      };
    }
    return { ok: false, message: twilioErrorMessage(e, 'Connection failed') };
  }

  // Check 2: Account SID + Auth Token (lists incoming numbers).
  let phoneNumberCount = 0;
  try {
    const numbers = await getTwilioRestClient(creds!).incomingPhoneNumbers.list({ limit: 5 });
    phoneNumberCount = numbers.length;
  } catch (e) {
    await markError();
    if (isTwilioAuthError(e)) {
      return {
        ok: false,
        message:
          'Twilio rejected the Account SID / Auth Token. Re-enter the Auth Token in Integrations → ' +
          'Save credentials — copy it from Account → Keys & Credentials (this is the Auth Token, ' +
          'not the API Key Secret) and confirm the Account SID (AC…) matches this agency’s subaccount.',
      };
    }
    return { ok: false, message: twilioErrorMessage(e, 'Connection failed') };
  }

  await prisma.phoneAgencyConfig.update({
    where: { subCompanyId },
    data: { syncStatus: 'synced', lastSyncedAt: new Date() },
  });
  return {
    ok: true,
    message: 'Connection successful',
    phoneNumberCount,
  };
}

export async function syncPhoneNumbersFromTwilio(subCompanyId: string): Promise<{
  synced: number;
  numbers: Array<{ e164: string; sid: string }>;
}> {
  const creds = await getAgencyTwilioCredentials(subCompanyId);
  if (!creds) throw new Error('Twilio not configured for this agency');

  const client = getTwilioRestClient(creds);
  const incoming = await client.incomingPhoneNumbers.list({ limit: 20 });
  const synced: Array<{ e164: string; sid: string }> = [];

  for (const num of incoming) {
    const e164 = normalizeToE164(num.phoneNumber);
    if (!e164 || !isValidE164(e164)) continue;

    const existing = await prisma.phoneNumber.findFirst({
      where: { subCompanyId },
      orderBy: { createdAt: 'asc' },
    });

    if (existing) {
      await prisma.phoneNumber.update({
        where: { id: existing.id },
        data: { e164, twilioIncomingSid: num.sid, isActive: true },
      });
    } else {
      await prisma.phoneNumber.create({
        data: {
          subCompanyId,
          e164,
          label: 'Main line',
          isActive: true,
          twilioIncomingSid: num.sid,
        },
      });
    }

    synced.push({ e164, sid: num.sid });
  }

  const primary = synced[0]?.e164 ?? null;
  if (primary) {
    await prisma.phoneAgencyConfig.update({
      where: { subCompanyId },
      data: {
        outboundCallerId: primary,
        syncStatus: 'synced',
        lastSyncedAt: new Date(),
      },
    });
    await prisma.subCompany.update({
      where: { id: subCompanyId },
      data: { agencyPhone: primary },
    });
  }

  return { synced: synced.length, numbers: synced };
}
