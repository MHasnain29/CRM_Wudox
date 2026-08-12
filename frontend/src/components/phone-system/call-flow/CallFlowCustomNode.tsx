import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import type { CallFlowNodeType } from '@/lib/callFlowTypes';
import { CALL_FLOW_NODE_COLORS, nodeTypeLabel } from './callFlowNodeStyles';

export type CallFlowNodeData = {
  label?: string;
  flowNodeType: CallFlowNodeType;
  isFallback?: boolean;
  [key: string]: unknown;
};

export function CallFlowCustomNode({ data, selected }: NodeProps) {
  const flowType = (data.flowNodeType as CallFlowNodeType) ?? 'play_message';
  const colors = CALL_FLOW_NODE_COLORS[flowType];
  const isFallback = Boolean(data.isFallback);

  return (
    <div
      className={cn(
        'rounded-lg border-2 px-3 py-2 min-w-[120px] max-w-[160px] shadow-sm text-xs',
        colors.bg,
        colors.border,
        colors.text,
        selected && 'ring-2 ring-primary ring-offset-2',
        isFallback && 'border-rose-500 bg-rose-50 dark:bg-rose-950 text-rose-900 dark:text-rose-100',
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />
      <p className="font-semibold leading-tight">
        {isFallback ? 'Fallback' : nodeTypeLabel(flowType)}
      </p>
      {data.label ? (
        <p className="text-[10px] opacity-80 mt-0.5 line-clamp-2">{String(data.label)}</p>
      ) : null}
      {flowType === 'connect_extension' && Boolean(data.enabled) ? (
        <p className="text-[10px] opacity-80 mt-0.5">
          {Number(data.extensionCount ?? 0)} staff ext
        </p>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </div>
  );
}

export const callFlowNodeTypes = {
  callFlow: CallFlowCustomNode,
};
