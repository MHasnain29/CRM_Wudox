/**
 * Read-only recovery of personal-email events from SendGrid Email Activity.
 * Automatic matches require crm_email_id AND recipient address. Legacy messages
 * without metadata require an explicit, reviewed CRM-recipient/provider-ID map.
 * Subject/address/time similarities are never used to discover associations.
 * API reference: https://www.twilio.com/docs/sendgrid/api-reference/email-activity
 */
export const PERSONAL_EMAIL_EVENT_FIELDS = ['deliveredAt', 'openedAt', 'clickedAt', 'bouncedAt'] as const;
export type PersonalEmailEventField = typeof PERSONAL_EMAIL_EVENT_FIELDS[number];
export type PersonalEmailEventDates = Record<PersonalEmailEventField, Date | null>;

export interface PersonalEmailHistoryTarget {
  id: string;
  fromEmail: string;
  subject: string;
  recipients: Array<PersonalEmailEventDates & { id: string; emailAddress: string; sentAt: Date | null }>;
}

export interface ReviewedEmailMessageMapping {
  emailId: string;
  recipientId: string;
  providerMessageId: string;
}

export interface PersonalEmailHistoryRecovery {
  emailId: string;
  matchedMessages: number;
  rejectedMessages: number;
  updates: Array<{ recipientId: string; events: Partial<Record<PersonalEmailEventField, Date>> }>;
}

const EVENT_FIELDS: Record<string, PersonalEmailEventField> = {
  delivered: 'deliveredAt', opened: 'openedAt', open: 'openedAt',
  clicked: 'clickedAt', click: 'clickedAt', bounced: 'bouncedAt', bounce: 'bouncedAt',
  dropped: 'bouncedAt', drop: 'bouncedAt',
};
const REQUEST_INTERVAL_MS = 10_100; // Email Activity API: at most six requests per minute.
const RESULT_LIMIT = 1000;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function customArguments(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return object(value);
  try { return object(JSON.parse(value)); } catch { return null; }
}

/** Activity API event.processed is an ISO 8601 timestamp, unlike webhook Unix seconds. */
function eventDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/** Validate the complete operator-reviewed map before requests or database updates. */
export function parseReviewedEmailMessageMap(value: unknown): ReviewedEmailMessageMapping[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error('Message map must contain between 1 and 100 entries.');
  const providerTargets = new Map<string, ReviewedEmailMessageMapping>();
  for (const entry of value) {
    const row = object(entry);
    if (!row || typeof row.emailId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(row.emailId)
      || typeof row.recipientId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(row.recipientId)
      || typeof row.providerMessageId !== 'string' || !row.providerMessageId.trim()
      || row.providerMessageId.length > 512 || row.providerMessageId !== row.providerMessageId.trim()) {
      throw new Error('Each message-map entry requires valid emailId, recipientId and providerMessageId strings.');
    }
    const mapping = { emailId: row.emailId, recipientId: row.recipientId, providerMessageId: row.providerMessageId };
    const previous = providerTargets.get(mapping.providerMessageId);
    if (previous && (previous.emailId !== mapping.emailId || previous.recipientId !== mapping.recipientId)) {
      throw new Error('A provider message cannot be mapped to different CRM recipients.');
    }
    providerTargets.set(mapping.providerMessageId, mapping);
  }
  return [...providerTargets.values()];
}

/** Explicit legacy associations still require independently matching sending evidence. */
export function buildReviewedPersonalEmailHistoryRecovery(
  target: PersonalEmailHistoryTarget,
  mappedDetails: Array<{ mapping: ReviewedEmailMessageMapping; detail: unknown }>,
): PersonalEmailHistoryRecovery {
  parseReviewedEmailMessageMap(mappedDetails.map(entry => entry.mapping));
  const result: PersonalEmailHistoryRecovery = { emailId: target.id, matchedMessages: 0, rejectedMessages: 0, updates: [] };
  const changes = new Map<string, Partial<Record<PersonalEmailEventField, Date>>>();
  for (const { mapping, detail } of mappedDetails) {
    const recipient = target.recipients.find(row => row.id === mapping.recipientId);
    if (mapping.emailId !== target.id || !recipient) throw new Error('Mapped CRM recipient is outside the selected email.');
    const message = object(detail);
    if (!message || message.msg_id !== mapping.providerMessageId) throw new Error('Mapped provider message identifier does not match.');
    const args = customArguments(message.unique_args);
    const legacyMetadataAbsent = message.unique_args == null || message.unique_args === 'null';
    if (!legacyMetadataAbsent && args?.crm_email_id !== target.id) throw new Error('Mapped provider message has conflicting or unrecognized CRM metadata.');
    if (typeof message.from_email !== 'string' || !target.fromEmail.trim()
      || message.from_email.trim().toLowerCase() !== target.fromEmail.trim().toLowerCase()) {
      throw new Error('Mapped provider sender does not match the CRM email.');
    }
    if (message.subject !== target.subject) throw new Error('Mapped provider subject does not match the CRM email.');
    if (typeof message.to_email !== 'string' || message.to_email.trim().toLowerCase() !== recipient.emailAddress.trim().toLowerCase()) {
      throw new Error('Mapped provider recipient address does not match the CRM recipient.');
    }
    const acceptedAt = recipient.sentAt?.getTime();
    const processedNearAcceptance = Array.isArray(message.events) && message.events.some(value => {
      const event = object(value);
      const at = event?.event_name === 'processed' ? eventDate(event.processed) : null;
      return at && acceptedAt !== undefined && Number.isFinite(acceptedAt) && Math.abs(at.getTime() - acceptedAt) <= 60_000;
    });
    if (!processedNearAcceptance) throw new Error('Mapped provider processing time must be within 60 seconds of this recipient’s accepted sentAt.');
    // The reviewed map supplies the missing legacy association only after all checks.
    const recovered = buildPersonalEmailHistoryRecovery({ ...target, recipients: [recipient] }, [{
      ...message, unique_args: { crm_email_id: target.id },
    }]);
    result.matchedMessages += recovered.matchedMessages;
    for (const update of recovered.updates) {
      const events = changes.get(update.recipientId) ?? {};
      for (const field of PERSONAL_EMAIL_EVENT_FIELDS) {
        const at = update.events[field];
        if (at && (!events[field] || at < events[field]!)) events[field] = at;
      }
      changes.set(update.recipientId, events);
    }
  }
  result.updates = [...changes].map(([recipientId, events]) => ({ recipientId, events }));
  return result;
}

/** Pure recovery plan: preserves earlier stored events and never invents absent outcomes. */
export function buildPersonalEmailHistoryRecovery(
  target: PersonalEmailHistoryTarget,
  details: unknown[],
): PersonalEmailHistoryRecovery {
  const result: PersonalEmailHistoryRecovery = { emailId: target.id, matchedMessages: 0, rejectedMessages: 0, updates: [] };
  const changes = new Map<string, Partial<Record<PersonalEmailEventField, Date>>>();
  for (const value of details) {
    const message = object(value);
    const args = customArguments(message?.unique_args);
    const address = typeof message?.to_email === 'string' ? message.to_email.trim().toLowerCase() : '';
    const recipients = target.recipients.filter(recipient => recipient.emailAddress.trim().toLowerCase() === address);
    if (!message || args?.crm_email_id !== target.id || !address || !recipients.length || !Array.isArray(message.events)) {
      result.rejectedMessages++;
      continue;
    }
    result.matchedMessages++;
    for (const value of message.events) {
      const event = object(value);
      const field = typeof event?.event_name === 'string' && Object.hasOwn(EVENT_FIELDS, event.event_name)
        ? EVENT_FIELDS[event.event_name] : undefined;
      const at = eventDate(event?.processed);
      if (!field || !at) continue;
      for (const recipient of recipients) {
        const events = changes.get(recipient.id) ?? {};
        const previous = events[field] ?? recipient[field];
        if (!previous || at < previous) {
          events[field] = at;
          changes.set(recipient.id, events);
        }
      }
    }
  }
  result.updates = [...changes].map(([recipientId, events]) => ({ recipientId, events }));
  return result;
}

/** Serializes requests, including concurrent callers, to respect the provider's rate limit. */
export class SendGridEmailHistoryClient {
  private lastRequestAt: number | null = null;
  private requests: Promise<unknown> = Promise.resolve();
  private readonly request: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly apiKey: string, options: {
    fetch?: typeof fetch;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {}) {
    if (!apiKey.trim()) throw new Error('SENDGRID_API_KEY is required for email history recovery.');
    this.request = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }

  private get(path: string): Promise<unknown> {
    const pending = this.requests.then(async () => {
      if (this.lastRequestAt !== null) {
        const delay = REQUEST_INTERVAL_MS - (this.now() - this.lastRequestAt);
        if (delay > 0) await this.sleep(delay);
      }
      this.lastRequestAt = this.now();
      const response = await this.request(`https://api.sendgrid.com/v3${path}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        const hint = response.status === 401 || response.status === 403
          ? ' Check API-key Email Activity permissions and account history access.'
          : response.status === 429 ? ' Provider rate limit reached; retry the recovery later.' : '';
        // Do not print provider response bodies: they may contain account or recipient data.
        throw new Error(`SendGrid Email Activity returned HTTP ${response.status}.${hint}`);
      }
      return response.json();
    });
    this.requests = pending.catch(() => undefined);
    return pending;
  }

  async recover(target: PersonalEmailHistoryTarget): Promise<PersonalEmailHistoryRecovery> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(target.id)) throw new Error('Invalid CRM email identifier.');
    const params = new URLSearchParams({
      query: `(unique_args['crm_email_id']="${target.id}")`, limit: String(RESULT_LIMIT),
    });
    const list = object(await this.get(`/messages?${params}`));
    if (!list || !Array.isArray(list.messages)) throw new Error('SendGrid returned an invalid email-history list.');
    if (list.messages.length >= RESULT_LIMIT) throw new Error('Email-history results reached the provider limit; recovery is incomplete.');
    const ids: string[] = [];
    for (const value of list.messages) {
      const message = object(value);
      if (typeof message?.msg_id !== 'string' || !message.msg_id) throw new Error('SendGrid returned a message without an identifier.');
      ids.push(message.msg_id);
    }
    if (new Set(ids).size > 100) throw new Error('More than 100 provider messages matched one CRM email; inspect the provider history before recovery.');
    const details: unknown[] = [];
    for (const id of new Set(ids)) {
      const message = object(await this.get(`/messages/${encodeURIComponent(id)}`));
      if (!message || message.msg_id !== id) throw new Error('SendGrid returned mismatched message details.');
      details.push(message);
    }
    return buildPersonalEmailHistoryRecovery(target, details);
  }

  async recoverReviewed(
    target: PersonalEmailHistoryTarget,
    reviewedMappings: ReviewedEmailMessageMapping[],
  ): Promise<PersonalEmailHistoryRecovery> {
    const mappings = parseReviewedEmailMessageMap(reviewedMappings);
    // Check scope before fetching any message bodies.
    for (const mapping of mappings) {
      if (mapping.emailId !== target.id || !target.recipients.some(recipient => recipient.id === mapping.recipientId)) {
        throw new Error('Mapped CRM recipient is outside the selected email.');
      }
    }
    const details = [];
    for (const mapping of mappings) {
      details.push({ mapping, detail: await this.get(`/messages/${encodeURIComponent(mapping.providerMessageId)}`) });
    }
    return buildReviewedPersonalEmailHistoryRecovery(target, details);
  }
}
