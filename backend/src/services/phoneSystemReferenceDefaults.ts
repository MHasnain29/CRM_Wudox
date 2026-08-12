/**
 * Reference phone system template — seeded for new agencies and restored on demand.
 */
import { randomUUID } from 'crypto';
import { SYSTEM_CLIP_NAMES } from './phoneSystemSystemClips';
import template from '../config/phoneSystemDefaultBundle.json';

const TPL_PREFIX = 'tpl-';

export interface ReferenceSeedBundle {
  flowTitle: string;
  config: {
    autoAttendantExtension: string;
    allowExtensionDialing: boolean;
    gatherTimeoutSec: number;
    greetingClipName: string;
    timeoutRouteLabel: string;
    invalidRouteLabel: string;
  };
  menuRoutes: unknown[];
  ringGroups: unknown[];
  staffExtensions: unknown[];
  voicemailBoxes: unknown[];
  audioClips: unknown[];
  businessHours: unknown[];
  readinessSteps: unknown[];
  draftFlow: unknown;
  publishedFlow: unknown;
}

interface DefaultTemplate {
  flowTitle: string;
  config: ReferenceSeedBundle['config'];
  ringGroups: Array<Record<string, unknown>>;
  menuRoutes: Array<Record<string, unknown>>;
  voicemailBoxes: Array<Record<string, unknown>>;
  audioClips: Array<Record<string, unknown> & { id: string }>;
  businessHours: unknown[];
  readinessSteps: unknown[];
}

function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
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

export interface MaterializeDefaultOptions {
  preserveRingGroupMembers?: Array<{ extension: string; members?: unknown[] }>;
  preserveStaffExtensions?: unknown[];
}

/** Build a fresh default bundle with new entity IDs (shared by seed + restore). */
export function materializeDefaultBundle(options: MaterializeDefaultOptions = {}): ReferenceSeedBundle {
  const tpl = template as DefaultTemplate;
  const idMap = new Map<string, string>();

  for (const tplId of collectTemplateIds(tpl)) {
    const prefix = tplId.slice(TPL_PREFIX.length).split('-')[0] ?? 'ent';
    idMap.set(tplId, newId(prefix));
  }

  const ringGroups = tpl.ringGroups.map((rg) => {
    const remapped = remapValue(rg, idMap) as Record<string, unknown>;
    const extension = String(rg.extension ?? '');
    const preserved = options.preserveRingGroupMembers?.find((g) => g.extension === extension);
    return {
      ...remapped,
      members: preserved?.members ?? [],
    };
  });

  const menuRoutes = tpl.menuRoutes.map((mr) => remapValue(mr, idMap));
  const voicemailBoxes = tpl.voicemailBoxes.map((vm) => remapValue(vm, idMap));
  const now = new Date().toISOString();
  const audioClips = tpl.audioClips.map((ac) => {
    const remapped = remapValue(ac, idMap) as Record<string, unknown>;
    return { ...remapped, uploadedAt: now };
  });

  const config = { ...tpl.config };
  const staffExtensions = options.preserveStaffExtensions ?? [];
  const draftFlow = buildPrimaryCallFlowGraph({
    config,
    ringGroups,
    menuRoutes: menuRoutes as Record<string, unknown>[],
    audioClips,
    staffExtensions,
  });

  return {
    flowTitle: tpl.flowTitle,
    config,
    menuRoutes,
    ringGroups,
    staffExtensions,
    voicemailBoxes,
    audioClips,
    businessHours: tpl.businessHours,
    readinessSteps: tpl.readinessSteps ?? [],
    draftFlow,
    publishedFlow: JSON.parse(JSON.stringify(draftFlow)),
  };
}

export function buildReferenceSeedBundle(): ReferenceSeedBundle {
  return materializeDefaultBundle();
}

interface CallFlowGraph {
  version: 1;
  nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string; label?: string }>;
}

/** Port of frontend buildPrimaryCallFlowGraph — keeps inbound TwiML aligned with canvas. */
export function buildPrimaryCallFlowGraph(bundle: {
  config: {
    autoAttendantExtension?: string;
    allowExtensionDialing?: boolean;
    gatherTimeoutSec?: number;
    greetingClipName?: string;
    timeoutRouteLabel?: string;
    invalidRouteLabel?: string;
  };
  ringGroups: Array<Record<string, unknown>>;
  menuRoutes: Array<Record<string, unknown>>;
  audioClips: unknown[];
  staffExtensions: unknown[];
}): CallFlowGraph {
  const greeting = bundle.config.greetingClipName ?? 'Greeting Options';
  const gatherSec = bundle.config.gatherTimeoutSec ?? 5;

  if (!bundle.menuRoutes.length && !bundle.ringGroups.length) {
    return { version: 1, nodes: [], edges: [] };
  }

  const nodes: CallFlowGraph['nodes'] = [
    { id: 'trigger', type: 'trigger_incoming', position: { x: 400, y: 0 }, data: { label: 'Incoming call' } },
    { id: 'business-hours', type: 'business_hours', position: { x: 700, y: 20 }, data: { label: 'Business hours', source: 'agency' } },
    {
      id: 'after-hours-message',
      type: 'play_message',
      position: { x: 760, y: 90 },
      data: { label: 'After-hours message', clipName: SYSTEM_CLIP_NAMES.afterHours },
    },
    {
      id: 'after-hours',
      type: 'connect_group',
      position: { x: 760, y: 220 },
      data: {
        label: 'After-hours forward',
        isFallback: true,
        dialTimeoutSec: 30,
        fallbackAction: 'forward',
        forwardToE164: '',
      },
    },
    {
      id: 'queue-after-hours',
      type: 'connect_queue',
      position: { x: 760, y: 340 },
      data: { label: 'Waiting queue', maxWaitSec: 120 },
    },
    { id: 'welcome', type: 'play_message', position: { x: 400, y: 90 }, data: { clipName: greeting, label: 'Welcome message' } },
    {
      id: 'gather',
      type: 'gather_dtmf',
      position: { x: 400, y: 180 },
      data: { timeoutSec: gatherSec, timeoutBehavior: 'loop', label: 'Main menu' },
    },
    { id: 'ext-dial', type: 'connect_extension', position: { x: 120, y: 280 }, data: { label: 'Extension dial', enabled: bundle.config.allowExtensionDialing !== false } },
    {
      id: 'queue-ext',
      type: 'connect_queue',
      position: { x: 120, y: 420 },
      data: { label: 'Waiting queue', maxWaitSec: 120 },
    },
    {
      id: 'fallback-timeout',
      type: 'play_message',
      position: { x: 400, y: 720 },
      data: {
        clipName: SYSTEM_CLIP_NAMES.menuTimeout,
        label: bundle.config.timeoutRouteLabel ?? 'Timeout',
      },
    },
    {
      id: 'invalid-loop',
      type: 'invalid_message_loop',
      position: { x: 680, y: 380 },
      data: {
        clipName: 'Invalid option',
        label: bundle.config.invalidRouteLabel ?? 'Invalid',
      },
    },
    {
      id: 'ext-not-found-msg',
      type: 'play_message',
      position: { x: 280, y: 340 },
      data: {
        clipName: SYSTEM_CLIP_NAMES.extensionNotFound,
        label: 'Extension not found',
      },
    },
    {
      id: 'ext-unavailable-msg',
      type: 'play_message',
      position: { x: 280, y: 440 },
      data: {
        clipName: SYSTEM_CLIP_NAMES.extensionNotAvailable,
        label: 'Extension not available',
      },
    },
    { id: 'vm-directory', type: 'voicemail_directory', position: { x: 680, y: 480 }, data: { label: 'Voicemail directory', clipName: SYSTEM_CLIP_NAMES.voicemailPrompt } },
  ];

  const edges: CallFlowGraph['edges'] = [
    { id: 'e-trigger-bh', source: 'trigger', target: 'business-hours' },
    { id: 'e-bh-open', source: 'business-hours', target: 'welcome', label: 'open' },
    { id: 'e-bh-closed', source: 'business-hours', target: 'after-hours-message', label: 'closed' },
    { id: 'e-ahmsg-forward', source: 'after-hours-message', target: 'after-hours' },
    { id: 'e-after-hours-busy', source: 'after-hours', target: 'queue-after-hours', label: 'busy' },
    { id: 'e-after-hours-queue-timeout', source: 'queue-after-hours', target: 'gather', label: 'timeout' },
    { id: 'e-welcome-gather', source: 'welcome', target: 'gather' },
    { id: 'e-gather-ext', source: 'gather', target: 'ext-dial', label: 'ext' },
    { id: 'e-gather-fallback', source: 'gather', target: 'fallback-timeout', label: 'timeout' },
    { id: 'e-timeout-gather', source: 'fallback-timeout', target: 'gather' },
    { id: 'e-ext-notfound', source: 'ext-dial', target: 'ext-not-found-msg', label: 'not found' },
    { id: 'e-ext-notfound-gather', source: 'ext-not-found-msg', target: 'gather' },
    { id: 'e-ext-noanswer', source: 'ext-dial', target: 'ext-unavailable-msg', label: 'no answer' },
    { id: 'e-ext-noanswer-gather', source: 'ext-unavailable-msg', target: 'gather' },
    { id: 'e-ext-busy', source: 'ext-dial', target: 'queue-ext', label: 'busy' },
    { id: 'e-ext-queue-timeout', source: 'queue-ext', target: 'gather', label: 'timeout' },
    { id: 'e-invalid-gather', source: 'invalid-loop', target: 'gather' },
    { id: 'e-vm-gather', source: 'vm-directory', target: 'gather' },
  ];

  const menuLabels = ['Recruitment', 'Sales', 'Accounts', 'Office hours'];
  const keys = bundle.menuRoutes.length
    ? bundle.menuRoutes.map((r) => r.key as number)
    : [1, 2, 3, 4];

  keys.forEach((key, i) => {
    const route = bundle.menuRoutes.find((r) => r.key === key);
    const group = route
      ? bundle.ringGroups.find((g) => g.id === route.ringGroupId)
      : bundle.ringGroups[i % Math.max(bundle.ringGroups.length, 1)];
    const branchId = `branch-${key}`;
    const isOfficeHours = key === 4;

    nodes.push({
      id: branchId,
      type: isOfficeHours ? 'play_office_hours' : 'connect_group',
      position: { x: 80 + i * 140, y: 380 },
      data: {
        menuKey: key,
        label: (menuLabels[i] ?? route?.callerIdLabel ?? `Key ${key}`) as string,
        ringGroupId: group?.id,
        ringGroupName: group?.name ?? route?.ringGroupName,
        ringGroupExtension: group?.extension ?? route?.ringGroupExtension,
        callerIdLabel: route?.callerIdLabel,
        ...(isOfficeHours ? { clipName: 'Locations' } : {}),
      },
    });

    if (!isOfficeHours && group) {
      const fbId = `fallback-${key}`;
      nodes.push({
        id: fbId,
        type: 'connect_group',
        position: { x: 80 + i * 140, y: 520 },
        data: {
          label: 'Fallback',
          isFallback: true,
          dialTimeoutSec: (route?.dialTimeoutSec ?? group.dialTimeoutSec) as number,
          fallbackAction: route?.fallbackAction ?? group.fallbackAction,
          voicemailBoxId: route?.voicemailBoxId ?? group.fallbackVoicemailBoxId,
          forwardToE164: route?.fallbackForwardE164 ?? group.fallbackForwardE164,
        },
      });
      const queueId = `queue-${key}`;
      nodes.push({
        id: queueId,
        type: 'connect_queue',
        position: { x: 80 + i * 140, y: 660 },
        data: {
          label: 'Waiting queue',
          ringGroupId: group?.id,
          ringGroupName: (group?.name ?? route?.ringGroupName) as string | undefined,
          maxWaitSec: 120,
        },
      });
      edges.push(
        { id: `e-gather-${key}`, source: 'gather', target: branchId, label: String(key) },
        { id: `e-${key}-fb`, source: branchId, target: fbId, label: 'no answer' },
        { id: `e-${key}-busy`, source: branchId, target: queueId, label: 'busy' },
        { id: `e-${key}-queue-timeout`, source: queueId, target: fbId, label: 'timeout' },
      );
    } else {
      edges.push({ id: `e-gather-${key}`, source: 'gather', target: branchId, label: String(key) });
    }
  });

  edges.push(
    { id: 'e-gather-invalid', source: 'gather', target: 'invalid-loop', label: '0' },
    { id: 'e-gather-star', source: 'gather', target: 'vm-directory', label: '*' },
  );

  return { version: 1, nodes, edges };
}
