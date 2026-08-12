/**
 * Edge-driven routing for published call-flow graphs.
 * TwiML interpreter and publish validation share this module.
 */

export interface CallFlowGraph {
  version: number;
  nodes: Array<{
    id: string;
    type: string;
    data: Record<string, unknown>;
    position?: { x: number; y: number };
  }>;
  edges: Array<{ id: string; source: string; target: string; label?: string }>;
}

const RESERVED_GATHER_LABELS = new Set(['ext', 'timeout', 'invalid']);

export function edgeTarget(flow: CallFlowGraph, sourceId: string, label?: string): string | null {
  const edges = flow.edges.filter((e) => e.source === sourceId);
  if (label != null) {
    const match = edges.find((e) => e.label === label);
    return match ? match.target : null;
  }
  const unlabeled = edges.filter((e) => !e.label?.trim());
  if (unlabeled.length === 1) return unlabeled[0]!.target;
  if (edges.length === 1) return edges[0]!.target;
  return null;
}

export interface FollowEdgeResult {
  targetId: string | null;
  matchedLabel?: string;
}

/** Try labels in order, then a single unlabeled outgoing edge. */
export function followEdge(
  flow: CallFlowGraph,
  sourceId: string,
  labels: string[] = [],
): FollowEdgeResult {
  for (const label of labels) {
    const target = edgeTarget(flow, sourceId, label);
    if (target) return { targetId: target, matchedLabel: label };
  }
  const unlabeled = flow.edges.filter((e) => e.source === sourceId && !e.label?.trim());
  if (unlabeled.length === 1) return { targetId: unlabeled[0]!.target };
  return { targetId: null };
}

/** Menu digits derived from gather outgoing edge labels (excludes ext / timeout / invalid). */
export function gatherMenuDigits(flow: CallFlowGraph, gatherId: string): Set<string> {
  const digits = new Set<string>();
  for (const edge of flow.edges.filter((e) => e.source === gatherId)) {
    const label = edge.label?.trim();
    if (!label || RESERVED_GATHER_LABELS.has(label)) continue;
    digits.add(label);
  }
  return digits;
}

export function isGatherMenuDigit(flow: CallFlowGraph, gatherId: string, digit: string): boolean {
  return gatherMenuDigits(flow, gatherId).has(digit);
}

export function findGatherNode(flow: CallFlowGraph) {
  return flow.nodes.find((n) => n.type === 'gather_dtmf');
}

/** Last-resort fallback when expected edges are missing (legacy graphs). */
export function mainMenuResumeNodeId(flow: CallFlowGraph): string {
  const gatherNode = findGatherNode(flow);
  if (gatherNode) return gatherNode.id;
  const welcomeNode = flow.nodes.find((n) => n.type === 'play_message');
  if (welcomeNode) return welcomeNode.id;
  return flow.nodes.find((n) => n.type === 'trigger_incoming')?.id ?? flow.nodes[0]?.id ?? 'trigger';
}

function findLoopTarget(flow: CallFlowGraph, loopTo: string | undefined): string | null {
  if (loopTo) {
    const byId = flow.nodes.find((n) => n.id === loopTo);
    if (byId) return byId.id;
  }
  return findGatherNode(flow)?.id ?? null;
}

function hasOutgoingEdge(flow: CallFlowGraph, sourceId: string, label?: string): boolean {
  const edges = flow.edges.filter((e) => e.source === sourceId);
  if (label != null) return edges.some((e) => e.label === label);
  return edges.some((e) => !e.label?.trim());
}

function nextRepairEdgeId(flow: CallFlowGraph, base: string): string {
  if (!flow.edges.some((e) => e.id === base)) return base;
  return `${base}-${Date.now()}`;
}

/**
 * Adds missing edges from legacy node data (loopTo, ext-dial exits) so runtime can follow edges only.
 */
export function repairFlowEdges(flow: CallFlowGraph): CallFlowGraph {
  const nodes = flow.nodes.map((n) => ({ ...n, data: { ...n.data } }));
  const edges = [...flow.edges];
  const gatherId = findGatherNode({ ...flow, nodes, edges })?.id;

  for (const node of nodes) {
    if (node.type === 'invalid_message_loop' || node.type === 'voicemail_directory') {
      const hasUnlabeled = hasOutgoingEdge({ ...flow, nodes, edges }, node.id);
      if (!hasUnlabeled) {
        const loopTo = typeof node.data.loopTo === 'string' ? node.data.loopTo : undefined;
        const target = findLoopTarget({ ...flow, nodes, edges }, loopTo ?? gatherId ?? 'gather');
        if (target) {
          edges.push({
            id: nextRepairEdgeId({ ...flow, nodes, edges }, `e-repair-${node.id}-loop`),
            source: node.id,
            target,
          });
        }
      }
      if ('loopTo' in node.data) {
        const { loopTo: _removed, ...rest } = node.data;
        void _removed;
        node.data = rest;
      }
    }

    if (node.type === 'connect_queue' && gatherId) {
      if (!hasOutgoingEdge({ ...flow, nodes, edges }, node.id, 'timeout')) {
        edges.push({
          id: nextRepairEdgeId({ ...flow, nodes, edges }, `e-repair-${node.id}-queue-timeout`),
          source: node.id,
          target: gatherId,
          label: 'timeout',
        });
      }
    }

    if (node.type === 'connect_extension' && gatherId) {
      if (!hasOutgoingEdge({ ...flow, nodes, edges }, node.id, 'not found')) {
        edges.push({
          id: nextRepairEdgeId({ ...flow, nodes, edges }, `e-repair-${node.id}-not-found`),
          source: node.id,
          target: gatherId,
          label: 'not found',
        });
      }
      if (!hasOutgoingEdge({ ...flow, nodes, edges }, node.id, 'no answer')) {
        edges.push({
          id: nextRepairEdgeId({ ...flow, nodes, edges }, `e-repair-${node.id}-no-answer`),
          source: node.id,
          target: gatherId,
          label: 'no answer',
        });
      }
    }
  }

  return { ...flow, nodes, edges };
}

export interface FlowValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateCallFlowEdges(
  flow: CallFlowGraph,
  options?: { allowExtensionDialing?: boolean },
): FlowValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodes = flow.nodes ?? [];
  const allowExtensionDialing = options?.allowExtensionDialing !== false;

  const gatherNodes = nodes.filter((n) => n.type === 'gather_dtmf');
  if (gatherNodes.length !== 1) {
    errors.push('Published flow must have exactly one main menu (gather) node');
  }
  const gather = gatherNodes[0];

  const extNode = nodes.find((n) => n.type === 'connect_extension');
  if (allowExtensionDialing && extNode && gather) {
    const hasExtEdge = flow.edges.some(
      (e) => e.source === gather.id && e.label === 'ext' && e.target === extNode.id,
    );
    if (!hasExtEdge) {
      errors.push('Extension dialing is enabled but gather has no "ext" edge to connect_extension');
    }
    if (!hasOutgoingEdge(flow, extNode.id, 'not found')) {
      warnings.push(`connect_extension node "${extNode.id}" is missing a "not found" edge`);
    }
    if (!hasOutgoingEdge(flow, extNode.id, 'no answer')) {
      warnings.push(`connect_extension node "${extNode.id}" is missing a "no answer" edge`);
    }
  }

  for (const node of nodes) {
    if (node.type === 'invalid_message_loop') {
      const out = flow.edges.filter((e) => e.source === node.id);
      if (out.length === 0) {
        errors.push(`invalid_message_loop node "${node.id}" must have an outgoing edge back to the menu`);
      }
    }
    if (node.type === 'connect_group' && !node.data.isFallback) {
      if (!hasOutgoingEdge(flow, node.id, 'no answer')) {
        warnings.push(`connect_group node "${node.id}" is missing a "no answer" edge`);
      }
    }
    if (node.type === 'connect_queue') {
      if (!hasOutgoingEdge(flow, node.id, 'timeout')) {
        warnings.push(`connect_queue node "${node.id}" is missing a "timeout" edge`);
      }
    }
    if (node.type === 'business_hours') {
      if (!hasOutgoingEdge(flow, node.id, 'open')) {
        errors.push(`business_hours node "${node.id}" must have an "open" edge`);
      }
      if (!hasOutgoingEdge(flow, node.id, 'closed')) {
        errors.push(`business_hours node "${node.id}" must have a "closed" edge`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
