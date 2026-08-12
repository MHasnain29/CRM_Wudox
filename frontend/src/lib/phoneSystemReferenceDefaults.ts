/**
 * Reference IVR resources (ring groups, menu keys, VM, audio) — canonical default template.
 */
import template from './phoneSystemDefaultBundle.json';
import {
  defaultPhoneSystemConfig,
  newEntityId,
  type AudioClip,
  type MenuRoute,
  type RingGroup,
  type VoicemailBox,
  type BusinessHoursDay,
  type PhoneSystemConfig,
} from './phoneSystemTypes';

const TPL_PREFIX = 'tpl-';

export interface ReferenceResources {
  config: PhoneSystemConfig;
  ringGroups: RingGroup[];
  menuRoutes: MenuRoute[];
  voicemailBoxes: VoicemailBox[];
  audioClips: AudioClip[];
  businessHours: BusinessHoursDay[];
}

interface DefaultTemplate {
  flowTitle: string;
  config: {
    autoAttendantExtension: string;
    allowExtensionDialing: boolean;
    gatherTimeoutSec: number;
    greetingClipName: string;
    timeoutRouteLabel: string;
    invalidRouteLabel: string;
  };
  ringGroups: RingGroup[];
  menuRoutes: MenuRoute[];
  voicemailBoxes: VoicemailBox[];
  audioClips: Array<Omit<AudioClip, 'uploadedAt'> & { id: string }>;
  businessHours: BusinessHoursDay[];
  readinessSteps: unknown[];
}

function isTemplateId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(TPL_PREFIX);
}

function remapValue(value: unknown, idMap: Map<string, string>): unknown {
  if (isTemplateId(value)) {
    return idMap.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => remapValue(item, idMap));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = remapValue(val, idMap);
    }
    return out;
  }
  return value;
}

function collectTemplateIds(data: unknown, ids = new Set<string>()): Set<string> {
  if (isTemplateId(data)) {
    ids.add(data);
    return ids;
  }
  if (Array.isArray(data)) {
    data.forEach((item) => collectTemplateIds(item, ids));
    return ids;
  }
  if (data && typeof data === 'object') {
    Object.values(data as Record<string, unknown>).forEach((val) => collectTemplateIds(val, ids));
  }
  return ids;
}

export function materializeReferenceResources(webhookUrl = ''): ReferenceResources {
  const tpl = template as DefaultTemplate;
  const idMap = new Map<string, string>();

  for (const tplId of collectTemplateIds(tpl)) {
    const prefix = tplId.slice(TPL_PREFIX.length).split('-')[0] ?? 'ent';
    idMap.set(tplId, newEntityId(prefix));
  }

  const ringGroups = tpl.ringGroups.map((rg) => remapValue(rg, idMap) as RingGroup);
  const menuRoutes = tpl.menuRoutes.map((mr) => remapValue(mr, idMap) as MenuRoute);
  const voicemailBoxes = tpl.voicemailBoxes.map((vm) => remapValue(vm, idMap) as VoicemailBox);
  const now = new Date().toISOString();
  const audioClips = tpl.audioClips.map((ac) => {
    const remapped = remapValue(ac, idMap) as Omit<AudioClip, 'uploadedAt'>;
    return { ...remapped, uploadedAt: now };
  });

  const baseConfig = defaultPhoneSystemConfig(webhookUrl);
  const config: PhoneSystemConfig = {
    ...baseConfig,
    autoAttendantExtension: tpl.config.autoAttendantExtension,
    allowExtensionDialing: tpl.config.allowExtensionDialing,
    gatherTimeoutSec: tpl.config.gatherTimeoutSec,
    greetingClipName: tpl.config.greetingClipName,
    timeoutRouteLabel: tpl.config.timeoutRouteLabel,
    invalidRouteLabel: tpl.config.invalidRouteLabel,
  };

  return {
    config,
    ringGroups,
    menuRoutes,
    voicemailBoxes,
    audioClips,
    businessHours: tpl.businessHours,
  };
}

export function buildReferenceResources(webhookUrl = ''): ReferenceResources {
  return materializeReferenceResources(webhookUrl);
}
