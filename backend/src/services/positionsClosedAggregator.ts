import prisma from '../config/database';

/**
 * Sum of ProposalPosition.count across all activated proposals on closed_won leads
 * for a single client in a single agency.
 */
export async function getPositionsClosedForClient(
  clientId: string,
  subCompanyId: string,
): Promise<number> {
  const leads = await prisma.lead.findMany({
    where: { clientId, subCompanyId, status: 'closed_won' },
    select: {
      proposals: {
        where: { status: 'approved', activatedAt: { not: null } },
        select: { positions: { select: { count: true } } },
      },
    },
  });
  return leads
    .flatMap((l) => l.proposals)
    .flatMap((p) => p.positions)
    .reduce((sum, pos) => sum + pos.count, 0);
}

/**
 * Bulk variant: returns a map of ownerId → total positions closed
 * for all closed_won leads in the given agencies within the date range (Lead.closedAt).
 */
export async function getPositionsClosedByUserBulk(filters: {
  subCompanyIds: string[];
  from?: Date;
  to?: Date;
}): Promise<Record<string, number>> {
  const { subCompanyIds, from, to } = filters;
  if (!subCompanyIds.length) return {};

  const leads = await prisma.lead.findMany({
    where: {
      status: 'closed_won',
      subCompanyId: { in: subCompanyIds },
      ...(from || to
        ? { closedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
    select: {
      ownerId: true,
      proposals: {
        where: { status: 'approved', activatedAt: { not: null } },
        select: { positions: { select: { count: true } } },
      },
    },
  });

  const result: Record<string, number> = {};
  for (const lead of leads) {
    const posCount = lead.proposals
      .flatMap((p) => p.positions)
      .reduce((s, pos) => s + pos.count, 0);
    result[lead.ownerId] = (result[lead.ownerId] ?? 0) + posCount;
  }
  return result;
}
