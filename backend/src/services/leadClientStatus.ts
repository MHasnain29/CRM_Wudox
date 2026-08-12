import { ClientStatus, LeadStatus, Prisma } from '@prisma/client';
import prisma from '../config/database';

type PrismaClientLike = Prisma.TransactionClient | typeof prisma;

const MANUAL_TERMINAL_CLIENT_STATUSES = new Set<ClientStatus>([
  ClientStatus.ex,
  ClientStatus.unsubscribed,
  ClientStatus.permanently_closed,
]);

function leadAttemptTimestamp(lead: { closedAt?: Date | null; updatedAt: Date }): number {
  return (lead.closedAt ?? lead.updatedAt).getTime();
}

// Statuses that represent a live/working lead (not closed).
// 'active' is a legacy enum value never set by business logic, but we include
// it defensively so any stale row is treated the same as 'open'.
const OPEN_LEAD_STATUSES: LeadStatus[] = [LeadStatus.open, LeadStatus.active];

/** True for leads still in the associate acquisition pipeline (not closed / not pending client). */
export function isOpenOrActiveLeadStatus(status: LeadStatus): boolean {
  return OPEN_LEAD_STATUSES.includes(status);
}

/**
 * Canonical close-lost transition. Mirrors the inline logic in PATCH /leads/:id
 * so any caller (manual close, reassignment, future flows) produces the same
 * DB state + ClientSubCompany sync. Must run inside an outer transaction.
 */
export async function markLeadClosedLost(
  tx: Prisma.TransactionClient,
  params: {
    leadId: string;
    subCompanyId: string;
    closedById: string;
    lossReason: string;
  },
) {
  const updated = await tx.lead.update({
    where: { id: params.leadId },
    data: {
      status: LeadStatus.closed_lost,
      closedAt: new Date(),
      closedById: params.closedById,
      lossReason: params.lossReason,
    },
  });

  await syncClientStatusFromLeadOutcomes({
    tx,
    clientId: updated.clientId,
    subCompanyId: params.subCompanyId,
    touchLastActivityAt: new Date(),
  });

  return updated;
}

export async function findOpenLeadForClient(params: {
  tx?: PrismaClientLike;
  clientId: string;
  subCompanyId: string;
  excludeLeadId?: string;
}) {
  const tx = params.tx ?? prisma;
  return tx.lead.findFirst({
    where: {
      clientId: params.clientId,
      subCompanyId: params.subCompanyId,
      status: { in: OPEN_LEAD_STATUSES },
      ...(params.excludeLeadId ? { id: { not: params.excludeLeadId } } : {}),
    },
    select: { id: true, ownerId: true },
  });
}

/** Active tab clients: agency status `active` with a `closed_won` lead (activated customer). */
export function isClosedWonActiveClientFromView(params: {
  agencyStatus: ClientStatus | string | undefined;
  activeLeadStatus?: LeadStatus | string;
}): boolean {
  return (
    params.agencyStatus === ClientStatus.active &&
    params.activeLeadStatus === LeadStatus.closed_won
  );
}

export async function isClosedWonActiveClient(params: {
  clientId: string;
  subCompanyId: string;
  tx?: PrismaClientLike;
}): Promise<boolean> {
  const tx = params.tx ?? prisma;
  const [agencyView, wonLead] = await Promise.all([
    tx.clientSubCompany.findUnique({
      where: {
        clientId_subCompanyId: {
          clientId: params.clientId,
          subCompanyId: params.subCompanyId,
        },
      },
      select: { status: true },
    }),
    tx.lead.findFirst({
      where: {
        clientId: params.clientId,
        subCompanyId: params.subCompanyId,
        status: LeadStatus.closed_won,
      },
      select: { id: true },
    }),
  ]);
  return isClosedWonActiveClientFromView({
    agencyStatus: agencyView?.status,
    activeLeadStatus: wonLead ? LeadStatus.closed_won : undefined,
  });
}

export const CLOSED_WON_ACTIVE_UNSUBSCRIBE_ERROR =
  'Active Closed Won clients cannot be unsubscribed';

export async function assertClientUnsubscribeAllowed(params: {
  clientId: string;
  subCompanyId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await isClosedWonActiveClient(params)) {
    return { ok: false, error: CLOSED_WON_ACTIVE_UNSUBSCRIBE_ERROR };
  }
  return { ok: true };
}

export async function syncClientStatusFromLeadOutcomes(params: {
  tx?: PrismaClientLike;
  clientId: string;
  subCompanyId: string;
  touchLastActivityAt?: Date;
}): Promise<ClientStatus> {
  const tx = params.tx ?? prisma;
  const touchLastActivityAt = params.touchLastActivityAt ?? new Date();

  const [agencyView, leadAttempts] = await Promise.all([
    tx.clientSubCompany.findUnique({
      where: {
        clientId_subCompanyId: {
          clientId: params.clientId,
          subCompanyId: params.subCompanyId,
        },
      },
      select: {
        status: true,
      },
    }),
    tx.lead.findMany({
      where: {
        clientId: params.clientId,
        subCompanyId: params.subCompanyId,
      },
      select: {
        id: true,
        status: true,
        closedAt: true,
        updatedAt: true,
      },
    }),
  ]);

  if (agencyView && MANUAL_TERMINAL_CLIENT_STATUSES.has(agencyView.status)) {
    return agencyView.status;
  }

  // ClientStatus.active is set ONLY when the latest lead is closed_won (i.e. a
  // manager has run the activation flow). Open / closed_won_pending leads keep
  // the client at `contacted` — they represent in-progress work, not an
  // activated customer.
  let nextStatus: ClientStatus = ClientStatus.contacted;

  const latestAttempt = leadAttempts.reduce<typeof leadAttempts[number] | null>((latest, lead) => {
    if (!latest) return lead;
    return leadAttemptTimestamp(lead) > leadAttemptTimestamp(latest) ? lead : latest;
  }, null);

  if (latestAttempt?.status === LeadStatus.closed_lost) {
    nextStatus = ClientStatus.lost;
  } else if (latestAttempt?.status === LeadStatus.closed_won) {
    nextStatus = ClientStatus.active;
  }

  await tx.clientSubCompany.upsert({
    where: {
      clientId_subCompanyId: {
        clientId: params.clientId,
        subCompanyId: params.subCompanyId,
      },
    },
    create: {
      clientId: params.clientId,
      subCompanyId: params.subCompanyId,
      status: nextStatus,
      lastActivity: touchLastActivityAt,
    },
    update: {
      status: nextStatus,
      lastActivity: touchLastActivityAt,
    },
  });

  return nextStatus;
}
