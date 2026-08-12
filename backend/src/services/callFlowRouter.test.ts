import {
  edgeTarget,
  followEdge,
  gatherMenuDigits,
  isGatherMenuDigit,
  repairFlowEdges,
  validateCallFlowEdges,
  type CallFlowGraph,
} from './callFlowRouter';
import { ensureExtensionMessageNodesInFlow } from './phoneSystemFlowRepair';

function miniFlow(overrides?: Partial<CallFlowGraph>): CallFlowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'trigger', type: 'trigger_incoming', data: {} },
      { id: 'gather', type: 'gather_dtmf', data: {} },
      { id: 'ext-dial', type: 'connect_extension', data: { enabled: true } },
      { id: 'invalid-loop', type: 'invalid_message_loop', data: { loopTo: 'gather' } },
      { id: 'branch-1', type: 'connect_group', data: { ringGroupId: 'rg-1' } },
    ],
    edges: [
      { id: 'e-gather-1', source: 'gather', target: 'branch-1', label: '1' },
      { id: 'e-gather-ext', source: 'gather', target: 'ext-dial', label: 'ext' },
      { id: 'e-gather-timeout', source: 'gather', target: 'trigger', label: 'timeout' },
    ],
    ...overrides,
  };
}

describe('callFlowRouter', () => {
  it('followEdge tries labels in order then unlabeled edge', () => {
    const flow: CallFlowGraph = {
      version: 1,
      nodes: [{ id: 'a', type: 'gather_dtmf', data: {} }],
      edges: [
        { id: 'e1', source: 'a', target: 'b', label: 'invalid' },
        { id: 'e2', source: 'a', target: 'c' },
      ],
    };
    expect(followEdge(flow, 'a', ['9', 'invalid']).targetId).toBe('b');
    expect(followEdge(flow, 'a', []).targetId).toBe('c');
  });

  it('edgeTarget returns unlabeled edge when label omitted and only one unlabeled exists', () => {
    const flow: CallFlowGraph = {
      version: 1,
      nodes: [],
      edges: [
        { id: 'e1', source: 'x', target: 'y', label: '1' },
        { id: 'e2', source: 'x', target: 'z' },
      ],
    };
    expect(edgeTarget(flow, 'x')).toBe('z');
    expect(edgeTarget(flow, 'x', '1')).toBe('y');
  });

  it('gatherMenuDigits excludes ext and timeout labels', () => {
    const flow = miniFlow();
    const digits = gatherMenuDigits(flow, 'gather');
    expect(digits.has('1')).toBe(true);
    expect(digits.has('ext')).toBe(false);
    expect(digits.has('timeout')).toBe(false);
    expect(isGatherMenuDigit(flow, 'gather', '1')).toBe(true);
    expect(isGatherMenuDigit(flow, 'gather', '101')).toBe(false);
  });

  it('repairFlowEdges adds ext-dial exits and invalid-loop edge from loopTo', () => {
    const flow = miniFlow({ edges: miniFlow().edges.filter((e) => e.source !== 'ext-dial') });
    const repaired = repairFlowEdges(flow);
    expect(repaired.edges.some((e) => e.source === 'ext-dial' && e.label === 'not found')).toBe(true);
    expect(repaired.edges.some((e) => e.source === 'ext-dial' && e.label === 'no answer')).toBe(true);
    expect(repaired.edges.some((e) => e.source === 'invalid-loop' && e.target === 'gather')).toBe(
      true,
    );
    const invalidNode = repaired.nodes.find((n) => n.id === 'invalid-loop');
    expect(invalidNode?.data.loopTo).toBeUndefined();
  });

  it('ensureExtensionMessageNodesInFlow splices message nodes after repairFlowEdges', () => {
    const flow = miniFlow({ edges: miniFlow().edges.filter((e) => e.source !== 'ext-dial') });
    const repaired = ensureExtensionMessageNodesInFlow(repairFlowEdges(flow))!;
    expect(repaired.nodes.some((n) => n.id === 'ext-unavailable-msg')).toBe(true);
    expect(
      repaired.edges.some(
        (e) => e.source === 'ext-dial' && e.label === 'no answer' && e.target === 'ext-unavailable-msg',
      ),
    ).toBe(true);
  });

  it('validateCallFlowEdges requires gather and ext edge when extension dialing enabled', () => {
    const flow = miniFlow({
      edges: [{ id: 'e-gather-1', source: 'gather', target: 'branch-1', label: '1' }],
    });
    const result = validateCallFlowEdges(flow, { allowExtensionDialing: true });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('"ext"'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('not found'))).toBe(true);
  });

  it('validateCallFlowEdges warns when connect_group lacks no answer edge', () => {
    const flow = miniFlow();
    const result = validateCallFlowEdges(flow, { allowExtensionDialing: false });
    expect(result.warnings.some((w) => w.includes('no answer'))).toBe(true);
  });

  it('validateCallFlowEdges requires open and closed edges on business_hours nodes', () => {
    const flow = miniFlow({
      nodes: [...miniFlow().nodes, { id: 'bh', type: 'business_hours', data: {} }],
      edges: [
        ...miniFlow().edges,
        { id: 'e-bh-open', source: 'bh', target: 'welcome', label: 'open' },
      ],
    });
    const result = validateCallFlowEdges(flow, { allowExtensionDialing: false });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('"closed"'))).toBe(true);
    expect(result.errors.some((e) => e.includes('"open"'))).toBe(false);
  });

  it('validateCallFlowEdges warns when connect_queue lacks a timeout edge', () => {
    const flow = miniFlow({
      nodes: [...miniFlow().nodes, { id: 'queue-1', type: 'connect_queue', data: { ringGroupId: 'rg-1' } }],
      edges: [...miniFlow().edges, { id: 'e-1-busy', source: 'branch-1', target: 'queue-1', label: 'busy' }],
    });
    const result = validateCallFlowEdges(flow, { allowExtensionDialing: false });
    expect(result.warnings.some((w) => w.includes('connect_queue') && w.includes('timeout'))).toBe(true);
  });

  it('repairFlowEdges adds a timeout edge to a connect_queue node missing one', () => {
    const flow = miniFlow({
      nodes: [...miniFlow().nodes, { id: 'queue-1', type: 'connect_queue', data: {} }],
      edges: [...miniFlow().edges, { id: 'e-1-busy', source: 'branch-1', target: 'queue-1', label: 'busy' }],
    });
    const repaired = repairFlowEdges(flow);
    expect(
      repaired.edges.some((e) => e.source === 'queue-1' && e.label === 'timeout' && e.target === 'gather'),
    ).toBe(true);
  });

  it('validateCallFlowEdges accepts business_hours with both branches', () => {
    const flow = miniFlow({
      nodes: [...miniFlow().nodes, { id: 'bh', type: 'business_hours', data: {} }],
      edges: [
        ...miniFlow().edges,
        { id: 'e-bh-open', source: 'bh', target: 'welcome', label: 'open' },
        { id: 'e-bh-closed', source: 'bh', target: 'after-hours', label: 'closed' },
      ],
    });
    const result = validateCallFlowEdges(flow, { allowExtensionDialing: false });
    expect(result.errors.some((e) => e.includes('business_hours'))).toBe(false);
  });
});
