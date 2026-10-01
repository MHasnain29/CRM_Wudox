import { z } from 'zod';

export const reportRecipientEmail = z.string().trim().toLowerCase().email().max(254);

// SendGrid permits 1,000 recipients per request, including the primary To address.
// https://www.twilio.com/docs/sendgrid/api-reference/mail-send/errors
export const MAX_REPORT_CC_EMAILS = 999;

export function normalizeReportCcEmails(value: unknown, recipientEmail?: string | null): string[] {
  const parsed = z.array(reportRecipientEmail).safeParse(value === undefined ? [] : value);
  if (!parsed.success) throw Object.assign(new Error('Enter valid CC email addresses.'), { status: 400, definiteFailure: true });
  const to = recipientEmail?.trim().toLowerCase();
  const emails = [...new Set(parsed.data)].filter(email => email !== to);
  if (emails.length > MAX_REPORT_CC_EMAILS) {
    throw Object.assign(new Error(`Daily reports support up to ${MAX_REPORT_CC_EMAILS} CC addresses plus the recipient email.`), { status: 400, definiteFailure: true });
  }
  return emails;
}

/** A different ordering or casing does not change the authorized destination set. */
export function sameReportCcEmails(current: unknown, saved: unknown, recipientEmail: string): boolean {
  try {
    const currentEmails = normalizeReportCcEmails(current, recipientEmail);
    const savedEmails = normalizeReportCcEmails(saved, recipientEmail);
    const savedSet = new Set(savedEmails);
    return currentEmails.length === savedEmails.length && currentEmails.every(email => savedSet.has(email));
  } catch { return false; }
}
