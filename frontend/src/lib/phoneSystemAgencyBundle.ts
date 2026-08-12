/**
 * Per-agency phone system bundle — persisted via GET/PUT /api/v1/phone-system/bundle.
 */

import type { CallFlowGraph } from './callFlowTypes';
import {
  syncExtDialNodesInFlow,
  extDialNodeData,
  buildStaffExtensionsFromLegacy,
  alignStaffAndRingGroups,
  ensureExtensionDialInFlow,
  ensureGreetingClipExtensionHint,
  parseRingGroupMenuKey,
  sortRingGroupsByExtension,
} from './phoneSystemExtensions';
import { ensureSystemAudioClips, SYSTEM_CLIP_NAMES } from './phoneSystemSystemClips';
import {
  defaultPhoneSystemConfig,
  defaultBusinessHours,
  type PhoneNumberRecord,
  type MenuRoute,
  type RingGroup,
  type StaffExtension,
  type DirectDialExtension,
  type VoicemailBox,
  type AudioClip,
  type BusinessHoursDay,
  type ReadinessStep,
  type PhoneSystemConfig,
  type DemoPhoneNumber,
  type DemoMenuRoute,
  type DemoRingGroup,
  type DemoStaffExtension,
  type DemoDirectDialExtension,
  type DemoVoicemailBox,
  type DemoAudioClip,
  type DemoBusinessHoursDay,
  type DemoReadinessStep,
  type DemoPhoneSystemState,
  defaultAgencyTwilioConfig,
  type AgencyTwilioConfig,
} from './phoneSystemTypes';
import { buildReferenceResources } from './phoneSystemReferenceDefaults';

export interface AgencyPhoneBundle {
  subCompanyId: string;
  agencyName: string;
  flowTitle: string;
  config: PhoneSystemConfig;
  twilio: AgencyTwilioConfig;
  phoneNumbers: PhoneNumberRecord[];
  menuRoutes: MenuRoute[];
  ringGroups: RingGroup[];
  staffExtensions: StaffExtension[];
  /** @deprecated migrated to staffExtensions */
  directDialExtensions?: DirectDialExtension[];
  voicemailBoxes: VoicemailBox[];
  audioClips: AudioClip[];
  businessHours: BusinessHoursDay[];
  readinessSteps: ReadinessStep[];
  draftFlow: CallFlowGraph;
  publishedFlow: CallFlowGraph | null;
  updatedAt: string;
}

function emptyFlow(): CallFlowGraph {
  return { version: 1, nodes: [], edges: [] };
}

function uniqueFlowNodeId(flow: CallFlowGraph, base: string): string {
  if (!flow.nodes.some((n) => n.id === base)) return base;
  return `${base}-${Date.now()}`;
}

function uniqueFlowEdgeId(flow: CallFlowGraph, base: string): string {
  if (!flow.edges.some((e) => e.id === base)) return base;
  return `${base}-${Date.now()}`;
}

/**
 * Splices an after-hours message before the closed branch target when a gate
 * already exists but was created before the message node (legacy gates).
 */
function ensureAfterHoursMessageInFlow(flow: CallFlowGraph): CallFlowGraph {
  const bh = flow.nodes.find((n) => n.type === 'business_hours');
  if (!bh) return flow;

  const closedEdge = flow.edges.find((e) => e.source === bh.id && e.label === 'closed');
  if (!closedEdge) return flow;

  const target = flow.nodes.find((n) => n.id === closedEdge.target);
  if (!target) return flow;

  if (target.type === 'play_message') return flow;

  const nodes = [...flow.nodes];
  const edges = [...flow.edges];

  const ahMsgId = uniqueFlowNodeId(flow, 'after-hours-message');
  const bhY = bh.position?.y ?? 0;
  const targetX = target.position?.x ?? 760;

  nodes.push({
    id: ahMsgId,
    type: 'play_message',
    position: { x: targetX, y: bhY + 90 },
    data: { label: 'After-hours message', clipName: SYSTEM_CLIP_NAMES.afterHours },
  });

  const idx = edges.findIndex((e) => e.id === closedEdge.id);
  if (idx >= 0) {
    edges[idx] = { ...edges[idx]!, target: ahMsgId };
  }
  edges.push({
    id: uniqueFlowEdgeId({ ...flow, nodes, edges }, 'e-ahmsg-forward'),
    source: ahMsgId,
    target: closedEdge.target,
  });

  return { ...flow, nodes, edges };
}

/**
 * Inserts a business_hours gate after trigger_incoming when missing (legacy flows).
 * open → former trigger target; closed → after-hours message → forward fallback node.
 */
export function ensureBusinessHoursInFlow(flow: CallFlowGraph): CallFlowGraph {
  if (!flow.nodes.length) return flow;

  const trigger = flow.nodes.find((n) => n.type === 'trigger_incoming');
  if (!trigger) return flow;

  if (flow.nodes.some((n) => n.type === 'business_hours')) {
    return ensureAfterHoursMessageInFlow(flow);
  }

  const triggerOut = flow.edges.filter((e) => e.source === trigger.id);
  if (triggerOut.length > 1) return flow;

  let entryTargetId: string | null = null;
  if (triggerOut.length === 1) {
    entryTargetId = triggerOut[0]!.target;
  } else {
    const welcome = flow.nodes.find((n) => n.type === 'play_message');
    entryTargetId =
      welcome?.id ?? flow.nodes.find((n) => n.type === 'gather_dtmf')?.id ?? null;
  }
  if (!entryTargetId) return flow;

  const nodes = [...flow.nodes];
  const edges = [...flow.edges];

  const bhId = uniqueFlowNodeId(flow, 'business-hours');
  const ahMsgId = uniqueFlowNodeId(flow, 'after-hours-message');
  const ahId = uniqueFlowNodeId(flow, 'after-hours');
  const triggerY = trigger.position?.y ?? 0;

  nodes.push({
    id: bhId,
    type: 'business_hours',
    position: { x: 700, y: triggerY + 20 },
    data: { label: 'Business hours', source: 'agency' },
  });
  nodes.push({
    id: ahMsgId,
    type: 'play_message',
    position: { x: 760, y: triggerY + 90 },
    data: { label: 'After-hours message', clipName: SYSTEM_CLIP_NAMES.afterHours },
  });
  nodes.push({
    id: ahId,
    type: 'connect_group',
    position: { x: 760, y: triggerY + 220 },
    data: {
      label: 'After-hours forward',
      isFallback: true,
      dialTimeoutSec: 30,
      fallbackAction: 'forward',
      forwardToE164: '',
    },
  });

  if (triggerOut.length === 1) {
    const idx = edges.findIndex((e) => e.source === trigger.id);
    if (idx >= 0) {
      edges[idx] = { ...edges[idx]!, target: bhId };
    }
  } else {
    edges.push({
      id: uniqueFlowEdgeId({ ...flow, nodes, edges }, 'e-trigger-bh'),
      source: trigger.id,
      target: bhId,
    });
  }

  const graphSoFar = { ...flow, nodes, edges };
  edges.push(
    {
      id: uniqueFlowEdgeId(graphSoFar, 'e-bh-open'),
      source: bhId,
      target: entryTargetId,
      label: 'open',
    },
    {
      id: uniqueFlowEdgeId(graphSoFar, 'e-bh-closed'),
      source: bhId,
      target: ahMsgId,
      label: 'closed',
    },
    {
      id: uniqueFlowEdgeId(graphSoFar, 'e-ahmsg-forward'),
      source: ahMsgId,
      target: ahId,
    },
  );

  return { ...flow, nodes, edges };
}

function isAfterHoursForwardNode(node: CallFlowGraph['nodes'][number]): boolean {
  return (
    node.type === 'connect_group' &&
    node.data.isFallback === true &&
    (node.id === 'after-hours' || node.data.label === 'After-hours forward')
  );
}

function dialNodeNeedsQueueOnBusy(node: CallFlowGraph['nodes'][number]): boolean {
  if (node.type === 'connect_extension') return true;
  if (node.type !== 'connect_group') return false;
  if (isAfterHoursForwardNode(node)) return true;
  return node.data.isFallback !== true;
}

function queueIdForDialNode(node: CallFlowGraph['nodes'][number]): string {
  if (node.id === 'ext-dial') return 'queue-ext';
  if (node.id === 'after-hours') return 'queue-after-hours';
  return `queue-${node.id}`;
}

function queueTimeoutTarget(
  flow: CallFlowGraph,
  dialNode: CallFlowGraph['nodes'][number],
  gatherId: string,
): string {
  if (dialNode.type === 'connect_extension' || isAfterHoursForwardNode(dialNode)) {
    return gatherId;
  }
  const noAnswer = flow.edges.find((e) => e.source === dialNode.id && e.label === 'no answer');
  return noAnswer?.target ?? gatherId;
}

/** Ensures every dial-capable node has a dedicated waiting queue on its busy edge. */
export function ensureQueueOnBusyInFlow(flow: CallFlowGraph): CallFlowGraph {
  if (!flow.nodes.length) return flow;

  const gatherId = flow.nodes.find((n) => n.type === 'gather_dtmf')?.id ?? 'gather';
  const nodes = [...flow.nodes];
  let edges = [...flow.edges];

  for (const dialNode of flow.nodes.filter(dialNodeNeedsQueueOnBusy)) {
    const graph = { ...flow, nodes, edges };
    const existingBusy = edges.find((e) => e.source === dialNode.id && e.label === 'busy');
    if (existingBusy) {
      const queueNode = nodes.find((n) => n.id === existingBusy.target);
      if (queueNode?.type === 'connect_queue') {
        const hasTimeout = edges.some((e) => e.source === queueNode.id && e.label === 'timeout');
        if (!hasTimeout) {
          edges.push({
            id: uniqueFlowEdgeId(graph, `e-${queueNode.id}-queue-timeout`),
            source: queueNode.id,
            target: queueTimeoutTarget({ ...flow, nodes, edges }, dialNode, gatherId),
            label: 'timeout',
          });
        }
      }
      continue;
    }

    const baseQueueId = queueIdForDialNode(dialNode);
    const queueId = uniqueFlowNodeId(graph, baseQueueId);
    const pos = dialNode.position ?? { x: 0, y: 0 };
    const queueData: Record<string, unknown> = { label: 'Waiting queue', maxWaitSec: 120 };
    if (dialNode.type === 'connect_group' && typeof dialNode.data.ringGroupId === 'string') {
      queueData.ringGroupId = dialNode.data.ringGroupId;
      if (dialNode.data.ringGroupName) queueData.ringGroupName = dialNode.data.ringGroupName;
    }

    nodes.push({
      id: queueId,
      type: 'connect_queue',
      position: { x: pos.x, y: pos.y + 140 },
      data: queueData,
    });

    const graphWithQueue = { ...flow, nodes, edges };
    edges = [
      ...edges,
      {
        id: uniqueFlowEdgeId(graphWithQueue, `e-${dialNode.id}-busy`),
        source: dialNode.id,
        target: queueId,
        label: 'busy',
      },
      {
        id: uniqueFlowEdgeId({ ...graphWithQueue, edges: [...edges] }, `e-${queueId}-queue-timeout`),
        source: queueId,
        target: queueTimeoutTarget({ ...flow, nodes, edges }, dialNode, gatherId),
        label: 'timeout',
      },
    ];
  }

  return { ...flow, nodes, edges };
}

/** Seed graph from bundle resources (menu routes + ring groups). */
export function buildPrimaryCallFlowGraph(
  bundle: Pick<
    AgencyPhoneBundle,
    'config' | 'ringGroups' | 'menuRoutes' | 'audioClips' | 'staffExtensions'
  >,
): CallFlowGraph {
  const aaExt = bundle.config.autoAttendantExtension;
  const greeting = bundle.config.greetingClipName;
  const gatherSec = bundle.config.gatherTimeoutSec;

  if (!bundle.menuRoutes.length && !bundle.ringGroups.length) {
    return emptyFlow();
  }

  const nodes: CallFlowGraph['nodes'] = [
    {
      id: 'trigger',
      type: 'trigger_incoming',
      position: { x: 400, y: 0 },
      data: { label: 'Incoming call', agencyNumbers: bundle.config },
    },
    {
      id: 'business-hours',
      type: 'business_hours',
      position: { x: 700, y: 20 },
      data: { label: 'Business hours', source: 'agency' },
    },
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
    {
      id: 'welcome',
      type: 'play_message',
      position: { x: 400, y: 90 },
      data: { clipName: greeting, label: 'Welcome message' },
    },
    {
      id: 'gather',
      type: 'gather_dtmf',
      position: { x: 400, y: 180 },
      data: { timeoutSec: gatherSec, timeoutBehavior: 'loop', label: 'Main menu (0–9, *)' },
    },
    {
      id: 'ext-dial',
      type: 'connect_extension',
      position: { x: 120, y: 280 },
      data: extDialNodeData(
        bundle.staffExtensions ?? [],
        bundle.ringGroups,
        bundle.config.allowExtensionDialing,
      ),
    },
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
        label: bundle.config.timeoutRouteLabel,
      },
    },
    {
      id: 'invalid-loop',
      type: 'invalid_message_loop',
      position: { x: 680, y: 380 },
      data: {
        clipName: 'Invalid option',
        label: bundle.config.invalidRouteLabel,
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
    {
      id: 'vm-directory',
      type: 'voicemail_directory',
      position: { x: 680, y: 480 },
      data: {
        label: 'Voicemail directory (*)',
        clipName: SYSTEM_CLIP_NAMES.voicemailPrompt,
      },
    },
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

  const menuLabels = ['Recruitment', 'Sales', 'Accounts', 'Office hours', 'Operator'];
  const sortedGroups = sortRingGroupsByExtension(bundle.ringGroups ?? []);
  const dialableGroups = sortedGroups.filter((g) => parseRingGroupMenuKey(g.extension) != null);
  const usedMenuKeys = new Set(dialableGroups.map((g) => parseRingGroupMenuKey(g.extension)!));

  dialableGroups.forEach((group, i) => {
    const key = parseRingGroupMenuKey(group.extension)!;
    const route = bundle.menuRoutes.find((r) => r.ringGroupId === group.id);
    const branchId = `branch-${group.id}`;
    const edgeLabel = group.extension.trim();

    nodes.push({
      id: branchId,
      type: 'connect_group',
      position: { x: 80 + i * 140, y: 380 },
      data: {
        menuKey: key,
        label: route?.callerIdLabel ?? group.name,
        ringGroupId: group.id,
        ringGroupName: group.name,
        ringGroupExtension: group.extension,
        callerIdLabel: route?.callerIdLabel ?? group.name,
      },
    });

    const fbId = `fallback-${group.id}`;
    nodes.push({
      id: fbId,
      type: 'connect_group',
      position: { x: 80 + i * 140, y: 520 },
      data: {
        label: 'Fallback',
        isFallback: true,
        dialTimeoutSec: route?.dialTimeoutSec ?? group.dialTimeoutSec,
        fallbackAction: route?.fallbackAction ?? group.fallbackAction,
        voicemailBoxId: route?.voicemailBoxId ?? group.fallbackVoicemailBoxId,
        forwardToE164: route?.fallbackForwardE164 ?? group.fallbackForwardE164,
      },
    });
    const queueId = `queue-${group.id}`;
    nodes.push({
      id: queueId,
      type: 'connect_queue',
      position: { x: 80 + i * 140, y: 660 },
      data: {
        label: 'Waiting queue',
        ringGroupId: group.id,
        ringGroupName: group.name,
        maxWaitSec: 120,
      },
    });
    edges.push(
      { id: `e-gather-${group.id}`, source: 'gather', target: branchId, label: edgeLabel },
      { id: `e-${group.id}-fb`, source: branchId, target: fbId, label: 'no answer' },
      { id: `e-${group.id}-busy`, source: branchId, target: queueId, label: 'busy' },
      { id: `e-${group.id}-queue-timeout`, source: queueId, target: fbId, label: 'timeout' },
    );
  });

  const officeRoute = bundle.menuRoutes.find(
    (r) =>
      r.key === 4 &&
      (r.callerIdLabel?.toLowerCase().includes('office') || r.ringGroupName === ''),
  );
  if (officeRoute && !usedMenuKeys.has(4)) {
    const branchId = 'branch-office-hours';
    nodes.push({
      id: branchId,
      type: 'play_office_hours',
      position: { x: 80 + dialableGroups.length * 140, y: 380 },
      data: {
        menuKey: 4,
        label: officeRoute.callerIdLabel ?? 'Office hours',
        clipName: 'Locations',
      },
    });
    edges.push({ id: 'e-gather-4', source: 'gather', target: branchId, label: '4' });
  } else if (bundle.menuRoutes.length === 0 && !usedMenuKeys.has(4)) {
    const branchId = 'branch-office-hours';
    nodes.push({
      id: branchId,
      type: 'play_office_hours',
      position: { x: 80 + dialableGroups.length * 140, y: 380 },
      data: {
        menuKey: 4,
        label: menuLabels[3] ?? 'Office hours',
        clipName: 'Locations',
      },
    });
    edges.push({ id: 'e-gather-4', source: 'gather', target: branchId, label: '4' });
  }

  const legacyRoutes = bundle.menuRoutes.filter(
    (r) =>
      !dialableGroups.some((g) => g.id === r.ringGroupId) &&
      r.key !== 4 &&
      !usedMenuKeys.has(r.key),
  );
  legacyRoutes.forEach((route, i) => {
    const group = bundle.ringGroups.find((g) => g.id === route.ringGroupId);
    if (!group) return;
    const branchId = `branch-route-${route.id}`;
    nodes.push({
      id: branchId,
      type: 'connect_group',
      position: { x: 80 + (dialableGroups.length + i) * 140, y: 380 },
      data: {
        menuKey: route.key,
        label: route.callerIdLabel ?? group.name,
        ringGroupId: group.id,
        ringGroupName: group.name,
        ringGroupExtension: group.extension,
        callerIdLabel: route.callerIdLabel,
      },
    });
    const fbId = `fallback-route-${route.id}`;
    nodes.push({
      id: fbId,
      type: 'connect_group',
      position: { x: 80 + (dialableGroups.length + i) * 140, y: 520 },
      data: {
        label: 'Fallback',
        isFallback: true,
        dialTimeoutSec: route.dialTimeoutSec ?? group.dialTimeoutSec,
        fallbackAction: route.fallbackAction ?? group.fallbackAction,
        voicemailBoxId: route.voicemailBoxId ?? group.fallbackVoicemailBoxId,
        forwardToE164: route.fallbackForwardE164 ?? group.fallbackForwardE164,
      },
    });
    const queueId = `queue-route-${route.id}`;
    nodes.push({
      id: queueId,
      type: 'connect_queue',
      position: { x: 80 + (dialableGroups.length + i) * 140, y: 660 },
      data: {
        label: 'Waiting queue',
        ringGroupId: group.id,
        ringGroupName: group.name,
        maxWaitSec: 120,
      },
    });
    edges.push(
      { id: `e-gather-route-${route.id}`, source: 'gather', target: branchId, label: String(route.key) },
      { id: `e-route-${route.id}-fb`, source: branchId, target: fbId, label: 'no answer' },
      { id: `e-route-${route.id}-busy`, source: branchId, target: queueId, label: 'busy' },
      { id: `e-route-${route.id}-queue-timeout`, source: queueId, target: fbId, label: 'timeout' },
    );
  });

  edges.push(
    { id: 'e-gather-invalid', source: 'gather', target: 'invalid-loop', label: '0' },
    { id: 'e-gather-star', source: 'gather', target: 'vm-directory', label: '*' },
  );

  return { version: 1, nodes, edges };
}

export function createDefaultAgencyBundle(
  subCompanyId: string,
  agencyName: string,
  _seedIndex = 0,
): AgencyPhoneBundle {
  const ref = buildReferenceResources();
  const draftFlow = buildPrimaryCallFlowGraph({
    config: ref.config,
    ringGroups: ref.ringGroups,
    menuRoutes: ref.menuRoutes,
    audioClips: ref.audioClips,
    staffExtensions: [],
  });
  const publishedFlow = JSON.parse(JSON.stringify(draftFlow)) as CallFlowGraph;

  return {
    subCompanyId,
    agencyName,
    flowTitle: `Incoming Call Flow · Ext ${ref.config.autoAttendantExtension}`,
    config: ref.config,
    twilio: defaultAgencyTwilioConfig(),
    phoneNumbers: [],
    menuRoutes: ref.menuRoutes,
    ringGroups: ref.ringGroups,
    staffExtensions: [],
    voicemailBoxes: ref.voicemailBoxes,
    audioClips: ref.audioClips,
    businessHours: ref.businessHours,
    readinessSteps: [],
    draftFlow,
    publishedFlow,
    updatedAt: new Date().toISOString(),
  };
}

/** Backfill fields for older saves. */
function normalizeFlowGraph(flow: unknown): import('./callFlowTypes').CallFlowGraph | null {
  if (!flow || typeof flow !== 'object') return null;
  const g = flow as { version?: number; nodes?: unknown; edges?: unknown };
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) return null;
  return g as import('./callFlowTypes').CallFlowGraph;
}

function normalizeAudioClip(clip: AudioClip): AudioClip {
  const sourceType = clip.sourceType ?? (clip.r2Key ? 'upload' : 'message');
  return { ...clip, sourceType };
}

function normalizeAudioClips(clips: AudioClip[]): AudioClip[] {
  return clips.map(normalizeAudioClip);
}

export function migrateBundle(bundle: AgencyPhoneBundle): AgencyPhoneBundle {
  const migratedRingGroups = (bundle.ringGroups ?? []).map((g) => ({
    ...g,
    fallbackAction: g.fallbackAction ?? 'voicemail',
    fallbackVoicemailBoxId: g.fallbackVoicemailBoxId ?? bundle.voicemailBoxes?.[0]?.id ?? '',
    fallbackForwardE164: g.fallbackForwardE164 ?? '',
    members: (g.members ?? []).map((m) => ({
      id: m.id,
      userId: m.userId,
      userName: m.userName,
      extension: m.extension,
    })),
  }));

  const staffExtensions =
    bundle.staffExtensions?.length
      ? bundle.staffExtensions
      : buildStaffExtensionsFromLegacy(migratedRingGroups, bundle.directDialExtensions ?? []);

  const { staffExtensions: alignedStaff, ringGroups: alignedRingGroups } =
    alignStaffAndRingGroups(staffExtensions, migratedRingGroups);

  const allowExtensionDialing = bundle.config?.allowExtensionDialing !== false;

  const baseDraft =
    normalizeFlowGraph(bundle.draftFlow) ??
    buildPrimaryCallFlowGraph({
      ...bundle,
      staffExtensions: alignedStaff,
      ringGroups: alignedRingGroups,
    });

  const draftWithExt = ensureExtensionDialInFlow(
    baseDraft,
    alignedStaff,
    alignedRingGroups,
    allowExtensionDialing,
  );
  const draftFlow = ensureQueueOnBusyInFlow(ensureBusinessHoursInFlow(draftWithExt));

  const publishedRaw = normalizeFlowGraph(bundle.publishedFlow);
  const publishedFlow = publishedRaw
    ? ensureQueueOnBusyInFlow(
        ensureBusinessHoursInFlow(
          ensureExtensionDialInFlow(
            publishedRaw,
            alignedStaff,
            alignedRingGroups,
            allowExtensionDialing,
          ),
        ),
      )
    : bundle.publishedFlow;

  const audioClips = ensureSystemAudioClips(
    normalizeAudioClips(ensureGreetingClipExtensionHint(bundle.audioClips ?? [])),
  );

  return {
    ...bundle,
    twilio: bundle.twilio ?? defaultAgencyTwilioConfig(),
    config: {
      ...defaultPhoneSystemConfig(bundle.config?.webhookUrl ?? ''),
      ...bundle.config,
      timezone: bundle.config?.timezone ?? 'America/Toronto',
    },
    audioClips,
    phoneNumbers: (bundle.phoneNumbers ?? []).map((n) => ({
      id: n.id,
      e164: n.e164,
      label: n.label,
      isActive: n.isActive,
    })),
    menuRoutes: (bundle.menuRoutes ?? []).map((r) => ({
      ...r,
      fallbackAction: r.fallbackAction ?? 'voicemail',
      fallbackForwardE164: r.fallbackForwardE164 ?? '',
    })),
    ringGroups: alignedRingGroups,
    staffExtensions: alignedStaff,
    draftFlow,
    publishedFlow,
    flowTitle:
      bundle.flowTitle ??
      `Incoming Call Flow · Ext ${bundle.config?.autoAttendantExtension ?? '—'}`,
  };
}

// Re-export legacy type aliases for gradual migration
export type {
  DemoPhoneNumber,
  DemoMenuRoute,
  DemoRingGroup,
  DemoStaffExtension,
  DemoDirectDialExtension,
  DemoVoicemailBox,
  DemoAudioClip,
  DemoBusinessHoursDay,
  DemoReadinessStep,
  DemoPhoneSystemState,
};
