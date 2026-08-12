import prisma from '../config/database';
import { createActivityLog } from './activityLog';
import { dispatchNotificationToUser } from './notificationDispatch';
import { emitToUsers } from '../socket';
import { defaultLockDays, describeClientVisibilityOutcome, resolveClientVisibility } from './clientVisibilityPolicy';
import { isSuperUserScreenRole } from '../config/clientCreateApproval';
import {
  performManualClientCreate,
  pendingSubmissionToCreateBody,
} from './clientManualCreate';
import {
  performManualClientUpdate,
  pendingEditToUpdateBody,
} from './clientPendingEdit';

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

async function invalidateAllOrgClientCaches(): Promise<void> {
  const { invalidateClientListCacheForMainOrg } = await import('./clientListCache');
  const agencies = await prisma.subCompany.findMany({ select: { id: true, mainOrgId: true } });
  const mainOrgIds = [...new Set(agencies.map((a) => a.mainOrgId).filter(Boolean))];
  for (const agency of agencies) {
    await invalidateClientListCacheForMainOrg(agency.id).catch(() => {});
  }
  if (mainOrgIds.length === 0 && agencies[0]) {
    await invalidateClientListCacheForMainOrg(agencies[0].id).catch(() => {});
  }
}

/** Mirrors pending-submission approve — used by routes and auto-approve job. */
export async function executePendingSubmissionApproval(params: {
  pendingId: string;
  subCompanyId: string | null;
  approverUserId: string;
  autoApproved?: boolean;
}) {
  const { pendingId, subCompanyId, approverUserId, autoApproved } = params;

  const [pending, visibilitySetting, actor] = await Promise.all([
    prisma.pendingClientSubmission.findFirst({
      where:
        subCompanyId === null
          ? { id: pendingId, submissionSource: 'global_database' }
          : { id: pendingId, subCompanyId: subCompanyId! },
    }),
    subCompanyId
      ? prisma.clientVisibilitySetting.findUnique({
          where: { subCompanyId },
          select: { days: true },
        })
      : Promise.resolve(null),
    prisma.user.findUnique({
      where: { id: approverUserId },
      select: { firstName: true, lastName: true, email: true, role: true, subCompanyId: true },
    }),
  ]);
  if (!pending) return { ok: false as const, error: 'Not found' };

  const isGlobal = subCompanyId === null || pending.submissionSource === 'global_database';

  const data = pendingSubmissionToCreateBody(pending);
  if (!data) return { ok: false as const, error: 'Invalid stored submission' };

  const lockDays = defaultLockDays(visibilitySetting?.days);
  const visibility = isGlobal
    ? ('global' as const)
    : resolveClientVisibility({
        creatorRole: pending.submitterRole ?? undefined,
        lockDays,
        explicitAgencyPath: isSuperUserScreenRole(pending.submitterRole ?? undefined),
      });

  const visibilityNote = isGlobal
    ? 'It is now visible to all agencies.'
    : describeClientVisibilityOutcome(lockDays, visibility);

  const slug = data.name.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'client';
  const corporateCode = `${slug}-${Date.now()}`;

  const created = await prisma.$transaction(async (tx) => {
    const clientRow = await performManualClientCreate(tx, {
      data,
      subCompanyId: isGlobal ? null : subCompanyId!,
      corporateCode,
      visibility,
      createdByRole: pending.submitterRole ?? null,
      createdById: pending.submittedById,
      skipClientSubCompany: isGlobal,
    });
    await tx.pendingClientSubmission.delete({ where: { id: pending.id } });
    return clientRow;
  });
  if (!created) return { ok: false as const, error: 'Failed to create client' };

  if (isGlobal) {
    await invalidateAllOrgClientCaches();
  } else {
    const { invalidateClientListCache, invalidateClientListCacheForMainOrg } = await import(
      './clientListCache'
    );
    if (visibility === 'global') {
      await invalidateClientListCacheForMainOrg(subCompanyId!);
      const own = await prisma.subCompany.findUnique({
        where: { id: subCompanyId! },
        select: { mainOrgId: true },
      });
      if (own?.mainOrgId) {
        const users = await prisma.user.findMany({
          where: { isActive: true, subCompany: { mainOrgId: own.mainOrgId } },
          select: { id: true },
        });
        if (users.length > 0) {
          emitToUsers(users.map((u) => u.id), 'client:refresh', { subCompanyId: subCompanyId! });
        }
      }
    } else {
      await invalidateClientListCache(subCompanyId!);
    }
  }

  const userName = formatUserDisplayName(actor);
  const autoSuffix = autoApproved ? ' (auto-approved after expiry)' : '';
  const logSubCompanyId = subCompanyId ?? actor?.subCompanyId ?? pending.submittedById;
  await createActivityLog({
    userId: approverUserId,
    userName,
    subCompanyId: logSubCompanyId,
    type: 'client_created',
    description: `Approved pending submission and created client ${created.name}${autoSuffix}`,
    metadata: {
      clientId: created.id,
      clientName: created.name,
      autoApproved: !!autoApproved,
      globalDatabase: isGlobal,
    },
  });

  void dispatchNotificationToUser({
    userId: pending.submittedById,
    subCompanyId: logSubCompanyId,
    eventKey: autoApproved ? 'client_created_auto_approved' : 'client_created_approved',
    context: {
      entityLabel: created.name,
      actorName: userName,
      visibilityNote,
    },
    link: buildClientNotificationLink(created.id),
    relatedId: created.id,
  }).catch(() => {});

  emitToUsers([pending.submittedById, approverUserId], 'client:refresh', {
    subCompanyId: logSubCompanyId,
  });

  return { ok: true as const, client: created };
}

/** Mirrors pending-edit approve — used by routes and auto-approve job. */
export async function executePendingEditApproval(params: {
  pendingEditId: string;
  subCompanyId: string;
  approverUserId: string;
  autoApproved?: boolean;
}) {
  const { pendingEditId, subCompanyId, approverUserId, autoApproved } = params;

  const [pending, actor] = await Promise.all([
    prisma.pendingClientEdit.findFirst({
      where: { id: pendingEditId, subCompanyId },
    }),
    prisma.user.findUnique({
      where: { id: approverUserId },
      select: { firstName: true, lastName: true, email: true },
    }),
  ]);
  if (!pending) return { ok: false as const, error: 'Not found' };

  const data = pendingEditToUpdateBody(pending);
  if (!data) return { ok: false as const, error: 'Invalid stored edit' };

  const updated = await prisma.$transaction(async (tx) => {
    const clientRow = await performManualClientUpdate(tx, {
      clientId: pending.clientId,
      subCompanyId,
      data,
    });
    await tx.pendingClientEdit.delete({ where: { id: pending.id } });
    return clientRow;
  });
  if (!updated) return { ok: false as const, error: 'Failed to update client' };

  const { invalidateClientListCache } = await import('./clientListCache');
  await invalidateClientListCache(subCompanyId);

  const userName = formatUserDisplayName(actor);
  const autoSuffix = autoApproved ? ' (auto-approved after expiry)' : '';
  await createActivityLog({
    userId: approverUserId,
    userName,
    subCompanyId,
    type: 'client_updated',
    description: `Approved pending edit for client "${updated.name}"${autoSuffix}`,
    metadata: {
      clientId: updated.id,
      clientName: updated.name,
      pendingEditId: pending.id,
      autoApproved: !!autoApproved,
    },
  });

  void dispatchNotificationToUser({
    userId: pending.submittedById,
    subCompanyId,
    eventKey: autoApproved ? 'client_edit_auto_approved' : 'client_updated',
    context: {
      entityLabel: updated.name,
      actorName: userName,
    },
    link: buildClientNotificationLink(updated.id),
    relatedId: updated.id,
  }).catch(() => {});

  emitToUsers([pending.submittedById, approverUserId], 'client:refresh', { subCompanyId });

  return { ok: true as const, client: updated };
}
