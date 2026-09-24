import type { DailyReportPolicy, Prisma } from '@prisma/client';
import prisma from '../config/database';
import { hasPermission } from './accessContext';
import { reportAudience, type ReportUser } from './dailyReportRecipients';
import { profileResolver } from './dailyReportProfiles';
import { hubstaffTaskIsOpen, inputActivityPercent, localDateKey, reportDayBounds, uniqueCompletedCount } from './reportMetrics';
import type { DailyReportPayload, ReportPerson, ReportTask } from './dailyReportTypes';

function inPeriod(date: Date | null, start: Date, end: Date): boolean {
  return !!date && date >= start && date < end;
}
const total = <T>(rows: T[], pick: (row: T) => number) => rows.reduce((n, r) => n + pick(r), 0);
const messageIdentity = (message: { id: string; inboundMessageId: string | null }) => message.inboundMessageId?.trim()
  ? `message:${message.inboundMessageId.trim().replace(/^<([^<>]+)>$/, '$1')}` : `row:${message.id}`;

export function coversDateRange(ranges: { startDate: Date; endDate: Date }[], start: Date, end: Date): boolean {
  let cursor = start.getTime();
  for (const range of [...ranges].sort((a, b) => a.startDate.getTime() - b.startDate.getTime())) {
    if (range.startDate.getTime() > cursor) break;
    if (range.endDate.getTime() >= cursor) cursor = range.endDate.getTime() + 86400000;
    if (cursor > end.getTime()) return true;
  }
  return false;
}

export async function buildDailyReport(policy: DailyReportPolicy, recipient: ReportUser, reportDate: string, directReportsOnly = false, now = new Date()): Promise<DailyReportPayload> {
  const bounds = reportDayBounds(reportDate, policy.timezone);
  const end = new Date(Math.min(bounds.end.getTime(), now.getTime()));
  if (end <= bounds.start) throw new Error('Reports cannot cover a future date');
  const { ctx, agencyIds, users } = await reportAudience(recipient, policy.agencyIds, directReportsOnly, false, policy.scope === 'organization');
  if (!agencyIds.length) throw new Error('Recipient has no access to the selected agencies');
  const agencies = await prisma.subCompany.findMany({ where: { id: { in: agencyIds } }, select: { id: true, name: true, mainOrgId: true } });
  const resolveProfile = await profileResolver([...new Set(agencies.map(a => a.mainOrgId))], end);
  const userIds = users.map(u => u.id);
  const primaryProfiles = new Map(users.map(user => [user.id, resolveProfile(user, (agencies.find(a => a.id === user.subCompanyId) ?? agencies[0])!.mainOrgId)]));
  // Project mappings categorize time; they never opt software staff into CRM measurement.
  const crmUserIds = users.filter(user => primaryProfiles.get(user.id) !== 'software' && policy.profiles.includes(primaryProfiles.get(user.id)!)).map(user => user.id);
  const period = { gte: bounds.start, lt: end };
  const sourcePermissions: string[] = [];
  const permitted = (permission: string) => {
    const yes = hasPermission(ctx, permission);
    if (yes) sourcePermissions.push(permission);
    return yes;
  };
  const communications = crmUserIds.length > 0 && permitted('calls:read');
  const tasksAllowed = crmUserIds.length > 0 && permitted('tasks:read');
  const meetingsAllowed = crmUserIds.length > 0 && permitted('meetings:read');
  const leadsAllowed = crmUserIds.length > 0 && permitted('leads:read');
  const followUpsAllowed = crmUserIds.length > 0 && (hasPermission(ctx, 'clients:read') ? permitted('clients:read') : permitted('employees:read'));
  const recruitmentAllowed = crmUserIds.length > 0 && hasPermission(ctx, 'jobs:read') && permitted('employees:read');
  if (recruitmentAllowed) sourcePermissions.push('jobs:read');
  const allTimeAllowed = hasPermission(ctx, 'hubstaff:view_all');
  if (allTimeAllowed) sourcePermissions.push('hubstaff:view_all');
  const scope = { subCompanyId: { in: agencyIds } };
  const owners = { ownerId: { in: crmUserIds } };

  const [emails, acceptedRecipients, unknownEmails, inbox, campaigns, calls, inboundCalls, events, tasks, followUps, meetings, leads, placements, crmActivity, targets] = await Promise.all([
    communications && crmUserIds.length ? prisma.email.findMany({ where: { ...scope, activityActorId: { in: crmUserIds }, sendStatus: 'accepted', sendingKind: 'personal', sentAt: period }, select: { id: true, activityActorId: true, subject: true, sentAt: true } }) : [],
    communications && crmUserIds.length ? prisma.emailRecipient.findMany({ where: { emailRecord: { ...scope, activityActorId: { in: crmUserIds }, sendingKind: 'personal' }, sendStatus: 'accepted', sentAt: period, recipientType: 'to' }, select: { emailAddress: true, emailRecord: { select: { activityActorId: true } } } }) : [],
    communications && crmUserIds.length ? prisma.email.findMany({ where: { ...scope, folder: 'sent', OR: [{ fromUserId: { in: crmUserIds } }, { activityActorId: { in: crmUserIds } }], AND: [{ OR: [{ sendStatus: null }, { sendStatus: 'pending' }] }], timestamp: period }, select: { id: true, fromUserId: true, activityActorId: true } }) : [],
    communications && crmUserIds.length ? prisma.email.findMany({ where: { ...scope, OR: [{ forwardedToUserId: { in: crmUserIds } }, { forwardedToUserId: null, toUserId: { in: crmUserIds } }], folder: 'inbox', timestamp: period }, select: { id: true, subCompanyId: true, toUserId: true, forwardedToUserId: true, inReplyTo: true, threadId: true, inboundMessageId: true, isRead: true, subject: true, timestamp: true } }) : [],
    communications && crmUserIds.length ? prisma.emailCampaignRecipient.findMany({ where: { campaign: { ...scope, createdById: { in: crmUserIds } }, OR: [{ sentAt: period }, { deliveredAt: period }, { bouncedAt: period }] }, select: { id: true, sentAt: true, deliveredAt: true, bouncedAt: true, campaign: { select: { createdById: true } } } }) : [],
    communications ? prisma.call.findMany({ where: { ...scope, ...owners, timestamp: period }, select: { ownerId: true, outcome: true, duration: true } }) : [],
    communications ? prisma.inboundCall.findMany({ where: { ...scope, answeredByUserId: { in: crmUserIds }, outcome: 'answered', startedAt: period }, select: { answeredByUserId: true } }) : [],
    (tasksAllowed || followUpsAllowed) && crmUserIds.length ? prisma.workCompletionEvent.findMany({ where: { ...scope, userId: { in: crmUserIds }, occurredAt: period }, orderBy: { occurredAt: 'desc' } }) : [],
    tasksAllowed ? prisma.task.findMany({ where: { ...scope, ...owners, createdAt: { lt: end }, OR: [{ status: { not: 'done' } }, { completedAt: period }] }, select: { id: true, ownerId: true, title: true, status: true, dueDate: true, completedAt: true } }) : [],
    followUpsAllowed ? prisma.followUp.findMany({ where: { ...scope, ...owners, createdAt: { lt: end }, OR: [{ dueDate: { lt: end } }, { completedAt: period }] }, select: { id: true, ownerId: true, completed: true, dueDate: true, completedAt: true } }) : [],
    meetingsAllowed ? prisma.meeting.findMany({ where: { ...scope, ...owners, OR: [{ createdAt: period }, { startTime: period }] }, select: { ownerId: true, createdAt: true, startTime: true, status: true } }) : [],
    leadsAllowed ? prisma.lead.findMany({ where: { ...scope, ...owners, status: 'closed_won', closedAt: period }, select: { ownerId: true } }) : [],
    recruitmentAllowed ? prisma.employeeAssignment.findMany({ where: { submittedById: { in: crmUserIds }, approvedAt: period, status: 'approved', employee: { addedBy: { subCompanyId: { in: agencyIds } } } }, select: { submittedById: true } }) : [],
    crmUserIds.length ? prisma.activityLog.findMany({ where: { ...scope, userId: { in: crmUserIds }, timestamp: period, type: { in: ['call_made', 'email_sent', 'task_created', 'task_completed', 'follow_up_created', 'follow_up_completed', 'meeting_scheduled', 'comment_added', 'lead_created', 'pipeline_moved'] } }, select: { id: true, userId: true, timestamp: true, type: true, metadata: true }, orderBy: { timestamp: 'asc' } }) : [],
    crmUserIds.length ? prisma.performanceTarget.findMany({ where: { subCompanyId: { in: agencyIds }, effectiveFrom: { lte: bounds.start } }, orderBy: { effectiveFrom: 'desc' } }) : [],
  ]);

  // Every inbound message gets a thread ID, including new conversations. A reply
  // needs the explicit parent link produced by the inbound reply-address handler.
  const replyParentIds = [...new Set(inbox.flatMap(message => message.inReplyTo ? [message.inReplyTo] : []))];
  const replyParents = replyParentIds.length ? await prisma.email.findMany({
    where: { ...scope, id: { in: replyParentIds }, folder: 'sent', OR: [{ sendingKind: 'personal' }, { sendingKind: null }] },
    select: { id: true, subCompanyId: true, fromUserId: true, threadId: true },
  }) : [];
  const verifiedReplies = inbox.filter(message => {
    const parent = replyParents.find(candidate => candidate.id === message.inReplyTo);
    return parent && parent.subCompanyId === message.subCompanyId && parent.fromUserId === message.toUserId
      && (!message.threadId || message.threadId === (parent.threadId ?? parent.id));
  });

  const configs = await prisma.hubstaffConfig.findMany({ where: { OR: [{ subCompanyId: { in: agencyIds } }, { projectMappings: { some: { subCompanyId: { in: agencyIds } } } }] }, include: { projectMappings: true } });
  // Disconnect retains imported rows for history, but they must not look like
  // current Hubstaff coverage in a new daily report.
  const connectedConfigs = configs.filter(c => c.syncEnabled && !!c.refreshToken?.trim());
  const configIds = connectedConfigs.map(c => c.id);
  const configCoversAgency = (config: typeof configs[number], agencyId: string) => config.subCompanyId === agencyId
    || config.projectMappings.some(mapping => mapping.subCompanyId === agencyId && (!mapping.internal || policy.scope === 'organization'));
  const day = new Date(`${reportDate}T00:00:00Z`);
  const timeUsers = allTimeAllowed ? userIds : userIds.filter(id => id === recipient.id);
  const [activities, hubTasks, links, syncRuns, hubEvents] = await Promise.all([
    configIds.length ? prisma.hubstaffTaskActivity.findMany({ where: { configId: { in: configIds }, userId: { in: timeUsers }, date: day } }) : [],
    configIds.length ? prisma.hubstaffTask.findMany({ where: { configId: { in: configIds }, isDeleted: false } }) : [],
    configs.length ? prisma.hubstaffUserLink.findMany({ where: { configId: { in: configs.map(c => c.id) }, userId: { in: timeUsers } } }) : [],
    configIds.length ? prisma.hubstaffSyncRun.findMany({ where: { configId: { in: configIds }, status: { in: ['complete', 'partial'] }, startDate: { lte: day } }, orderBy: { completedAt: 'desc' } }) : [],
    configIds.length ? prisma.hubstaffTaskEvent.findMany({ where: { configId: { in: configIds }, OR: [{ occurredAt: period }, { observedAt: period }] } }) : [],
  ]);
  const maps = connectedConfigs.flatMap(c => c.projectMappings);
  const projectAllowed = (configId: string, projectId: number | null): boolean => {
    const mapping = maps.find(m => m.configId === configId && m.hubstaffProjectId === projectId);
    if (mapping) return agencyIds.includes(mapping.subCompanyId) && (!mapping.internal || policy.scope === 'organization');
    // Unmapped projects stay in the connection's agency, with an explicit warning.
    return agencyIds.includes(configs.find(c => c.id === configId)?.subCompanyId ?? '');
  };
  const scopedTasks = hubTasks.filter(t => projectAllowed(t.configId, t.hubstaffProjectId));
  const logicalTaskKey = (task: typeof hubTasks[number]) => `${task.configId}:${task.globalTodoId ? `todo:${task.globalTodoId}` : task.taskKey}`;
  // One provider task may have several timer IDs/assignees. Count the work once.
  const taskGroups = new Map<string, typeof hubTasks>();
  for (const task of scopedTasks) {
    const key = logicalTaskKey(task);
    taskGroups.set(key, [...(taskGroups.get(key) ?? []), task]);
  }
  const relevantTasks = [...taskGroups.values()].map(group => [...group].sort((a, b) => (b.providerUpdatedAt?.getTime() ?? 0) - (a.providerUpdatedAt?.getTime() ?? 0))[0]!);
  const allTaskTime = relevantTasks.length ? await prisma.hubstaffTaskActivity.findMany({
    where: { configId: { in: configIds }, taskKey: { in: scopedTasks.map(t => t.taskKey) }, date: { lte: day } },
  }) : [];
  // A manager's task totals may only include contributors they can see.
  const visibleContributors = new Set(timeUsers);
  const people: ReportPerson[] = [];
  const uniqueTaskCompletions = new Set<string>();
  for (const user of users) {
    const profile = primaryProfiles.get(user.id)!;
    const ownActivities = activities.filter(a => a.userId === user.id && projectAllowed(a.configId, a.hubstaffProjectId));
    const activityProfiles = new Set(ownActivities.map(a => maps.find(m => m.configId === a.configId && m.hubstaffProjectId === a.hubstaffProjectId)?.workProfile).filter(Boolean));
    if (!policy.profiles.includes(profile) && ![...activityProfiles].some(p => policy.profiles.includes(p!))) continue;
    const crmProfileIncluded = profile !== 'software' && policy.profiles.includes(profile);
    const record: ReportPerson = {
      userId: user.id, name: `${user.firstName} ${user.lastName}`.trim(), role: user.role, profile,
      agencyId: user.subCompanyId, agencyName: user.subCompanyId ? (agencies.find(a => a.id === user.subCompanyId)?.name ?? 'Agency') : 'Company',
      metrics: [], time: { status: 'unavailable', trackedSeconds: null, manualSeconds: null, idleSeconds: null, inputActivityPercent: null, unallocatedSeconds: null, categories: [] },
      tasks: [], evidence: [], warnings: [],
    };
    const metric = (key: string, label: string, value: number | null, unit?: string) => record.metrics.push({ key, label, value, ...(unit ? { unit } : {}) });
    metric('referenceShift', 'Configured reference shift', policy.shiftHours, 'hours');
    if (crmProfileIncluded && communications) {
      const sent = emails.filter(e => e.activityActorId === user.id);
      metric('personalEmails', 'Personal messages accepted for sending', sent.length);
      metric('recipientsReached', 'Distinct addresses accepted', new Set(acceptedRecipients.filter(r => r.emailRecord.activityActorId === user.id).map(r => r.emailAddress.toLowerCase())).size);
      const received = inbox.filter(e => (e.forwardedToUserId ?? e.toUserId) === user.id);
      const receivedIds = new Set(received.map(messageIdentity));
      const readIds = new Set(received.filter(e => e.isRead).map(messageIdentity));
      metric('emailsReceived', 'Emails received in CRM inbox', receivedIds.size);
      metric('emailsUnread', 'Received emails currently unread', [...receivedIds].filter(id => !readIds.has(id)).length);
      const replies = [...new Map(verifiedReplies.filter(e => (e.forwardedToUserId ?? e.toUserId) === user.id).map(e => [messageIdentity(e), e])).values()];
      metric('replies', 'Replies received in CRM conversations', replies.length);
      if (replies.some(e => !e.inboundMessageId?.trim())) record.warnings.push('Some replies have no provider message ID; they are counted by stored record and webhook retries cannot be fully deduplicated.');
      if (replies.length) record.warnings.push('Reply totals include automatic replies because incoming messages do not yet record that classification.');
      const campaign = campaigns.filter(c => c.campaign.createdById === user.id);
      metric('campaignSent', 'Campaign recipients sent', campaign.filter(c => inPeriod(c.sentAt, bounds.start, end)).length);
      metric('campaignDelivered', 'Campaign deliveries confirmed today', campaign.filter(c => inPeriod(c.deliveredAt, bounds.start, end)).length);
      metric('campaignBounced', 'Campaign bounces recorded today', campaign.filter(c => inPeriod(c.bouncedAt, bounds.start, end)).length);
      const ownCalls = calls.filter(c => c.ownerId === user.id);
      metric('calls', 'Calls recorded', ownCalls.length);
      metric('callsAnswered', 'Calls answered', ownCalls.filter(c => c.outcome === 'answered').length);
      metric('callsNoAnswer', 'Calls with no answer', ownCalls.filter(c => c.outcome === 'no_answer').length);
      metric('callsBusy', 'Calls reaching a busy line', ownCalls.filter(c => c.outcome === 'busy').length);
      metric('callsVoicemail', 'Calls reaching voicemail', ownCalls.filter(c => c.outcome === 'voicemail').length);
      metric('callsPending', 'Calls awaiting an outcome', ownCalls.filter(c => c.outcome === 'initiated').length);
      // Group-routed missed calls have no reliable individual owner. Attribute
      // attended inbound calls only to the employee recorded as answering.
      metric('inboundCallsAnswered', 'Inbound calls attended', inboundCalls.filter(c => c.answeredByUserId === user.id).length);
      if (unknownEmails.some(e => e.activityActorId === user.id || e.fromUserId === user.id)) record.warnings.push('Some email records have no verified sending outcome and are excluded from successful messages.');
      record.evidence.push(...sent.map(e => ({ type: 'email', title: e.subject || '(No subject)', at: e.sentAt!.toISOString(), url: '/emails' })));
      record.evidence.push(...replies.map(e => ({ type: 'email_reply', title: e.subject || '(No subject)', at: e.timestamp.toISOString(), url: '/emails' })));
    }
    const ownEvents = events.filter(e => e.userId === user.id);
    if (crmProfileIncluded && tasksAllowed) {
      const completion = ownEvents.filter(e => e.kind === 'task');
      metric('crmTasksCompleted', 'CRM tasks completed', uniqueCompletedCount(completion));
      metric('crmTasksOpen', 'CRM tasks currently open', tasks.filter(t => t.ownerId === user.id && t.status !== 'done').length);
      metric('crmTasksReopened', 'CRM tasks reopened', new Set(completion.filter(e => e.type === 'reopened').map(e => e.entityId)).size);
      metric('crmTasksOverdue', 'CRM tasks currently overdue', tasks.filter(t => t.ownerId === user.id && t.status !== 'done' && t.dueDate < end).length);
    }
    if (crmProfileIncluded && followUpsAllowed) {
      const completion = ownEvents.filter(e => e.kind === 'follow_up');
      const due = followUps.filter(f => f.ownerId === user.id && inPeriod(f.dueDate, bounds.start, end));
      metric('followUpsCompleted', 'Follow-ups completed', uniqueCompletedCount(completion));
      metric('followUpsDue', 'Follow-ups due in period', due.length);
      metric('followUpsOnTime', 'Follow-ups completed by recorded deadline', new Set(completion.filter(e => e.type === 'completed' && e.dueAt && e.occurredAt <= e.dueAt).map(e => e.entityId)).size);
      metric('followUpsOverdue', 'Follow-ups currently overdue', followUps.filter(f => f.ownerId === user.id && !f.completed && f.dueDate < end).length);
    }
    if (crmProfileIncluded && meetingsAllowed) {
      const own = meetings.filter(m => m.ownerId === user.id);
      metric('meetingsScheduled', 'Meetings created', own.filter(m => inPeriod(m.createdAt, bounds.start, end)).length);
      metric('meetingsCompleted', 'Meetings dated in period and marked complete', own.filter(m => inPeriod(m.startTime, bounds.start, end) && m.status === 'completed').length);
    }
    if (crmProfileIncluded && leadsAllowed) metric('leadsWon', 'Leads closed won', leads.filter(l => l.ownerId === user.id).length);
    if (crmProfileIncluded && profile === 'recruitment' && recruitmentAllowed) metric('placementsApproved', 'Placement approvals', placements.filter(p => p.submittedById === user.id).length);
    if (crmProfileIncluded) {
      const target = targets.find(t => t.subCompanyId === user.subCompanyId && t.role === user.role);
      if (target) {
        if (communications) { metric('callsTarget', 'Daily call target', target.callsTarget); metric('emailsTarget', 'Daily personal email target', target.emailsTarget); }
        if (meetingsAllowed) metric('meetingsTarget', 'Daily meetings scheduled target', target.meetingScheduleCountTarget);
      }
    }
    const allowedActivityTypes = new Set([
      ...(communications ? ['call_made', 'email_sent'] : []), ...(tasksAllowed ? ['task_created', 'task_completed'] : []),
      ...(followUpsAllowed ? ['follow_up_created', 'follow_up_completed'] : []), ...(meetingsAllowed ? ['meeting_scheduled'] : []),
      ...(leadsAllowed ? ['lead_created', 'pipeline_moved'] : []),
    ]);
    const activityByIdentity = new Map(crmActivity.filter(a => a.userId === user.id && allowedActivityTypes.has(a.type)).map(a => {
      const metadata = a.metadata as Record<string, unknown> | null;
      return [a.type === 'email_sent' && metadata?.emailId ? `email:${metadata.emailId}` : a.id, a];
    }));
    const usage = [...activityByIdentity.values()].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    if (crmProfileIncluded) record.crmUsage = { recordedEvents: usage.length, firstActivityAt: usage[0]?.timestamp.toISOString() ?? null, lastActivityAt: usage.at(-1)?.timestamp.toISOString() ?? null };
    if (crmProfileIncluded) {
      for (const event of ownEvents.filter(e => e.kind === 'task' ? tasksAllowed : followUpsAllowed)) {
        record.evidence.push({ type: event.kind, title: `${event.kind === 'task' ? 'Task' : 'Follow-up'} ${event.type}`, at: event.occurredAt.toISOString(), url: event.kind === 'task' ? '/tasks' : '/follow-ups' });
      }
    }
    const userLinks = links.filter(l => l.userId === user.id && configIds.includes(l.configId));
    const userHasConnection = connectedConfigs.some(config => userLinks.some(link => link.configId === config.id)
      || !user.subCompanyId || configCoversAgency(config, user.subCompanyId));
    if (!allTimeAllowed && user.id !== recipient.id) record.time.status = 'restricted';
    else if (userLinks.length) {
      const relevantConfigs = connectedConfigs.filter(c => userLinks.some(l => l.configId === c.id));
      const wrongZone = relevantConfigs.some(c => c.orgTimezone !== policy.timezone);
      const coverage = relevantConfigs.every(c => syncRuns.some(r => r.configId === c.id && r.startDate <= day && r.endDate >= day));
      const stale = relevantConfigs.some(c => !c.lastSyncAt || now.getTime() - c.lastSyncAt.getTime() > 90 * 60000 || !!c.lastSyncError);
      record.time.status = wrongZone || !coverage ? 'partial' : stale ? 'stale' : 'complete';
      if (relevantConfigs.some(c => c.lastSyncError || c.taskSyncError)) record.warnings.push('Hubstaff is connected, but its latest synchronization failed. Some task or time details may be unavailable.');
      else if (relevantConfigs.some(c => !c.lastSyncAt)) record.warnings.push('Hubstaff is connected and waiting for its first synchronization. Task and time details will appear after a successful import.');
      if (wrongZone) record.warnings.push('Hubstaff organization timezone is missing or differs from this report. Time totals are unavailable until the reporting periods match.');
      if (!coverage) record.warnings.push('Hubstaff has not completely synchronized this reporting date.');
      if (stale) record.warnings.push('Hubstaff data is stale; the latest import did not establish fresh coverage.');
      if (!wrongZone && coverage) {
        const visibleActivity = ownActivities.filter(a => {
          const mapped = maps.find(m => m.configId === a.configId && m.hubstaffProjectId === a.hubstaffProjectId)?.workProfile;
          return policy.profiles.includes(mapped || profile);
        });
        record.time.trackedSeconds = total(visibleActivity, a => a.trackedSeconds);
        record.time.manualSeconds = total(visibleActivity, a => a.manualSeconds);
        record.time.idleSeconds = total(visibleActivity, a => a.idleSeconds);
        record.time.inputActivityPercent = inputActivityPercent(total(visibleActivity, a => a.overallSeconds), total(visibleActivity, a => a.inputTrackedSeconds));
        record.time.unallocatedSeconds = total(visibleActivity.filter(a => !a.taskKey), a => a.trackedSeconds);
        const categoryTotals = new Map<string, { project: string; profile: string; trackedSeconds: number }>();
        for (const activity of visibleActivity) {
          const mapping = maps.find(m => m.configId === activity.configId && m.hubstaffProjectId === activity.hubstaffProjectId);
          const key = `${activity.configId}:${activity.hubstaffProjectId}`;
          const category = categoryTotals.get(key) ?? { project: mapping?.projectName ?? 'Unmapped project', profile: mapping?.workProfile || profile, trackedSeconds: 0 };
          category.trackedSeconds += activity.trackedSeconds;
          categoryTotals.set(key, category);
        }
        record.time.categories = [...categoryTotals.values()];
        if (visibleActivity.some(a => a.taskKey && !scopedTasks.some(t => t.configId === a.configId && t.taskKey === a.taskKey))) record.warnings.push('Some time references a task whose details could not be matched in the import. It remains included in recorded hours.');
        if (visibleActivity.some(a => !maps.some(m => m.configId === a.configId && m.hubstaffProjectId === a.hubstaffProjectId))) record.warnings.push('Some time belongs to projects without a department mapping.');
      }
      const completedKeys = new Set<string>();
      const reopenedKeys = new Set<string>();
      const observedCompletedKeys = new Set<string>();
      const workedKeys = new Set<string>();
      const openKeys = new Set<string>();
      const overdueKeys = new Set<string>();
      let unknownAssignedStatus = false;
      const taskConfigAvailable = (config: typeof configs[number]) => config.taskSyncStatus === 'available' && !config.taskSyncError
        && !!config.lastTaskSyncAt && now.getTime() - config.lastTaskSyncAt.getTime() <= 90 * 60000
        && !scopedTasks.some(task => task.configId === config.id && (task.rawJson as Record<string, unknown> | null)?.enrichmentStatus === 'stale');
      const taskDataAvailable = relevantConfigs.every(taskConfigAvailable);
      for (const groupedTask of relevantTasks) {
        const aliases = taskGroups.get(logicalTaskKey(groupedTask))!.filter(alias => {
          const mapped = maps.find(m => m.configId === alias.configId && m.hubstaffProjectId === alias.hubstaffProjectId);
          return policy.profiles.includes(mapped?.workProfile || profile);
        });
        if (!aliases.length) continue;
        const task = [...aliases].sort((a, b) => (b.providerUpdatedAt?.getTime() ?? 0) - (a.providerUpdatedAt?.getTime() ?? 0))[0]!;
        const taskKeys = new Set(aliases.map(alias => alias.taskKey));
        const allAliasesVisible = hubTasks.filter(alias => logicalTaskKey(alias) === logicalTaskKey(task)).every(alias => taskKeys.has(alias.taskKey));
        const userProviderIds = userLinks.filter(l => l.configId === task.configId).map(l => l.hubstaffUserId);
        const worked = ownActivities.filter(a => a.configId === task.configId && !!a.taskKey && taskKeys.has(a.taskKey));
        const assigned = aliases.some(alias => alias.assigneeIds.some(id => userProviderIds.includes(id)));
        const ownTaskEvents = hubEvents.filter(e => e.configId === task.configId && taskKeys.has(e.taskKey) && (worked.length || e.assigneeIds.some(id => userProviderIds.includes(id))));
        if (!worked.length && !assigned && !ownTaskEvents.length) continue;
        const mapping = maps.find(m => m.configId === task.configId && m.hubstaffProjectId === task.hubstaffProjectId);
        if (!policy.profiles.includes(mapping?.workProfile || profile)) continue;
        const completionEvent = ownTaskEvents.find(e => e.type === 'completed' && inPeriod(e.occurredAt, bounds.start, end));
        const completed = inPeriod(task.completedAt, bounds.start, end) || !!completionEvent;
        const reopened = ownTaskEvents.some(e => e.type === 'reopened' && inPeriod(e.observedAt, bounds.start, end));
        const observedCompleted = ownTaskEvents.some(e => e.type === 'completed' && !e.occurredAt && inPeriod(e.observedAt, bounds.start, end));
        const open = hubstaffTaskIsOpen(task.status);
        if (assigned && open === null) unknownAssignedStatus = true;
        if (worked.some(row => row.trackedSeconds > 0)) workedKeys.add(logicalTaskKey(task));
        if (assigned && open) {
          openKeys.add(logicalTaskKey(task));
          if (task.dueAt && task.dueAt < now) overdueKeys.add(logicalTaskKey(task));
        }
        if (!worked.length && !completed && !reopened && !observedCompleted && !(assigned && open)) continue;
        const history = allTaskTime.filter(a => a.configId === task.configId && !!a.taskKey && taskKeys.has(a.taskKey));
        const raw = task.rawJson as Record<string, unknown> | null;
        const creationDates = aliases.map(alias => {
          const source = alias.rawJson as Record<string, unknown> | null;
          const value = (source?.time as Record<string, unknown> | undefined)?.created_at ?? source?.created_at;
          return typeof value === 'string' ? new Date(value) : null;
        });
        const created = creationDates.every(date => date && Number.isFinite(date.getTime())) ? new Date(Math.min(...creationDates.map(date => date!.getTime()))) : null;
        const config = configs.find(c => c.id === task.configId)!;
        const currentTaskKnown = taskConfigAvailable(config) && raw?.enrichmentStatus !== 'stale';
        const historyStart = created && Number.isFinite(created.getTime()) ? new Date(`${localDateKey(created, config.orgTimezone || policy.timezone)}T00:00:00Z`) : null;
        const fullHistory = !!historyStart && coversDateRange(syncRuns.filter(r => r.configId === task.configId), historyStart, day);
        const allContributorsVisible = history.every(a => !!a.userId && visibleContributors.has(a.userId));
        const summary: ReportTask = {
          id: task.id, title: task.name, projectName: mapping?.projectName || 'Hubstaff project', status: currentTaskKnown ? task.status || 'unknown' : 'unknown',
          completedAt: completionEvent?.occurredAt?.toISOString() ?? task.completedAt?.toISOString() ?? null, dueAt: currentTaskKnown ? task.dueAt?.toISOString() ?? null : null,
          estimateSeconds: currentTaskKnown ? task.estimateSeconds : null, todaySeconds: wrongZone || !coverage ? null : total(worked, a => a.trackedSeconds),
          totalSeconds: !wrongZone && fullHistory && allAliasesVisible && allContributorsVisible ? total(history, a => a.trackedSeconds) : null,
          contributionSeconds: !wrongZone && fullHistory && allAliasesVisible ? total(history.filter(a => a.userId === user.id), a => a.trackedSeconds) : null,
          sourceUrl: task.sourceUrl,
        };
        record.tasks.push(summary);
        if (completed && taskConfigAvailable(config)) { completedKeys.add(logicalTaskKey(task)); uniqueTaskCompletions.add(logicalTaskKey(task)); }
        if (reopened) reopenedKeys.add(logicalTaskKey(task));
        if (observedCompleted) observedCompletedKeys.add(logicalTaskKey(task));
        for (const event of ownTaskEvents) record.evidence.push({ type: 'hubstaff_task', title: `${task.name}: ${event.type}${event.occurredAt ? '' : ' (observed during sync)'}`, at: (event.occurredAt ?? event.observedAt).toISOString(), url: task.sourceUrl });
        if (!fullHistory) record.warnings.push('Total task effort is unavailable where earlier task history has not been imported.');
        if (!allContributorsVisible) record.warnings.push('Shared task totals are withheld because some contributors are outside your report access.');
        if (!allAliasesVisible) record.warnings.push('Total task effort is withheld because part of this shared task belongs to another agency or work category outside this report.');
      }
      metric('hubstaffTasksCompleted', 'Hubstaff completions with recorded completion time', taskDataAvailable ? completedKeys.size : null);
      metric('hubstaffTasksReopened', 'Hubstaff reopens observed in period', taskDataAvailable ? reopenedKeys.size : null);
      metric('hubstaffCompletionsObserved', 'Completions observed without exact completion time', taskDataAvailable ? observedCompletedKeys.size : null);
      metric('hubstaffTasksWorked', 'Hubstaff tasks with recorded time in period', taskDataAvailable && !wrongZone && coverage ? workedKeys.size : null);
      metric('hubstaffTasksOpen', 'Assigned Hubstaff tasks currently active', taskDataAvailable && !unknownAssignedStatus ? openKeys.size : null);
      metric('hubstaffTasksOverdue', 'Assigned active Hubstaff tasks currently overdue', taskDataAvailable && !unknownAssignedStatus ? overdueKeys.size : null);
      if (observedCompletedKeys.size) record.warnings.push('Observed task transitions show when CRM discovered a change, not the exact time it happened in Hubstaff.');
      if (!taskDataAvailable) record.warnings.push('Fresh task data is unavailable from one or more Hubstaff connections; task counts and current status are withheld.');
      if (unknownAssignedStatus) record.warnings.push('Some assigned Hubstaff tasks have an unknown status; current active and overdue task counts are unavailable.');
    } else if (allTimeAllowed || user.id === recipient.id) {
      record.warnings.push(userHasConnection
        ? 'Hubstaff is connected, but no Hubstaff member is linked to this employee.'
        : 'Hubstaff is not connected for this employee. Task and time details will appear after connection, member linking and synchronization.');
    }
    if (!record.metrics.some(m => m.key === 'hubstaffTasksCompleted')) metric('hubstaffTasksCompleted', 'Hubstaff completions with recorded completion time', null);
    if (record.time.unallocatedSeconds) record.warnings.push('Some recorded time has no task selected.');
    record.warnings = [...new Set(record.warnings)];
    record.evidence.sort((a, b) => b.at.localeCompare(a.at));
    people.push(record);
  }
  const metricTotal = (key: string) => total(people, p => p.metrics.find(m => m.key === key)?.value ?? 0);
  const warnings = ['Hubstaff input activity and CRM usage are context, not a measure of work quality. Time sources are never added together.'];
  const visibleConfigs = configs.filter(c => allTimeAllowed || links.some(l => l.configId === c.id && l.userId === recipient.id));
  const sources: DailyReportPayload['sources'] = visibleConfigs.map(config => ({
    label: config.orgName || 'Hubstaff',
    status: !configIds.includes(config.id) ? 'not_connected' : config.lastSyncError || config.taskSyncError ? 'sync_failed'
      : !config.lastSyncAt ? 'sync_pending' : now.getTime() - config.lastSyncAt.getTime() > 90 * 60000 ? 'stale'
        : config.orgTimezone !== policy.timezone || config.taskSyncStatus !== 'available' || !config.lastTaskSyncAt
          || now.getTime() - config.lastTaskSyncAt.getTime() > 90 * 60000
          || !syncRuns.some(run => run.configId === config.id && run.startDate <= day && run.endDate >= day) ? 'partial' : 'synced',
    lastSyncedAt: config.lastSyncAt?.toISOString() ?? null,
  }));
  if (allTimeAllowed && !connectedConfigs.length) {
    if (!sources.length) sources.push({ label: 'Hubstaff', status: 'not_connected', lastSyncedAt: null });
    warnings.push('Hubstaff is not connected. This daily report still includes available CRM activity for marketing and other nonsoftware users. Hubstaff task and time details will be included after connection, member linking and synchronization.');
  } else if (allTimeAllowed) {
    const uncoveredAgencies = agencies.filter(agency => !connectedConfigs.some(config => configCoversAgency(config, agency.id)));
    if (uncoveredAgencies.length) {
      sources.push(...uncoveredAgencies.filter(agency => !visibleConfigs.some(config => configCoversAgency(config, agency.id))).map(agency => ({ label: `Hubstaff — ${agency.name}`, status: 'not_connected', lastSyncedAt: null })));
      warnings.push(`Hubstaff is not connected for ${uncoveredAgencies.map(agency => agency.name).join(', ')}. Available CRM activity is still included; Hubstaff task and time details will appear after connection, member linking and synchronization.`);
    }
  }
  if (policy.period === 'today' || end < bounds.end) warnings.push(`This report is a snapshot as of ${end.toISOString()}; later activity is not included.`);
  if (reportDate !== localDateKey(now, policy.timezone)) warnings.push('Overdue counts and task status reflect the state when this snapshot was generated; completion events retain their original dates.');
  if (people.some(p => p.profile !== 'software')) warnings.push('Only recorded completion transitions are counted. Historical records without reliable completion evidence are excluded.');
  if (people.some(p => p.time.trackedSeconds === null)) warnings.push('Recorded-time totals include only available records; check individual coverage before interpreting company totals.');
  return {
    version: 1, title: policy.scope === 'organization' ? 'Daily Company Report' : `Daily Report — ${agencies[0]?.name ?? 'Agency'}`,
    reportDate, timezone: policy.timezone, periodStart: bounds.start.toISOString(), periodEnd: end.toISOString(), generatedAt: now.toISOString(),
    recipient: { id: recipient.id, name: policy.recipientEmail || `${recipient.firstName} ${recipient.lastName}`.trim(), email: policy.recipientEmail || recipient.email },
    authorizedById: policy.authorizedById ?? recipient.id,
    scope: policy.scope as 'agency' | 'organization', agencyIds, userIds: people.map(p => p.userId), requiredPermissions: [...new Set(sourcePermissions)], profiles: policy.profiles,
    people, summary: { people: new Set(people.map(p => p.userId)).size, trackedSeconds: people.some(p => p.time.trackedSeconds !== null) ? total(people, p => p.time.trackedSeconds ?? 0) : null,
      completedTasks: people.some(p => p.metrics.some(m => m.key === 'hubstaffTasksCompleted' && m.value === null)) ? null : uniqueTaskCompletions.size + metricTotal('crmTasksCompleted'), personalEmails: metricTotal('personalEmails'), followUpsCompleted: metricTotal('followUpsCompleted'), repliesReceived: metricTotal('replies') },
    sources,
    warnings,
  };
}

export async function saveReportSnapshot(policy: DailyReportPolicy, user: ReportUser, date: string, preview: boolean, directReportsOnly = false) {
  const payload = await buildDailyReport(policy, user, date, directReportsOnly);
  const snapshot = await prisma.dailyReportSnapshot.create({ data: { policyId: policy.id, recipientId: user.id, reportDate: date, preview, payload: payload as unknown as Prisma.InputJsonValue } });
  return { id: snapshot.id, report: payload };
}
