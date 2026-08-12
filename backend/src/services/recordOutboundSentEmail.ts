/**
 * Best-effort CRM Sent mailbox writer for user-triggered business emails.
 * Isolated from compose / campaigns / system notifications — call only after
 * a successful provider send from the specific business flows that lack Sent rows.
 */
import prisma from '../config/database';
import { emitToUsers } from '../socket';

export type OutboundSentRecipient = {
  name?: string | null;
  email: string;
  clientId?: string | null;
  contactId?: string | null;
};

export type RecordOutboundSentEmailParams = {
  fromUserId: string;
  /** Real JWT actor when sending on behalf of fromUserId (act-as / reply-as). */
  sentByUserId?: string | null;
  fromName: string;
  fromEmail: string;
  subject: string;
  body: string;
  subCompanyId: string;
  to: OutboundSentRecipient[];
  clientId?: string | null;
  leadId?: string | null;
  /** Log label only — not persisted (no schema change). */
  source?: string;
};

/**
 * Creates Email(folder='sent') + recipients for the mailbox owner.
 * Never throws into the caller — delivery already succeeded.
 */
export async function recordOutboundSentEmail(
  params: RecordOutboundSentEmailParams,
): Promise<{ id: string } | null> {
  const to = params.to
    .map((r) => ({
      name: (r.name ?? '').trim() || null,
      email: r.email.trim(),
      clientId: r.clientId ?? null,
      contactId: r.contactId ?? null,
    }))
    .filter((r) => r.email);

  if (!params.fromUserId || !params.subCompanyId || to.length === 0) {
    console.warn(
      `[recordOutboundSentEmail] skip${params.source ? ` (${params.source})` : ''}: missing owner, agency, or recipients`,
    );
    return null;
  }

  const subject = (params.subject || '(No subject)').slice(0, 500);
  const body = params.body ?? '';
  const fromName = (params.fromName || '').trim() || params.fromEmail || 'NA Staffing CRM';
  const fromEmail = (params.fromEmail || '').trim();

  try {
    const emailRecord = await prisma.email.create({
      data: {
        fromUserId: params.fromUserId,
        sentByUserId: params.sentByUserId ?? null,
        fromName,
        fromEmail,
        subject,
        body,
        folder: 'sent',
        clientId: params.clientId ?? null,
        leadId: params.leadId ?? null,
        subCompanyId: params.subCompanyId,
        isRead: true,
        recipients: {
          create: to.map((r) => ({
            recipientType: 'to' as const,
            name: r.name,
            emailAddress: r.email,
            clientId: r.clientId,
            contactId: r.contactId,
          })),
        },
      },
      select: { id: true },
    });

    emitToUsers([params.fromUserId], 'email:refresh', {
      subCompanyId: params.subCompanyId,
    });

    return { id: emailRecord.id };
  } catch (err) {
    console.error(
      `[recordOutboundSentEmail] Failed to save sent record${params.source ? ` (${params.source})` : ''}:`,
      err,
    );
    return null;
  }
}
