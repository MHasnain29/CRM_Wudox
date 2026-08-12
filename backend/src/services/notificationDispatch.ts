import { createNotification, createNotificationForUsers, type NotificationType } from './notifications';
import { emitToUsers } from '../socket';
import {
  filterEligibleRecipients,
  getAgencyRule,
  resolveNotificationContent,
  type ResolvedNotification,
} from './notificationRuleService';

export type DispatchNotificationInput = {
  eventKey: string;
  userIds: string[];
  subCompanyId: string;
  context: Record<string, string>;
  link?: string;
  relatedId?: string;
};

/** Render notification copy without persisting (e.g. socket payloads). */
export async function renderDispatchNotification(
  input: Omit<DispatchNotificationInput, 'userIds'>,
): Promise<ResolvedNotification | null> {
  const agencyRule = await getAgencyRule(input.subCompanyId, input.eventKey);
  return resolveNotificationContent(input.eventKey, input.context, agencyRule);
}

/** Central gate: rules, templates, then persist in-app notifications. */
export async function dispatchNotification(input: DispatchNotificationInput): Promise<void> {
  const userIds = [...new Set(input.userIds.filter(Boolean))];
  if (userIds.length === 0) return;

  const eligible = await filterEligibleRecipients(input.eventKey, input.subCompanyId, userIds);
  if (eligible.length === 0) return;

  const agencyRule = await getAgencyRule(input.subCompanyId, input.eventKey);
  const resolved = resolveNotificationContent(input.eventKey, input.context, agencyRule);
  if (!resolved) return;

  const type = resolved.storeAsType as NotificationType;
  const { title, body } = resolved;
  const { link, relatedId, subCompanyId } = input;

  if (eligible.length === 1) {
    await createNotification({
      userId: eligible[0],
      subCompanyId,
      type,
      title,
      body,
      link,
      relatedId,
    });
    return;
  }

  await createNotificationForUsers(eligible, subCompanyId, type, title, body, link, relatedId);
}

/** Convenience wrapper for single-user dispatch. */
export async function dispatchNotificationToUser(
  input: Omit<DispatchNotificationInput, 'userIds'> & { userId: string },
): Promise<void> {
  await dispatchNotification({
    ...input,
    userIds: [input.userId],
  });
}

/** Persist task_assigned + real-time toast payload from admin notification templates. */
export function notifyTaskAssigned(params: {
  assigneeId: string;
  actorUserId: string;
  subCompanyId: string;
  taskId: string;
  taskTitle: string;
  taskPriority: string;
  dueDate: Date | string | null;
  assignerName: string;
}): void {
  if (params.assigneeId === params.actorUserId) return;

  const link = `/tasks?openTask=${params.taskId}`;
  const context = { taskTitle: params.taskTitle, actorName: params.assignerName };

  void dispatchNotificationToUser({
    userId: params.assigneeId,
    subCompanyId: params.subCompanyId,
    eventKey: 'task_assigned',
    context,
    link,
    relatedId: params.taskId,
  }).catch(() => {});

  void (async () => {
    const rendered = await renderDispatchNotification({
      eventKey: 'task_assigned',
      subCompanyId: params.subCompanyId,
      context,
      link,
      relatedId: params.taskId,
    });
    if (!rendered) return;
    emitToUsers([params.assigneeId], 'task:assigned', {
      taskId: params.taskId,
      title: rendered.title,
      body: rendered.body ?? undefined,
      priority: params.taskPriority,
      dueDate: params.dueDate,
      assignedByName: params.assignerName,
    });
  })();
}

/** Notify a user that a mailing list was assigned to them. */
export function notifyListAssigned(params: {
  assigneeId: string;
  actorUserId: string;
  subCompanyId: string;
  listId: string;
  listName: string;
  assignerName: string;
}): void {
  if (params.assigneeId === params.actorUserId) return;

  const link = '/lists?tab=assigned';
  const context = { listName: params.listName, actorName: params.assignerName };

  void dispatchNotificationToUser({
    userId: params.assigneeId,
    subCompanyId: params.subCompanyId,
    eventKey: 'list_assigned',
    context,
    link,
    relatedId: params.listId,
  }).catch(() => {});

  void (async () => {
    const rendered = await renderDispatchNotification({
      eventKey: 'list_assigned',
      subCompanyId: params.subCompanyId,
      context,
      link,
      relatedId: params.listId,
    });
    if (!rendered) return;
    emitToUsers([params.assigneeId], 'list:assigned', {
      listId: params.listId,
      title: rendered.title,
      body: rendered.body ?? undefined,
    });
  })();
}

/** Notify a list's creator that an assignee left / was deactivated. */
export function notifyListAssigneeLeft(params: {
  creatorId: string;
  subCompanyId: string;
  listId: string;
  listName: string;
  userName: string;
}): void {
  const link = '/lists';
  const context = { listName: params.listName, userName: params.userName };

  void dispatchNotificationToUser({
    userId: params.creatorId,
    subCompanyId: params.subCompanyId,
    eventKey: 'list_assignee_left',
    context,
    link,
    relatedId: params.listId,
  }).catch(() => {});

  void (async () => {
    const rendered = await renderDispatchNotification({
      eventKey: 'list_assignee_left',
      subCompanyId: params.subCompanyId,
      context,
      link,
      relatedId: params.listId,
    });
    if (!rendered) return;
    emitToUsers([params.creatorId], 'list:changed', {
      listId: params.listId,
      title: rendered.title,
      body: rendered.body ?? undefined,
    });
  })();
}
