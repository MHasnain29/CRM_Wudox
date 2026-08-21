/**
 * Shared logic for sending an email campaign via SendGrid.
 * Called by both the manual /send endpoint and the campaign scheduler job.
 */
import sgMail from '@sendgrid/mail';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import prisma from '../config/database';
import { env } from '../config/env';
import { resolveEmailSender, buildCrmReplyToAddress } from './email';
import { isSenderDomainError } from './senderDomainErrors';
import { resolveSenderSignatureBlock, injectSenderSignature, toSendGridFrom } from './sender';
import { shouldSendNow } from './emailSendWindow';
import { recomputeCampaignStats } from './campaignStats';
import { DEFAULT_BRAND_NAME } from '../config/branding';

const SEND_BATCH_SIZE = 100;

const UNSUB_FOOTER = `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;text-align:center;font-family:sans-serif">
  You received this email because you are in our mailing list.<br>
  <a href="{{unsubscribe_url}}" style="color:#6b7280;text-decoration:underline">Unsubscribe</a>
</div>`;

if (env.SENDGRID_API_KEY) sgMail.setApiKey(env.SENDGRID_API_KEY);

type TemplateVars = Record<string, string>;

function renderTemplateWithVars(input: string, vars: TemplateVars): string {
  return input.replace(/\{\{\s*([a-zA-Z0-9_\- ]+)\s*\}\}/g, (_match, rawKey: string) => {
    const normalizedKey = rawKey.trim().toLowerCase().replace(/[\s-]+/g, '_');
    return vars[normalizedKey] ?? '';
  });
}

function stripEmptyAgencyFooter(html: string): string {
  // When agency_footer is absent/empty, remove the entire <tr> if its <td> became empty,
  // matching all footer patterns (single-p, multi-p, proposal separator).
  let out = html.replace(/\{\{agency_footer\}\}\s*[·\-–—•]\s*/g, '');
  out = out.replace(/\{\{agency_footer\}\}/g, '');
  out = out.replace(/<p[^>]*>\s*<\/p>/g, '');
  out = out.replace(/<tr>\s*<td[^>]*>\s*<\/td>\s*<\/tr>/g, '');
  return out;
}

function buildTemplateVars(opts: {
  contactName?: string;
  companyName?: string;
  agencyName?: string;
  agencyFooterText?: string | null;
  unsubscribeUrl?: string;
  emailFromAddress?: string | null;
  emailFromName?: string | null;
}): TemplateVars {
  const senderName = opts.emailFromName || opts.agencyName || `${DEFAULT_BRAND_NAME} Team`;
  const senderEmail = opts.emailFromAddress || '';
  const senderTitle = opts.agencyName ? `${opts.agencyName} Team` : 'Staffing Team';
  const senderPhone = 'N/A';
  const contactName = opts.contactName ?? '';
  const companyName = opts.companyName ?? '';
  const agencyName = opts.agencyName ?? '';
  const formattedDate = new Date().toLocaleDateString('en-US', { dateStyle: 'long' });

  return {
    contact_name: contactName,
    company_name: companyName,
    agency_name: agencyName,
    date: formattedDate,
    sender_name: senderName,
    sender_email: senderEmail,
    sender_title: senderTitle,
    sender_phone: senderPhone,
    agency_footer: opts.agencyFooterText?.trim() ?? '',
    unsubscribe_url: opts.unsubscribeUrl ?? '',
    // Aliases for compatibility with older/custom templates
    contact: contactName,
    client_name: companyName,
    company: companyName,
    sender: senderName,
    from_name: senderName,
    from_email: senderEmail,
    current_date: formattedDate,
  };
}

export async function sendCampaignById(campaignId: string): Promise<{
  success: boolean;
  sentCount: number;
  failedCount: number;
  totalRecipients: number;
  error?: string;
  code?: string;
}> {
  if (!env.SENDGRID_API_KEY) {
    return { success: false, sentCount: 0, failedCount: 0, totalRecipients: 0, error: 'Email not configured' };
  }

  const campaign = await prisma.emailCampaign.findUnique({
    where: { id: campaignId },
    include: { subCompany: { select: { name: true, emailFooterText: true, emailSignatureTemplate: true, emailTagline: true, emailFromAddress: true, emailFromName: true } } },
  });
  if (!campaign) return { success: false, sentCount: 0, failedCount: 0, totalRecipients: 0, error: 'Not found' };

  let resolved;
  try {
    resolved = await resolveEmailSender(campaign.createdById, campaign.subCompanyId);
  } catch (err) {
    if (isSenderDomainError(err)) {
      return { success: false, sentCount: 0, failedCount: 0, totalRecipients: 0, error: err.message, code: err.code };
    }
    throw err;
  }
  if (!resolved?.from.email) {
    return { success: false, sentCount: 0, failedCount: 0, totalRecipients: 0, error: 'No From address configured for this agency' };
  }
  const sender = resolved.from;
  const agency = resolved.agency;

  if (!['draft', 'scheduled'].includes(campaign.status)) {
    return { success: false, sentCount: 0, failedCount: 0, totalRecipients: 0, error: 'Already sent or sending' };
  }

  const decision = await shouldSendNow(campaign.subCompanyId, campaign.scheduledDate);
  if (!decision.allow) {
    await prisma.emailCampaign.update({
      where: { id: campaignId },
      data: { status: 'scheduled', scheduledDate: decision.nextEligibleAt },
    });
    return {
      success: true,
      sentCount: 0,
      failedCount: 0,
      totalRecipients: 0,
      error: 'Campaign queued until allowed send window',
    };
  }

  // Mark as sending so scheduler doesn't pick it up twice
  await prisma.emailCampaign.update({ where: { id: campaignId }, data: { status: 'sending' } });

  // Fetch clients: if listId matches a real MailingList, use its members; otherwise fall back to all agency clients
  const mailingList = await prisma.mailingList.findFirst({
    where: { id: campaign.listId, subCompanyId: campaign.subCompanyId },
  });

  // Contact-level filter: skip unsubscribed, bounced, and invalid emails
  const validContactFilter = {
    email: { not: null },
    isUnsubscribed: false,
    emailBounced: false,
    emailInvalid: false,
  } as const;

  let clientsWithContacts: {
    client: {
      id: string;
      name: string;
      contacts: { id: string; name: string; email: string | null; isPrimary: boolean }[];
    };
  }[];

  if (mailingList) {
    // Send only to clients in this mailing list, excluding those unsubscribed for this agency
    const members = await prisma.mailingListClient.findMany({
      where: {
        listId: mailingList.id,
        client: {
          clientSubCompanies: {
            none: { subCompanyId: campaign.subCompanyId, status: 'unsubscribed' },
          },
        },
      },
      select: {
        client: {
          select: {
            id: true,
            name: true,
            contacts: {
              where: validContactFilter,
              select: { id: true, name: true, email: true, isPrimary: true },
              orderBy: { isPrimary: 'desc' },
            },
          },
        },
      },
    });
    clientsWithContacts = members;
  } else {
    // Fallback: all agency clients excluding unsubscribed
    clientsWithContacts = await prisma.clientSubCompany.findMany({
      where: { subCompanyId: campaign.subCompanyId, status: { not: 'unsubscribed' } },
      select: {
        client: {
          select: {
            id: true,
            name: true,
            contacts: {
              where: validContactFilter,
              select: { id: true, name: true, email: true, isPrimary: true },
              orderBy: { isPrimary: 'desc' },
            },
          },
        },
      },
    });
  }

  const recipients: { clientId: string; clientName: string; contactName: string; email: string; contactId: string }[] = [];
  // Deduplicate by email address (same email may appear on multiple contacts)
  const seenEmails = new Set<string>();
  for (const row of clientsWithContacts) {
    for (const contact of row.client.contacts) {
      if (!contact.email) continue;
      const emailKey = `${row.client.id}::${contact.email.toLowerCase()}`;
      if (seenEmails.has(emailKey)) continue;
      seenEmails.add(emailKey);
      recipients.push({
        clientId: row.client.id,
        clientName: row.client.name,
        contactName: contact.name?.trim() || row.client.name,
        email: contact.email,
        contactId: contact.id,
      });
    }
  }

  if (recipients.length === 0) {
    await prisma.emailCampaign.update({ where: { id: campaignId }, data: { status: 'failed' } });
    return { success: false, sentCount: 0, failedCount: 0, totalRecipients: 0, error: 'No clients with emails' };
  }

  // Create recipient records
  const recipientRows = await prisma.$transaction(
    recipients.map((r) =>
      prisma.emailCampaignRecipient.create({
        data: { campaignId, clientId: r.clientId, clientName: r.clientName, email: r.email, status: 'pending' },
      })
    )
  );

  // Build signature block once — same for every recipient in the campaign
  const signatureResolved = await resolveSenderSignatureBlock(
    campaign.createdById,
    sender.name,
    agency?.name ?? '',
    agency?.emailSignatureTemplate,
    {
      email: sender.email,
      logoUrl: agency?.logoUrl,
      tagline: agency?.emailTagline,
      subCompanyId: campaign.subCompanyId,
    },
  );
  const sigBlock = signatureResolved.html;
  const sigInlineAttachments = signatureResolved.inlineAttachments;

  // Body template with unsubscribe footer appended once (footer contains {{unsubscribe_url}})
  const bodyWithFooter = campaign.body + UNSUB_FOOTER;

  // Build SendGrid messages
  const messages = recipientRows.map((row, idx) => {
    const recipient = recipients[idx];
    const unsubToken = jwt.sign(
      { contactId: recipient?.contactId, email: row.email, campaignId: campaign.id },
      env.JWT_SECRET,
      { expiresIn: '90d' }
    );
    const unsubscribeUrl = `${env.APP_URL}/api/v1/unsubscribe?token=${unsubToken}`;
    const vars = buildTemplateVars({
      contactName: recipient?.contactName,
      companyName: recipient?.clientName,
      agencyName: campaign.subCompany?.name,
      agencyFooterText: [campaign.subCompany?.emailFooterText?.trim(), campaign.subCompany?.emailTagline?.trim()].filter(Boolean).join(' · ') || undefined,
      unsubscribeUrl,
      emailFromAddress: sender.email,
      emailFromName: sender.name,
    });

    const agencyFooter = [campaign.subCompany?.emailFooterText?.trim(), campaign.subCompany?.emailTagline?.trim()].filter(Boolean).join(' · ');
    let renderedHtml = agencyFooter
      ? renderTemplateWithVars(bodyWithFooter, vars)
      : stripEmptyAgencyFooter(renderTemplateWithVars(bodyWithFooter, vars));

    renderedHtml = injectSenderSignature(renderedHtml, sigBlock);

    const replyTo = campaign.createdById
      ? buildCrmReplyToAddress(row.id, campaign.createdById, agency)
      : sender.email;
    return {
      to: row.email,
      from: toSendGridFrom({ email: sender.email, name: sender.name }),
      replyTo,
      subject: renderTemplateWithVars(campaign.subject, vars),
      html: renderedHtml,
      categories: [campaign.id],
      customArgs: { campaign_id: campaign.id, recipient_id: row.id },
      trackingSettings: {
        clickTracking: { enable: true, enableText: false },
        openTracking: { enable: true },
      },
      ...(sigInlineAttachments.length
        ? {
            attachments: sigInlineAttachments.map((a) => ({
              content: a.content,
              filename: a.filename,
              type: a.type,
              disposition: a.disposition,
              content_id: a.contentId,
            })),
          }
        : {}),
    };
  });

  let sentCount = 0;
  let failedCount = 0;

  const sentAt = new Date();

  // Collect successful sends to batch-create Email records (Sent box visibility).
  const sentEmailRows: Array<{
    emailId: string;
    recipientIdx: number;
    renderedSubject: string;
  }> = [];

  // Send in chunks. Within a chunk, use Promise.allSettled so one bad address
  // doesn't roll back the rest (the previous batch+fallback double-sent).
  for (let i = 0; i < messages.length; i += SEND_BATCH_SIZE) {
    const chunk = messages.slice(i, i + SEND_BATCH_SIZE);
    const chunkIds = recipientRows.slice(i, i + SEND_BATCH_SIZE).map((r) => r.id);
    const results = await Promise.allSettled(chunk.map((m) => sgMail.send(m as any)));

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const recipientId = chunkIds[j];
      if (result.status === 'fulfilled') {
        sentCount++;
        sentEmailRows.push({
          emailId: randomUUID(),
          recipientIdx: i + j,
          renderedSubject: (messages[i + j] as any).subject ?? campaign.subject,
        });
        await prisma.emailCampaignRecipient.update({
          where: { id: recipientId },
          data: { status: 'sent', sentAt },
        }).catch(() => {});
      } else {
        failedCount++;
        const reason = result.reason as { message?: string } | undefined;
        const errorMsg = (reason?.message ?? 'Send failed').slice(0, 500);
        await prisma.emailCampaignRecipient.update({
          where: { id: recipientId },
          data: {
            status: 'failed',
            errorMessage: errorMsg,
            failureReason: errorMsg,
          },
        }).catch(() => {});
      }
    }
  }

  // Batch-create Email records so campaign sends appear in the Sent box.
  if (sentEmailRows.length > 0 && campaign.createdById) {
    await prisma.email.createMany({
      data: sentEmailRows.map(({ emailId, recipientIdx, renderedSubject }) => ({
        id: emailId,
        fromUserId: campaign.createdById!,
        fromName: sender.name,
        fromEmail: sender.email,
        subject: renderedSubject,
        body: campaign.body,
        folder: 'sent' as const,
        clientId: recipientRows[recipientIdx].clientId,
        subCompanyId: campaign.subCompanyId,
        timestamp: sentAt,
      })),
      skipDuplicates: true,
    }).catch((e) => console.error('[campaign] Failed to create Email sent records:', e));

    await prisma.emailRecipient.createMany({
      data: sentEmailRows.map(({ emailId, recipientIdx }) => ({
        emailId,
        recipientType: 'to',
        emailAddress: recipientRows[recipientIdx].email,
        name: recipients[recipientIdx]?.contactName ?? recipientRows[recipientIdx].clientName,
        clientId: recipientRows[recipientIdx].clientId,
        contactId: recipients[recipientIdx]?.contactId ?? null,
      })),
      skipDuplicates: true,
    }).catch((e) => console.error('[campaign] Failed to create EmailRecipient records:', e));
  }

  const finalStatus = sentCount === 0 ? 'failed' : 'sent';

  await prisma.emailCampaign.update({
    where: { id: campaignId },
    data: {
      status: finalStatus,
      sentAt,
      totalRecipients: recipients.length,
    },
  });

  await recomputeCampaignStats(campaignId).catch(() => {});

  return { success: true, sentCount, failedCount, totalRecipients: recipients.length };
}
