/**
 * Active Client training via PandaDoc — create/send/preview/webhook helpers.
 * Isolated from employee onboarding; reuses agency From delivery + token matcher.
 */
import prisma from '../config/database';
import { getAgencyBranding } from './email';
import { matchEmployeeToken } from './employeeOnboardingDocs';
import { sendPandaDocWithAgencyFrom } from './pandadoc/pandaDocCrmDelivery';
import { pandaDocService } from './pandadoc/pandadocService';
import { PandaDocError } from './pandadoc/types';
import { recordOutboundSentEmail } from './recordOutboundSentEmail';
import { buildAgencyR2Key, uploadToR2 } from './r2Storage';
import { DEFAULT_BRAND_NAME } from '../config/branding';
import {
  isAllowedActiveClientTrainingTemplateId,
  pandaDocTrainingSnapshotKey,
  resolveActiveClientTrainingTemplate,
} from './activeClientTrainingTemplates';

const FALLBACK_TOKEN_NAMES = [
  'Employee Name',
  'Candidate Name',
  'First Name',
  'Last Name',
  'Email',
  'Phone',
  'Address',
  'City',
  'Province',
  'Postal Code',
  'Date of Birth',
  'Agency Name',
  'Today',
  'Date',
];

async function resolveRoleAndTokens(templateId: string): Promise<{
  recipientRole: string;
  tokenNames: string[];
}> {
  let recipientRole = 'employee';
  let tokenNames = FALLBACK_TOKEN_NAMES;
  try {
    const meta = await pandaDocService.getTemplateRolesAndTokenNames(templateId);
    if (meta.roles.length > 0) {
      recipientRole = pandaDocService.pickPreferredSignerRole(meta.roles);
    }
    if (meta.tokenNames.length > 0) {
      tokenNames = Array.from(new Set([...meta.tokenNames, ...FALLBACK_TOKEN_NAMES]));
    }
  } catch (err) {
    console.warn('[activeClientTrainingPandaDoc] template details unavailable', err);
  }
  return { recipientRole, tokenNames };
}

function buildTokens(
  tokenNames: string[],
  emp: Parameters<typeof matchEmployeeToken>[1],
  agencyName: string,
) {
  return tokenNames
    .map((name) => ({ name, value: matchEmployeeToken(name, emp, agencyName) }))
    .filter((t) => t.value.trim());
}

export async function sendActiveClientTrainingPandaDoc(params: {
  trainingAssignmentId: string;
  employeeId: string;
  templateId: string;
  templateName: string;
  clientName: string;
  subCompanyId: string;
  sentByUserId: string;
}): Promise<{ sent: boolean; pandaDocId?: string; status?: string; warning?: string }> {
  if (!isAllowedActiveClientTrainingTemplateId(params.templateId)) {
    return { sent: false, warning: 'Invalid client training PandaDoc template.' };
  }

  const emp = await prisma.employee.findUnique({
    where: { id: params.employeeId },
  });
  if (!emp) return { sent: false, warning: 'Employee not found.' };
  if (!emp.email?.trim()) {
    return { sent: false, warning: 'Employee has no email; training was not sent.' };
  }

  const agency = await getAgencyBranding(params.subCompanyId);
  const agencyName = agency?.name ?? 'Staffing Agency';
  const fullName = `${emp.firstName} ${emp.lastName}`.trim();
  const { recipientRole, tokenNames } = await resolveRoleAndTokens(params.templateId);
  const tokens = buildTokens(tokenNames, emp, agencyName);

  const docTitle = `${params.templateName} — ${fullName}`;
  const pandaSubject = `Client training — ${params.clientName}`;
  const pandaMessage = `Hi ${emp.firstName},\n\nPlease review and sign your required training document for ${params.clientName} with ${agencyName}.\n\nThank you.`;

  let doc;
  let status = 'document.sent';
  try {
    doc = await pandaDocService.createFromTemplate({
      templateId: params.templateId,
      name: docTitle,
      recipients: [
        {
          email: emp.email.trim(),
          first_name: emp.firstName,
          last_name: emp.lastName,
          role: recipientRole,
        },
      ],
      tokens,
      waitForDraft: true,
    });

    try {
      const preSend = await pandaDocService.getDocument(doc.id);
      const empEmail = emp.email.trim().toLowerCase();
      const recipient = (preSend.recipients ?? []).find(
        (r) => (r.email ?? '').trim().toLowerCase() === empEmail,
      );
      const recipientType = (recipient?.recipient_type ?? '').toLowerCase();
      if (recipient && recipientType && recipientType !== 'signer') {
        return {
          sent: false,
          warning: `Employee is "${recipientType}" on this template (role "${recipientRole}"), not a signer.`,
        };
      }
    } catch (err) {
      console.warn('[activeClientTrainingPandaDoc] pre-send check failed', err);
    }

    await sendPandaDocWithAgencyFrom({
      documentId: doc.id,
      recipientEmail: emp.email.trim(),
      recipientName: fullName,
      subject: pandaSubject,
      message: pandaMessage,
      subCompanyId: params.subCompanyId,
    });

    for (let i = 0; i < 6; i++) {
      try {
        const detail = await pandaDocService.getDocument(doc.id);
        if (detail.status) status = detail.status;
        if (
          status !== 'document.uploaded' &&
          status !== 'document.draft' &&
          status !== 'document.error'
        ) {
          break;
        }
      } catch {
        // retry
      }
      if (i < 5) await new Promise<void>((r) => setTimeout(r, 1000));
    }
  } catch (err) {
    console.error('[activeClientTrainingPandaDoc] create/send', err);
    const detail =
      err instanceof PandaDocError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Unknown error';
    return { sent: false, warning: `Failed to send PandaDoc training: ${detail}` };
  }

  await prisma.activeClientTrainingAssignment.update({
    where: { id: params.trainingAssignmentId },
    data: {
      pandaDocId: doc.id,
      pandaDocStatus: status,
      pandaDocUpdatedAt: new Date(),
      sentAt: new Date(),
      sentByUserId: params.sentByUserId,
      templateFileKey: pandaDocTrainingSnapshotKey(params.templateId),
      templateFileName: params.templateName,
    },
  });

  const actor = await prisma.user.findUnique({
    where: { id: params.sentByUserId },
    select: { email: true, firstName: true, lastName: true },
  });
  const fromEmail = agency?.emailFromAddress || actor?.email || '';
  const fromName =
    (agency?.emailFromName || '').trim() ||
    (agency?.name || '').trim() ||
    [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') ||
    DEFAULT_BRAND_NAME;
  const pandaDocUrl = `https://app.pandadoc.com/a/#/documents/${doc.id}`;
  const sentBody = `<p>${pandaMessage.replace(/\n/g, '<br/>')}</p>
<p style="margin-top:16px">Client training was emailed to <strong>${fullName}</strong> (${emp.email.trim()}) for e-signature.</p>
<p style="margin-top:16px">
  <a href="${pandaDocUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 14px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:13px;line-height:1.2">
    View document in PandaDoc
  </a>
</p>`;
  await recordOutboundSentEmail({
    fromUserId: params.sentByUserId,
    fromName,
    fromEmail,
    subject: pandaSubject,
    body: sentBody,
    subCompanyId: params.subCompanyId,
    to: [{ name: fullName, email: emp.email.trim() }],
    source: 'active_client_training_pandadoc',
  });

  return { sent: true, pandaDocId: doc.id, status };
}

/** Draft PDF preview for a client's selected training template (no email). */
export async function previewActiveClientTrainingPandaDocPdf(params: {
  templateId: string;
  subCompanyId: string;
  clientName: string;
  /** Optional employee for token fill; otherwise blank/agency-only. */
  employeeId?: string | null;
}): Promise<{ body: Buffer; fileName: string } | null> {
  if (!isAllowedActiveClientTrainingTemplateId(params.templateId)) return null;
  const tpl = resolveActiveClientTrainingTemplate(params.templateId);
  const agency = await getAgencyBranding(params.subCompanyId);
  const agencyName = agency?.name ?? 'Staffing Agency';

  let empSource: Parameters<typeof matchEmployeeToken>[1] = {
    firstName: 'Preview',
    lastName: 'Employee',
    email: 'preview@example.com',
    phone: '',
    gender: null,
    address: null,
    addressLine2: null,
    city: null,
    province: null,
    postalCode: null,
    country: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    residencyStatus: null,
    dateOfBirth: null,
  };
  if (params.employeeId) {
    const emp = await prisma.employee.findUnique({ where: { id: params.employeeId } });
    if (emp) empSource = emp;
  }

  const { recipientRole, tokenNames } = await resolveRoleAndTokens(params.templateId);
  const tokens = buildTokens(tokenNames, empSource, agencyName);
  const email = (empSource.email || 'preview@example.com').trim();

  try {
    const doc = await pandaDocService.createFromTemplate({
      templateId: params.templateId,
      name: `[Preview] ${tpl.name} — ${params.clientName}`,
      recipients: [
        {
          email,
          first_name: empSource.firstName || 'Preview',
          last_name: empSource.lastName || 'Employee',
          role: recipientRole,
        },
      ],
      tokens,
      waitForDraft: true,
    });
    // Brief wait so PandaDoc can render PDF
    await new Promise<void>((r) => setTimeout(r, 1500));
    const body = await pandaDocService.downloadPdf(doc.id);
    return { body, fileName: `${tpl.name}.pdf` };
  } catch (err) {
    console.error('[activeClientTrainingPandaDoc] preview', err);
    return null;
  }
}

export async function downloadTrainingPandaDocPdf(
  documentId: string,
): Promise<Buffer | null> {
  try {
    return await pandaDocService.downloadPdf(documentId);
  } catch (err) {
    console.error('[activeClientTrainingPandaDoc] download', err);
    return null;
  }
}

export async function storeSignedActiveClientTrainingPdf(params: {
  trainingId: string;
  employeeId: string;
  subCompanyId: string;
  documentId: string;
  documentName: string;
}): Promise<void> {
  const existing = await prisma.activeClientTrainingAssignment.findUnique({
    where: { id: params.trainingId },
    select: { signedFileKey: true, status: true },
  });
  if (existing?.signedFileKey && existing.status === 'signed') return;

  const pdfBuffer = await pandaDocService.downloadPdf(params.documentId);
  const fileName = `${(params.documentName || 'client-training').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)}-signed.pdf`;
  const key = buildAgencyR2Key(
    params.subCompanyId,
    'employees',
    params.employeeId,
    'active-client-training-signed',
    `${params.trainingId}-${params.documentId}.pdf`,
  );
  await uploadToR2(key, pdfBuffer, 'application/pdf');

  await prisma.activeClientTrainingAssignment.update({
    where: { id: params.trainingId },
    data: {
      status: 'signed',
      signedFileKey: key,
      signedFileName: fileName,
      signedMimeType: 'application/pdf',
      signedFileSize: BigInt(pdfBuffer.length),
      completedAt: new Date(),
      pandaDocStatus: 'document.completed',
      pandaDocUpdatedAt: new Date(),
    },
  });
}

export async function syncActiveClientTrainingPandaDoc(params: {
  trainingId: string;
}): Promise<{ status: string } | null> {
  const row = await prisma.activeClientTrainingAssignment.findUnique({
    where: { id: params.trainingId },
    select: {
      id: true,
      pandaDocId: true,
      pandaDocStatus: true,
      employeeId: true,
      activeClient: { select: { subCompanyId: true, name: true } },
    },
  });
  if (!row?.pandaDocId) return null;

  const detail = await pandaDocService.getDocument(row.pandaDocId);
  const status = detail.status || row.pandaDocStatus || 'document.sent';

  const { applyActiveClientTrainingPandaDocStatusChange } = await import(
    './activeClientTrainingNotifications'
  );
  await applyActiveClientTrainingPandaDocStatusChange({
    trainingId: row.id,
    previousStatus: row.pandaDocStatus,
    nextStatus: status,
    documentName: detail.name || 'Client training',
    documentId: row.pandaDocId,
  });

  return { status };
}

/** Webhook entry: returns true if this document belongs to client training. */
export async function handleActiveClientTrainingWebhook(
  documentId: string,
  status: string,
  documentName: string,
): Promise<boolean> {
  const row = await prisma.activeClientTrainingAssignment.findFirst({
    where: { pandaDocId: documentId },
    select: { id: true, pandaDocStatus: true },
  });
  if (!row) return false;

  const { applyActiveClientTrainingPandaDocStatusChange } = await import(
    './activeClientTrainingNotifications'
  );
  await applyActiveClientTrainingPandaDocStatusChange({
    trainingId: row.id,
    previousStatus: row.pandaDocStatus,
    nextStatus: status,
    documentName,
    documentId,
  });
  return true;
}
