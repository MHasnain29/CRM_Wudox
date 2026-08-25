import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ClientStatus, EmailFolder, LeadStatus } from '@prisma/client';
import prisma from '../config/database';
import type { Prisma } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { actAsMiddleware, effectiveActorId } from '../middleware/actAs';
import { requirePermission } from '../middleware/requirePermission';
import { env } from '../config/env';
import { getRedis, isRedisEnabled } from '../config/redis';
import { createActivityLog } from '../services/activityLog';
import { applyOwnershipChange } from '../services/clientOwnership';
import {
  invalidateClientListCache,
  invalidateClientListCacheForMainOrg,
} from '../services/clientListCache';
import { sendClientCreatedEmail, sendUnsubscribeEmail, sendPermanentlyClosedEmail, getAgencyBranding } from '../services/email';
import { dispatchNotification, dispatchNotificationToUser } from '../services/notificationDispatch';
import { getRoleLabel } from '../config/permissions';
import {
  isOwnScopeLevel,
  resolveClientLeadVisibleOwnerIdsFromScope,
  resolveContactedScopeUserIdsFromScope,
  resolveScopeLevelForRole,
} from '../services/listOwnerScope';
import { canViewAllDataInAgency, canViewTeamData, canAccessMultipleAgencies } from '../services/accessContext';
import { expandLinkedOwnerScope, ownerExactFromQuery } from '../services/linkedOwnerExpand';
import { getDataScopeLevelForRoleKey } from '../services/rbac';
import { ensureAccessContext } from '../utils/requestPermission';
import { requestHasAnyPermission, requestHasPermission } from '../utils/requestPermission';
import { resolveAllowedSubCompanyIds, parseAgencyIdsParam, parseSubCompanyIdQuery, resolveAgencyScope, resolveClientListAgencyIds, assertMultiAgencyWriteTarget } from '../config/agencyScope';
import { clientManualChangeBypassesApproval, clientManualCreateBypassesApproval, isDatabaseManagerRole, isSuperUserScreenRole } from '../config/clientCreateApproval';
import {
  createClientSchema,
  performManualClientCreate,
} from '../services/clientManualCreate';
import {
  buildPendingEditPayload,
  mapDbContactsToUpdateBody,
  performManualClientUpdate,
  queueOrApplyClientContactChange,
  updateClientSchema,
} from '../services/clientPendingEdit';
import {
  defaultLockDays,
  describeClientVisibilityOutcome,
  resolveClientVisibility,
} from '../services/clientVisibilityPolicy';
import { emitToUsers } from '../socket';
import {
  BUSY_LEAD_STATUSES,
  redactClientForAssociateViewer,
} from '../services/associateClientVisibility';
import type { ActiveLeadSnapshot } from '../services/associateClientVisibility';
import {
  assertClientUnsubscribeAllowed,
  isClosedWonActiveClientFromView,
} from '../services/leadClientStatus';
import {
  bulkApprovePendingImportsAsNew,
  bulkRejectPendingImports,
} from '../services/pendingImportApproval';
import { notifyImportUploadersOfApproval } from '../services/pendingImportApprovalNotify';
import {
  bulkApprovePendingContactImports,
  bulkRejectPendingContactImports,
  approvePendingContactImport,
} from '../services/pendingContactImportApproval';
import {
  checkContactImportConflicts,
  ContactImportConflictError,
  resolveContactImportRows,
  type ContactImportRowPayload,
} from '../services/contactImportConflictCheck';
import { getPositionsClosedForClient } from '../services/positionsClosedAggregator';
import {
  getRestrictedUserIds,
  isUserRestrictedFromClient,
  setUserClientRestriction,
} from '../services/clientRestrictions';
import { getClientApproverUserIds } from '../services/accessContext';
import {
  authorizeApprovalAction,
  notifyChainTargetUsers,
  notifyPendingImportBatchApproval,
  performApprovalAction,
  submitEntityForApproval,
} from '../services/approvalActions';
import { GLOBAL_APPROVAL_SCOPE } from '../types/approval';
import {
  getAgencyApprovalPolicy,
  getDatabaseManagerDestinationMode,
  getOrgApprovalPolicy,
  getSuperUserDestinationMode,
  resolveClientDestinationMode,
} from '../services/approvalPolicy';
import {
  processDestinationAwarePendingImports,
  resolveDestinationManualCreate,
} from '../services/clientDestinationCreate';
import {
  checkImportConflicts,
  assertImportHasNoConflicts,
  ImportConflictError,
} from '../services/clientImportConflictCheck';
import {
  isGlobalCreatorRole,
  resolveClientDetailScope,
  notesForClientDetail,
  tagsForClientDetail,
  callsForClientDetail,
  followUpsForClientDetail,
  meetingsForClientDetail,
  activityLogsForClientDetail,
  leadHistoryWhereForClient,
} from '../services/clientAgencyAccess';

const CLIENT_LIST_CACHE_TTL_SEC = 45;

async function refreshClientListCaches(subCompanyId: string, visibility: 'global' | 'agency'): Promise<void> {
  if (visibility === 'global') {
    await invalidateClientListCacheForMainOrg(subCompanyId);
  } else {
    await invalidateClientListCache(subCompanyId);
  }
}

/** Notify all active users in the org to refetch clients (global creates). */
async function emitClientRefreshForMainOrg(originSubCompanyId: string): Promise<void> {
  const own = await prisma.subCompany.findUnique({
    where: { id: originSubCompanyId },
    select: { mainOrgId: true },
  });
  if (!own?.mainOrgId) return;
  const users = await prisma.user.findMany({
    where: { isActive: true, subCompany: { mainOrgId: own.mainOrgId } },
    select: { id: true },
  });
  if (users.length === 0) return;
  emitToUsers(users.map((u) => u.id), 'client:refresh', { subCompanyId: originSubCompanyId });
}

async function afterClientVisibilityChange(
  subCompanyId: string,
  visibility: 'global' | 'agency',
): Promise<void> {
  await refreshClientListCaches(subCompanyId, visibility);
  if (visibility === 'global') {
    await emitClientRefreshForMainOrg(subCompanyId);
  }
}
const SORT_FIELDS = ['name', 'industry', 'location', 'lastActivity', 'updatedAt', 'createdAt', 'serialNumber'] as const;

function mergeWhere(base: Prisma.ClientWhereInput, clause: Prisma.ClientWhereInput): Prisma.ClientWhereInput {
  return Object.keys(base).length ? { AND: [base, clause] } : clause;
}

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(1000).default(20),
  status: z.nativeEnum(ClientStatus).optional(),
  assignedScope: z.enum(['mine', 'team']).optional(),
  lostScope: z.enum(['mine', 'team']).optional(),
  contactedByMe: z.enum(['true', 'false']).optional(),
  contactedScope: z.enum(['mine', 'team']).optional(),
  search: z.string().optional(),
  corporateCode: z.string().optional(),
  subCompanyId: z.string().uuid().optional(),
  agencyIds: z.string().optional(),
  ownerIds: z.string().optional(), // multi-user filter: filter clients with leads owned by these users
  linkedAgencyId: z.string().uuid().optional(), // linked-user agency scope (validated against link group)
  industry: z.string().optional(),
  location: z.string().optional(),
  companySize: z.string().optional(),
  tags: z.string().optional(),
  hasLead: z.enum(['true', 'false']).optional(),
  ownershipType: z.enum(['management', 'associate']).optional(),
  sortBy: z.enum(SORT_FIELDS).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  globalDb: z.enum(['true']).optional(),
});

type ClientListCacheQuery = {
  page: number;
  limit: number;
  status?: string;
  assignedScope?: string;
  lostScope?: string;
  contactedByMe?: string;
  contactedScope?: string;
  search?: string;
  industry?: string;
  location?: string;
  companySize?: string;
  tags?: string;
  hasLead?: string;
  sortBy?: string;
  sortOrder?: string;
  globalDb?: string;
};

type ClientListRelationRow = {
  status: ClientStatus;
  tags: Array<{ tag: string }>;
  clientSubCompanies?: Array<{ status: ClientStatus }>;
  leads?: Array<{
    ownerId: string;
    owner?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
  }>;
  calls?: Array<{
    id: string;
    timestamp?: Date | string;
    owner?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
  }>;
  emails?: Array<{
    id: string;
    timestamp?: Date | string;
    fromName?: string | null;
    fromUser?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
  }>;
};

export const clientRouter = Router();
clientRouter.use(authenticate);
clientRouter.use(actAsMiddleware);
clientRouter.use(requirePermission('clients:read'));

/** Returns a Prisma-compatible value for subCompanyId filter (single string or { in: [...] }). */
function toSubFilter(ids: string[]): string | { in: string[] } {
  return ids.length === 1 ? ids[0] : { in: ids };
}

/** Resolve agency-scoped status: from ClientSubCompany for this agency, or fallback to Client.status */
function statusWhere(subCompanyIds: string[], status: ClientStatus): Prisma.ClientWhereInput {
  const subFilter = toSubFilter(subCompanyIds);
  return {
    OR: [
      { clientSubCompanies: { some: { subCompanyId: subFilter, status } } },
      { status, clientSubCompanies: { none: { subCompanyId: subFilter } } },
    ],
  };
}

/** Cross-agency delay: visible when global or agency-scoped for the requester's agency context (all roles). */
function visibilityWhere(subCompanyIds: string[]): Prisma.ClientWhereInput {
  const subFilter = toSubFilter(subCompanyIds);
  return {
    OR: [
      { visibility: 'global' },
      { visibility: 'agency', clientSubCompanies: { some: { subCompanyId: subFilter } } },
    ],
  };
}

async function isViewerAssociateScope(role: string | undefined): Promise<boolean> {
  return isOwnScopeLevel(await resolveScopeLevelForRole(role));
}

async function resolveClientLeadVisibleOwnerIds(params: {
  role: string | undefined;
  viewerUserId?: string;
  subCompanyId: string;
}): Promise<Set<string> | null> {
  const scopeLevel = await resolveScopeLevelForRole(params.role);
  return resolveClientLeadVisibleOwnerIdsFromScope({
    scopeLevel,
    viewerUserId: params.viewerUserId,
    subCompanyId: params.subCompanyId,
  });
}

function clientLeadVisibleToOwnerScope(
  activeLead: ActiveLeadSnapshot | undefined,
  clientStatus: ClientStatus | string | undefined,
  visibleOwnerIds: Set<string> | null,
): boolean {
  if (!visibleOwnerIds || !activeLead) return true;
  const leadLocksClient =
    BUSY_LEAD_STATUSES.includes(activeLead.status) ||
    (clientStatus === ClientStatus.active && activeLead.status === LeadStatus.closed_won);
  return !leadLocksClient || visibleOwnerIds.has(activeLead.ownerId);
}

function redactClientForHiddenLeadOwner<T extends Record<string, unknown>>(
  row: T,
  activeLead: ActiveLeadSnapshot | undefined,
  visibleOwnerIds: Set<string> | null,
): T {
  if (clientLeadVisibleToOwnerScope(activeLead, row.status as string | undefined, visibleOwnerIds)) return row;

  return {
    ...row,
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
    latestOutreachByName: undefined,
    contactedByName: undefined,
  };
}

async function clientLeadHiddenFromViewer(params: {
  role: string | undefined;
  viewerUserId?: string;
  subCompanyId: string;
  activeLead: ActiveLeadSnapshot | undefined;
  clientStatus: ClientStatus | string | undefined;
}): Promise<boolean> {
  const visibleOwnerIds = await resolveClientLeadVisibleOwnerIds(params);
  return !clientLeadVisibleToOwnerScope(params.activeLead, params.clientStatus, visibleOwnerIds);
}

async function assertClientVisibleToRequester(params: {
  clientIdOrCorporateCode: string;
  subCompanyId: string;
  role: string | undefined;
  viewerUserId?: string;
  /** Skip the lead-lock visibility check (for write operations where the lock is a read-privacy fence). */
  skipLeadLock?: boolean;
}): Promise<{ id: string; name: string; status: ClientStatus; agencyStatus?: ClientStatus } | null> {
  const clause = visibilityWhere([params.subCompanyId]);
  const client = await prisma.client.findFirst({
    where: {
      AND: [
        clause,
        {
          OR: [
            { id: params.clientIdOrCorporateCode },
            { corporateCode: { equals: params.clientIdOrCorporateCode, mode: 'insensitive' } },
          ],
        },
      ],
    },
    select: {
      id: true,
      name: true,
      status: true,
      clientSubCompanies: {
        where: { subCompanyId: params.subCompanyId },
        select: { status: true },
        take: 1,
      },
    },
  });
  if (!client) return null;
  const scopeLevel = await resolveScopeLevelForRole(params.role);
  if (
    params.viewerUserId &&
    isOwnScopeLevel(scopeLevel) &&
    (await isUserRestrictedFromClient(client.id, params.viewerUserId))
  ) {
    return null;
  }
  const effectiveStatus = client.clientSubCompanies[0]?.status ?? client.status;
  const leadSummaries = await getLeadSummariesForClients([params.subCompanyId], [client.id]);
  const activeLead = leadSummaries.activeLeadByClientId.get(client.id);
  if (
    !params.skipLeadLock &&
    (await clientLeadHiddenFromViewer({
      role: params.role,
      viewerUserId: params.viewerUserId,
      subCompanyId: params.subCompanyId,
      activeLead: activeLead ? { ownerId: activeLead.ownerId, status: activeLead.status } : undefined,
      clientStatus: effectiveStatus,
    }))
  ) {
    return null;
  }
  return {
    id: client.id,
    name: client.name,
    status: client.status,
    agencyStatus: effectiveStatus,
  };
}

/** Resolve which agency's client data to show (JWT agency or ?subCompanyId= view-as). */
async function getEffectiveSubCompanyId(req: Request): Promise<string | null> {
  return resolveAgencyScope(req);
}

/** Pending add/edit/import queues — managers (recommend) or final approvers (custom roles via RBAC). */
async function assertPendingQueueAccess(req: Request, res: Response): Promise<boolean> {
  const allowed = await requestHasAnyPermission(req, ['clients:approve', 'clients:manager_recommend']);
  if (!allowed) {
    res.status(403).json({
      error: 'Forbidden — pending client queue requires clients:approve or clients:manager_recommend',
    });
    return false;
  }
  return true;
}

async function resolvePendingSubmissionApprovalContext(pendingId: string): Promise<{
  subCompanyId: string;
  workflow: 'client_manual_add' | 'database_client_add';
} | null> {
  const row = await prisma.pendingClientSubmission.findUnique({ where: { id: pendingId } });
  if (!row) return null;
  if (row.submissionSource === 'global_database') {
    return { subCompanyId: GLOBAL_APPROVAL_SCOPE, workflow: 'database_client_add' };
  }
  if (!row.subCompanyId) return null;
  return { subCompanyId: row.subCompanyId, workflow: 'client_manual_add' };
}

export function buildListCacheKey(subCompanyId: string, userId: string, q: ClientListCacheQuery & { ownershipType?: string }, agencyIdsKey = '', ownerIdsKey = ''): string {
  const parts = ['clients', subCompanyId, userId, agencyIdsKey, ownerIdsKey, q.page, q.limit, q.status ?? '', q.assignedScope ?? '', q.lostScope ?? '', q.contactedByMe ?? '', q.contactedScope ?? '', q.search ?? '', q.industry ?? '', q.location ?? '', q.companySize ?? '', q.tags ?? '', q.hasLead ?? '', q.sortBy ?? '', q.sortOrder ?? '', q.ownershipType ?? '', q.globalDb ?? ''];
  return parts.join(':');
}

export function buildClientContactedWhere(userIds: string[], subCompanyIds: string[], contactedByMe: 'true' | 'false'): Prisma.ClientWhereInput {
  const subFilter = toSubFilter(subCompanyIds);
  const contactedWhere: Prisma.ClientWhereInput = {
    OR: [
      { calls: { some: { ownerId: { in: userIds }, subCompanyId: subFilter } } },
      { emails: { some: { fromUserId: { in: userIds }, subCompanyId: subFilter, folder: EmailFolder.sent } } },
    ],
  };

  if (contactedByMe === 'true') return contactedWhere;

  return {
    AND: [
      { calls: { none: { ownerId: { in: userIds }, subCompanyId: subFilter } } },
      { emails: { none: { fromUserId: { in: userIds }, subCompanyId: subFilter, folder: EmailFolder.sent } } },
    ],
  };
}

export async function resolveContactedScopeUserIds(params: {
  userId: string;
  role: string | undefined;
  subCompanyId: string;
  scope?: 'mine' | 'team';
}): Promise<string[]> {
  const scopeLevel = await resolveScopeLevelForRole(params.role);
  return resolveContactedScopeUserIdsFromScope({
    userId: params.userId,
    scopeLevel,
    subCompanyId: params.subCompanyId,
    scope: params.scope,
  });
}

function timestampValue(value?: Date | string): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatContactedByName(
  user?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null,
  fallbackName?: string | null
): string | undefined {
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
  return fullName || user?.email?.trim() || fallbackName?.trim() || undefined;
}

export function resolveContactedByName(client: Pick<ClientListRelationRow, 'calls' | 'emails'>): string | undefined {
  const latestCall = client.calls?.[0];
  const latestEmail = client.emails?.[0];

  if (!latestCall && !latestEmail) return undefined;
  if (!latestEmail) return formatContactedByName(latestCall?.owner);
  if (!latestCall) return formatContactedByName(latestEmail.fromUser, latestEmail.fromName);

  return timestampValue(latestCall.timestamp) >= timestampValue(latestEmail.timestamp)
    ? formatContactedByName(latestCall.owner)
    : formatContactedByName(latestEmail.fromUser, latestEmail.fromName);
}

export function buildClientContactedInclude(userIds: string[], subCompanyIds: string[]): Pick<Prisma.ClientInclude, 'calls' | 'emails'> {
  const subFilter = toSubFilter(subCompanyIds);
  return {
    calls: {
      where: { ownerId: { in: userIds }, subCompanyId: subFilter },
      take: 1,
      orderBy: { timestamp: 'desc' },
      select: {
        id: true,
        timestamp: true,
        owner: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    },
    emails: {
      where: {
        fromUserId: { in: userIds },
        subCompanyId: subFilter,
        folder: EmailFolder.sent,
      },
      take: 1,
      orderBy: { timestamp: 'desc' },
      select: {
        id: true,
        timestamp: true,
        fromName: true,
        fromUser: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    },
  };
}

type LeadSummaryRow = {
  id: string;
  clientId: string;
  ownerId: string;
  status: LeadStatus;
  closedAt: Date | null;
  updatedAt: Date;
  lossReason: string | null;
  owner: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
};

type ClientLeadSummaries = {
  activeLeadByClientId: Map<string, LeadSummaryRow>;
  latestLostLeadByClientId: Map<string, LeadSummaryRow>;
  openLeadClientIds: Set<string>;
  lostLeadOwnerIdsByClientId: Map<string, Set<string>>;
};

type ClientOutreachSummaries = {
  outreachClientIds: Set<string>;
  latestOutreachByName: Map<string, string>;
};

/**
 * Per-client, agency-wide outreach summary:
 *   - outreachClientIds: clients with ≥1 Call OR ≥1 outbound Email in this agency
 *   - latestOutreachByName: name of the owner of the latest outreach event
 *
 * Drives the "Contacted" badge and "Contacted by: …" sub-line on the Clients
 * page. Not user-scoped — this is what *any* user in the agency did.
 */
async function getClientOutreachSummaries(
  subCompanyIds: string[],
  clientIds: string[]
): Promise<ClientOutreachSummaries> {
  const empty: ClientOutreachSummaries = {
    outreachClientIds: new Set<string>(),
    latestOutreachByName: new Map<string, string>(),
  };
  if (clientIds.length === 0) return empty;

  const subFilter = toSubFilter(subCompanyIds);

  // Fetch the latest non-closed lead per client. Its createdAt is the cutoff:
  // outreach BEFORE the latest active lead belonged to a previous lifecycle
  // (e.g. a reassigned-away lead) and must not count toward the current
  // owner's "Contacted" badge. For non-reassigned clients the cutoff is the
  // very first lead's createdAt, so all outreach still counts → no behavior
  // change from the locked tag flow for that 99% of cases.
  const activeLeads = await prisma.lead.findMany({
    where: {
      clientId: { in: clientIds },
      subCompanyId: subFilter,
      status: { in: [LeadStatus.open, LeadStatus.active, LeadStatus.closed_won_pending] },
    },
    orderBy: { createdAt: 'desc' },
    distinct: ['clientId'],
    select: { clientId: true, createdAt: true },
  });
  const cutoffByClientId = new Map<string, Date>(
    activeLeads.map((l) => [l.clientId, l.createdAt])
  );

  const [latestCalls, latestEmails] = await Promise.all([
    prisma.call.findMany({
      where: { clientId: { in: clientIds }, subCompanyId: subFilter },
      orderBy: { timestamp: 'desc' },
      select: {
        clientId: true,
        timestamp: true,
        owner: { select: { firstName: true, lastName: true, email: true } },
      },
    }),
    prisma.email.findMany({
      where: {
        clientId: { in: clientIds },
        subCompanyId: subFilter,
        folder: EmailFolder.sent,
      },
      orderBy: { timestamp: 'desc' },
      select: {
        clientId: true,
        timestamp: true,
        fromName: true,
        fromUser: { select: { firstName: true, lastName: true, email: true } },
      },
    }),
  ]);

  // Pick the latest call/email per client that occurred after the cutoff.
  // Iterating desc gives us the most recent first.
  const callByClientId = new Map<string, typeof latestCalls[number]>();
  for (const c of latestCalls) {
    if (!c.clientId) continue;
    if (callByClientId.has(c.clientId)) continue;
    const cutoff = cutoffByClientId.get(c.clientId);
    if (cutoff && c.timestamp && new Date(c.timestamp) < cutoff) continue;
    callByClientId.set(c.clientId, c);
  }

  const emailByClientId = new Map<string, typeof latestEmails[number]>();
  for (const e of latestEmails) {
    if (!e.clientId) continue;
    if (emailByClientId.has(e.clientId)) continue;
    const cutoff = cutoffByClientId.get(e.clientId);
    if (cutoff && e.timestamp && new Date(e.timestamp) < cutoff) continue;
    emailByClientId.set(e.clientId, e);
  }

  const outreachClientIds = new Set<string>([
    ...callByClientId.keys(),
    ...emailByClientId.keys(),
  ]);

  const latestOutreachByName = new Map<string, string>();
  for (const clientId of outreachClientIds) {
    const call = callByClientId.get(clientId);
    const email = emailByClientId.get(clientId);
    let name: string | undefined;
    if (call && email) {
      const callT = call.timestamp ? new Date(call.timestamp).getTime() : 0;
      const emailT = email.timestamp ? new Date(email.timestamp).getTime() : 0;
      name = callT >= emailT
        ? formatContactedByName(call.owner)
        : formatContactedByName(email.fromUser, email.fromName);
    } else if (call) {
      name = formatContactedByName(call.owner);
    } else if (email) {
      name = formatContactedByName(email.fromUser, email.fromName);
    }
    if (name) latestOutreachByName.set(clientId, name);
  }

  return { outreachClientIds, latestOutreachByName };
}

function compareActiveLeadRows(a: LeadSummaryRow, b: LeadSummaryRow): number {
  const statusPriority = (lead: LeadSummaryRow) => (lead.status === LeadStatus.open ? 2 : 1);
  const priorityDiff = statusPriority(b) - statusPriority(a);
  if (priorityDiff !== 0) return priorityDiff;
  return b.updatedAt.getTime() - a.updatedAt.getTime();
}

function compareLostLeadRows(a: LeadSummaryRow, b: LeadSummaryRow): number {
  const aTime = (a.closedAt ?? a.updatedAt).getTime();
  const bTime = (b.closedAt ?? b.updatedAt).getTime();
  return bTime - aTime;
}

async function getLeadSummariesForClients(subCompanyIds: string[], clientIds: string[]): Promise<ClientLeadSummaries> {
  if (clientIds.length === 0) {
    return {
      activeLeadByClientId: new Map(),
      latestLostLeadByClientId: new Map(),
      openLeadClientIds: new Set(),
      lostLeadOwnerIdsByClientId: new Map(),
    };
  }

  const subFilter = toSubFilter(subCompanyIds);
  const leads = await prisma.lead.findMany({
    where: {
      subCompanyId: subFilter,
      clientId: { in: clientIds },
      status: { in: [LeadStatus.open, LeadStatus.active, LeadStatus.closed_won, LeadStatus.closed_won_pending, LeadStatus.closed_lost] },
    },
    select: {
      id: true,
      clientId: true,
      ownerId: true,
      status: true,
      closedAt: true,
      updatedAt: true,
      lossReason: true,
      owner: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
        },
      },
    },
  });

  const activeLeadByClientId = new Map<string, LeadSummaryRow>();
  const latestLostLeadByClientId = new Map<string, LeadSummaryRow>();
  const openLeadClientIds = new Set<string>();
  const lostLeadOwnerIdsByClientId = new Map<string, Set<string>>();

  for (const lead of leads) {
    if (lead.status === LeadStatus.open || lead.status === LeadStatus.active || lead.status === LeadStatus.closed_won_pending) {
      openLeadClientIds.add(lead.clientId);
    }

    if (lead.status === LeadStatus.open || lead.status === LeadStatus.active || lead.status === LeadStatus.closed_won_pending || lead.status === LeadStatus.closed_won) {
      const current = activeLeadByClientId.get(lead.clientId);
      if (!current || compareActiveLeadRows(lead, current) < 0) {
        activeLeadByClientId.set(lead.clientId, lead);
      }
    }

    if (lead.status === LeadStatus.closed_lost) {
      const current = latestLostLeadByClientId.get(lead.clientId);
      if (!current || compareLostLeadRows(lead, current) < 0) {
        latestLostLeadByClientId.set(lead.clientId, lead);
      }
      // Collect ALL owner IDs who lost this client (for scope filtering)
      let ownerIds = lostLeadOwnerIdsByClientId.get(lead.clientId);
      if (!ownerIds) {
        ownerIds = new Set();
        lostLeadOwnerIdsByClientId.set(lead.clientId, ownerIds);
      }
      ownerIds.add(lead.ownerId);
    }
  }

  return {
    activeLeadByClientId,
    latestLostLeadByClientId,
    openLeadClientIds,
    lostLeadOwnerIdsByClientId,
  };
}

type ClientLeadSummaryInput = {
  activeLead?: LeadSummaryRow;
  latestLostLead?: LeadSummaryRow;
  hasOpenLead: boolean;
  hasOutreach?: boolean;
};

export function mapClientListRow<T extends ClientListRelationRow & Record<string, unknown>>(
  client: T,
  summary?: ClientLeadSummaryInput,
  primarySubCompanyId?: string
) {
  const agencyView = (primarySubCompanyId
    ? client.clientSubCompanies?.find((csc) => (csc as any).subCompanyId === primarySubCompanyId)
    : undefined) ?? client.clientSubCompanies?.[0];
  const assignedLead = summary?.activeLead;
  const latestLostLead = summary?.latestLostLead;
  const agencyNames = (client.clientSubCompanies ?? [])
    .map((csc) => (csc as any).subCompany?.name as string | undefined)
    .filter(Boolean) as string[];
  return {
    ...client,
    status: agencyView?.status ?? client.status,
    hasOpenLead: summary?.hasOpenLead ?? false,
    activeLeadId: assignedLead?.id,
    activeLeadOwnerId: assignedLead?.ownerId,
    activeLeadOwnerName: assignedLead ? formatContactedByName(assignedLead.owner) : undefined,
    assignedOwnerId: assignedLead?.ownerId,
    assignedOwnerName: assignedLead ? formatContactedByName(assignedLead.owner) : undefined,
    latestLostLeadId: latestLostLead?.id,
    latestLostById: latestLostLead?.ownerId,
    latestLostByName: latestLostLead ? formatContactedByName(latestLostLead.owner) ?? 'Unknown' : undefined,
    latestLostAt: latestLostLead ? (latestLostLead.closedAt ?? latestLostLead.updatedAt) : undefined,
    latestLossReason: latestLostLead?.lossReason ?? undefined,
    tags: client.tags.map((t) => t.tag),
    contactedByMe: Boolean(client.calls?.length || client.emails?.length),
    contactedByName: resolveContactedByName(client),
    hasOutreach: summary?.hasOutreach ?? false,
    agencyNames: agencyNames.length > 0 ? agencyNames : undefined,
    clientSubCompanies: undefined,
    calls: undefined,
    emails: undefined,
  };
}

function formatUserDisplayName(user?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null): string {
  return [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || user?.email?.trim() || 'User';
}

function buildClientNotificationLink(clientId: string): string {
  return `/clients?client=${encodeURIComponent(clientId)}`;
}

function buildClientUrl(clientId: string): string | undefined {
  if (!env.FRONTEND_URL) return undefined;
  return `${env.FRONTEND_URL.replace(/\/$/, '')}${buildClientNotificationLink(clientId)}`;
}

function formatClientLocation(client: {
  location?: string | null;
  locations?: Array<{
    isPrimary?: boolean;
    address?: string | null;
    city?: string | null;
    region?: string | null;
    postalCode?: string | null;
    country?: string | null;
  }>;
}): string | null {
  const summary = client.location?.trim();
  if (summary) return summary;

  const primaryLocation = client.locations?.find((location) => location.isPrimary) ?? client.locations?.[0];
  if (!primaryLocation) return null;

  return (
    [primaryLocation.city, primaryLocation.region].filter(Boolean).join(', ').trim() ||
    primaryLocation.address?.trim() ||
    [primaryLocation.postalCode, primaryLocation.country].filter(Boolean).join(', ').trim() ||
    null
  );
}

export const listClientsHandler = async (req: Request, res: Response) => {
  const userId = effectiveActorId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const parsed = querySchema.safeParse(req.query);
  const q = parsed.success ? parsed.data : { page: 1, limit: 20 };
  const skip = (q.page - 1) * q.limit;

  // Resolve agency scope (elevated roles can see across agencies; DB Manager defaults to org-wide)
  const isDbManager = isDatabaseManagerRole(req.user?.role);
  const listCtx = await ensureAccessContext(req);
  const dbManagerDestination = isDbManager ? await getDatabaseManagerDestinationMode() : null;
  const dbManagerAgencyPathEnabled =
    dbManagerDestination === 'agency' || dbManagerDestination === 'both';
  const dbManagerHasAgencyWorkspace =
    !!listCtx &&
    ((await requestHasAnyPermission(req, [
      'leads:read',
      'pipeline:read',
      'calls:read',
      'tasks:read',
      'meetings:read',
      'proposals:read',
      'employees:read',
      'jobs:read',
      'users:directory',
      'settings:read',
    ])) || canViewAllDataInAgency(listCtx));
  const dbManagerCanUseAgencyLists = dbManagerHasAgencyWorkspace || dbManagerAgencyPathEnabled;
  const allowedIds = await resolveClientListAgencyIds(req.user!, req);
  if (!allowedIds.length) {
    return res.json({
      data: [],
      pagination: { page: q.page, limit: q.limit, total: 0, totalPages: 0 },
    });
  }

  // Linked agency scope: non-elevated users can view a linked agency's clients
  // by passing linkedAgencyId (validated against their link group).
  const linkedAgencyId = (q as any).linkedAgencyId as string | undefined;
  if (linkedAgencyId && listCtx && !canAccessMultipleAgencies(listCtx)) {
    const callerLink = await prisma.userAgencyLink.findFirst({
      where: { userId: req.user!.sub },
      select: { groupId: true },
    });
    if (callerLink) {
      const memberInLinkedAgency = await prisma.userAgencyLink.findFirst({
        where: { groupId: callerLink.groupId, user: { subCompanyId: linkedAgencyId } },
      });
      if (memberInLinkedAgency && !allowedIds.includes(linkedAgencyId)) {
        allowedIds.push(linkedAgencyId);
      }
    }
  }

  const isGlobalDbTabRequest =
    q.globalDb === 'true' &&
    !q.status &&
    !q.contactedByMe &&
    !q.ownershipType;
  const requestedIds = isGlobalDbTabRequest
    ? []
    : parseAgencyIdsParam((q as any).agencyIds ?? linkedAgencyId ?? q.subCompanyId);
  const effectiveIds = requestedIds.length > 0
    ? requestedIds.filter((id) => allowedIds.includes(id))
    : allowedIds;
  const ids = effectiveIds.length > 0 ? effectiveIds : allowedIds;
  const ownerIdsList = isGlobalDbTabRequest
    ? []
    : ((q as any).ownerIds
      ? (q as any).ownerIds.split(',').filter((id: string) => /^[0-9a-f-]{36}$/i.test(id)) as string[]
      : []);

  const isGlobalDbList =
    isGlobalDbTabRequest ||
    (isDbManager &&
      !q.status &&
      !q.contactedByMe &&
      !q.ownershipType &&
      ownerIdsList.length === 0 &&
      requestedIds.length === 0);
  const scopeIds = isGlobalDbList ? allowedIds : ids;
  const subFilter = toSubFilter(scopeIds);

  // Linked account scope: expand each anchor's normal role scope (own/team/agency).
  const canUseOwnerFilter = listCtx ? canViewTeamData(listCtx) || canAccessMultipleAgencies(listCtx) : false;
  const linkedScope = ownerIdsList.length > 0
    ? await expandLinkedOwnerScope(req.user!.sub, req.user!.subCompanyId, ownerIdsList, { exact: ownerExactFromQuery(req.query) })
    : null;
  const effectiveOwnerIds = linkedScope
    ? linkedScope.userIds
    : ownerIdsList;
  const linkedSubFilter = linkedScope ? { in: linkedScope.subCompanyIds } : subFilter;
  // When linked scope is active, scope queries across all linked sub-companies/users.
  const effectiveScopeIds = linkedScope ? linkedScope.subCompanyIds : ids;
  const effectiveSubFilter = linkedScope ? { in: linkedScope.subCompanyIds } : subFilter;
  // primaryId is used for team-scoped operations (contactedByMe, assignedScope, etc.)
  const primaryId = scopeIds[0];

  // Default DB-manager workspace is global-db-only. When agency workspace access is granted,
  // allow agency tabs/lists too.
  if (isDbManager && !isGlobalDbList && !dbManagerCanUseAgencyLists) {
    return res.json({
      data: [],
      pagination: { page: q.page, limit: q.limit, total: 0, totalPages: 0 },
    });
  }

  const agencyIdsKey = isGlobalDbList ? 'global' : [...ids].sort().join(',');
  const ownerIdsKey = [...ownerIdsList].sort().join(',');
  const cacheKey = isRedisEnabled() ? buildListCacheKey(primaryId, userId, q, agencyIdsKey, ownerIdsKey) : null;
  const redis = getRedis();
  if (cacheKey && redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return res.json(JSON.parse(cached) as object);
      }
    } catch {
      // ignore cache read errors
    }
  }

  const contactedScopeUserIds = q.contactedByMe
    ? (linkedScope
        ? (linkedScope.userIds.length > 0
            ? linkedScope.userIds
            : (
                await prisma.user.findMany({
                  where: { subCompanyId: { in: linkedScope.subCompanyIds }, isActive: true },
                  select: { id: true },
                })
              ).map((u) => u.id))
        : await resolveContactedScopeUserIds({
            userId,
            role: req.user?.role,
            subCompanyId: primaryId,
            scope: q.contactedScope,
          }))
    : [userId];

  let where: Prisma.ClientWhereInput = isGlobalDbList
    ? { visibility: 'global' }
    : visibilityWhere(effectiveScopeIds);
  if (q.corporateCode && q.corporateCode.trim()) {
    where.corporateCode = { equals: q.corporateCode.trim(), mode: 'insensitive' };
  }
  if (q.search && q.search.trim()) {
    const term = q.search.trim().slice(0, 200);
    const searchClause = {
      OR: [
        { name: { contains: term, mode: 'insensitive' as const } },
        { industry: { contains: term, mode: 'insensitive' as const } },
        { location: { contains: term, mode: 'insensitive' as const } },
        { corporateCode: { contains: term, mode: 'insensitive' as const } },
      ],
    };
    where = Object.keys(where).length ? { AND: [where, searchClause] } : searchClause;
  }
  if (q.industry && q.industry.trim()) {
    const industries = q.industry.split(',').map((s) => s.trim().slice(0, 100)).filter(Boolean);
    if (industries.length > 0) {
      const industryClause = industries.length === 1
        ? { industry: { equals: industries[0], mode: 'insensitive' as const } }
        : { OR: industries.map((i) => ({ industry: { equals: i, mode: 'insensitive' as const } })) };
      where = Object.keys(where).length ? { AND: [where, industryClause] } : industryClause;
    }
  }
  if (q.location && q.location.trim()) {
    const locations = q.location.split(',').map((s) => s.trim().slice(0, 100)).filter(Boolean);
    if (locations.length > 0) {
      const locationClause = locations.length === 1
        ? { location: { contains: locations[0], mode: 'insensitive' as const } }
        : { OR: locations.map((l) => ({ location: { contains: l, mode: 'insensitive' as const } })) };
      where = Object.keys(where).length ? { AND: [where, locationClause] } : locationClause;
    }
  }
  if (q.companySize && q.companySize.trim()) {
    const sizes = q.companySize.split(',').map((s) => s.trim().slice(0, 100)).filter(Boolean);
    if (sizes.length > 0) {
      const sizeClause = sizes.length === 1
        ? { companySize: { equals: sizes[0], mode: 'insensitive' as const } }
        : { OR: sizes.map((s) => ({ companySize: { equals: s, mode: 'insensitive' as const } })) };
      where = Object.keys(where).length ? { AND: [where, sizeClause] } : sizeClause;
    }
  }
  if (q.tags && q.tags.trim()) {
    const tagList = q.tags.split(',').map((s) => s.trim().slice(0, 100)).filter(Boolean);
    if (tagList.length > 0) {
      const tagClause = { tags: { some: { subCompanyId: linkedSubFilter, tag: { in: tagList } } } };
      where = Object.keys(where).length ? { AND: [where, tagClause] } : tagClause;
    }
  }
  const viewerRole = req.user?.role;
  const viewerIsAssociate = await isViewerAssociateScope(viewerRole);
  const visibleLeadOwnerIds = isGlobalDbList
    ? null
    : await resolveClientLeadVisibleOwnerIds({
        role: viewerRole,
        viewerUserId: req.user?.actAsUserId ?? userId,
        subCompanyId: primaryId,
      });

  if (viewerIsAssociate && userId) {
    // Use the actAs user's ID when acting on behalf of a linked account,
    // so restrictions are evaluated for the effective actor, not the real caller.
    const effectiveViewerId = req.user?.actAsUserId ?? userId;
    const restrictionClause: Prisma.ClientWhereInput = {
      restrictions: { none: { userId: effectiveViewerId } },
    };
    where = mergeWhere(where, restrictionClause);
  }

  if (q.hasLead === 'true') {
    const leadClause = {
      leads: {
        some: {
          subCompanyId: linkedSubFilter,
          status: { in: BUSY_LEAD_STATUSES },
        },
      },
    };
    where = mergeWhere(where, leadClause);
  } else if (q.hasLead === 'false') {
    const noLeadClause = {
      leads: { none: { subCompanyId: linkedSubFilter, status: { in: BUSY_LEAD_STATUSES } } },
    };
    where = mergeWhere(where, noLeadClause);
  }
  if (q.ownershipType) {
    const ownershipClause: Prisma.ClientWhereInput = { ownershipType: q.ownershipType };
    where = mergeWhere(where, ownershipClause);
  }
  // User filter — pre-filter to clients that have any lead owned by these users (JS post-filter refines to primary lead).
  // Agency-mode linked anchors skip owner predicate (full agency visibility).
  if (ownerIdsList.length > 0 && !(linkedScope && linkedScope.mode === 'agencies' && effectiveOwnerIds.length === 0)) {
    if (linkedScope?.mode === 'mixed') {
      const mixedClause: Prisma.ClientWhereInput = {
        OR: [
          ...(effectiveOwnerIds.length > 0 && linkedScope.ownerSubCompanyIds.length > 0
            ? [{
                leads: {
                  some: {
                    ownerId: { in: effectiveOwnerIds },
                    subCompanyId: { in: linkedScope.ownerSubCompanyIds },
                  },
                },
              } satisfies Prisma.ClientWhereInput]
            : []),
          ...(linkedScope.agencySubCompanyIds.length > 0
            ? [visibilityWhere(linkedScope.agencySubCompanyIds)]
            : []),
        ],
      };
      where = Object.keys(where).length ? { AND: [where, mixedClause] } : mixedClause;
    } else if (linkedScope || !canUseOwnerFilter || effectiveOwnerIds.length > 0) {
      const ownerClause: Prisma.ClientWhereInput = {
        leads: {
          some: {
            ...(effectiveOwnerIds.length > 0 ? { ownerId: { in: effectiveOwnerIds } } : {}),
            subCompanyId: linkedSubFilter,
          },
        },
      };
      where = Object.keys(where).length ? { AND: [where, ownerClause] } : ownerClause;
    }
  }
  // Exclude clients with terminal statuses (ex, unsubscribed, permanently_closed) from Active/Lost tabs
  const terminalStatusExclusion: Prisma.ClientWhereInput = {
    AND: [
      { NOT: statusWhere(effectiveScopeIds, ClientStatus.ex) },
      { NOT: statusWhere(effectiveScopeIds, ClientStatus.unsubscribed) },
      { NOT: statusWhere(effectiveScopeIds, ClientStatus.permanently_closed) },
    ],
  };
  if (q.status === ClientStatus.lost) {
    // Lost tab is exclusive: require BOTH a historical closed_lost lead AND
    // the agency-scoped status to currently be `lost`. When a lost lead is
    // reassigned (status flips to `contacted`) or a newer lead wins (status
    // flips to `active`), the client correctly leaves this tab.
    const lostLeadClause: Prisma.ClientWhereInput = {
      leads: { some: { subCompanyId: linkedSubFilter, status: LeadStatus.closed_lost } },
    };
    const lostStatusClause = statusWhere(effectiveScopeIds, ClientStatus.lost);
    where = Object.keys(where).length
      ? { AND: [where, lostLeadClause, lostStatusClause, terminalStatusExclusion] }
      : { AND: [lostLeadClause, lostStatusClause, terminalStatusExclusion] };
  } else if (q.status === ClientStatus.active) {
    // Active tab is exclusive: require BOTH a closed_won lead AND the
    // agency-scoped status to currently be `active`. If a newer lead is
    // open/lost, the status flips and the client moves to the appropriate tab.
    const wonLeadClause: Prisma.ClientWhereInput = {
      leads: { some: { subCompanyId: linkedSubFilter, status: LeadStatus.closed_won } },
    };
    const activeStatusClause = statusWhere(effectiveScopeIds, ClientStatus.active);
    where = Object.keys(where).length
      ? { AND: [where, wonLeadClause, activeStatusClause, terminalStatusExclusion] }
      : { AND: [wonLeadClause, activeStatusClause, terminalStatusExclusion] };
  } else if (q.status) {
    const statusClause = statusWhere(effectiveScopeIds, q.status);
    where = Object.keys(where).length ? { AND: [statusClause, where] } : statusClause;
  }
  if (q.contactedByMe) {
    const contactedClause = buildClientContactedWhere(contactedScopeUserIds, effectiveScopeIds, q.contactedByMe);
    // Contacted tab is exclusive: a client can only appear here if its
    // agency-scoped status is `contacted`. Once a lead is won/lost or the
    // manager has toggled Ex/Unsub/Perm-Closed, the client leaves this tab.
    const contactedStatusClause = q.contactedByMe === 'true'
      ? statusWhere(effectiveScopeIds, ClientStatus.contacted)
      : null;
    const contactedClauses: Prisma.ClientWhereInput[] = contactedStatusClause
      ? [contactedClause, contactedStatusClause]
      : [contactedClause];
    where = Object.keys(where).length
      ? { AND: [where, ...contactedClauses] }
      : (contactedClauses.length === 1 ? contactedClauses[0] : { AND: contactedClauses });
  }

  const needsAssignedScope =
    (q.status === ClientStatus.active && q.assignedScope) ||
    (q.status === ClientStatus.lost && q.lostScope);

  if (needsAssignedScope || ownerIdsList.length > 0) {
    const scopedUserIds = needsAssignedScope
      ? (linkedScope
          ? linkedScope.userIds
          : await resolveContactedScopeUserIds({
              userId,
              role: req.user?.role,
              subCompanyId: primaryId,
              scope: q.status === ClientStatus.active ? q.assignedScope : q.lostScope,
            }))
      : [];

    const candidateClientIds = (
      await prisma.client.findMany({
        where,
        select: { id: true },
      })
    ).map((client) => client.id);

    if (candidateClientIds.length === 0) {
      const payload = {
        data: [] as Array<Record<string, unknown>>,
        pagination: {
          page: q.page,
          limit: q.limit,
          total: 0,
          totalPages: 0,
        },
      };
      if (cacheKey && redis) {
        try {
          await redis.setex(cacheKey, CLIENT_LIST_CACHE_TTL_SEC, JSON.stringify(payload));
        } catch {
          // ignore cache write errors
        }
      }
      return res.json(payload);
    }

    const summaryIds = linkedScope ? linkedScope.subCompanyIds : ids;
    const leadSummaries = await getLeadSummariesForClients(summaryIds, candidateClientIds);

    const scopedClientIds = candidateClientIds.filter((clientId) => {
      const summary = leadSummaries.activeLeadByClientId.get(clientId);

      // ownerIds filter: match by primary lead owner (or lost-by for the Lost tab)
      if (ownerIdsList.length > 0) {
        if (q.status === ClientStatus.lost) {
          const lostOwnerIdsForClient = leadSummaries.lostLeadOwnerIdsByClientId.get(clientId);
          if (!lostOwnerIdsForClient || !effectiveOwnerIds.some((id) => lostOwnerIdsForClient.has(id))) return false;
        } else {
          if (!summary || !effectiveOwnerIds.includes(summary.ownerId)) return false;
        }
      }

      if (q.status === ClientStatus.lost && needsAssignedScope) {
        // Check if ANY closed_lost lead owner matches the scoped users
        const lostOwnerIds = leadSummaries.lostLeadOwnerIdsByClientId.get(clientId);
        return lostOwnerIds ? scopedUserIds.some((uid) => lostOwnerIds.has(uid)) : false;
      }
      if (q.status === ClientStatus.active && needsAssignedScope) {
        // Active tab: check the active lead owner
        return summary ? scopedUserIds.includes(summary.ownerId) : false;
      }
      return true;
    });

    if (scopedClientIds.length === 0) {
      const payload = {
        data: [] as Array<Record<string, unknown>>,
        pagination: {
          page: q.page,
          limit: q.limit,
          total: 0,
          totalPages: 0,
        },
      };
      if (cacheKey && redis) {
        try {
          await redis.setex(cacheKey, CLIENT_LIST_CACHE_TTL_SEC, JSON.stringify(payload));
        } catch {
          // ignore cache write errors
        }
      }
      return res.json(payload);
    }

    const scopedClientClause: Prisma.ClientWhereInput = {
      id: { in: scopedClientIds },
    };
    where = Object.keys(where).length ? { AND: [where, scopedClientClause] } : scopedClientClause;
  }

  const sortField = q.sortBy && SORT_FIELDS.includes(q.sortBy) ? q.sortBy : 'serialNumber';
  const sortOrder = q.sortOrder === 'desc' ? 'desc' : 'asc';

  const [clients, total] = await Promise.all([
    prisma.client.findMany({
      where,
      skip,
      take: q.limit,
      orderBy: { [sortField]: sortOrder },
      include: {
        contacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
        locations: true,
        tags: { where: { subCompanyId: effectiveSubFilter } },
        clientSubCompanies: {
          where: { subCompanyId: effectiveSubFilter },
          ...(effectiveScopeIds.length === 1
            ? { take: 1 }
            : { select: { subCompanyId: true, status: true, subCompany: { select: { id: true, name: true } } } }),
        },
        ...buildClientContactedInclude(contactedScopeUserIds, effectiveScopeIds),
        forwardedFromUser: { select: { firstName: true, lastName: true, subCompanyId: true } },
      },
    }),
    prisma.client.count({ where }),
  ]);

  const clientIds = clients.map((client) => client.id);
  const ownerUserIds = Array.from(
    new Set(
      clients
        .map((c) => (c as { ownershipUserId?: string | null }).ownershipUserId)
        .filter((id): id is string => !!id),
    ),
  );
  const [pageLeadSummaries, pageOutreachSummaries, ownershipUsers] = await Promise.all([
    getLeadSummariesForClients(effectiveScopeIds, clientIds),
    getClientOutreachSummaries(effectiveScopeIds, clientIds),
    ownerUserIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: ownerUserIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : Promise.resolve([] as Array<{ id: string; firstName: string | null; lastName: string | null; email: string }>),
  ]);
  const ownershipNameById = new Map<string, string>(
    ownershipUsers.map((u) => [
      u.id,
      (`${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email || ''),
    ]),
  );
  const data = clients.map((client) => {
    const activeLead = pageLeadSummaries.activeLeadByClientId.get(client.id);
    const row = mapClientListRow(client, {
      activeLead,
      latestLostLead: pageLeadSummaries.latestLostLeadByClientId.get(client.id),
      hasOpenLead: pageLeadSummaries.openLeadClientIds.has(client.id),
      hasOutreach: pageOutreachSummaries.outreachClientIds.has(client.id),
    }, req.user?.subCompanyId);
    const ownerId = (client as { ownershipUserId?: string | null }).ownershipUserId ?? null;
    const fwdUser = (client as { forwardedFromUser?: { firstName: string | null; lastName: string | null; subCompanyId: string | null } | null }).forwardedFromUser;
    const withOutreach = Object.assign(row, {
      latestOutreachByName: pageOutreachSummaries.latestOutreachByName.get(client.id),
      ownershipUserName: ownerId ? (ownershipNameById.get(ownerId) || null) : null,
      forwardedFromName: fwdUser
        ? `${fwdUser.firstName ?? ''} ${fwdUser.lastName ?? ''}`.trim() || null
        : null,
      forwardedFromSubCompanyId: fwdUser?.subCompanyId ?? null,
    });
    return viewerIsAssociate
      ? redactClientForAssociateViewer(withOutreach, userId, linkedScope ? linkedScope.userIds : [])
      : redactClientForHiddenLeadOwner(
          withOutreach,
          activeLead ? { ownerId: activeLead.ownerId, status: activeLead.status } : undefined,
          visibleLeadOwnerIds,
        );
  });

  const payload = {
    data,
    pagination: {
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.ceil(total / q.limit),
    },
  };

  if (cacheKey && redis) {
    try {
      await redis.setex(cacheKey, CLIENT_LIST_CACHE_TTL_SEC, JSON.stringify(payload));
    } catch {
      // ignore cache write errors
    }
  }

  return res.json(payload);
};

clientRouter.get('/', listClientsHandler);

/** GET /clients/facets — stable filter options (industry, city, province, companySize) */
clientRouter.get('/facets', async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }

  const visClause = visibilityWhere([subCompanyId]);
  const [industryRows, locationRows, sizeRows] = await Promise.all([
    prisma.client.findMany({
      distinct: ['industry'],
      select: { industry: true },
      where: { AND: [visClause, { industry: { not: null } }] },
      orderBy: { industry: 'asc' },
    }),
    prisma.client.findMany({
      distinct: ['location'],
      select: { location: true },
      where: { AND: [visClause, { location: { not: null } }] },
      orderBy: { location: 'asc' },
    }),
    prisma.client.findMany({
      distinct: ['companySize'],
      select: { companySize: true },
      where: { AND: [visClause, { companySize: { not: null } }] },
      orderBy: { companySize: 'asc' },
    }),
  ]);

  const industries = industryRows
    .map((r) => r.industry ?? '')
    .map((s) => s.trim())
    .filter(Boolean);

  const companySizes = sizeRows
    .map((r) => r.companySize ?? '')
    .map((s) => s.trim())
    .filter(Boolean);

  const citiesSet = new Set<string>();
  const provincesSet = new Set<string>();
  for (const r of locationRows) {
    const loc = (r.location ?? '').trim();
    if (!loc) continue;
    const [city, province] = loc.split(',').map((s) => s.trim());
    if (city) citiesSet.add(city);
    if (province) provincesSet.add(province);
  }

  return res.json({
    industries,
    cities: Array.from(citiesSet).sort(),
    provinces: Array.from(provincesSet).sort(),
    companySizes,
  });
});

/** Search existing client locations by address/city/region/postal. Returns matches with company name for Add Client flow. */
clientRouter.get('/location-search', async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 2) {
    return res.json({ data: [] });
  }
  const term = q.slice(0, 100);
  const visClause = visibilityWhere([subCompanyId]);
  const locations = await prisma.clientLocation.findMany({
    where: {
      AND: [
        {
          OR: [
            { address: { contains: term, mode: 'insensitive' as const } },
            { city: { contains: term, mode: 'insensitive' as const } },
            { region: { contains: term, mode: 'insensitive' as const } },
            { postalCode: { contains: term, mode: 'insensitive' as const } },
          ],
        },
        { client: visClause },
      ],
    },
    include: { client: { select: { id: true, name: true } } },
    take: 15,
  });
  const byKey = new Map<string, { address: string; city: string; region: string; postalCode: string; country: string; clientName: string }>();
  for (const loc of locations) {
    const key = [loc.address ?? '', loc.city ?? '', loc.region ?? '', loc.postalCode ?? ''].join('|');
    if (!byKey.has(key)) {
      byKey.set(key, {
        address: loc.address ?? '',
        city: loc.city ?? '',
        region: loc.region ?? '',
        postalCode: loc.postalCode ?? '',
        country: loc.country ?? '',
        clientName: loc.client.name,
      });
    }
  }
  const data = Array.from(byKey.values());
  return res.json({ data });
});

/** Check if an address already exists (same street + unit + city + province). Used when user presses Next on address step. */
clientRouter.get('/check-address', async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const unit = typeof req.query.unit === 'string' ? req.query.unit.trim() : '';
  const streetAddress = typeof req.query.streetAddress === 'string' ? req.query.streetAddress.trim() : '';
  const city = typeof req.query.city === 'string' ? req.query.city.trim() : '';
  const region = typeof req.query.region === 'string' ? req.query.region.trim() : '';
  const postalCode = typeof req.query.postalCode === 'string' ? req.query.postalCode.trim() : '';
  if (!streetAddress || !city || !region || !postalCode) {
    return res.status(400).json({ error: 'streetAddress, city, region, and postalCode are required' });
  }
  const fullAddress = [unit, streetAddress, city, region, postalCode].filter(Boolean).join(', ');
  const visClause = visibilityWhere([subCompanyId]);
  const existing = await prisma.clientLocation.findFirst({
    where: {
      address: { equals: fullAddress, mode: 'insensitive' },
      client: visClause,
    },
    include: { client: { select: { name: true } } },
  });
  if (existing) {
    return res.json({ exists: true, clientName: existing.client.name });
  }
  return res.json({ exists: false });
});

// ─── Pending Imported Clients ────────────────────────────────────────────────
// IMPORTANT: registered before /:id routes so the literal path matches first.
// CSV/Excel import flow:
//   1. Anyone with clients:read can upload a file. The wizard groups rows by
//      the source file's "ID" column and POSTs grouped staged clients here.
//   2. Only directors can approve or remove pending rows. Approval creates a
//      real Client (or appends contacts to / branches from an existing one).
//   Spec: docs/SYSTEM_UNDERSTANDING.md §9 (CSV / Excel client import)

const importContactSchema = z.object({
  name: z.string().min(1).max(200),
  title: z.string().max(200).optional().nullable(),
  email: z.string().max(320).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  extension: z.string().max(20).optional().nullable(),
  linkedin: z.string().max(500).optional().nullable(),
});

const pendingImportClientSchema = z.object({
  name: z.string().min(1).max(500),
  industry: z.string().max(200).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  address: z.string().max(1000).optional().nullable(),
  companySize: z.string().max(100).optional().nullable(),
  website: z.string().max(500).optional().nullable(),
  employees: z.string().max(50).optional().nullable(),
  sourceId: z.string().max(100).optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
  contacts: z.array(importContactSchema).default([]),
});

const pendingImportSchema = z.object({
  clients: z.array(pendingImportClientSchema),
  /** Database Manager + agency/both mode: target agency for this upload. */
  subCompanyId: z.string().uuid().optional(),
  /** Database Manager + both mode: global vs agency for this upload. */
  importDestination: z.enum(['global', 'agency']).optional(),
});

const importCheckSchema = z.object({
  emails: z.array(z.string()).max(5000).default([]),
  phones: z.array(z.string()).max(5000).default([]),
  companyNames: z.array(z.string()).max(5000).default([]),
  clients: z.array(pendingImportClientSchema).optional(),
  subCompanyId: z.string().uuid().optional(),
  importDestination: z.enum(['global', 'agency']).optional(),
});

clientRouter.post(
  '/import-check',
  authenticate,
  requirePermission('clients:read'),
  async (req: Request, res: Response) => {
    const parsed = importCheckSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

    const subCompanyId =
      parsed.data.subCompanyId?.trim() ??
      parseSubCompanyIdQuery(req) ??
      (parsed.data.importDestination === 'agency' ? (await getEffectiveSubCompanyId(req)) ?? undefined : undefined);

    const importDestination =
      parsed.data.importDestination ??
      (subCompanyId ? ('agency' as const) : undefined);

    const clients =
      parsed.data.clients?.length
        ? parsed.data.clients
        : (() => {
            const contacts = [
              ...parsed.data.emails.map((email) => ({
                name: 'Contact',
                email,
                phone: null as string | null,
              })),
              ...parsed.data.phones.map((phone) => ({
                name: 'Contact',
                email: null as string | null,
                phone,
              })),
            ];
            if (parsed.data.companyNames.length > 0) {
              return parsed.data.companyNames.map((name, index) => ({
                name,
                contacts: index === 0 ? contacts : [],
              }));
            }
            if (contacts.length > 0) {
              return [{ name: 'Import', contacts }];
            }
            return [];
          })();

    if (clients.length === 0) {
      return res.json({
        duplicateEmails: [],
        duplicatePhones: [],
        duplicateCompanyNames: [],
        inFileDuplicateEmails: [],
        inFileDuplicatePhones: [],
        hasConflicts: false,
      });
    }

    try {
      const result = await checkImportConflicts(clients, {
        importDestination,
        subCompanyId,
      });
      return res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import check failed';
      return res.status(400).json({ error: message });
    }
  },
);

const approvePendingImportSchema = z.object({
  mode: z.enum(['new', 'append', 'branch']),
  targetClientId: z.string().uuid().optional(),
});

const bulkPendingImportIdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
});

/** Bulk approve pending imports as new clients (one request; much faster than per-row). */
clientRouter.post(
  '/pending-imports/bulk-approve',
  authenticate,
  requirePermission('clients:approve'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    const parsed = bulkPendingImportIdsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    }
    const result = await bulkApprovePendingImportsAsNew(subCompanyId, parsed.data.ids);
    if (result.approved > 0) {
      await afterClientVisibilityChange(
        subCompanyId,
        result.hadGlobalVisibility ? 'global' : 'agency',
      );
      await notifyImportUploadersOfApproval({
        subCompanyId,
        actorUserId: req.user!.sub,
        groups: result.uploaderApprovals,
      });
    }
    return res.json(result);
  },
);

/** Bulk reject (delete) pending import rows. */
clientRouter.post(
  '/pending-imports/bulk-reject',
  authenticate,
  requirePermission('clients:approve'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    const parsed = bulkPendingImportIdsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    }
    const result = await bulkRejectPendingImports(subCompanyId, parsed.data.ids);
    return res.json(result);
  },
);

clientRouter.get(
  '/database-import-config',
  authenticate,
  requirePermission('clients:read'),
  async (req: Request, res: Response) => {
    const result = await buildClientFlowConfig(req);
    if ('error' in result) {
      return res.status(result.status as number).json({ error: result.error });
    }
    return res.json(result);
  },
);

/** Role-aware add/import flow (elevated destination + org workflows, or agency approval workflows). */
clientRouter.get(
  '/client-flow-config',
  authenticate,
  requirePermission('clients:read'),
  async (req: Request, res: Response) => {
    const result = await buildClientFlowConfig(req);
    if ('error' in result) {
      return res.status(result.status as number).json({ error: result.error });
    }
    return res.json(result);
  },
);

async function buildClientFlowConfig(
  req: Request,
): Promise<Record<string, unknown> | { error: string; status: number }> {
  const role = req.user?.role;
  const policy = await getOrgApprovalPolicy();
  const globalManualAddMode =
    policy.workflows.database_client_add?.mode === 'bypass' ? 'bypass' : 'route';
  const globalImportMode =
    policy.workflows.database_client_import?.mode === 'bypass' ? 'bypass' : 'route';
  const workflowModes = { globalManualAddMode, globalImportMode };

  if (isDatabaseManagerRole(role)) {
    const destination = await getDatabaseManagerDestinationMode();
    return {
      userFlow: 'database_manager',
      destination,
      ...workflowModes,
      agencyManualAddPath: 'pending',
    };
  }

    if (isSuperUserScreenRole(role)) {
      const destination = await getSuperUserDestinationMode();
      return {
        userFlow: 'super_user',
        destination,
        ...workflowModes,
        agencyManualAddPath: 'pending',
      };
    }

  const subCompanyId =
    parseSubCompanyIdQuery(req) ?? (await getEffectiveSubCompanyId(req));
  if (!subCompanyId) {
    return { error: 'Agency context required', status: 403 };
  }

  const allowedAgencyIds = await resolveAllowedSubCompanyIds(req.user!, req);
  if (!allowedAgencyIds.includes(subCompanyId)) {
    return { error: 'Agency not in your scope', status: 403 };
  }

  const [agencyPolicy, agencyRow, visibilitySetting, dataScopeLevel] = await Promise.all([
      getAgencyApprovalPolicy(subCompanyId),
      prisma.subCompany.findUnique({
        where: { id: subCompanyId },
        select: { name: true },
      }),
      prisma.clientVisibilitySetting.findUnique({
        where: { subCompanyId },
        select: { days: true },
      }),
      getDataScopeLevelForRoleKey(role ?? ''),
    ]);

  const manualAddMode =
    agencyPolicy.workflows.client_manual_add?.mode === 'bypass' ? 'bypass' : 'route';
  const importMode =
    agencyPolicy.workflows.client_import?.mode === 'bypass' ? 'bypass' : 'route';

  return {
    userFlow: 'agency',
    agencyName: agencyRow?.name ?? 'Agency',
    visibilityDays: visibilitySetting?.days ?? null,
    manualAddMode,
    importMode,
    manualAddRequiresPending: manualAddMode === 'route',
    importRequiresApproval: importMode === 'route',
    dataScopeLevel: dataScopeLevel ?? 'own',
  };
}

clientRouter.post(
  '/pending-imports',
  authenticate,
  requirePermission('clients:read'),
  async (req: Request, res: Response) => {
    const parsed = pendingImportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    const submitCtx = await ensureAccessContext(req);
    const submitterRole = req.user?.role ?? 'sales_associate';

    const destinationAwareImport = async (orgMode: Awaited<ReturnType<typeof getDatabaseManagerDestinationMode>>) => {
      const resolved = resolveClientDestinationMode(orgMode, parsed.data.importDestination);
      if ('error' in resolved) {
        return res.status(400).json({ error: resolved.error });
      }
      if (
        !isDatabaseManagerRole(req.user?.role) &&
        resolved.action === 'agency'
      ) {
        const writeTarget = await assertMultiAgencyWriteTarget(req);
        if (!writeTarget.ok) {
          return res.status(writeTarget.status).json({ error: writeTarget.error });
        }
      }
      try {
        let targetAgencyId = parsed.data.subCompanyId?.trim();
        if (resolved.action === 'agency' && !targetAgencyId) {
          targetAgencyId = (await getEffectiveSubCompanyId(req)) ?? undefined;
        }
        if (resolved.action === 'agency') {
          const allowedAgencyIds = await resolveAllowedSubCompanyIds(req.user!, req);
          if (!targetAgencyId || !allowedAgencyIds.includes(targetAgencyId)) {
            return res.status(403).json({ error: 'Selected agency is not in your access scope.' });
          }
        }
        try {
          await assertImportHasNoConflicts(parsed.data.clients, {
            importDestination: resolved.action === 'global' ? 'global' : 'agency',
            subCompanyId: resolved.action === 'agency' ? targetAgencyId : undefined,
          });
        } catch (err) {
          if (err instanceof ImportConflictError) {
            return res.status(409).json({ error: err.message, conflicts: err.conflicts });
          }
          throw err;
        }
        const result = await processDestinationAwarePendingImports({
          userId: req.user!.sub,
          submitterRoleKey: submitterRole,
          submitterPermissions: submitCtx?.permissions ?? [],
          clients: parsed.data.clients.map((c) => ({
            ...c,
            contacts: c.contacts as Prisma.InputJsonValue,
          })),
          action: resolved.action,
          targetAgencyId,
        });
        return res.status(201).json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Import failed';
        return res.status(400).json({ error: message });
      }
    };

    if (isDatabaseManagerRole(req.user?.role)) {
      return destinationAwareImport(await getDatabaseManagerDestinationMode());
    }

    if (isSuperUserScreenRole(req.user?.role)) {
      return destinationAwareImport(await getSuperUserDestinationMode());
    }

    const writeTarget = await assertMultiAgencyWriteTarget(req);
    if (!writeTarget.ok) {
      return res.status(writeTarget.status).json({ error: writeTarget.error });
    }

    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    try {
      await assertImportHasNoConflicts(parsed.data.clients, {
        importDestination: 'agency',
        subCompanyId,
      });
    } catch (err) {
      if (err instanceof ImportConflictError) {
        return res.status(409).json({ error: err.message, conflicts: err.conflicts });
      }
      throw err;
    }

    let autoApprovedCount = 0;
    const createdIds: string[] = [];
    let pendingApprovalCount = 0;
    let pendingNotifyTargetRole: string | null = null;
    const importActor = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: { firstName: true, lastName: true, email: true },
    });
    const importActorName = formatUserDisplayName(importActor ?? { email: req.user?.email ?? null });

    for (const c of parsed.data.clients) {
      const row = await prisma.pendingImportedClient.create({
        data: {
          subCompanyId,
          submissionSource: 'agency',
          importedById: req.user!.sub,
          name: c.name,
          industry: c.industry ?? null,
          location: c.location ?? null,
          address: c.address ?? null,
          companySize: c.companySize ?? null,
          website: c.website ?? null,
          employees: c.employees ?? null,
          sourceId: c.sourceId ?? null,
          tags: c.tags ?? [],
          contacts: c.contacts as Prisma.InputJsonValue,
          currentStepIndex: 0,
          approvalChain: [],
        },
      });
      createdIds.push(row.id);
      const approval = await submitEntityForApproval({
        workflow: 'client_import',
        entityId: row.id,
        subCompanyId,
        submitterUserId: req.user!.sub,
        submitterRoleKey: submitterRole,
        submitterPermissions: submitCtx?.permissions ?? [],
      });
      if (approval.autoApproved) autoApprovedCount += 1;
      else if (approval.targetRoleKey) {
        pendingApprovalCount += 1;
        pendingNotifyTargetRole = approval.targetRoleKey;
      }
    }

    if (pendingNotifyTargetRole && pendingApprovalCount > 0) {
      await notifyPendingImportBatchApproval({
        subCompanyId,
        targetRoleKey: pendingNotifyTargetRole,
        actorName: importActorName,
        pendingCount: pendingApprovalCount,
        link: '/clients?tab=pending',
        relatedId: createdIds[0] ?? req.user!.sub,
      });
    }

    await invalidateClientListCache(subCompanyId);
    return res.status(201).json({ count: createdIds.length, autoApprovedCount, ids: createdIds });
  }
);

clientRouter.get(
  '/pending-imports',
  authenticate,
  requirePermission('clients:read'),
  async (req: Request, res: Response) => {
    const ctx = await ensureAccessContext(req);
    const scope = typeof req.query.scope === 'string' ? req.query.scope : undefined;

    if (isDatabaseManagerRole(ctx?.roleKey)) {
      const scopeSubCompanyId = parseSubCompanyIdQuery(req);
      const allowedAgencyIds = await resolveAllowedSubCompanyIds(req.user!, req);
      if (scopeSubCompanyId && !allowedAgencyIds.includes(scopeSubCompanyId)) {
        return res.status(403).json({ error: 'Agency not in your scope' });
      }
      const where = (
        scope === 'global'
          ? { submissionSource: 'global_database' as const, importedById: req.user!.sub }
          : scopeSubCompanyId
            ? {
                submissionSource: 'agency' as const,
                importedById: req.user!.sub,
                subCompanyId: scopeSubCompanyId,
              }
            : {
                importedById: req.user!.sub,
                OR: [
                  { submissionSource: 'global_database' as const },
                  ...(allowedAgencyIds.length > 0
                    ? [{ submissionSource: 'agency' as const, subCompanyId: { in: allowedAgencyIds } }]
                    : []),
                ],
              }
      ) as Prisma.PendingImportedClientWhereInput;
      const records = await prisma.pendingImportedClient.findMany({
        where,
        orderBy: { importedAt: 'desc' },
        include: { importedBy: { select: { firstName: true, lastName: true } } },
      });
      return res.json(records);
    }

    if (!(await assertPendingQueueAccess(req, res))) return;

    if (scope === 'global') {
      const records = await prisma.pendingImportedClient.findMany({
        where: { submissionSource: 'global_database' },
        orderBy: { importedAt: 'desc' },
        include: { importedBy: { select: { firstName: true, lastName: true } } },
      });
      return res.json(records);
    }

    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    const records = await prisma.pendingImportedClient.findMany({
      where: { subCompanyId, submissionSource: 'agency' },
      orderBy: { importedAt: 'desc' },
      include: { importedBy: { select: { firstName: true, lastName: true } } },
    });
    return res.json(records);
  }
);

/**
 * Approve a pending import. Director-only.
 *   mode='new'    → create a fresh Client with the staged contacts.
 *   mode='append' → append staged contacts to an existing Client (targetClientId required).
 *   mode='branch' → create a new Client whose parentClientId = targetClientId.
 * In all modes the pending row is deleted on success.
 */
clientRouter.post(
  '/pending-imports/:id/approve',
  authenticate,
  requirePermission('clients:approve'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    const parsed = approvePendingImportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    }
    const { mode, targetClientId } = parsed.data;
    if ((mode === 'append' || mode === 'branch') && !targetClientId) {
      return res.status(400).json({ error: `targetClientId is required for mode='${mode}'` });
    }

    const ctx = await ensureAccessContext(req);
    if (!ctx) return res.status(403).json({ error: 'Forbidden' });

    const auth = await authorizeApprovalAction({
      workflow: 'client_import',
      entityId: req.params.id,
      subCompanyId,
      actorRoleKey: ctx.roleKey,
      actorPermissions: ctx.permissions,
      action: 'approve',
    });
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const pending = await prisma.pendingImportedClient.findUnique({
      where: { id: req.params.id },
      include: { importedBy: { select: { role: true } } },
    });
    if (!pending) return res.status(404).json({ error: 'Pending import not found' });
    if (pending.subCompanyId !== subCompanyId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const stagedContacts: Array<z.infer<typeof importContactSchema>> = Array.isArray(pending.contacts)
      ? (pending.contacts as unknown as Array<z.infer<typeof importContactSchema>>)
      : [];

    if (mode === 'append') {
      const target = await prisma.client.findUnique({
        where: { id: targetClientId! },
        select: { id: true },
      });
      if (!target) return res.status(404).json({ error: 'Target client not found' });

      if (stagedContacts.length === 0) {
        await prisma.pendingImportedClient.delete({ where: { id: pending.id } });
        return res.json({ mode, clientId: target.id, appended: 0 });
      }

      await prisma.$transaction(async (tx) => {
        await tx.clientContact.createMany({
          data: stagedContacts.map((c) => ({
            clientId: target.id,
            name: c.name.trim(),
            title: c.title?.trim() || null,
            email: c.email?.trim().toLowerCase() || null,
            phone: c.phone?.trim() || null,
            phoneExtension: c.extension?.trim() || null,
            linkedin: c.linkedin?.trim() || null,
            isPrimary: false,
          })),
        });
        if (pending.industry && pending.industry.trim()) {
          const industryName = pending.industry.trim();
          await tx.allowedIndustry.upsert({
            where: { subCompanyId_name: { subCompanyId, name: industryName } },
            update: {},
            create: { subCompanyId, name: industryName },
          });
        }
        await tx.pendingImportedClient.delete({ where: { id: pending.id } });
      });
      await invalidateClientListCache(subCompanyId);
      await notifyImportUploadersOfApproval({
        subCompanyId,
        actorUserId: req.user!.sub,
        groups: [
          {
            importedById: pending.importedById,
            count: 1,
            sampleName: pending.name,
            clientId: target.id,
          },
        ],
      });
      return res.json({ mode, clientId: target.id, appended: stagedContacts.length });
    }

    // mode === 'new' or 'branch' — create a fresh Client.
    const slug = pending.name.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'client';
    const corporateCode = `${slug}-${Date.now()}`;
    const visibilitySetting = await prisma.clientVisibilitySetting.findUnique({
      where: { subCompanyId },
      select: { days: true },
    });
    const lockDays = defaultLockDays(visibilitySetting?.days);
    const importerRole = pending.importedBy?.role ?? undefined;
    const visibility = resolveClientVisibility({ creatorRole: importerRole, lockDays });

    // createClient requires ≥1 contact; if the staged row has none, synthesize a placeholder.
    const contactRows = stagedContacts.length > 0
      ? stagedContacts.map((c, i) => ({
          name: c.name.trim() || pending.name.trim(),
          title: c.title?.trim() || null,
          email: c.email?.trim().toLowerCase() || null,
          phone: c.phone?.trim() || null,
          phoneExtension: c.extension?.trim() || null,
          linkedin: c.linkedin?.trim() || null,
          isPrimary: i === 0,
        }))
      : [{
          name: pending.name.trim(),
          title: null,
          email: null,
          phone: null,
          phoneExtension: null,
          linkedin: null,
          isPrimary: true,
        }];

    let parentClientId: string | null = null;
    if (mode === 'branch') {
      const parent = await prisma.client.findUnique({
        where: { id: targetClientId! },
        select: { id: true },
      });
      if (!parent) return res.status(404).json({ error: 'Parent client not found' });
      parentClientId = parent.id;
    }

    const uniqueTags = [...new Set((pending.tags ?? []).map((t) => t.trim()).filter(Boolean))];

    const created = await prisma.$transaction(async (tx) => {
      const client = await tx.client.create({
        data: {
          corporateCode,
          name: pending.name.trim(),
          industry: pending.industry?.trim() || null,
          location: pending.location?.trim() || null,
          address: pending.address?.trim() || null,
          companySize: pending.companySize?.trim() || pending.employees?.trim() || null,
          status: 'contacted',
          visibility,
          createdByRole: importerRole ?? null,
          ...(visibility === 'global' ? { visibilityPromotedAt: new Date() } : {}),
          parentClientId,
          importSourceId: pending.sourceId?.trim() || null,
        },
      });

      await tx.clientContact.createMany({
        data: contactRows.map((c) => ({
          clientId: client.id,
          name: c.name,
          title: c.title,
          email: c.email,
          phone: c.phone,
          phoneExtension: c.phoneExtension,
          linkedin: c.linkedin,
          isPrimary: c.isPrimary,
        })),
      });

      await tx.clientSubCompany.create({
        data: { clientId: client.id, subCompanyId, status: 'contacted' },
      });

      if (uniqueTags.length > 0) {
        await tx.clientTag.createMany({
          data: uniqueTags.map((tag) => ({ clientId: client.id, subCompanyId, tag })),
          skipDuplicates: true,
        });
      }

      if (pending.industry && pending.industry.trim()) {
        const industryName = pending.industry.trim();
        await tx.allowedIndustry.upsert({
          where: { subCompanyId_name: { subCompanyId, name: industryName } },
          update: {},
          create: { subCompanyId, name: industryName },
        });
      }

      await tx.pendingImportedClient.delete({ where: { id: pending.id } });

      return client;
    });

    await afterClientVisibilityChange(subCompanyId, visibility);
    await notifyImportUploadersOfApproval({
      subCompanyId,
      actorUserId: req.user!.sub,
      groups: [
        {
          importedById: pending.importedById,
          count: 1,
          sampleName: created.name,
          clientId: created.id,
        },
      ],
    });
    return res.status(201).json({
      mode,
      clientId: created.id,
      parentClientId,
      visibility,
      visibilityNote: describeClientVisibilityOutcome(lockDays, visibility),
    });
  }
);

clientRouter.delete(
  '/pending-imports/:id',
  authenticate,
  requirePermission('clients:approve'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    const record = await prisma.pendingImportedClient.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ error: 'Not found' });
    if (record.subCompanyId !== subCompanyId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await prisma.pendingImportedClient.delete({ where: { id: req.params.id } });
    return res.status(204).send();
  }
);

/** GET /clients/pending-submissions — manual Add Client queue (agency or global database). */
clientRouter.get('/pending-submissions', async (req: Request, res: Response) => {
  const ctx = await ensureAccessContext(req);
  const scope = typeof req.query.scope === 'string' ? req.query.scope : undefined;

  if (isDatabaseManagerRole(ctx?.roleKey)) {
    const scopeSubCompanyId = parseSubCompanyIdQuery(req);
    const allowedAgencyIds = await resolveAllowedSubCompanyIds(req.user!, req);
    if (scopeSubCompanyId && !allowedAgencyIds.includes(scopeSubCompanyId)) {
      return res.status(403).json({ error: 'Agency not in your scope' });
    }
    const where = (
      scope === 'global'
        ? { submissionSource: 'global_database' as const, submittedById: req.user!.sub }
        : scopeSubCompanyId
          ? {
              submissionSource: 'agency' as const,
              submittedById: req.user!.sub,
              subCompanyId: scopeSubCompanyId,
            }
          : {
              submittedById: req.user!.sub,
              OR: [
                { submissionSource: 'global_database' as const },
                ...(allowedAgencyIds.length > 0
                  ? [{ submissionSource: 'agency' as const, subCompanyId: { in: allowedAgencyIds } }]
                  : []),
              ],
            }
    ) as Prisma.PendingClientSubmissionWhereInput;
    const rows = await prisma.pendingClientSubmission.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      include: {
        submittedBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
        managerApprovedBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
      },
    });
    return res.json(rows);
  }

  if (!(await assertPendingQueueAccess(req, res))) return;

  if (scope === 'global') {
    const rows = await prisma.pendingClientSubmission.findMany({
      where: { submissionSource: 'global_database' },
      orderBy: { submittedAt: 'desc' },
      include: {
        submittedBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
        managerApprovedBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
      },
    });
    return res.json(rows);
  }

  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
  const rows = await prisma.pendingClientSubmission.findMany({
    where: { subCompanyId, submissionSource: 'agency' },
    orderBy: { submittedAt: 'desc' },
    include: {
      submittedBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
      managerApprovedBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
    },
  });
  return res.json(rows);
});

/** POST /clients/pending-submissions/:id/manager-approve — forward to next approval step (legacy alias). */
clientRouter.post(
  '/pending-submissions/:id/manager-approve',
  requirePermission('clients:write'),
  requirePermission('clients:manager_recommend'),
  async (req: Request, res: Response) => {
    const pendingCtx = await resolvePendingSubmissionApprovalContext(req.params.id);
    if (!pendingCtx) return res.status(404).json({ error: 'Not found' });

    const ctx = await ensureAccessContext(req);
    if (!ctx) return res.status(403).json({ error: 'Forbidden' });

    const result = await performApprovalAction({
      workflow: pendingCtx.workflow,
      entityId: req.params.id,
      subCompanyId: pendingCtx.subCompanyId,
      actorUserId: req.user!.sub,
      actorRoleKey: ctx.roleKey,
      actorPermissions: ctx.permissions,
      action: 'forward',
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    const updated = await prisma.pendingClientSubmission.findUnique({
      where: { id: req.params.id },
      include: {
        submittedBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
        managerApprovedBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
      },
    });
    return res.status(200).json(updated);
  }
);

/** POST /clients/pending-submissions/:id/approve — final approve via approval chain. */
clientRouter.post(
  '/pending-submissions/:id/approve',
  requirePermission('clients:write'),
  requirePermission('clients:approve'),
  async (req: Request, res: Response) => {
    const pendingCtx = await resolvePendingSubmissionApprovalContext(req.params.id);
    if (!pendingCtx) return res.status(404).json({ error: 'Not found' });
    const ctx = await ensureAccessContext(req);
    if (!ctx) return res.status(403).json({ error: 'Forbidden' });

    const result = await performApprovalAction({
      workflow: pendingCtx.workflow,
      entityId: req.params.id,
      subCompanyId: pendingCtx.subCompanyId,
      actorUserId: req.user!.sub,
      actorRoleKey: ctx.roleKey,
      actorPermissions: ctx.permissions,
      action: 'approve',
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    const created = result.data as { tags?: { tag: string }[] } | undefined;
    return res.status(201).json({
      ...(created ?? {}),
      pendingSubmission: false,
      tags: (created?.tags as { tag: string }[] | undefined)?.map((t) => t.tag) ?? [],
    });
  }
);

/** DELETE /clients/pending-submissions/:id — reject via approval chain. */
clientRouter.delete(
  '/pending-submissions/:id',
  requirePermission('clients:approve'),
  async (req: Request, res: Response) => {
    const pendingCtx = await resolvePendingSubmissionApprovalContext(req.params.id);
    if (!pendingCtx) return res.status(404).json({ error: 'Not found' });
    const ctx = await ensureAccessContext(req);
    if (!ctx) return res.status(403).json({ error: 'Forbidden' });

    const row = await prisma.pendingClientSubmission.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Not found' });

    const result = await performApprovalAction({
      workflow: pendingCtx.workflow,
      entityId: row.id,
      subCompanyId: pendingCtx.subCompanyId,
      actorUserId: req.user!.sub,
      actorRoleKey: ctx.roleKey,
      actorPermissions: ctx.permissions,
      action: 'reject',
      remarks: 'Rejected',
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    const actor = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: { firstName: true, lastName: true, email: true },
    });
    const userName = formatUserDisplayName(actor ?? { email: req.user?.email ?? null });
    const logSubCompanyId =
      row.subCompanyId ??
      (await prisma.user.findUnique({ where: { id: req.user!.sub }, select: { subCompanyId: true } }))?.subCompanyId ??
      row.submittedById;
    await createActivityLog({
      userId: req.user!.sub,
      userName,
      subCompanyId: logSubCompanyId,
      type: 'client_pending_submission',
      description: `Rejected pending client submission "${row.name}"`,
      metadata: { pendingSubmissionId: row.id, clientName: row.name },
    });

    void dispatchNotificationToUser({
      userId: row.submittedById,
      subCompanyId: logSubCompanyId,
      eventKey: 'client_submission_declined',
      context: { entityLabel: row.name, actorName: userName },
      relatedId: row.id,
    }).catch(() => {});
    emitToUsers([row.submittedById, req.user!.sub], 'client:refresh', { subCompanyId: logSubCompanyId });

    return res.status(204).send();
  }
);

/** GET /clients/pending-edits — manual client edit queue for this agency only. */
clientRouter.get('/pending-edits', async (req: Request, res: Response) => {
  if (!(await assertPendingQueueAccess(req, res))) return;
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
  const rows = await prisma.pendingClientEdit.findMany({
    where: { subCompanyId },
    orderBy: { submittedAt: 'desc' },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          corporateCode: true,
          industry: true,
          location: true,
          address: true,
          companySize: true,
          contacts: {
            select: {
              id: true,
              name: true,
              title: true,
              email: true,
              phone: true,
              phoneExtension: true,
              linkedin: true,
              website: true,
              isPrimary: true,
            },
            orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
          },
          tags: { where: { subCompanyId }, select: { tag: true } },
        },
      },
      submittedBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
      managerApprovedBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
    },
  });
  return res.json(
    rows.map((row) => ({
      ...row,
      client: {
        ...row.client,
        tags: row.client.tags.map((t) => t.tag),
      },
    })),
  );
});

/** POST /clients/pending-edits/:id/manager-approve — forward to next approval step (legacy alias). */
clientRouter.post(
  '/pending-edits/:id/manager-approve',
  requirePermission('clients:write'),
  requirePermission('clients:manager_recommend'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    const ctx = await ensureAccessContext(req);
    if (!ctx) return res.status(403).json({ error: 'Forbidden' });

    const result = await performApprovalAction({
      workflow: 'client_manual_edit',
      entityId: req.params.id,
      subCompanyId,
      actorUserId: req.user!.sub,
      actorRoleKey: ctx.roleKey,
      actorPermissions: ctx.permissions,
      action: 'forward',
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    const updated = await prisma.pendingClientEdit.findUnique({
      where: { id: req.params.id },
      include: {
        client: { select: { id: true, name: true, corporateCode: true } },
        submittedBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
        managerApprovedBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
      },
    });
    return res.status(200).json(updated);
  },
);

/** POST /clients/pending-edits/:id/approve — final approve via approval chain. */
clientRouter.post(
  '/pending-edits/:id/approve',
  requirePermission('clients:write'),
  requirePermission('clients:approve'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    const ctx = await ensureAccessContext(req);
    if (!ctx) return res.status(403).json({ error: 'Forbidden' });

    const result = await performApprovalAction({
      workflow: 'client_manual_edit',
      entityId: req.params.id,
      subCompanyId,
      actorUserId: req.user!.sub,
      actorRoleKey: ctx.roleKey,
      actorPermissions: ctx.permissions,
      action: 'approve',
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    const client = result.data;
    return res.status(200).json({
      ...(client as object),
      pendingEdit: false,
    });
  },
);

/** DELETE /clients/pending-edits/:id — reject via approval chain. */
clientRouter.delete(
  '/pending-edits/:id',
  requirePermission('clients:approve'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    const ctx = await ensureAccessContext(req);
    if (!ctx) return res.status(403).json({ error: 'Forbidden' });

    const row = await prisma.pendingClientEdit.findFirst({
      where: { id: req.params.id, subCompanyId },
    });
    if (!row) return res.status(404).json({ error: 'Not found' });

    const result = await performApprovalAction({
      workflow: 'client_manual_edit',
      entityId: row.id,
      subCompanyId,
      actorUserId: req.user!.sub,
      actorRoleKey: ctx.roleKey,
      actorPermissions: ctx.permissions,
      action: 'reject',
      remarks: 'Rejected',
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    const actor = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: { firstName: true, lastName: true, email: true },
    });
    const userName = formatUserDisplayName(actor ?? { email: req.user?.email ?? null });
    await createActivityLog({
      userId: req.user!.sub,
      userName,
      subCompanyId,
      type: 'client_pending_edit',
      description: `Rejected pending client edit for "${row.name}"`,
      metadata: { pendingEditId: row.id, clientId: row.clientId, clientName: row.name },
    });

    void dispatchNotificationToUser({
      userId: row.submittedById,
      subCompanyId,
      eventKey: 'client_edit_declined',
      context: { entityLabel: row.name, actorName: userName },
      relatedId: row.id,
    }).catch(() => {});
    emitToUsers([row.submittedById, req.user!.sub], 'client:refresh', { subCompanyId });

    return res.status(204).send();
  },
);

/** GET /clients/:id/lead-history — agency-scoped lead attempt history for this client. */
clientRouter.get('/:id/lead-history', async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required to view lead history' });
  }

  const detailScope = await resolveClientDetailScope(req, subCompanyId);

  const accessible = await assertClientVisibleToRequester({
    clientIdOrCorporateCode: req.params.id,
    subCompanyId,
    role: req.user?.role,
    viewerUserId: effectiveActorId(req),
  });
  if (!accessible) return res.status(404).json({ error: 'Client not found' });

  const historyWhere: Prisma.LeadWhereInput = leadHistoryWhereForClient(detailScope, accessible.id);
  if (await isViewerAssociateScope(req.user?.role) && req.user?.sub) {
    historyWhere.ownerId = effectiveActorId(req);
  }

  const history = await prisma.lead.findMany({
    where: historyWhere,
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    include: {
      owner: { select: { id: true, firstName: true, lastName: true, email: true } },
      closedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  // For closed_won leads, attach the winning proposal's creator so the UI can
  // render a "Won by" ribbon distinct from owner/closedBy.
  const wonLeadIds = history.filter((l) => l.status === 'closed_won').map((l) => l.id);
  const winningByLeadId = new Map<string, { id: string; firstName: string | null; lastName: string | null; email: string }>();
  if (wonLeadIds.length > 0) {
    const winningProposals = await prisma.proposal.findMany({
      where: {
        leadId: { in: wonLeadIds },
        status: 'approved',
      },
      orderBy: [
        { activatedAt: 'desc' },
        { reviewedAt: 'desc' },
        { createdAt: 'desc' },
      ],
      select: {
        leadId: true,
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    for (const p of winningProposals) {
      if (!winningByLeadId.has(p.leadId) && p.createdBy) {
        winningByLeadId.set(p.leadId, p.createdBy);
      }
    }
  }

  // For reassigned leads, fetch the completed reassignment request to get numberOfPositions
  const reassignedLeadIds = history
    .filter((l) => l.reassignedFromLeadId !== null)
    .map((l) => l.reassignedFromLeadId as string);
  const positionsBySourceLeadId = new Map<string, number | null>();
  if (reassignedLeadIds.length > 0) {
    const reassignmentRequests = await prisma.leadReassignmentRequest.findMany({
      where: { leadId: { in: reassignedLeadIds }, status: 'completed' },
      select: { leadId: true, numberOfPositions: true },
      orderBy: { reviewedAt: 'desc' },
    });
    for (const r of reassignmentRequests) {
      if (!positionsBySourceLeadId.has(r.leadId)) {
        positionsBySourceLeadId.set(r.leadId, r.numberOfPositions);
      }
    }
  }

  const data = history.map((lead) => ({
    ...lead,
    wonBy: winningByLeadId.get(lead.id) ?? null,
    numberOfPositions: lead.reassignedFromLeadId
      ? (positionsBySourceLeadId.get(lead.reassignedFromLeadId) ?? null)
      : null,
  }));

  return res.json({ data });
});

clientRouter.get(
  '/pending-contact-imports',
  authenticate,
  requirePermission('clients:read'),
  async (req: Request, res: Response) => {
    const ctx = await ensureAccessContext(req);
    const scope = typeof req.query.scope === 'string' ? req.query.scope : undefined;

    if (isDatabaseManagerRole(ctx?.roleKey)) {
      const scopeSubCompanyId = parseSubCompanyIdQuery(req);
      const allowedAgencyIds = await resolveAllowedSubCompanyIds(req.user!, req);
      if (scopeSubCompanyId && !allowedAgencyIds.includes(scopeSubCompanyId)) {
        return res.status(403).json({ error: 'Agency not in your scope' });
      }
      const where = (
        scope === 'global'
          ? { submissionSource: 'global_database' as const, importedById: req.user!.sub }
          : scopeSubCompanyId
            ? {
                submissionSource: 'agency' as const,
                importedById: req.user!.sub,
                subCompanyId: scopeSubCompanyId,
              }
            : {
                importedById: req.user!.sub,
                OR: [
                  { submissionSource: 'global_database' as const },
                  ...(allowedAgencyIds.length > 0
                    ? [{ submissionSource: 'agency' as const, subCompanyId: { in: allowedAgencyIds } }]
                    : []),
                ],
              }
      ) as Prisma.PendingImportedContactWhereInput;
      const records = await prisma.pendingImportedContact.findMany({
        where,
        orderBy: { importedAt: 'desc' },
        include: {
          importedBy: { select: { firstName: true, lastName: true } },
          targetClient: { select: { id: true, name: true, corporateCode: true } },
        },
      });
      return res.json(records);
    }

    if (!(await assertPendingQueueAccess(req, res))) return;

    if (scope === 'global') {
      const records = await prisma.pendingImportedContact.findMany({
        where: { submissionSource: 'global_database' },
        orderBy: { importedAt: 'desc' },
        include: {
          importedBy: { select: { firstName: true, lastName: true } },
          targetClient: { select: { id: true, name: true, corporateCode: true } },
        },
      });
      return res.json(records);
    }

    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    const records = await prisma.pendingImportedContact.findMany({
      where: { subCompanyId, submissionSource: 'agency' },
      orderBy: { importedAt: 'desc' },
      include: {
        importedBy: { select: { firstName: true, lastName: true } },
        targetClient: { select: { id: true, name: true, corporateCode: true } },
      },
    });
    return res.json(records);
  },
);

clientRouter.get('/:id', async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required to view client' });
  }

  const detailScope = await resolveClientDetailScope(req, subCompanyId);
  const statusAgencyId = detailScope.viewAllAgencies
    ? detailScope.primarySubCompanyId
    : subCompanyId;

  const { id } = req.params;
  const visClause = visibilityWhere([subCompanyId]);
  // Support both DB id (uuid) and business identity (corporateCode)
  const client = await prisma.client.findFirst({
    where: {
      AND: [visClause, { OR: [{ id }, { corporateCode: { equals: id, mode: 'insensitive' } }] }],
    },
    include: {
      contacts: true,
      locations: true,
      tags: { where: tagsForClientDetail(detailScope) },
      notes: {
        where: notesForClientDetail(detailScope, effectiveActorId(req)),
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
      clientSubCompanies: { where: { subCompanyId: statusAgencyId }, take: 1 },
      calls: { where: callsForClientDetail(detailScope), orderBy: { timestamp: 'desc' }, take: 20 },
      followUps: { where: followUpsForClientDetail(detailScope), orderBy: { dueDate: 'asc' }, take: 20 },
      meetings: { where: meetingsForClientDetail(detailScope), orderBy: { startTime: 'desc' }, take: 20 },
    },
  });
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  const summaryAgencyIds = detailScope.viewAllAgencies
    ? detailScope.subCompanyIds
    : [subCompanyId];
  const [leadSummaries, outreachSummaries] = await Promise.all([
    getLeadSummariesForClients(summaryAgencyIds, [client.id]),
    getClientOutreachSummaries(summaryAgencyIds, [client.id]),
  ]);
  const agencyView = client.clientSubCompanies?.[0];
  const activeLead = leadSummaries.activeLeadByClientId.get(client.id);
  const latestLostLead = leadSummaries.latestLostLeadByClientId.get(client.id);
  const effectiveStatus = agencyView?.status ?? client.status;
  const viewerUserId = effectiveActorId(req);
  const viewerRole = req.user?.role;

  if (
    viewerUserId &&
    await isViewerAssociateScope(viewerRole) &&
    (await isUserRestrictedFromClient(client.id, viewerUserId))
  ) {
    return res.status(404).json({ error: 'Client not found' });
  }

  if (
    await clientLeadHiddenFromViewer({
      role: viewerRole,
      viewerUserId,
      subCompanyId,
      activeLead: activeLead ? { ownerId: activeLead.ownerId, status: activeLead.status } : undefined,
      clientStatus: effectiveStatus,
    })
  ) {
    return res.status(404).json({ error: 'Client not found' });
  }

  const restrictedUsers = !await isViewerAssociateScope(viewerRole)
    ? await getRestrictedUserIds(client.id)
    : undefined;

  const positionsClosed = activeLead?.status === 'closed_won'
    ? await getPositionsClosedForClient(client.id, subCompanyId)
    : 0;

  const ownershipUser = client.ownershipUserId
    ? await prisma.user.findUnique({
        where: { id: client.ownershipUserId },
        select: { id: true, firstName: true, lastName: true, email: true },
      })
    : null;
  const ownershipUserName = ownershipUser
    ? (`${ownershipUser.firstName ?? ''} ${ownershipUser.lastName ?? ''}`.trim() || ownershipUser.email || null)
    : null;

  const payload = {
    ...client,
    clientSubCompanies: undefined,
    ownershipUserName,
    status: agencyView?.status ?? client.status,
    hasOpenLead: leadSummaries.openLeadClientIds.has(client.id),
    hasOutreach: outreachSummaries.outreachClientIds.has(client.id),
    latestOutreachByName: outreachSummaries.latestOutreachByName.get(client.id),
    activeLeadId: activeLead?.id,
    activeLeadOwnerId: activeLead?.ownerId,
    activeLeadOwnerName: activeLead ? formatContactedByName(activeLead.owner) : undefined,
    assignedOwnerId: activeLead?.ownerId,
    assignedOwnerName: activeLead ? formatContactedByName(activeLead.owner) : undefined,
    latestLostLeadId: latestLostLead?.id,
    latestLostById: latestLostLead?.ownerId,
    latestLostByName: latestLostLead ? formatContactedByName(latestLostLead.owner) ?? 'Unknown' : undefined,
    latestLostAt: latestLostLead ? (latestLostLead.closedAt ?? latestLostLead.updatedAt) : undefined,
    latestLossReason: latestLostLead?.lossReason ?? undefined,
    unsubscribeRestricted: isClosedWonActiveClientFromView({
      agencyStatus: effectiveStatus,
      activeLeadStatus: activeLead?.status,
    }),
    isClosedWon: activeLead?.status === 'closed_won',
    positionsClosed,
    ...(restrictedUsers !== undefined ? { restrictedUsers } : {}),
  };

  return res.json(
    viewerUserId && await isViewerAssociateScope(viewerRole)
      ? redactClientForAssociateViewer(payload, viewerUserId)
      : payload,
  );
});

const clientOwnershipSchema = z.object({
  ownershipType: z.enum(['management', 'associate']),
  ownershipUserId: z.string().uuid().nullable().optional(),
});

/** PATCH /clients/:id/ownership — users with clients:ownership permission set ownership type. */
clientRouter.patch(
  '/:id/ownership',
  requirePermission('clients:ownership'),
  async (req: Request, res: Response) => {
    const parsed = clientOwnershipSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const { ownershipType, ownershipUserId } = parsed.data;

    if (ownershipType === 'associate' && ownershipUserId) {
      const user = await prisma.user.findFirst({
        where: { id: ownershipUserId, isActive: true },
        select: { id: true },
      });
      if (!user) return res.status(400).json({ error: 'User not found' });
    }

    const client = await prisma.client.findFirst({
      where: { OR: [{ id: req.params.id }, { corporateCode: { equals: req.params.id, mode: 'insensitive' } }] },
      select: { id: true, ownershipType: true, ownershipUserId: true },
    });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const subCompanyId = await getEffectiveSubCompanyId(req) ?? req.user!.subCompanyId;
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    const actorId = req.user!.sub;
    const actor = await prisma.user.findUnique({
      where: { id: actorId },
      select: { firstName: true, lastName: true, email: true },
    });
    const actorName = actor
      ? `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim() || actor.email || 'User'
      : 'User';

    await prisma.$transaction(async (tx) => {
      await applyOwnershipChange({
        tx,
        clientId: client.id,
        subCompanyId,
        actorId,
        actorName,
        previous: {
          type: (client.ownershipType as 'management' | 'associate' | null) ?? null,
          userId: client.ownershipUserId ?? null,
        },
        next: { type: ownershipType, userId: ownershipUserId ?? null },
        source: 'manual',
      });
    });

    await invalidateClientListCacheForMainOrg(subCompanyId);
    await emitClientRefreshForMainOrg(subCompanyId);

    return res.json({ success: true });
  },
);

const clientRestrictionSchema = z.object({
  userId: z.string().uuid(),
  restricted: z.boolean(),
});

/** PATCH /clients/:id/restrictions — super users grant/revoke associate access to a client. */
clientRouter.patch(
  '/:id/restrictions',
  requirePermission('clients:write'),
  async (req: Request, res: Response) => {
    const ctx = await ensureAccessContext(req);
    if (!ctx || !canViewAllDataInAgency(ctx)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) {
      return res.status(403).json({ error: 'Agency context required' });
    }
    const parsed = clientRestrictionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    }

    const accessible = await assertClientVisibleToRequester({
      clientIdOrCorporateCode: req.params.id,
      subCompanyId,
      role: req.user?.role,
      viewerUserId: effectiveActorId(req),
    });
    if (!accessible) return res.status(404).json({ error: 'Client not found' });

    const targetUser = await prisma.user.findFirst({
      where: { id: parsed.data.userId, subCompanyId, isActive: true },
      select: { id: true },
    });
    if (!targetUser) {
      return res.status(400).json({ error: 'User not found in this agency' });
    }

    const restrictedUsers = await setUserClientRestriction(
      accessible.id,
      parsed.data.userId,
      parsed.data.restricted,
    );
    await invalidateClientListCache(subCompanyId);

    return res.json({ restrictedUsers });
  },
);

/** GET /clients/:id/activity — client-specific activity timeline (agency-scoped). */
clientRouter.get('/:id/activity', async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required to view client activity' });
  }

  const clientId = req.params.id;
  const accessible = await assertClientVisibleToRequester({
    clientIdOrCorporateCode: clientId,
    subCompanyId,
    role: req.user?.role,
    viewerUserId: effectiveActorId(req),
  });
  if (!accessible) return res.status(404).json({ error: 'Client not found' });

  const viewerUserId = effectiveActorId(req);
  const viewerRole = req.user?.role;
  if (viewerUserId) {
    const leadSummaries = await getLeadSummariesForClients([subCompanyId], [accessible.id]);
    const activeLead = leadSummaries.activeLeadByClientId.get(accessible.id);
    const effectiveStatus = accessible.agencyStatus ?? accessible.status;
    if (
      await clientLeadHiddenFromViewer({
        role: viewerRole,
        viewerUserId,
        subCompanyId,
        activeLead: activeLead ? { ownerId: activeLead.ownerId, status: activeLead.status } : undefined,
        clientStatus: effectiveStatus,
      })
    ) {
      return res.status(404).json({ error: 'Client not found' });
    }
  }

  const page = Number.parseInt(String(req.query.page ?? '1'), 10) || 1;
  const limitRaw = Number.parseInt(String(req.query.limit ?? '50'), 10) || 50;
  const limit = Math.min(Math.max(limitRaw, 1), 200);
  const skip = (page - 1) * limit;

  const detailScope = await resolveClientDetailScope(req, subCompanyId);
  const where: Prisma.ActivityLogWhereInput = activityLogsForClientDetail(detailScope, accessible.id);

  const [total, list] = await Promise.all([
    prisma.activityLog.count({ where }),
    prisma.activityLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  return res.json({
    data: list,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

const agencyStatusSchema = z.object({ status: z.nativeEnum(ClientStatus) });
const noteSchema = z.object({
  content: z.string().min(1).max(50000),
  isPinned: z.boolean().optional(),
  /** Legacy: when omitted, derived from `visibility`. */
  isPublic: z.boolean().optional(),
  visibility: z.enum(['only_me', 'public', 'shared', 'public_global']).optional(),
  sharedWith: z.array(z.string().uuid()).optional(),
});
const tagSchema = z.object({ tag: z.string().min(1).max(100).trim() });

/** POST /clients — create client with primary location and contacts (Add Client flow) */
clientRouter.post(
  '/',
  requirePermission('clients:write'),
  async (req: Request, res: Response) => {
    const parsed = createClientSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const data = parsed.data;

    if (isDatabaseManagerRole(req.user?.role) || isSuperUserScreenRole(req.user?.role)) {
      try {
        const isDbManager = isDatabaseManagerRole(req.user?.role);
        const orgMode = isDbManager
          ? await getDatabaseManagerDestinationMode()
          : await getSuperUserDestinationMode();
        const resolved = resolveClientDestinationMode(orgMode, data.databaseDestination);
        if ('error' in resolved) {
          return res.status(400).json({ error: resolved.error });
        }

        if (!isDbManager && resolved.action === 'agency') {
          const writeTarget = await assertMultiAgencyWriteTarget(req);
          if (!writeTarget.ok) {
            return res.status(writeTarget.status).json({ error: writeTarget.error });
          }
        }

        const actor = await prisma.user.findUnique({
          where: { id: req.user!.sub },
          select: { firstName: true, lastName: true, email: true, role: true, subCompanyId: true },
        });
        const logSubCompanyId = actor?.subCompanyId ?? req.user!.subCompanyId ?? req.user!.sub;
        const submitCtx = await ensureAccessContext(req);
        const subCompanyId =
          resolved.action === 'agency' ? await getEffectiveSubCompanyId(req) : null;

        const result = await resolveDestinationManualCreate({
          userId: req.user!.sub,
          userEmail: req.user?.email,
          submitterRoleKey: req.user?.role ?? 'sales_associate',
          submitterPermissions: submitCtx?.permissions ?? [],
          data,
          action: resolved.action,
          subCompanyId,
          actorLabel: isDbManager ? 'Database Manager' : 'Super User',
          logSubCompanyId,
          agencyPathHandler: 'pending',
        });
        return res.status(result.status).json(result.body);
      } catch (err) {
        console.error('POST /clients (destination-aware)', err);
        return res.status(500).json({ error: 'Failed to submit client for approval' });
      }
    }

    const writeTarget = await assertMultiAgencyWriteTarget(req);
    if (!writeTarget.ok) {
      return res.status(writeTarget.status).json({ error: writeTarget.error });
    }

    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    try {
      const clientCreateActorId = effectiveActorId(req);
      const [actor, visibilitySetting, agencyRow] = await Promise.all([
        prisma.user.findUnique({
          where: { id: clientCreateActorId },
          select: { firstName: true, lastName: true, email: true, role: true },
        }),
        prisma.clientVisibilitySetting.findUnique({
          where: { subCompanyId },
          select: { days: true },
        }),
        prisma.subCompany.findUnique({
          where: { id: subCompanyId },
          select: { name: true },
        }),
      ]);

      const slug = data.name.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'client';
      const corporateCode = `${slug}-${Date.now()}`;

      const primaryContactIndex = data.contacts.findIndex((contact) => contact.isPrimary === true);
      const normalizedContacts = data.contacts.map((contact, index) => ({
        ...contact,
        isPrimary: primaryContactIndex >= 0 ? index === primaryContactIndex : index === 0,
      }));
      const uniqueTags = [...new Set((data.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];

      if (!(await clientManualCreateBypassesApproval(req.user?.role))) {
        const pendingRow = await prisma.pendingClientSubmission.create({
          data: {
            subCompanyId,
            submittedById: clientCreateActorId,
            name: data.name.trim(),
            industry: data.industry?.trim() ?? null,
            location: data.location?.trim() ?? null,
            address: data.address?.trim() ?? null,
            companySize: data.companySize?.trim() ?? null,
            tags: uniqueTags,
            contacts: normalizedContacts as unknown as Prisma.InputJsonValue,
            locationAddress: data.locationAddress
              ? (data.locationAddress as unknown as Prisma.InputJsonValue)
              : undefined,
            submitterRole: req.user?.role ?? null,
            currentStepIndex: 0,
            approvalChain: [],
          },
        });

        const submitCtx = await ensureAccessContext(req);
        const approval = await submitEntityForApproval({
          workflow: 'client_manual_add',
          entityId: pendingRow.id,
          subCompanyId,
          submitterUserId: clientCreateActorId,
          submitterRoleKey: req.user?.role ?? 'sales_associate',
          submitterPermissions: submitCtx?.permissions ?? [],
        });

        const userName = formatUserDisplayName(actor ?? { email: req.user?.email ?? null });
        await createActivityLog({
          userId: clientCreateActorId,
          userName,
          subCompanyId,
          type: 'client_pending_submission',
          description: approval.autoApproved
            ? `Client "${pendingRow.name}" approved via agency approval settings`
            : `Submitted client "${pendingRow.name}" for approval`,
          metadata: {
            pendingSubmissionId: pendingRow.id,
            clientName: pendingRow.name,
            autoApproved: approval.autoApproved,
          },
        });

        if (approval.autoApproved) {
          emitToUsers([...new Set([clientCreateActorId, req.user!.sub])], 'client:refresh', { subCompanyId });
          return res.status(201).json({
            pendingSubmission: false,
            autoApproved: true,
            name: pendingRow.name,
            message: 'Client was approved immediately per agency approval settings.',
          });
        }

        if (!approval.targetRoleKey) {
          return res.status(400).json({
            error: 'No approval path configured for client manual add. Check Settings → Approvals and Settings → Roles.',
          });
        }

        const approverIds = await notifyChainTargetUsers({
          subCompanyId,
          targetRoleKey: approval.targetRoleKey,
          eventKey: 'client_pending_submission_alert',
          context: { entityLabel: pendingRow.name, actorName: userName },
          link: '/clients?tab=pending',
          relatedId: pendingRow.id,
        });
        emitToUsers([...approverIds, ...new Set([clientCreateActorId, req.user!.sub])], 'client:refresh', { subCompanyId });

        return res.status(202).json({
          pendingSubmission: true,
          id: pendingRow.id,
          name: pendingRow.name,
          message:
            'Submitted for approval. After approval it will be available to your agency first, then shared with all agencies per Client Visibility settings.',
          storage: {
            subCompanyId,
            agencyName: agencyRow?.name ?? null,
            visibility: 'agency' as const,
            pending: true,
          },
        });
      }

      const lockDays = defaultLockDays(visibilitySetting?.days);
      const visibility = resolveClientVisibility({
        creatorRole: req.user?.role,
        lockDays,
      });

      const created = await prisma.$transaction(async (tx) =>
        performManualClientCreate(tx, {
          data,
          subCompanyId,
          corporateCode,
          visibility,
          createdByRole: req.user?.role ?? null,
        })
      );
      if (!created) return res.status(500).json({ error: 'Failed to load created client' });

      await afterClientVisibilityChange(subCompanyId, visibility);

      const userName = formatUserDisplayName(actor ?? { email: req.user?.email ?? null });
      const creatorName = userName;
      const creatorEmail = actor?.email ?? req.user?.email ?? '';
      const creatorRole = getRoleLabel(actor?.role ?? req.user?.role ?? '');

      await createActivityLog({
        userId: clientCreateActorId,
        userName,
        subCompanyId,
        type: 'client_created',
        description: `Created client ${created.name}`,
        metadata: {
          clientId: created.id,
          clientName: created.name,
        },
      });

      void (async () => {
        try {
          const [approverIds, agency] = await Promise.all([
            getClientApproverUserIds(subCompanyId, { excludeUserId: clientCreateActorId }),
            prisma.subCompany.findUnique({
              where: { id: subCompanyId },
              select: { name: true },
            }),
          ]);

          if (approverIds.length === 0) return;

          const recipients = await prisma.user.findMany({
            where: { id: { in: approverIds }, isActive: true },
            select: { id: true, email: true, firstName: true, lastName: true },
          });
          if (recipients.length === 0) return;

          const agencyName = agency?.name?.trim() || 'Unknown Agency';
          const agencyBranding = await getAgencyBranding(subCompanyId);
          const clientLocation = formatClientLocation(created);
          const clientLink = buildClientNotificationLink(created.id);
          const clientUrl = buildClientUrl(created.id);

          await dispatchNotification({
            eventKey: 'client_created_direct',
            userIds: recipients.map((recipient) => recipient.id),
            subCompanyId,
            context: { entityLabel: created.name, actorName: creatorName, agencyName },
            link: clientLink,
            relatedId: created.id,
          });

          emitToUsers(
            [...recipients.map((r) => r.id), ...new Set([clientCreateActorId, req.user!.sub])],
            'client:refresh',
            { subCompanyId }
          );

          void Promise.allSettled(
            recipients.map((recipient) =>
              sendClientCreatedEmail({
                toEmail: recipient.email,
                toName: formatUserDisplayName(recipient),
                creatorName,
                creatorEmail,
                creatorRole,
                clientName: created.name,
                clientIndustry: created.industry,
                clientLocation,
                agencyName,
                clientUrl,
                agency: agencyBranding,
              })
            )
          ).then((emailResults) => {
            emailResults.forEach((result, index) => {
              if (result.status === 'rejected') {
                console.error(`Failed to send client-created email to ${recipients[index]?.email}`, result.reason);
              }
            });
          });
        } catch (error) {
          console.error('Failed to send client-created notifications', error);
        }
      })();

      return res.status(201).json({
        ...created,
        visibility,
        pendingSubmission: false,
        tags: (created.tags as { tag: string }[]).map((t) => t.tag),
        storage: {
          subCompanyId,
          agencyName: agencyRow?.name ?? null,
          visibility,
        },
      });
    } catch (error) {
      console.error('Failed to create client', error);
      return res.status(500).json({ error: 'Failed to create client' });
    }
  }
);

/** Set agency-scoped status (tab: Active, Ex, Contacted, etc.) for the current user's agency */
clientRouter.patch(
  '/:id/agency-status',
  requirePermission('clients:write'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    const parsed = agencyStatusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    const accessible = await assertClientVisibleToRequester({
      clientIdOrCorporateCode: req.params.id,
      subCompanyId,
      role: req.user?.role,
      viewerUserId: effectiveActorId(req),
      skipLeadLock: true,
    });
    const client = accessible ? await prisma.client.findUnique({ where: { id: accessible.id } }) : null;
    if (!client) return res.status(404).json({ error: 'Client not found' });
    // Fetch previous status to determine transition
    const prevView = await prisma.clientSubCompany.findUnique({
      where: { clientId_subCompanyId: { clientId: client.id, subCompanyId } },
    });
    const prevStatus = prevView?.status ?? 'contacted';
    const newStatus = parsed.data.status;

    if (newStatus === ClientStatus.unsubscribed) {
      const guard = await assertClientUnsubscribeAllowed({
        clientId: client.id,
        subCompanyId,
      });
      if (!guard.ok) return res.status(403).json({ error: guard.error });
    }

    const view = await prisma.clientSubCompany.upsert({
      where: { clientId_subCompanyId: { clientId: client.id, subCompanyId } },
      create: { clientId: client.id, subCompanyId, status: newStatus },
      update: { status: newStatus, lastActivity: new Date() },
    });
    await invalidateClientListCache(subCompanyId);

    // Log activity for terminal status transitions
    if (prevStatus !== newStatus && (newStatus === 'unsubscribed' || newStatus === 'permanently_closed' || newStatus === 'ex' || prevStatus === 'unsubscribed' || prevStatus === 'permanently_closed' || prevStatus === 'ex')) {
      const actor = await prisma.user.findUnique({ where: { id: req.user!.sub }, select: { firstName: true, lastName: true, email: true } });
      const userName = formatUserDisplayName(actor ?? { email: req.user?.email ?? null });

      let description: string;
      let activityType: string;
      if (newStatus === 'unsubscribed') {
        activityType = 'client_unsubscribed';
        description = `Marked client ${client.name} as Unsubscribed`;
      } else if (newStatus === 'permanently_closed') {
        activityType = 'client_permanently_closed';
        description = `Marked client ${client.name} as Permanently Closed`;
      } else if (newStatus === 'ex') {
        activityType = 'client_marked_ex';
        description = `Marked client ${client.name} as Ex Client`;
      } else if (prevStatus === 'unsubscribed') {
        activityType = 'client_resubscribed';
        description = `Removed Unsubscribed status from client ${client.name}`;
      } else if (prevStatus === 'ex') {
        activityType = 'client_unmarked_ex';
        description = `Removed Ex Client status from client ${client.name}`;
      } else {
        activityType = 'client_reopened';
        description = `Removed Permanently Closed status from client ${client.name}`;
      }

      await createActivityLog({
        userId: req.user!.sub,
        userName,
        subCompanyId,
        type: activityType,
        description,
        metadata: {
          clientId: client.id,
          clientName: client.name,
          previousStatus: prevStatus,
          newStatus,
        },
      });

      // Send email to primary contact for terminal statuses
      if (newStatus === 'permanently_closed' || newStatus === 'unsubscribed') {
        const senderName = [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') || actor?.email || 'Team Member';
        void (async () => {
          try {
            const primaryContact = await prisma.clientContact.findFirst({
              where: { clientId: client.id, isPrimary: true },
              select: { id: true, name: true, email: true, isUnsubscribed: true },
            });
            if (!primaryContact?.email) return;
            const agency = await prisma.subCompany.findUnique({ where: { id: subCompanyId }, select: { name: true } });
            const agencyName = agency?.name || 'Wudox';
            const agencyBranding = await getAgencyBranding(subCompanyId);

            if (newStatus === 'permanently_closed') {
              await sendPermanentlyClosedEmail({
                toEmail: primaryContact.email,
                contactName: primaryContact.name,
                clientName: client.name,
                agencyName,
                senderName,
                agency: agencyBranding,
              });
            } else if (newStatus === 'unsubscribed') {
              await sendUnsubscribeEmail({
                toEmail: primaryContact.email,
                contactName: primaryContact.name,
                clientName: client.name,
                agencyName,
                senderName,
                agency: agencyBranding,
              });
              // Also mark the primary contact as unsubscribed
              if (!primaryContact.isUnsubscribed) {
                await prisma.clientContact.update({
                  where: { id: primaryContact.id },
                  data: { isUnsubscribed: true },
                });
              }
            }
          } catch (err) {
            console.error(`Failed to send ${newStatus} email`, err);
          }
        })();
      }
    }

    // Auto-manage "Ex" tag when ex status is toggled
    if (prevStatus !== newStatus && (newStatus === 'ex' || prevStatus === 'ex')) {
      try {
        if (newStatus === 'ex') {
          await prisma.clientTag.upsert({
            where: { clientId_subCompanyId_tag: { clientId: client.id, subCompanyId, tag: 'Ex' } },
            create: { clientId: client.id, subCompanyId, tag: 'Ex' },
            update: {},
          });
        } else if (prevStatus === 'ex') {
          await prisma.clientTag.deleteMany({
            where: { clientId: client.id, subCompanyId, tag: 'Ex' },
          });
        }
      } catch (err) {
        console.error('Failed to manage Ex tag', err);
      }
    }

    return res.json(view);
  }
);

/** Add a note. Agency-scoped unless isPublic; only director/operations_manager/super_admin can set isPublic. */
clientRouter.post(
  '/:id/notes',
  requirePermission('clients:write'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    const actorId = effectiveActorId(req);
    const accessible = await assertClientVisibleToRequester({
      clientIdOrCorporateCode: req.params.id,
      subCompanyId,
      role: req.user?.role,
      viewerUserId: actorId,
    });
    if (!accessible) return res.status(404).json({ error: 'Client not found' });
    const [client, author] = await Promise.all([
      prisma.client.findUnique({ where: { id: accessible.id } }),
      prisma.user.findUnique({ where: { id: actorId }, select: { firstName: true, lastName: true, role: true } }),
    ]);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Resolve visibility: explicit field wins; legacy isPublic boolean accepted for back-compat.
    const visibility: 'only_me' | 'public' | 'shared' | 'public_global' = parsed.data.visibility
      ?? (parsed.data.isPublic === true ? 'public' : 'only_me');

    // Capability checks
    const isGlobalCreator = await isGlobalCreatorRole(req);
    const canPublic = await requestHasPermission(req, 'clients:write');
    if (visibility === 'public' && !canPublic && !isGlobalCreator) {
      return res.status(403).json({ error: 'Not permitted to create public notes' });
    }
    if (visibility === 'public_global') {
      const canGlobal = await requestHasPermission(req, 'agencies:global');
      const canCrossOrg = await requestHasPermission(req, 'agencies:cross_org');
      if (!canGlobal && !canCrossOrg && !isGlobalCreator) {
        return res.status(403).json({ error: 'Not permitted to create cross-agency public notes' });
      }
    }

    // Validate sharedWith for "shared" visibility
    let sharedWith: string[] = [];
    if (visibility === 'shared') {
      const ids = parsed.data.sharedWith ?? [];
      if (ids.length === 0) {
        return res.status(400).json({ error: 'sharedWith must be non-empty when visibility is shared' });
      }
      const canGlobal = await requestHasPermission(req, 'agencies:global');
      const targets = await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, subCompanyId: true },
      });
      if (targets.length !== ids.length) {
        return res.status(400).json({ error: 'One or more sharedWith users not found' });
      }
      if (!canGlobal && !isGlobalCreator) {
        const outside = targets.some((u) => u.subCompanyId !== subCompanyId);
        if (outside) return res.status(403).json({ error: 'Cannot share with users outside your agency' });
      }
      sharedWith = ids;
    } else if (parsed.data.sharedWith?.length) {
      return res.status(400).json({ error: 'sharedWith may only be set when visibility is shared' });
    }

    const isPublic = visibility === 'public' || visibility === 'public_global';
    const userName = author ? `${author.firstName} ${author.lastName}`.trim() : 'User';
    const note = await prisma.clientNote.create({
      data: {
        clientId: accessible.id,
        subCompanyId,
        userId: actorId,
        userName,
        userRole: (author?.role ?? req.user!.role) as any,
        content: parsed.data.content,
        isPinned: parsed.data.isPinned ?? false,
        isPublic,
        visibility,
        sharedWith,
      },
    });

    await createActivityLog({
      userId: effectiveActorId(req),
      userName,
      subCompanyId,
      type: 'comment_added',
      description: `Added note for client ${client.name}`,
      metadata: {
        clientId: client.id,
        clientName: client.name,
        noteId: note.id,
        isPublic,
      },
    });

    return res.status(201).json(note);
  }
);

/** Edit own note (content + visibility). Super admin can edit any. */
clientRouter.patch(
  '/:id/notes/:noteId',
  requirePermission('clients:write'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    const parsed = z.object({
      content: z.string().min(1).max(50000).optional(),
      visibility: z.enum(['only_me', 'public', 'shared', 'public_global']).optional(),
      sharedWith: z.array(z.string().uuid()).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });

    const note = await prisma.clientNote.findUnique({
      where: { id: req.params.noteId },
      select: { id: true, clientId: true, userId: true, subCompanyId: true, visibility: true },
    });
    if (!note) return res.status(404).json({ error: 'Note not found' });

    // Authz: author only (super_admin bypasses requirePermission already)
    if (note.userId !== effectiveActorId(req) && req.user!.role !== 'super_admin') {
      return res.status(403).json({ error: 'You can only edit your own notes' });
    }

    // If visibility changes to public, must have capability
    const nextVisibility = parsed.data.visibility ?? note.visibility;
    let nextSharedWith: string[] | undefined;
    if (parsed.data.visibility === 'public') {
      const canPublic = await requestHasPermission(req, 'clients:write');
      const isGlobal = await isGlobalCreatorRole(req);
      if (!canPublic && !isGlobal) {
        return res.status(403).json({ error: 'Not permitted to make notes public' });
      }
    }
    if (parsed.data.visibility === 'public_global') {
      const canGlobal = await requestHasPermission(req, 'agencies:global');
      const canCrossOrg = await requestHasPermission(req, 'agencies:cross_org');
      const isGlobal = await isGlobalCreatorRole(req);
      if (!canGlobal && !canCrossOrg && !isGlobal) {
        return res.status(403).json({ error: 'Not permitted to make notes visible to all agencies' });
      }
    }
    if (parsed.data.visibility === 'shared') {
      const ids = parsed.data.sharedWith ?? [];
      if (ids.length === 0) return res.status(400).json({ error: 'sharedWith must be non-empty when visibility is shared' });
      const canGlobal = await requestHasPermission(req, 'agencies:global');
      const isGlobal = await isGlobalCreatorRole(req);
      const targets = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, subCompanyId: true } });
      if (targets.length !== ids.length) return res.status(400).json({ error: 'One or more sharedWith users not found' });
      if (!canGlobal && !isGlobal) {
        const outside = targets.some((u) => u.subCompanyId !== subCompanyId);
        if (outside) return res.status(403).json({ error: 'Cannot share with users outside your agency' });
      }
      nextSharedWith = ids;
    } else if (parsed.data.visibility !== undefined) {
      // visibility is 'only_me' or 'public' — clear any previous sharedWith
      nextSharedWith = [];
    }

    const updated = await prisma.clientNote.update({
      where: { id: note.id },
      data: {
        ...(parsed.data.content !== undefined ? { content: parsed.data.content } : {}),
        ...(parsed.data.visibility !== undefined
          ? { visibility: nextVisibility, isPublic: nextVisibility === 'public' || nextVisibility === 'public_global' }
          : {}),
        ...(nextSharedWith !== undefined ? { sharedWith: nextSharedWith } : {}),
      },
    });
    return res.json(updated);
  },
);

/** Delete own note. Super admin can delete any. */
clientRouter.delete(
  '/:id/notes/:noteId',
  requirePermission('clients:write'),
  async (req: Request, res: Response) => {
    const note = await prisma.clientNote.findUnique({
      where: { id: req.params.noteId },
      select: { id: true, userId: true },
    });
    if (!note) return res.status(404).json({ error: 'Note not found' });
    if (note.userId !== effectiveActorId(req) && req.user!.role !== 'super_admin') {
      return res.status(403).json({ error: 'You can only delete your own notes' });
    }
    await prisma.clientNote.delete({ where: { id: note.id } });
    return res.status(204).send();
  },
);

/** Toggle pin on a note. Author can pin own; managers (clients:write) can pin any. */
clientRouter.patch(
  '/:id/notes/:noteId/pin',
  requirePermission('clients:write'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    const parsed = z.object({ isPinned: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid body' });

    const accessible = await assertClientVisibleToRequester({
      clientIdOrCorporateCode: req.params.id,
      subCompanyId,
      role: req.user?.role,
      viewerUserId: effectiveActorId(req),
    });
    if (!accessible) return res.status(404).json({ error: 'Client not found' });

    const note = await prisma.clientNote.findUnique({
      where: { id: req.params.noteId },
      select: { id: true, clientId: true, userId: true, subCompanyId: true },
    });
    if (!note || note.clientId !== accessible.id) {
      return res.status(404).json({ error: 'Note not found' });
    }

    // Authz: author always allowed; otherwise viewer must be in same agency
    // and have clients:write (already enforced by the route middleware).
    const isAuthor = note.userId === effectiveActorId(req);
    if (!isAuthor && note.subCompanyId !== subCompanyId) {
      const allowed = await resolveAllowedSubCompanyIds(req.user!);
      if (!allowed.includes(note.subCompanyId)) {
        return res.status(403).json({ error: 'Cannot pin notes outside your agencies' });
      }
    }

    const updated = await prisma.clientNote.update({
      where: { id: note.id },
      data: { isPinned: parsed.data.isPinned },
      select: { id: true, isPinned: true },
    });
    return res.json(updated);
  },
);

/** Add a tag for this agency */
clientRouter.post(
  '/:id/tags',
  requirePermission('clients:write'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    const parsed = tagSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    const accessible = await assertClientVisibleToRequester({
      clientIdOrCorporateCode: req.params.id,
      subCompanyId,
      role: req.user?.role,
      viewerUserId: effectiveActorId(req),
    });
    const client = accessible ? await prisma.client.findUnique({ where: { id: accessible.id } }) : null;
    if (!client) return res.status(404).json({ error: 'Client not found' });
    await prisma.clientTag.upsert({
      where: {
        clientId_subCompanyId_tag: { clientId: client.id, subCompanyId, tag: parsed.data.tag },
      },
      create: { clientId: client.id, subCompanyId, tag: parsed.data.tag },
      update: {},
    });
    return res.status(201).json({ tag: parsed.data.tag });
  }
);

/** Remove a tag for this agency */
clientRouter.delete(
  '/:id/tags/:tag',
  requirePermission('clients:write'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    const accessible = await assertClientVisibleToRequester({
      clientIdOrCorporateCode: req.params.id,
      subCompanyId,
      role: req.user?.role,
      viewerUserId: effectiveActorId(req),
    });
    if (!accessible) return res.status(404).json({ error: 'Client not found' });
    const deleted = await prisma.clientTag.deleteMany({
      where: {
        clientId: accessible.id,
        subCompanyId,
        tag: req.params.tag,
      },
    });
    if (deleted.count === 0) return res.status(404).json({ error: 'Tag not found' });
    return res.status(204).send();
  }
);

const addContactSchema = z.object({
  name: z.string().min(1).max(200),
  title: z.string().max(200).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(50).optional(),
  phoneExtension: z.string().max(20).optional(),
  linkedin: z.string().url().optional().or(z.literal('')),
  website: z.string().url().optional().or(z.literal('')),
  isPrimary: z.boolean().optional(),
});

/** POST /clients/:id/contacts — add a contact (may queue via client_manual_edit). */
clientRouter.post(
  '/:id/contacts',
  requirePermission('clients:contacts:add'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    const accessible = await assertClientVisibleToRequester({
      clientIdOrCorporateCode: req.params.id,
      subCompanyId,
      role: req.user?.role,
      viewerUserId: effectiveActorId(req),
    });
    if (!accessible) return res.status(404).json({ error: 'Client not found' });
    const clientId = accessible.id;
    const client = await prisma.client.findUnique({ where: { id: clientId }, include: { contacts: true } });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const parsed = addContactSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const data = parsed.data;
    const setAsPrimary = data.isPrimary === true || client.contacts.length === 0;
    const existingContacts = mapDbContactsToUpdateBody(client.contacts).map((c) =>
      setAsPrimary ? { ...c, isPrimary: false } : c,
    );
    const proposedContacts = [
      ...existingContacts,
      {
        name: data.name.trim(),
        title: data.title?.trim() || undefined,
        email: data.email?.trim() || undefined,
        phone: data.phone?.trim() || undefined,
        phoneExtension: data.phoneExtension?.trim() || undefined,
        linkedin: data.linkedin?.trim() || undefined,
        website: data.website?.trim() || undefined,
        isPrimary: setAsPrimary,
      },
    ];

    try {
      const actorId = effectiveActorId(req);
      const submitCtx = await ensureAccessContext(req);
      const result = await queueOrApplyClientContactChange({
        clientId,
        subCompanyId,
        proposedContacts,
        actorUserId: actorId,
        jwtUserId: req.user?.sub,
        actorRole: req.user?.role,
        actorEmail: req.user?.email,
        submitterPermissions: submitCtx?.permissions ?? [],
        bypassApproval: await clientManualChangeBypassesApproval(req.user?.role),
        activityDescription: `Added contact ${data.name.trim()} for ${client.name}`,
        activityType: 'contact_added',
      });

      if (result.kind === 'applied') {
        const existingIds = new Set(client.contacts.map((c) => c.id));
        const created = result.client.contacts.find((c) => !existingIds.has(c.id));
        return res.status(201).json({
          ...(created ?? result.client.contacts[result.client.contacts.length - 1]),
          pendingEdit: false,
        });
      }
      if (result.kind === 'auto_approved') {
        return res.status(200).json({
          pendingEdit: false,
          autoApproved: true,
          message: result.message,
        });
      }
      if (result.kind === 'misconfigured') {
        return res.status(400).json({ error: result.error });
      }
      return res.status(202).json({
        pendingEdit: true,
        id: result.pendingEditId,
        clientId: result.clientId,
        name: result.name,
        message: result.message,
      });
    } catch (error) {
      console.error('Failed to add contact', error);
      return res.status(500).json({ error: 'Failed to add contact' });
    }
  }
);

const updateContactSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    title: z.string().max(200).optional().nullable(),
    email: z.string().email().optional().or(z.literal('')).nullable(),
    phone: z.string().max(50).optional().nullable(),
    phoneExtension: z.string().max(20).optional().nullable(),
    linkedin: z.string().url().optional().or(z.literal('')).nullable(),
    website: z.string().url().optional().or(z.literal('')).nullable(),
    isPrimary: z.boolean().optional(),
    isUnsubscribed: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.title !== undefined ||
      data.email !== undefined ||
      data.phone !== undefined ||
      data.phoneExtension !== undefined ||
      data.linkedin !== undefined ||
      data.website !== undefined ||
      data.isPrimary !== undefined ||
      data.isUnsubscribed !== undefined,
    { message: 'At least one field is required' },
  );

/** PATCH /clients/:id/contacts/:contactId — update contact fields (may queue), primary, or unsubscribed. */
clientRouter.patch(
  '/:id/contacts/:contactId',
  requirePermission('clients:write', 'clients:contacts:edit'),
  async (req: Request, res: Response) => {
    const parsed = updateContactSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const data = parsed.data;

    const hasFieldUpdates =
      data.name !== undefined ||
      data.title !== undefined ||
      data.email !== undefined ||
      data.phone !== undefined ||
      data.phoneExtension !== undefined ||
      data.linkedin !== undefined ||
      data.website !== undefined;
    const hasPrimaryOrUnsub = data.isPrimary !== undefined || data.isUnsubscribed !== undefined;

    // Field edits (and isPrimary bundled with them) need clients:contacts:edit.
    // Primary / unsubscribed alone still need clients:write (Set as primary, Resubscribe).
    if (hasFieldUpdates) {
      if (!(await requestHasPermission(req, 'clients:contacts:edit'))) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have permission to edit contact fields',
        });
      }
    } else if (hasPrimaryOrUnsub) {
      if (!(await requestHasPermission(req, 'clients:write'))) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have permission to update contact primary/unsubscribe status',
        });
      }
    }

    let subCompanyId = await getEffectiveSubCompanyId(req);
    const { contactId } = req.params;
    let clientId: string;
    let clientName: string | null = null;

    if (subCompanyId) {
      const accessible = await assertClientVisibleToRequester({
        clientIdOrCorporateCode: req.params.id,
        subCompanyId,
        role: req.user?.role,
        viewerUserId: effectiveActorId(req),
      });
      if (!accessible) return res.status(404).json({ error: 'Client not found' });
      clientId = accessible.id;
      clientName = accessible.name;
    } else {
      const accessCtx = await ensureAccessContext(req);
      if (!hasFieldUpdates || !accessCtx || !canAccessMultipleAgencies(accessCtx)) {
        return res.status(403).json({ error: 'Agency context required' });
      }
      // Super Users in "All agencies" view: contacts are client-global — allow by client id.
      const client = await prisma.client.findFirst({
        where: {
          OR: [
            { id: req.params.id },
            { corporateCode: { equals: req.params.id, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          name: true,
          clientSubCompanies: { select: { subCompanyId: true }, take: 1 },
        },
      });
      if (!client) return res.status(404).json({ error: 'Client not found' });
      clientId = client.id;
      clientName = client.name;
      subCompanyId = client.clientSubCompanies[0]?.subCompanyId ?? null;
    }

    const contact = await prisma.clientContact.findFirst({
      where: { id: contactId, clientId },
    });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    // Field edits go through client_manual_edit (same as PATCH /clients/:id).
    if (hasFieldUpdates) {
      if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
      const allContacts = await prisma.clientContact.findMany({ where: { clientId } });
      const setAsPrimary = data.isPrimary === true;
      const proposedContacts = mapDbContactsToUpdateBody(allContacts).map((c) => {
        if (c.id !== contactId) {
          return setAsPrimary ? { ...c, isPrimary: false } : c;
        }
        return {
          ...c,
          name: data.name !== undefined ? data.name.trim() : c.name,
          title: data.title !== undefined ? data.title?.trim() || undefined : c.title,
          email: data.email !== undefined ? data.email?.trim() || undefined : c.email,
          phone: data.phone !== undefined ? data.phone?.trim() || undefined : c.phone,
          phoneExtension:
            data.phoneExtension !== undefined
              ? data.phoneExtension?.trim() || undefined
              : c.phoneExtension,
          linkedin: data.linkedin !== undefined ? data.linkedin?.trim() || undefined : c.linkedin,
          website: data.website !== undefined ? data.website?.trim() || undefined : c.website,
          isPrimary: setAsPrimary ? true : c.isPrimary,
        };
      });

      try {
        const actorId = effectiveActorId(req);
        const submitCtx = await ensureAccessContext(req);
        const result = await queueOrApplyClientContactChange({
          clientId,
          subCompanyId,
          proposedContacts,
          actorUserId: actorId,
          jwtUserId: req.user?.sub,
          actorRole: req.user?.role,
          actorEmail: req.user?.email,
          submitterPermissions: submitCtx?.permissions ?? [],
          bypassApproval: await clientManualChangeBypassesApproval(req.user?.role),
          activityDescription: `Updated contact ${data.name?.trim() || contact.name} for ${clientName ?? 'client'}`,
          activityType: 'contact_updated',
        });

        if (result.kind === 'applied') {
          const updated = result.client.contacts.find((c) => c.id === contactId);
          return res.json({ ...(updated ?? contact), pendingEdit: false });
        }
        if (result.kind === 'auto_approved') {
          return res.status(200).json({
            pendingEdit: false,
            autoApproved: true,
            message: result.message,
          });
        }
        if (result.kind === 'misconfigured') {
          return res.status(400).json({ error: result.error });
        }
        return res.status(202).json({
          pendingEdit: true,
          id: result.pendingEditId,
          clientId: result.clientId,
          name: result.name,
          message: result.message,
        });
      } catch (error) {
        console.error('Failed to update contact', error);
        return res.status(500).json({ error: 'Failed to update contact' });
      }
    }

    if (data.isUnsubscribed === true) {
      if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
      const guard = await assertClientUnsubscribeAllowed({ clientId, subCompanyId });
      if (!guard.ok) return res.status(403).json({ error: guard.error });
    }

    if (data.isPrimary === true) {
      await prisma.clientContact.updateMany({
        where: { clientId },
        data: { isPrimary: false },
      });
    }

    const updateData: Prisma.ClientContactUpdateInput = {};
    if (data.isPrimary === true) updateData.isPrimary = true;
    if (typeof data.isUnsubscribed === 'boolean') updateData.isUnsubscribed = data.isUnsubscribed;

    const updated = await prisma.clientContact.update({
      where: { id: contactId },
      data: updateData,
    });

    return res.json(updated);
  }
);

/** POST /clients/:id/contacts/:contactId/unsubscribe — send unsub email and mark contact as unsubscribed. */
clientRouter.post(
  '/:id/contacts/:contactId/unsubscribe',
  requirePermission('clients:write'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    const accessible = await assertClientVisibleToRequester({
      clientIdOrCorporateCode: req.params.id,
      subCompanyId,
      role: req.user?.role,
      viewerUserId: effectiveActorId(req),
    });
    if (!accessible) return res.status(404).json({ error: 'Client not found' });
    const clientId = accessible.id;
    const { contactId } = req.params;

    const [contact, client, actor, agency] = await Promise.all([
      prisma.clientContact.findFirst({ where: { id: contactId, clientId } }),
      prisma.client.findUnique({ where: { id: clientId }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: req.user!.sub }, select: { firstName: true, lastName: true, email: true } }),
      prisma.subCompany.findUnique({ where: { id: subCompanyId }, select: { name: true } }),
    ]);

    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    if (!contact.email) return res.status(400).json({ error: 'Contact has no email address' });
    if (contact.isUnsubscribed) return res.status(400).json({ error: 'Contact is already unsubscribed' });

    const guard = await assertClientUnsubscribeAllowed({ clientId, subCompanyId });
    if (!guard.ok) return res.status(403).json({ error: guard.error });

    const senderName = [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') || actor?.email || 'Team Member';
    const agencyName = agency?.name || 'Wudox';
    const clientName = client?.name || 'Unknown';

    // Send unsubscribe email
    const agencyBranding = await getAgencyBranding(subCompanyId);
    await sendUnsubscribeEmail({
      toEmail: contact.email,
      contactName: contact.name,
      clientName,
      agencyName,
      senderName,
      agency: agencyBranding,
    });

    // Mark only this contact as unsubscribed (contact-level, not whole client)
    await prisma.clientContact.update({
      where: { id: contactId },
      data: { isUnsubscribed: true },
    });

    // Log activity
    const userName = formatUserDisplayName(actor ?? { email: req.user?.email ?? null });
    await createActivityLog({
      userId: req.user!.sub,
      userName,
      subCompanyId,
      type: 'contact_unsubscribed',
      description: `Unsubscribed contact ${contact.name} (${contact.email}) from ${clientName}`,
      metadata: {
        clientId,
        clientName,
        contactId: contact.id,
        contactName: contact.name,
        contactEmail: contact.email,
      },
    });

    return res.json({ success: true, message: `Unsubscribe email sent to ${contact.email}` });
  }
);

/** DELETE /clients/:id/contacts/:contactId — remove contact. Fails if it would leave client with zero contacts. */
clientRouter.delete(
  '/:id/contacts/:contactId',
  requirePermission('clients:write'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    const accessible = await assertClientVisibleToRequester({
      clientIdOrCorporateCode: req.params.id,
      subCompanyId,
      role: req.user?.role,
      viewerUserId: effectiveActorId(req),
    });
    if (!accessible) return res.status(404).json({ error: 'Client not found' });
    const clientId = accessible.id;
    const { contactId } = req.params;
    const count = await prisma.clientContact.count({ where: { clientId } });
    if (count <= 1) {
      return res.status(400).json({ error: 'At least one contact is required. Cannot remove the last contact.' });
    }
    const contact = await prisma.clientContact.findFirst({
      where: { id: contactId, clientId },
    });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    const wasPrimary = contact.isPrimary;
    await prisma.clientContact.delete({ where: { id: contactId } });
    if (wasPrimary) {
      const next = await prisma.clientContact.findFirst({ where: { clientId } });
      if (next) {
        await prisma.clientContact.update({
          where: { id: next.id },
          data: { isPrimary: true },
        });
      }
    }
    return res.status(204).send();
  }
);

/** PATCH /clients/:id — update client details (may queue for director approval). */
clientRouter.patch(
  '/:id',
  requirePermission('clients:write'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    const parsed = updateClientSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const data = parsed.data;

    const accessible = await assertClientVisibleToRequester({
      clientIdOrCorporateCode: req.params.id,
      subCompanyId,
      role: req.user?.role,
      viewerUserId: effectiveActorId(req),
      skipLeadLock: true,
    });
    if (!accessible) return res.status(404).json({ error: 'Client not found' });

    const client = await prisma.client.findUnique({
      where: { id: accessible.id },
      select: { id: true, name: true },
    });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    try {
      const clientEditActorId = effectiveActorId(req);
      const actor = await prisma.user.findUnique({
        where: { id: clientEditActorId },
        select: { firstName: true, lastName: true, email: true, role: true },
      });
      const userName = formatUserDisplayName(actor ?? { email: req.user?.email ?? null });

      if (await clientManualChangeBypassesApproval(req.user?.role)) {
        const updated = await prisma.$transaction(async (tx) =>
          performManualClientUpdate(tx, {
            clientId: client.id,
            subCompanyId,
            data,
          }),
        );
        if (!updated) return res.status(500).json({ error: 'Failed to update client' });

        await invalidateClientListCache(subCompanyId);
        await createActivityLog({
          userId: clientEditActorId,
          userName,
          subCompanyId,
          type: 'client_updated',
          description: `Updated client ${updated.name}`,
          metadata: { clientId: updated.id, clientName: updated.name },
        });
        emitToUsers([...new Set([clientEditActorId, req.user!.sub])], 'client:refresh', { subCompanyId });

        return res.json({
          ...updated,
          pendingEdit: false,
          tags: (updated.tags as { tag: string }[]).map((t) => t.tag),
        });
      }

      const pendingPayload = buildPendingEditPayload(data, {
        subCompanyId,
        clientId: client.id,
        submittedById: clientEditActorId,
        submitterRole: req.user?.role ?? null,
      });

      const pendingRow = await prisma.pendingClientEdit.upsert({
        where: {
          clientId_subCompanyId: { clientId: client.id, subCompanyId },
        },
        create: pendingPayload,
        update: {
          ...pendingPayload,
          submittedAt: new Date(),
          currentStepIndex: 0,
          approvalChain: [],
        },
        include: {
          client: { select: { id: true, name: true, corporateCode: true } },
        },
      });

      const editSubmitCtx = await ensureAccessContext(req);
      const editApproval = await submitEntityForApproval({
        workflow: 'client_manual_edit',
        entityId: pendingRow.id,
        subCompanyId,
        submitterUserId: clientEditActorId,
        submitterRoleKey: req.user?.role ?? 'sales_associate',
        submitterPermissions: editSubmitCtx?.permissions ?? [],
      });

      await createActivityLog({
        userId: clientEditActorId,
        userName,
        subCompanyId,
        type: 'client_pending_edit',
        description: editApproval.autoApproved
          ? `Edit for client "${pendingRow.name}" approved via agency approval settings`
          : `Submitted edit for client "${pendingRow.name}" for approval`,
        metadata: {
          pendingEditId: pendingRow.id,
          clientId: client.id,
          clientName: pendingRow.name,
          autoApproved: editApproval.autoApproved,
        },
      });

      if (editApproval.autoApproved) {
        emitToUsers([...new Set([clientEditActorId, req.user!.sub])], 'client:refresh', { subCompanyId });
        return res.status(200).json({
          pendingEdit: false,
          autoApproved: true,
          message: 'Edit was approved immediately per agency approval settings.',
        });
      }

      if (!editApproval.targetRoleKey) {
        return res.status(400).json({
          error: 'No approval path configured for client manual edit. Check Settings → Approvals and Settings → Roles.',
        });
      }

      const editApproverIds = await notifyChainTargetUsers({
        subCompanyId,
        targetRoleKey: editApproval.targetRoleKey,
        eventKey: 'client_pending_edit_alert',
        context: { entityLabel: pendingRow.name, actorName: userName },
        link: '/clients?tab=pending',
        relatedId: pendingRow.id,
      });
      emitToUsers([...editApproverIds, ...new Set([clientEditActorId, req.user!.sub])], 'client:refresh', { subCompanyId });

      return res.status(202).json({
        pendingEdit: true,
        id: pendingRow.id,
        clientId: client.id,
        name: pendingRow.name,
        message:
          'Edit submitted for director approval. Changes will be applied after a director or super admin approves.',
      });
    } catch (error) {
      console.error('Failed to update client', error);
      return res.status(500).json({ error: 'Failed to update client' });
    }
  },
);

// ─── Import Mapping Templates ────────────────────────────────────────────────
// Stored per agency, keyed by a fingerprint of the source file's header set.
// When a director re-uploads a vendor file with the same headers, the wizard
// pre-fills the column → CRM-field mapping from the saved template.

const mappingTemplateUpsertSchema = z.object({
  headerFingerprint: z.string().min(1).max(128),
  mapping: z.record(z.string().min(1).max(200), z.string().min(1).max(50)),
  name: z.string().max(200).optional().nullable(),
  entityType: z.enum(['client', 'contact']).default('client'),
});

clientRouter.get(
  '/import-mapping-templates',
  authenticate,
  requirePermission('clients:read'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    const fingerprint = typeof req.query.fingerprint === 'string' ? req.query.fingerprint : undefined;
    if (!fingerprint) return res.json({ template: null });
    const entityType =
      typeof req.query.entityType === 'string' && req.query.entityType === 'contact'
        ? 'contact'
        : 'client';
    const template = await prisma.importMappingTemplate.findUnique({
      where: {
        subCompanyId_entityType_headerFingerprint: {
          subCompanyId,
          entityType,
          headerFingerprint: fingerprint,
        },
      },
      include: { createdBy: { select: { firstName: true, lastName: true, email: true } } },
    });
    return res.json({ template });
  }
);

clientRouter.post(
  '/import-mapping-templates',
  authenticate,
  requirePermission('clients:read'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    const parsed = mappingTemplateUpsertSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    }
    const { headerFingerprint, mapping, name, entityType } = parsed.data;
    const template = await prisma.importMappingTemplate.upsert({
      where: {
        subCompanyId_entityType_headerFingerprint: {
          subCompanyId,
          entityType,
          headerFingerprint,
        },
      },
      update: {
        mapping: mapping as Prisma.InputJsonValue,
        name: name ?? undefined,
        createdById: req.user!.sub,
      },
      create: {
        subCompanyId,
        entityType,
        headerFingerprint,
        mapping: mapping as Prisma.InputJsonValue,
        name: name ?? null,
        createdById: req.user!.sub,
      },
    });
    return res.status(201).json({ template });
  }
);

// ─── Contact-only CSV/Excel import ───────────────────────────────────────────

const contactImportContactSchema = importContactSchema.extend({
  isPrimary: z.boolean().optional().nullable(),
});

const contactImportRowSchema = z.object({
  corporateCode: z.string().max(100).optional().nullable(),
  companyName: z.string().max(500).optional().nullable(),
  importSourceId: z.string().max(100).optional().nullable(),
  contacts: z.array(contactImportContactSchema).min(1),
});

const contactImportCheckSchema = z.object({
  rows: z.array(contactImportRowSchema).min(1).max(5000),
  subCompanyId: z.string().uuid().optional(),
  importDestination: z.enum(['global', 'agency']).optional(),
});

const pendingContactImportSchema = z.object({
  rows: z.array(contactImportRowSchema).min(1).max(5000),
  subCompanyId: z.string().uuid().optional(),
  importDestination: z.enum(['global', 'agency']).optional(),
});

clientRouter.post(
  '/contact-import-check',
  authenticate,
  requirePermission('clients:read'),
  async (req: Request, res: Response) => {
    const parsed = contactImportCheckSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });

    const subCompanyId =
      parsed.data.subCompanyId?.trim() ??
      parseSubCompanyIdQuery(req) ??
      (parsed.data.importDestination === 'agency' ? (await getEffectiveSubCompanyId(req)) ?? undefined : undefined);

    const importDestination =
      parsed.data.importDestination ??
      (subCompanyId ? ('agency' as const) : ('global' as const));

    if (importDestination === 'agency' && !subCompanyId) {
      return res.status(400).json({ error: 'Agency context required for agency contact import check' });
    }

    try {
      const result = await checkContactImportConflicts(parsed.data.rows as ContactImportRowPayload[], {
        importDestination,
        ...(importDestination === 'agency' ? { subCompanyId: subCompanyId! } : {}),
      } as { importDestination: 'global' } | { importDestination: 'agency'; subCompanyId: string });
      return res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Contact import check failed';
      return res.status(400).json({ error: message });
    }
  },
);

clientRouter.post(
  '/pending-contact-imports',
  authenticate,
  requirePermission('clients:read'),
  async (req: Request, res: Response) => {
    const parsed = pendingContactImportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    const submitCtx = await ensureAccessContext(req);
    const submitterRole = req.user?.role ?? 'sales_associate';

    const stageGroups = async (params: {
      groups: Awaited<ReturnType<typeof resolveContactImportRows>>;
      subCompanyId: string | null;
      submissionSource: 'agency' | 'global_database';
      workflow: 'contact_import' | 'database_contact_import';
      notifyScopeId: string;
    }) => {
      let autoApprovedCount = 0;
      const createdIds: string[] = [];
      let pendingApprovalCount = 0;
      let pendingNotifyTargetRole: string | null = null;
      const importActor = await prisma.user.findUnique({
        where: { id: req.user!.sub },
        select: { firstName: true, lastName: true, email: true },
      });
      const importActorName = formatUserDisplayName(importActor ?? { email: req.user?.email ?? null });

      for (const group of params.groups) {
        const row = await prisma.pendingImportedContact.create({
          data: {
            subCompanyId: params.subCompanyId,
            submissionSource: params.submissionSource,
            importedById: req.user!.sub,
            targetClientId: group.targetClientId,
            matchKey: group.matchKey,
            matchValue: group.matchValue,
            contacts: group.contacts as Prisma.InputJsonValue,
            currentStepIndex: 0,
            approvalChain: [],
          },
        });
        createdIds.push(row.id);
        const approval = await submitEntityForApproval({
          workflow: params.workflow,
          entityId: row.id,
          subCompanyId: params.notifyScopeId,
          submitterUserId: req.user!.sub,
          submitterRoleKey: submitterRole,
          submitterPermissions: submitCtx?.permissions ?? [],
        });
        if (approval.autoApproved) autoApprovedCount += 1;
        else if (approval.targetRoleKey) {
          pendingApprovalCount += 1;
          pendingNotifyTargetRole = approval.targetRoleKey;
        }
      }

      if (pendingNotifyTargetRole && pendingApprovalCount > 0 && params.subCompanyId) {
        await notifyPendingImportBatchApproval({
          subCompanyId: params.subCompanyId,
          targetRoleKey: pendingNotifyTargetRole,
          actorName: importActorName,
          pendingCount: pendingApprovalCount,
          link: '/clients?tab=pending',
          relatedId: createdIds[0] ?? req.user!.sub,
        });
      }

      if (params.subCompanyId) await invalidateClientListCache(params.subCompanyId);
      return { count: createdIds.length, autoApprovedCount, ids: createdIds };
    };

    // Elevated roles: destination-aware (global vs agency)
    if (isDatabaseManagerRole(req.user?.role) || isSuperUserScreenRole(req.user?.role)) {
      const orgMode = isDatabaseManagerRole(req.user?.role)
        ? await getDatabaseManagerDestinationMode()
        : await getSuperUserDestinationMode();
      const resolved = resolveClientDestinationMode(orgMode, parsed.data.importDestination);
      if ('error' in resolved) {
        return res.status(400).json({ error: resolved.error });
      }

      try {
        if (resolved.action === 'global') {
          const groups = await resolveContactImportRows(parsed.data.rows as ContactImportRowPayload[], {
            importDestination: 'global',
          });
          const result = await stageGroups({
            groups,
            subCompanyId: null,
            submissionSource: 'global_database',
            workflow: 'database_contact_import',
            notifyScopeId: GLOBAL_APPROVAL_SCOPE,
          });
          return res.status(201).json(result);
        }

        let targetAgencyId = parsed.data.subCompanyId?.trim() ?? (await getEffectiveSubCompanyId(req)) ?? undefined;
        const allowedAgencyIds = await resolveAllowedSubCompanyIds(req.user!, req);
        if (!targetAgencyId || !allowedAgencyIds.includes(targetAgencyId)) {
          return res.status(403).json({ error: 'Selected agency is not in your access scope.' });
        }
        const groups = await resolveContactImportRows(parsed.data.rows as ContactImportRowPayload[], {
          importDestination: 'agency',
          subCompanyId: targetAgencyId,
        });
        const result = await stageGroups({
          groups,
          subCompanyId: targetAgencyId,
          submissionSource: 'agency',
          workflow: 'contact_import',
          notifyScopeId: targetAgencyId,
        });
        return res.status(201).json(result);
      } catch (err) {
        if (err instanceof ContactImportConflictError) {
          return res.status(409).json({ error: err.message, conflicts: err.conflicts });
        }
        const message = err instanceof Error ? err.message : 'Contact import failed';
        return res.status(400).json({ error: message });
      }
    }

    const writeTarget = await assertMultiAgencyWriteTarget(req);
    if (!writeTarget.ok) {
      return res.status(writeTarget.status).json({ error: writeTarget.error });
    }

    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    try {
      const groups = await resolveContactImportRows(parsed.data.rows as ContactImportRowPayload[], {
        importDestination: 'agency',
        subCompanyId,
      });
      const result = await stageGroups({
        groups,
        subCompanyId,
        submissionSource: 'agency',
        workflow: 'contact_import',
        notifyScopeId: subCompanyId,
      });
      return res.status(201).json(result);
    } catch (err) {
      if (err instanceof ContactImportConflictError) {
        return res.status(409).json({ error: err.message, conflicts: err.conflicts });
      }
      throw err;
    }
  },
);

clientRouter.post(
  '/pending-contact-imports/bulk-approve',
  authenticate,
  requirePermission('clients:approve'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    const parsed = bulkPendingImportIdsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    }
    const result = await bulkApprovePendingContactImports(subCompanyId, parsed.data.ids);
    if (result.approved > 0) await invalidateClientListCache(subCompanyId);
    return res.json(result);
  },
);

clientRouter.post(
  '/pending-contact-imports/bulk-reject',
  authenticate,
  requirePermission('clients:approve'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    const parsed = bulkPendingImportIdsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    }
    const result = await bulkRejectPendingContactImports(subCompanyId, parsed.data.ids);
    return res.json(result);
  },
);

clientRouter.post(
  '/pending-contact-imports/:id/approve',
  authenticate,
  requirePermission('clients:approve'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    const ctx = await ensureAccessContext(req);
    if (!ctx) return res.status(403).json({ error: 'Forbidden' });

    const auth = await authorizeApprovalAction({
      workflow: 'contact_import',
      entityId: req.params.id,
      subCompanyId,
      actorRoleKey: ctx.roleKey,
      actorPermissions: ctx.permissions,
      action: 'approve',
    });
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const pending = await prisma.pendingImportedContact.findUnique({ where: { id: req.params.id } });
    if (!pending) return res.status(404).json({ error: 'Pending contact import not found' });
    if (pending.subCompanyId !== subCompanyId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await prisma.$transaction((tx) => approvePendingContactImport(tx, pending));
    await invalidateClientListCache(subCompanyId);
    return res.json({ mode: 'append', ...result });
  },
);

clientRouter.delete(
  '/pending-contact-imports/:id',
  authenticate,
  requirePermission('clients:approve'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    const ctx = await ensureAccessContext(req);
    if (!ctx) return res.status(403).json({ error: 'Forbidden' });

    const auth = await authorizeApprovalAction({
      workflow: 'contact_import',
      entityId: req.params.id,
      subCompanyId,
      actorRoleKey: ctx.roleKey,
      actorPermissions: ctx.permissions,
      action: 'reject',
    });
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const pending = await prisma.pendingImportedContact.findUnique({ where: { id: req.params.id } });
    if (!pending) return res.status(404).json({ error: 'Pending contact import not found' });
    if (pending.subCompanyId !== subCompanyId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await prisma.pendingImportedContact.delete({ where: { id: pending.id } });
    return res.status(204).send();
  },
);

