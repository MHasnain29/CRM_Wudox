import type { Node } from '@xyflow/react';
import type { CallFlowNodeType } from '@/lib/callFlowTypes';
import type {
  DemoRingGroup,
  DemoVoicemailBox,
  DemoAudioClip,
  DemoStaffExtension,
} from '@/lib/phoneSystemTypes';
import { SYSTEM_CLIP_NAMES } from '@/lib/phoneSystemSystemClips';
import { extDialNodeData } from '@/lib/phoneSystemExtensions';
import { nodeTypeLabel } from './callFlowNodeStyles';

export const ADDABLE_NODE_TYPES: CallFlowNodeType[] = [
  'play_message',
  'gather_dtmf',
  'connect_extension',
  'connect_group',
  'connect_queue',
  'business_hours',
  'play_office_hours',
  'voicemail_directory',
  'invalid_message_loop',
];

export function flowNodeId(prefix = 'node') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function defaultPosition(
  nodes: { position: { x: number; y: number } }[],
  anchor?: { position: { x: number; y: number } },
): { x: number; y: number } {
  if (anchor) {
    return { x: anchor.position.x, y: anchor.position.y + 120 };
  }
  const maxY = nodes.reduce((m, n) => Math.max(m, n.position.y), 0);
  return { x: 400, y: maxY + 120 };
}

interface CreateNodeContext {
  ringGroups: DemoRingGroup[];
  staffExtensions?: DemoStaffExtension[];
  voicemailBoxes: DemoVoicemailBox[];
  audioClips: DemoAudioClip[];
  gatherTimeoutSec?: number;
}

export function createFlowNode(
  type: CallFlowNodeType,
  position: { x: number; y: number },
  ctx: CreateNodeContext,
  options?: { isFallback?: boolean; menuKey?: number },
) {
  const id = flowNodeId(type.replace(/_/g, '-'));
  const firstGroup = ctx.ringGroups[0];
  const firstVm = ctx.voicemailBoxes[0];
  const firstClip = ctx.audioClips[0];

  const base = {
    id,
    type: 'callFlow' as const,
    position,
    data: {
      flowNodeType: type,
      label: nodeTypeLabel(type),
    },
  };

  switch (type) {
    case 'trigger_incoming':
      return {
        ...base,
        data: { ...base.data, label: 'Incoming call' },
      };
    case 'play_message':
      return {
        ...base,
        data: {
          ...base.data,
          label: 'Play message',
          clipName: firstClip?.name ?? '',
        },
      };
    case 'gather_dtmf':
      return {
        ...base,
        data: {
          ...base.data,
          label: 'Main menu',
          timeoutSec: ctx.gatherTimeoutSec ?? 5,
          timeoutBehavior: 'loop',
        },
      };
    case 'connect_extension':
      return {
        ...base,
        data: extDialNodeData(ctx.staffExtensions ?? [], ctx.ringGroups, true),
      };
    case 'connect_group':
      if (options?.isFallback) {
        return {
          ...base,
          data: {
            ...base.data,
            flowNodeType: type,
            label: 'Fallback',
            isFallback: true,
            dialTimeoutSec: 20,
            fallbackAction: 'voicemail',
            voicemailBoxId: firstVm?.id ?? '',
            forwardToE164: '',
          },
        };
      }
      return {
        ...base,
        data: {
          ...base.data,
          label: `Press ${options?.menuKey ?? 1}`,
          menuKey: options?.menuKey ?? 1,
          callerIdLabel: '',
          ringGroupId: firstGroup?.id ?? '',
          ringGroupName: firstGroup?.name ?? '',
          ringGroupExtension: firstGroup?.extension ?? '',
          isFallback: false,
        },
      };
    case 'connect_queue':
      return {
        ...base,
        data: {
          ...base.data,
          label: 'Waiting queue',
          ringGroupId: firstGroup?.id ?? '',
          ringGroupName: firstGroup?.name ?? '',
          maxWaitSec: 120,
          holdMusicUrl: '',
        },
      };
    case 'business_hours':
      return {
        ...base,
        data: {
          ...base.data,
          label: 'Business hours',
          source: 'agency',
        },
      };
    case 'play_office_hours':
      return {
        ...base,
        data: {
          ...base.data,
          label: 'Office hours',
          clipName: firstClip?.name ?? '',
        },
      };
    case 'voicemail_directory':
      return {
        ...base,
        data: {
          ...base.data,
          label: 'Voicemail directory (*)',
          clipName: SYSTEM_CLIP_NAMES.voicemailPrompt,
        },
      };
    case 'invalid_message_loop': {
      const invalidClip =
        ctx.audioClips.find((c) => c.name === 'Invalid option') ?? firstClip;
      return {
        ...base,
        data: {
          ...base.data,
          label: 'Invalid input (0)',
          clipName: invalidClip?.name ?? '',
        },
      };
    }
    default:
      return base;
  }
}

export function duplicateFlowNode(node: Node): Node {
  const flowType = String(node.data.flowNodeType ?? 'node');
  const label = String(node.data.label ?? '');
  return {
    ...node,
    id: flowNodeId(flowType.replace(/_/g, '-')),
    position: {
      x: node.position.x + 60,
      y: node.position.y + 60,
    },
    data: {
      ...node.data,
      label: label ? `${label} (copy)` : 'Copy',
    },
    selected: false,
  };
}

export function canDeleteNode(
  node: { id: string; data: { flowNodeType?: CallFlowNodeType } },
  allNodes: { data: { flowNodeType?: CallFlowNodeType } }[],
): { ok: boolean; reason?: string } {
  if (node.data.flowNodeType === 'trigger_incoming') {
    const triggers = allNodes.filter((n) => n.data.flowNodeType === 'trigger_incoming');
    if (triggers.length <= 1) {
      return { ok: false, reason: 'At least one incoming-call trigger is required' };
    }
  }
  return { ok: true };
}
