import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { createActivityLog } from './activityLog';

type PrismaClientLike = Prisma.TransactionClient | typeof prisma;

export type OwnershipType = 'management' | 'associate';
export type OwnershipChangeSource = 'manual' | 'auto_closed_won' | 'offboarding';
export type OwnershipSkipReason = 'no_winning_proposal' | 'creator_inactive' | 'creator_missing';

interface UserNameRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

function formatUserName(user: UserNameRow | null | undefined): string {
  if (!user) return 'Unknown user';
  const composed = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return composed || user.email || 'Unknown user';
}

async function fetchUserName(
  db: PrismaClientLike,
  userId: string | null | undefined,
): Promise<string | null> {
  if (!userId) return null;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true },
  });
  if (!user) return null;
  return formatUserName({ id: userId, ...user });
}

interface OwnershipPrevious {
  type: OwnershipType | null;
  userId: string | null;
}

interface OwnershipNext {
  type: OwnershipType;
  userId: string | null;
}

interface ApplyOwnershipChangeParams {
  tx: PrismaClientLike;
  clientId: string;
  subCompanyId: string;
  actorId: string;
  actorName: string;
  previous: OwnershipPrevious;
  next: OwnershipNext;
  source: OwnershipChangeSource;
  triggeringLeadId?: string;
  triggeringProposalId?: string;
}

/**
 * Update Client ownership fields and write an `ownership_changed` activity log
 * entry inside the caller's transaction. No-op when the new state matches the
 * previous state so duplicate writes do not flood the timeline.
 */
export async function applyOwnershipChange(params: ApplyOwnershipChangeParams): Promise<void> {
  const {
    tx,
    clientId,
    subCompanyId,
    actorId,
    actorName,
    previous,
    next,
    source,
    triggeringLeadId,
    triggeringProposalId,
  } = params;

  const nextUserId = next.type === 'associate' ? (next.userId ?? null) : null;
  const isNoop = previous.type === next.type && (previous.userId ?? null) === nextUserId;
  if (isNoop) return;

  await tx.client.update({
    where: { id: clientId },
    data: {
      ownershipType: next.type,
      ownershipUserId: nextUserId,
    },
  });

  const [previousName, newName] = await Promise.all([
    fetchUserName(tx, previous.userId),
    fetchUserName(tx, nextUserId),
  ]);

  const prevLabel =
    previous.type == null
      ? 'Unset'
      : previous.type === 'management'
        ? 'Management'
        : (previousName ?? 'Associate');
  const nextLabel =
    next.type === 'management' ? 'Management' : (newName ?? 'Associate');

  const description =
    source === 'auto_closed_won'
      ? `Ownership auto-assigned to ${nextLabel} (Closed Won)`
      : source === 'offboarding'
        ? `Ownership returned to Management (employee offboarded from ${prevLabel})`
        : `Ownership changed: ${prevLabel} → ${nextLabel}`;

  await createActivityLog({
    userId: actorId,
    userName: actorName,
    subCompanyId,
    type: 'ownership_changed',
    description,
    metadata: {
      clientId,
      source,
      previousType: previous.type ?? null,
      previousUserId: previous.userId ?? null,
      previousName: previousName ?? null,
      newType: next.type,
      newUserId: nextUserId,
      newName: newName ?? null,
      ...(triggeringLeadId ? { triggeringLeadId } : {}),
      ...(triggeringProposalId ? { triggeringProposalId } : {}),
    },
  });
}

interface AutoAssignParams {
  tx: PrismaClientLike;
  clientId: string;
  leadId: string;
  subCompanyId: string;
  actorId: string;
  actorName: string;
  /** When the close-won is triggered from a specific proposal, pass it to skip lookup. */
  proposalId?: string;
}

/**
 * Auto-assign client ownership to the associate who created the winning
 * proposal when a lead transitions to closed_won. Guards:
 *  - Skip when ownership is already set (director's choice always wins).
 *  - Skip when no approved/accepted proposal exists for the lead.
 *  - Skip when the proposal's creator is missing or deactivated.
 * All skips are recorded as `ownership_auto_skipped` activity log entries.
 * Caller is responsible for running this inside the same transaction that
 * flipped the lead to closed_won.
 */
export async function autoAssignOwnershipForClosedWon(params: AutoAssignParams): Promise<void> {
  const { tx, clientId, leadId, subCompanyId, actorId, actorName, proposalId } = params;

  const client = await tx.client.findUnique({
    where: { id: clientId },
    select: { id: true, ownershipType: true, ownershipUserId: true },
  });
  if (!client) return;

  // Director's prior choice (any non-null ownershipType) always wins.
  if (client.ownershipType) return;

  const proposal = proposalId
    ? await tx.proposal.findUnique({
        where: { id: proposalId },
        select: { id: true, createdById: true, leadId: true, status: true },
      })
    : await tx.proposal.findFirst({
        where: {
          leadId,
          status: 'approved',
        },
        orderBy: [
          { activatedAt: 'desc' },
          { reviewedAt: 'desc' },
          { createdAt: 'desc' },
        ],
        select: { id: true, createdById: true, leadId: true, status: true },
      });

  if (!proposal || !proposal.createdById) {
    await createActivityLog({
      userId: actorId,
      userName: actorName,
      subCompanyId,
      type: 'ownership_auto_skipped',
      description: 'Ownership auto-assignment skipped: no winning proposal on close-won',
      metadata: {
        clientId,
        triggeringLeadId: leadId,
        reason: 'no_winning_proposal' satisfies OwnershipSkipReason,
      },
    });
    return;
  }

  const creator = await tx.user.findUnique({
    where: { id: proposal.createdById },
    select: { id: true, isActive: true, firstName: true, lastName: true, email: true },
  });
  if (!creator) {
    await createActivityLog({
      userId: actorId,
      userName: actorName,
      subCompanyId,
      type: 'ownership_auto_skipped',
      description: 'Ownership auto-assignment skipped: proposal creator missing',
      metadata: {
        clientId,
        triggeringLeadId: leadId,
        triggeringProposalId: proposal.id,
        reason: 'creator_missing' satisfies OwnershipSkipReason,
      },
    });
    return;
  }
  if (!creator.isActive) {
    await createActivityLog({
      userId: actorId,
      userName: actorName,
      subCompanyId,
      type: 'ownership_auto_skipped',
      description: `Ownership auto-assignment skipped: ${formatUserName(creator)} is inactive`,
      metadata: {
        clientId,
        triggeringLeadId: leadId,
        triggeringProposalId: proposal.id,
        reason: 'creator_inactive' satisfies OwnershipSkipReason,
      },
    });
    return;
  }

  await applyOwnershipChange({
    tx,
    clientId,
    subCompanyId,
    actorId,
    actorName,
    previous: { type: null, userId: null },
    next: { type: 'associate', userId: creator.id },
    source: 'auto_closed_won',
    triggeringLeadId: leadId,
    triggeringProposalId: proposal.id,
  });
}
