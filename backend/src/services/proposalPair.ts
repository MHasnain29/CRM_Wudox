/**
 * Both (Temp + Direct) proposals are stored as two single-type Proposal rows
 * sharing proposalPairId. All pair orchestration lives here so Temp-only /
 * Direct-only paths stay on the existing single-row handlers.
 */
import prisma from '../config/database';

export type PairRole = 'temp' | 'direct';

export type PairMember = {
  id: string;
  leadId: string;
  status: string;
  agreementTypes: string[];
  pairRole: string | null;
  proposalPairId: string | null;
  isForReview: boolean;
  pandaDocId: string | null;
  pandaDocStatus: string | null;
  pandaDocTemplateId: string | null;
  reviewTemplateId: string | null;
  reviewEmailSentAt: Date | null;
  activatedAt: Date | null;
  reviewRequestedAt: Date | null;
  awaitingClientDueAt: Date | null;
};

export type ProposalPair = {
  pairId: string;
  members: [PairMember, PairMember];
  /** Canonical = temp sibling when present, else first member. */
  canonical: PairMember;
  siblingOf: (proposalId: string) => PairMember | null;
};

const PAIR_SELECT = {
  id: true,
  leadId: true,
  status: true,
  agreementTypes: true,
  pairRole: true,
  proposalPairId: true,
  isForReview: true,
  pandaDocId: true,
  pandaDocStatus: true,
  pandaDocTemplateId: true,
  reviewTemplateId: true,
  reviewEmailSentAt: true,
  activatedAt: true,
  reviewRequestedAt: true,
  awaitingClientDueAt: true,
} as const;

function sortMembers(rows: PairMember[]): [PairMember, PairMember] {
  const temp = rows.find((r) => r.pairRole === 'temp' || r.agreementTypes.includes('temp'));
  const direct = rows.find(
    (r) => r.pairRole === 'direct' || r.agreementTypes.some((t) => t.startsWith('direct')),
  );
  if (temp && direct && temp.id !== direct.id) return [temp, direct];
  return [rows[0], rows[1]];
}

export function isBothAgreementTypes(types: unknown): boolean {
  if (!Array.isArray(types)) return false;
  const hasTemp = types.includes('temp');
  const hasDirect = types.some((t: string) => typeof t === 'string' && t.startsWith('direct'));
  return hasTemp && hasDirect;
}

export async function loadPairByProposalId(proposalId: string): Promise<ProposalPair | null> {
  const self = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: PAIR_SELECT,
  });
  if (!self?.proposalPairId) return null;

  const rows = await prisma.proposal.findMany({
    where: { proposalPairId: self.proposalPairId },
    select: PAIR_SELECT,
    orderBy: { createdAt: 'asc' },
  });
  if (rows.length < 2) return null;

  const members = sortMembers(rows as PairMember[]);
  const canonical = members[0];
  return {
    pairId: self.proposalPairId,
    members,
    canonical,
    siblingOf: (id) => members.find((m) => m.id !== id) ?? null,
  };
}

export async function loadPairByPairId(pairId: string): Promise<ProposalPair | null> {
  const rows = await prisma.proposal.findMany({
    where: { proposalPairId: pairId },
    select: PAIR_SELECT,
    orderBy: { createdAt: 'asc' },
  });
  if (rows.length < 2) return null;
  const members = sortMembers(rows as PairMember[]);
  return {
    pairId,
    members,
    canonical: members[0],
    siblingOf: (id) => members.find((m) => m.id !== id) ?? null,
  };
}

/**
 * Both pairs use a single approval chain on the canonical (temp) sibling.
 * Always authorize against that id so forward/approve/reject cannot diverge.
 */
export async function resolvePairAuthEntityId(proposalId: string): Promise<{
  authEntityId: string;
  pair: ProposalPair | null;
}> {
  const pair = await loadPairByProposalId(proposalId);
  if (!pair) return { authEntityId: proposalId, pair: null };
  return { authEntityId: pair.canonical.id, pair };
}

/** True if either sibling is signed (PandaDoc completed) or has manual review unlock. */
export function isPairReadyForActivation(pair: ProposalPair): boolean {
  return pair.members.some(
    (m) => m.pandaDocStatus === 'document.completed' || m.reviewRequestedAt != null,
  );
}

export function pairMemberLabel(member: PairMember): string {
  if (member.pairRole === 'direct' || member.agreementTypes.some((t) => t.startsWith('direct'))) {
    return 'Direct Placement';
  }
  return 'Temporary Staffing';
}

export function reviewEmailDocumentLabel(member: PairMember): string {
  if (member.pairRole === 'direct' || member.agreementTypes.some((t) => t.startsWith('direct'))) {
    return 'Direct Placement Agreement for Review';
  }
  return 'Temporary Staffing Agreement for Review';
}

/**
 * Move lead to awaiting_client_approval / closed_won_pending only when not
 * already pending activation or fully won. Never demotes closed_won.
 */
export async function moveLeadAwaitingIfNeeded(leadId: string): Promise<boolean> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, status: true, stage: true },
  });
  if (!lead) return false;
  if (lead.status === 'closed_won' || lead.status === 'closed_won_pending') return false;

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      stage: 'awaiting_client_approval',
      status: 'closed_won_pending',
      updatedAt: new Date(),
    },
  });
  return true;
}

export async function markPairStatus(
  pair: ProposalPair,
  data: {
    status?: 'pending' | 'approved' | 'rejected';
    reviewedById?: string | null;
    reviewedAt?: Date | null;
    rejectionComment?: string | null;
    reviewEmailSentAt?: Date | null;
    activatedAt?: Date | null;
    activatedById?: string | null;
    awaitingClientDueAt?: Date | null;
  },
  opts?: { onlyCanonicalAwaitingTimer?: boolean },
): Promise<void> {
  const { onlyCanonicalAwaitingTimer = true } = opts ?? {};
  await prisma.$transaction(
    pair.members.map((m) => {
      const isCanonical = m.id === pair.canonical.id;
      const rowData: Record<string, unknown> = { ...data };
      if (onlyCanonicalAwaitingTimer && data.awaitingClientDueAt !== undefined && !isCanonical) {
        delete rowData.awaitingClientDueAt;
      }
      return prisma.proposal.update({
        where: { id: m.id },
        data: rowData,
      });
    }),
  );
}

/** Serialize pair siblings onto list/detail API responses. */
export function serializePairSummary(pair: ProposalPair | null) {
  if (!pair) return null;
  return {
    pairId: pair.pairId,
    members: pair.members.map((m) => ({
      id: m.id,
      pairRole: m.pairRole,
      agreementTypes: m.agreementTypes,
      status: m.status,
      pandaDocStatus: m.pandaDocStatus,
      pandaDocId: m.pandaDocId,
      reviewEmailSentAt: m.reviewEmailSentAt,
      activatedAt: m.activatedAt,
      label: pairMemberLabel(m),
    })),
  };
}

/**
 * Collapse a flat proposal list so each Both pair appears once (canonical row),
 * with `pair` / `sibling` attached for the UI.
 */
export function collapsePairedProposals<T extends { id: string; proposalPairId?: string | null }>(
  proposals: T[],
  pairById: Map<string, ProposalPair>,
): Array<T & { pair?: ReturnType<typeof serializePairSummary>; siblingId?: string | null }> {
  const seenPairs = new Set<string>();
  const out: Array<T & { pair?: ReturnType<typeof serializePairSummary>; siblingId?: string | null }> = [];

  for (const p of proposals) {
    const pairId = p.proposalPairId ?? null;
    if (!pairId) {
      out.push({ ...p, pair: null, siblingId: null });
      continue;
    }
    if (seenPairs.has(pairId)) continue;
    seenPairs.add(pairId);
    const pair = pairById.get(pairId) ?? null;
    const canonical = pair?.canonical;
    const row = canonical ? proposals.find((x) => x.id === canonical.id) ?? p : p;
    const sibling = pair?.siblingOf(row.id) ?? null;
    out.push({
      ...row,
      pair: serializePairSummary(pair),
      siblingId: sibling?.id ?? null,
    });
  }
  return out;
}
