import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CallFlowSelectContent } from './CallFlowSelectContent';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Plus } from 'lucide-react';
import type { CallFlowNodeType } from '@/lib/callFlowTypes';
import type { Node } from '@xyflow/react';
import {
  ADDABLE_NODE_TYPES,
  createFlowNode,
  defaultPosition,
} from './callFlowNodeFactory';
import { nodeTypeLabel } from './callFlowNodeStyles';
import type { DemoRingGroup, DemoVoicemailBox, DemoAudioClip, DemoStaffExtension } from '@/lib/phoneSystemTypes';
import { cn } from '@/lib/utils';
import { CALL_FLOW_FULLSCREEN_MODAL_Z } from './callFlowFullscreen';

interface AddCallFlowNodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isFullscreen?: boolean;
  nodes: Node[];
  selectedNodeId: string | null;
  ringGroups: DemoRingGroup[];
  staffExtensions: DemoStaffExtension[];
  voicemailBoxes: DemoVoicemailBox[];
  audioClips: DemoAudioClip[];
  gatherTimeoutSec?: number;
  onAdd: (node: Node) => void;
}

export function AddCallFlowNodeDialog({
  open,
  onOpenChange,
  isFullscreen = false,
  nodes,
  selectedNodeId,
  ringGroups,
  staffExtensions,
  voicemailBoxes,
  audioClips,
  gatherTimeoutSec,
  onAdd,
}: AddCallFlowNodeDialogProps) {
  const [nodeType, setNodeType] = useState<CallFlowNodeType>('connect_group');
  const [isFallback, setIsFallback] = useState(false);
  const [menuKey, setMenuKey] = useState(1);

  const anchor = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : undefined;
  const position = defaultPosition(nodes, anchor);

  const handleAdd = () => {
    const flowType: CallFlowNodeType =
      nodeType === 'connect_group' && isFallback ? 'connect_group' : nodeType;
    const node = createFlowNode(
      flowType,
      position,
      { ringGroups, staffExtensions, voicemailBoxes, audioClips, gatherTimeoutSec },
      nodeType === 'connect_group' ? { isFallback, menuKey: isFallback ? undefined : menuKey } : undefined,
    );
    onAdd(node);
    onOpenChange(false);
    setIsFallback(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn('max-w-md', isFullscreen && CALL_FLOW_FULLSCREEN_MODAL_Z)}
        overlayClassName={isFullscreen ? CALL_FLOW_FULLSCREEN_MODAL_Z : undefined}
      >
        <DialogHeader>
          <DialogTitle>Add flow node</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label>Node type</Label>
            <Select value={nodeType} onValueChange={(v) => setNodeType(v as CallFlowNodeType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <CallFlowSelectContent isFullscreen={isFullscreen}>
                {ADDABLE_NODE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {nodeTypeLabel(t)}
                  </SelectItem>
                ))}
              </CallFlowSelectContent>
            </Select>
          </div>

          {nodeType === 'connect_group' ? (
            <div className="flex items-center gap-2">
              <Switch id="fb-node" checked={isFallback} onCheckedChange={setIsFallback} />
              <Label htmlFor="fb-node">Fallback node (after no answer)</Label>
            </div>
          ) : null}

          {nodeType === 'connect_group' && !isFallback ? (
            <div className="space-y-2">
              <Label>Menu key (DTMF)</Label>
              <Select value={String(menuKey)} onValueChange={(v) => setMenuKey(parseInt(v, 10))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <CallFlowSelectContent isFullscreen={isFullscreen}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((k) => (
                    <SelectItem key={k} value={String(k)}>
                      Key {k}
                    </SelectItem>
                  ))}
                </CallFlowSelectContent>
              </Select>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            After adding, drag from a node handle to connect routes and set edge labels in the
            properties panel.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd}>
            <Plus className="h-4 w-4 mr-1" /> Add node
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
