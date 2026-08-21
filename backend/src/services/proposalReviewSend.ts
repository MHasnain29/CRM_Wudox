/**
 * Send one review-only PDF email for a proposal.
 * Used by Temp-only / Direct-only and by Both pairs (called twice).
 */
import { randomUUID } from 'crypto';
import prisma from '../config/database';
import { sendReviewEmailToClient, getAgencyBranding, buildCrmReplyToAddress } from './email';
import { resolveUserSender } from './sender';
import type { ProposalPrefill } from './pandadoc';
import { generateProposalPreviewPdf } from './proposalPreviewPdf';
import { renderReviewPdf } from './reviewPdf';
import { uploadToR2, getFromR2 } from './r2Storage';
import { emitToUsers } from '../socket';
import { env } from '../config/env';
import { DEFAULT_BRAND_NAME } from '../config/branding';

async function resolveReviewTemplateId(
  subCompanyId: string,
  types: string[],
  stampedTemplateId?: string | null,
): Promise<string | null> {
  if (stampedTemplateId) {
    const stamped = await prisma.reviewTemplate.findFirst({
      where: { id: stampedTemplateId, subCompanyId },
      select: { id: true },
    });
    if (stamped) return stamped.id;
  }
  const hasTemp = types.includes('temp');
  const hasDirect = types.some((t) => t.startsWith('direct'));
  const slot = hasTemp && hasDirect ? 'both_agreement' : hasTemp ? 'temp_agreement' : 'direct_placement';
  const tpl = await prisma.reviewTemplate.findFirst({
    where: { subCompanyId, documentType: slot, isActive: true },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  });
  return tpl?.id ?? null;
}

export async function sendReviewEmailForProposal(opts: {
  proposalId: string;
  /** When set, customizes subject/heading (Both pair). Omit for legacy single-doc copy. */
  documentLabel?: string;
  /** Attach agency default files (plan: only Temp sibling for Both pairs). */
  includeDefaultFiles?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const { proposalId, documentLabel, includeDefaultFiles = true } = opts;

  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    include: {
      lead: {
        include: {
          owner: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              sendAsEmail: true,
              sendAsDisabled: true,
            },
          },
          client: {
            select: {
              id: true,
              name: true,
              industry: true,
              location: true,
              address: true,
              companySize: true,
            },
          },
          subCompany: { select: { id: true, name: true } },
        },
      },
      selectedContact: {
        select: { id: true, name: true, email: true, title: true, phone: true, isUnsubscribed: true },
      },
      selectedDefaultFiles: { select: { id: true, name: true, fileUrl: true, mimeType: true } },
    },
  });

  if (!proposal) return { ok: false, error: 'Proposal not found' };
  const contact = proposal.selectedContact;
  if (!contact?.email || contact.isUnsubscribed) {
    return { ok: false, error: 'No valid contact email' };
  }

  const ownerName =
    `${proposal.lead.owner.firstName ?? ''} ${proposal.lead.owner.lastName ?? ''}`.trim() ||
    proposal.lead.owner.email;
  const agency = await getAgencyBranding(proposal.lead.subCompanyId);
  const agencySystemSender = {
    email: agency?.emailFromAddress ?? '',
    name: agency?.emailFromName ?? agency?.name ?? DEFAULT_BRAND_NAME,
  };
  const ownerSender = resolveUserSender(
    proposal.lead.owner,
    agency?.emailSendAsDomain ?? null,
    agencySystemSender,
    env.SEND_AS_OVERRIDE_EMAIL,
  );

  const now = new Date();
  const nameParts = (contact.name ?? '').trim().split(/\s+/);
  const primarySigningAuth = await prisma.signingAuthority.findFirst({
    where: { subCompanyId: proposal.lead.subCompanyId, isPrimary: true },
    select: { name: true },
  });

  const prefill: ProposalPrefill = {
    client: {
      name: proposal.lead.client.name ?? '',
      industry: proposal.lead.client.industry ?? '',
      location: proposal.lead.client.location ?? '',
      address: proposal.lead.client.address ?? '',
      companySize: proposal.lead.client.companySize ?? '',
    },
    contact: {
      name: contact.name ?? '',
      firstName: nameParts[0] ?? '',
      lastName: nameParts.slice(1).join(' ') || (nameParts[0] ?? ''),
      title: contact.title ?? '',
      email: contact.email ?? '',
      phone: contact.phone ?? '',
    },
    sender: {
      name: ownerName,
      firstName: proposal.lead.owner.firstName ?? '',
      lastName: proposal.lead.owner.lastName ?? '',
      email: proposal.lead.owner.email ?? '',
      phone: proposal.lead.owner.phone ?? '',
    },
    agency: { name: proposal.lead.subCompany?.name ?? '' },
    lead: {
      value: proposal.lead.value ? String(proposal.lead.value) : '',
      stage: proposal.lead.stage ?? '',
    },
    date: {
      today: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      year: String(now.getFullYear()),
    },
    proposal: {
      paymentDays: (proposal.paymentTerms as string)?.match(/\d+/)?.[0] ?? '',
      paymentTermsLabel: (proposal.paymentTerms as string)?.replace('net_', 'Net ') ?? '',
      minimumHours: proposal.tempMinimumHours != null ? String(proposal.tempMinimumHours) : '',
      billingRate: (() => {
        if ((proposal.agreementTypes as string[]).includes('temp') && proposal.tempPricingValue != null) {
          const v = Number(proposal.tempPricingValue);
          return proposal.tempPricingType === 'markup' ? `${v}%` : `$${v}/hr`;
        }
        if (
          (proposal.agreementTypes as string[]).some((t) => t.startsWith('direct')) &&
          proposal.directPricingValue != null
        ) {
          const v = Number(proposal.directPricingValue);
          return proposal.directPricingType === 'percentage' || proposal.directPricingType === 'markup'
            ? `${v}%`
            : `$${v}`;
        }
        return '';
      })(),
      agreementTypeLabel: (proposal.agreementTypes as string[])
        .map((t) => (t === 'temp' ? 'Temp / Temp to Permanent' : 'Direct Placement'))
        .join(', '),
    },
    signingAuthority: primarySigningAuth ? { name: primarySigningAuth.name } : undefined,
  };

  let pdfBuffer: Buffer | undefined;
  try {
    const templateId = await resolveReviewTemplateId(
      proposal.lead.subCompanyId,
      proposal.agreementTypes as string[],
      proposal.reviewTemplateId,
    );
    const rendered = await renderReviewPdf(prefill, { templateId: templateId ?? undefined });
    if (rendered) pdfBuffer = rendered;
  } catch (err) {
    console.warn('[sendReviewEmailForProposal] PDF render failed:', err);
  }
  if (!pdfBuffer) {
    try {
      pdfBuffer = await generateProposalPreviewPdf(prefill);
    } catch (err) {
      console.warn('[sendReviewEmailForProposal] Fallback PDF failed:', err);
    }
  }

  const defaultFileAttachments: { name: string; buffer: Buffer; mimeType: string }[] = [];
  if (includeDefaultFiles) {
    for (const f of proposal.selectedDefaultFiles) {
      try {
        let buf: Buffer;
        if (f.fileUrl.startsWith('http://') || f.fileUrl.startsWith('https://')) {
          const fileRes = await fetch(f.fileUrl);
          if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
          buf = Buffer.from(await fileRes.arrayBuffer());
        } else {
          const r2Result = await getFromR2(f.fileUrl);
          if (!r2Result) throw new Error('File not found in R2');
          buf = r2Result.body;
        }
        defaultFileAttachments.push({
          name: f.name,
          buffer: buf,
          mimeType: f.mimeType ?? 'application/octet-stream',
        });
      } catch (err) {
        console.warn(`[sendReviewEmailForProposal] Could not fetch default file "${f.name}":`, err);
      }
    }
  }

  const reviewEmailId = randomUUID();
  const reviewReplyTo = buildCrmReplyToAddress(reviewEmailId, proposal.lead.ownerId, agency);

  try {
    const { html: sentHtml } = await sendReviewEmailToClient({
      contactEmail: contact.email!,
      contactName: contact.name,
      clientCompanyName: proposal.lead.client.name,
      senderName: ownerName,
      clientMessage: proposal.clientMessage,
      agency,
      pdfBuffer,
      defaultFileAttachments,
      from: ownerSender,
      fromUserId: proposal.lead.owner.id,
      subCompanyId: proposal.lead.subCompanyId,
      replyTo: { email: reviewReplyTo, name: ownerName },
      documentLabel,
    });

    const attachmentRecords: { filename: string; fileKey: string; mimeType: string; size: number }[] = [];
    if (pdfBuffer) {
      try {
        const pdfKey = `review-emails/${proposal.id}/agreement-review.pdf`;
        await uploadToR2(pdfKey, pdfBuffer, 'application/pdf');
        attachmentRecords.push({
          filename: documentLabel?.toLowerCase().includes('direct')
            ? 'direct-placement-agreement-review.pdf'
            : documentLabel?.toLowerCase().includes('temp')
              ? 'temporary-staffing-agreement-review.pdf'
              : 'agreement-review.pdf',
          fileKey: pdfKey,
          mimeType: 'application/pdf',
          size: pdfBuffer.length,
        });
      } catch (e) {
        console.warn('[sendReviewEmailForProposal] PDF R2 upload failed:', e);
      }
    }

    for (const att of defaultFileAttachments) {
      try {
        const safeName = att.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const docKey = `review-emails/${proposal.id}/supporting/${Date.now()}-${safeName}`;
        await uploadToR2(docKey, att.buffer, att.mimeType);
        attachmentRecords.push({
          filename: att.name,
          fileKey: docKey,
          mimeType: att.mimeType,
          size: att.buffer.length,
        });
      } catch (e) {
        console.warn(`[sendReviewEmailForProposal] Supporting doc upload failed:`, e);
      }
    }

    const subject = documentLabel
      ? `${documentLabel} — ${proposal.lead.client.name}`
      : `Agreement for Review — ${proposal.lead.client.name}`;

    try {
      await prisma.email.create({
        data: {
          id: reviewEmailId,
          fromUserId: proposal.lead.ownerId,
          fromName: ownerName,
          fromEmail: proposal.lead.owner.email ?? '',
          subject,
          body: sentHtml,
          folder: 'sent',
          clientId: proposal.lead.clientId,
          leadId: proposal.leadId,
          subCompanyId: proposal.lead.subCompanyId,
          isRead: true,
          recipients: {
            create: {
              recipientType: 'to',
              name: contact.name ?? '',
              emailAddress: contact.email!,
              contactId: proposal.selectedContactId ?? undefined,
            },
          },
          ...(attachmentRecords.length > 0 ? { attachments: { create: attachmentRecords } } : {}),
        },
      });
    } catch (e) {
      console.error('[sendReviewEmailForProposal] Failed to save sent email record:', e);
    }

    emitToUsers([proposal.lead.ownerId], 'email:refresh', { subCompanyId: proposal.lead.subCompanyId });

    await prisma.proposal.update({
      where: { id: proposal.id },
      data: { reviewEmailSentAt: new Date() },
    });

    return { ok: true };
  } catch (err) {
    console.error('[sendReviewEmailForProposal] send failed:', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Send failed' };
  }
}
