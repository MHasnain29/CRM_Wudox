/**
 * Side effects when an employee onboarding PandaDoc status changes:
 * store signed PDF, CRM bell for sender + their managers, socket refresh.
 */
import prisma from '../config/database';
import { emitToUsers } from '../socket';
import { dispatchNotification } from './notificationDispatch';

function isCompletedStatus(status: string | null | undefined): boolean {
  return status === 'document.completed' || status === 'document.paid';
}

function isDeclinedStatus(status: string | null | undefined): boolean {
  return status === 'document.declined';
}

async function resolveNotifyRecipients(senderId: string): Promise<{
  subCompanyId: string | null;
  userIds: string[];
}> {
  const sender = await prisma.user.findUnique({
    where: { id: senderId },
    select: {
      id: true,
      subCompanyId: true,
      reportingManagerIds: true,
      isActive: true,
    },
  });
  if (!sender?.isActive) {
    return { subCompanyId: sender?.subCompanyId ?? null, userIds: [] };
  }

  const managerIds = (sender.reportingManagerIds ?? []).filter(Boolean);
  const managers =
    managerIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: managerIds }, isActive: true },
          select: { id: true },
        })
      : [];

  return {
    subCompanyId: sender.subCompanyId,
    userIds: [...new Set([sender.id, ...managers.map((m) => m.id)])],
  };
}

/**
 * Apply a PandaDoc status change for an employee onboarding doc.
 * Idempotent for notifications: only fires on transition into completed/declined.
 */
export async function applyEmployeeOnboardingStatusChange(params: {
  employeeId: string;
  previousStatus: string | null | undefined;
  nextStatus: string;
  documentName: string;
  documentId: string;
}): Promise<{ notified: number; statusChanged: boolean }> {
  const { employeeId, previousStatus, nextStatus, documentName, documentId } = params;

  if (previousStatus === nextStatus) {
    return { notified: 0, statusChanged: false };
  }

  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      addedById: true,
      onboardingSentById: true,
      onboardingPandaDocId: true,
      addedBy: { select: { subCompanyId: true } },
    },
  });
  if (!emp) return { notified: 0, statusChanged: false };

  await prisma.employee.update({
    where: { id: emp.id },
    data: {
      onboardingPandaDocStatus: nextStatus,
      onboardingPandaDocUpdatedAt: new Date(),
    },
  });

  const senderId = emp.onboardingSentById ?? emp.addedById;
  const employeeName = `${emp.firstName} ${emp.lastName}`.trim() || 'Employee';
  const link = `/employees?review=${emp.id}`;

  if (isCompletedStatus(nextStatus)) {
    try {
      // Dynamic import avoids circular load with employeeOnboardingDocs.
      const { storeSignedOnboardingPdf } = await import('./employeeOnboardingDocs');
      await storeSignedOnboardingPdf({
        employeeId: emp.id,
        documentId: emp.onboardingPandaDocId ?? documentId,
        documentName,
        uploadedById: senderId,
      });
    } catch (err) {
      console.error('[employeeOnboarding] store signed PDF', err);
    }
  }

  let notified = 0;
  const becameCompleted = isCompletedStatus(nextStatus) && !isCompletedStatus(previousStatus);
  const becameDeclined = isDeclinedStatus(nextStatus) && !isDeclinedStatus(previousStatus);

  if (becameCompleted || becameDeclined) {
    const { subCompanyId, userIds } = await resolveNotifyRecipients(senderId);
    const agencyId = subCompanyId ?? emp.addedBy.subCompanyId;
    if (agencyId && userIds.length > 0) {
      await dispatchNotification({
        eventKey: becameCompleted ? 'employee_onboarding_signed' : 'employee_onboarding_declined',
        userIds,
        subCompanyId: agencyId,
        context: { employeeName },
        link,
        relatedId: emp.id,
      });
      notified = userIds.length;
    }
  }

  const { userIds: refreshIds } = await resolveNotifyRecipients(senderId);
  const socketRecipients = [...new Set([senderId, emp.addedById, ...refreshIds].filter(Boolean))];
  if (socketRecipients.length > 0) {
    emitToUsers(socketRecipients, 'employee-onboarding:refresh', {
      employeeId: emp.id,
      pandaDocStatus: nextStatus,
      completed: isCompletedStatus(nextStatus),
    });
  }

  console.log(
    `[employeeOnboarding] status ${previousStatus ?? 'null'} → ${nextStatus} employee=${emp.id} notify=${notified}`,
  );

  return { notified, statusChanged: true };
}
