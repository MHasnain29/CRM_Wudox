import type { AgencyPhoneBundle } from './phoneSystemAgencyBundle';
import { apiFetch } from './api';

/** Discard mistaken email addresses pasted into the Twilio region field. */
export function sanitizeTwilioRegion(region: string | null | undefined): string | null {
  if (!region?.trim()) return null;
  const trimmed = region.trim();
  if (trimmed.includes('@') || /\s/.test(trimmed)) return null;
  return trimmed;
}

export async function saveAgencyTwilioCredentials(
  subCompanyId: string,
  twilio: {
    accountSid?: string | null;
    apiKeySid?: string | null;
    twimlAppSid?: string | null;
    region?: string | null;
  },
  secrets?: { authToken?: string; apiKeySecret?: string },
): Promise<AgencyPhoneBundle> {
  const twilioPayload: Record<string, string | null | undefined> = {
    accountSid: twilio.accountSid,
    apiKeySid: twilio.apiKeySid,
    twimlAppSid: twilio.twimlAppSid,
    region: sanitizeTwilioRegion(twilio.region),
  };
  if (secrets?.authToken?.trim()) {
    twilioPayload.authToken = secrets.authToken.trim();
  }
  if (secrets?.apiKeySecret?.trim()) {
    twilioPayload.apiKeySecret = secrets.apiKeySecret.trim();
  }

  const res = await apiFetch<AgencyPhoneBundle>('/phone-system/bundle', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subCompanyId, twilio: twilioPayload }),
  });
  if (!res.ok || !res.data) {
    throw new Error(res.error ?? 'Failed to save Twilio credentials');
  }
  return res.data;
}

export async function fetchPhoneSystemBundle(
  subCompanyId: string,
): Promise<AgencyPhoneBundle | null> {
  const res = await apiFetch<AgencyPhoneBundle>(
    `/phone-system/bundle?subCompanyId=${encodeURIComponent(subCompanyId)}`,
  );
  if (!res.ok || !res.data) {
    console.warn(
      '[phoneSystem] bundle fetch failed',
      subCompanyId,
      res.ok === false ? res.status : 'no data',
    );
    return null;
  }
  return res.data;
}

export async function savePhoneSystemBundle(
  bundle: AgencyPhoneBundle,
  twilioSecrets?: { authToken?: string; apiKeySecret?: string },
): Promise<AgencyPhoneBundle> {
  const body: Record<string, unknown> = {
    subCompanyId: bundle.subCompanyId,
    flowTitle: bundle.flowTitle,
    config: bundle.config,
    phoneNumbers: bundle.phoneNumbers,
    menuRoutes: bundle.menuRoutes,
    ringGroups: bundle.ringGroups,
    staffExtensions: bundle.staffExtensions,
    voicemailBoxes: bundle.voicemailBoxes,
    audioClips: bundle.audioClips,
    businessHours: bundle.businessHours,
    readinessSteps: bundle.readinessSteps,
    draftFlow: bundle.draftFlow,
    publishedFlow: bundle.publishedFlow,
  };

  const twilioPayload: Record<string, string | null | undefined> = {
    accountSid: bundle.twilio.accountSid,
    apiKeySid: bundle.twilio.apiKeySid,
    twimlAppSid: bundle.twilio.twimlAppSid,
    region: sanitizeTwilioRegion(bundle.twilio.region),
  };
  if (twilioSecrets?.authToken?.trim()) {
    twilioPayload.authToken = twilioSecrets.authToken.trim();
  }
  if (twilioSecrets?.apiKeySecret?.trim()) {
    twilioPayload.apiKeySecret = twilioSecrets.apiKeySecret.trim();
  }
  body.twilio = twilioPayload;

  const res = await apiFetch<AgencyPhoneBundle>('/phone-system/bundle', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.data) {
    throw new Error(res.error ?? 'Failed to save phone system');
  }
  return res.data;
}

export async function publishPhoneCallFlow(subCompanyId?: string): Promise<AgencyPhoneBundle> {
  const res = await apiFetch<AgencyPhoneBundle>('/phone-system/call-flow/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subCompanyId ? { subCompanyId } : {}),
  });
  if (!res.ok || !res.data) {
    throw new Error('Failed to publish call flow');
  }
  return res.data;
}

export async function restorePhoneSystemDefaults(
  subCompanyId?: string,
): Promise<AgencyPhoneBundle> {
  const res = await apiFetch<AgencyPhoneBundle>('/phone-system/bundle/restore-defaults', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subCompanyId ? { subCompanyId } : {}),
  });
  if (!res.ok || !res.data) {
    throw new Error('Failed to restore phone system defaults');
  }
  return res.data;
}

export async function testAgencyTwilioConnection(subCompanyId: string): Promise<{
  ok: boolean;
  message: string;
  phoneNumberCount?: number;
}> {
  const res = await apiFetch<{ ok: boolean; message: string; phoneNumberCount?: number }>(
    '/phone-system/twilio/test-connection',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subCompanyId }),
    },
  );
  if (!res.ok || !res.data) {
    throw new Error('Failed to test Twilio connection');
  }
  return res.data;
}

export async function syncAgencyTwilioNumbers(subCompanyId: string): Promise<AgencyPhoneBundle> {
  const res = await apiFetch<{ bundle: AgencyPhoneBundle }>('/phone-system/twilio/sync-numbers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subCompanyId }),
  });
  if (!res.ok || !res.data?.bundle) {
    throw new Error('Failed to sync numbers from Twilio');
  }
  return res.data.bundle;
}

export interface VoiceConfigResponse {
  voiceEnabled: boolean;
  outboundEnabled: boolean;
  inboundEnabled: boolean;
  outboundCallerId: string | null;
  inboundDid: string | null;
}

export type InboundInbox = 'mine' | 'ring_group' | 'all' | 'answered';

export interface ApiUserRingGroup {
  id: string;
  name: string;
  voicemailBoxId: string | null;
  voicemailBoxName: string | null;
}

export interface ApiInboundCall {
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

export async function fetchMyRingGroups(subCompanyId: string): Promise<ApiUserRingGroup[]> {
  const res = await apiFetch<{ data: ApiUserRingGroup[] }>(
    `/phone-system/my-ring-groups?subCompanyId=${encodeURIComponent(subCompanyId)}`,
  );
  if (!res.ok || !res.data) return [];
  return res.data.data ?? [];
}

export async function fetchInboundCallStreamToken(
  inboundCallId: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const res = await apiFetch<{ streamUrl: string }>(
    `/phone-system/inbound-calls/${encodeURIComponent(inboundCallId)}/recording-token`,
    { signal },
  );
  if (!res.ok || !res.data?.streamUrl) return null;
  return res.data.streamUrl;
}

export async function fetchInboundCalls(params?: {
  page?: number;
  limit?: number;
  userId?: string;
  agencyIds?: string[];
  ownerIds?: string[];
  outcome?: string;
  from?: string;
  to?: string;
  inbox?: InboundInbox;
  ringGroupId?: string;
  voicemailBoxId?: string;
}): Promise<{
  data: ApiInboundCall[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const searchParams = new URLSearchParams();
  if (params?.page != null) searchParams.set('page', String(params.page));
  if (params?.limit != null) searchParams.set('limit', String(params.limit));
  if (params?.userId) searchParams.set('userId', params.userId);
  if (params?.agencyIds?.length) searchParams.set('agencyIds', params.agencyIds.join(','));
  if (params?.ownerIds?.length) searchParams.set('ownerIds', params.ownerIds.join(','));
  if (params?.outcome) searchParams.set('outcome', params.outcome);
  if (params?.from) searchParams.set('from', params.from);
  if (params?.to) searchParams.set('to', params.to);
  if (params?.inbox) searchParams.set('inbox', params.inbox);
  if (params?.ringGroupId) searchParams.set('ringGroupId', params.ringGroupId);
  if (params?.voicemailBoxId) searchParams.set('voicemailBoxId', params.voicemailBoxId);

  const res = await apiFetch<{
    data: ApiInboundCall[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>(`/phone-system/inbound-calls?${searchParams.toString()}`);

  if (!res.ok) {
    return { data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } };
  }
  return res.data ?? { data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Failed to read file'));
        return;
      }
      const base64 = result.includes(',') ? result.split(',')[1]! : result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export async function uploadPhoneAudioClip(
  subCompanyId: string,
  clipId: string,
  file: File,
): Promise<{ r2Key: string; fileName: string; mimeType: string }> {
  const fileBase64 = await fileToBase64(file);
  const res = await apiFetch<{ data: { r2Key: string; fileName: string; mimeType: string } }>(
    `/phone-system/audio-clips/${encodeURIComponent(clipId)}/upload`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subCompanyId,
        fileBase64,
        fileName: file.name,
        mimeType: file.type || undefined,
      }),
    },
  );
  if (!res.ok || !res.data?.data) {
    throw new Error(res.error ?? 'Failed to upload audio clip');
  }
  return res.data.data;
}

export async function fetchPhoneAudioClipStreamUrl(
  subCompanyId: string,
  clipId: string,
): Promise<string | null> {
  const res = await apiFetch<{ streamUrl: string }>(
    `/phone-system/audio-clips/${encodeURIComponent(clipId)}/stream-token?subCompanyId=${encodeURIComponent(subCompanyId)}`,
  );
  if (!res.ok || !res.data?.streamUrl) return null;
  return res.data.streamUrl;
}

/** Current user's own PBX extension (not the full staff list). */
export async function fetchMyCallExtension(): Promise<string | null> {
  const res = await apiFetch<{ extension: string | null }>('/phone-system/my-extension');
  if (!res.ok) return null;
  const extension = res.data?.extension?.trim();
  return extension || null;
}
