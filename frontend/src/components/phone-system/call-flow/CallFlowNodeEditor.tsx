import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CallFlowSelectContent } from './CallFlowSelectContent';
import { Trash2, Copy } from 'lucide-react';
import type { Node, Edge } from '@xyflow/react';
import type { CallFlowNodeType } from '@/lib/callFlowTypes';
import type {
  DemoRingGroup,
  DemoVoicemailBox,
  DemoAudioClip,
  DemoStaffExtension,
  FallbackAction,
} from '@/lib/phoneSystemTypes';
import { collectDialableUserExtensions } from '@/lib/phoneSystemExtensions';
import { nodeTypeLabel } from './callFlowNodeStyles';
import { canDeleteNode } from './callFlowNodeFactory';

interface CallFlowNodeEditorProps {
  node: Node;
  nodes: Node[];
  edges: Edge[];
  ringGroups: DemoRingGroup[];
  staffExtensions: DemoStaffExtension[];
  voicemailBoxes: DemoVoicemailBox[];
  audioClips: DemoAudioClip[];
  isFullscreen?: boolean;
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void;
  onDelete: (nodeId: string) => void;
  onDuplicate?: () => void;
  onUpdateEdge: (edgeId: string, patch: { label?: string }) => void;
  onDeleteEdge: (edgeId: string) => void;
}

export function CallFlowNodeEditor({
  node,
  nodes,
  edges,
  ringGroups,
  staffExtensions,
  voicemailBoxes,
  audioClips,
  isFullscreen = false,
  onUpdate,
  onDelete,
  onDuplicate,
  onUpdateEdge,
  onDeleteEdge,
}: CallFlowNodeEditorProps) {
  const type = node.data.flowNodeType as CallFlowNodeType;
  const isFallback = Boolean(node.data.isFallback);
  const outgoing = edges.filter((e) => e.source === node.id);
  const incoming = edges.filter((e) => e.target === node.id);
  const deleteCheck = canDeleteNode(node, nodes);

  const patch = (data: Record<string, unknown>) => onUpdate(node.id, data);

  const handleRingGroup = (groupId: string) => {
    const g = ringGroups.find((r) => r.id === groupId);
    patch({
      ringGroupId: groupId,
      ringGroupName: g?.name ?? '',
      ringGroupExtension: g?.extension ?? '',
    });
  };

  const dialable = collectDialableUserExtensions(staffExtensions, ringGroups);

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm">{nodeTypeLabel(type)}</p>
            {isFallback ? (
              <span className="text-[10px] rounded px-1.5 py-0.5 border border-rose-500 bg-rose-50 dark:bg-rose-950 text-rose-800 dark:text-rose-100 shrink-0">
                Fallback
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground font-mono text-[10px] break-all">{node.id}</p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 -mr-1">
          {onDuplicate ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              title="Duplicate node (Ctrl+D)"
              onClick={onDuplicate}
            >
              <Copy className="h-4 w-4" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-destructive"
            disabled={!deleteCheck.ok}
            title={deleteCheck.reason ?? 'Delete node'}
            onClick={() => onDelete(node.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Display label</Label>
        <Input
          className="h-8"
          value={String(node.data.label ?? '')}
          onChange={(e) => patch({ label: e.target.value })}
        />
      </div>

      {type === 'play_message' ||
      type === 'play_office_hours' ||
      type === 'invalid_message_loop' ||
      type === 'voicemail_directory' ? (
        <div className="space-y-2">
          <Label className="text-xs">Audio clip</Label>
          <Select
            value={String(node.data.clipName ?? '')}
            onValueChange={(v) => patch({ clipName: v })}
          >
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Select clip" />
            </SelectTrigger>
            <CallFlowSelectContent isFullscreen={isFullscreen}>
              {audioClips.map((c) => (
                <SelectItem key={c.id} value={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </CallFlowSelectContent>
          </Select>
        </div>
      ) : null}

      {type === 'gather_dtmf' ? (
        <div className="space-y-2">
          <Label className="text-xs">Gather timeout (sec)</Label>
          <Input
            type="number"
            className="h-8"
            value={String(node.data.timeoutSec ?? 5)}
            onChange={(e) => patch({ timeoutSec: parseInt(e.target.value, 10) || 5 })}
          />
          <div className="space-y-1">
            <Label className="text-xs">On silence (timeout)</Label>
            <Select
              value={(node.data.timeoutBehavior as string) === 'end' ? 'end' : 'loop'}
              onValueChange={(v) => patch({ timeoutBehavior: v })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <CallFlowSelectContent isFullscreen={isFullscreen}>
                <SelectItem value="loop" className="text-xs">
                  Loop — play timeout message and return to menu
                </SelectItem>
                <SelectItem value="end" className="text-xs">
                  End call — goodbye and hang up
                </SelectItem>
              </CallFlowSelectContent>
            </Select>
          </div>
        </div>
      ) : null}

      {type === 'connect_extension' ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Switch
              id="ext-enabled"
              checked={Boolean(node.data.enabled)}
              onCheckedChange={(checked) => patch({ enabled: checked })}
            />
            <Label htmlFor="ext-enabled" className="text-xs">
              Allow extension dialing during menu
            </Label>
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            During the menu, callers can dial a staff extension to connect directly. Assign
            extensions on the <strong>Extensions</strong> tab (CRM users only — not free-text names).
          </p>

          {dialable.length > 0 ? (
            <div className="border rounded-md overflow-hidden">
              <div className="bg-muted/50 px-2 py-1 text-[10px] font-medium">
                Dialable staff ({dialable.length})
              </div>
              <ul className="max-h-40 overflow-y-auto divide-y text-[10px]">
                {dialable.map((row) => (
                  <li key={row.userId} className="px-2 py-1.5 flex justify-between gap-2">
                    <span className="font-mono font-medium">{row.extension}</span>
                    <span className="truncate text-muted-foreground text-right">
                      {row.userName}
                      {row.ringGroupName !== 'Not in a ring group' ? ` · ${row.ringGroupName}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground border rounded-md px-2 py-3 text-center">
              No extensions yet. Open the Extensions tab and assign PBX extensions to agency users.
            </p>
          )}

          <p className="text-[10px] text-muted-foreground">
            {dialable.length} staff extension{dialable.length === 1 ? '' : 's'} callers can dial
          </p>
          {(() => {
            const labels = new Set(
              outgoing.map((e) => (typeof e.label === 'string' ? e.label.trim() : '')).filter(Boolean),
            );
            const missing: string[] = [];
            if (!labels.has('not found')) missing.push('"not found"');
            if (!labels.has('no answer')) missing.push('"no answer"');
            if (missing.length === 0) return null;
            return (
              <p className="text-[10px] text-amber-700 dark:text-amber-300 border border-amber-500/40 rounded-md px-2 py-2">
                Add outgoing edges labeled {missing.join(' and ')} (e.g. back to Main menu) so callers
                return to the menu when an extension is unknown or unavailable.
              </p>
            );
          })()}
        </div>
      ) : null}

      {type === 'connect_group' && !isFallback ? (
        <>
          <div className="space-y-2">
            <Label className="text-xs">Menu key</Label>
            <Select
              value={String(node.data.menuKey ?? 1)}
              onValueChange={(v) => patch({ menuKey: parseInt(v, 10) })}
            >
              <SelectTrigger className="h-8">
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
          {node.data.ringGroupId ? (
            <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-1">
              <p className="text-[10px] text-muted-foreground">Ring group (from Ring Groups tab)</p>
              <p className="text-sm font-medium">
                {String(
                  ringGroups.find((g) => g.id === node.data.ringGroupId)?.name ??
                    node.data.ringGroupName ??
                    'Unknown group',
                )}
              </p>
              <p className="font-mono text-xs text-muted-foreground">
                Ext{' '}
                {String(
                  ringGroups.find((g) => g.id === node.data.ringGroupId)?.extension ??
                    node.data.ringGroupExtension ??
                    '—',
                )}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label className="text-xs">Ring group</Label>
              <Select
                value={String(node.data.ringGroupId ?? '')}
                onValueChange={handleRingGroup}
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Select group" />
                </SelectTrigger>
                <CallFlowSelectContent isFullscreen={isFullscreen}>
                  {ringGroups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      Ext {g.extension} · {g.name}
                    </SelectItem>
                  ))}
                </CallFlowSelectContent>
              </Select>
            </div>
          )}
          {(() => {
            const labels = new Set(
              outgoing.map((e) => (typeof e.label === 'string' ? e.label.trim() : '')).filter(Boolean),
            );
            if (labels.has('busy')) return null;
            return (
              <p className="text-[10px] text-muted-foreground border border-border rounded-md px-2 py-2">
                Tip: add a <code>busy</code> edge to a <strong>Waiting queue</strong> so callers are
                held in line when every agent is already on a call.
              </p>
            );
          })()}
        </>
      ) : null}

      {type === 'connect_queue' ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label className="text-xs">Ring group serving this queue</Label>
            <Select value={String(node.data.ringGroupId ?? '')} onValueChange={handleRingGroup}>
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Select group" />
              </SelectTrigger>
              <CallFlowSelectContent isFullscreen={isFullscreen}>
                {ringGroups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    Ext {g.extension} · {g.name}
                  </SelectItem>
                ))}
              </CallFlowSelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Max wait (sec)</Label>
            <Input
              type="number"
              className="h-8"
              value={String(node.data.maxWaitSec ?? 120)}
              onChange={(e) => patch({ maxWaitSec: parseInt(e.target.value, 10) || 120 })}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Hold music URL (optional)</Label>
            <Input
              className="h-8"
              placeholder="https://…/hold.mp3"
              value={String(node.data.holdMusicUrl ?? '')}
              onChange={(e) => patch({ holdMusicUrl: e.target.value })}
            />
            <p className="text-[10px] text-muted-foreground">
              Played to callers while they wait. Leave blank for default hold music.
            </p>
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Callers wait here (usually reached via a <code>busy</code> edge from a ring group) and are
            connected to the next available agent. Add an outgoing edge labeled <code>timeout</code>{' '}
            for callers who wait too long.
          </p>
          {(() => {
            const labels = new Set(
              outgoing.map((e) => (typeof e.label === 'string' ? e.label.trim() : '')).filter(Boolean),
            );
            if (labels.has('timeout')) return null;
            return (
              <p className="text-[10px] text-amber-700 dark:text-amber-300 border border-amber-500/40 rounded-md px-2 py-2">
                Add an outgoing edge labeled "timeout" (e.g. to a voicemail fallback) for callers who
                exceed the max wait.
              </p>
            );
          })()}
        </div>
      ) : null}

      {type === 'business_hours' ? (
        <div className="space-y-2 rounded-md border bg-muted/30 px-3 py-2">
          <p className="text-[11px] font-medium">Routes by open / closed</p>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            At call time this checks the agency <strong>Business hours</strong> settings (evaluated in
            server local time). Add two outgoing edges labeled <code>open</code> and{' '}
            <code>closed</code> so the call is routed differently when the office is open vs. closed.
          </p>
          {(() => {
            const labels = new Set(
              outgoing.map((e) => (typeof e.label === 'string' ? e.label.trim() : '')).filter(Boolean),
            );
            const missing: string[] = [];
            if (!labels.has('open')) missing.push('"open"');
            if (!labels.has('closed')) missing.push('"closed"');
            if (missing.length === 0) return null;
            return (
              <p className="text-[10px] text-amber-700 dark:text-amber-300 border border-amber-500/40 rounded-md px-2 py-2">
                Add outgoing edges labeled {missing.join(' and ')} so both open and closed callers are
                routed.
              </p>
            );
          })()}
        </div>
      ) : null}

      {type === 'connect_group' && isFallback ? (
        <>
          <div className="space-y-2">
            <Label className="text-xs">Dial timeout (sec)</Label>
            <Input
              type="number"
              className="h-8"
              value={String(node.data.dialTimeoutSec ?? 20)}
              onChange={(e) => patch({ dialTimeoutSec: parseInt(e.target.value, 10) || 20 })}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">After timeout</Label>
            <Select
              value={String(node.data.fallbackAction ?? 'voicemail')}
              onValueChange={(v) => patch({ fallbackAction: v as FallbackAction })}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <CallFlowSelectContent isFullscreen={isFullscreen}>
                <SelectItem value="voicemail">Leave voicemail</SelectItem>
                <SelectItem value="forward">Forward to another number</SelectItem>
              </CallFlowSelectContent>
            </Select>
          </div>
          {node.data.fallbackAction === 'forward' ? (
            <div className="space-y-2">
              <Label className="text-xs">Forwarding number</Label>
              <Input
                className="h-8"
                placeholder="+15145551234"
                value={String(node.data.forwardToE164 ?? '')}
                onChange={(e) => patch({ forwardToE164: e.target.value })}
              />
              <p className="text-[10px] text-muted-foreground">
                External number to ring if the group does not answer (include + and country code).
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label className="text-xs">Voicemail box</Label>
              <Select
                value={String(node.data.voicemailBoxId ?? '')}
                onValueChange={(v) => patch({ voicemailBoxId: v })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Select box" />
                </SelectTrigger>
                <CallFlowSelectContent isFullscreen={isFullscreen}>
                  {voicemailBoxes.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      Ext {v.extension} · {v.name}
                    </SelectItem>
                  ))}
                </CallFlowSelectContent>
              </Select>
            </div>
          )}
        </>
      ) : null}

      <div className="border-t pt-2 space-y-2">
        <p className="font-medium text-xs">Connections</p>
        {incoming.length === 0 && outgoing.length === 0 ? (
          <p className="text-muted-foreground">Drag from node handles to connect, or add via Add node.</p>
        ) : null}
        {incoming.map((e) => {
          const src = nodes.find((n) => n.id === e.source);
          return (
            <div key={e.id} className="flex items-center gap-1 rounded border px-2 py-1">
              <span className="flex-1 truncate">
                ← {String(src?.data.label ?? e.source)}
                {e.label ? ` (${e.label})` : ''}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-destructive"
                onClick={() => onDeleteEdge(e.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          );
        })}
        {outgoing.map((e) => (
          <div key={e.id} className="space-y-1 rounded border px-2 py-1">
            <div className="flex items-center gap-1">
              <span className="flex-1 truncate">
                → {nodes.find((n) => n.id === e.target)?.data.label ?? e.target}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-destructive"
                onClick={() => onDeleteEdge(e.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            <Input
              className="h-7 text-[10px]"
              placeholder={
                type === 'connect_extension'
                  ? 'not found / no answer / busy'
                  : type === 'connect_group' && !isFallback
                    ? 'no answer / busy'
                    : type === 'connect_queue'
                      ? 'timeout / answered'
                      : type === 'business_hours'
                        ? 'open / closed'
                        : type === 'gather_dtmf'
                          ? '1–9, 0, *, ext, timeout, invalid'
                          : type === 'invalid_message_loop' || type === 'voicemail_directory'
                            ? 'Leave unlabeled (loop back)'
                            : 'Edge label'
              }
              value={typeof e.label === 'string' ? e.label : ''}
              onChange={(ev) => onUpdateEdge(e.id, { label: ev.target.value })}
            />
          </div>
        ))}
      </div>

      {!deleteCheck.ok ? (
        <p className="text-[10px] text-muted-foreground">{deleteCheck.reason}</p>
      ) : null}
    </div>
  );
}

interface CallFlowEdgeEditorProps {
  edge: Edge;
  nodes: Node[];
  onUpdate: (edgeId: string, patch: { label?: string }) => void;
  onDelete: (edgeId: string) => void;
}

export function CallFlowEdgeEditor({ edge, nodes, onUpdate, onDelete }: CallFlowEdgeEditorProps) {
  const source = nodes.find((n) => n.id === edge.source);
  const target = nodes.find((n) => n.id === edge.target);
  const sourceType = source?.data.flowNodeType as CallFlowNodeType | undefined;
  const labelPlaceholder =
    sourceType === 'connect_extension'
      ? 'not found / no answer / busy'
      : sourceType === 'connect_group'
        ? 'no answer / busy'
        : sourceType === 'connect_queue'
          ? 'timeout / answered'
          : sourceType === 'business_hours'
            ? 'open / closed'
            : sourceType === 'gather_dtmf'
              ? '1–9, 0, *, ext, timeout, invalid'
              : 'DTMF / route label';

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-sm">Connection</p>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive"
          onClick={() => onDelete(edge.id)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <p>
        <span className="text-muted-foreground">From:</span>{' '}
        {String(source?.data.label ?? edge.source)}
      </p>
      <p>
        <span className="text-muted-foreground">To:</span>{' '}
        {String(target?.data.label ?? edge.target)}
      </p>
      <div className="space-y-2">
        <Label className="text-xs">Label (DTMF / route)</Label>
        <Input
          className="h-8"
          placeholder={labelPlaceholder}
          value={typeof edge.label === 'string' ? edge.label : ''}
          onChange={(e) => onUpdate(edge.id, { label: e.target.value })}
        />
      </div>
    </div>
  );
}
