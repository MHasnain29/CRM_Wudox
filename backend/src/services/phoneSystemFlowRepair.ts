/**
 * Repairs call-flow graphs so extension dialing (gather → ext edge → connect_extension) is present.
 * Older saves may be missing the node or the labeled edge TwiML expects.
 */

import type { CallFlowGraph } from './callFlowRouter';
import { SYSTEM_CLIP_NAMES } from './phoneSystemSystemClips';

export const GREETING_EXTENSION_HINT =
  "For reception press 1 then pound. To dial an extension starting with 1, press 1, then the rest of the extension, then pound.";

export function ensureGreetingClipExtensionHint(
  audioClips: Array<{ name: string; scriptText: string; [key: string]: unknown }>,
): Array<{ name: string; scriptText: string; [key: string]: unknown }> {
  return audioClips.map((clip) => {
    if (clip.name !== 'Greeting Options') return clip;
    const text = clip.scriptText?.trim() ?? '';
    if (!text) return clip;
    const lower = text.toLowerCase();
    if (lower.includes('extension') && (lower.includes('pound') || lower.includes('#'))) {
      return clip;
    }
    return { ...clip, scriptText: `${text} ${GREETING_EXTENSION_HINT}` };
  });
}

export function ensureExtensionDialInFlow(
  flow: CallFlowGraph | null | undefined,
  allowExtensionDialing = true,
): CallFlowGraph | null {
  if (!flow?.nodes?.length) return flow ?? null;

  const gather = flow.nodes.find((n) => n.type === 'gather_dtmf');
  if (!gather) return flow;

  let extNode = flow.nodes.find((n) => n.type === 'connect_extension');
  const nodes = [...flow.nodes];
  const edges = [...flow.edges];

  if (!extNode) {
    extNode = {
      id: 'ext-dial',
      type: 'connect_extension',
      position: { x: 120, y: 280 },
      data: {
        label: 'Extension dial',
        enabled: allowExtensionDialing,
      },
    };
    nodes.push(extNode);
  } else {
    const idx = nodes.findIndex((n) => n.id === extNode!.id);
    if (idx >= 0) {
      nodes[idx] = {
        ...nodes[idx]!,
        data: {
          ...nodes[idx]!.data,
          label: (nodes[idx]!.data.label as string) ?? 'Extension dial',
          enabled: allowExtensionDialing
            ? nodes[idx]!.data.enabled !== false
            : false,
        },
      };
    }
  }

  const hasExtEdge = edges.some(
    (e) => e.source === gather.id && e.label === 'ext' && e.target === extNode!.id,
  );
  if (!hasExtEdge) {
    const edgeId = edges.some((e) => e.id === 'e-gather-ext') ? `e-gather-ext-${Date.now()}` : 'e-gather-ext';
    edges.push({
      id: edgeId,
      source: gather.id,
      target: extNode.id,
      label: 'ext',
    });
  }

  return { ...flow, nodes, edges };
}

function uniqueNodeId(flow: CallFlowGraph, base: string): string {
  if (!flow.nodes.some((n) => n.id === base)) return base;
  return `${base}-${Date.now()}`;
}

function uniqueEdgeId(flow: CallFlowGraph, base: string): string {
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

  // Already plays a message on the closed branch — nothing to do.
  if (target.type === 'play_message') return flow;

  const nodes = [...flow.nodes];
  const edges = [...flow.edges];

  const ahMsgId = uniqueNodeId(flow, 'after-hours-message');
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
    id: uniqueEdgeId({ ...flow, nodes, edges }, 'e-ahmsg-forward'),
    source: ahMsgId,
    target: closedEdge.target,
  });

  return { ...flow, nodes, edges };
}

/**
 * Inserts a business_hours gate after trigger_incoming when missing (legacy flows).
 * open → former trigger target; closed → after-hours message → forward fallback node.
 */
export function ensureBusinessHoursInFlow(
  flow: CallFlowGraph | null | undefined,
): CallFlowGraph | null {
  if (!flow?.nodes?.length) return flow ?? null;

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

  const bhId = uniqueNodeId(flow, 'business-hours');
  const ahMsgId = uniqueNodeId(flow, 'after-hours-message');
  const ahId = uniqueNodeId(flow, 'after-hours');
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
      id: uniqueEdgeId({ ...flow, nodes, edges }, 'e-trigger-bh'),
      source: trigger.id,
      target: bhId,
    });
  }

  const graphSoFar = { ...flow, nodes, edges };
  edges.push(
    {
      id: uniqueEdgeId(graphSoFar, 'e-bh-open'),
      source: bhId,
      target: entryTargetId,
      label: 'open',
    },
    {
      id: uniqueEdgeId(graphSoFar, 'e-bh-closed'),
      source: bhId,
      target: ahMsgId,
      label: 'closed',
    },
    {
      id: uniqueEdgeId(graphSoFar, 'e-ahmsg-forward'),
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

function spliceExtensionExitMessage(
  flow: CallFlowGraph,
  nodes: CallFlowGraph['nodes'],
  edges: CallFlowGraph['edges'],
  extNode: CallFlowGraph['nodes'][number],
  edgeLabel: 'not found' | 'no answer',
  msgNodeId: string,
  clipName: string,
  msgLabel: string,
  gatherId: string,
): void {
  const exitEdge = edges.find((e) => e.source === extNode.id && e.label === edgeLabel);
  if (!exitEdge) return;

  const target = nodes.find((n) => n.id === exitEdge.target);
  if (!target) return;

  if (target.type === 'play_message' && target.data.clipName === clipName) return;

  if (target.id !== gatherId && target.type !== 'gather_dtmf') return;

  if (!nodes.some((n) => n.id === msgNodeId)) {
    const pos = extNode.position ?? { x: 120, y: 280 };
    nodes.push({
      id: msgNodeId,
      type: 'play_message',
      position: {
        x: pos.x + 80,
        y: pos.y + (edgeLabel === 'not found' ? 60 : 100),
      },
      data: { label: msgLabel, clipName },
    });
  }

  const edgeIdx = edges.findIndex((e) => e.id === exitEdge.id);
  if (edgeIdx >= 0) {
    edges[edgeIdx] = { ...exitEdge, target: msgNodeId };
  }

  if (!edges.some((e) => e.source === msgNodeId && e.target === gatherId)) {
    edges.push({
      id: uniqueEdgeId({ ...flow, nodes, edges }, `e-${msgNodeId}-gather`),
      source: msgNodeId,
      target: gatherId,
    });
  }
}

/**
 * Splices play_message nodes on connect_extension not-found / no-answer exits when they
 * point directly at the main menu (legacy flows and freshly repaired edges).
 */
export function ensureExtensionMessageNodesInFlow(
  flow: CallFlowGraph | null | undefined,
): CallFlowGraph | null {
  if (!flow?.nodes?.length) return flow ?? null;

  const gatherId = flow.nodes.find((n) => n.type === 'gather_dtmf')?.id;
  if (!gatherId) return flow;

  const nodes = [...flow.nodes];
  const edges = [...flow.edges];

  for (const extNode of nodes.filter((n) => n.type === 'connect_extension')) {
    const graph = { ...flow, nodes, edges };
    spliceExtensionExitMessage(
      graph,
      nodes,
      edges,
      extNode,
      'not found',
      'ext-not-found-msg',
      SYSTEM_CLIP_NAMES.extensionNotFound,
      'Extension not found',
      gatherId,
    );
    spliceExtensionExitMessage(
      graph,
      nodes,
      edges,
      extNode,
      'no answer',
      'ext-unavailable-msg',
      SYSTEM_CLIP_NAMES.extensionNotAvailable,
      'Extension not available',
      gatherId,
    );
  }

  return { ...flow, nodes, edges };
}

/**
 * Ensures every dial-capable node has a dedicated waiting queue on its busy edge.
 * Repairs legacy flows that predate queue-on-busy wiring.
 */
export function ensureQueueOnBusyInFlow(
  flow: CallFlowGraph | null | undefined,
): CallFlowGraph | null {
  if (!flow?.nodes?.length) return flow ?? null;

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
            id: uniqueEdgeId(graph, `e-${queueNode.id}-queue-timeout`),
            source: queueNode.id,
            target: queueTimeoutTarget({ ...flow, nodes, edges }, dialNode, gatherId),
            label: 'timeout',
          });
        }
      }
      continue;
    }

    const baseQueueId = queueIdForDialNode(dialNode);
    const queueId = uniqueNodeId(graph, baseQueueId);
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
        id: uniqueEdgeId(graphWithQueue, `e-${dialNode.id}-busy`),
        source: dialNode.id,
        target: queueId,
        label: 'busy',
      },
      {
        id: uniqueEdgeId({ ...graphWithQueue, edges: [...edges] }, `e-${queueId}-queue-timeout`),
        source: queueId,
        target: queueTimeoutTarget({ ...flow, nodes, edges }, dialNode, gatherId),
        label: 'timeout',
      },
    ];
  }

  return { ...flow, nodes, edges };
}

export function resolveExtensionDialNodeId(
  flow: CallFlowGraph,
  gatherNodeId: string,
): string | null {
  const fromEdge = flow.edges.find(
    (e) => e.source === gatherNodeId && e.label === 'ext',
  );
  if (fromEdge) return fromEdge.target;
  return null;
}
