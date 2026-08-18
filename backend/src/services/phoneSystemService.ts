/**
 * Per-agency phone system — DB source of truth for numbers, caller ID, and IVR bundle.
 */
import { Prisma, type InboundCallOutcome } from '@prisma/client';
import { z } from 'zod';
import prisma from '../config/database';
import { env } from '../config/env';
import { isValidE164, normalizeToE164 } from '../utils/phoneE164';
import { buildReferenceSeedBundle, materializeDefaultBundle } from './phoneSystemReferenceDefaults';
import { toVoiceIdentity } from './twilioVoice';
import {
  ensureExtensionDialInFlow,
  ensureBusinessHoursInFlow,
  ensureQueueOnBusyInFlow,
  ensureExtensionMessageNodesInFlow,
  ensureGreetingClipExtensionHint,
} from './phoneSystemFlowRepair';
import { repairFlowEdges, validateCallFlowEdges } from './callFlowRouter';
import { ensureSystemAudioClips } from './phoneSystemSystemClips';
import {
  inferAudioContentType,
  isAllowedAudioMimeType,
  normalizeAudioClips,
  type AudioClipRecord,
} from './phoneSystemAudioClips';
import { buildAgencyR2Key, deleteFromR2, isR2Configured, uploadToR2 } from './r2Storage';
import {
  getAgencyTwilioPublicConfig,
  saveAgencyTwilioCredentials,
  seedAgencyTwilioDefaultsIfEmpty,
  type SaveAgencyTwilioInput,
} from './agencyTwilioService';
import { isAgencyVoiceTwilioConfigured } from './twilioVoice';
import {
  buildInboundInboxWhere,
  getUserRingGroups,
  resolveDefaultInbox,
  type InboundInbox,
} from './inboundVoicemailAccess';

const uuidSchema = z.string().uuid();

export interface AgencyVoiceConfig {
  voiceEnabled: boolean;
  outboundEnabled: boolean;
  inboundEnabled: boolean;
  outboundCallerId: string | null;
  inboundDid: string | null;
}

export interface PhoneNumberDto {
  id: string;
  e164: string;
  label: string;
  isActive: boolean;
  twilioIncomingSid?: string | null;
}

export interface AgencyTwilioConfigDto {
  accountSid: string | null;
  apiKeySid: string | null;
  twimlAppSid: string | null;
  region: string | null;
  hasAuthToken: boolean;
  hasApiKeySecret: boolean;
  credentialsConfigured: boolean;
}

export interface AgencyPhoneBundleDto {
  subCompanyId: string;
  agencyName: string;
  flowTitle: string;
  config: {
    syncStatus: 'not_connected' | 'synced' | 'error';
    lastSyncedAt: string | null;
    autoAttendantExtension: string;
    allowExtensionDialing: boolean;
    gatherTimeoutSec: number;
    greetingClipName: string;
    timeoutRouteLabel: string;
    invalidRouteLabel: string;
    providerType: 'twilio';
    webhookUrl: string;
    outboundCallerId?: string;
    outboundEnabled?: boolean;
    inboundEnabled?: boolean;
    timezone: string;
  };
  twilio: AgencyTwilioConfigDto;
  phoneNumbers: PhoneNumberDto[];
  menuRoutes: unknown[];
  ringGroups: unknown[];
  staffExtensions: unknown[];
  voicemailBoxes: unknown[];
  audioClips: unknown[];
  businessHours: unknown[];
  readinessSteps: unknown[];
  draftFlow: unknown;
  publishedFlow: unknown | null;
  updatedAt: string;
}

const defaultWebhookUrl = () => {
  const base = (env.PUBLIC_API_URL || env.APP_URL || '').replace(/\/$/, '');
  return base ? `${base}${env.API_PREFIX}/${env.API_VERSION}/voice/webhook/inbound` : '';
};

function defaultConfigFields() {
  return {
    syncStatus: 'not_connected' as const,
    lastSyncedAt: null,
    autoAttendantExtension: '112',
    allowExtensionDialing: true,
    gatherTimeoutSec: 5,
    greetingClipName: 'Greeting Options',
    timeoutRouteLabel: 'Menu timeout — please try again',
    invalidRouteLabel: 'Play Locations clip',
    providerType: 'twilio' as const,
    webhookUrl: defaultWebhookUrl(),
    timezone: 'America/Toronto',
  };
}

function parseJsonArray<T>(value: Prisma.JsonValue | null | undefined): T[] {
  if (!value || !Array.isArray(value)) return [];
  return value as T[];
}

/** Reject non-IANA timezone strings before they reach the DB / call-flow engine. */
function validateTimezone(tz: string): string {
  const trimmed = tz.trim();
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return trimmed;
  } catch {
    throw new Error('Invalid timezone');
  }
}

function parseClientIdentity(from: unknown): string | null {
  if (typeof from !== 'string') return null;
  const m = from.match(/^client:(.+)$/i);
  return m?.[1]?.trim() || null;
}

async function findUserIdByVoiceIdentity(identity: string): Promise<string | null> {
  const users = await prisma.user.findMany({
    select: { id: true, email: true },
  });
  for (const u of users) {
    if (toVoiceIdentity(u.id, u.email) === identity) return u.id;
  }
  return null;
}

async function resolveCallRecordFromWebhookBody(
  body: Record<string, unknown>,
): Promise<{ id: string; subCompanyId: string } | null> {
  const explicitKeys = [
    body.callRecordId,
    body.CallRecordId,
    body.call_record_id,
    body.CrmCallId,
    body.crmCallId,
    body.crm_call_id,
  ];
  for (const raw of explicitKeys) {
    const parsed = uuidSchema.safeParse(raw);
    if (!parsed.success) continue;
    const row = await prisma.call.findUnique({
      where: { id: parsed.data },
      select: { id: true, subCompanyId: true },
    });
    if (row) return row;
  }

  for (const val of Object.values(body)) {
    if (typeof val !== 'string') continue;
    const parsed = uuidSchema.safeParse(val);
    if (!parsed.success) continue;
    const row = await prisma.call.findUnique({
      where: { id: parsed.data },
      select: { id: true, subCompanyId: true },
    });
    if (row) return row;
  }

  return null;
}

async function resolveSubCompanyIdFromWebhookBody(body: Record<string, unknown>): Promise<string | null> {
  const agencyKeys = [body.subCompanyId, body.SubCompanyId, body.sub_company_id, body.agencyId];
  for (const raw of agencyKeys) {
    const parsed = uuidSchema.safeParse(raw);
    if (!parsed.success) continue;
    const row = await prisma.subCompany.findUnique({
      where: { id: parsed.data },
      select: { id: true },
    });
    if (row) return row.id;
  }
  return null;
}

/** Resolve CRM call row + agency from Twilio TwiML webhook body. */
export async function resolveOutboundCallFromWebhook(
  body: Record<string, unknown>,
): Promise<{ callRecordId: string | null; subCompanyId: string | null }> {
  const callRow = await resolveCallRecordFromWebhookBody(body);
  if (callRow) {
    return { callRecordId: callRow.id, subCompanyId: callRow.subCompanyId };
  }

  const explicitAgencyId = await resolveSubCompanyIdFromWebhookBody(body);
  if (explicitAgencyId) {
    console.log('[resolveOutboundCallFromWebhook] Matched subCompanyId param:', explicitAgencyId);
    return { callRecordId: null, subCompanyId: explicitAgencyId };
  }

  const identity = parseClientIdentity(body.From ?? body.Caller);
  if (!identity) {
    console.warn('[resolveOutboundCallFromWebhook] No callRecordId, agency param, or client identity');
    return { callRecordId: null, subCompanyId: null };
  }

  const userId = await findUserIdByVoiceIdentity(identity);
  if (!userId) {
    console.warn('[resolveOutboundCallFromWebhook] No user for voice identity:', identity);
    return { callRecordId: null, subCompanyId: null };
  }

  const recent = await prisma.call.findFirst({
    where: {
      ownerId: userId,
      createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, subCompanyId: true },
  });

  if (recent) {
    console.log('[resolveOutboundCallFromWebhook] Matched recent initiated call:', recent.id);
    return { callRecordId: recent.id, subCompanyId: recent.subCompanyId };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subCompanyId: true },
  });
  if (user?.subCompanyId) {
    console.log('[resolveOutboundCallFromWebhook] Using user home agency:', user.subCompanyId);
    return { callRecordId: null, subCompanyId: user.subCompanyId };
  }

  return { callRecordId: null, subCompanyId: null };
}

/** Caller ID from DB only — no env fallback. */
export async function resolveAgencyOutboundCallerId(subCompanyId: string): Promise<string | null> {
  const config = await prisma.phoneAgencyConfig.findUnique({ where: { subCompanyId } });
  if (config?.outboundCallerId) return config.outboundCallerId;

  const primary = await prisma.phoneNumber.findFirst({
    where: { subCompanyId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (primary?.e164) return primary.e164;

  return null;
}

export async function getPrimaryInboundDid(subCompanyId: string): Promise<string | null> {
  const primary = await prisma.phoneNumber.findFirst({
    where: { subCompanyId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  return primary?.e164 ?? null;
}

export async function getAgencyVoiceConfig(
  subCompanyId: string,
): Promise<AgencyVoiceConfig> {
  const [config, inboundDid, outboundCallerId, twilioOk] = await Promise.all([
    prisma.phoneAgencyConfig.findUnique({ where: { subCompanyId } }),
    getPrimaryInboundDid(subCompanyId),
    resolveAgencyOutboundCallerId(subCompanyId),
    isAgencyVoiceTwilioConfigured(subCompanyId),
  ]);

  const hasNumber = Boolean(outboundCallerId || inboundDid);
  const voiceEnabled = twilioOk && hasNumber;

  return {
    voiceEnabled,
    outboundEnabled: config?.outboundEnabled ?? hasNumber,
    inboundEnabled: config?.inboundEnabled ?? hasNumber,
    outboundCallerId,
    inboundDid,
  };
}

// In-process cache: seeding is one-time-per-startup work, not per-request work.
// After the first ensureConfigRow call for a subCompany, subsequent calls skip all
// seeding and just fetch the row — preventing a DB storm from frequent polls.
const _seededSubCompanies = new Set<string>();

export async function ensureConfigRow(subCompanyId: string) {
  // Fast path: row already exists and seeding completed this process — one SELECT only.
  if (_seededSubCompanies.has(subCompanyId)) {
    return prisma.phoneAgencyConfig.findUniqueOrThrow({ where: { subCompanyId } });
  }

  let row: Awaited<ReturnType<typeof prisma.phoneAgencyConfig.findUniqueOrThrow>>;
  try {
    row = await prisma.phoneAgencyConfig.upsert({
      where: { subCompanyId },
      create: {
        subCompanyId,
        syncStatus: 'not_connected',
        autoAttendantExtension: '112',
        allowExtensionDialing: true,
        gatherTimeoutSec: 5,
        greetingClipName: 'Greeting Options',
        timeoutRouteLabel: 'Menu timeout — please try again',
        invalidRouteLabel: 'Play Locations clip',
      },
      update: {},
    });
  } catch (e: any) {
    // Race condition: two concurrent calls both attempted INSERT — row now exists, just fetch it
    if (e?.code === 'P2002') {
      row = await prisma.phoneAgencyConfig.findUniqueOrThrow({ where: { subCompanyId } });
    } else {
      throw e;
    }
  }
  await seedReferenceDefaultsIfEmpty(subCompanyId, row);
  await seedAgencyTwilioDefaultsIfEmpty(subCompanyId);
  const agencyCount = await prisma.subCompany.count();
  if (agencyCount === 1) {
    await backfillPhoneNumbersFromEnv(subCompanyId);
  }
  _seededSubCompanies.add(subCompanyId);
  return row;
}

function isEmptyPhoneBundle(row: {
  defaultsSeededAt: Date | null;
  draftFlow: Prisma.JsonValue | null;
  publishedFlow: Prisma.JsonValue | null;
  ringGroups: Prisma.JsonValue;
}): boolean {
  if (row.defaultsSeededAt) return false;
  const draft = row.draftFlow as { nodes?: unknown[] } | null;
  const published = row.publishedFlow as { nodes?: unknown[] } | null;
  const hasFlowNodes = (draft?.nodes?.length ?? 0) > 0 || (published?.nodes?.length ?? 0) > 0;
  const ringGroups = parseJsonArray(row.ringGroups);
  return !hasFlowNodes && ringGroups.length === 0;
}

/** Seed reference IVR template once — never overwrites user-edited data. */
export async function seedReferenceDefaultsIfEmpty(
  subCompanyId: string,
  existing?: { defaultsSeededAt: Date | null; draftFlow: Prisma.JsonValue | null; publishedFlow: Prisma.JsonValue | null; ringGroups: Prisma.JsonValue } | null,
): Promise<boolean> {
  const row =
    existing ??
    (await prisma.phoneAgencyConfig.findUnique({
      where: { subCompanyId },
      select: { defaultsSeededAt: true, draftFlow: true, publishedFlow: true, ringGroups: true },
    }));
  if (!row || !isEmptyPhoneBundle(row)) return false;

  const seed = buildReferenceSeedBundle();
  await applyDefaultBundleToConfig(subCompanyId, seed);
  return true;
}

function applyDefaultBundleData(seed: ReturnType<typeof buildReferenceSeedBundle>): Prisma.PhoneAgencyConfigUpdateInput {
  return {
    flowTitle: seed.flowTitle,
    autoAttendantExtension: seed.config.autoAttendantExtension,
    allowExtensionDialing: seed.config.allowExtensionDialing,
    gatherTimeoutSec: seed.config.gatherTimeoutSec,
    greetingClipName: seed.config.greetingClipName,
    timeoutRouteLabel: seed.config.timeoutRouteLabel,
    invalidRouteLabel: seed.config.invalidRouteLabel,
    menuRoutes: seed.menuRoutes as Prisma.InputJsonValue,
    ringGroups: seed.ringGroups as Prisma.InputJsonValue,
    staffExtensions: seed.staffExtensions as Prisma.InputJsonValue,
    voicemailBoxes: seed.voicemailBoxes as Prisma.InputJsonValue,
    audioClips: seed.audioClips as Prisma.InputJsonValue,
    businessHours: seed.businessHours as Prisma.InputJsonValue,
    readinessSteps: seed.readinessSteps as Prisma.InputJsonValue,
    draftFlow: seed.draftFlow as Prisma.InputJsonValue,
    publishedFlow: seed.publishedFlow as Prisma.InputJsonValue,
    defaultsSeededAt: new Date(),
  };
}

async function applyDefaultBundleToConfig(
  subCompanyId: string,
  seed: ReturnType<typeof buildReferenceSeedBundle>,
): Promise<void> {
  await prisma.phoneAgencyConfig.update({
    where: { subCompanyId },
    data: applyDefaultBundleData(seed),
  });
}

/** Reset IVR + call flow to canonical template; keeps numbers, toggles, and staff assignments. */
export async function restorePhoneSystemDefaults(subCompanyId: string): Promise<AgencyPhoneBundleDto> {
  await ensureConfigRow(subCompanyId);

  const existing = await prisma.phoneAgencyConfig.findUnique({ where: { subCompanyId } });
  if (!existing) throw new Error('Agency phone config not found');

  const existingRingGroups = parseJsonArray<{ extension: string; members?: unknown[] }>(existing.ringGroups);
  const existingStaff = parseJsonArray(existing.staffExtensions);

  const seed = materializeDefaultBundle({
    preserveRingGroupMembers: existingRingGroups,
    preserveStaffExtensions: existingStaff,
  });

  await applyDefaultBundleToConfig(subCompanyId, {
    ...seed,
    staffExtensions: existingStaff,
  });

  const bundle = await getPhoneSystemBundle(subCompanyId);
  if (!bundle) throw new Error('Failed to load bundle after restore');
  return bundle;
}

function configToDto(
  row: NonNullable<Awaited<ReturnType<typeof prisma.phoneAgencyConfig.findUnique>>>,
  phoneNumbers: PhoneNumberDto[],
  agencyName: string,
  twilio: AgencyTwilioConfigDto,
): AgencyPhoneBundleDto {
  const primary = phoneNumbers.find((n) => n.isActive) ?? phoneNumbers[0];
  const allowExtensionDialing = row.allowExtensionDialing;
  const draftRaw = (row.draftFlow ?? { version: 1, nodes: [], edges: [] }) as {
    version: number;
    nodes: unknown[];
    edges: unknown[];
  };
  const publishedRaw = row.publishedFlow as { version: number; nodes: unknown[]; edges: unknown[] } | null;
  const draftWithExt =
    ensureExtensionDialInFlow(draftRaw as Parameters<typeof ensureExtensionDialInFlow>[0], allowExtensionDialing) ??
    draftRaw;
  const draftFlow =
    ensureQueueOnBusyInFlow(
      ensureBusinessHoursInFlow(draftWithExt as Parameters<typeof ensureBusinessHoursInFlow>[0]),
    ) ?? draftWithExt;
  const publishedFlow = publishedRaw
    ? ensureQueueOnBusyInFlow(
        ensureBusinessHoursInFlow(
          (ensureExtensionDialInFlow(
            publishedRaw as Parameters<typeof ensureExtensionDialInFlow>[0],
            allowExtensionDialing,
          ) ?? publishedRaw) as Parameters<typeof ensureBusinessHoursInFlow>[0],
        ),
      )
    : null;
  const audioClips = normalizeAudioClips(
    ensureSystemAudioClips(
      ensureGreetingClipExtensionHint(
        parseJsonArray(row.audioClips) as Array<{ name: string; scriptText: string; [key: string]: unknown }>,
      ),
    ),
  );

  return {
    subCompanyId: row.subCompanyId,
    agencyName,
    flowTitle: row.flowTitle,
    config: {
      ...defaultConfigFields(),
      syncStatus: (row.syncStatus as AgencyPhoneBundleDto['config']['syncStatus']) || 'not_connected',
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
      autoAttendantExtension: row.autoAttendantExtension,
      allowExtensionDialing: row.allowExtensionDialing,
      gatherTimeoutSec: row.gatherTimeoutSec,
      greetingClipName: row.greetingClipName ?? defaultConfigFields().greetingClipName,
      timeoutRouteLabel: row.timeoutRouteLabel ?? defaultConfigFields().timeoutRouteLabel,
      invalidRouteLabel: row.invalidRouteLabel ?? defaultConfigFields().invalidRouteLabel,
      outboundCallerId: row.outboundCallerId ?? primary?.e164 ?? undefined,
      outboundEnabled: row.outboundEnabled,
      inboundEnabled: row.inboundEnabled,
      timezone: row.timezone ?? defaultConfigFields().timezone,
    },
    twilio,
    phoneNumbers,
    menuRoutes: parseJsonArray(row.menuRoutes),
    ringGroups: parseJsonArray(row.ringGroups),
    staffExtensions: parseJsonArray(row.staffExtensions),
    voicemailBoxes: parseJsonArray(row.voicemailBoxes),
    audioClips,
    businessHours: parseJsonArray(row.businessHours),
    readinessSteps: parseJsonArray(row.readinessSteps),
    draftFlow,
    publishedFlow,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getPhoneSystemBundle(subCompanyId: string): Promise<AgencyPhoneBundleDto | null> {
  const subCompany = await prisma.subCompany.findUnique({
    where: { id: subCompanyId },
    select: { id: true, name: true },
  });
  if (!subCompany) return null;

  await ensureConfigRow(subCompanyId);

  const [config, numbers] = await Promise.all([
    prisma.phoneAgencyConfig.findUnique({ where: { subCompanyId } }),
    prisma.phoneNumber.findMany({
      where: { subCompanyId },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  if (!config) return null;

  const twilio = await getAgencyTwilioPublicConfig(subCompanyId);

  const phoneNumbers: PhoneNumberDto[] = numbers.map((n) => ({
    id: n.id,
    e164: n.e164,
    label: n.label,
    isActive: n.isActive,
    twilioIncomingSid: n.twilioIncomingSid,
  }));

  return configToDto(config, phoneNumbers, subCompany.name, twilio);
}

export interface PutPhoneSystemBundleInput {
  flowTitle?: string;
  config?: Partial<AgencyPhoneBundleDto['config']>;
  twilio?: SaveAgencyTwilioInput;
  phoneNumbers?: PhoneNumberDto[];
  menuRoutes?: unknown[];
  ringGroups?: unknown[];
  staffExtensions?: unknown[];
  voicemailBoxes?: unknown[];
  audioClips?: unknown[];
  businessHours?: unknown[];
  readinessSteps?: unknown[];
  draftFlow?: unknown;
  publishedFlow?: unknown | null;
}

/** Sync SubCompany.agencyPhone from primary active DID (read-only in Agencies UI). */
async function syncAgencyPhoneDisplay(subCompanyId: string, e164: string | null) {
  await prisma.subCompany.update({
    where: { id: subCompanyId },
    data: { agencyPhone: e164 },
  });
}

const audioClipInputSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    sourceType: z.enum(['message', 'upload']).optional(),
    scriptText: z.string(),
    r2Key: z.string().nullable().optional(),
    fileName: z.string().nullable().optional(),
    mimeType: z.string().nullable().optional(),
    durationSec: z.number(),
    uploadedAt: z.string(),
  })
  .superRefine((clip, ctx) => {
    const sourceType = clip.sourceType ?? (clip.r2Key ? 'upload' : 'message');
    if (sourceType === 'message' && !clip.scriptText.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Audio clip "${clip.name}" requires script text for message playback`,
      });
    }
    if (sourceType === 'upload' && !clip.r2Key) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Audio clip "${clip.name}" requires an uploaded voice file`,
      });
    }
  });

function validateAudioClipsInput(audioClips: unknown[]): void {
  for (const clip of audioClips) {
    const parsed = audioClipInputSchema.safeParse(clip);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Invalid audio clip';
      throw new Error(message);
    }
  }
}

function collectAudioClipR2Keys(audioClips: unknown[]): Set<string> {
  const keys = new Set<string>();
  for (const raw of audioClips) {
    const clip = raw as AudioClipRecord;
    if (typeof clip.r2Key === 'string' && clip.r2Key.trim()) {
      keys.add(clip.r2Key.trim());
    }
  }
  return keys;
}

async function cleanupRemovedAudioClipFiles(
  _subCompanyId: string,
  previousClips: unknown[],
  nextClips: unknown[],
): Promise<void> {
  const previousKeys = collectAudioClipR2Keys(previousClips);
  const nextKeys = collectAudioClipR2Keys(nextClips);
  for (const key of previousKeys) {
    if (!nextKeys.has(key)) {
      await deleteFromR2(key);
    }
  }
}

export async function uploadPhoneAudioClipFile(
  subCompanyId: string,
  clipId: string,
  input: { fileBase64: string; fileName: string; mimeType?: string },
): Promise<{ r2Key: string; fileName: string; mimeType: string }> {
  if (!isR2Configured()) {
    throw new Error('File storage is not configured. Contact your administrator.');
  }
  if (!clipId.trim()) {
    throw new Error('Clip id is required');
  }
  const fileName = input.fileName.trim();
  if (!fileName) {
    throw new Error('File name is required');
  }
  if (!isAllowedAudioMimeType(input.mimeType, fileName)) {
    throw new Error('Unsupported audio format. Use MP3 or WAV.');
  }

  const maxSize = parseInt(env.MAX_FILE_SIZE ?? '10485760', 10);
  let buffer: Buffer;
  try {
    buffer = Buffer.from(input.fileBase64, 'base64');
  } catch {
    throw new Error('Invalid file data');
  }
  if (buffer.length > maxSize) {
    throw new Error('File too large');
  }
  if (buffer.length === 0) {
    throw new Error('File is empty');
  }

  const contentType = inferAudioContentType(fileName, input.mimeType);
  const r2Key = buildAgencyR2Key(subCompanyId, 'clips', `${clipId}.${fileName.split('.').pop()?.toLowerCase() === 'wav' ? 'wav' : 'mp3'}`);
  const stored = await uploadToR2(r2Key, buffer, contentType);
  if (!stored) {
    throw new Error('File upload failed');
  }

  return { r2Key, fileName, mimeType: contentType };
}

export async function getPhoneAudioClipR2Key(
  subCompanyId: string,
  clipId: string,
): Promise<string | null> {
  const config = await prisma.phoneAgencyConfig.findUnique({
    where: { subCompanyId },
    select: { audioClips: true },
  });
  if (!config) return null;
  const clips = parseJsonArray(config.audioClips) as AudioClipRecord[];
  const clip = clips.find((c) => c.id === clipId);
  if (!clip?.r2Key) return null;
  return clip.r2Key;
}

export async function putPhoneSystemBundle(
  subCompanyId: string,
  input: PutPhoneSystemBundleInput,
): Promise<AgencyPhoneBundleDto> {
  const subCompany = await prisma.subCompany.findUnique({
    where: { id: subCompanyId },
    select: { id: true, name: true },
  });
  if (!subCompany) {
    throw new Error('Agency not found');
  }

  await ensureConfigRow(subCompanyId);

  // Validate Twilio credentials before mutating numbers/config so a bad token does not
  // leave a half-saved bundle.
  if (input.twilio) {
    await saveAgencyTwilioCredentials(subCompanyId, input.twilio);
  }

  const hasBundlePayload =
    input.phoneNumbers !== undefined ||
    input.config !== undefined ||
    input.flowTitle !== undefined ||
    input.menuRoutes !== undefined ||
    input.ringGroups !== undefined ||
    input.staffExtensions !== undefined ||
    input.voicemailBoxes !== undefined ||
    input.audioClips !== undefined ||
    input.businessHours !== undefined ||
    input.readinessSteps !== undefined ||
    input.draftFlow !== undefined ||
    input.publishedFlow !== undefined;

  if (input.twilio && !hasBundlePayload) {
    const bundle = await getPhoneSystemBundle(subCompanyId);
    if (!bundle) throw new Error('Failed to load saved bundle');
    return bundle;
  }

  const existingNumbers = await prisma.phoneNumber.findMany({
    where: { subCompanyId },
    orderBy: { createdAt: 'asc' },
  });

  let primaryE164: string | null = null;

  if (input.phoneNumbers) {
    const incoming = input.phoneNumbers.slice(0, 1);
    for (const num of incoming) {
      const raw = typeof num.e164 === 'string' ? num.e164.trim() : '';
      if (!raw) continue;
      const e164 = normalizeToE164(raw);
      if (!e164 || !isValidE164(e164)) {
        throw new Error('Invalid phone number — use E.164 format (e.g. +16475551234)');
      }
      primaryE164 = e164;
      const existing = existingNumbers[0];
      if (existing) {
        await prisma.phoneNumber.update({
          where: { id: existing.id },
          data: {
            e164,
            label: num.label?.trim() || 'Main line',
            isActive: num.isActive ?? true,
            twilioIncomingSid: num.twilioIncomingSid ?? null,
          },
        });
      } else {
        await prisma.phoneNumber.create({
          data: {
            subCompanyId,
            e164,
            label: num.label?.trim() || 'Main line',
            isActive: num.isActive ?? true,
            twilioIncomingSid: num.twilioIncomingSid ?? null,
          },
        });
      }
    }
  } else {
    primaryE164 =
      existingNumbers.find((n) => n.isActive)?.e164 ??
      existingNumbers[0]?.e164 ??
      null;
  }

  const configPatch = input.config ?? {};
  let outboundCallerId = configPatch.outboundCallerId
    ? normalizeToE164(configPatch.outboundCallerId)
    : null;
  if (outboundCallerId && !isValidE164(outboundCallerId)) {
    throw new Error('Invalid outbound caller ID — use E.164 format');
  }
  if (!outboundCallerId && primaryE164) {
    outboundCallerId = primaryE164;
  }

  const existingConfig = await prisma.phoneAgencyConfig.findUnique({
    where: { subCompanyId },
    select: { audioClips: true },
  });

  if (input.audioClips !== undefined) {
    validateAudioClipsInput(input.audioClips);
    if (existingConfig) {
      await cleanupRemovedAudioClipFiles(
        subCompanyId,
        parseJsonArray(existingConfig.audioClips),
        input.audioClips,
      );
    }
  }

  const hasNumber = Boolean(primaryE164 || outboundCallerId);
  const outboundEnabled = configPatch.outboundEnabled ?? hasNumber;
  const inboundEnabled = configPatch.inboundEnabled ?? hasNumber;

  const configUpdate: Prisma.PhoneAgencyConfigUpdateInput = {
    ...(input.flowTitle !== undefined && { flowTitle: input.flowTitle }),
    outboundCallerId,
    outboundEnabled,
    inboundEnabled,
    ...(configPatch.autoAttendantExtension !== undefined && {
      autoAttendantExtension: configPatch.autoAttendantExtension.replace(/\D/g, '').slice(0, 6) || '112',
    }),
    ...(configPatch.allowExtensionDialing !== undefined && {
      allowExtensionDialing: configPatch.allowExtensionDialing,
    }),
    ...(configPatch.gatherTimeoutSec !== undefined && {
      gatherTimeoutSec: Math.min(60, Math.max(1, configPatch.gatherTimeoutSec)),
    }),
    ...(configPatch.timezone !== undefined && { timezone: validateTimezone(configPatch.timezone) }),
    ...(configPatch.greetingClipName !== undefined && { greetingClipName: configPatch.greetingClipName }),
    ...(configPatch.timeoutRouteLabel !== undefined && { timeoutRouteLabel: configPatch.timeoutRouteLabel }),
    ...(configPatch.invalidRouteLabel !== undefined && { invalidRouteLabel: configPatch.invalidRouteLabel }),
    ...(configPatch.syncStatus !== undefined && { syncStatus: configPatch.syncStatus }),
    ...(configPatch.lastSyncedAt !== undefined && {
      lastSyncedAt: configPatch.lastSyncedAt ? new Date(configPatch.lastSyncedAt) : null,
    }),
    ...(input.menuRoutes !== undefined && { menuRoutes: input.menuRoutes as Prisma.InputJsonValue }),
    ...(input.ringGroups !== undefined && { ringGroups: input.ringGroups as Prisma.InputJsonValue }),
    ...(input.staffExtensions !== undefined && {
      staffExtensions: input.staffExtensions as Prisma.InputJsonValue,
    }),
    ...(input.voicemailBoxes !== undefined && {
      voicemailBoxes: input.voicemailBoxes as Prisma.InputJsonValue,
    }),
    ...(input.audioClips !== undefined && { audioClips: input.audioClips as Prisma.InputJsonValue }),
    ...(input.businessHours !== undefined && {
      businessHours: input.businessHours as Prisma.InputJsonValue,
    }),
    ...(input.readinessSteps !== undefined && {
      readinessSteps: input.readinessSteps as Prisma.InputJsonValue,
    }),
    ...(input.draftFlow !== undefined && { draftFlow: input.draftFlow as Prisma.InputJsonValue }),
    ...(input.publishedFlow !== undefined && {
      publishedFlow: input.publishedFlow as Prisma.InputJsonValue,
    }),
  };

  await prisma.phoneAgencyConfig.update({
    where: { subCompanyId },
    data: configUpdate,
  });

  const displayPhone = primaryE164 ?? outboundCallerId;
  if (displayPhone) {
    await syncAgencyPhoneDisplay(subCompanyId, displayPhone);
  }

  const bundle = await getPhoneSystemBundle(subCompanyId);
  if (!bundle) throw new Error('Failed to load saved bundle');
  return bundle;
}

/** One-time backfill from TWILIO_CALLER_ID for a single agency missing a number. */
export async function backfillPhoneNumbersFromEnv(agencyId?: string): Promise<number> {
  const legacy = normalizeToE164(env.TWILIO_CALLER_ID);
  if (!legacy || !isValidE164(legacy)) return 0;

  const agencies = agencyId
    ? [{ id: agencyId }]
    : await prisma.subCompany.findMany({ select: { id: true }, take: 1 });

  let count = 0;

  for (const agency of agencies) {
    const existing = await prisma.phoneNumber.findFirst({
      where: { subCompanyId: agency.id },
    });
    if (existing) continue;

    await prisma.phoneNumber.create({
      data: {
        subCompanyId: agency.id,
        e164: legacy,
        label: 'Main line',
        isActive: true,
      },
    });
    await prisma.phoneAgencyConfig.upsert({
      where: { subCompanyId: agency.id },
      create: {
        subCompanyId: agency.id,
        outboundCallerId: legacy,
        outboundEnabled: true,
        inboundEnabled: true,
      },
      update: {
        outboundCallerId: legacy,
        outboundEnabled: true,
        inboundEnabled: true,
      },
    });
    await syncAgencyPhoneDisplay(agency.id, legacy);
    count += 1;
  }

  return count;
}

/** Validate published call flow before going live. */
export function validatePublishedFlow(
  flow: unknown,
  ringGroups: unknown[],
  options?: { allowExtensionDialing?: boolean },
): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const graph = flow as {
    nodes?: Array<{ id: string; type: string; data?: Record<string, unknown> }>;
    edges?: Array<{ id: string; source: string; target: string; label?: string }>;
  };
  const nodes = graph?.nodes ?? [];
  if (!nodes.length) {
    errors.push('Published flow has no nodes');
    return { ok: false, errors, warnings: [] };
  }
  const triggers = nodes.filter((n) => n.type === 'trigger_incoming');
  if (triggers.length !== 1) {
    errors.push('Published flow must have exactly one incoming trigger node');
  }
  const groupIds = new Set((ringGroups as Array<{ id: string }>).map((g) => g.id));
  for (const node of nodes) {
    if (node.type === 'connect_group' && node.data?.ringGroupId) {
      const gid = String(node.data.ringGroupId);
      if (!node.data.isFallback && !groupIds.has(gid)) {
        errors.push(`Node ${node.id} references unknown ring group`);
      }
    }
    if (node.type === 'connect_queue' && node.data?.ringGroupId) {
      const gid = String(node.data.ringGroupId);
      if (!groupIds.has(gid)) {
        errors.push(`Node ${node.id} (queue) references unknown ring group`);
      }
    }
  }
  const edgeValidation = validateCallFlowEdges(
    {
      version: 1,
      nodes: nodes as Array<{ id: string; type: string; data: Record<string, unknown> }>,
      edges: graph.edges ?? [],
    },
    { allowExtensionDialing: options?.allowExtensionDialing },
  );
  errors.push(...edgeValidation.errors);
  return { ok: errors.length === 0, errors, warnings: edgeValidation.warnings };
}

export async function publishCallFlow(subCompanyId: string): Promise<AgencyPhoneBundleDto> {
  const config = await prisma.phoneAgencyConfig.findUnique({ where: { subCompanyId } });
  if (!config) throw new Error('Agency phone config not found');
  const draftRaw = config.draftFlow;
  const ringGroups = parseJsonArray(config.ringGroups);
  const withExtDial =
    ensureExtensionDialInFlow(
      draftRaw as Parameters<typeof ensureExtensionDialInFlow>[0],
      config.allowExtensionDialing,
    ) ?? draftRaw;
  const withBusinessHours =
    ensureBusinessHoursInFlow(withExtDial as Parameters<typeof ensureBusinessHoursInFlow>[0]) ??
    withExtDial;
  const withQueues =
    ensureQueueOnBusyInFlow(withBusinessHours as Parameters<typeof ensureQueueOnBusyInFlow>[0]) ??
    withBusinessHours;
  const withExtMessages =
    ensureExtensionMessageNodesInFlow(withQueues as Parameters<typeof ensureExtensionMessageNodesInFlow>[0]) ??
    withQueues;
  const draft = repairFlowEdges(
    withExtMessages as Parameters<typeof repairFlowEdges>[0],
  );
  const validation = validatePublishedFlow(draft, ringGroups, {
    allowExtensionDialing: config.allowExtensionDialing,
  });
  if (!validation.ok) {
    throw new Error(validation.errors.join('; '));
  }
  for (const warning of validation.warnings) {
    console.warn(`[callFlow publish] ${warning}`);
  }
  await prisma.phoneAgencyConfig.update({
    where: { subCompanyId },
    data: { publishedFlow: draft as unknown as Prisma.InputJsonValue },
  });
  const bundle = await getPhoneSystemBundle(subCompanyId);
  if (!bundle) throw new Error('Failed to load bundle');
  return bundle;
}

/** Backfill reference defaults for agencies with empty configs. */
export async function backfillPhoneDefaults(): Promise<number> {
  const configs = await prisma.phoneAgencyConfig.findMany({
    select: { subCompanyId: true, defaultsSeededAt: true, draftFlow: true, publishedFlow: true, ringGroups: true },
  });
  let count = 0;
  for (const row of configs) {
    if (isEmptyPhoneBundle(row)) {
      const seeded = await seedReferenceDefaultsIfEmpty(row.subCompanyId, row);
      if (seeded) count += 1;
    }
  }
  return count;
}

export interface InboundCallDto {
  id: string;
  subCompanyId: string;
  subCompanyName: string;
  fromNumber: string;
  toNumber: string;
  menuKey: number | null;
  departmentLabel: string | null;
  ringGroupName: string | null;
  ringGroupId: string | null;
  voicemailBoxId: string | null;
  voicemailBoxName: string | null;
  answeredByUserId: string | null;
  answeredByName: string | null;
  participantNames: string[];
  outcome: string;
  startedAt: string;
  durationSec: number | null;
  ringDurationSec: number | null;
  hasRecording: boolean;
}

export interface ListInboundCallsParams {
  subCompanyIds: string[];
  userId?: string;
  ownerIds?: string[];
  outcome?: string;
  page: number;
  limit: number;
  from?: Date;
  to?: Date;
  inbox?: import('./inboundVoicemailAccess').InboundInbox;
  ringGroupId?: string;
  voicemailBoxId?: string;
  requestingUserId?: string;
  scopeLevel?: import('@prisma/client').DataScopeLevel;
  primarySubCompanyId?: string;
}

function userFilterForInbound(userIds: string[]) {
  return {
    OR: [
      { answeredByUserId: { in: userIds } },
      { participants: { some: { userId: { in: userIds } } } },
    ],
  };
}

export async function listInboundCalls(params: ListInboundCallsParams): Promise<{
  data: InboundCallDto[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const {
    subCompanyIds,
    userId,
    ownerIds,
    outcome,
    page,
    limit,
    from,
    to,
    inbox: inboxParam,
    ringGroupId,
    voicemailBoxId,
    requestingUserId,
    scopeLevel,
    primarySubCompanyId,
  } = params;

  if (subCompanyIds.length === 0) {
    return { data: [], pagination: { page, limit, total: 0, totalPages: 0 } };
  }

  const timestampFilter: Record<string, Date> = {};
  if (from && !isNaN(from.getTime())) timestampFilter.gte = from;
  if (to && !isNaN(to.getTime())) timestampFilter.lte = to;

  const userIds = userId ? [userId] : ownerIds?.length ? ownerIds : undefined;

  let inboxWhere: Prisma.InboundCallWhereInput = {};
  if (requestingUserId && scopeLevel) {
    const inbox: InboundInbox = inboxParam ?? resolveDefaultInbox(scopeLevel);
    const agencyId = primarySubCompanyId ?? subCompanyIds[0]!;
    const userGroups = await getUserRingGroups(agencyId, requestingUserId);
    inboxWhere = buildInboundInboxWhere({
      inbox,
      userId: requestingUserId,
      scopeLevel,
      ringGroupId,
      voicemailBoxId,
      userRingGroups: userGroups,
    });
  }

  const where: Prisma.InboundCallWhereInput = {
    subCompanyId: { in: subCompanyIds },
    ...(outcome ? { outcome: outcome as InboundCallOutcome } : {}),
    ...(Object.keys(timestampFilter).length ? { startedAt: timestampFilter } : {}),
    ...(userIds?.length && !inboxParam ? userFilterForInbound(userIds) : {}),
    ...(userIds?.length && inboxParam === 'answered'
      ? { answeredByUserId: { in: userIds } }
      : {}),
    ...inboxWhere,
  };

  const [rows, total] = await Promise.all([
    prisma.inboundCall.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        subCompany: { select: { name: true } },
        answeredBy: { select: { firstName: true, lastName: true } },
        participants: { select: { userName: true }, orderBy: { createdAt: 'asc' } },
      },
    }),
    prisma.inboundCall.count({ where }),
  ]);

  const data: InboundCallDto[] = rows.map((c) => ({
    id: c.id,
    subCompanyId: c.subCompanyId,
    subCompanyName: c.subCompany.name,
    fromNumber: c.fromNumber,
    toNumber: c.toNumber,
    menuKey: c.menuKey,
    departmentLabel: c.departmentLabel,
    ringGroupName: c.ringGroupName,
    ringGroupId: c.ringGroupId,
    voicemailBoxId: c.voicemailBoxId,
    voicemailBoxName: c.voicemailBoxName,
    answeredByUserId: c.answeredByUserId,
    answeredByName: c.answeredBy
      ? [c.answeredBy.firstName, c.answeredBy.lastName].filter(Boolean).join(' ') || null
      : null,
    participantNames: c.participants.map((p) => p.userName),
    outcome: c.outcome,
    startedAt: c.startedAt.toISOString(),
    durationSec: c.durationSec,
    ringDurationSec: c.ringDurationSec,
    hasRecording: Boolean(c.recordingUrl),
  }));

  return {
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
