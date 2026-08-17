/**
 * Create in-app notifications. Called from lead, lead-request, and (optionally) task/follow-up flows.
 */
import prisma from '../config/database';
import { notifyNotificationCreated, notifyNotificationCreatedForUsers } from './notificationEvents';

export type NotificationType =
  | 'lead_assigned'
  | 'lead_requested'
  | 'lead_request_approved'
  | 'lead_request_rejected'
  | 'client_created'
  | 'client_pending_submission'
  | 'client_pending_edit'
  | 'task_assigned'
  | 'task_due_today'
  | 'task_due_1h'
  | 'task_overdue'
  | 'task_comment'
  | 'follow_up_created'
  | 'follow_up_due_today'
  | 'follow_up_due_1h'
  | 'follow_up_overdue'
  | 'industry_requested'
  | 'industry_request_approved'
  | 'industry_request_rejected'
  | 'tag_requested'
  | 'tag_request_approved'
  | 'tag_request_rejected'
  | 'job_title_requested'
  | 'job_title_request_approved'
  | 'job_title_request_rejected'
  | 'bug_report_submitted'
  | 'bug_report_resolved'
  | 'task_completed'
  | 'proposal_submitted'
  | 'proposal_approved'
  | 'proposal_rejected'
  | 'meeting_scheduled'
  | 'meeting_reminder_1h'
  | 'task_due_2h_manager'
  | 'follow_up_due_2h_manager'
  | 'meeting_reminder_2h_manager'
  | 'proposal_signed'
  | 'proposal_declined'
  | 'employee_onboarding_signed'
  | 'employee_onboarding_declined'
  | 'client_training_signed'
  | 'client_training_declined'
  | 'lead_reassignment_requested'
  | 'lead_reassignment_approved'
  | 'lead_reassignment_rejected'
  | 'lead_reassignment_cancelled'
  | 'client_updated'
  | 'employee_data_received'
  | 'agency_linked'
  | 'agency_unlinked'
  | 'list_assigned'
  | 'list_assignee_left'
  | 'job_closed'
  | 'job_filled'
  | 'job_reopened'
  | 'job_placement_added'
  | 'job_placement_ended'
  | 'leave_approved'
  | 'leave_rejected';

export interface CreateNotificationInput {
  userId: string;
  subCompanyId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  relatedId?: string;
}

export async function createNotification(input: CreateNotificationInput): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: input.userId,
      subCompanyId: input.subCompanyId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
      relatedId: input.relatedId ?? null,
    },
  });
  notifyNotificationCreated(input.userId);
}

/** Notify multiple users (e.g. all managers). */
export async function createNotificationForUsers(
  userIds: string[],
  subCompanyId: string,
  type: NotificationType,
  title: string,
  body: string,
  link?: string,
  relatedId?: string
): Promise<void> {
  if (userIds.length === 0) return;
  await prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      subCompanyId,
      type,
      title,
      body,
      link: link ?? null,
      relatedId: relatedId ?? null,
    })),
  });
  notifyNotificationCreatedForUsers(userIds);
}
