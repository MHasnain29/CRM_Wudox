/**
 * Employee onboarding agreement via PandaDoc (recruitment).
 */
import prisma from '../config/database';
import { pandaDocService } from './pandadoc/pandadocService';
import { sendPandaDocWithAgencyFrom } from './pandadoc/pandaDocCrmDelivery';
import { PandaDocError } from './pandadoc/types';
import { uploadToR2 } from './r2Storage';
import { getAgencyBranding } from './email';
import { recordOutboundSentEmail } from './recordOutboundSentEmail';
import { DEFAULT_BRAND_NAME } from '../config/branding';

type EmployeeTokenSource = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  gender: string | null;
  address: string | null;
  addressLine2: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  residencyStatus: string | null;
  dateOfBirth: Date | null;
};

/** Local calendar YYYY-MM-DD — avoids UTC day-shift from toISOString(). */
function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function trimText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function joinAddress(line1: string | null | undefined, line2: string | null | undefined): string {
  return [trimText(line1), trimText(line2)].filter(Boolean).join(', ');
}

/**
 * Map a PandaDoc token name → employee/agency value.
 * Allowlist only: unknown tokens return '' (never invent / demo values).
 * Exact normalized key match — no substring guessing (avoids wrong fills).
 */
export function matchEmployeeToken(
  rawName: string,
  emp: EmployeeTokenSource,
  agencyName: string,
  now: Date = new Date(),
): string {
  const n = rawName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!n) return '';

  const firstName = trimText(emp.firstName);
  const lastName = trimText(emp.lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(' ');
  const email = trimText(emp.email);
  const phone = trimText(emp.phone);
  const address = joinAddress(emp.address, emp.addressLine2);
  const city = trimText(emp.city);
  const province = trimText(emp.province);
  const postalCode = trimText(emp.postalCode);
  const country = trimText(emp.country);
  const gender = trimText(emp.gender);
  const emergencyName = trimText(emp.emergencyContactName);
  const emergencyPhone = trimText(emp.emergencyContactPhone);
  const residency = trimText(emp.residencyStatus);
  const dob = emp.dateOfBirth ? formatLocalYmd(emp.dateOfBirth) : '';
  const today = formatLocalYmd(now);
  const agency = trimText(agencyName);

  // Allowlist only — skip ambiguous keys (e.g. bare "name", "status", "companyname")
  // that could map the wrong business meaning into the template.
  const map: Record<string, string> = {
    // Full name
    employeename: fullName,
    candidatename: fullName,
    recipientname: fullName,
    fullname: fullName,

    // First / last (plain + Candidate./Employee. style after normalize)
    firstname: firstName,
    employeefirstname: firstName,
    candidatefirstname: firstName,
    recipientfirstname: firstName,
    lastname: lastName,
    employeelastname: lastName,
    candidatelastname: lastName,
    recipientlastname: lastName,

    // Contact
    email: email,
    employeeemail: email,
    candidateemail: email,
    recipientemail: email,
    phone: phone,
    phonenumber: phone,
    employeephone: phone,
    candidatephone: phone,
    recipientphone: phone,

    // Address (line1+line2 joined — matches CRM preview)
    address: address,
    employeeaddress: address,
    candidateaddress: address,
    streetaddress: address,
    addressline1: trimText(emp.address),
    address1: trimText(emp.address),
    addressline2: trimText(emp.addressLine2),
    address2: trimText(emp.addressLine2),
    city: city,
    employeecity: city,
    candidatecity: city,
    province: province,
    state: province,
    employeeprovince: province,
    candidateprovince: province,
    postalcode: postalCode,
    zipcode: postalCode,
    postcode: postalCode,
    country: country,
    employeecountry: country,
    candidatecountry: country,

    // Profile (explicit names only)
    gender: gender,
    residencystatus: residency,
    immigrationstatus: residency,

    // Emergency
    emergencycontactname: emergencyName,
    emergencyname: emergencyName,
    emergencycontactphone: emergencyPhone,
    emergencyphone: emergencyPhone,
    emergencyphonenumber: emergencyPhone,

    // Dates — DOB only on explicit birth keys; "date"/"today" = agreement date
    dateofbirth: dob,
    birthdate: dob,
    dob: dob,
    employeedateofbirth: dob,
    candidatedateofbirth: dob,
    today: today,
    todaysdate: today,
    currentdate: today,
    datetoday: today,
    todaydate: today,
    agreementdate: today,
    signingdate: today,
    date: today,

    // Agency
    agencyname: agency,
    staffingagency: agency,
  };

  return map[n] ?? '';
}

async function resolveOnboardingTemplateId(subCompanyId: string): Promise<{
  templateId: string;
  templateName: string | null;
}> {
  const row = await prisma.proposalTypeTemplateMapping.findUnique({
    where: { subCompanyId },
    select: {
      employeeOnboardingTemplateId: true,
      employeeOnboardingTemplateName: true,
    },
  });
  if (!row?.employeeOnboardingTemplateId) {
    throw Object.assign(
      new Error(
        'No employee onboarding PandaDoc template mapped for this agency. Set it in Settings → Recruitment Agreement.',
      ),
      { status: 400 },
    );
  }
  return {
    templateId: row.employeeOnboardingTemplateId,
    templateName: row.employeeOnboardingTemplateName,
  };
}

export async function sendEmployeeOnboardingAgreement(params: {
  employeeId: string;
  agencyIds: string[];
  subCompanyId: string;
  actorId: string;
}) {
  const emp = await prisma.employee.findFirst({
    where: {
      id: params.employeeId,
      addedBy: {
        subCompanyId: params.agencyIds.length === 1 ? params.agencyIds[0] : { in: params.agencyIds },
      },
    },
  });
  if (!emp) throw Object.assign(new Error('Employee not found'), { status: 404 });
  if (!emp.email?.trim()) {
    throw Object.assign(new Error('Employee email is required to send onboarding agreement'), {
      status: 400,
    });
  }

  const { templateId } = await resolveOnboardingTemplateId(params.subCompanyId);
  const agency = await getAgencyBranding(params.subCompanyId);
  const agencyName = agency?.name ?? 'Staffing Agency';

  const fullName = `${emp.firstName} ${emp.lastName}`.trim();

  // Prefer real template roles/tokens; fall back to common names if details unavailable.
  let recipientRole = 'Signer';
  const fallbackTokenNames = [
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
  let tokenNames = fallbackTokenNames;
  try {
    const meta = await pandaDocService.getTemplateRolesAndTokenNames(templateId);
    if (meta.roles.length > 0) {
      recipientRole = pandaDocService.pickPreferredSignerRole(meta.roles);
      console.log(
        `[employeeOnboarding] template roles=[${meta.roles.join(', ')}] using role="${recipientRole}"`,
      );
    }
    if (meta.tokenNames.length > 0) {
      // Union template tokens + known employee aliases so either naming style fills.
      tokenNames = Array.from(new Set([...meta.tokenNames, ...fallbackTokenNames]));
    }
  } catch (err) {
    console.warn('[employeeOnboarding] could not load template details; using defaults', err);
  }

  // Only send non-empty, confidently matched values — never blank or invent fields.
  const tokens = tokenNames
    .map((name) => ({
      name,
      value: matchEmployeeToken(name, emp, agencyName),
    }))
    .filter((t) => t.value.trim());

  if (tokens.length > 0) {
    console.log(
      `[employeeOnboarding] filling ${tokens.length} PandaDoc token(s) for ${fullName}:`,
      tokens.map((t) => t.name).join(', '),
    );
  }

  let doc;
  let status = 'document.sent';
  const pandaSubject = `Onboarding Agreement — ${fullName}`;
  const pandaMessage = `Hi ${emp.firstName},\n\nPlease review and sign your onboarding agreement with ${agencyName}.\n\nThank you.`;
  try {
    // Wait until draft, then send with email (not silent) so PandaDoc emails the employee.
    doc = await pandaDocService.createFromTemplate({
      templateId,
      name: `Onboarding Agreement — ${fullName}`,
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
    // Before emailing: employee must be a signer (fields assigned to their role).
    // If they are CC-only, OPEN THE DOCUMENT is view-only (no ticks / signature).
    try {
      const preSend = await pandaDocService.getDocument(doc.id);
      const empEmail = emp.email.trim().toLowerCase();
      const recipient = (preSend.recipients ?? []).find(
        (r) => (r.email ?? '').trim().toLowerCase() === empEmail,
      );
      const recipientType = (recipient?.recipient_type ?? '').toLowerCase();
      if (recipient && recipientType && recipientType !== 'signer') {
        throw Object.assign(
          new Error(
            `Employee is "${recipientType}" on this PandaDoc document (role "${recipientRole}"), not a signer. ` +
              `In the PandaDoc template, assign Signature and Checkbox fields to role "${recipientRole}", then resend.`,
          ),
          { status: 502 },
        );
      }
      if (recipient && !recipientType) {
        console.warn(
          `[employeeOnboarding] recipient_type missing for ${empEmail}; role=${recipientRole}`,
        );
      }
    } catch (err) {
      if ((err as { status?: number })?.status === 502) throw err;
      console.warn('[employeeOnboarding] pre-send recipient check failed', err);
    }

    // CRM/SendGrid delivery so From shows agency name (not PandaDoc workspace member).
    await sendPandaDocWithAgencyFrom({
      documentId: doc.id,
      recipientEmail: emp.email.trim(),
      recipientName: fullName,
      subject: pandaSubject,
      message: pandaMessage,
      subCompanyId: params.subCompanyId,
    });

    // Confirm PandaDoc actually moved past draft (API can ACK while still processing).
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
        // Keep last status; retry briefly.
      }
      if (i < 5) {
        await new Promise<void>((r) => setTimeout(r, 1000));
      }
    }
    if (
      status === 'document.uploaded' ||
      status === 'document.draft' ||
      status === 'document.error'
    ) {
      throw Object.assign(
        new Error(
          `PandaDoc send did not complete (status: ${status}). Open PandaDoc or resend the agreement.`,
        ),
        { status: 502 },
      );
    }
  } catch (err) {
    console.error('[employeeOnboarding] create/send', err);
    const detail =
      err instanceof PandaDocError
        ? err.message
        : err instanceof Error
          ? err.message
          : '';
    const message = !detail
      ? 'Failed to create or send PandaDoc document'
      : detail.startsWith('Failed to create or send') ||
          detail.startsWith('PandaDoc send did not')
        ? detail
        : `Failed to create or send PandaDoc document: ${detail}`;
    throw Object.assign(new Error(message), { status: 502 });
  }
  const updated = await prisma.employee.update({
    where: { id: emp.id },
    data: {
      onboardingPandaDocId: doc.id,
      onboardingPandaDocStatus: status,
      onboardingPandaDocUpdatedAt: new Date(),
      onboardingSentById: params.actorId,
    },
    select: {
      id: true,
      onboardingPandaDocId: true,
      onboardingPandaDocStatus: true,
      onboardingPandaDocUpdatedAt: true,
    },
  });

  // CRM Sent mirror (PandaDoc delivers the real email; this is local mailbox history).
  const actor = await prisma.user.findUnique({
    where: { id: params.actorId },
    select: { email: true, firstName: true, lastName: true },
  });
  const fromEmail = agency?.emailFromAddress || actor?.email || '';
  // Mirror recipient-facing From: agency Integrations name, else agency name.
  const fromName =
    (agency?.emailFromName || '').trim() ||
    (agency?.name || '').trim() ||
    [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') ||
    actor?.email ||
    DEFAULT_BRAND_NAME;
  const pandaDocUrl = `https://app.pandadoc.com/a/#/documents/${doc.id}`;
  const sentBody = `<p>${pandaMessage.replace(/\n/g, '<br/>')}</p>
<p style="margin-top:16px">An onboarding agreement was emailed to <strong>${fullName}</strong> (${emp.email.trim()}) for e-signature.</p>
<p style="margin-top:16px">
  <a href="${pandaDocUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 14px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:13px;line-height:1.2">
    View document in PandaDoc
  </a>
</p>`;
  await recordOutboundSentEmail({
    fromUserId: params.actorId,
    fromName,
    fromEmail,
    subject: pandaSubject,
    body: sentBody,
    subCompanyId: params.subCompanyId,
    to: [{ name: fullName, email: emp.email.trim() }],
    source: 'employee_onboarding_agreement',
  });

  // Best-effort: also ensure default training links are created/emailed with the agreement.
  let trainingEmailed = false;
  let trainingError: string | null = null;
  try {
    const { sendDefaultEmployeeTrainings } = await import('./employeeDefaultTraining');
    const trainingResult = await sendDefaultEmployeeTrainings({
      employeeId: emp.id,
      sentByUserId: params.actorId,
      agencyIds: params.agencyIds,
      forceEmail: true,
    });
    trainingEmailed = trainingResult.emailed;
    if (!trainingResult.emailed) {
      trainingError =
        trainingResult.error ??
        (emp.email?.trim()
          ? 'Training email was not sent'
          : 'Employee email is required to send training email');
    }
  } catch (err) {
    console.error('[employeeOnboarding] default trainings after agreement', err);
    trainingError =
      err instanceof Error ? err.message : 'Failed to create or send default trainings';
  }

  return {
    employeeId: updated.id,
    pandaDocId: updated.onboardingPandaDocId,
    status: updated.onboardingPandaDocStatus,
    updatedAt: updated.onboardingPandaDocUpdatedAt?.toISOString() ?? null,
    completed: isCompletedStatus(updated.onboardingPandaDocStatus),
    trainingEmailed,
    trainingError,
  };
}

function isCompletedStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return status === 'document.completed' || status === 'document.paid';
}

/** True when PandaDoc shows completed/paid or an agreement file is already on the employee. */
export async function isEmployeeAgreementSigned(employeeId: string): Promise<boolean> {
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      onboardingPandaDocStatus: true,
      documents: {
        where: { type: 'agreement' },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!emp) return false;
  return isCompletedStatus(emp.onboardingPandaDocStatus) || emp.documents.length > 0;
}

/** Blocks Master until the onboarding agreement is signed. */
export async function assertEmployeeAgreementSigned(employeeId: string): Promise<void> {
  const signed = await isEmployeeAgreementSigned(employeeId);
  if (!signed) {
    throw Object.assign(
      new Error(
        'Onboarding agreement must be signed in PandaDoc before moving to Master. Status updates via webhook (or Sync), then approve.',
      ),
      { status: 400 },
    );
  }
}

export async function getEmployeeOnboardingStatus(employeeId: string, agencyIds: string[]) {
  const emp = await prisma.employee.findFirst({
    where: {
      id: employeeId,
      addedBy: {
        subCompanyId: agencyIds.length === 1 ? agencyIds[0] : { in: agencyIds },
      },
    },
    select: {
      id: true,
      onboardingPandaDocId: true,
      onboardingPandaDocStatus: true,
      onboardingPandaDocUpdatedAt: true,
      documents: {
        where: { type: 'agreement' },
        select: { id: true, name: true, uploadedAt: true },
        orderBy: { uploadedAt: 'desc' },
        take: 1,
      },
    },
  });
  if (!emp) return null;
  return {
    employeeId: emp.id,
    pandaDocId: emp.onboardingPandaDocId,
    status: emp.onboardingPandaDocStatus,
    updatedAt: emp.onboardingPandaDocUpdatedAt?.toISOString() ?? null,
    completed: isCompletedStatus(emp.onboardingPandaDocStatus) || emp.documents.length > 0,
    agreementDocument: emp.documents[0]
      ? {
          id: emp.documents[0].id,
          name: emp.documents[0].name,
          uploadedAt: emp.documents[0].uploadedAt.toISOString(),
        }
      : null,
  };
}

export async function syncEmployeeOnboardingAgreement(params: {
  employeeId: string;
  agencyIds: string[];
  /** Kept for route parity / future attribution; side effects use onboardingSentById. */
  actorId: string;
}) {
  void params.actorId;
  const emp = await prisma.employee.findFirst({
    where: {
      id: params.employeeId,
      addedBy: {
        subCompanyId: params.agencyIds.length === 1 ? params.agencyIds[0] : { in: params.agencyIds },
      },
    },
  });
  if (!emp) throw Object.assign(new Error('Employee not found'), { status: 404 });
  if (!emp.onboardingPandaDocId) {
    // Script/seed demo employees can already be "signed" (status or agreement file)
    // without a PandaDoc id — treat sync as a no-op success for the demo.
    const current = await getEmployeeOnboardingStatus(emp.id, params.agencyIds);
    if (current?.completed) return current;
    throw Object.assign(new Error('No onboarding document has been sent yet'), { status: 400 });
  }

  let detail;
  try {
    detail = await pandaDocService.getDocument(emp.onboardingPandaDocId);
  } catch (err) {
    console.error('[employeeOnboarding] sync getDocument', err);
    throw Object.assign(new Error('Failed to fetch PandaDoc document status'), { status: 502 });
  }

  const { applyEmployeeOnboardingStatusChange } = await import('./employeeOnboardingNotifications');
  await applyEmployeeOnboardingStatusChange({
    employeeId: emp.id,
    previousStatus: emp.onboardingPandaDocStatus,
    nextStatus: detail.status,
    documentName: detail.name || 'Onboarding Agreement',
    documentId: emp.onboardingPandaDocId,
  });

  return getEmployeeOnboardingStatus(emp.id, params.agencyIds);
}

export async function storeSignedOnboardingPdf(params: {
  employeeId: string;
  documentId: string;
  documentName: string;
  uploadedById: string;
}) {
  const existing = await prisma.employeeDocument.findFirst({
    where: {
      employeeId: params.employeeId,
      type: 'agreement',
      notes: { contains: params.documentId },
    },
    select: { id: true },
  });
  if (existing) return existing;

  const pdfBuffer = await pandaDocService.downloadPdf(params.documentId);
  const r2Key = `employees/${params.employeeId}/onboarding/${params.documentId}.pdf`;
  const fileUrl = await uploadToR2(r2Key, pdfBuffer, 'application/pdf');
  if (!fileUrl) {
    throw Object.assign(new Error('Failed to store signed PDF'), { status: 502 });
  }

  return prisma.employeeDocument.create({
    data: {
      employeeId: params.employeeId,
      type: 'agreement',
      name: `${params.documentName} (Signed).pdf`,
      fileName: `${params.documentId}.pdf`,
      fileSize: BigInt(pdfBuffer.length),
      mimeType: 'application/pdf',
      url: fileUrl,
      uploadedById: params.uploadedById,
      notes: `pandadoc:${params.documentId}`,
    },
  });
}

/** Called from PandaDoc webhook when a document state changes. */
export async function handleEmployeeOnboardingWebhook(
  documentId: string,
  status: string,
  documentName: string,
): Promise<boolean> {
  const emp = await prisma.employee.findFirst({
    where: { onboardingPandaDocId: documentId },
    select: { id: true, onboardingPandaDocStatus: true },
  });
  if (!emp) return false;

  const { applyEmployeeOnboardingStatusChange } = await import('./employeeOnboardingNotifications');
  await applyEmployeeOnboardingStatusChange({
    employeeId: emp.id,
    previousStatus: emp.onboardingPandaDocStatus,
    nextStatus: status,
    documentName,
    documentId,
  });
  return true;
}
