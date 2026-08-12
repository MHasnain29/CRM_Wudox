/**
 * Standalone employee training (Pending / Master):
 * staff sends a training URL by email, then uploads the certificate.
 * Not tied to client placements. SMS channel removed.
 */
import prisma from '../config/database';
import { sendEmployeeStandaloneTrainingEmail } from './email';
import { uploadEmployeeDocument } from './employees';
import { resolveTrainingTitle } from './employeeDefaultTraining';
import { recordOutboundSentEmail } from './recordOutboundSentEmail';
import {
  formatTrainingSendError,
  resolveTrainingOutboundSender,
} from './trainingOutboundSender';

export type TrainingChannel = 'email';

function trimOrNull(value?: string | null): string | null {
  const t = value?.trim();
  return t ? t : null;
}

function normalizeTrainingUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw Object.assign(new Error('Training URL is required'), { status: 400 });
  }
  if (trimmed.length > 2000) {
    throw Object.assign(new Error('Training URL must be 2000 characters or fewer'), {
      status: 400,
    });
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw Object.assign(new Error('Enter a valid training URL (https://…)'), { status: 400 });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw Object.assign(new Error('Training URL must start with http:// or https://'), {
      status: 400,
    });
  }
  return parsed.toString();
}

export type SerializedEmployeeTraining = {
  id: string;
  employeeId: string;
  title: string | null;
  url: string | null;
  sentAt: string | null;
  channel: string | null;
  certificateDocumentId: string | null;
  completedAt: string | null;
  sentById: string | null;
  sentByName: string | null;
  createdAt: string;
  updatedAt: string;
};

function serialize(
  row: {
    id: string;
    employeeId: string;
    title?: string | null;
    url: string | null;
    sentAt: Date | null;
    channel: string | null;
    certificateDocumentId: string | null;
    completedAt: Date | null;
    sentById: string | null;
    createdAt: Date;
    updatedAt: Date;
    sentBy?: { firstName: string; lastName: string } | null;
  },
): SerializedEmployeeTraining {
  const sentByName = row.sentBy
    ? `${row.sentBy.firstName} ${row.sentBy.lastName}`.trim() || null
    : null;
  return {
    id: row.id,
    employeeId: row.employeeId,
    title: resolveTrainingTitle(row.title ?? null, row.url),
    url: row.url,
    sentAt: row.sentAt?.toISOString() ?? null,
    channel: row.channel,
    certificateDocumentId: row.certificateDocumentId,
    completedAt: row.completedAt?.toISOString() ?? null,
    sentById: row.sentById,
    sentByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function findEmployeeInAgency(employeeId: string, agencyIds: string[]) {
  return prisma.employee.findFirst({
    where: {
      id: employeeId,
      addedBy: {
        subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
      },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      addedBy: { select: { subCompanyId: true } },
    },
  });
}

export async function listEmployeeTrainings(params: {
  employeeId: string;
  agencyIds: string[];
}): Promise<SerializedEmployeeTraining[]> {
  const emp = await findEmployeeInAgency(params.employeeId, params.agencyIds);
  if (!emp) {
    throw Object.assign(new Error('Employee not found'), { status: 404 });
  }

  const rows = await prisma.employeeTraining.findMany({
    where: { employeeId: params.employeeId },
    include: {
      sentBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map(serialize);
}

export async function sendEmployeeTrainingMessage(params: {
  employeeId: string;
  url: string;
  channel?: TrainingChannel | string;
  title?: string | null;
  sentByUserId: string;
  agencyIds: string[];
}): Promise<SerializedEmployeeTraining> {
  const url = normalizeTrainingUrl(params.url);
  if (params.channel && params.channel !== 'email') {
    throw Object.assign(new Error('Training links can only be sent by email'), { status: 400 });
  }

  const emp = await findEmployeeInAgency(params.employeeId, params.agencyIds);
  if (!emp) {
    throw Object.assign(new Error('Employee not found'), { status: 404 });
  }

  const email = emp.email?.trim();
  if (!email) {
    throw Object.assign(new Error('Employee email is required to send training email'), {
      status: 400,
    });
  }

  const subCompanyId = emp.addedBy.subCompanyId ?? params.agencyIds[0]!;
  const candidateName = `${emp.firstName} ${emp.lastName}`.trim();
  const title = trimOrNull(params.title);

  const outbound = await resolveTrainingOutboundSender({
    sentByUserId: params.sentByUserId,
    subCompanyId,
  });
  if (!outbound.ok) {
    throw Object.assign(new Error(outbound.error), { status: 502 });
  }

  let sentContent: { subject: string; html: string };
  try {
    sentContent = await sendEmployeeStandaloneTrainingEmail({
      toEmail: email,
      candidateName,
      url,
      sentByName: outbound.sender.sentByName,
      title,
      agency: outbound.sender.agency,
      from: outbound.sender.from,
    });
  } catch (err) {
    console.error('[employeeTraining] failed to send training email', err);
    throw Object.assign(new Error(formatTrainingSendError(err)), { status: 502 });
  }

  await recordOutboundSentEmail({
    fromUserId: params.sentByUserId,
    fromName: outbound.sender.from.name,
    fromEmail: outbound.sender.from.email,
    subject: sentContent.subject,
    body: sentContent.html,
    subCompanyId,
    to: [{ name: candidateName, email }],
    source: 'employee_standalone_training',
  });

  const now = new Date();
  const created = await prisma.employeeTraining.create({
    data: {
      employeeId: emp.id,
      url,
      sentAt: now,
      channel: 'email',
      sentById: params.sentByUserId,
    },
    include: {
      sentBy: { select: { firstName: true, lastName: true } },
    },
  });

  if (title) {
    try {
      await prisma.$executeRaw`
        UPDATE "employee_trainings" SET "title" = ${title} WHERE "id" = ${created.id}
      `;
    } catch (err) {
      console.warn('[employeeTraining] could not set title (run migration?)', err);
    }
  }

  return serialize({ ...created, title });
}

export async function resendEmployeeTrainingEmail(params: {
  trainingId: string;
  employeeId: string;
  sentByUserId: string;
  agencyIds: string[];
}): Promise<SerializedEmployeeTraining> {
  const emp = await findEmployeeInAgency(params.employeeId, params.agencyIds);
  if (!emp) {
    throw Object.assign(new Error('Employee not found'), { status: 404 });
  }

  const row = await prisma.employeeTraining.findFirst({
    where: { id: params.trainingId, employeeId: params.employeeId },
  });
  if (!row) {
    throw Object.assign(new Error('Training record not found'), { status: 404 });
  }
  if (row.completedAt) {
    throw Object.assign(new Error('Training is already complete'), { status: 400 });
  }
  if (!row.url?.trim()) {
    throw Object.assign(new Error('Training has no URL to resend'), { status: 400 });
  }

  const email = emp.email?.trim();
  if (!email) {
    throw Object.assign(new Error('Employee email is required to resend training email'), {
      status: 400,
    });
  }

  const subCompanyId = emp.addedBy.subCompanyId ?? params.agencyIds[0]!;
  const candidateName = `${emp.firstName} ${emp.lastName}`.trim();

  const outbound = await resolveTrainingOutboundSender({
    sentByUserId: params.sentByUserId,
    subCompanyId,
  });
  if (!outbound.ok) {
    throw Object.assign(new Error(outbound.error), { status: 502 });
  }

  let sentContent: { subject: string; html: string };
  try {
    sentContent = await sendEmployeeStandaloneTrainingEmail({
      toEmail: email,
      candidateName,
      url: row.url,
      sentByName: outbound.sender.sentByName,
      title: row.title,
      agency: outbound.sender.agency,
      from: outbound.sender.from,
    });
  } catch (err) {
    console.error('[employeeTraining] failed to resend training email', err);
    throw Object.assign(new Error(formatTrainingSendError(err)), { status: 502 });
  }

  await recordOutboundSentEmail({
    fromUserId: params.sentByUserId,
    fromName: outbound.sender.from.name,
    fromEmail: outbound.sender.from.email,
    subject: sentContent.subject,
    body: sentContent.html,
    subCompanyId,
    to: [{ name: candidateName, email }],
    source: 'employee_standalone_training_resend',
  });

  const updated = await prisma.employeeTraining.update({
    where: { id: row.id },
    data: {
      sentAt: new Date(),
      channel: 'email',
      sentById: params.sentByUserId,
    },
    include: {
      sentBy: { select: { firstName: true, lastName: true } },
    },
  });

  return serialize(updated);
}

export async function uploadEmployeeTrainingCertificate(params: {
  trainingId: string;
  employeeId: string;
  agencyIds: string[];
  uploadedById: string;
  fileBase64: string;
  mimeType?: string;
  name?: string;
}): Promise<SerializedEmployeeTraining> {
  const emp = await findEmployeeInAgency(params.employeeId, params.agencyIds);
  if (!emp) {
    throw Object.assign(new Error('Employee not found'), { status: 404 });
  }

  const row = await prisma.employeeTraining.findFirst({
    where: { id: params.trainingId, employeeId: params.employeeId },
  });
  if (!row) {
    throw Object.assign(new Error('Training record not found'), { status: 404 });
  }
  if (!row.sentAt) {
    throw Object.assign(new Error('Send the training URL before uploading a certificate'), {
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

  // Allow replace: point certificateDocumentId at the new upload and refresh completedAt.
  const updated = await prisma.employeeTraining.update({
    where: { id: row.id },
    data: {
      certificateDocumentId: doc.id,
      completedAt: new Date(),
    },
    include: {
      sentBy: { select: { firstName: true, lastName: true } },
    },
  });

  return serialize(updated);
}
