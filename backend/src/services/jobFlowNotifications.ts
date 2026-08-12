/**
 * In-app notifications for the recruitment job flow:
 * assignment requests, placements, and job status changes.
 *
 * Every function swallows its own errors (fire-and-forget) so a notification
 * failure never breaks the underlying operation.
 */
import prisma from '../config/database';
import { dispatchNotificationToUser } from './notificationDispatch';
import { getApprovalEventKey } from './notificationRegistry';
import { notifyChainTargetUsers } from './approvalActions';
import { loadEntityNotifyCtx } from './approvalNotifications';

const END_REASON_LABELS: Record<string, string> = {
  work_complete: 'Work complete',
  not_performing: 'Not performing',
  other: 'Other',
};

async function userName(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true },
  });
  return `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim() || u?.email || 'Someone';
}

async function employeeName(employeeId: string): Promise<string> {
  const e = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { firstName: true, lastName: true },
  });
  return `${e?.firstName ?? ''} ${e?.lastName ?? ''}`.trim() || 'An employee';
}

/** Job's agency for notification scoping (legacy jobs fall back to the creator's agency). */
async function resolveJobAgencyId(job: {
  subCompanyId: string | null;
  createdById: string;
}): Promise<string | null> {
  if (job.subCompanyId) return job.subCompanyId;
  const creator = await prisma.user.findUnique({
    where: { id: job.createdById },
    select: { subCompanyId: true },
  });
  return creator?.subCompanyId ?? null;
}

export type JobNotifyRef = {
  id: string;
  title: string;
  company: string;
  createdById: string;
  subCompanyId: string | null;
};

/** New pending assignment request → alert users of the chain's first approver role. */
export async function notifyAssignmentRequestSubmitted(params: {
  assignmentId: string;
  subCompanyId: string;
  targetRoleKey: string | null;
}): Promise<void> {
  try {
    if (!params.targetRoleKey) return;
    const ctx = await loadEntityNotifyCtx('employee_assignment', params.assignmentId);
    if (!ctx) return;
    await notifyChainTargetUsers({
      subCompanyId: params.subCompanyId,
      targetRoleKey: params.targetRoleKey,
      eventKey: getApprovalEventKey('employee_assignment', 'submit'),
      context: { entityLabel: ctx.label, actorName: ctx.submitterName },
      link: ctx.link,
      relatedId: params.assignmentId,
    });
  } catch (err) {
    console.error('[jobFlowNotifications] submit notify failed', err);
  }
}

/** Pending requests auto-rejected because the job closed → tell each requester. */
export async function notifyAssignmentRequestsAutoRejected(params: {
  subCompanyId: string;
  jobTitle: string;
  requests: Array<{ id: string; submittedById: string; employeeName: string }>;
}): Promise<void> {
  for (const r of params.requests) {
    try {
      await dispatchNotificationToUser({
        eventKey: getApprovalEventKey('employee_assignment', 'rejected'),
        userId: r.submittedById,
        subCompanyId: params.subCompanyId,
        context: {
          entityLabel: `${r.employeeName} → ${params.jobTitle}`,
          reason: 'Job was closed',
          reasonSuffix: ' Reason: Job was closed',
        },
        link: '/jobs',
        relatedId: r.id,
      });
    } catch (err) {
      console.error('[jobFlowNotifications] auto-reject notify failed', err);
    }
  }
}

/** Job closed / marked filled / reopened → tell the job's creator. */
export async function notifyJobStatusChanged(params: {
  job: JobNotifyRef;
  status: 'closed' | 'filled' | 'open';
  actorUserId: string;
}): Promise<void> {
  try {
    if (params.job.createdById === params.actorUserId) return;
    const subCompanyId = await resolveJobAgencyId(params.job);
    if (!subCompanyId) return;
    const eventKey =
      params.status === 'closed' ? 'job_closed' : params.status === 'filled' ? 'job_filled' : 'job_reopened';
    await dispatchNotificationToUser({
      eventKey,
      userId: params.job.createdById,
      subCompanyId,
      context: {
        jobTitle: params.job.title,
        clientName: params.job.company,
        actorName: await userName(params.actorUserId),
      },
      link: '/jobs',
      relatedId: params.job.id,
    });
  } catch (err) {
    console.error('[jobFlowNotifications] job status notify failed', err);
  }
}

/** Employee landed on the roster (direct or via approval) → tell the job's creator. */
export async function notifyPlacementAdded(params: {
  job: JobNotifyRef;
  employeeId: string;
  actorUserId: string;
  isBackup: boolean;
}): Promise<void> {
  try {
    if (params.job.createdById === params.actorUserId) return;
    const subCompanyId = await resolveJobAgencyId(params.job);
    if (!subCompanyId) return;
    await dispatchNotificationToUser({
      eventKey: 'job_placement_added',
      userId: params.job.createdById,
      subCompanyId,
      context: {
        jobTitle: params.job.title,
        employeeName: await employeeName(params.employeeId),
        actorName: await userName(params.actorUserId),
        roleSuffix: params.isBackup ? ' as backup' : '',
      },
      link: '/jobs',
      relatedId: params.job.id,
    });
  } catch (err) {
    console.error('[jobFlowNotifications] placement added notify failed', err);
  }
}

/** Placement ended → tell the request submitter and the job creator (minus the actor). */
export async function notifyPlacementEnded(params: {
  job: JobNotifyRef | null;
  employeeId: string;
  actorUserId: string;
  endReason?: string | null;
  /** submittedById of the ended EmployeeAssignment, when known. */
  requesterUserId?: string | null;
}): Promise<void> {
  try {
    const recipients = [
      ...new Set([params.requesterUserId, params.job?.createdById].filter(Boolean) as string[]),
    ].filter((id) => id !== params.actorUserId);
    if (recipients.length === 0) return;

    const subCompanyId = params.job
      ? await resolveJobAgencyId(params.job)
      : (
          await prisma.employee.findUnique({
            where: { id: params.employeeId },
            select: { addedBy: { select: { subCompanyId: true } } },
          })
        )?.addedBy.subCompanyId ?? null;
    if (!subCompanyId) return;

    const reasonLabel = params.endReason ? END_REASON_LABELS[params.endReason] ?? params.endReason : null;
    const context = {
      jobTitle: params.job?.title ?? 'their assignment',
      employeeName: await employeeName(params.employeeId),
      actorName: await userName(params.actorUserId),
      reasonSuffix: reasonLabel ? ` Reason: ${reasonLabel}` : '',
    };
    for (const userId of recipients) {
      await dispatchNotificationToUser({
        eventKey: 'job_placement_ended',
        userId,
        subCompanyId,
        context,
        link: params.job ? '/jobs' : '/employees',
        relatedId: params.job?.id ?? params.employeeId,
      });
    }
  } catch (err) {
    console.error('[jobFlowNotifications] placement ended notify failed', err);
  }
}
