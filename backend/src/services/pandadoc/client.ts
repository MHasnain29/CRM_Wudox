/**
 * PandaDoc API client — thin wrapper around the REST API.
 * Handles auth headers, base URL, error normalisation, and logging.
 * No business logic lives here.
 */

import { env } from '../../config/env';
import { PandaDocError } from './types';

const BASE_URL = 'https://api.pandadoc.com/public/v1';

function isPandaDocConfigured(): boolean {
  return Boolean(env.PANDADOC_API_KEY);
}

/** Pull a readable detail string out of PandaDoc error JSON/text bodies. */
function extractPandaDocBodyDetail(body: unknown): string {
  if (body == null) return '';
  if (typeof body === 'string') return body.trim().slice(0, 400);
  if (typeof body !== 'object') return String(body).slice(0, 400);
  const b = body as Record<string, unknown>;
  if (typeof b.detail === 'string' && b.detail.trim()) return b.detail.trim().slice(0, 400);
  if (Array.isArray(b.detail)) {
    const parts = b.detail
      .map((d) => {
        if (typeof d === 'string') return d;
        if (d && typeof d === 'object' && 'msg' in d) return String((d as { msg?: unknown }).msg ?? '');
        return JSON.stringify(d);
      })
      .filter(Boolean);
    if (parts.length) return parts.join('; ').slice(0, 400);
  }
  if (typeof b.message === 'string' && b.message.trim()) return b.message.trim().slice(0, 400);
  if (Array.isArray(b.errors)) {
    const parts = b.errors
      .map((e) => {
        if (typeof e === 'string') return e;
        if (e && typeof e === 'object' && 'message' in e) {
          return String((e as { message?: unknown }).message ?? '');
        }
        return '';
      })
      .filter(Boolean);
    if (parts.length) return parts.join('; ').slice(0, 400);
  }
  try {
    return JSON.stringify(body).slice(0, 400);
  } catch {
    return '';
  }
}

function formatPandaDocApiError(status: number, body: unknown): string {
  const detail = extractPandaDocBodyDetail(body);
  const base = `PandaDoc API error ${status}${detail ? `: ${detail}` : ''}`;
  if (status === 403) {
    return `${base}. If using a sandbox API key, the recipient email must use the same domain as your PandaDoc account (Gmail often cannot receive sandbox sends).`;
  }
  if (status === 409) {
    return `${base}. Document was not ready to send yet — wait a moment and try again.`;
  }
  return base;
}

function log(level: 'info' | 'warn' | 'error', msg: string, meta?: unknown): void {
  const prefix = '[PandaDoc]';
  if (level === 'error') console.error(prefix, msg, meta ?? '');
  else if (level === 'warn')  console.warn(prefix, msg, meta ?? '');
  else if (env.LOG_LEVEL === 'debug') console.log(prefix, msg, meta ?? '');
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  if (!isPandaDocConfigured()) {
    throw new PandaDocError('PandaDoc is not configured (missing PANDADOC_API_KEY)');
  }

  const url = `${BASE_URL}${path}`;
  log('info', `${method} ${path}`);

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `API-Key ${env.PANDADOC_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let responseBody: unknown;
  const ct = res.headers.get('content-type') ?? '';
  try {
    responseBody = ct.includes('application/json') ? await res.json() : await res.text();
  } catch {
    responseBody = null;
  }

  if (!res.ok) {
    log('error', `${method} ${path} → ${res.status}`, responseBody);
    throw new PandaDocError(
      formatPandaDocApiError(res.status, responseBody),
      res.status,
      responseBody,
    );
  }

  log('info', `${method} ${path} → ${res.status}`);
  return responseBody as T;
}

// ─── Exported methods used by the service layer ───────────────────────────────

export const pandaDocClient = {
  isConfigured: isPandaDocConfigured,

  /** List templates available in the workspace (one page). */
  listTemplates(query?: string, page = 1, count = 50) {
    const params = new URLSearchParams({ page: String(page), count: String(count) });
    if (query) params.set('q', query);
    return request<{ results: import('./types').PandaDocTemplate[] }>('GET', `/templates/?${params.toString()}`);
  },

  /** Fetch full details (fields, tokens, roles) for a single template. */
  getTemplateDetails(templateId: string) {
    return request<import('./types').PandaDocTemplateDetailsRaw>('GET', `/templates/${templateId}/details`);
  },

  /** Create a document from a template. */
  createDocumentFromTemplate(payload: Record<string, unknown>) {
    return request<import('./types').PandaDocDocument>('POST', '/documents', payload);
  },

  /** Get full document detail. */
  getDocument(documentId: string) {
    return request<import('./types').PandaDocDocumentDetail>('GET', `/documents/${documentId}/details`);
  },

  /** Send (or re-send) a document to its recipients. */
  sendDocument(documentId: string, payload: Record<string, unknown> = {}) {
    return request<{ id: string; status: string }>('POST', `/documents/${documentId}/send`, payload);
  },

  /** Void a sent document. */
  voidDocument(documentId: string) {
    return request<{ id: string; status: string }>('DELETE', `/documents/${documentId}`);
  },

  /** Create a signing session for a document recipient. Returns { id } — URL is https://app.pandadoc.com/s/{id} */
  createSigningSession(documentId: string, recipientEmail: string) {
    return request<{ id: string }>(
      'POST',
      `/documents/${documentId}/session`,
      { recipient: recipientEmail, lifetime: 2592000 },
    );
  },

  /** Upload a file as an attachment to a document (must be in document.draft state). */
  async uploadAttachment(documentId: string, buffer: Buffer, filename: string, mimeType: string): Promise<void> {
    if (!isPandaDocConfigured()) {
      throw new PandaDocError('PandaDoc is not configured');
    }
    const url = `${BASE_URL}/documents/${documentId}/attachments`;
    log('info', `POST /documents/${documentId}/attachments (${filename})`);

    const formData = new FormData();
    const blob = new Blob([buffer], { type: mimeType });
    formData.append('file', blob, filename);

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `API-Key ${env.PANDADOC_API_KEY}` },
      body: formData,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => null);
      log('error', `POST /documents/${documentId}/attachments → ${res.status}`, body);
      throw new PandaDocError(`PandaDoc attachment upload failed ${res.status}`, res.status, body);
    }
    log('info', `POST /documents/${documentId}/attachments → ${res.status}`);
  },

  /** Download PDF as a Buffer. */
  async downloadPdf(documentId: string): Promise<Buffer> {
    if (!isPandaDocConfigured()) {
      throw new PandaDocError('PandaDoc is not configured');
    }
    const url = `${BASE_URL}/documents/${documentId}/download`;
    log('info', `GET /documents/${documentId}/download`);
    const res = await fetch(url, {
      headers: { Authorization: `API-Key ${env.PANDADOC_API_KEY}` },
    });
    if (!res.ok) {
      throw new PandaDocError(`PandaDoc download failed ${res.status}`, res.status);
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  },
};
