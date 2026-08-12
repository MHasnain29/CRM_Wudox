import type {
  DemoMenuRoute,
  DemoRingGroup,
  DemoStaffExtension,
  DemoVoicemailBox,
} from './phoneSystemTypes';
import { newEntityId } from './phoneSystemTypes';
import { SYSTEM_CLIP_NAMES } from './phoneSystemSystemClips';
import type { CallFlowGraph } from './callFlowTypes';

export interface DialableUserExtension {
  extension: string;
  userName: string;
  ringGroupName: string;
  userId: string;
}

export interface StaffUserLike {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export function staffUserLabel(user: StaffUserLike): string {
  return `${user.firstName} ${user.lastName}`.trim() || user.email;
}

export function staffExtensionByUserId(
  staffExtensions: DemoStaffExtension[],
): Map<string, DemoStaffExtension> {
  return new Map(staffExtensions.map((s) => [s.userId, s]));
}

export function isStaffExtensionInUse(
  extension: string,
  staffExtensions: DemoStaffExtension[],
  excludeUserId?: string,
): boolean {
  const ext = extension.trim();
  if (!ext) return false;
  return staffExtensions.some(
    (s) => s.extension.trim() === ext && s.userId !== excludeUserId,
  );
}

export function ringGroupsForUser(userId: string, ringGroups: DemoRingGroup[]): string[] {
  return ringGroups
    .filter((g) => g.members.some((m) => m.userId === userId))
    .map((g) => g.name);
}

/** All staff with a PBX extension — used by Extension dial node. */
export function collectDialableUserExtensions(
  staffExtensions: DemoStaffExtension[],
  ringGroups: DemoRingGroup[] = [],
): DialableUserExtension[] {
  return staffExtensions
    .filter((s) => s.extension.trim())
    .map((s) => {
      const groups = ringGroupsForUser(s.userId, ringGroups);
      return {
        userId: s.userId,
        extension: s.extension.trim(),
        userName: s.userName,
        ringGroupName: groups.length > 0 ? groups.join(', ') : 'Not in a ring group',
      };
    })
    .sort((a, b) =>
      a.extension.localeCompare(b.extension, undefined, { numeric: true }),
    );
}

export function extDialNodeData(
  staffExtensions: DemoStaffExtension[],
  ringGroups: DemoRingGroup[],
  enabled = true,
): Record<string, unknown> {
  const userExtensions = collectDialableUserExtensions(staffExtensions, ringGroups);
  return {
    label: 'Extension dial',
    enabled,
    userExtensions,
    extensionCount: userExtensions.length,
    notFoundClipName: SYSTEM_CLIP_NAMES.extensionNotFound,
    unavailableClipName: SYSTEM_CLIP_NAMES.extensionNotAvailable,
  };
}

export function syncExtDialNodesInFlow(
  flow: import('./callFlowTypes').CallFlowGraph,
  staffExtensions: DemoStaffExtension[],
  ringGroups: DemoRingGroup[],
): import('./callFlowTypes').CallFlowGraph {
  const userExtensions = collectDialableUserExtensions(staffExtensions, ringGroups);
  return {
    ...flow,
    nodes: flow.nodes.map((node) =>
      node.type === 'connect_extension'
        ? {
            ...node,
            data: {
              ...node.data,
              userExtensions,
              extensionCount: userExtensions.length,
            },
          }
        : node,
    ),
  };
}

export const GREETING_EXTENSION_HINT =
  "If you know your party's extension, dial it now followed by the pound key.";

/** Restore extension-dial wording when greeting clip was saved without it. */
export function ensureGreetingClipExtensionHint(
  audioClips: import('./phoneSystemTypes').AudioClip[],
): import('./phoneSystemTypes').AudioClip[] {
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

/**
 * Ensures gather → (ext) → connect_extension exists so callers can dial staff extensions during the menu.
 */
export function ensureExtensionDialInFlow(
  flow: import('./callFlowTypes').CallFlowGraph,
  staffExtensions: DemoStaffExtension[],
  ringGroups: DemoRingGroup[],
  allowExtensionDialing = true,
): import('./callFlowTypes').CallFlowGraph {
  const gather = flow.nodes.find((n) => n.type === 'gather_dtmf');
  if (!gather) {
    return syncExtDialNodesInFlow(flow, staffExtensions, ringGroups);
  }

  let extNode = flow.nodes.find((n) => n.type === 'connect_extension');
  const nodes = [...flow.nodes];
  const edges = [...flow.edges];

  if (!extNode) {
    extNode = {
      id: 'ext-dial',
      type: 'connect_extension',
      position: { x: 120, y: 280 },
      data: extDialNodeData(staffExtensions, ringGroups, allowExtensionDialing),
    };
    nodes.push(extNode);
  }

  const hasExtEdge = edges.some(
    (e) => e.source === gather.id && e.label === 'ext' && e.target === extNode!.id,
  );
  if (!hasExtEdge) {
    const edgeId = edges.some((e) => e.id === 'e-gather-ext')
      ? `e-gather-ext-${Date.now()}`
      : 'e-gather-ext';
    edges.push({
      id: edgeId,
      source: gather.id,
      target: extNode.id,
      label: 'ext',
    });
  }

  const withExt = { ...flow, nodes, edges };
  const synced = syncExtDialNodesInFlow(withExt, staffExtensions, ringGroups);
  return {
    ...synced,
    nodes: synced.nodes.map((node) =>
      node.type === 'connect_extension'
        ? {
            ...node,
            data: {
              ...extDialNodeData(staffExtensions, ringGroups, allowExtensionDialing),
              ...node.data,
              enabled: allowExtensionDialing,
              label: (node.data.label as string) ?? 'Extension dial',
            },
          }
        : node,
    ),
  };
}

export function syncRingGroupMembersFromStaff(
  ringGroups: DemoRingGroup[],
  staffExtensions: DemoStaffExtension[],
): DemoRingGroup[] {
  return alignStaffAndRingGroups(staffExtensions, ringGroups).ringGroups;
}

/** Keep staffExtensions + ring group members in sync (extensions tab is source of truth). */
export function alignStaffAndRingGroups(
  staffExtensions: DemoStaffExtension[],
  ringGroups: DemoRingGroup[],
): { staffExtensions: DemoStaffExtension[]; ringGroups: DemoRingGroup[] } {
  const byUser = staffExtensionByUserId(staffExtensions);

  const alignedRingGroups = ringGroups.map((g) => ({
    ...g,
    members: g.members
      .filter((m) => m.userId && byUser.has(m.userId))
      .map((m) => {
        const staff = byUser.get(m.userId)!;
        return {
          ...m,
          userId: staff.userId,
          userName: staff.userName,
          extension: staff.extension,
        };
      }),
  }));

  return { staffExtensions, ringGroups: alignedRingGroups };
}

/** Refresh cached userName on staff extension rows from live CRM users. */
export function syncStaffExtensionNamesFromUsers(
  staffExtensions: DemoStaffExtension[],
  users: StaffUserLike[],
): DemoStaffExtension[] {
  if (users.length === 0) return staffExtensions;
  const byId = new Map(users.map((u) => [u.id, u]));
  let changed = false;
  const next = staffExtensions.map((s) => {
    const user = byId.get(s.userId);
    if (!user) return s;
    const userName = staffUserLabel(user);
    if (userName === s.userName) return s;
    changed = true;
    return { ...s, userName };
  });
  return changed ? next : staffExtensions;
}

export function resolveRingGroupMember(
  member: DemoRingGroup['members'][number],
  staffExtensions: DemoStaffExtension[],
): DemoStaffExtension | null {
  return staffExtensionByUserId(staffExtensions).get(member.userId) ?? null;
}

/** Build initial staff extension rows from legacy demo ring members + direct dial list. */
export const STAFF_EXTENSION_START = 101;

function sortRingGroupsByExtension(ringGroups: DemoRingGroup[]): DemoRingGroup[] {
  return [...ringGroups].sort(
    (a, b) =>
      (parseInt(a.extension, 10) || 0) - (parseInt(b.extension, 10) || 0) ||
      a.extension.localeCompare(b.extension),
  );
}

/** Numeric ring-group extension → IVR / menu key (e.g. ext "5" → key 5). */
export function parseRingGroupMenuKey(extension: string): number | null {
  const ext = extension.trim();
  if (!ext || !/^\d+$/.test(ext)) return null;
  const n = parseInt(ext, 10);
  return Number.isNaN(n) ? null : n;
}

export { sortRingGroupsByExtension };

/** Next free low extension for a new ring group (1, 2, 3…). */
export function suggestNextRingGroupExtension(ringGroups: DemoRingGroup[]): string {
  const used = new Set(
    ringGroups.map((g) => parseInt(g.extension, 10)).filter((n) => !Number.isNaN(n)),
  );
  for (let i = 1; i <= 99; i++) {
    if (!used.has(i)) return String(i);
  }
  return String(ringGroups.length + 1);
}

function collectReservedExtensions(
  ringGroups: DemoRingGroup[],
  voicemailBoxes: DemoVoicemailBox[],
): Set<string> {
  const reserved = new Set<string>();
  for (const g of ringGroups) {
    const ext = g.extension.trim();
    if (ext) reserved.add(ext);
  }
  for (const v of voicemailBoxes) {
    const ext = v.extension.trim();
    if (ext) reserved.add(ext);
  }
  return reserved;
}

/** Assign 101+ to users without an extension; preserves manual assignments. */
export function assignDefaultStaffExtensions(
  users: StaffUserLike[],
  existing: DemoStaffExtension[],
  ringGroups: DemoRingGroup[] = [],
  voicemailBoxes: DemoVoicemailBox[] = [],
): DemoStaffExtension[] {
  const reserved = collectReservedExtensions(ringGroups, voicemailBoxes);
  for (const s of existing) {
    const ext = s.extension.trim();
    if (ext) reserved.add(ext);
  }

  const sortedUsers = [...users].sort((a, b) =>
    staffUserLabel(a).localeCompare(staffUserLabel(b)),
  );

  let next = STAFF_EXTENSION_START;
  const result = new Map(existing.map((s) => [s.userId, s]));

  for (const user of sortedUsers) {
    const current = result.get(user.id);
    if (current?.extension.trim()) continue;

    while (reserved.has(String(next))) next++;
    const extension = String(next);
    reserved.add(extension);
    next++;

    result.set(user.id, {
      userId: user.id,
      userName: staffUserLabel(user),
      extension,
    });
  }

  return Array.from(result.values());
}

/** Rebuild menu routes from ring groups — menu key = each group's numeric extension. */
export function deriveMenuRoutesFromRingGroups(
  ringGroups: DemoRingGroup[],
  voicemailBoxes: DemoVoicemailBox[],
  existingMenuRoutes: DemoMenuRoute[] = [],
): DemoMenuRoute[] {
  const sorted = sortRingGroupsByExtension(ringGroups);
  const routes: DemoMenuRoute[] = [];
  const usedKeys = new Set<number>();

  for (const group of sorted) {
    const key = parseRingGroupMenuKey(group.extension);
    if (key == null || usedKeys.has(key)) continue;
    usedKeys.add(key);
    const prev =
      existingMenuRoutes.find((r) => r.ringGroupId === group.id) ??
      existingMenuRoutes.find((r) => r.key === key);
    const vm =
      voicemailBoxes.find((v) => v.id === group.fallbackVoicemailBoxId) ?? voicemailBoxes[0];
    routes.push({
      id: prev?.id ?? newEntityId('mr'),
      key,
      callerIdLabel: prev?.callerIdLabel ?? group.name,
      ringGroupId: group.id,
      ringGroupExtension: group.extension,
      ringGroupName: group.name,
      dialTimeoutSec: group.dialTimeoutSec,
      voicemailBoxId: vm?.id ?? group.fallbackVoicemailBoxId,
      voicemailExtension: vm?.extension ?? '',
      voicemailName: vm?.name ?? '',
      fallbackAction: group.fallbackAction,
      fallbackForwardE164: group.fallbackForwardE164,
    });
  }

  const prevOffice = existingMenuRoutes.find(
    (r) => r.key === 4 && r.callerIdLabel?.toLowerCase().includes('office'),
  );
  if (prevOffice && !usedKeys.has(4)) {
    routes.push(prevOffice);
  }

  return routes.sort((a, b) => a.key - b.key);
}

/** Keep connect_group nodes and gather edges aligned with Ring Groups tab. */
export function syncConnectGroupNodesInFlow(
  flow: CallFlowGraph,
  ringGroups: DemoRingGroup[],
  menuRoutes: DemoMenuRoute[],
): CallFlowGraph {
  const groupById = new Map(ringGroups.map((g) => [g.id, g]));
  const gather = flow.nodes.find((n) => n.type === 'gather_dtmf');

  const nodes = flow.nodes.map((node) => {
    if (node.type !== 'connect_group') return node;

    if (node.data.isFallback) {
      const parentEdge = flow.edges.find(
        (e) => e.target === node.id && e.label === 'no answer',
      );
      const parent = parentEdge
        ? flow.nodes.find((n) => n.id === parentEdge.source)
        : undefined;
      const ringGroupId = parent?.data.ringGroupId as string | undefined;
      const group = ringGroupId ? groupById.get(ringGroupId) : undefined;
      const menuKey = parent?.data.menuKey as number | undefined;
      const route = menuKey != null ? menuRoutes.find((r) => r.key === menuKey) : undefined;
      if (!group) return node;
      return {
        ...node,
        data: {
          ...node.data,
          dialTimeoutSec: route?.dialTimeoutSec ?? group.dialTimeoutSec,
          fallbackAction: route?.fallbackAction ?? group.fallbackAction,
          voicemailBoxId: route?.voicemailBoxId ?? group.fallbackVoicemailBoxId,
          forwardToE164: route?.fallbackForwardE164 ?? group.fallbackForwardE164,
        },
      };
    }

    const ringGroupId = node.data.ringGroupId as string | undefined;
    const group = ringGroupId ? groupById.get(ringGroupId) : undefined;
    if (!group) return node;

    const menuKey = parseRingGroupMenuKey(group.extension) ?? (node.data.menuKey as number | undefined);
    const route =
      menuKey != null ? menuRoutes.find((r) => r.key === menuKey || r.ringGroupId === group.id) : undefined;

    return {
      ...node,
      data: {
        ...node.data,
        menuKey,
        ringGroupName: group.name,
        ringGroupExtension: group.extension,
        callerIdLabel: route?.callerIdLabel ?? group.name,
      },
    };
  });

  let edges = flow.edges;
  if (gather) {
    edges = flow.edges.map((edge) => {
      if (edge.source !== gather.id) return edge;
      const targetNode = nodes.find((n) => n.id === edge.target);
      if (targetNode?.type !== 'connect_group' || targetNode.data.isFallback) return edge;
      const group = groupById.get(targetNode.data.ringGroupId as string);
      if (!group?.extension.trim()) return edge;
      if (edge.label === 'ext' || edge.label === 'timeout' || edge.label === '0' || edge.label === '*') {
        return edge;
      }
      return { ...edge, label: group.extension.trim() };
    });
  }

  return { ...flow, nodes, edges };
}

export function isRingGroupReferencedInFlow(
  flow: CallFlowGraph | null | undefined,
  groupId: string,
): boolean {
  if (!flow) return false;
  return flow.nodes.some(
    (n) =>
      n.type === 'connect_group' &&
      !n.data.isFallback &&
      n.data.ringGroupId === groupId,
  );
}

export function isVoicemailBoxReferenced(
  voicemailBoxId: string,
  ringGroups: DemoRingGroup[],
  flows: Array<CallFlowGraph | null | undefined>,
): boolean {
  if (ringGroups.some((g) => g.fallbackVoicemailBoxId === voicemailBoxId)) return true;
  return flows.some(
    (flow) =>
      flow?.nodes.some(
        (n) => n.type === 'connect_group' && n.data.voicemailBoxId === voicemailBoxId,
      ) ?? false,
  );
}

export function buildStaffExtensionsFromLegacy(
  ringGroups: DemoRingGroup[],
  directDial: { id: string; userName: string; extension: string }[] = [],
): DemoStaffExtension[] {
  const seen = new Set<string>();
  const rows: DemoStaffExtension[] = [];

  for (const group of ringGroups) {
    for (const m of group.members) {
      const ext = m.extension.trim();
      if (!ext || seen.has(ext)) continue;
      seen.add(ext);
      rows.push({
        userId: m.userId || `legacy-${m.id}`,
        userName: m.userName,
        extension: ext,
      });
    }
  }

  for (const d of directDial) {
    const ext = d.extension.trim();
    if (!ext || seen.has(ext)) continue;
    seen.add(ext);
    rows.push({
      userId: d.id,
      userName: d.userName,
      extension: ext,
    });
  }

  return rows;
}
