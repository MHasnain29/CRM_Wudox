import { Prisma } from '@prisma/client';
import prisma from '../config/database';

export type EmailSendStatus = 'pending' | 'queued' | 'accepted' | 'failed';

export async function hasEmailRecipientAcceptance(emailId: string, recipientEmails: string[]): Promise<boolean> {
  const addresses = [...new Set(recipientEmails.map((s) => s.trim().toLowerCase()))];
  if (!addresses.length) return false;
  const accepted = await prisma.emailRecipient.findMany({
    where: { emailId, sendStatus: 'accepted', sentAt: { not: null } },
    select: { emailAddress: true },
  });
  const acceptedAddresses = new Set(accepted.map((r) => r.emailAddress.toLowerCase()));
  return addresses.every((address) => acceptedAddresses.has(address));
}

export function summarizeEmailSendEvidence(recipients: Array<{ sendStatus: string | null; sentAt: Date | null }>): {
  sendStatus: EmailSendStatus;
  sentAt: Date | null;
} {
  const accepted = recipients.filter((r) => r.sendStatus === 'accepted' && r.sentAt);
  if (accepted.length) {
    return { sendStatus: 'accepted', sentAt: new Date(Math.min(...accepted.map((r) => r.sentAt!.getTime()))) };
  }
  if (recipients.some((r) => r.sendStatus === 'queued')) return { sendStatus: 'queued', sentAt: null };
  if (!recipients.length || recipients.some((r) => !r.sendStatus || r.sendStatus === 'pending')) {
    return { sendStatus: 'pending', sentAt: null };
  }
  return { sendStatus: 'failed', sentAt: null };
}

/**
 * Provider-accepted is not delivered. A message counts once after its first accepted
 * recipient; recipient-level rows retain partial failures and later queued sends.
 * Accepted evidence is monotonic: retries cannot erase it or move its timestamp.
 */
export async function recordEmailSendOutcome(input: {
  emailId: string;
  recipientEmails: string[];
  status: EmailSendStatus;
  at?: Date;
  onlyPending?: boolean;
}): Promise<void> {
  if (!input.recipientEmails.length) return;
  const at = input.at ?? new Date();
  const addresses = [...new Set(input.recipientEmails.map((s) => s.trim().toLowerCase()))];
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM emails WHERE id = ${input.emailId} FOR UPDATE`);
    // The mailbox row can have been deleted while a queued message was pending.
    const existing = await tx.email.findUnique({ where: { id: input.emailId }, select: { id: true } });
    if (!existing) return;
    await tx.emailRecipient.updateMany({
      where: {
        emailId: input.emailId,
        AND: [
          { OR: addresses.map((emailAddress) => ({ emailAddress: { equals: emailAddress, mode: 'insensitive' as const } })) },
          input.onlyPending
            ? { OR: [{ sendStatus: null }, { sendStatus: 'pending' }] }
            : { OR: [{ sendStatus: null }, { sendStatus: { not: 'accepted' } }] },
        ],
      },
      data: { sendStatus: input.status, sentAt: input.status === 'accepted' ? at : null },
    });
    const recipients = await tx.emailRecipient.findMany({
      where: { emailId: input.emailId },
      select: { sendStatus: true, sentAt: true },
    });
    await tx.email.update({ where: { id: input.emailId }, data: summarizeEmailSendEvidence(recipients) });
  });
}

/** Evidence errors must not turn an already accepted provider send into a resend. */
export async function recordEmailSendOutcomeBestEffort(input: Parameters<typeof recordEmailSendOutcome>[0]): Promise<void> {
  try {
    await recordEmailSendOutcome(input);
  } catch (err) {
    console.error('[emailSendEvidence] Could not record outcome', { emailId: input.emailId, status: input.status }, err);
  }
}
