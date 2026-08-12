import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { getRoleLabel } from '../config/permissions';
import { createActivityLog } from './activityLog';
import { invalidateClientListCache, invalidateClientListCacheForMainOrg } from './clientListCache';
import { sendClientCreatedEmail, getAgencyBranding } from './email';
import { dispatchNotification } from './notificationDispatch';
import { getClientApproverUserIds } from './accessContext';
import { performManualClientCreate, type CreateClientBody } from './clientManualCreate';
import { defaultLockDays, resolveClientVisibility } from './clientVisibilityPolicy';
import { submitEntityForApproval, notifyChainTargetUsers, notifyPendingImportBatchApproval } from './approvalActions';
import { orgDatabaseWorkflowBypassesApproval } from './approvalPolicy';
import { GLOBAL_APPROVAL_SCOPE } from '../types/approval';
import { emitToUsers } from '../socket';

export type DestinationManualResult = {
  status: number;
  body: Record<string, unknown>;
};

function formatUserDisplayName(user?: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
} | null): string {
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
  return name || user?.email || 'User';
}

function buildClientNotificationLink(clientId: string): string {
  return `/clients?client=${encodeURIComponent(clientId)}`;
}

function buildClientUrl(clientId: string): string | undefined {
  const base = process.env.FRONTEND_URL?.replace(/\/$/, '');
  return base ? `${base}/clients?client=${encodeURIComponent(clientId)}` : undefined;
}

function formatClientLocation(client: {
  location?: string | null;
  address?: string | null;
}): string {
  return client.location?.trim() || client.address?.trim() || '—';
}

async function refreshClientListCaches(subCompanyId: string, visibility: 'global' | 'agency'): Promise<void> {
  if (visibility === 'global') {
    await invalidateClientListCacheForMainOrg(subCompanyId);
  } else {
    await invalidateClientListCache(subCompanyId);
  }
}

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
  emitToUsers(
    users.map((u) => u.id),
    'client:refresh',
    { subCompanyId: originSubCompanyId },
  );
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

function normalizeCreateBody(data: CreateClientBody): CreateClientBody {
  const primaryContactIndex = data.contacts.findIndex((contact) => contact.isPrimary === true);
  const normalizedContacts = data.contacts.map((contact, index) => ({
    ...contact,
    isPrimary: primaryContactIndex >= 0 ? index === primaryContactIndex : index === 0,
  }));
  const uniqueTags = [...new Set((data.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
  return { ...data, contacts: normalizedContacts, tags: uniqueTags };
}

function corporateCodeFromName(name: string): string {
  const slug = name.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'client';
  return `${slug}-${Date.now()}`;
}

/** Agency path via pending queue (Database Manager). */
export async function createAgencyManualClientPending(params: {
  userId: string;
  userEmail: string | undefined;
  submitterRoleKey: string;
  submitterPermissions: string[];
  subCompanyId: string;
  data: CreateClientBody;
  actorLabel: string;
}): Promise<DestinationManualResult> {
  const { userId, submitterRoleKey, submitterPermissions, subCompanyId, data, actorLabel } = params;
  const createBody = normalizeCreateBody(data);
  const uniqueTags = createBody.tags ?? [];
  const normalizedContacts = createBody.contacts;

  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true },
  });
  const userName = formatUserDisplayName(actor ?? { email: params.userEmail ?? null });

  const pendingRow = await prisma.pendingClientSubmission.create({
    data: {
      subCompanyId,
      submissionSource: 'agency',
      submittedById: userId,
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
      submitterRole: submitterRoleKey,
      currentStepIndex: 0,
      approvalChain: [],
    },
  });

  const approval = await submitEntityForApproval({
    workflow: 'client_manual_add',
    entityId: pendingRow.id,
    subCompanyId,
    submitterUserId: userId,
    submitterRoleKey,
    submitterPermissions,
  });

  await createActivityLog({
    userId,
    userName,
    subCompanyId,
    type: 'client_pending_submission',
    description: approval.autoApproved
      ? `${actorLabel} client "${pendingRow.name}" approved via agency settings`
      : `${actorLabel} submitted client "${pendingRow.name}" for agency approval`,
    metadata: {
      pendingSubmissionId: pendingRow.id,
      clientName: pendingRow.name,
      autoApproved: approval.autoApproved,
    },
  });

  if (approval.autoApproved) {
    emitToUsers([userId], 'client:refresh', { subCompanyId });
    return {
      status: 201,
      body: {
        pendingSubmission: false,
        autoApproved: true,
        name: pendingRow.name,
        message: 'Client was approved immediately per agency approval settings.',
      },
    };
  }

  if (!approval.targetRoleKey) {
    return {
      status: 400,
      body: { error: 'No approval path configured for client manual add. Check Settings → Approvals.' },
    };
  }

  const approverIds = await notifyChainTargetUsers({
    subCompanyId,
    targetRoleKey: approval.targetRoleKey,
    eventKey: 'client_pending_submission_alert',
    context: { entityLabel: pendingRow.name, actorName: userName },
    link: '/clients?tab=pending',
    relatedId: pendingRow.id,
  });
  emitToUsers([...approverIds, userId], 'client:refresh', { subCompanyId });

  return {
    status: 202,
    body: {
      pendingSubmission: true,
      id: pendingRow.id,
      name: pendingRow.name,
      message:
        'Submitted for approval. After approval it will be available to the selected agency first, then shared org-wide per Client Visibility settings.',
    },
  };
}

/** Global database path (Database Manager or Super User). */
export async function createGlobalDatabaseManualClient(params: {
  userId: string;
  userEmail: string | undefined;
  submitterRoleKey: string;
  submitterPermissions: string[];
  data: CreateClientBody;
  actorLabel: string;
  logSubCompanyId: string;
}): Promise<DestinationManualResult> {
  const { userId, submitterRoleKey, submitterPermissions, data, logSubCompanyId } = params;
  const createBody = normalizeCreateBody(data);
  const uniqueTags = createBody.tags ?? [];
  const normalizedContacts = createBody.contacts;

  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true, subCompanyId: true },
  });
  const userName = formatUserDisplayName(actor ?? { email: params.userEmail ?? null });

  if (await orgDatabaseWorkflowBypassesApproval('database_client_add')) {
    const corporateCode = corporateCodeFromName(data.name);
    const created = await prisma.$transaction(async (tx) =>
      performManualClientCreate(tx, {
        data: createBody,
        subCompanyId: null,
        corporateCode,
        visibility: 'global',
        createdByRole: submitterRoleKey,
        createdById: userId,
        skipClientSubCompany: true,
      }),
    );
    if (!created) {
      return { status: 500, body: { error: 'Failed to create client' } };
    }

    const agencies = await prisma.subCompany.findMany({ select: { id: true } });
    for (const agency of agencies) {
      await invalidateClientListCacheForMainOrg(agency.id).catch(() => {});
    }

    await createActivityLog({
      userId,
      userName,
      subCompanyId: logSubCompanyId,
      type: 'client_created',
      description: `Added global database client "${created.name}" (direct add — approval and Client Visibility skipped)`,
      metadata: { clientId: created.id, clientName: created.name, globalDatabase: true, directAdd: true },
    });

    emitToUsers([userId], 'client:refresh', { subCompanyId: logSubCompanyId });
    return {
      status: 201,
      body: {
        pendingSubmission: false,
        autoApproved: true,
        globalDatabase: true,
        id: created.id,
        name: created.name,
        corporateCode: created.corporateCode,
        message:
          'Client was added to the global database immediately (direct add). Client Visibility delay does not apply.',
      },
    };
  }

  const pendingRow = await prisma.pendingClientSubmission.create({
    data: {
      subCompanyId: null,
      submissionSource: 'global_database',
      submittedById: userId,
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
      submitterRole: submitterRoleKey,
      currentStepIndex: 0,
      approvalChain: [],
    },
  });

  const approval = await submitEntityForApproval({
    workflow: 'database_client_add',
    entityId: pendingRow.id,
    subCompanyId: GLOBAL_APPROVAL_SCOPE,
    submitterUserId: userId,
    submitterRoleKey,
    submitterPermissions,
  });

  if (approval.misconfigured) {
    await prisma.pendingClientSubmission.delete({ where: { id: pendingRow.id } }).catch(() => {});
    return {
      status: 400,
      body: {
        error:
          'No approval path configured for global database client add. Check Settings → Approvals → Global Database.',
      },
    };
  }

  await createActivityLog({
    userId,
    userName,
    subCompanyId: logSubCompanyId,
    type: 'client_pending_submission',
    description: approval.autoApproved
      ? `Added global database client "${pendingRow.name}" (direct add — no approval required)`
      : `Submitted global database client "${pendingRow.name}" for approval`,
    metadata: {
      pendingSubmissionId: pendingRow.id,
      clientName: pendingRow.name,
      globalDatabase: true,
      autoApproved: approval.autoApproved,
    },
  });

  if (approval.autoApproved) {
    const agencies = await prisma.subCompany.findMany({ select: { id: true } });
    for (const agency of agencies) {
      await invalidateClientListCacheForMainOrg(agency.id).catch(() => {});
    }
    emitToUsers([userId], 'client:refresh', { subCompanyId: logSubCompanyId });
    return {
      status: 201,
      body: {
        pendingSubmission: false,
        autoApproved: true,
        globalDatabase: true,
        name: pendingRow.name,
        message: 'Client was added to the global database immediately per org approval settings.',
      },
    };
  }

  if (!approval.targetRoleKey) {
    return {
      status: 400,
      body: { error: 'No approval path configured for global database client add. Check Settings → Approvals.' },
    };
  }

  const approverIds = await notifyChainTargetUsers({
    subCompanyId: GLOBAL_APPROVAL_SCOPE,
    targetRoleKey: approval.targetRoleKey,
    eventKey: 'client_pending_submission_alert',
    context: { entityLabel: pendingRow.name, actorName: userName },
    link: '/clients?tab=pending&scope=global',
    relatedId: pendingRow.id,
  });
  emitToUsers([...approverIds, userId], 'client:refresh', { subCompanyId: logSubCompanyId });

  return {
    status: 202,
    body: {
      pendingSubmission: true,
      id: pendingRow.id,
      name: pendingRow.name,
      globalDatabase: true,
      message:
        'Submitted for approval. After a Director or Operations Manager approves, the client will be added to the global database.',
    },
  };
}

/** Super User agency path — direct create with Client Visibility (explicit agency). */
export async function createSuperUserAgencyDirectClient(params: {
  userId: string;
  userEmail: string | undefined;
  submitterRoleKey: string;
  subCompanyId: string;
  data: CreateClientBody;
}): Promise<DestinationManualResult> {
  const { userId, submitterRoleKey, subCompanyId, data } = params;
  const createBody = normalizeCreateBody(data);
  const corporateCode = corporateCodeFromName(data.name);

  const [actor, visibilitySetting, agencyRow] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
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

  const lockDays = defaultLockDays(visibilitySetting?.days);
  const visibility = resolveClientVisibility({
    creatorRole: submitterRoleKey,
    lockDays,
    explicitAgencyPath: true,
  });

  const created = await prisma.$transaction(async (tx) =>
    performManualClientCreate(tx, {
      data: createBody,
      subCompanyId,
      corporateCode,
      visibility,
      createdByRole: submitterRoleKey,
      createdById: userId,
    }),
  );
  if (!created) {
    return { status: 500, body: { error: 'Failed to create client' } };
  }

  await afterClientVisibilityChange(subCompanyId, visibility);

  const userName = formatUserDisplayName(actor ?? { email: params.userEmail ?? null });
  const creatorName = userName;
  const creatorEmail = actor?.email ?? params.userEmail ?? '';
  const creatorRole = getRoleLabel(actor?.role ?? submitterRoleKey);

  await createActivityLog({
    userId,
    userName,
    subCompanyId,
    type: 'client_created',
    description: `Created client ${created.name}`,
    metadata: { clientId: created.id, clientName: created.name },
  });

  void (async () => {
    try {
      const [approverIds, agency] = await Promise.all([
        getClientApproverUserIds(subCompanyId, { excludeUserId: userId }),
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

      emitToUsers([...recipients.map((r) => r.id), userId], 'client:refresh', { subCompanyId });

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
          }),
        ),
      );
    } catch (error) {
      console.error('Failed to send client-created notifications', error);
    }
  })();

  return {
    status: 201,
    body: {
      ...created,
      visibility,
      pendingSubmission: false,
      tags: (created.tags as { tag: string }[] | false | undefined)
        ? (created.tags as { tag: string }[]).map((t) => t.tag)
        : [],
      storage: {
        subCompanyId,
        agencyName: agencyRow?.name ?? null,
        visibility,
      },
    },
  };
}

export type StagedImportClient = {
  name: string;
  industry?: string | null;
  location?: string | null;
  address?: string | null;
  companySize?: string | null;
  website?: string | null;
  employees?: string | null;
  sourceId?: string | null;
  tags?: string[];
  contacts: Prisma.InputJsonValue;
};

/** Process CSV pending imports for global or agency destination paths. */
export async function processDestinationAwarePendingImports(params: {
  userId: string;
  submitterRoleKey: string;
  submitterPermissions: string[];
  clients: StagedImportClient[];
  action: 'global' | 'agency';
  targetAgencyId?: string;
}): Promise<{
  count: number;
  autoApprovedCount: number;
  ids: string[];
  destination: 'global' | 'agency';
  subCompanyId?: string;
  agencyName?: string;
}> {
  const { userId, submitterRoleKey, submitterPermissions, clients, action } = params;

  if (action === 'agency') {
    const targetAgencyId = params.targetAgencyId?.trim();
    if (!targetAgencyId) {
      throw new Error('Select an agency for this import (agency mode is enabled in Settings).');
    }
    const agency = await prisma.subCompany.findUnique({
      where: { id: targetAgencyId },
      select: { id: true, name: true },
    });
    if (!agency) {
      throw new Error('Agency not found');
    }

    let autoApprovedCount = 0;
    const createdIds: string[] = [];
    let pendingApprovalCount = 0;
    let pendingNotifyTargetRole: string | null = null;
    const actor = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true },
    });
    const actorName = formatUserDisplayName(actor);

    for (const c of clients) {
      const row = await prisma.pendingImportedClient.create({
        data: {
          subCompanyId: targetAgencyId,
          submissionSource: 'agency',
          importedById: userId,
          name: c.name,
          industry: c.industry ?? null,
          location: c.location ?? null,
          address: c.address ?? null,
          companySize: c.companySize ?? null,
          website: c.website ?? null,
          employees: c.employees ?? null,
          sourceId: c.sourceId ?? null,
          tags: c.tags ?? [],
          contacts: c.contacts,
          currentStepIndex: 0,
          approvalChain: [],
        },
      });
      createdIds.push(row.id);
      const approval = await submitEntityForApproval({
        workflow: 'client_import',
        entityId: row.id,
        subCompanyId: targetAgencyId,
        submitterUserId: userId,
        submitterRoleKey,
        submitterPermissions,
      });
      if (approval.autoApproved) autoApprovedCount += 1;
      else if (approval.targetRoleKey) {
        pendingApprovalCount += 1;
        pendingNotifyTargetRole = approval.targetRoleKey;
      }
    }
    if (pendingNotifyTargetRole && pendingApprovalCount > 0) {
      await notifyPendingImportBatchApproval({
        subCompanyId: targetAgencyId,
        targetRoleKey: pendingNotifyTargetRole,
        actorName,
        pendingCount: pendingApprovalCount,
        link: '/clients?tab=pending',
        relatedId: createdIds[0] ?? userId,
      });
    }
    await invalidateClientListCache(targetAgencyId);
    return {
      count: createdIds.length,
      autoApprovedCount,
      ids: createdIds,
      destination: 'agency',
      subCompanyId: targetAgencyId,
      agencyName: agency.name,
    };
  }

  const { executeGlobalPendingImportApproval } = await import('./pendingImportApproval');
  const importBypass = await orgDatabaseWorkflowBypassesApproval('database_client_import');
  let autoApprovedCount = 0;
  const createdIds: string[] = [];
  let pendingApprovalCount = 0;
  let pendingNotifyTargetRole: string | null = null;
  const globalActor = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true },
  });
  const globalActorName = formatUserDisplayName(globalActor);

  for (const c of clients) {
    const row = await prisma.pendingImportedClient.create({
      data: {
        subCompanyId: null,
        submissionSource: 'global_database',
        importedById: userId,
        name: c.name,
        industry: c.industry ?? null,
        location: c.location ?? null,
        address: c.address ?? null,
        companySize: c.companySize ?? null,
        website: c.website ?? null,
        employees: c.employees ?? null,
        sourceId: c.sourceId ?? null,
        tags: c.tags ?? [],
        contacts: c.contacts,
        currentStepIndex: 0,
        approvalChain: [],
      },
    });
    createdIds.push(row.id);

    if (importBypass) {
      const result = await executeGlobalPendingImportApproval({
        pendingId: row.id,
        approverUserId: userId,
      });
      if (result) autoApprovedCount += 1;
      continue;
    }

    const approval = await submitEntityForApproval({
      workflow: 'database_client_import',
      entityId: row.id,
      subCompanyId: GLOBAL_APPROVAL_SCOPE,
      submitterUserId: userId,
      submitterRoleKey,
      submitterPermissions,
    });
    if (approval.misconfigured) {
      await prisma.pendingImportedClient.delete({ where: { id: row.id } }).catch(() => {});
      continue;
    }
    if (approval.autoApproved) autoApprovedCount += 1;
    else if (approval.targetRoleKey) {
      pendingApprovalCount += 1;
      pendingNotifyTargetRole = approval.targetRoleKey;
    }
  }

  if (pendingNotifyTargetRole && pendingApprovalCount > 0) {
    await notifyPendingImportBatchApproval({
      subCompanyId: GLOBAL_APPROVAL_SCOPE,
      targetRoleKey: pendingNotifyTargetRole,
      actorName: globalActorName,
      pendingCount: pendingApprovalCount,
      link: '/clients?tab=pending&scope=global',
      relatedId: createdIds[0] ?? userId,
    });
  }

  const agencies = await prisma.subCompany.findMany({ select: { id: true } });
  for (const agency of agencies) {
    await invalidateClientListCacheForMainOrg(agency.id).catch(() => {});
  }

  return {
    count: createdIds.length,
    autoApprovedCount,
    ids: createdIds,
    destination: 'global',
  };
}

export async function resolveDestinationManualCreate(params: {
  userId: string;
  userEmail: string | undefined;
  submitterRoleKey: string;
  submitterPermissions: string[];
  data: CreateClientBody;
  action: 'global' | 'agency';
  subCompanyId: string | null;
  actorLabel: string;
  logSubCompanyId: string;
  agencyPathHandler: 'pending' | 'direct';
}): Promise<DestinationManualResult> {
  if (params.action === 'global') {
    return createGlobalDatabaseManualClient({
      userId: params.userId,
      userEmail: params.userEmail,
      submitterRoleKey: params.submitterRoleKey,
      submitterPermissions: params.submitterPermissions,
      data: params.data,
      actorLabel: params.actorLabel,
      logSubCompanyId: params.logSubCompanyId,
    });
  }

  if (!params.subCompanyId) {
    return {
      status: 400,
      body: { error: 'Select an agency for this client (agency mode is enabled in Settings).' },
    };
  }

  if (params.agencyPathHandler === 'direct') {
    return createSuperUserAgencyDirectClient({
      userId: params.userId,
      userEmail: params.userEmail,
      submitterRoleKey: params.submitterRoleKey,
      subCompanyId: params.subCompanyId,
      data: params.data,
    });
  }

  return createAgencyManualClientPending({
    userId: params.userId,
    userEmail: params.userEmail,
    submitterRoleKey: params.submitterRoleKey,
    submitterPermissions: params.submitterPermissions,
    subCompanyId: params.subCompanyId,
    data: params.data,
    actorLabel: params.actorLabel,
  });
}
