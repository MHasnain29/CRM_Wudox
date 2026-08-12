import {
  ensureBusinessHoursInFlow,
  ensureExtensionDialInFlow,
  ensureExtensionMessageNodesInFlow,
  ensureQueueOnBusyInFlow,
} from './phoneSystemFlowRepair';
import { SYSTEM_CLIP_NAMES } from './phoneSystemSystemClips';
import type { CallFlowGraph } from './callFlowRouter';

function legacyFlowWithoutBusinessHours(): CallFlowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'trigger', type: 'trigger_incoming', position: { x: 400, y: 0 }, data: { label: 'Incoming call' } },
      { id: 'welcome', type: 'play_message', position: { x: 400, y: 90 }, data: { clipName: 'Greeting', label: 'Welcome' } },
      { id: 'gather', type: 'gather_dtmf', position: { x: 400, y: 180 }, data: { timeoutSec: 5, label: 'Main menu' } },
    ],
    edges: [
      { id: 'e-trigger-welcome', source: 'trigger', target: 'welcome' },
      { id: 'e-welcome-gather', source: 'welcome', target: 'gather' },
    ],
  };
}

describe('ensureBusinessHoursInFlow', () => {
  it('injects business_hours gate and rewires trigger when absent', () => {
    const flow = legacyFlowWithoutBusinessHours();
    const repaired = ensureBusinessHoursInFlow(flow);
    expect(repaired).not.toBeNull();

    const bh = repaired!.nodes.find((n) => n.type === 'business_hours');
    expect(bh).toBeDefined();

    const afterHours = repaired!.nodes.find(
      (n) => n.type === 'connect_group' && n.data.isFallback === true,
    );
    expect(afterHours).toBeDefined();
    expect(afterHours!.data.fallbackAction).toBe('forward');

    const triggerEdge = repaired!.edges.find((e) => e.source === 'trigger');
    expect(triggerEdge?.target).toBe(bh!.id);

    const openEdge = repaired!.edges.find((e) => e.source === bh!.id && e.label === 'open');
    expect(openEdge?.target).toBe('welcome');

    const message = repaired!.nodes.find(
      (n) => n.type === 'play_message' && n.data.label === 'After-hours message',
    );
    expect(message).toBeDefined();
    expect(message!.data.clipName).toBe('After hours');

    const closedEdge = repaired!.edges.find((e) => e.source === bh!.id && e.label === 'closed');
    expect(closedEdge?.target).toBe(message!.id);

    const forwardEdge = repaired!.edges.find((e) => e.source === message!.id);
    expect(forwardEdge?.target).toBe(afterHours!.id);
  });

  it('is idempotent when business_hours node already exists', () => {
    const flow = legacyFlowWithoutBusinessHours();
    const first = ensureBusinessHoursInFlow(flow)!;
    const second = ensureBusinessHoursInFlow(first)!;

    expect(second.nodes.filter((n) => n.type === 'business_hours')).toHaveLength(1);
    expect(second.nodes.length).toBe(first.nodes.length);
    expect(second.edges.length).toBe(first.edges.length);
  });

  it('splices after-hours message into a legacy gate that goes closed → forward directly', () => {
    const legacyGate: CallFlowGraph = {
      version: 1,
      nodes: [
        { id: 'trigger', type: 'trigger_incoming', position: { x: 400, y: 0 }, data: {} },
        { id: 'business-hours', type: 'business_hours', position: { x: 700, y: 20 }, data: {} },
        {
          id: 'after-hours',
          type: 'connect_group',
          position: { x: 760, y: 150 },
          data: { isFallback: true, fallbackAction: 'forward' },
        },
        { id: 'welcome', type: 'play_message', position: { x: 400, y: 90 }, data: {} },
      ],
      edges: [
        { id: 'e-trigger-bh', source: 'trigger', target: 'business-hours' },
        { id: 'e-bh-open', source: 'business-hours', target: 'welcome', label: 'open' },
        { id: 'e-bh-closed', source: 'business-hours', target: 'after-hours', label: 'closed' },
      ],
    };

    const repaired = ensureBusinessHoursInFlow(legacyGate)!;

    const message = repaired.nodes.find(
      (n) => n.type === 'play_message' && n.data.label === 'After-hours message',
    );
    expect(message).toBeDefined();
    expect(message!.data.clipName).toBe('After hours');

    const closedEdge = repaired.edges.find(
      (e) => e.source === 'business-hours' && e.label === 'closed',
    );
    expect(closedEdge?.target).toBe(message!.id);

    const forwardEdge = repaired.edges.find((e) => e.source === message!.id);
    expect(forwardEdge?.target).toBe('after-hours');

    // Idempotent second pass.
    const again = ensureBusinessHoursInFlow(repaired)!;
    expect(
      again.nodes.filter(
        (n) => n.type === 'play_message' && n.data.label === 'After-hours message',
      ),
    ).toHaveLength(1);
  });

  it('returns unchanged when trigger has multiple outgoing edges', () => {
    const flow: CallFlowGraph = {
      version: 1,
      nodes: [
        { id: 'trigger', type: 'trigger_incoming', data: {} },
        { id: 'a', type: 'play_message', data: {} },
        { id: 'b', type: 'play_message', data: {} },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'a' },
        { id: 'e2', source: 'trigger', target: 'b' },
      ],
    };
    const repaired = ensureBusinessHoursInFlow(flow);
    expect(repaired!.nodes.some((n) => n.type === 'business_hours')).toBe(false);
  });

  it('adds trigger edge when trigger has no outgoing edges but welcome exists', () => {
    const flow: CallFlowGraph = {
      version: 1,
      nodes: [
        { id: 'trigger', type: 'trigger_incoming', data: {} },
        { id: 'welcome', type: 'play_message', data: {} },
      ],
      edges: [],
    };
    const repaired = ensureBusinessHoursInFlow(flow)!;
    const bh = repaired.nodes.find((n) => n.type === 'business_hours');
    expect(repaired.edges.some((e) => e.source === 'trigger' && e.target === bh!.id)).toBe(true);
    expect(repaired.edges.some((e) => e.source === bh!.id && e.label === 'open' && e.target === 'welcome')).toBe(
      true,
    );
  });

  it('does not interfere with ensureExtensionDialInFlow when chained', () => {
    const flow = legacyFlowWithoutBusinessHours();
    const withExt = ensureExtensionDialInFlow(flow, true)!;
    const withBh = ensureBusinessHoursInFlow(withExt)!;

    expect(withBh.nodes.some((n) => n.type === 'connect_extension')).toBe(true);
    expect(withBh.edges.some((e) => e.label === 'ext')).toBe(true);
    expect(withBh.nodes.some((n) => n.type === 'business_hours')).toBe(true);
  });
});

describe('ensureQueueOnBusyInFlow', () => {
  it('adds queue-on-busy for extension dial and after-hours forward', () => {
    const flow: CallFlowGraph = {
      version: 1,
      nodes: [
        { id: 'gather', type: 'gather_dtmf', position: { x: 400, y: 180 }, data: {} },
        { id: 'ext-dial', type: 'connect_extension', position: { x: 120, y: 280 }, data: {} },
        {
          id: 'after-hours',
          type: 'connect_group',
          position: { x: 760, y: 220 },
          data: { label: 'After-hours forward', isFallback: true, fallbackAction: 'forward' },
        },
        {
          id: 'branch-1',
          type: 'connect_group',
          position: { x: 80, y: 380 },
          data: { ringGroupId: 'rg-1', ringGroupName: 'Sales' },
        },
        {
          id: 'fallback-1',
          type: 'connect_group',
          position: { x: 80, y: 520 },
          data: { label: 'Fallback', isFallback: true },
        },
      ],
      edges: [
        { id: 'e-1-fb', source: 'branch-1', target: 'fallback-1', label: 'no answer' },
      ],
    };

    const repaired = ensureQueueOnBusyInFlow(flow)!;

    expect(repaired.nodes.some((n) => n.id === 'queue-ext')).toBe(true);
    expect(repaired.nodes.some((n) => n.id === 'queue-after-hours')).toBe(true);
    expect(repaired.nodes.some((n) => n.id === 'queue-branch-1')).toBe(true);
    expect(repaired.nodes.filter((n) => n.type === 'connect_queue')).toHaveLength(3);
    expect(repaired.nodes.some((n) => n.id === 'queue-fallback-1')).toBe(false);

    expect(
      repaired.edges.some((e) => e.source === 'ext-dial' && e.label === 'busy' && e.target === 'queue-ext'),
    ).toBe(true);
    expect(
      repaired.edges.some(
        (e) => e.source === 'queue-ext' && e.label === 'timeout' && e.target === 'gather',
      ),
    ).toBe(true);
    expect(
      repaired.edges.some(
        (e) =>
          e.source === 'after-hours' && e.label === 'busy' && e.target === 'queue-after-hours',
      ),
    ).toBe(true);
    expect(
      repaired.edges.some(
        (e) => e.source === 'branch-1' && e.label === 'busy' && e.target === 'queue-branch-1',
      ),
    ).toBe(true);
    expect(
      repaired.edges.some(
        (e) =>
          e.source === 'queue-branch-1' && e.label === 'timeout' && e.target === 'fallback-1',
      ),
    ).toBe(true);
  });

  it('is idempotent when queues already exist', () => {
    const flow: CallFlowGraph = {
      version: 1,
      nodes: [
        { id: 'gather', type: 'gather_dtmf', data: {} },
        { id: 'ext-dial', type: 'connect_extension', data: {} },
        { id: 'queue-ext', type: 'connect_queue', data: { maxWaitSec: 120 } },
      ],
      edges: [
        { id: 'e-ext-busy', source: 'ext-dial', target: 'queue-ext', label: 'busy' },
        { id: 'e-ext-queue-timeout', source: 'queue-ext', target: 'gather', label: 'timeout' },
      ],
    };
    const first = ensureQueueOnBusyInFlow(flow)!;
    const second = ensureQueueOnBusyInFlow(first)!;
    expect(second.nodes.filter((n) => n.type === 'connect_queue')).toHaveLength(1);
    expect(second.edges.filter((e) => e.label === 'busy')).toHaveLength(1);
  });
});

describe('ensureExtensionMessageNodesInFlow', () => {
  it('splices play_message nodes when ext exits point directly at gather', () => {
    const flow = {
      version: 1,
      nodes: [
        { id: 'gather', type: 'gather_dtmf', data: {} },
        { id: 'ext-dial', type: 'connect_extension', data: { enabled: true }, position: { x: 120, y: 280 } },
      ],
      edges: [
        { id: 'e-ext-notfound', source: 'ext-dial', target: 'gather', label: 'not found' },
        { id: 'e-ext-noanswer', source: 'ext-dial', target: 'gather', label: 'no answer' },
      ],
    };
    const repaired = ensureExtensionMessageNodesInFlow(flow)!;
    expect(repaired.nodes.some((n) => n.id === 'ext-not-found-msg')).toBe(true);
    expect(repaired.nodes.some((n) => n.id === 'ext-unavailable-msg')).toBe(true);
    expect(
      repaired.edges.some(
        (e) => e.source === 'ext-dial' && e.label === 'not found' && e.target === 'ext-not-found-msg',
      ),
    ).toBe(true);
    expect(
      repaired.edges.some(
        (e) =>
          e.source === 'ext-dial' && e.label === 'no answer' && e.target === 'ext-unavailable-msg',
      ),
    ).toBe(true);
    const notFoundMsg = repaired.nodes.find((n) => n.id === 'ext-not-found-msg');
    expect(notFoundMsg?.data.clipName).toBe(SYSTEM_CLIP_NAMES.extensionNotFound);
    const unavailableMsg = repaired.nodes.find((n) => n.id === 'ext-unavailable-msg');
    expect(unavailableMsg?.data.clipName).toBe(SYSTEM_CLIP_NAMES.extensionNotAvailable);
  });
});
