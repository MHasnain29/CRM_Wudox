/**
 * Side effects when Active Client training PandaDoc status changes.
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

export async function applyActiveClientTrainingPandaDocStatusChange(params: {
  trainingId: string;
  previousStatus: string | null | undefined;
  nextStatus: string;
  documentName: string;
  documentId: string;
}): Promise<{ notified: number; statusChanged: boolean }> {
  const { trainingId, previousStatus, nextStatus, documentName, documentId } = params;

  if (previousStatus === nextStatus && !isCompletedStatus(nextStatus)) {
    return { notified: 0, statusChanged: false };
  }

  const row = await prisma.activeClientTrainingAssignment.findUnique({
    where: { id: trainingId },
    select: {
      id: true,
      employeeId: true,
      sentByUserId: true,
      status: true,
      signedFileKey: true,
      pandaDocId: true,
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          addedById: true,
        },
      },
      activeClient: { select: { id: true, name: true, subCompanyId: true } },
    },
  });
  if (!row) return { notified: 0, statusChanged: false };

  await prisma.activeClientTrainingAssignment.update({
    where: { id: row.id },
    data: {
      pandaDocStatus: nextStatus,
      pandaDocUpdatedAt: new Date(),
    },
  });

  const senderId = row.sentByUserId ?? row.employee.addedById;
  const employeeName =
    `${row.employee.firstName} ${row.employee.lastName}`.trim() || 'Employee';
  const clientName = row.activeClient.name;
  const link = `/employees?review=${row.employeeId}`;

  if (isCompletedStatus(nextStatus) && !row.signedFileKey) {
    try {
      const { storeSignedActiveClientTrainingPdf } = await import(
        './activeClientTrainingPandaDoc'
      );
      await storeSignedActiveClientTrainingPdf({
        trainingId: row.id,
        employeeId: row.employeeId,
        subCompanyId: row.activeClient.subCompanyId,
        documentId: row.pandaDocId ?? documentId,
        documentName,
      });
    } catch (err) {
      console.error('[activeClientTraining] store signed PDF', err);
      // Still mark signed so UI advances even if R2 fails.
      await prisma.activeClientTrainingAssignment.update({
        where: { id: row.id },
        data: {
          status: 'signed',
          completedAt: new Date(),
          pandaDocStatus: nextStatus,
          pandaDocUpdatedAt: new Date(),
        },
      });
    }
  } else if (isCompletedStatus(nextStatus) && row.status !== 'signed') {
    await prisma.activeClientTrainingAssignment.update({
      where: { id: row.id },
      data: {
        status: 'signed',
        completedAt: row.status === 'signed' ? undefined : new Date(),
      },
    });
  }

  let notified = 0;
  const becameCompleted = isCompletedStatus(nextStatus) && !isCompletedStatus(previousStatus);
  const becameDeclined = isDeclinedStatus(nextStatus) && !isDeclinedStatus(previousStatus);

  if ((becameCompleted || becameDeclined) && senderId) {
    const { subCompanyId, userIds } = await resolveNotifyRecipients(senderId);
    const agencyId = subCompanyId ?? row.activeClient.subCompanyId;
    if (agencyId && userIds.length > 0) {
      await dispatchNotification({
        eventKey: becameCompleted ? 'client_training_signed' : 'client_training_declined',
        userIds,
        subCompanyId: agencyId,
        context: { employeeName, clientName },
        link,
        relatedId: row.employeeId,
      });
      notified = userIds.length;
    }
  }

  if (senderId) {
    const { userIds: refreshIds } = await resolveNotifyRecipients(senderId);
    const socketRecipients = [
      ...new Set([senderId, row.employee.addedById, ...refreshIds].filter(Boolean)),
    ];
    if (socketRecipients.length > 0) {
      emitToUsers(socketRecipients, 'employee-client-training:refresh', {
        employeeId: row.employeeId,
        trainingId: row.id,
        pandaDocStatus: nextStatus,
        completed: isCompletedStatus(nextStatus),
      });
    }
  }

  console.log(
    `[activeClientTraining] status ${previousStatus ?? 'null'} → ${nextStatus} training=${row.id} notify=${notified}`,
  );

  return { notified, statusChanged: true };
}
