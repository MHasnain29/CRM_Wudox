/**
 * Optional training checklist on client assignments:
 * staff sends a one-liner (email or SMS), then uploads the training certificate in the CRM.
 * Does not gate assignment approval/activation.
 */
import prisma from '../config/database';
import { getAgencyBranding, sendEmployeeTrainingMessageEmail } from './email';
import { uploadEmployeeDocument } from './employees';
import { getSerializedEmployeeAssignment } from './employeeAssignments';
import { recordOutboundSentEmail } from './recordOutboundSentEmail';
import { sendTrainingSms } from './trainingSms';

export type TrainingChannel = 'email' | 'sms';

function trimOrNull(value?: string | null): string | null {
  const t = value?.trim();
  return t ? t : null;
}

async function findClientAssignment(params: {
  assignmentId: string;
  employeeId: string;
  agencyIds: string[];
}) {
  const { assignmentId, employeeId, agencyIds } = params;
  return prisma.employeeAssignment.findFirst({
    where: {
      id: assignmentId,
      employeeId,
      targetType: 'client',
      employee: {
        addedBy: {
          subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
        },
      },
    },
    include: {
      client: { select: { id: true, name: true } },
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          addedBy: { select: { subCompanyId: true } },
        },
      },
    },
  });
}

export async function sendAssignmentTrainingMessage(params: {
  assignmentId: string;
  employeeId: string;
  message: string;
  channel: TrainingChannel;
  sentByUserId: string;
  agencyIds: string[];
}) {
  const message = trimOrNull(params.message);
  if (!message) {
    throw Object.assign(new Error('Training message is required'), { status: 400 });
  }
  if (message.length > 500) {
    throw Object.assign(new Error('Training message must be 500 characters or fewer'), {
      status: 400,
    });
  }
  const channel = params.channel === 'sms' ? 'sms' : 'email';

  const row = await findClientAssignment({
    assignmentId: params.assignmentId,
    employeeId: params.employeeId,
    agencyIds: params.agencyIds,
  });
  if (!row) {
    throw Object.assign(new Error('Client assignment not found'), { status: 404 });
  }
  if (row.trainingSentAt) {
    throw Object.assign(new Error('Training message was already sent for this assignment'), {
      status: 400,
    });
  }

  const clientName = row.client?.name ?? 'your client';
  const subCompanyId = row.employee.addedBy.subCompanyId ?? params.agencyIds[0]!;
  const candidateName = `${row.employee.firstName} ${row.employee.lastName}`.trim();
  const sender = await prisma.user.findUnique({
    where: { id: params.sentByUserId },
    select: { firstName: true, lastName: true },
  });
  const sentByName =
    `${sender?.firstName ?? ''} ${sender?.lastName ?? ''}`.trim() || 'Recruitment';

  if (channel === 'sms') {
    const phone = row.employee.phone?.trim();
    if (!phone) {
      throw Object.assign(new Error('Candidate phone is required to send training SMS'), {
        status: 400,
      });
    }
    const smsBody = `Hi ${candidateName}, training note from ${sentByName} for ${clientName}: ${message}`;
    try {
      await sendTrainingSms({
        subCompanyId,
        toPhone: phone,
        body: smsBody.slice(0, 1600),
      });
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 400 || status === 502) throw err;
      console.error('[employeeAssignmentTraining] failed to send training SMS', err);
      throw Object.assign(new Error('Failed to send training SMS. Try again.'), { status: 502 });
    }
  } else {
    const email = row.employee.email?.trim();
    if (!email) {
      throw Object.assign(new Error('Candidate email is required to send training email'), {
        status: 400,
      });
    }
    const agency = await getAgencyBranding(subCompanyId);
    try {
      const sent = await sendEmployeeTrainingMessageEmail({
        toEmail: email,
        candidateName,
        clientName,
        message,
        sentByName,
        agency,
      });
      if (sent) {
        const agencyFrom = agency?.emailFromAddress ?? '';
        await recordOutboundSentEmail({
          fromUserId: params.sentByUserId,
          fromName: agency?.emailFromName || agency?.name || sentByName,
          fromEmail: agencyFrom,
          subject: sent.subject,
          body: sent.html,
          subCompanyId,
          to: [{ name: candidateName, email, clientId: row.client?.id ?? null }],
          clientId: row.client?.id ?? null,
          source: 'employee_assignment_training',
        });
      }
    } catch (err) {
      console.error('[employeeAssignmentTraining] failed to send training email', err);
      throw Object.assign(new Error('Failed to send training email. Try again.'), { status: 502 });
    }
  }

  await prisma.employeeAssignment.update({
    where: { id: row.id },
    data: {
      trainingMessage: message,
      trainingSentAt: new Date(),
      trainingChannel: channel,
    },
  });

  const serialized = await getSerializedEmployeeAssignment(row.id);
  if (!serialized) {
    throw Object.assign(new Error('Assignment not found after update'), { status: 404 });
  }
  return serialized;
}

export async function uploadAssignmentTrainingCertificate(params: {
  assignmentId: string;
  employeeId: string;
  agencyIds: string[];
  uploadedById: string;
  fileBase64: string;
  mimeType?: string;
  name?: string;
}) {
  const row = await findClientAssignment({
    assignmentId: params.assignmentId,
    employeeId: params.employeeId,
    agencyIds: params.agencyIds,
  });
  if (!row) {
    throw Object.assign(new Error('Client assignment not found'), { status: 404 });
  }
  if (!row.trainingSentAt) {
    throw Object.assign(new Error('Send the training message before uploading a certificate'), {
      status: 400,
    });
  }
  if (row.trainingCompletedAt || row.trainingCertificateDocumentId) {
    throw Object.assign(new Error('Training certificate was already uploaded for this assignment'), {
      status: 400,
    });
  }
  if (!params.fileBase64?.trim()) {
    throw Object.assign(new Error('Certificate file is required'), { status: 400 });
  }

  const fileName = trimOrNull(params.name) || 'training-certificate.pdf';
  const doc = await uploadEmployeeDocument({
    employeeId: params.employeeId,
    agencyIds: params.agencyIds,
    uploadedById: params.uploadedById,
    name: fileName,
    fileBase64: params.fileBase64,
    mimeType: params.mimeType,
    type: 'training_certificate',
  });
  if (!doc) {
    throw Object.assign(new Error('Employee not found'), { status: 404 });
  }

  await prisma.employeeAssignment.update({
    where: { id: row.id },
    data: {
      trainingCertificateDocumentId: doc.id,
      trainingCompletedAt: new Date(),
    },
  });

  const serialized = await getSerializedEmployeeAssignment(row.id);
  if (!serialized) {
    throw Object.assign(new Error('Assignment not found after update'), { status: 404 });
  }
  return serialized;
}
