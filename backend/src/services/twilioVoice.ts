/**
 * Twilio Voice: access tokens for in-browser calling (Twilio Voice JS SDK)
 * and optional server-side outbound call creation.
 */
import twilio from 'twilio';
import { env } from '../config/env';
import {
  getAgencyTwilioCredentials,
  isAgencyTwilioConfigured,
  type AgencyTwilioCredentials,
} from './agencyTwilioService';

/** Trim secrets/SIDs — trailing newlines in .env break HMAC and Twilio returns 31204. */
function twilioStr(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t && t.length > 0 ? t : undefined;
}

const accountSid = twilioStr(env.TWILIO_ACCOUNT_SID);
const authToken = twilioStr(env.TWILIO_AUTH_TOKEN);
const apiKeySid = twilioStr(env.TWILIO_API_KEY_SID);
const apiKeySecret = twilioStr(env.TWILIO_API_KEY_SECRET);
const twimlAppSid = twilioStr(env.TWILIO_TWIML_APP_SID);
const twilioRegion = twilioStr(env.TWILIO_REGION);

let voiceCredentialCheckExpiresAt = 0;
const VOICE_CREDENTIAL_CACHE_MS = 5 * 60 * 1000;

/** Identity for Voice token: alphanumeric and underscore only, max 121 chars */
export function toVoiceIdentity(userId: string, email?: string | null): string {
  const raw = email ?? userId;
  const safe = raw.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 121);
  return safe || `user_${userId.slice(0, 100)}`;
}

export function isTwilioVoiceConfigured(): boolean {
  return Boolean(
    accountSid &&
      authToken &&
      apiKeySid &&
      apiKeySecret &&
      twimlAppSid
  );
}

export async function isAgencyVoiceTwilioConfigured(subCompanyId: string): Promise<boolean> {
  const creds = await getAgencyTwilioCredentials(subCompanyId);
  return isAgencyTwilioConfigured(creds);
}

function assertVoiceTokenCredentialsShape(creds: {
  accountSid: string;
  apiKeySid: string;
  twimlAppSid: string;
}): void {
  if (!creds.accountSid.startsWith('AC')) {
    throw new Error(
      'Account SID must start with AC. If you put an API Key SID here, swap it with the API Key SID field.',
    );
  }
  if (!creds.apiKeySid.startsWith('SK')) {
    throw new Error(
      'API Key SID must start with SK — from Twilio Console → Account → API keys & tokens.',
    );
  }
  if (!creds.twimlAppSid.startsWith('AP')) {
    throw new Error('TwiML App SID must start with AP and be linked to this account.');
  }
}

function createVoiceTokenFromCreds(
  creds: AgencyTwilioCredentials,
  identity: string,
  email?: string | null,
): string {
  assertVoiceTokenCredentialsShape(creds);
  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;
  const voiceIdentity = toVoiceIdentity(identity, email);
  const token = new AccessToken(creds.accountSid, creds.apiKeySid, creds.apiKeySecret, {
    identity: voiceIdentity,
    ttl: 3600,
    ...(creds.region ? { region: creds.region } : {}),
  });
  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: creds.twimlAppSid,
    incomingAllow: true,
  });
  token.addGrant(voiceGrant);
  return token.toJwt();
}

/**
 * Verifies API key + TwiML App for an agency (or env fallback).
 */
export async function ensureAgencyTwilioVoiceSigningCredentials(
  subCompanyId: string,
): Promise<void> {
  const creds = await getAgencyTwilioCredentials(subCompanyId);
  if (!isAgencyTwilioConfigured(creds)) {
    throw new Error('Twilio Voice is not configured for this agency');
  }
  assertVoiceTokenCredentialsShape(creds!);

  const now = Date.now();
  if (now < voiceCredentialCheckExpiresAt) return;

  try {
    const client = twilio(creds!.apiKeySid, creds!.apiKeySecret, { accountSid: creds!.accountSid });
    await client.applications(creds!.twimlAppSid).fetch();
    voiceCredentialCheckExpiresAt = now + VOICE_CREDENTIAL_CACHE_MS;
  } catch (e) {
    const rest = e as { code?: number; status?: number; message?: string };
    const code = rest?.code ?? rest?.status;
    const hint =
      code === 20003 || code === 401
        ? 'Authentication failed: API Key Secret must be the secret shown once when the API key was created.'
        : code === 20404
          ? 'TwiML App not found: verify TwiML App SID is valid for this account.'
          : null;
    const tail = hint ? ` ${hint}` : '';
    throw new Error(`${rest?.message ?? 'Twilio API rejected credentials'}.${tail}`);
  }
}

/** @deprecated Use ensureAgencyTwilioVoiceSigningCredentials — env-only check */
export async function ensureTwilioVoiceSigningCredentials(): Promise<void> {
  if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
    throw new Error('Twilio Voice is not configured (missing env vars)');
  }
  assertVoiceTokenCredentialsShape({ accountSid, apiKeySid, twimlAppSid });
  const now = Date.now();
  if (now < voiceCredentialCheckExpiresAt) return;
  const client = twilio(apiKeySid, apiKeySecret, { accountSid });
  await client.applications(twimlAppSid).fetch();
  voiceCredentialCheckExpiresAt = now + VOICE_CREDENTIAL_CACHE_MS;
}

export async function createVoiceTokenForAgency(
  subCompanyId: string,
  identity: string,
  email?: string | null,
): Promise<string> {
  const creds = await getAgencyTwilioCredentials(subCompanyId);
  if (!isAgencyTwilioConfigured(creds)) {
    throw new Error('Twilio Voice is not configured for this agency');
  }
  return createVoiceTokenFromCreds(creds!, identity, email);
}

/** @deprecated Use createVoiceTokenForAgency — env-only token */
export function createVoiceToken(identity: string, email?: string | null): string {
  if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
    throw new Error('Twilio Voice is not configured (missing env vars)');
  }
  return createVoiceTokenFromCreds(
    {
      accountSid,
      authToken: authToken!,
      apiKeySid,
      apiKeySecret,
      twimlAppSid,
      region: twilioRegion,
      source: 'env',
    },
    identity,
    email,
  );
}

/**
 * Server-initiated PSTN leg only (no browser). Callee hears TwiML audio only — not bridged to the CRM.
 */
export async function createOutboundCall(
  to: string,
  fromCallerId: string,
  options?: { statusCallback?: string; subCompanyId?: string },
): Promise<{ sid: string }> {
  if (!options?.subCompanyId) {
    throw new Error('Agency context required for outbound calls');
  }
  const creds = await getAgencyTwilioCredentials(options.subCompanyId);
  if (!creds) {
    throw new Error('Twilio outbound call is not configured for this agency');
  }
  const client = twilio(creds.accountSid, creds.authToken);
  const twiml = `<Response><Say>Connected.</Say><Pause length="3600"/></Response>`;
  const params: Parameters<typeof client.calls.create>[0] = {
    to,
    from: fromCallerId,
    twiml,
    record: true,
  };
  if (options?.statusCallback) {
    params.statusCallback = options.statusCallback;
    params.statusCallbackEvent = ['completed'];
    params.statusCallbackMethod = 'POST';
  }
  const call = await client.calls.create(params);
  return { sid: call.sid };
}

export async function callAgentIntoConference(
  agentIdentity: string,
  conferenceRoom: string,
  fromCallerId: string,
  subCompanyId?: string,
  options?: { statusCallback?: string; timeout?: number },
): Promise<{ sid: string }> {
  if (!subCompanyId) {
    throw new Error('Agency context required for conference calls');
  }
  const creds = await getAgencyTwilioCredentials(subCompanyId);
  if (!creds || !fromCallerId) {
    throw new Error('Twilio outbound call is not configured for this agency');
  }
  const client = twilio(creds.accountSid, creds.authToken);
  const twiml = `<Response><Dial><Conference waitUrl="" startConferenceOnEnter="true" endConferenceOnExit="false" beep="false">${escapeXml(conferenceRoom)}</Conference></Dial></Response>`;
  const params: Parameters<typeof client.calls.create>[0] = {
    to: `client:${agentIdentity}`,
    from: fromCallerId,
    twiml,
  };
  if (options?.statusCallback) {
    params.statusCallback = options.statusCallback;
    params.statusCallbackEvent = ['initiated', 'ringing', 'answered', 'completed'];
    params.statusCallbackMethod = 'POST';
  }
  if (options?.timeout != null && options.timeout > 0) {
    params.timeout = options.timeout;
  }
  const call = await client.calls.create(params);
  console.log(`[callAgentIntoConference] Called client:${agentIdentity} into ${conferenceRoom}, sid=${call.sid}`);
  return { sid: call.sid };
}

/** REST-dial a PSTN number into an existing conference room (outbound callee leg). */
export async function callPstnIntoConference(
  toNumber: string,
  conferenceRoom: string,
  fromCallerId: string,
  subCompanyId: string,
  options?: { statusCallback?: string },
): Promise<{ sid: string }> {
  const creds = await getAgencyTwilioCredentials(subCompanyId);
  if (!creds || !fromCallerId) {
    throw new Error('Twilio outbound call is not configured for this agency');
  }
  const client = twilio(creds.accountSid, creds.authToken);
  const safeNumber = toNumber.replace(/[^+0-9]/g, '');
  const twiml = `<Response><Dial><Conference waitUrl="" startConferenceOnEnter="false" endConferenceOnExit="true" beep="false">${escapeXml(conferenceRoom)}</Conference></Dial></Response>`;
  const params: Parameters<typeof client.calls.create>[0] = {
    to: safeNumber,
    from: fromCallerId,
    twiml,
  };
  if (options?.statusCallback) {
    params.statusCallback = options.statusCallback;
    params.statusCallbackEvent = ['initiated', 'ringing', 'answered', 'completed'];
    params.statusCallbackMethod = 'POST';
  }
  const call = await client.calls.create(params);
  console.log(`[callPstnIntoConference] Dialed ${safeNumber} into ${conferenceRoom}, sid=${call.sid}`);
  return { sid: call.sid };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
