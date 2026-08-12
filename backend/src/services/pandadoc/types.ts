/**
 * PandaDoc integration — shared types, DTOs, and error classes.
 * Keep this file free of business logic and Express imports.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export type PandaDocDocumentStatus =
  | 'document.draft'
  | 'document.sent'
  | 'document.viewed'
  | 'document.waiting_approval'
  | 'document.approved'
  | 'document.rejected'
  | 'document.waiting_pay'
  | 'document.paid'
  | 'document.completed'
  | 'document.uploaded'
  | 'document.error'
  | 'document.voided'
  | 'document.declined';

export type PandaDocWebhookEvent =
  | 'document_state_changed'
  | 'document_updated'
  | 'recipient_completed';

// ─── API Response shapes (subset we actually use) ────────────────────────────

export interface PandaDocRecipient {
  email: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  signing_order?: number;
  /** Present on document details: signer | cc | approver (casing varies). */
  recipient_type?: string;
  shared_link?: string;
}

export interface PandaDocDocument {
  id: string;
  name: string;
  status: PandaDocDocumentStatus;
  date_created: string;
  date_modified: string;
  expiration_date?: string | null;
  uuid?: string;
  links?: Array<{ rel: string; href: string; type?: string }>;
}

export interface PandaDocDocumentDetail extends PandaDocDocument {
  recipients: PandaDocRecipient[];
  fields?: Record<string, { value?: string; type?: string }>;
}

export interface PandaDocTemplate {
  id: string;
  name: string;
  date_created: string;
  date_modified: string;
}

export interface PandaDocTemplateField {
  uuid: string;
  name: string;
  type: string;
  /** e.g. "{{client.name}}" */
  merge_field?: string;
}

export interface PandaDocTemplateToken {
  name: string;
  value: string;
}

export interface PandaDocTemplateRole {
  id: string;
  name: string;
  signing_order?: number;
}

/** Enriched template returned by the /templates/details endpoint */
export interface PandaDocTemplateDetails extends PandaDocTemplate {
  fields: PandaDocTemplateField[];
  tokens: PandaDocTemplateToken[];
  roles: PandaDocTemplateRole[];
  imageBlockNames: string[];
}

/** Raw shape returned by PandaDoc's GET /templates/{id}/details */
export interface PandaDocTemplateDetailsRaw {
  id: string;
  name: string;
  date_created: string;
  date_modified: string;
  version?: string;
  fields?: PandaDocTemplateField[];
  tokens?: PandaDocTemplateToken[];
  roles?: PandaDocTemplateRole[];
  images?: Array<{ name: string }>;
  content_placeholders?: unknown[];
  metadata?: Record<string, unknown>;
}

// ─── Request DTOs ─────────────────────────────────────────────────────────────

export interface CreateDocumentFromTemplateDTO {
  templateId: string;
  name: string;
  recipients: PandaDocRecipient[];
  /** Merge field values keyed by field name */
  fields?: Record<string, { value: string }>;
  /** Arbitrary token substitution */
  tokens?: Array<{ name: string; value: string }>;
  /** Image blocks to populate — each entry matches a named Image block in the template */
  images?: Array<{ name: string; urls: string[] }>;
  /** Send silently after creation — just changes status to "sent", no PandaDoc email */
  sendSilent?: boolean;
  /** Poll for document.draft state after creation without sending (use when sendSilent is blocked) */
  waitForDraft?: boolean;
  /** URL to notify when document status changes (overrides env default) */
  notifyUrl?: string;
}

// ─── Webhook payload ──────────────────────────────────────────────────────────

export interface PandaDocWebhookPayload {
  event: PandaDocWebhookEvent;
  /** Timestamp from PandaDoc (ms since epoch) */
  timestamp: number;
  data: {
    id: string;
    name: string;
    status: PandaDocDocumentStatus;
    [key: string]: unknown;
  };
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class PandaDocError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'PandaDocError';
  }
}
