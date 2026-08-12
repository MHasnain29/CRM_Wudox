import { randomUUID } from 'crypto';
import prisma from '../config/database';
import { resolveEffectiveScopeLevel } from './accessContext';
import { createNotification } from './notifications';
import { getDataScopeLevelForRoleKey, getEffectivePermissionKeysForRoleKey } from './rbac';
import { emitToUsers } from '../socket';

export interface LinkedAccount {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  country: string;
  subCompanyId: string;
  subCompanyName: string;
  role: string;
  isActive: boolean;
  /** Effective RBAC data scope for chip labels (· Team / · Agency). */
  dataScopeLevel?: 'own' | 'team' | 'agency' | 'global';
}

/**
 * Return all active linked accounts for a user, excluding the user themselves.
 * Only returns isActive=true accounts — deactivated accounts are never shown.
 */
export async function getLinkedAccounts(userId: string): Promise<LinkedAccount[]> {
  const myLink = await prisma.userAgencyLink.findFirst({ where: { userId } });
  if (!myLink) return [];

  const groupMembers = await prisma.userAgencyLink.findMany({
    where: { groupId: myLink.groupId, userId: { not: userId } },
    include: {
      user: {
        include: { subCompany: true },
      },
    },
  });

  const active = groupMembers.filter((m) => m.user.isActive && !m.user.offboardingStartedAt);

  const scopeByRole = new Map<string, 'own' | 'team' | 'agency' | 'global'>();
  await Promise.all(
    [...new Set(active.map((m) => m.user.role))].map(async (role) => {
      const [scopeFromDb, permissions] = await Promise.all([
        getDataScopeLevelForRoleKey(role),
        getEffectivePermissionKeysForRoleKey(role),
      ]);
      scopeByRole.set(role, resolveEffectiveScopeLevel(role, scopeFromDb, permissions));
    }),
  );

  return active.map((m) => ({
    userId: m.user.id,
    firstName: m.user.firstName,
    lastName: m.user.lastName,
    email: m.user.email,
    country: m.user.country,
    subCompanyId: m.user.subCompanyId ?? '',
    subCompanyName: m.user.subCompany?.name ?? '',
    role: m.user.role,
    isActive: m.user.isActive,
    dataScopeLevel: scopeByRole.get(m.user.role),
  }));
}

export interface LinkGroup {
  groupId: string;
  members: LinkedAccount[];
}

/**
 * Return all link groups with their members (for admin overview).
 */
export async function getAllLinkGroups(): Promise<LinkGroup[]> {
  const allLinks = await prisma.userAgencyLink.findMany({
    include: {
      user: { include: { subCompany: true } },
    },
  });

  const groups = new Map<string, LinkGroup>();
  for (const link of allLinks) {
    if (!groups.has(link.groupId)) {
      groups.set(link.groupId, { groupId: link.groupId, members: [] });
    }
    groups.get(link.groupId)!.members.push({
      userId: link.user.id,
      firstName: link.user.firstName,
      lastName: link.user.lastName,
      email: link.user.email,
      country: link.user.country,
      subCompanyId: link.user.subCompanyId ?? '',
      subCompanyName: link.user.subCompany?.name ?? '',
      role: link.user.role,
      isActive: link.user.isActive,
    });
  }

  return Array.from(groups.values());
}

/**
 * Validate that a switch from currentUserId to targetUserId is allowed.
 * Returns the target User record if valid, throws with a status-coded error otherwise.
 */
export async function validateSwitchTarget(currentUserId: string, targetUserId: string) {
  const myLink = await prisma.userAgencyLink.findFirst({ where: { userId: currentUserId } });
  if (!myLink) {
    const err = new Error('No linked agency accounts found');
    (err as any).status = 403;
    throw err;
  }

  const targetLink = await prisma.userAgencyLink.findFirst({
    where: { groupId: myLink.groupId, userId: targetUserId },
  });
  if (!targetLink) {
    const err = new Error('Target account is not linked to your account');
    (err as any).status = 403;
    throw err;
  }

  const [targetUser, callerUser] = await Promise.all([
    prisma.user.findUnique({ where: { id: targetUserId }, include: { subCompany: true } }),
    prisma.user.findUnique({ where: { id: currentUserId }, select: { subCompany: { select: { mainOrgId: true } } } }),
  ]);

  if (!targetUser || !targetUser.isActive || targetUser.offboardingStartedAt) {
    const err = new Error('Target account is not available');
    (err as any).status = 403;
    throw err;
  }

  // Defence-in-depth: re-verify same org even if link group was created with a null-bypass
  const callerMainOrg = callerUser?.subCompany?.mainOrgId;
  const targetMainOrg = targetUser.subCompany?.mainOrgId;
  if (!callerMainOrg || !targetMainOrg || callerMainOrg !== targetMainOrg) {
    const err = new Error('Cross-organisation switch not permitted');
    (err as any).status = 403;
    throw err;
  }

  return targetUser;
}

const LINKED_USER_COLORS = [
  '#EA580C', // orange-600  — first: max contrast vs self indigo
  '#16A34A', // green-600
  '#DC2626', // red-600
  '#0891B2', // cyan-600
  '#DB2777', // pink-600
  '#9333EA', // purple-600  — last: closest to self, avoid if possible
];

/** Linked accounts must share the same role (designation) and RBAC data-scope level. */
async function assertSameRoleAndScopeLevel(roleA: string, roleB: string): Promise<void> {
  if (roleA !== roleB) {
    const err = new Error(
      `Cannot link different designations: ${roleA} and ${roleB}. Both accounts must have the same role.`,
    );
    (err as any).status = 400;
    throw err;
  }

  const [scopeA, scopeB, permsA, permsB] = await Promise.all([
    getDataScopeLevelForRoleKey(roleA),
    getDataScopeLevelForRoleKey(roleB),
    getEffectivePermissionKeysForRoleKey(roleA),
    getEffectivePermissionKeysForRoleKey(roleB),
  ]);
  const levelA = resolveEffectiveScopeLevel(roleA, scopeA, permsA);
  const levelB = resolveEffectiveScopeLevel(roleB, scopeB, permsB);
  if (levelA !== levelB) {
    const err = new Error(
      `Cannot link different scope levels: ${roleA} is ${levelA}, other is ${levelB}. Both must match.`,
    );
    (err as any).status = 400;
    throw err;
  }
}

/**
 * Link two users into a shared group (or add one to an existing group).
 * Validates: same role + same data-scope level, different emails, same mainOrgId,
 * both active, no conflicting groups.
 */
export async function linkUsers(
  adminUserId: string,
  targetUserIdA: string,
  targetUserIdB: string,
): Promise<void> {
  const [userA, userB] = await Promise.all([
    prisma.user.findUnique({ where: { id: targetUserIdA }, include: { subCompany: true } }),
    prisma.user.findUnique({ where: { id: targetUserIdB }, include: { subCompany: true } }),
  ]);

  if (!userA || !userB) {
    const err = new Error('One or both users not found');
    (err as any).status = 400;
    throw err;
  }

  // Guard: same email would collapse to one record
  if (userA.email.toLowerCase() === userB.email.toLowerCase()) {
    const err = new Error('Cannot link two accounts with the same email address');
    (err as any).status = 400;
    throw err;
  }

  // Must be in the same org — fail-closed: if either subCompany/mainOrgId is missing, reject
  const mainOrgA = userA.subCompany?.mainOrgId;
  const mainOrgB = userB.subCompany?.mainOrgId;
  if (!mainOrgA || !mainOrgB || mainOrgA !== mainOrgB) {
    const err = new Error('Cannot link users from different organisations');
    (err as any).status = 400;
    throw err;
  }

  // Both must be active and not offboarding
  if (!userA.isActive || userA.offboardingStartedAt) {
    const err = new Error(`User ${userA.firstName} ${userA.lastName} is inactive or offboarding`);
    (err as any).status = 400;
    throw err;
  }
  if (!userB.isActive || userB.offboardingStartedAt) {
    const err = new Error(`User ${userB.firstName} ${userB.lastName} is inactive or offboarding`);
    (err as any).status = 400;
    throw err;
  }

  // Same designation (role) + same data-scope level required
  await assertSameRoleAndScopeLevel(userA.role, userB.role);

  const [linkA, linkB] = await Promise.all([
    prisma.userAgencyLink.findFirst({ where: { userId: targetUserIdA } }),
    prisma.userAgencyLink.findFirst({ where: { userId: targetUserIdB } }),
  ]);

  // When adding into an existing group, new user must match every current member
  const existingGroupId = linkA?.groupId ?? linkB?.groupId;
  if (existingGroupId) {
    const groupMembers = await prisma.userAgencyLink.findMany({
      where: { groupId: existingGroupId },
      include: { user: { select: { role: true, firstName: true, lastName: true } } },
    });
    const newcomer = linkA ? userB : userA;
    for (const m of groupMembers) {
      if (m.userId === newcomer.id) continue;
      try {
        await assertSameRoleAndScopeLevel(m.user.role, newcomer.role);
      } catch (e: any) {
        e.message = `Cannot add to group: ${m.user.firstName} ${m.user.lastName} is ${m.user.role}, new user is ${newcomer.role}. Same role and scope level required.`;
        throw e;
      }
    }
  }

  // Both already in different groups — conflict, require unlinking first
  if (linkA && linkB && linkA.groupId !== linkB.groupId) {
    const err = new Error(
      'Both users already belong to separate link groups. Remove one link first before creating a new one.',
    );
    (err as any).status = 409;
    throw err;
  }

  // Both already in the same group — nothing to do
  if (linkA && linkB && linkA.groupId === linkB.groupId) {
    const err = new Error('These users are already linked');
    (err as any).status = 409;
    throw err;
  }

  // Determine the groupId to use
  const groupId = linkA?.groupId ?? linkB?.groupId ?? randomUUID();

  await prisma.$transaction(async (tx) => {
    const existingCount = await tx.userAgencyLink.count({ where: { groupId } });
    let colorIdx = existingCount;

    if (!linkA) {
      await tx.userAgencyLink.create({
        data: { groupId, userId: targetUserIdA, createdBy: adminUserId, color: LINKED_USER_COLORS[colorIdx % LINKED_USER_COLORS.length] },
      });
      colorIdx++;
    }
    if (!linkB) {
      await tx.userAgencyLink.create({
        data: { groupId, userId: targetUserIdB, createdBy: adminUserId, color: LINKED_USER_COLORS[colorIdx % LINKED_USER_COLORS.length] },
      });
      colorIdx++;
    }

    const count = await tx.userAgencyLink.count({ where: { groupId } });
    if (count < 2) {
      await tx.userAgencyLink.deleteMany({ where: { groupId } });
      const err = new Error('Link group was modified concurrently. Please try again.');
      (err as any).status = 409;
      throw err;
    }
  });

  emitToUsers([targetUserIdA, targetUserIdB], 'agency:link_changed', {});

  // Notify both users via bell icon (fire-and-forget, never block the link operation)
  const agencyNameA = userA.subCompany?.name ?? 'another agency';
  const agencyNameB = userB.subCompany?.name ?? 'another agency';

  void createNotification({
    userId: targetUserIdA,
    subCompanyId: userA.subCompanyId ?? '',
    type: 'agency_linked',
    title: 'Agency account linked',
    body: `Your account has been linked to ${agencyNameB}. You can now switch between agencies from the sidebar.`,
    link: '/settings?tab=linked-accounts',
  }).catch(() => {});

  void createNotification({
    userId: targetUserIdB,
    subCompanyId: userB.subCompanyId ?? '',
    type: 'agency_linked',
    title: 'Agency account linked',
    body: `Your account has been linked to ${agencyNameA}. You can now switch between agencies from the sidebar.`,
    link: '/settings?tab=linked-accounts',
  }).catch(() => {});
}

/**
 * Given a caller and a list of requested user IDs, return only those IDs that
 * belong to the same link group as the caller (and are not the caller).
 * Returns [] if the caller has no link group or none of the IDs are linked.
 */
export async function filterToLinkedAccounts(
  callerUserId: string,
  requestedIds: string[],
): Promise<string[]> {
  const scope = await resolveLinkedAccountScope(callerUserId, requestedIds);
  return scope?.userIds ?? [];
}

/**
 * Full scope resolver for linked-user queries (legacy shape).
 * Prefer expandLinkedOwnerScope for mode-aware (owners/agencies/mixed) filtering.
 */
export async function resolveLinkedOwnerScope(
  callerUserId: string,
  callerSubCompanyId: string | null | undefined,
  requestedIds: string[],
): Promise<{ userIds: string[]; subCompanyIds: string[] } | null> {
  const { expandLinkedOwnerScope } = await import('./linkedOwnerExpand');
  const exp = await expandLinkedOwnerScope(callerUserId, callerSubCompanyId, requestedIds);
  if (!exp) return null;
  return { userIds: exp.userIds, subCompanyIds: exp.subCompanyIds };
}

/**
 * Validate requestedIds against the caller's link group and return both
 * the valid user IDs AND their subCompanyIds.
 * Returns null if the caller has no link group or none of the IDs are valid.
 */
export async function resolveLinkedAccountScope(
  callerUserId: string,
  requestedIds: string[],
): Promise<{ userIds: string[]; subCompanyIds: string[] } | null> {
  if (requestedIds.length === 0) return null;
  const callerLink = await prisma.userAgencyLink.findFirst({
    where: { userId: callerUserId },
    select: { groupId: true },
  });
  if (!callerLink) return null;
  const matched = await prisma.userAgencyLink.findMany({
    where: { groupId: callerLink.groupId, userId: { in: requestedIds, not: callerUserId } },
    include: { user: { select: { subCompanyId: true } } },
  });
  if (matched.length === 0) return null;
  const subCompanyIds = [
    ...new Set(matched.map((m) => m.user.subCompanyId).filter((id): id is string => !!id)),
  ];
  return { userIds: matched.map((m) => m.userId), subCompanyIds };
}

/**
 * Remove a user from their agency link group.
 * If the group shrinks to 1 member, remove that last member too (a group of 1 is no group).
 * Notifies both the removed user and their former partner(s), and emits a socket event so
 * both UIs refresh immediately.
 */
export async function unlinkUser(_adminUserId: string, targetUserId: string): Promise<void> {
  const myLink = await prisma.userAgencyLink.findFirst({ where: { userId: targetUserId } });
  if (!myLink) {
    const err = new Error('This user has no linked accounts');
    (err as any).status = 404;
    throw err;
  }

  const { groupId } = myLink;

  // Capture all group members (including the target) before we delete anything,
  // so we can notify/emit to every affected user afterwards.
  const allGroupMembers = await prisma.userAgencyLink.findMany({
    where: { groupId },
    include: { user: { include: { subCompany: true } } },
  });

  const partnerIds = allGroupMembers
    .map((m) => m.userId)
    .filter((id) => id !== targetUserId);

  const targetUser = allGroupMembers.find((m) => m.userId === targetUserId)?.user;
  const targetAgencyName = targetUser?.subCompany?.name ?? 'their agency';

  await prisma.$transaction(async (tx) => {
    await tx.userAgencyLink.delete({ where: { id: myLink.id } });

    const remaining = await tx.userAgencyLink.count({ where: { groupId } });
    if (remaining === 1) {
      await tx.userAgencyLink.deleteMany({ where: { groupId } });
    }
  });

  // Emit socket event to ALL affected users so their UIs refresh instantly
  const allAffectedIds = [targetUserId, ...partnerIds];
  emitToUsers(allAffectedIds, 'agency:link_changed', {});

  // Bell notifications — fire-and-forget
  void createNotification({
    userId: targetUserId,
    subCompanyId: targetUser?.subCompanyId ?? '',
    type: 'agency_unlinked',
    title: 'Agency account unlinked',
    body: 'Your account has been unlinked. You can no longer switch to linked agencies.',
    link: '/settings?tab=linked-accounts',
  }).catch(() => {});

  for (const partner of allGroupMembers.filter((m) => m.userId !== targetUserId)) {
    void createNotification({
      userId: partner.userId,
      subCompanyId: partner.user.subCompanyId ?? '',
      type: 'agency_unlinked',
      title: 'Agency account unlinked',
      body: `Your link to ${targetAgencyName} has been removed.`,
      link: '/settings?tab=linked-accounts',
    }).catch(() => {});
  }
}

/**
 * Dissolve an entire link group (all members). Used by admin Delete group action.
 */
export async function dissolveLinkGroup(_adminUserId: string, groupId: string): Promise<void> {
  const allGroupMembers = await prisma.userAgencyLink.findMany({
    where: { groupId },
    include: { user: { include: { subCompany: true } } },
  });

  if (allGroupMembers.length === 0) {
    const err = new Error('Link group not found');
    (err as any).status = 404;
    throw err;
  }

  await prisma.userAgencyLink.deleteMany({ where: { groupId } });

  const affectedIds = allGroupMembers.map((m) => m.userId);
  emitToUsers(affectedIds, 'agency:link_changed', {});

  for (const member of allGroupMembers) {
    void createNotification({
      userId: member.userId,
      subCompanyId: member.user.subCompanyId ?? '',
      type: 'agency_unlinked',
      title: 'Agency account unlinked',
      body: 'Your linked-account group was deleted. You can no longer switch to linked agencies.',
      link: '/settings?tab=linked-accounts',
    }).catch(() => {});
  }
}
