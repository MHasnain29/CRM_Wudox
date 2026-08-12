import { ClientStatus, LeadStatus } from '@prisma/client';
import { isOwnScopeRole } from '../config/permissions';

/** Open pipeline statuses — another associate's lead blocks peers from this client. */
export const BUSY_LEAD_STATUSES: LeadStatus[] = [LeadStatus.open, LeadStatus.active];

export type ActiveLeadSnapshot = {
  ownerId: string;
  status: LeadStatus;
};

export function isOpenLeadHeldByOtherAssociate(
  activeLead: ActiveLeadSnapshot | undefined,
  viewerUserId: string,
): boolean {
  if (!activeLead) return false;
  return BUSY_LEAD_STATUSES.includes(activeLead.status) && activeLead.ownerId !== viewerUserId;
}

/**
 * Client is converted (status=active) but the only active lead is a closed_won
 * owned by someone else. Mutually exclusive with the open-pipeline case — if any
 * open/active lead exists, that path handles ownership and this one stays off.
 */
export function isWonClientHeldByOtherAssociate(
  activeLead: ActiveLeadSnapshot | undefined,
  clientStatus: ClientStatus | string | undefined,
  viewerUserId: string,
): boolean {
  if (clientStatus !== ClientStatus.active) return false;
  if (!activeLead) return false;
  if (activeLead.status !== LeadStatus.closed_won) return false;
  return activeLead.ownerId !== viewerUserId;
}

/** Either open-pipeline or won-active lead owned by another user — associate should not see this client. */
export function isClientHeldByOtherAssociate(
  activeLead: ActiveLeadSnapshot | undefined,
  clientStatus: ClientStatus | string | undefined,
  viewerUserId: string,
): boolean {
  return (
    isOpenLeadHeldByOtherAssociate(activeLead, viewerUserId) ||
    isWonClientHeldByOtherAssociate(activeLead, clientStatus, viewerUserId)
  );
}

/** Read-only guard: own-scope users must not open another associate's in-flight or won client. */
export async function associateBlockedFromClientDetail(
  role: string | undefined,
  viewerUserId: string | undefined,
  activeLead: ActiveLeadSnapshot | undefined,
  clientStatus?: ClientStatus | string,
): Promise<boolean> {
  if (!viewerUserId || !(await isOwnScopeRole(role))) return false;
  return isClientHeldByOtherAssociate(activeLead, clientStatus, viewerUserId);
}

/**
 * Mask cross-associate pipeline fields on list/detail payloads.
 * Does not mutate DB — response shaping only.
 *
 * `allowedOwnerIds` — additional user IDs (e.g. linked accounts) whose clients
 * must NOT be redacted even though they differ from `viewerUserId`.
 */
export function redactClientForAssociateViewer<T extends Record<string, unknown>>(
  row: T,
  viewerUserId: string,
  allowedOwnerIds: string[] = [],
): T {
  const ownerId = row.activeLeadOwnerId as string | undefined;
  const clientStatus = row.status as string | undefined;
  const hasOpenLead = Boolean(row.hasOpenLead);
  const isAllowedOwner = !!ownerId && (ownerId === viewerUserId || allowedOwnerIds.includes(ownerId));
  const hasOthersOpenLead = hasOpenLead && !!ownerId && !isAllowedOwner;
  // Won-active path is gated by !hasOpenLead so it can never overlap with the
  // open-pipeline trigger above. When hasOpenLead=false and activeLeadOwnerId
  // is set, the corresponding lead is necessarily closed_won.
  const hasOthersWonActive =
    !hasOpenLead
    && clientStatus === ClientStatus.active
    && !!ownerId
    && !isAllowedOwner;
  const hideForOtherOwner = hasOthersOpenLead || hasOthersWonActive;
  const lostById = row.latestLostById as string | undefined;
  const hideLostByOther = !!lostById && lostById !== viewerUserId && !allowedOwnerIds.includes(lostById);

  if (!hideForOtherOwner && !hideLostByOther) return row;

  return {
    ...row,
    ...(hideForOtherOwner
      ? {
          heldByOtherAssociate: true,
          name: 'Unavailable',
          industry: null,
          location: null,
          address: null,
          companySize: null,
          tags: [],
          contacts: [],
          activeLeadId: undefined,
          activeLeadOwnerId: undefined,
          activeLeadOwnerName: undefined,
          assignedOwnerId: undefined,
          assignedOwnerName: undefined,
        }
      : {}),
    ...(hideLostByOther
      ? {
          latestLostLeadId: undefined,
          latestLostById: undefined,
          latestLostByName: undefined,
          latestLostAt: undefined,
          latestLossReason: undefined,
        }
      : {}),
    ...((hideForOtherOwner || hideLostByOther)
      ? { latestOutreachByName: undefined, contactedByName: undefined }
      : {}),
  };
}
