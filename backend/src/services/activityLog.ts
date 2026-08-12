import { Prisma } from '@prisma/client';
import prisma from '../config/database';

export type ActivityLogType =
  | 'lead_request'
  | 'lead_request_approved'
  | 'lead_request_rejected'
  | 'comment_added'
  | 'call_made'
  | 'email_sent'
  | 'break_detected'
  | 'idle_detected'
  | 'pipeline_moved'
  | 'task_created'
  | 'task_status_changed'
  | 'task_completed'
  | 'meeting_scheduled'
  | 'follow_up_created'
  | 'follow_up_completed'
  | 'follow_up_reopened'
  | 'follow_up_rescheduled'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_rejected'
  | 'attachment_uploaded'
  | 'contact_added'
  | 'client_created'
  | 'lead_created'
  | 'lead_assigned'
  | 'daily_report_sent'
  | 'ownership_changed'
  | 'ownership_auto_skipped'
  | string;

export interface ActivityLogInput {
  userId: string;
  userName: string;
  subCompanyId: string;
  type: ActivityLogType;
  description: string;
  metadata?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  timestamp?: Date;
}

/**
 * Create an activity log entry.
 * Best-effort: failures are logged to the server console but do not crash the request.
 */
export async function createActivityLog(input: ActivityLogInput): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        userId: input.userId,
        userName: input.userName,
        subCompanyId: input.subCompanyId,
        type: input.type,
        description: input.description,
        metadata: input.metadata ?? undefined,
        timestamp: input.timestamp ?? new Date(),
      },
    });
  } catch (err) {
    // Do not block main flow on logging failures
    console.error('Failed to create activity log', err);
  }
}
