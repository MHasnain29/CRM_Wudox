/**
 * Standard IVR clips — merged into agency audio library when missing (never overwrites user edits).
 */

export const SYSTEM_CLIP_NAMES = {
  extensionNotFound: 'Extension not found',
  extensionNotAvailable: 'Extension not available',
  noAgentsAvailable: 'No agents available',
  voicemailPrompt: 'Voicemail prompt',
  goodbye: 'Goodbye',
  afterHours: 'After hours',
  menuTimeout: 'Menu timeout',
} as const;

export interface SystemClipDef {
  name: string;
  scriptText: string;
  durationSec: number;
}

export const DEFAULT_SYSTEM_CLIPS: SystemClipDef[] = [
  {
    name: SYSTEM_CLIP_NAMES.extensionNotFound,
    scriptText: 'Extension not found. Please try again.',
    durationSec: 4,
  },
  {
    name: SYSTEM_CLIP_NAMES.extensionNotAvailable,
    scriptText: 'That extension is not available. Returning to the main menu.',
    durationSec: 5,
  },
  {
    name: SYSTEM_CLIP_NAMES.noAgentsAvailable,
    scriptText: 'No agents are available. Please try again later.',
    durationSec: 5,
  },
  {
    name: SYSTEM_CLIP_NAMES.voicemailPrompt,
    scriptText: 'Please leave a message after the tone.',
    durationSec: 4,
  },
  {
    name: SYSTEM_CLIP_NAMES.goodbye,
    scriptText: 'Thank you for calling. Goodbye.',
    durationSec: 3,
  },
  {
    name: SYSTEM_CLIP_NAMES.afterHours,
    scriptText: 'Thank you for calling. You have reached us outside our working hours. Please hold while we connect your call.',
    durationSec: 6,
  },
  {
    name: SYSTEM_CLIP_NAMES.menuTimeout,
    scriptText: 'You did not enter a selection. Please try again.',
    durationSec: 4,
  },
];

export function ensureSystemAudioClips<T extends { name: string; scriptText: string }>(
  clips: T[],
): T[] {
  const names = new Set(clips.map((c) => c.name));
  const additions = DEFAULT_SYSTEM_CLIPS.filter((def) => !names.has(def.name)).map(
    (def) =>
      ({
        name: def.name,
        sourceType: 'message' as const,
        scriptText: def.scriptText,
        durationSec: def.durationSec,
        id: `ac-sys-${def.name.replace(/\s+/g, '-').toLowerCase()}`,
        uploadedAt: new Date().toISOString(),
      }) as unknown as T,
  );
  return additions.length ? [...clips, ...additions] : clips;
}
