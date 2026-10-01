import { z } from 'zod';

/** Same rules as reportRecipientEmail in backend/services/dailyReportAddresses.ts. */
export const reportEmailSchema = z.string().trim().toLowerCase().email().max(254);
// Keep aligned with the SendGrid limit in backend/services/dailyReportAddresses.ts.
export const MAX_REPORT_CC_EMAILS = 999;

/** Also used on Save so an address still being typed is not silently discarded. */
export function prepareReportCcEmails(saved: readonly string[] = [], input = '', recipientEmail?: string | null): string[] {
  const pending = input.split(/[,;\r\n]+/).map(email => email.trim()).filter(Boolean);
  const emails = [...saved, ...pending].map(email => {
    const parsed = reportEmailSchema.safeParse(email);
    if (!parsed.success) throw new Error(`Enter a valid CC email address: ${email}`);
    return parsed.data;
  });
  const normalized = [...new Set(emails)].filter(email => email !== recipientEmail?.trim().toLowerCase());
  if (normalized.length > MAX_REPORT_CC_EMAILS) {
    throw new Error(`Daily reports support up to ${MAX_REPORT_CC_EMAILS} CC addresses plus the recipient email.`);
  }
  return normalized;
}
