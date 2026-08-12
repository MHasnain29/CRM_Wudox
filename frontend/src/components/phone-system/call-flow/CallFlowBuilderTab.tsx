import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { GitBranch, Plus, Trash2, Maximize2, Minimize2, Copy } from 'lucide-react';
import type { CallFlowGraph, CallFlowNodeType } from '@/lib/callFlowTypes';
import type {
  DemoRingGroup,
  DemoVoicemailBox,
  DemoAudioClip,
  DemoStaffExtension,
} from '@/lib/phoneSystemTypes';
import type { ActivePhoneBundle } from '@/hooks/useActivePhoneBundle';
import { ensureExtensionDialInFlow } from '@/lib/phoneSystemExtensions';
import { callFlowNodeTypes } from './CallFlowCustomNode';
import { nodeTypeLabel } from './callFlowNodeStyles';
import { AddCallFlowNodeDialog } from './AddCallFlowNodeDialog';
import { CallFlowNodeEditor, CallFlowEdgeEditor } from './CallFlowNodeEditor';
import { canDeleteNode, duplicateFlowNode, flowNodeId } from './callFlowNodeFactory';
import {
  CALL_FLOW_FULLSCREEN_MODAL_Z,
  CALL_FLOW_FULLSCREEN_SHELL_Z,
} from './callFlowFullscreen';
import { CallFlowPublishBar, type CallFlowLiveStatus } from './CallFlowPublishBar';
import { CallFlowInfoPanel } from './CallFlowInfoPanel';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

function graphToFlow(graph: CallFlowGraph): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: 'callFlow',
      position: n.position,
      data: {
        ...n.data,
        flowNodeType: n.type,
        label: (n.data.label as string) ?? nodeTypeLabel(n.type),
      },
    })),
    edges: graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      animated: true,
    })),
  };
}

function flowToGraph(nodes: Node[], edges: Edge[]): CallFlowGraph {
  return {
    version: 1,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: (n.data.flowNodeType as CallFlowNodeType) ?? 'play_message',
      position: n.position,
      data: { ...n.data },
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: typeof e.label === 'string' ? e.label : undefined,
    })),
  };
}

function flowSignature(flow: CallFlowGraph): string {
  const nodes = [...flow.nodes]
    .map((n) => ({ id: n.id, type: n.type, data: n.data }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const edges = [...flow.edges]
    .map((e) => ({ source: e.source, target: e.target, label: e.label ?? '' }))
    .sort((a, b) =>
      `${a.source}:${a.label}:${a.target}`.localeCompare(`${b.source}:${b.label}:${b.target}`),
    );
  return JSON.stringify({ nodes, edges });
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

interface CallFlowCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  onNodeClick: (nodeId: string) => void;
  onEdgeClick: (edgeId: string) => void;
  onPaneClick: () => void;
  focusNodeId: string | null;
  onFocusComplete: () => void;
  isFullscreen: boolean;
}

function CallFlowCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeClick,
  onEdgeClick,
  onPaneClick,
  focusNodeId,
  onFocusComplete,
  isFullscreen,
}: CallFlowCanvasProps) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (!focusNodeId) return;
    const timer = window.setTimeout(() => {
      fitView({ nodes: [{ id: focusNodeId }], padding: 0.5, duration: 300 });
      onFocusComplete();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [focusNodeId, fitView, onFocusComplete]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      nodeTypes={callFlowNodeTypes}
      onNodeClick={(_, node) => onNodeClick(node.id)}
      onEdgeClick={(_, edge) => onEdgeClick(edge.id)}
      onPaneClick={onPaneClick}
      nodesConnectable
      elementsSelectable
      deleteKeyCode={null}
      fitView
      minZoom={0.35}
      maxZoom={1.5}
      className="!bg-muted/20"
    >
      <Background gap={16} />
      <Controls />
      <MiniMap zoomable pannable className={cn('!bg-muted/80', isFullscreen && '!bottom-2 !right-2')} />
    </ReactFlow>
  );
}

export type CallFlowBuilderHandle = {
  flushDraft: () => CallFlowGraph;
  markSaved: () => void;
};

interface CallFlowBuilderTabProps {
  bundle: ActivePhoneBundle['bundle'];
  flowTitle: string;
  draftFlow: CallFlowGraph;
  publishedFlow: CallFlowGraph | null;
  ringGroups: DemoRingGroup[];
  staffExtensions: DemoStaffExtension[];
  voicemailBoxes: DemoVoicemailBox[];
  audioClips: DemoAudioClip[];
  saving?: boolean;
  savingLabel?: string;
  onFlowTitleChange: (title: string) => void;
  onDraftChange: (flow: CallFlowGraph) => void;
  onSave: () => void | Promise<void>;
  onPublish: () => void | Promise<void>;
}

export const CallFlowBuilderTab = forwardRef<CallFlowBuilderHandle, CallFlowBuilderTabProps>(
function CallFlowBuilderTab({
  bundle,
  flowTitle,
  draftFlow,
  publishedFlow,
  ringGroups,
  staffExtensions,
  voicemailBoxes,
  audioClips,
  saving = false,
  savingLabel,
  onFlowTitleChange,
  onDraftChange,
  onSave,
  onPublish,
}, ref) {
  const initial = useMemo(() => graphToFlow(draftFlow), [draftFlow]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [baselineFlow, setBaselineFlow] = useState(draftFlow);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCanvasDirty, setIsCanvasDirty] = useState(false);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [sidePanelTab, setSidePanelTab] = useState<'inspector' | 'info'>('inspector');
  const prevAgencyIdRef = useRef(bundle.subCompanyId);

  const markDirty = useCallback(() => setIsCanvasDirty(true), []);

  useEffect(() => {
    const agencyChanged = bundle.subCompanyId !== prevAgencyIdRef.current;
    if (agencyChanged) {
      prevAgencyIdRef.current = bundle.subCompanyId;
      setIsCanvasDirty(false);
    }

    if (!agencyChanged && isCanvasDirty) return;

    const next = graphToFlow(draftFlow);
    setNodes(next.nodes);
    setEdges(next.edges);
    setBaselineFlow(draftFlow);
    if (agencyChanged) {
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
    }
  }, [bundle.subCompanyId, draftFlow, isCanvasDirty, setNodes, setEdges]);

  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.data.flowNodeType !== 'connect_extension') return n;
        const synced = ensureExtensionDialInFlow(
          {
            version: 1,
            nodes: [
              { id: n.id, type: 'connect_extension', position: n.position, data: n.data },
            ],
            edges: [],
          },
          staffExtensions,
          ringGroups,
          bundle.config.allowExtensionDialing !== false,
        ).nodes[0];
        if (!synced) return n;
        return { ...n, data: synced.data };
      }),
    );
  }, [ringGroups, staffExtensions, bundle.config.allowExtensionDialing, setNodes]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId);

  const canvasGraph = useMemo(() => flowToGraph(nodes, edges), [nodes, edges]);
  const hasUnpublishedChanges = useMemo(() => {
    if (isCanvasDirty) return true;
    if (!publishedFlow?.nodes?.length) return true;
    return flowSignature(canvasGraph) !== flowSignature(publishedFlow);
  }, [canvasGraph, publishedFlow, isCanvasDirty]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (changes.some((c) => c.type === 'position' || c.type === 'remove')) {
        markDirty();
      }
      onNodesChange(changes);
    },
    [markDirty, onNodesChange],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (changes.some((c) => c.type === 'remove')) {
        markDirty();
      }
      onEdgesChange(changes);
    },
    [markDirty, onEdgesChange],
  );

  const persistDraft = useCallback(() => {
    const graph = flowToGraph(nodes, edges);
    onDraftChange(graph);
    return graph;
  }, [nodes, edges, onDraftChange]);

  useImperativeHandle(
    ref,
    () => ({
      flushDraft: () => {
        return persistDraft();
      },
      markSaved: () => {
        setBaselineFlow(flowToGraph(nodes, edges));
        setIsCanvasDirty(false);
      },
    }),
    [nodes, edges, persistDraft],
  );

  const handleReset = () => {
    const reset = graphToFlow(baselineFlow);
    setNodes(reset.nodes);
    setEdges(reset.edges);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setIsCanvasDirty(false);
    toast.message('Reverted unsaved canvas changes');
  };

  const onConnect = useCallback(
    (connection: Connection) => {
      markDirty();
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            id: flowNodeId('e'),
            animated: true,
          },
          eds,
        ),
      );
    },
    [markDirty, setEdges],
  );

  const updateNodeData = useCallback(
    (nodeId: string, data: Record<string, unknown>) => {
      markDirty();
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n)),
      );
    },
    [markDirty, setNodes],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const check = canDeleteNode(node, nodes);
      if (!check.ok) {
        toast.error(check.reason ?? 'Cannot delete this node');
        return;
      }
      markDirty();
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      setDeleteConfirmId(null);
      toast.success('Node removed');
    },
    [nodes, selectedNodeId, markDirty, setNodes, setEdges],
  );

  const deleteEdge = useCallback(
    (edgeId: string) => {
      markDirty();
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
      if (selectedEdgeId === edgeId) setSelectedEdgeId(null);
    },
    [selectedEdgeId, markDirty, setEdges],
  );

  const updateEdge = useCallback(
    (edgeId: string, patch: { label?: string }) => {
      markDirty();
      setEdges((eds) =>
        eds.map((e) => (e.id === edgeId ? { ...e, label: patch.label } : e)),
      );
    },
    [markDirty, setEdges],
  );

  const handleAddNode = (node: Node) => {
    markDirty();
    setNodes((nds) => [...nds, node]);
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setFocusNodeId(node.id);
    toast.success('Node added — edit properties in the panel');
  };

  const duplicateSelectedNode = useCallback(() => {
    if (!selectedNodeId) return;
    const node = nodes.find((n) => n.id === selectedNodeId);
    if (!node) return;
    const copy = duplicateFlowNode(node);
    markDirty();
    setNodes((nds) => [...nds, copy]);
    setSelectedNodeId(copy.id);
    setSelectedEdgeId(null);
    setFocusNodeId(copy.id);
    toast.success('Node duplicated — drag to position and connect');
  }, [selectedNodeId, nodes, markDirty, setNodes]);

  const requestDeleteSelected = useCallback(() => {
    if (selectedEdgeId) {
      deleteEdge(selectedEdgeId);
      toast.success('Connection removed');
      return;
    }
    if (selectedNodeId) {
      const node = nodes.find((n) => n.id === selectedNodeId);
      if (!node) return;
      const check = canDeleteNode(node, nodes);
      if (!check.ok) {
        toast.error(check.reason ?? 'Cannot delete');
        return;
      }
      setDeleteConfirmId(selectedNodeId);
    }
  }, [selectedEdgeId, selectedNodeId, nodes, deleteEdge]);

  useEffect(() => {
    if (!isFullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (addOpen || deleteConfirmId) return;
      setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [isFullscreen, addOpen, deleteConfirmId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedNodeId || selectedEdgeId)) {
        e.preventDefault();
        requestDeleteSelected();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && selectedNodeId) {
        e.preventDefault();
        duplicateSelectedNode();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNodeId, selectedEdgeId, requestDeleteSelected, duplicateSelectedNode]);

  const canDuplicate = Boolean(selectedNodeId);

  const liveStatus: CallFlowLiveStatus = useMemo(() => {
    if (!publishedFlow?.nodes?.length) return 'never';
    if (hasUnpublishedChanges) return 'pending';
    return 'live';
  }, [publishedFlow, hasUnpublishedChanges]);

  const builderUi = (
    <>
      <div className="flex flex-wrap items-center gap-2 justify-between shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-[200px] flex-wrap">
          <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            value={flowTitle}
            onChange={(e) => onFlowTitleChange(e.target.value)}
            className="h-9 font-medium max-w-md"
          />
          {isFullscreen ? (
            <Badge variant="outline" className="shrink-0 text-[10px]">
              Full screen · Esc to exit
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 shrink-0 min-w-0 max-w-full overflow-x-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddOpen(true)}
              title="Add a new node to the flow"
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Add node
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!canDuplicate}
              onClick={duplicateSelectedNode}
              title="Duplicate selected node (Ctrl+D)"
            >
              <Copy className="h-3.5 w-3.5 sm:mr-1" />
              <span className="hidden sm:inline">Duplicate</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!selectedNodeId && !selectedEdgeId}
              onClick={requestDeleteSelected}
              title="Delete selected node or connection (Delete)"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsFullscreen((v) => !v)}
              title={isFullscreen ? 'Exit full screen (Esc)' : 'Full screen'}
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="h-3.5 w-3.5 mr-1" /> Exit full screen
                </>
              ) : (
                <>
                  <Maximize2 className="h-3.5 w-3.5 mr-1" /> Full screen
                </>
              )}
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset} title="Revert unsaved canvas changes">
              Reset
            </Button>
        </div>
      </div>

      <CallFlowPublishBar
        status={liveStatus}
        saving={saving}
        savingLabel={savingLabel}
        onPublish={onPublish}
        onSaveDraft={onSave}
      />

      <div
        className={cn(
          'grid lg:grid-cols-[1fr_minmax(280px,320px)] gap-4 min-h-0',
          isFullscreen ? 'flex-1' : 'min-h-[520px]',
        )}
      >
        <Card className={cn('overflow-hidden', isFullscreen && 'flex flex-col min-h-0 h-full')}>
          <CardContent
            className={cn('p-0', isFullscreen ? 'flex-1 min-h-0 h-full' : 'h-[520px]')}
          >
            <ReactFlowProvider>
              <CallFlowCanvas
                nodes={nodes}
                edges={edges}
                onNodesChange={handleNodesChange}
                onEdgesChange={handleEdgesChange}
                onConnect={onConnect}
                onNodeClick={(nodeId) => {
                  setSelectedNodeId(nodeId);
                  setSelectedEdgeId(null);
                }}
                onEdgeClick={(edgeId) => {
                  setSelectedEdgeId(edgeId);
                  setSelectedNodeId(null);
                }}
                onPaneClick={() => {
                  setSelectedNodeId(null);
                  setSelectedEdgeId(null);
                }}
                focusNodeId={focusNodeId}
                onFocusComplete={() => setFocusNodeId(null)}
                isFullscreen={isFullscreen}
              />
            </ReactFlowProvider>
          </CardContent>
        </Card>

        <ScrollArea
          className={cn(
            'min-w-0',
            isFullscreen ? 'h-full min-h-0 max-h-full' : 'h-[520px]',
          )}
        >
          <div className="space-y-3 pr-5">
            <Card className="overflow-visible">
              <CardHeader className="py-3 pr-5 space-y-3">
                <Tabs
                  value={sidePanelTab}
                  onValueChange={(v) => setSidePanelTab(v as 'inspector' | 'info')}
                >
                  <TabsList className="grid w-full grid-cols-2 h-9">
                    <TabsTrigger value="inspector" className="text-xs">
                      Inspector
                    </TabsTrigger>
                    <TabsTrigger value="info" className="text-xs">
                      Info
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </CardHeader>
              <CardContent className="pb-4">
                {sidePanelTab === 'info' ? (
                  <CallFlowInfoPanel />
                ) : selectedEdge ? (
                  <CallFlowEdgeEditor
                    edge={selectedEdge}
                    nodes={nodes}
                    onUpdate={updateEdge}
                    onDelete={deleteEdge}
                  />
                ) : selectedNode ? (
                  <CallFlowNodeEditor
                    node={selectedNode}
                    nodes={nodes}
                    edges={edges}
                    ringGroups={ringGroups}
                    staffExtensions={staffExtensions}
                    voicemailBoxes={voicemailBoxes}
                    audioClips={audioClips}
                    onUpdate={updateNodeData}
                    onDelete={deleteNode}
                    onDuplicate={duplicateSelectedNode}
                    isFullscreen={isFullscreen}
                    onUpdateEdge={updateEdge}
                    onDeleteEdge={deleteEdge}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Click a node or connection on the canvas to edit it here, or open the{' '}
                    <button
                      type="button"
                      className="text-foreground underline underline-offset-2 hover:no-underline"
                      onClick={() => setSidePanelTab('info')}
                    >
                      Info
                    </button>{' '}
                    tab for a build guide.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </div>

      <AddCallFlowNodeDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        isFullscreen={isFullscreen}
        nodes={nodes}
        selectedNodeId={selectedNodeId}
        ringGroups={ringGroups}
        staffExtensions={staffExtensions}
        voicemailBoxes={voicemailBoxes}
        audioClips={audioClips}
        gatherTimeoutSec={bundle.config.gatherTimeoutSec}
        onAdd={handleAddNode}
      />

      <AlertDialog open={!!deleteConfirmId} onOpenChange={(o) => !o && setDeleteConfirmId(null)}>
        <AlertDialogContent
          className={cn(isFullscreen && CALL_FLOW_FULLSCREEN_MODAL_Z)}
          overlayClassName={isFullscreen ? CALL_FLOW_FULLSCREEN_MODAL_Z : undefined}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete node?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the node and all connections to it. This cannot be undone until you click
              Reset on the toolbar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteConfirmId && deleteNode(deleteConfirmId)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  const wrapped = (
    <div
      className={cn(
        isFullscreen &&
          `fixed inset-0 ${CALL_FLOW_FULLSCREEN_SHELL_Z} flex flex-col gap-3 bg-background p-4 overflow-hidden`,
        !isFullscreen && 'space-y-3',
      )}
    >
      {builderUi}
    </div>
  );

  if (isFullscreen) {
    return createPortal(wrapped, document.body);
  }

  return wrapped;
});
