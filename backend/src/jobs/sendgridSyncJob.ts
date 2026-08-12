/**
 * SendGrid Sync Job — polls SendGrid's Suppression APIs every 15 minutes to:
 *   1. Fetch global unsubscribes (GET /v3/suppression/unsubscribes)
 *   2. Fetch spam reports      (GET /v3/suppression/spam_reports)
 *   3. For each email: mark ClientContact.isUnsubscribed = true
 *   4. Set ClientSubCompany.status = 'unsubscribed' across all agencies
 *   5. Auto-add the client to each agency's "Unsubscribed" MailingList
 *
 * Pull-based approach — no SendGrid Event Webhook configuration required.
 * The webhook handler (webhooks.ts) still works if you configure it; both are idempotent.
 */
import prisma from '../config/database';
import { env } from '../config/env';

let timer: ReturnType<typeof setInterval> | null = null;

// Track the last sync time in memory.
// On first run, go back 24 hours to catch recent suppressions after a fresh deploy.
let lastSyncAt: Date = new Date(Date.now() - 24 * 60 * 60 * 1000);

interface Suppressed {
  email: string;
  timestamp: number;
}

async function fetchSuppressed(path: string, startTime: number): Promise<string[]> {
  const emails: string[] = [];
  let offset = 0;
  const limit = 500;

  for (;;) {
    const url = `https://api.sendgrid.com/v3${path}?start_time=${startTime}&limit=${limit}&offset=${offset}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY}` },
    });
    if (!resp.ok) break;

    const data = await resp.json() as Suppressed[];
    if (!Array.isArray(data) || data.length === 0) break;

    emails.push(...data.map((r) => r.email));
    if (data.length < limit) break;
    offset += limit;
  }

  return emails;
}

async function processUnsubscribedEmail(email: string) {
  // 1. Mark all ClientContact rows with this email as unsubscribed
  await prisma.clientContact.updateMany({
    where: { email },
    data: { isUnsubscribed: true },
  }).catch(() => {});

  // 2. Find clients that have a contact with this email
  const contacts = await prisma.clientContact.findMany({
    where: { email },
    select: { clientId: true },
  });
  const clientIds = [...new Set(contacts.map((c) => c.clientId))];
  if (clientIds.length === 0) return;

  for (const clientId of clientIds) {
    // 3. Update ClientSubCompany status → 'unsubscribed' for every agency that has this client
    await prisma.clientSubCompany.updateMany({
      where: { clientId },
      data: { status: 'unsubscribed' },
    }).catch(() => {});

    // 4. Find all agencies linked to this client
    const agencyLinks = await prisma.clientSubCompany.findMany({
      where: { clientId },
      select: { subCompanyId: true },
    });

    for (const { subCompanyId } of agencyLinks) {
      // 5. Find or auto-create the "Unsubscribed" MailingList for the agency
      let unsubList = await prisma.mailingList.findFirst({
        where: { subCompanyId, name: 'Unsubscribed' },
      }).catch(() => null);

      if (!unsubList) {
        unsubList = await prisma.mailingList.create({
          data: {
            subCompanyId,
            name: 'Unsubscribed',
            description: 'Auto-managed: contacts who unsubscribed from bulk email campaigns',
          },
        }).catch(() => null);
      }

      if (!unsubList) continue;

      // 6. Add client to the list (upsert — safe if already present)
      await prisma.mailingListClient.upsert({
        where: { listId_clientId: { listId: unsubList.id, clientId } },
        create: { listId: unsubList.id, clientId },
        update: {},
      }).catch(() => {});
    }
  }
}

async function runSync() {
  const startTime = Math.floor(lastSyncAt.getTime() / 1000);
  const syncStarted = new Date();

  try {
    const [unsubscribeEmails, spamEmails] = await Promise.all([
      fetchSuppressed('/suppression/unsubscribes', startTime),
      fetchSuppressed('/suppression/spam_reports', startTime),
    ]);

    const allEmails = [...new Set([...unsubscribeEmails, ...spamEmails])];

    if (allEmails.length > 0) {
      console.log(`[sendgridSync] Processing ${allEmails.length} unsubscribed/spam email(s)`);
      for (const email of allEmails) {
        await processUnsubscribedEmail(email);
      }
      console.log(`[sendgridSync] Done — ${allEmails.length} email(s) processed`);
    }

    lastSyncAt = syncStarted;
  } catch (err) {
    console.error('[sendgridSync] Sync error:', err);
  }
}

export function startSendGridSync() {
  if (!env.SENDGRID_API_KEY) {
    console.log('[sendgridSync] Skipped — SENDGRID_API_KEY not configured');
    return;
  }
  if (timer) return;
  // Run immediately so the first sync happens on server start, then every 15 min
  runSync();
  timer = setInterval(runSync, 15 * 60 * 1000);
  console.log('[sendgridSync] Started — polling SendGrid every 15 minutes');
}

export function stopSendGridSync() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
