import type { DataScopeLevel, InboundCall, Prisma } from '@prisma/client';
import prisma from '../config/database';
import { scopeAtLeast } from './accessContext';
import { getPhoneSystemBundle } from './phoneSystemService';

export type InboundInbox = 'mine' | 'ring_group' | 'all' | 'answered';

export class InboundAccessError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 403) {
    super(message);
    this.statusCode = statusCode;
  }
}

export interface UserRingGroup {
  id: string;
  name: string;
  voicemailBoxId: string | null;
  voicemailBoxName: string | null;
}

type RingGroupJson = {
  id: string;
  name: string;
  fallbackVoicemailBoxId?: string;
  members?: Array<{ userId: string }>;
};

type VoicemailBoxJson = { id: string; name: string };

export async function getUserRingGroups(
  subCompanyId: string,
  userId: string,
): Promise<UserRingGroup[]> {
  const bundle = await getPhoneSystemBundle(subCompanyId);
  if (!bundle) return [];

  const ringGroups = (bundle.ringGroups ?? []) as RingGroupJson[];
  const voicemailBoxes = (bundle.voicemailBoxes ?? []) as VoicemailBoxJson[];

  return ringGroups
    .filter((g) => g.members?.some((m) => m.userId === userId))
    .map((g) => {
      const vmId = g.fallbackVoicemailBoxId ?? null;
      const vm = vmId ? voicemailBoxes.find((v) => v.id === vmId) : undefined;
      return {
        id: g.id,
        name: g.name,
        voicemailBoxId: vmId,
        voicemailBoxName: vm?.name ?? null,
      };
    });
}

export function resolveDefaultInbox(scopeLevel: DataScopeLevel): InboundInbox {
  if (scopeAtLeast(scopeLevel, 'team')) return 'all';
  return 'mine';
}

export function buildInboundInboxWhere(params: {
  inbox: InboundInbox;
  userId: string;
  scopeLevel: DataScopeLevel;
  ringGroupId?: string;
  voicemailBoxId?: string;
  userRingGroups: UserRingGroup[];
}): Prisma.InboundCallWhereInput {
  const { inbox, userId, scopeLevel, ringGroupId, voicemailBoxId, userRingGroups } = params;

  if (inbox === 'all') {
    if (!scopeAtLeast(scopeLevel, 'team')) {
      throw new InboundAccessError('Agency-wide inbox requires elevated scope');
    }
    return {};
  }

  if (inbox === 'answered') {
    if (scopeAtLeast(scopeLevel, 'team')) {
      return { outcome: 'answered' };
    }
    return {
      answeredByUserId: userId,
      outcome: 'answered',
    };
  }

  if (inbox === 'mine') {
    const groupVoicemailBoxIds = userRingGroups
      .map((g) => g.voicemailBoxId)
      .filter((id): id is string => Boolean(id));

    return {
      ringGroupId: null,
      ...(groupVoicemailBoxIds.length > 0
        ? { NOT: { voicemailBoxId: { in: groupVoicemailBoxIds } } }
        : {}),
      OR: [
        { answeredByUserId: userId },
        { participants: { some: { userId } } },
      ],
    };
  }

  if (!ringGroupId && !voicemailBoxId) {
    throw new InboundAccessError('ringGroupId or voicemailBoxId required for ring_group inbox');
  }

  if (ringGroupId) {
    const group = userRingGroups.find((g) => g.id === ringGroupId);
    if (!group) {
      throw new InboundAccessError('Not a member of this ring group');
    }
    const orClauses: Prisma.InboundCallWhereInput[] = [{ ringGroupId }];
    if (group.voicemailBoxId) {
      orClauses.push({ voicemailBoxId: group.voicemailBoxId });
    }
    return orClauses.length === 1 ? orClauses[0]! : { OR: orClauses };
  }

  if (voicemailBoxId) {
    return { voicemailBoxId };
  }

  throw new InboundAccessError('Invalid ring_group inbox');
}

export async function assertInboundCallAccess(params: {
  call: Pick<
    InboundCall,
    'id' | 'answeredByUserId' | 'ringGroupId' | 'voicemailBoxId' | 'subCompanyId'
  >;
  userId: string;
  scopeLevel: DataScopeLevel;
  subCompanyId: string;
}): Promise<void> {
  const { call, userId, scopeLevel, subCompanyId } = params;

  if (call.subCompanyId !== subCompanyId) {
    throw new InboundAccessError('Access denied', 403);
  }

  if (scopeAtLeast(scopeLevel, 'team')) {
    return;
  }

  if (call.answeredByUserId === userId) return;

  const participants = await prisma.inboundCallParticipant.findMany({
    where: { inboundCallId: call.id },
    select: { userId: true },
  });
  if (participants.some((p) => p.userId === userId)) return;

  if (call.ringGroupId || call.voicemailBoxId) {
    const groups = await getUserRingGroups(subCompanyId, userId);
    if (call.ringGroupId && groups.some((g) => g.id === call.ringGroupId)) return;
    if (call.voicemailBoxId && groups.some((g) => g.voicemailBoxId === call.voicemailBoxId)) {
      return;
    }
  }

  throw new InboundAccessError('Access denied', 403);
}

/** Validate voicemailBoxId belongs to one of the user's ring groups. */
export async function assertVoicemailBoxAccess(
  subCompanyId: string,
  userId: string,
  voicemailBoxId: string,
): Promise<void> {
  const groups = await getUserRingGroups(subCompanyId, userId);
  if (groups.some((g) => g.voicemailBoxId === voicemailBoxId)) return;
  throw new InboundAccessError('Not a member of this ring group');
}
