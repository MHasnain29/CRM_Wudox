/**
 * Audio clip metadata helpers — normalization, validation, and Twilio playback URLs.
 */
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export type AudioClipSourceType = 'message' | 'upload';

export interface AudioClipRecord {
  id?: string;
  name: string;
  sourceType?: AudioClipSourceType;
  scriptText: string;
  r2Key?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  durationSec?: number;
  uploadedAt?: string;
}

const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
]);

export function resolveAudioClipSourceType(clip: AudioClipRecord): AudioClipSourceType {
  if (clip.sourceType === 'upload') return 'upload';
  if (clip.sourceType === 'message') return 'message';
  if (clip.r2Key) return 'upload';
  return 'message';
}

export function normalizeAudioClip<T extends AudioClipRecord>(clip: T): T & { sourceType: AudioClipSourceType } {
  return {
    ...clip,
    sourceType: resolveAudioClipSourceType(clip),
  };
}

export function normalizeAudioClips<T extends AudioClipRecord>(clips: T[]): Array<T & { sourceType: AudioClipSourceType }> {
  return clips.map((clip) => normalizeAudioClip(clip));
}

export function findAudioClipByName(
  clips: AudioClipRecord[],
  clipName: string | undefined,
): (AudioClipRecord & { sourceType: AudioClipSourceType }) | undefined {
  if (!clipName?.trim()) return undefined;
  const clip = clips.find((c) => c.name === clipName);
  return clip ? normalizeAudioClip(clip) : undefined;
}

export function clipScriptText(
  clips: AudioClipRecord[],
  clipName: string | undefined,
  fallback = 'Please hold.',
): string {
  const clip = findAudioClipByName(clips, clipName);
  if (!clip) return fallback;
  if (resolveAudioClipSourceType(clip) === 'upload') return fallback;
  return clip.scriptText?.trim() || fallback;
}

export function publicApiBaseUrl(): string {
  return (env.PUBLIC_API_URL || env.APP_URL).replace(/\/$/, '');
}

export function signAudioClipStreamToken(subCompanyId: string, clipId: string): string {
  return jwt.sign({ clipId, subCompanyId }, env.JWT_SECRET, { expiresIn: '15m' });
}

export function verifyAudioClipStreamToken(
  token: string,
): { clipId: string; subCompanyId: string } | null {
  try {
    return jwt.verify(token, env.JWT_SECRET) as { clipId: string; subCompanyId: string };
  } catch {
    return null;
  }
}

export function audioClipStreamUrl(subCompanyId: string, clipId: string): string {
  const token = signAudioClipStreamToken(subCompanyId, clipId);
  const base = publicApiBaseUrl();
  return `${base}${env.API_PREFIX}/${env.API_VERSION}/phone-system/audio-clips/${encodeURIComponent(clipId)}/stream?t=${token}`;
}

export function isAllowedAudioMimeType(mimeType: string | undefined, fileName: string): boolean {
  const normalized = mimeType?.toLowerCase().trim();
  if (normalized && ALLOWED_AUDIO_MIME_TYPES.has(normalized)) return true;
  const ext = fileName.split('.').pop()?.toLowerCase();
  return ext === 'mp3' || ext === 'wav';
}

export function audioClipR2Key(subCompanyId: string, clipId: string, fileName: string): string {
  const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : 'mp3';
  const safeExt = ext === 'wav' || ext === 'mp3' ? ext : 'mp3';
  return `agencies/${subCompanyId}/clips/${clipId}.${safeExt}`;
}

export function inferAudioContentType(fileName: string, mimeType?: string): string {
  const normalized = mimeType?.toLowerCase().trim();
  if (normalized && ALLOWED_AUDIO_MIME_TYPES.has(normalized)) {
    if (normalized === 'audio/mp3') return 'audio/mpeg';
    if (normalized === 'audio/wave') return 'audio/wav';
    return normalized;
  }
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'wav') return 'audio/wav';
  return 'audio/mpeg';
}

type TwimlPlaybackTarget = {
  say: (text: string) => unknown;
  play: (url: string) => unknown;
};

export function renderAudioClipPlayback(
  target: TwimlPlaybackTarget,
  clips: AudioClipRecord[],
  clipName: string | undefined,
  subCompanyId: string,
  fallback = 'Please hold.',
): void {
  const clip = findAudioClipByName(clips, clipName);
  if (!clip) {
    target.say(fallback);
    return;
  }
  if (resolveAudioClipSourceType(clip) === 'upload' && clip.r2Key && clip.id) {
    target.play(audioClipStreamUrl(subCompanyId, clip.id));
    return;
  }
  target.say(clip.scriptText?.trim() || fallback);
}
