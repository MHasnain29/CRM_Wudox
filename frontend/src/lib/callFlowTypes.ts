/**
 * Call flow graph types — Phase 1d demo; persisted per agency in AgencyPhoneBundle.
 */

export type CallFlowNodeType =
  | 'trigger_incoming'
  | 'play_message'
  | 'gather_dtmf'
  | 'connect_extension'
  | 'connect_group'
  | 'connect_queue'
  | 'business_hours'
  | 'play_office_hours'
  | 'voicemail_directory'
  | 'invalid_message_loop';

export type FallbackAction = 'voicemail' | 'forward';

export interface GroupFallbackConfig {
  dialTimeoutSec: number;
  action: FallbackAction;
  voicemailBoxId?: string;
  forwardToE164?: string;
}

/**
 * Config for a `connect_queue` node — a call-center waiting queue. Callers that
 * reach this node (typically via a `busy` edge from a ring group) are parked with
 * hold music and connected to the next available agent.
 */
export interface CallQueueNodeConfig {
  /** Ring group whose members service this queue. */
  ringGroupId?: string;
  ringGroupName?: string;
  /** Max seconds a caller waits before the `timeout` edge is followed. */
  maxWaitSec: number;
  /** Optional hold-music URL; falls back to a default when unset. */
  holdMusicUrl?: string;
}

/**
 * Config for a `business_hours` node. Hours themselves come from the agency
 * Business hours settings (`bundle.businessHours`); this node only decides which
 * branch to follow ("open" vs "closed"), evaluated at call time against server
 * local time.
 */
export interface BusinessHoursNodeConfig {
  /** Reserved for a future per-node override; currently always the agency settings. */
  source: 'agency';
}

export interface CallFlowNode {
  id: string;
  type: CallFlowNodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface CallFlowEdge {
  id: string;
  source: string;
  target: string;
  /** Outgoing route label — see EDGE_LABELS below. */
  label?: string;
}

/**
 * Standard edge labels interpreted by inbound TwiML (backend callFlowRouter).
 *
 * | Source node           | Label              | When followed                          |
 * |-----------------------|--------------------|----------------------------------------|
 * | gather_dtmf           | 1–9, 0, *          | Menu digit pressed                     |
 * | gather_dtmf           | ext                | Multi-digit extension + #              |
 * | gather_dtmf           | timeout            | No input before timeout (when timeoutBehavior=loop) |
 * | gather_dtmf           | invalid            | Unknown digit (optional catch-all)     |
 *
 * gather_dtmf node `data.timeoutBehavior`: `'loop'` (default) follows the timeout edge
 * and returns to the menu; `'end'` plays goodbye and hangs up.
 * | business_hours        | open               | Currently within business hours        |
 * | business_hours        | closed             | Currently outside business hours       |
 * | connect_group         | no answer          | Dial completed, not answered           |
 * | connect_group         | busy               | All agents busy → route to queue       |
 * | connect_extension     | not found          | Extension unknown                      |
 * | connect_extension     | no answer          | Known extension, dial failed           |
 * | connect_extension     | busy               | Dialed leg returned busy (optional)    |
 * | connect_queue         | timeout            | Max wait exceeded → fallback           |
 * | connect_queue         | answered           | Caller connected to an agent           |
 * | invalid_message_loop  | _(unlabeled)_      | After invalid clip plays               |
 * | play_message, play_office_hours | _(unlabeled)_ | After clip plays              |
 * | voicemail_directory   | _(unlabeled)_      | After recording ends (if wired)        |
 */
export const CALL_FLOW_EDGE_LABELS = {
  gatherMenu: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*'] as const,
  gatherExt: 'ext',
  gatherTimeout: 'timeout',
  gatherInvalid: 'invalid',
  businessHoursOpen: 'open',
  businessHoursClosed: 'closed',
  groupNoAnswer: 'no answer',
  groupBusy: 'busy',
  extNotFound: 'not found',
  extNoAnswer: 'no answer',
  extBusy: 'busy',
  queueTimeout: 'timeout',
  queueAnswered: 'answered',
} as const;

export interface CallFlowGraph {
  version: 1;
  nodes: CallFlowNode[];
  edges: CallFlowEdge[];
}

export const EMPTY_CALL_FLOW: CallFlowGraph = { version: 1, nodes: [], edges: [] };
