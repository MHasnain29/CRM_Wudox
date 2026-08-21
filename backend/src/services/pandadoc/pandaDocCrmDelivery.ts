/**
 * Deliver a PandaDoc signing link via CRM/SendGrid so the From name is the agency
 * (emailFromName / agency name), instead of the PandaDoc workspace member
 * (e.g. "Donna Gill via PandaDoc").
 *
 * Flow: silent PandaDoc send → resolve recipient shared_link → SendGrid email.
 * Falls back to PandaDoc's own notification email when SendGrid / From is unavailable.
 */
import prisma from '../../config/database';
import { env } from '../../config/env';
import {
  buildEmail,
  getAgencyBranding,
  sendClientEmail,
  tplButton,
  tplCard,
  tplDivider,
  tplSig,
} from '../email';
import { pandaDocService } from './pandadocService';
import { DEFAULT_BRAND_NAME } from '../../config/branding';

export type PandaDocCrmDeliveryResult = {
  delivery: 'crm' | 'pandadoc';
  shareLink?: string;
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function canDeliverViaCrm(fromEmail: string): boolean {
  return Boolean(env.SENDGRID_API_KEY && fromEmail.trim());
}

const PANDA_SIGN_GUIDE =
  'https://support.pandadoc.com/hc/en-us/articles/360016160173';

function buildSigningEmailHtml(params: {
  recipientFirstName: string;
  recipientName: string;
  message: string;
  shareLink: string;
  agencyName: string;
  agency?: Awaited<ReturnType<typeof getAgencyBranding>>;
  documentTitle?: string;
}): string {
  const first = escapeHtml(params.recipientFirstName || 'there');
  const agency = escapeHtml(params.agencyName);

  // Strip greeting / thanks lines from plain message so the shell owns structure.
  const contentLines = params.message
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      if (/^hi\b/i.test(l) || /^hello\b/i.test(l) || /^dear\b/i.test(l)) return false;
      if (/^thank you\.?$/i.test(l) || /^thanks\.?$/i.test(l)) return false;
      return true;
    });

  const mainText =
    contentLines.length > 0
      ? contentLines.map((l) => escapeHtml(l)).join('<br>')
      : `Please review and sign your document with <strong>${agency}</strong>.`;

  const body = `
    <p style="margin:0 0 14px">Hi <strong>${first}</strong>,</p>
    <p style="margin:0 0 8px">${mainText}</p>
    ${tplCard(
      'Action required',
      `<p style="margin:0">Open the secure document, review the terms, and complete your signature when ready.</p>`,
      '#ecfdf5',
      '#059669',
      '#065f46',
    )}
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:8px 0 4px">
      <tr>
        <td align="center">
          ${tplButton('Open the document →', params.shareLink, '#059669')}
        </td>
      </tr>
    </table>
    <p style="margin:0 0 4px;font-size:13px;color:#6b7280;text-align:center;line-height:1.5">
      New to PandaDoc?
      <a href="${PANDA_SIGN_GUIDE}" style="color:#1e40af;text-decoration:underline">View the signing guide</a>
    </p>
    ${tplDivider()}
    ${tplSig(escapeHtml(params.agencyName), 'Onboarding · Secure e-signature')}
  `;

  // Omit logoUrl — remote/R2 logos often break in Gmail; emoji header is more reliable here.
  const agencyNoLogo = params.agency
    ? { ...params.agency, logoUrl: null }
    : undefined;

  return buildEmail({
    headerColor: '#0f766e',
    headerIcon: '📝',
    headerTitle: 'Document ready to sign',
    headerSubtitle: escapeHtml(params.documentTitle || params.recipientName || params.agencyName),
    body,
    agency: agencyNoLogo,
  });
}

async function resolveAgencyFrom(subCompanyId: string): Promise<{
  fromEmail: string;
  fromName: string;
  agencyName: string;
}> {
  const sc = await prisma.subCompany.findUnique({
    where: { id: subCompanyId },
    select: { name: true, emailFromAddress: true, emailFromName: true },
  });
  const agencyName = (sc?.name || '').trim() || 'Agency';
  const fromEmail = (sc?.emailFromAddress || env.EMAIL_FROM || '').trim();
  // Explicit Integrations From name → else agency name (not a personal PandaDoc member).
  const fromName =
    (sc?.emailFromName || '').trim() || agencyName || env.EMAIL_FROM_NAME || DEFAULT_BRAND_NAME;
  return { fromEmail, fromName, agencyName };
}

/**
 * Send document to recipient. Prefer CRM email with agency From name.
 */
export async function sendPandaDocWithAgencyFrom(params: {
  documentId: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  message: string;
  subCompanyId: string;
}): Promise<PandaDocCrmDeliveryResult> {
  const { fromEmail, fromName, agencyName } = await resolveAgencyFrom(params.subCompanyId);
  const agency = await getAgencyBranding(params.subCompanyId);
  const recipientFirstName =
    params.recipientName.trim().split(/\s+/)[0] || params.recipientName.trim() || 'there';

  if (!canDeliverViaCrm(fromEmail)) {
    console.warn(
      `[PandaDoc CRM delivery] SendGrid/From unavailable for agency=${params.subCompanyId} — using PandaDoc notification email`,
    );
    await pandaDocService.sendWithMessage(params.documentId, params.subject, params.message);
    return { delivery: 'pandadoc' };
  }

  const shareLink = await pandaDocService.sendSilentAndResolveShareLink(
    params.documentId,
    params.recipientEmail,
  );

  const html = buildSigningEmailHtml({
    recipientFirstName,
    recipientName: params.recipientName,
    message: params.message,
    shareLink,
    agencyName,
    agency,
    documentTitle: params.subject,
  });

  const sent = await sendClientEmail({
    to: [{ email: params.recipientEmail.trim(), name: params.recipientName.trim() || undefined }],
    from: { email: fromEmail, name: fromName },
    subject: params.subject,
    html,
    text: `${params.message}\n\nOpen the document: ${shareLink}`,
    subCompanyId: params.subCompanyId,
  });

  if (!sent) {
    console.warn(
      `[PandaDoc CRM delivery] CRM send returned false for ${params.recipientEmail} — falling back to PandaDoc email`,
    );
    // Document is already silently sent; PandaDoc re-send with silent:false still notifies recipients.
    await pandaDocService.sendWithMessage(params.documentId, params.subject, params.message);
    return { delivery: 'pandadoc', shareLink };
  }

  console.log(
    `[PandaDoc CRM delivery] Sent via CRM From="${fromName}" <${fromEmail}> to=${params.recipientEmail}`,
  );
  return { delivery: 'crm', shareLink };
}
