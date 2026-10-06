/**
 * Recover retained, explicitly correlated SendGrid events without resending emails.
 * Dry run by default. Dates are UTC, and --to is exclusive.
 *
 * npx tsx scripts/recoverPersonalEmailTracking.ts --from 2026-10-05 --to 2026-10-06
 * npx tsx scripts/recoverPersonalEmailTracking.ts --email-id <uuid> --apply
 * npx tsx scripts/recoverPersonalEmailTracking.ts --message-map ./reviewed-messages.json
 * Map JSON: [{"emailId":"...","recipientId":"...","providerMessageId":"..."}]
 * Review each association before using it; sender, subject, recipient and provider
 * processing time (within 60 seconds of accepted sentAt) are validated again.
 *
 * Recovery never marks old emails as fully tracked and never changes saved reports.
 * Generate a new daily-report preview after applying verified events.
 */
import '../src/loadEnv';
import { readFile } from 'node:fs/promises';
import prisma from '../src/config/database';
import { env } from '../src/config/env';
import { PERSONAL_EMAIL_EVENT_FIELDS, parseReviewedEmailMessageMap, SendGridEmailHistoryClient } from '../src/services/sendgridEmailHistory';

const HELP = 'Usage: npx tsx scripts/recoverPersonalEmailTracking.ts (--from <UTC-date> --to <UTC-date> | --email-id <id> [...] | --message-map <reviewed.json>) [--agency-id <id>] [--limit <1..100>] [--apply]';

function parseArguments(args: string[]) {
  const options: { from?: Date; to?: Date; emailIds: string[]; agencyId?: string; messageMapPath?: string; limit: number; apply: boolean } = {
    emailIds: [], limit: 30, apply: false,
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--apply') { options.apply = true; continue; }
    if (!['--from', '--to', '--email-id', '--agency-id', '--message-map', '--limit'].includes(argument)) throw new Error(HELP);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}. ${HELP}`);
    if (argument === '--email-id') options.emailIds.push(value);
    if (argument === '--agency-id') options.agencyId = value;
    if (argument === '--message-map') options.messageMapPath = value;
    if (argument === '--limit') {
      options.limit = Number(value);
      if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) throw new Error('--limit must be between 1 and 100.');
    }
    if (argument === '--from' || argument === '--to') {
      if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/.test(value)) throw new Error(`${argument} must be a UTC date or ISO timestamp ending in Z.`);
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) throw new Error(`Invalid ${argument} date.`);
      options[argument === '--from' ? 'from' : 'to'] = date;
    }
  }
  if (Boolean(options.from) !== Boolean(options.to)) throw new Error('--from and --to must be provided together.');
  if (!options.from && !options.emailIds.length && !options.messageMapPath) throw new Error(HELP);
  if (options.from && options.to && (options.to <= options.from || options.to.getTime() - options.from.getTime() > 31 * 86400_000)) {
    throw new Error('Date range must be positive and no more than 31 days.');
  }
  return options;
}

async function main() {
  if (process.argv.includes('--help')) { console.log(HELP); return; }
  const options = parseArguments(process.argv.slice(2));
  const mappings = options.messageMapPath
    ? parseReviewedEmailMessageMap(JSON.parse(await readFile(options.messageMapPath, 'utf8'))) : [];
  const selectedIds = options.emailIds.length ? options.emailIds : [...new Set(mappings.map(mapping => mapping.emailId))];
  const client = new SendGridEmailHistoryClient(env.SENDGRID_API_KEY ?? '');
  const targets = await prisma.email.findMany({
    where: {
      sendingKind: 'personal', sendStatus: 'accepted',
      ...(options.from && options.to ? { sentAt: { gte: options.from, lt: options.to } } : {}),
      ...(selectedIds.length ? { id: { in: selectedIds } } : {}),
      ...(options.agencyId ? { subCompanyId: options.agencyId } : {}),
    },
    select: { id: true, fromEmail: true, subject: true, recipients: { select: {
      id: true, emailAddress: true, sentAt: true, deliveredAt: true, openedAt: true, clickedAt: true, bouncedAt: true,
    } } },
    orderBy: [{ sentAt: 'asc' }, { id: 'asc' }], take: options.limit + 1,
  });
  if (targets.length > options.limit) throw new Error(`More than ${options.limit} emails match. Narrow the date/scope or increase --limit (maximum 100).`);
  for (const mapping of mappings) {
    if (!targets.some(target => target.id === mapping.emailId && target.recipients.some(recipient => recipient.id === mapping.recipientId))) {
      throw new Error('Message map includes a recipient outside the selected accepted personal emails. Check the date, agency and email-ID filters.');
    }
  }
  console.log(`${options.apply ? 'Apply' : 'Dry run'}: ${targets.length} accepted personal emails. Provider requests are limited to six per minute.`);
  let changedRecipients = 0;
  for (const target of targets) {
    const targetMappings = mappings.filter(mapping => mapping.emailId === target.id);
    const recovery = targetMappings.length ? await client.recoverReviewed(target, targetMappings) : await client.recover(target);
    let changedFields = 0;
    if (options.apply && recovery.updates.length) {
      // Conditional updates retain earlier evidence even if a webhook arrives during recovery.
      changedFields = await prisma.$transaction(async tx => {
        let count = 0;
        for (const update of recovery.updates) {
          for (const field of PERSONAL_EMAIL_EVENT_FIELDS) {
            const at = update.events[field];
            if (!at) continue;
            const result = await tx.emailRecipient.updateMany({
              where: { id: update.recipientId, emailId: target.id, OR: [{ [field]: null }, { [field]: { gt: at } }] },
              data: { [field]: at },
            });
            count += result.count;
          }
        }
        return count;
      });
    }
    changedRecipients += recovery.updates.length;
    console.log(JSON.stringify({
      emailId: target.id, matchedMessages: recovery.matchedMessages,
      rejectedMessages: recovery.rejectedMessages, recipientsWithRecoveredEvents: recovery.updates.length,
      ...(options.apply ? { updatedFields: changedFields } : {}),
      events: recovery.updates.map(update => ({ recipientId: update.recipientId, ...update.events })),
    }));
  }
  console.log(`${options.apply ? 'Recovery applied' : 'Dry run complete'}: ${changedRecipients} recipients with recovered events. Saved reports were not changed.`);
  if (!options.apply) console.log('Use --apply with the same selection to store these verified events. No email will be sent.');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Email history recovery failed.');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
