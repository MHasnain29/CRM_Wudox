/**
 * Active Client training — capture template, email on job link, upload signed proof.
 * Isolated from EmployeeTraining / Marketing assignment training.
 */
import prisma from '../config/database';
import { env } from '../config/env';
import { buildAgencyR2Key, getFromR2, uploadToR2 } from './r2Storage';
import {
  formatTrainingSendError,
  resolveTrainingOutboundSender,
} from './trainingOutboundSender';
import { sendActiveClientTrainingEmail } from './activeClientTrainingEmail';
import { recordOutboundSentEmail } from './recordOutboundSentEmail';
import {
  isAllowedActiveClientTrainingTemplateId,
  isPandaDocTrainingSnapshotKey,
  pandaDocTrainingSnapshotKey,
  resolveActiveClientTrainingTemplate,
} from './activeClientTrainingTemplates';
import {
  downloadTrainingPandaDocPdf,
  previewActiveClientTrainingPandaDocPdf,
  sendActiveClientTrainingPandaDoc,
  syncActiveClientTrainingPandaDoc,
} from './activeClientTrainingPandaDoc';

/** Allow larger PDFs than default MAX_FILE_SIZE (policy docs are often 10–20MB). Cap at 25MB. */
const MAX_TRAINING_FILE_BYTES = Math.min(
  Math.max(parseInt(env.MAX_FILE_SIZE ?? '10485760', 10) || 10_485_760, 25 * 1024 * 1024),
  25 * 1024 * 1024,
);

export type ActiveClientTrainingSummary = {
  clientTraining: boolean;
  hasDocument: boolean;
  trainingFileName: string | null;
  trainingPandaDocTemplateId: string | null;
  trainingPandaDocTemplateName: string | null;
};

export type ActiveClientTrainingAssignmentDto = {
  id: string;
  employeeId: string;
  activeClientId: string;
  activeClientName: string;
  assignmentId: string;
  status: 'pending' | 'signed';
  templateFileName: string;
  hasSignedDocument: boolean;
  signedFileName: string | null;
  sentAt: string | null;
  completedAt: string | null;
  createdAt: string;
  pandaDocId: string | null;
  pandaDocStatus: string | null;
  isPandaDoc: boolean;
};

function decodeBase64File(fileBase64: string): Buffer {
  const raw = fileBase64.includes(',') ? fileBase64.split(',').pop()!.trim() : fileBase64.trim();
  let buffer: Buffer;
  try {
    buffer = Buffer.from(raw, 'base64');
  } catch {
    throw Object.assign(new Error('Invalid base64 file content'), { status: 400 });
  }
  if (!buffer.length) {
    throw Object.assign(new Error('Empty file'), { status: 400 });
  }
  if (buffer.length > MAX_TRAINING_FILE_BYTES) {
    throw Object.assign(
      new Error(`File too large (max ${Math.round(MAX_TRAINING_FILE_BYTES / 1024 / 1024)}MB)`),
      { status: 400 },
    );
  }
  return buffer;
}

function safeFileName(name: string): string {
  const trimmed = name.trim() || 'training.pdf';
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
}

export function trainingSummaryFromActiveClient(row: {
  clientTraining: boolean;
  trainingFileKey: string | null;
  trainingFileName: string | null;
  trainingPandaDocTemplateId?: string | null;
  trainingPandaDocTemplateName?: string | null;
}): ActiveClientTrainingSummary {
  const templateId = row.trainingPandaDocTemplateId ?? null;
  const hasPanda = Boolean(templateId);
  const hasFile =
    Boolean(row.trainingFileKey) && !isPandaDocTrainingSnapshotKey(row.trainingFileKey);
  return {
    clientTraining: Boolean(row.clientTraining),
    hasDocument: hasPanda || hasFile,
    trainingFileName: hasPanda
      ? row.trainingPandaDocTemplateName ?? row.trainingFileName
      : row.trainingFileName,
    trainingPandaDocTemplateId: templateId,
    trainingPandaDocTemplateName: row.trainingPandaDocTemplateName ?? null,
  };
}

export async function uploadActiveClientTrainingTemplate(params: {
  activeClientId: string;
  subCompanyId: string;
  fileBase64: string;
  fileName: string;
  mimeType?: string | null;
}): Promise<{
  trainingFileKey: string;
  trainingFileName: string;
  trainingMimeType: string;
  trainingFileSize: bigint;
}> {
  const buffer = decodeBase64File(params.fileBase64);
  const fileName = safeFileName(params.fileName);
  const mimeType =
    params.mimeType?.trim() ||
    (fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
  const key = buildAgencyR2Key(
    params.subCompanyId,
    'active-clients',
    params.activeClientId,
    'training',
    `${Date.now()}-${fileName}`,
  );
  const uploaded = await uploadToR2(key, buffer, mimeType);
  if (!uploaded && !key) {
    throw Object.assign(new Error('File storage is not configured'), { status: 503 });
  }
  // uploadToR2 returns null when R2 unset — still store key for local/dev consistency when configured fails
  if (uploaded === null) {
    // When R2 not configured, keep the key so DB is consistent; download will 404 until R2 is set.
    console.warn('[activeClientTraining] R2 not configured; stored training key without upload');
  }
  return {
    trainingFileKey: key,
    trainingFileName: fileName,
    trainingMimeType: mimeType,
    trainingFileSize: BigInt(buffer.length),
  };
}

export function validateClientTrainingInput(input: {
  clientTraining?: boolean;
  trainingFileBase64?: string | null;
  trainingFileName?: string | null;
  trainingPandaDocTemplateId?: string | null;
  hasExistingDocument?: boolean;
}): void {
  if (!input.clientTraining) return;
  const templateId = input.trainingPandaDocTemplateId?.trim();
  if (templateId) {
    if (!isAllowedActiveClientTrainingTemplateId(templateId)) {
      throw Object.assign(new Error('Invalid client training PandaDoc template'), { status: 400 });
    }
    return;
  }
  const hasNewFile = Boolean(input.trainingFileBase64?.trim());
  if (!hasNewFile && !input.hasExistingDocument) {
    throw Object.assign(new Error('Training document is required when Client training is enabled'), {
      status: 400,
    });
  }
}

export async function getActiveClientTrainingDocumentBuffer(
  activeClientId: string,
  agencyIds: string[],
): Promise<{ body: Buffer; contentType: string; fileName: string } | null> {
  const row = await prisma.activeClient.findFirst({
    where: {
      id: activeClientId,
      subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
      clientTraining: true,
    },
    select: {
      name: true,
      subCompanyId: true,
      trainingFileKey: true,
      trainingFileName: true,
      trainingMimeType: true,
      trainingPandaDocTemplateId: true,
      trainingPandaDocTemplateName: true,
    },
  });
  if (!row) return null;

  if (row.trainingPandaDocTemplateId) {
    const preview = await previewActiveClientTrainingPandaDocPdf({
      templateId: row.trainingPandaDocTemplateId,
      subCompanyId: row.subCompanyId,
      clientName: row.name,
    });
    if (!preview) return null;
    return {
      body: preview.body,
      contentType: 'application/pdf',
      fileName: preview.fileName || row.trainingPandaDocTemplateName || 'client-training.pdf',
    };
  }

  if (!row.trainingFileKey || isPandaDocTrainingSnapshotKey(row.trainingFileKey)) return null;
  const r2 = await getFromR2(row.trainingFileKey);
  if (!r2?.body) return null;
  const body = r2.body instanceof Buffer ? r2.body : Buffer.from(r2.body as Uint8Array);
  return {
    body,
    contentType: r2.contentType ?? row.trainingMimeType ?? 'application/octet-stream',
    fileName: row.trainingFileName || 'client-training.pdf',
  };
}

function serializeAssignment(row: {
  id: string;
  employeeId: string;
  activeClientId: string;
  assignmentId: string;
  status: 'pending' | 'signed';
  templateFileName: string;
  templateFileKey?: string | null;
  signedFileKey: string | null;
  signedFileName: string | null;
  sentAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  pandaDocId?: string | null;
  pandaDocStatus?: string | null;
  activeClient?: { name: string } | null;
}): ActiveClientTrainingAssignmentDto {
  return {
    id: row.id,
    employeeId: row.employeeId,
    activeClientId: row.activeClientId,
    activeClientName: row.activeClient?.name ?? 'Active Client',
    assignmentId: row.assignmentId,
    status: row.status,
    templateFileName: row.templateFileName,
    hasSignedDocument: Boolean(row.signedFileKey),
    signedFileName: row.signedFileName,
    sentAt: row.sentAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    pandaDocId: row.pandaDocId ?? null,
    pandaDocStatus: row.pandaDocStatus ?? null,
    isPandaDoc: Boolean(row.pandaDocId) || isPandaDocTrainingSnapshotKey(row.templateFileKey),
  };
}

export async function listActiveClientTrainingsForEmployee(params: {
  employeeId: string;
  agencyIds: string[];
}): Promise<ActiveClientTrainingAssignmentDto[] | null> {
  const emp = await prisma.employee.findFirst({
    where: {
      id: params.employeeId,
      addedBy: {
        subCompanyId:
          params.agencyIds.length === 1 ? params.agencyIds[0] : { in: params.agencyIds },
      },
    },
    select: { id: true },
  });
  if (!emp) return null;

  const rows = await prisma.activeClientTrainingAssignment.findMany({
    where: { employeeId: params.employeeId },
    include: { activeClient: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(serializeAssignment);
}

async function loadScopedTrainingRow(params: {
  employeeId: string;
  trainingId: string;
  agencyIds: string[];
}) {
  return prisma.activeClientTrainingAssignment.findFirst({
    where: {
      id: params.trainingId,
      employeeId: params.employeeId,
      employee: {
        addedBy: {
          subCompanyId:
            params.agencyIds.length === 1 ? params.agencyIds[0] : { in: params.agencyIds },
        },
      },
    },
    include: {
      activeClient: { select: { id: true, name: true, subCompanyId: true } },
      employee: { select: { id: true, firstName: true, lastName: true, email: true } },
      assignment: { select: { id: true, endedAt: true, isActive: true } },
    },
  });
}

async function sendTemplateEmailForRow(params: {
  row: NonNullable<Awaited<ReturnType<typeof loadScopedTrainingRow>>> & {
    pandaDocId?: string | null;
  };
  sentByUserId: string;
}): Promise<{ sent: boolean; warning?: string }> {
  const { row, sentByUserId } = params;
  const email = row.employee.email?.trim();
  if (!email) {
    return { sent: false, warning: 'Employee has no email; training email was not sent.' };
  }

  const outbound = await resolveTrainingOutboundSender({
    sentByUserId,
    subCompanyId: row.activeClient.subCompanyId,
  });
  if (!outbound.ok) {
    return { sent: false, warning: outbound.error };
  }

  if (isPandaDocTrainingSnapshotKey(row.templateFileKey) || row.pandaDocId) {
    return { sent: false, warning: 'Use PandaDoc resend for this training document.' };
  }

  const r2 = await getFromR2(row.templateFileKey);
  if (!r2?.body) {
    return { sent: false, warning: 'Training document not found in storage; email was not sent.' };
  }
  const body = r2.body instanceof Buffer ? r2.body : Buffer.from(r2.body as Uint8Array);

  const employeeName = `${row.employee.firstName} ${row.employee.lastName}`.trim() || 'there';
  try {
    const sent = await sendActiveClientTrainingEmail({
      toEmail: email,
      employeeName,
      clientName: row.activeClient.name,
      sentByName: outbound.sender.sentByName,
      sentByUserId,
      from: outbound.sender.from,
      agency: outbound.sender.agency,
      subCompanyId: row.activeClient.subCompanyId,
      attachment: {
        contentBase64: body.toString('base64'),
        filename: row.templateFileName || 'client-training.pdf',
        mimeType: row.templateMimeType || r2.contentType || 'application/pdf',
      },
    });
    await recordOutboundSentEmail({
      fromUserId: sentByUserId,
      fromName: outbound.sender.from.name,
      fromEmail: outbound.sender.from.email,
      subject: sent.subject,
      body: sent.html,
      subCompanyId: row.activeClient.subCompanyId,
      to: [{ name: employeeName, email }],
      source: 'active_client_training',
    });
  } catch (err) {
    return { sent: false, warning: formatTrainingSendError(err) };
  }

  await prisma.activeClientTrainingAssignment.update({
    where: { id: row.id },
    data: { sentAt: new Date(), sentByUserId },
  });
  return { sent: true };
}

/**
 * Best-effort side effect after successful job link. Never throws.
 */
export async function maybeStartActiveClientTrainingAfterJobLink(params: {
  assignmentId: string;
  employeeId: string;
  activeClientId: string | null | undefined;
  sentByUserId: string;
}): Promise<{ started: boolean; emailSent: boolean; warning?: string }> {
  try {
    if (!params.activeClientId) {
      return { started: false, emailSent: false };
    }

    const existing = await prisma.activeClientTrainingAssignment.findUnique({
      where: { assignmentId: params.assignmentId },
      select: { id: true },
    });
    if (existing) {
      return { started: true, emailSent: false };
    }

    const client = await prisma.activeClient.findUnique({
      where: { id: params.activeClientId },
      select: {
        id: true,
        name: true,
        clientTraining: true,
        trainingFileKey: true,
        trainingFileName: true,
        trainingMimeType: true,
        trainingFileSize: true,
        trainingPandaDocTemplateId: true,
        trainingPandaDocTemplateName: true,
        subCompanyId: true,
      },
    });
    if (!client?.clientTraining) {
      return { started: false, emailSent: false };
    }

    const pandaTemplateId = client.trainingPandaDocTemplateId?.trim();
    const usePanda =
      Boolean(pandaTemplateId) && isAllowedActiveClientTrainingTemplateId(pandaTemplateId!);
    const hasPdfFile =
      Boolean(client.trainingFileKey) &&
      Boolean(client.trainingFileName) &&
      !isPandaDocTrainingSnapshotKey(client.trainingFileKey);

    if (!usePanda && !hasPdfFile) {
      return { started: false, emailSent: false };
    }

    if (usePanda && pandaTemplateId) {
      const tpl = resolveActiveClientTrainingTemplate(pandaTemplateId);
      const created = await prisma.activeClientTrainingAssignment.create({
        data: {
          employeeId: params.employeeId,
          activeClientId: client.id,
          assignmentId: params.assignmentId,
          status: 'pending',
          templateFileKey: pandaDocTrainingSnapshotKey(tpl.id),
          templateFileName: client.trainingPandaDocTemplateName || tpl.name,
        },
      });

      const emailResult = await sendActiveClientTrainingPandaDoc({
        trainingAssignmentId: created.id,
        employeeId: params.employeeId,
        templateId: tpl.id,
        templateName: client.trainingPandaDocTemplateName || tpl.name,
        clientName: client.name,
        subCompanyId: client.subCompanyId,
        sentByUserId: params.sentByUserId,
      });
      return {
        started: true,
        emailSent: emailResult.sent,
        warning: emailResult.warning,
      };
    }

    const created = await prisma.activeClientTrainingAssignment.create({
      data: {
        employeeId: params.employeeId,
        activeClientId: client.id,
        assignmentId: params.assignmentId,
        status: 'pending',
        templateFileKey: client.trainingFileKey!,
        templateFileName: client.trainingFileName!,
        templateMimeType: client.trainingMimeType,
        templateFileSize: client.trainingFileSize,
      },
      include: {
        activeClient: { select: { id: true, name: true, subCompanyId: true } },
        employee: { select: { id: true, firstName: true, lastName: true, email: true } },
        assignment: { select: { id: true, endedAt: true, isActive: true } },
      },
    });

    const emailResult = await sendTemplateEmailForRow({
      row: created,
      sentByUserId: params.sentByUserId,
    });
    return {
      started: true,
      emailSent: emailResult.sent,
      warning: emailResult.warning,
    };
  } catch (err) {
    console.error('[activeClientTraining] post-link side effect failed', err);
    return {
      started: false,
      emailSent: false,
      warning: 'Client training could not be started. You can retry from the employee Training panel.',
    };
  }
}

export async function resendActiveClientTrainingEmail(params: {
  employeeId: string;
  trainingId: string;
  agencyIds: string[];
  sentByUserId: string;
}): Promise<
  | { ok: true; data: ActiveClientTrainingAssignmentDto; warning?: string }
  | { ok: false; error: string; status: number }
> {
  const row = await loadScopedTrainingRow(params);
  if (!row) return { ok: false, error: 'Not found', status: 404 };

  if (row.pandaDocId || isPandaDocTrainingSnapshotKey(row.templateFileKey)) {
    const client = await prisma.activeClient.findUnique({
      where: { id: row.activeClientId },
      select: {
        name: true,
        subCompanyId: true,
        trainingPandaDocTemplateId: true,
        trainingPandaDocTemplateName: true,
      },
    });
    const templateId =
      client?.trainingPandaDocTemplateId ||
      (isPandaDocTrainingSnapshotKey(row.templateFileKey)
        ? row.templateFileKey.replace(/^pandadoc:/, '')
        : null);
    if (!templateId || !isAllowedActiveClientTrainingTemplateId(templateId)) {
      return { ok: false, error: 'PandaDoc template missing for this training', status: 400 };
    }
    const tpl = resolveActiveClientTrainingTemplate(templateId);
    const emailResult = await sendActiveClientTrainingPandaDoc({
      trainingAssignmentId: row.id,
      employeeId: row.employeeId,
      templateId: tpl.id,
      templateName:
        client?.trainingPandaDocTemplateName || row.templateFileName || tpl.name,
      clientName: client?.name || row.activeClient.name,
      subCompanyId: client?.subCompanyId || row.activeClient.subCompanyId,
      sentByUserId: params.sentByUserId,
    });
    if (!emailResult.sent) {
      return {
        ok: false,
        error: emailResult.warning || 'Failed to send PandaDoc training',
        status: 502,
      };
    }
  } else {
    const emailResult = await sendTemplateEmailForRow({
      row,
      sentByUserId: params.sentByUserId,
    });
    if (!emailResult.sent) {
      return {
        ok: false,
        error: emailResult.warning || 'Failed to send training email',
        status: 502,
      };
    }
  }

  const refreshed = await prisma.activeClientTrainingAssignment.findUniqueOrThrow({
    where: { id: row.id },
    include: { activeClient: { select: { name: true } } },
  });
  return { ok: true, data: serializeAssignment(refreshed) };
}

export async function syncActiveClientTrainingStatus(params: {
  employeeId: string;
  trainingId: string;
  agencyIds: string[];
}): Promise<
  | { ok: true; data: ActiveClientTrainingAssignmentDto }
  | { ok: false; error: string; status: number }
> {
  const row = await loadScopedTrainingRow(params);
  if (!row) return { ok: false, error: 'Not found', status: 404 };
  if (!row.pandaDocId) {
    return { ok: false, error: 'No PandaDoc document on this training', status: 400 };
  }
  try {
    await syncActiveClientTrainingPandaDoc({ trainingId: row.id });
  } catch (err) {
    console.error('[activeClientTraining] sync', err);
    return { ok: false, error: 'Failed to sync PandaDoc status', status: 502 };
  }
  const refreshed = await prisma.activeClientTrainingAssignment.findUniqueOrThrow({
    where: { id: row.id },
    include: { activeClient: { select: { name: true } } },
  });
  return { ok: true, data: serializeAssignment(refreshed) };
}

export async function uploadSignedActiveClientTraining(params: {
  employeeId: string;
  trainingId: string;
  agencyIds: string[];
  completedByUserId: string;
  fileBase64: string;
  fileName: string;
  mimeType?: string | null;
}): Promise<
  | { ok: true; data: ActiveClientTrainingAssignmentDto }
  | { ok: false; error: string; status: number }
> {
  const row = await loadScopedTrainingRow(params);
  if (!row) return { ok: false, error: 'Not found', status: 404 };

  // Product: allow upload even after placement ended; always allow if never emailed.
  const buffer = decodeBase64File(params.fileBase64);
  const fileName = safeFileName(params.fileName);
  const mimeType =
    params.mimeType?.trim() ||
    (fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
  const key = buildAgencyR2Key(
    row.activeClient.subCompanyId,
    'employees',
    params.employeeId,
    'active-client-training-signed',
    `${params.trainingId}-${Date.now()}-${fileName}`,
  );
  await uploadToR2(key, buffer, mimeType);

  const updated = await prisma.activeClientTrainingAssignment.update({
    where: { id: row.id },
    data: {
      status: 'signed',
      signedFileKey: key,
      signedFileName: fileName,
      signedMimeType: mimeType,
      signedFileSize: BigInt(buffer.length),
      completedAt: new Date(),
      completedByUserId: params.completedByUserId,
    },
    include: { activeClient: { select: { name: true } } },
  });

  return { ok: true, data: serializeAssignment(updated) };
}

export async function getActiveClientTrainingFileBuffer(params: {
  employeeId: string;
  trainingId: string;
  agencyIds: string[];
  kind: 'template' | 'signed';
}): Promise<{ body: Buffer; contentType: string; fileName: string } | null> {
  const row = await loadScopedTrainingRow(params);
  if (!row) return null;

  if (params.kind === 'signed') {
    if (!row.signedFileKey) {
      // Fallback: pull from PandaDoc if completed but R2 missing
      if (row.pandaDocId && row.status === 'signed') {
        const pdf = await downloadTrainingPandaDocPdf(row.pandaDocId);
        if (pdf) {
          return {
            body: pdf,
            contentType: 'application/pdf',
            fileName: row.signedFileName || 'signed-client-training.pdf',
          };
        }
      }
      return null;
    }
    const r2 = await getFromR2(row.signedFileKey);
    if (!r2?.body) return null;
    const body = r2.body instanceof Buffer ? r2.body : Buffer.from(r2.body as Uint8Array);
    return {
      body,
      contentType: r2.contentType ?? row.signedMimeType ?? 'application/octet-stream',
      fileName: row.signedFileName || 'signed-client-training.pdf',
    };
  }

  // Template / sent document view
  if (row.pandaDocId) {
    const pdf = await downloadTrainingPandaDocPdf(row.pandaDocId);
    if (pdf) {
      return {
        body: pdf,
        contentType: 'application/pdf',
        fileName: row.templateFileName || 'client-training.pdf',
      };
    }
  }

  if (!row.templateFileKey || isPandaDocTrainingSnapshotKey(row.templateFileKey)) {
    return null;
  }
  const r2 = await getFromR2(row.templateFileKey);
  if (!r2?.body) return null;
  const body = r2.body instanceof Buffer ? r2.body : Buffer.from(r2.body as Uint8Array);
  return {
    body,
    contentType: r2.contentType ?? row.templateMimeType ?? 'application/octet-stream',
    fileName: row.templateFileName || 'client-training.pdf',
  };
}
