import prisma from '../config/database';
import type { Prisma } from '@prisma/client';
import { createNotification } from './notifications';
import { notifyListAssigneeLeft } from './notificationDispatch';
import { sendOffboardingReceivedEmail, getAgencyBranding, type OffboardingTransferCounts } from './email';
import { applyOwnershipChange } from './clientOwnership';

export interface OffboardingItem {
  id: string;
  title: string;
  subtitle?: string;
}

export interface OffboardingEmployeeData {
  user: { id: string; firstName: string; lastName: string; role: string; subCompanyId: string | null };
  emails: OffboardingItem[];
  clients: OffboardingItem[];
  pipeline: OffboardingItem[];
  leads: OffboardingItem[];
  tasks: OffboardingItem[];
  meetings: OffboardingItem[];
  followUps: OffboardingItem[];
}

export interface OffboardingItemAssignment {
  id: string;
  toUserId: string;
}

export interface CommitOffboardingPayload {
  departingUserId: string;
  emailForwardToUserId: string;
  clients: OffboardingItemAssignment[];
  pipeline: OffboardingItemAssignment[];
  leads: OffboardingItemAssignment[];
  tasks: OffboardingItemAssignment[];
  meetings: OffboardingItemAssignment[];
  followUps: OffboardingItemAssignment[];
  fallbackUserId: string;
  deactivateUser: boolean;
}

export interface PartialCommitPayload {
  departingUserId: string;
  fallbackUserId: string;
  actorId: string;
  actorName: string;
  emailForwardToUserId?: string;
  clients?: OffboardingItemAssignment[];
  pipeline?: OffboardingItemAssignment[];
  leads?: OffboardingItemAssignment[];
  tasks?: OffboardingItemAssignment[];
  meetings?: OffboardingItemAssignment[];
  followUps?: OffboardingItemAssignment[];
}

export async function partialCommitOffboarding(
  payload: PartialCommitPayload,
): Promise<void> {
  const {
    departingUserId,
    fallbackUserId,
    actorId,
    actorName,
    emailForwardToUserId,
    clients = [],
    pipeline = [],
    leads = [],
    tasks = [],
    meetings = [],
    followUps = [],
  } = payload;

  const resolveTarget = (toUserId: string | null | undefined) => toUserId ?? fallbackUserId;

  // Fetch subCompanyId before transaction so applyOwnershipChange has it
  const departingUser = await prisma.user.findUnique({
    where: { id: departingUserId },
    select: { subCompanyId: true },
  });
  const subCompanyId = departingUser?.subCompanyId ?? '';

  await prisma.$transaction(async (tx) => {
    if (emailForwardToUserId) {
      await tx.email.updateMany({
        where: { OR: [{ fromUserId: departingUserId }, { toUserId: departingUserId }] },
        data: { forwardedToUserId: emailForwardToUserId, forwardedFromUserId: departingUserId },
      });
      await (tx.user as any).update({
        where: { id: departingUserId },
        data: { emailForwardingToUserId: emailForwardToUserId },
      });
    }

    for (const { id: clientId } of clients) {
      const current = await tx.client.findUnique({
        where: { id: clientId },
        select: { ownershipType: true, ownershipUserId: true },
      });
      await applyOwnershipChange({
        tx,
        clientId,
        subCompanyId,
        actorId,
        actorName,
        previous: {
          type: (current?.ownershipType as 'management' | 'associate' | null) ?? null,
          userId: current?.ownershipUserId ?? null,
        },
        next: { type: 'management', userId: null },
        source: 'offboarding',
      });
      await tx.client.update({
        where: { id: clientId },
        data: { forwardedFromUserId: departingUserId },
      });
    }

    for (const { id: leadId, toUserId } of [...pipeline, ...leads]) {
      await tx.lead.update({
        where: { id: leadId },
        data: { ownerId: resolveTarget(toUserId), forwardedFromUserId: departingUserId },
      });
    }

    for (const { id: taskId, toUserId } of tasks) {
      await tx.task.update({
        where: { id: taskId },
        data: { ownerId: resolveTarget(toUserId), forwardedFromUserId: departingUserId },
      });
    }

    for (const { id: meetingId, toUserId } of meetings) {
      await tx.meeting.update({
        where: { id: meetingId },
        data: { ownerId: resolveTarget(toUserId), forwardedFromUserId: departingUserId },
      });
    }

    for (const { id: followUpId, toUserId } of followUps) {
      await (tx.followUp as any).update({
        where: { id: followUpId },
        data: { ownerId: resolveTarget(toUserId), forwardedFromUserId: departingUserId },
      });
    }
  });

  // Send persistent in-app notifications to each recipient
  const departing = await prisma.user.findUnique({
    where: { id: departingUserId },
    select: { firstName: true, lastName: true },
  });
  if (!subCompanyId) return;

  const departingName = `${departing?.firstName ?? ''} ${departing?.lastName ?? ''}`.trim();

  // Tally counts per recipient
  const tally: Record<string, { emails: number; clients: number; pipeline: number; leads: number; tasks: number; meetings: number; followUps: number }> = {};
  const bump = (userId: string, key: keyof typeof tally[string]) => {
    if (!tally[userId]) tally[userId] = { emails: 0, clients: 0, pipeline: 0, leads: 0, tasks: 0, meetings: 0, followUps: 0 };
    tally[userId][key]++;
  };

  if (emailForwardToUserId) {
    // All emails went to the forwarding target
    const emailCount = await prisma.email.count({ where: { forwardedToUserId: emailForwardToUserId, forwardedFromUserId: departingUserId } });
    if (emailCount > 0) {
      if (!tally[emailForwardToUserId]) tally[emailForwardToUserId] = { emails: 0, clients: 0, pipeline: 0, leads: 0, tasks: 0, meetings: 0, followUps: 0 };
      tally[emailForwardToUserId].emails = emailCount;
    }
  }
  for (const { toUserId } of clients)   bump(resolveTarget(toUserId), 'clients');
  for (const { toUserId } of pipeline)  bump(resolveTarget(toUserId), 'pipeline');
  for (const { toUserId } of leads)     bump(resolveTarget(toUserId), 'leads');
  for (const { toUserId } of tasks)     bump(resolveTarget(toUserId), 'tasks');
  for (const { toUserId } of meetings)  bump(resolveTarget(toUserId), 'meetings');
  for (const { toUserId } of followUps) bump(resolveTarget(toUserId), 'followUps');

  for (const [recipientId, counts] of Object.entries(tally)) {
    const total = counts.emails + counts.clients + counts.pipeline + counts.leads + counts.tasks + counts.meetings + counts.followUps;
    if (total === 0) continue;
    await createNotification({
      userId: recipientId,
      subCompanyId,
      type: 'employee_data_received',
      title: `Data received from ${departingName}`,
      body: `${total} item${total !== 1 ? 's' : ''} transferred to you: ${[
        counts.emails   && `${counts.emails} email${counts.emails !== 1 ? 's' : ''}`,
        counts.clients  && `${counts.clients} client${counts.clients !== 1 ? 's' : ''}`,
        counts.pipeline && `${counts.pipeline} pipeline lead${counts.pipeline !== 1 ? 's' : ''}`,
        counts.leads    && `${counts.leads} lead${counts.leads !== 1 ? 's' : ''}`,
        counts.tasks    && `${counts.tasks} task${counts.tasks !== 1 ? 's' : ''}`,
        counts.meetings && `${counts.meetings} meeting${counts.meetings !== 1 ? 's' : ''}`,
        counts.followUps && `${counts.followUps} follow-up${counts.followUps !== 1 ? 's' : ''}`,
      ].filter(Boolean).join(', ')}.`,
      link: '/emails',
    });
  }
}

export async function getEmployeeData(userId: string): Promise<OffboardingEmployeeData> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, firstName: true, lastName: true, role: true, subCompanyId: true },
  });

  const [emails, clients, pipelineLeads, leads, tasks, meetings, followUps] = await Promise.all([
    prisma.email.findMany({
      where: { OR: [{ fromUserId: userId }, { toUserId: userId }] },
      select: { id: true, subject: true, folder: true, timestamp: true },
      orderBy: { timestamp: 'desc' },
    }),
    prisma.client.findMany({
      where: { ownershipUserId: userId, ownershipType: 'associate' },
      select: { id: true, name: true, corporateCode: true },
    }),
    prisma.lead.findMany({
      where: { ownerId: userId, status: { in: ['open', 'active'] } },
      select: { id: true, stage: true, status: true, client: { select: { name: true } }, value: true },
    }),
    prisma.lead.findMany({
      where: { ownerId: userId, status: { in: ['closed_won', 'closed_won_pending', 'closed_lost'] } },
      select: { id: true, stage: true, status: true, client: { select: { name: true } } },
    }),
    prisma.task.findMany({
      where: { ownerId: userId, status: { not: 'done' } },
      select: { id: true, title: true, dueDate: true, priority: true },
    }),
    prisma.meeting.findMany({
      where: { ownerId: userId, status: 'scheduled' },
      select: { id: true, title: true, startTime: true, client: { select: { name: true } } },
    }),
    prisma.followUp.findMany({
      where: { ownerId: userId, completed: false },
      select: { id: true, notes: true, dueDate: true, client: { select: { name: true } } },
    }),
  ]);

  return {
    user,
    emails: emails.map((e) => ({
      id: e.id,
      title: e.subject,
      subtitle: `${e.folder} · ${new Date(e.timestamp).toLocaleDateString()}`,
    })),
    clients: clients.map((c) => ({ id: c.id, title: c.name, subtitle: c.corporateCode })),
    pipeline: pipelineLeads.map((l) => ({
      id: l.id,
      title: l.client.name,
      subtitle: `Stage: ${l.stage}${l.value ? ` · $${Number(l.value).toLocaleString()}` : ''}`,
    })),
    leads: leads.map((l) => ({
      id: l.id,
      title: l.client.name,
      subtitle: `${l.status} · ${l.stage}`,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      subtitle: `${t.priority} · due ${new Date(t.dueDate).toLocaleDateString()}`,
    })),
    meetings: meetings.map((m) => ({
      id: m.id,
      title: m.title,
      subtitle: `${m.client.name} · ${new Date(m.startTime).toLocaleDateString()}`,
    })),
    followUps: followUps.map((f) => ({
      id: f.id,
      title: f.client.name,
      subtitle: `Due ${new Date(f.dueDate).toLocaleDateString()} · ${f.notes.slice(0, 60)}${f.notes.length > 60 ? '…' : ''}`,
    })),
  };
}

export async function commitOffboarding(
  payload: CommitOffboardingPayload,
  adminId: string,
  subCompanyId: string,
  adminName: string,
): Promise<void> {
  const {
    departingUserId,
    emailForwardToUserId,
    clients,
    pipeline,
    leads,
    tasks,
    meetings,
    followUps,
    fallbackUserId,
    deactivateUser,
  } = payload;

  const resolveTarget = (toUserId: string | null | undefined) =>
    toUserId ?? fallbackUserId;

  // Mailing lists the departing user was assigned to (for post-commit creator notifications).
  let departedFromLists: { listId: string; listName: string; creatorId: string | null; subCompanyId: string }[] = [];

  const summary = await prisma.$transaction(async (tx) => {
    // 1. Emails — all go to one recipient
    await tx.email.updateMany({
      where: {
        OR: [{ fromUserId: departingUserId }, { toUserId: departingUserId }],
      },
      data: {
        forwardedToUserId: emailForwardToUserId,
        forwardedFromUserId: departingUserId,
      },
    });

    // 2. Clients — ownership goes to Management (not the assignee); history logged
    for (const { id: clientId } of clients) {
      const current = await tx.client.findUnique({
        where: { id: clientId },
        select: { ownershipType: true, ownershipUserId: true },
      });
      await applyOwnershipChange({
        tx,
        clientId,
        subCompanyId,
        actorId: adminId,
        actorName: adminName,
        previous: {
          type: (current?.ownershipType as 'management' | 'associate' | null) ?? null,
          userId: current?.ownershipUserId ?? null,
        },
        next: { type: 'management', userId: null },
        source: 'offboarding',
      });
      await tx.client.update({
        where: { id: clientId },
        data: { forwardedFromUserId: departingUserId },
      });
    }

    // 3 & 4. Pipeline + regular leads
    for (const { id: leadId, toUserId } of [...pipeline, ...leads]) {
      await tx.lead.update({
        where: { id: leadId },
        data: {
          ownerId: resolveTarget(toUserId),
          forwardedFromUserId: departingUserId,
        },
      });
    }

    // 5. Tasks
    for (const { id: taskId, toUserId } of tasks) {
      await tx.task.update({
        where: { id: taskId },
        data: {
          ownerId: resolveTarget(toUserId),
          forwardedFromUserId: departingUserId,
        },
      });
    }

    // 6. Meetings
    for (const { id: meetingId, toUserId } of meetings) {
      await tx.meeting.update({
        where: { id: meetingId },
        data: {
          ownerId: resolveTarget(toUserId),
          forwardedFromUserId: departingUserId,
        },
      });
    }

    // 7. Follow-ups
    for (const { id: followUpId, toUserId } of followUps) {
      await (tx.followUp as any).update({
        where: { id: followUpId },
        data: {
          ownerId: resolveTarget(toUserId),
          forwardedFromUserId: departingUserId,
        },
      });
    }

    const summary = {
      emailCount: await tx.email.count({ where: { forwardedFromUserId: departingUserId } }),
      clientCount: clients.length,
      pipelineCount: pipeline.length,
      leadCount: leads.length,
      taskCount: tasks.length,
      meetingCount: meetings.length,
      followUpCount: followUps.length,
    };

    // 7. Audit log
    await tx.offboardingLog.create({
      data: {
        departingUserId,
        adminId,
        subCompanyId,
        payload: payload as unknown as Prisma.InputJsonObject,
        summary: summary as unknown as Prisma.InputJsonObject,
      },
    });

    // 8. Activity log
    await tx.activityLog.create({
      data: {
        type: 'employee_offboarded',
        userId: adminId,
        userName: adminName,
        subCompanyId,
        description: `Employee offboarded. ${summary.emailCount} emails, ${summary.clientCount} clients, ${summary.pipelineCount + summary.leadCount} leads, ${summary.taskCount} tasks, ${summary.meetingCount} meetings reassigned.`,
        metadata: summary as unknown as Prisma.InputJsonObject,
      },
    });

    // 9. Always clear offboarding flag; store email forwarding rule; optionally deactivate
    await tx.user.update({
      where: { id: departingUserId },
      data: {
        offboardingStartedAt: null,
        emailForwardingToUserId: emailForwardToUserId,
        ...(deactivateUser ? { isActive: false } : {}),
      },
    });

    // 9b. Remove departing user from mailing list assignments; capture for creator notifications.
    if (deactivateUser) {
      const assignments = await tx.mailingListAssignment.findMany({
        where: { userId: departingUserId },
        select: { list: { select: { id: true, name: true, createdById: true, subCompanyId: true } } },
      });
      departedFromLists = assignments.map((a) => ({
        listId: a.list.id,
        listName: a.list.name,
        creatorId: a.list.createdById,
        subCompanyId: a.list.subCompanyId,
      }));
      if (assignments.length > 0) {
        await tx.mailingListAssignment.deleteMany({ where: { userId: departingUserId } });
      }
    }

    // 10. Remove departing user from any agency link group (EC-12.3)
    const myLink = await tx.userAgencyLink.findFirst({ where: { userId: departingUserId } });
    if (myLink) {
      await tx.userAgencyLink.delete({ where: { id: myLink.id } });
      const remaining = await tx.userAgencyLink.count({ where: { groupId: myLink.groupId } });
      if (remaining === 1) {
        await tx.userAgencyLink.deleteMany({ where: { groupId: myLink.groupId } });
      }
    }

    return summary;
  });

  // Post-transaction: notify and email each recipient
  const departingUser = await prisma.user.findUnique({
    where: { id: departingUserId },
    select: { firstName: true, lastName: true },
  });
  const departingName = departingUser
    ? `${departingUser.firstName} ${departingUser.lastName}`
    : 'a departing employee';

  // Notify each list creator that their assignee left (skip self-created assignments).
  for (const l of departedFromLists) {
    if (!l.creatorId || l.creatorId === departingUserId) continue;
    notifyListAssigneeLeft({
      creatorId: l.creatorId,
      subCompanyId: l.subCompanyId,
      listId: l.listId,
      listName: l.listName,
      userName: departingName,
    });
  }

  // Build per-recipient tallies
  const tally = new Map<string, OffboardingTransferCounts>();
  const getEntry = (uid: string): OffboardingTransferCounts => {
    if (!tally.has(uid)) tally.set(uid, { emails: 0, clients: 0, pipeline: 0, leads: 0, tasks: 0, meetings: 0, followUps: 0 });
    return tally.get(uid)!;
  };

  getEntry(emailForwardToUserId).emails = summary.emailCount;
  for (const { toUserId } of clients) getEntry(toUserId ?? fallbackUserId).clients++;
  for (const { toUserId } of pipeline) getEntry(toUserId ?? fallbackUserId).pipeline++;
  for (const { toUserId } of leads) getEntry(toUserId ?? fallbackUserId).leads++;
  for (const { toUserId } of tasks) getEntry(toUserId ?? fallbackUserId).tasks++;
  for (const { toUserId } of meetings) getEntry(toUserId ?? fallbackUserId).meetings++;
  for (const { toUserId } of followUps) getEntry(toUserId ?? fallbackUserId).followUps++;

  const agency = await getAgencyBranding(subCompanyId);

  for (const [recipientId, counts] of tally.entries()) {
    const recipient = await prisma.user.findUnique({
      where: { id: recipientId },
      select: { firstName: true, lastName: true, email: true },
    });
    if (!recipient) continue;

    const total = counts.emails + counts.clients + counts.pipeline + counts.leads + counts.tasks + counts.meetings + counts.followUps;
    if (total === 0) continue;

    // In-app persistent notification
    await createNotification({
      userId: recipientId,
      subCompanyId,
      type: 'employee_data_received',
      title: `Data received from ${departingName}`,
      body: `${total} item${total !== 1 ? 's' : ''} transferred to you: ${[
        counts.emails && `${counts.emails} email${counts.emails !== 1 ? 's' : ''}`,
        counts.clients && `${counts.clients} client${counts.clients !== 1 ? 's' : ''}`,
        counts.pipeline && `${counts.pipeline} pipeline lead${counts.pipeline !== 1 ? 's' : ''}`,
        counts.leads && `${counts.leads} lead${counts.leads !== 1 ? 's' : ''}`,
        counts.tasks && `${counts.tasks} task${counts.tasks !== 1 ? 's' : ''}`,
        counts.meetings && `${counts.meetings} meeting${counts.meetings !== 1 ? 's' : ''}`,
        counts.followUps && `${counts.followUps} follow-up${counts.followUps !== 1 ? 's' : ''}`,
      ].filter(Boolean).join(', ')}.`,
      link: '/clients',
    });

    // Email summary
    await sendOffboardingReceivedEmail(
      recipient.email,
      recipient.firstName,
      departingName,
      counts,
      agency,
    ).catch((err) => console.error('[offboarding] email send failed:', err));
  }
}

export interface InProgressUserItem {
  id: string;
  subCompanyId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  location: string | null;
  country: string;
  phone: string | null;
  workStartTime: string;
  workEndTime: string;
  offboardingStartedAt: Date;
  managerName: string | null;
}

export async function getInProgressUsers(subCompanyId: string): Promise<InProgressUserItem[]> {
  const users = await prisma.user.findMany({
    where: { subCompanyId, offboardingStartedAt: { not: null } },
    select: {
      id: true,
      subCompanyId: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      country: true,
      phone: true,
      workStartTime: true,
      workEndTime: true,
      offboardingStartedAt: true,
      reportingManagerIds: true,
      location: { select: { name: true } },
    },
    orderBy: { offboardingStartedAt: 'asc' },
  });

  // Collect all manager IDs to batch-fetch names
  const managerIds = [...new Set(users.flatMap((u) => u.reportingManagerIds).filter(Boolean))];
  const managers = managerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: managerIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const managerMap = new Map(managers.map((m) => [m.id, `${m.firstName} ${m.lastName}`]));

  return users.map((u) => ({
    id: u.id,
    subCompanyId: u.subCompanyId ?? '',
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    role: u.role,
    location: (u as any).location?.name ?? null,
    country: u.country,
    phone: u.phone ?? null,
    workStartTime: u.workStartTime,
    workEndTime: u.workEndTime,
    offboardingStartedAt: (u as any).offboardingStartedAt!,
    managerName: u.reportingManagerIds[0] ? (managerMap.get(u.reportingManagerIds[0]) ?? null) : null,
  }));
}

export interface PastUserItem {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  location: string | null;
  country: string;
  phone: string | null;
  workStartTime: string;
  workEndTime: string;
  departedAt: Date;
  adminName: string;
  startDate: Date | null;
}

export async function getPastOffboardedUsers(subCompanyId: string): Promise<PastUserItem[]> {
  // One log per departing user — take the most recent if somehow multiple exist
  const logs = await prisma.offboardingLog.findMany({
    where: { subCompanyId },
    include: {
      departingUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          country: true,
          phone: true,
          workStartTime: true,
          workEndTime: true,
          startDate: true,
          location: { select: { name: true } },
        },
      },
      admin: { select: { firstName: true, lastName: true } },
    },
    orderBy: { committedAt: 'desc' },
  });

  // Deduplicate by departingUserId — keep most recent log per user
  const seen = new Set<string>();
  const deduped = logs.filter((l) => {
    if (seen.has(l.departingUserId)) return false;
    seen.add(l.departingUserId);
    return true;
  });

  return deduped.map((l) => ({
    userId: l.departingUser.id,
    firstName: l.departingUser.firstName,
    lastName: l.departingUser.lastName,
    email: l.departingUser.email,
    role: l.departingUser.role,
    location: l.departingUser.location?.name ?? null,
    country: l.departingUser.country,
    phone: l.departingUser.phone ?? null,
    workStartTime: l.departingUser.workStartTime,
    workEndTime: l.departingUser.workEndTime,
    departedAt: l.committedAt,
    adminName: `${l.admin.firstName} ${l.admin.lastName}`,
    startDate: l.departingUser.startDate,
  }));
}
