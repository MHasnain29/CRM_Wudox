/**
 * Send Active Client required-training email (PDF attachment).
 * Uses the shared CRM email chrome + Agency Email Signature (same as compose/proposal).
 * Isolated from Ontario/WHMIS standalone training emails.
 */
import {
  buildEmail,
  tplDivider,
  sendClientEmail,
  type AgencyBranding,
  type SentEmailContent,
} from './email';
import { resolveSenderSignatureBlock } from './sender';
import { DEFAULT_BRAND_NAME } from '../config/branding';

export async function sendActiveClientTrainingEmail(params: {
  toEmail: string;
  employeeName: string;
  clientName: string;
  sentByName: string;
  /** Linking user — resolves personal + agency email signature. */
  sentByUserId: string;
  from: { email: string; name: string };
  agency?: AgencyBranding;
  subCompanyId: string;
  attachment: { contentBase64: string; filename: string; mimeType: string };
}): Promise<SentEmailContent> {
  const clientName = params.clientName.trim() || 'the client';
  const agencyLabel = params.agency?.name ?? DEFAULT_BRAND_NAME;
  const subject = `Required client training — ${clientName}`;
  const fileName = params.attachment.filename || 'client-training.pdf';

  const sig = await resolveSenderSignatureBlock(
    params.sentByUserId,
    params.sentByName,
    agencyLabel,
    params.agency?.emailSignatureTemplate,
    {
      email: params.from.email,
      logoUrl: params.agency?.logoUrl,
      tagline: params.agency?.emailTagline,
      subCompanyId: params.subCompanyId,
    },
  );

  // Centered document card — Gmail still lists the real PDF at the bottom of the
  // message, so this block is the in-body cue so users know what to open.
  const documentCard = `
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:8px 0 20px">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" width="100%" style="max-width:420px;background:#fffbeb;border:2px solid #f59e0b;border-radius:12px">
            <tr>
              <td align="center" style="padding:22px 20px 10px">
                <div style="font-size:36px;line-height:1">📄</div>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 20px 6px">
                <div style="font-size:11px;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;color:#b45309">
                  Your training document
                </div>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 20px 10px">
                <div style="font-size:15px;font-weight:700;color:#111827;word-break:break-word">
                  ${escapeHtml(fileName)}
                </div>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 20px 20px">
                <div style="display:inline-block;background:#ca8a04;color:#ffffff;font-size:12px;font-weight:700;padding:8px 14px;border-radius:999px">
                  📎 Attached to this email — open the PDF below
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  const body = `
    <p style="margin:0 0 10px;text-align:center">
      Hi <strong>${escapeHtml(params.employeeName)}</strong>,
    </p>
    <p style="margin:0 0 18px;text-align:center;color:#374151">
      <strong>${escapeHtml(params.sentByName)}</strong> sent required training from
      <strong>${escapeHtml(clientName)}</strong>.
    </p>
    ${documentCard}
    <p style="margin:0 0 6px;text-align:center;font-size:14px;color:#374151">
      Please open the attached PDF, complete it, and return the
      <strong>signed</strong> copy to your recruiter.
    </p>
    <p style="margin:0 0 18px;text-align:center;font-size:12px;color:#6b7280">
      Tip: look for the PDF attachment at the bottom of this email.
    </p>
    ${tplDivider()}
    ${sig.html}
  `;

  const text = [
    `Hi ${params.employeeName},`,
    '',
    `${params.sentByName} sent required training from ${clientName}.`,
    '',
    `YOUR TRAINING DOCUMENT (attached): ${fileName}`,
    'Open the PDF attached to this email, complete it, and return the signed copy to your recruiter.',
    '',
    `— ${agencyLabel}`,
  ].join('\n');

  const html = buildEmail({
    headerColor: '#ca8a04',
    headerIcon: '🎓',
    headerTitle: 'Required client training',
    headerSubtitle: escapeHtml(clientName),
    body,
    agency: params.agency,
  });

  const sent = await sendClientEmail({
    to: [{ email: params.toEmail, name: params.employeeName }],
    from: params.from,
    subject,
    text,
    html,
    subCompanyId: params.subCompanyId,
    attachments: [
      // Keep the training PDF first so clients surface it ahead of signature images.
      {
        content: params.attachment.contentBase64,
        filename: fileName,
        type: params.attachment.mimeType || 'application/pdf',
        disposition: 'attachment',
      },
      ...sig.inlineAttachments,
    ],
  });

  if (!sent) {
    throw Object.assign(
      new Error('Training email was not sent (SendGrid not configured).'),
      { status: 502 },
    );
  }
  return { subject, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
