/**
 * PandaDoc service layer — business-logic-aware operations.
 * Builds API payloads from our DTOs and coordinates multi-step flows.
 * Business code (routes, jobs) should only import from here, not from client.ts directly.
 */

import { pandaDocClient } from './client';
import {
  CreateDocumentFromTemplateDTO,
  PandaDocDocument,
  PandaDocDocumentDetail,
  PandaDocError,
  PandaDocTemplate,
  PandaDocTemplateDetails,
} from './types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Proposal token matching (shared with routes that build documents) ─────────

export interface ProposalPrefill {
  client: { name: string; industry: string; location: string; address: string; companySize: string };
  contact: { name: string; firstName: string; lastName: string; title: string; email: string; phone: string } | null;
  sender: { name: string; firstName: string; lastName: string; email: string; phone: string };
  agency: { name: string };
  lead: { value: string; stage: string };
  date: { today: string; year: string };
  proposal: {
    paymentDays: string;
    paymentTermsLabel: string;
    minimumHours: string;
    billingRate: string;
    agreementTypeLabel: string;
  };
  signingAuthority?: { name: string };
}

/**
 * Map a PandaDoc token name to its auto-filled value from proposal data.
 * Token names are normalised (lowercased, non-alphanumeric stripped) before matching.
 */
export function matchProposalToken(rawName: string, prefill: ProposalPrefill): string {
  const n = rawName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const c = prefill.contact;
  const map: Record<string, string> = {
    // ── Client ──────────────────────────────────────────────────────────────
    client: prefill.client.name, clientname: prefill.client.name, companyname: prefill.client.name, clientcompanyname: prefill.client.name,
    clientindustry: prefill.client.industry, industry: prefill.client.industry,
    typeofbusiness: prefill.client.industry, businesstype: prefill.client.industry, typebusiness: prefill.client.industry,
    clientlocation: prefill.client.location, clientcity: prefill.client.location, location: prefill.client.location,
    clientaddress: prefill.client.address, address: prefill.client.address,
    companysize: prefill.client.companySize, clientcompanysize: prefill.client.companySize,
    // ── Contact ─────────────────────────────────────────────────────────────
    contactname: c?.name ?? '', recipientname: c?.name ?? '',
    contactfirstname: c?.firstName ?? '', recipientfirstname: c?.firstName ?? '',
    contactlastname: c?.lastName ?? '', recipientlastname: c?.lastName ?? '',
    contacttitle: c?.title ?? '', jobtitle: c?.title ?? '',
    signingauthority: prefill.signingAuthority?.name ?? '', designation: prefill.signingAuthority?.name ?? '', signingauthoritydesignation: prefill.signingAuthority?.name ?? '', authority: prefill.signingAuthority?.name ?? '',
    contactemail: c?.email ?? '', recipientemail: c?.email ?? '',
    contactphone: c?.phone ?? '', recipientphone: c?.phone ?? '',
    // ── Sender / Rep ────────────────────────────────────────────────────────
    sendername: prefill.sender.name, repname: prefill.sender.name, salesrepname: prefill.sender.name,
    senderfirstname: prefill.sender.firstName, senderlastname: prefill.sender.lastName,
    senderemail: prefill.sender.email, repemail: prefill.sender.email, salesrepemail: prefill.sender.email,
    senderphone: prefill.sender.phone,
    // ── Agency ──────────────────────────────────────────────────────────────
    agencyname: prefill.agency.name, staffingagency: prefill.agency.name, agencycompanyname: prefill.agency.name,
    // ── Date ────────────────────────────────────────────────────────────────
    date: prefill.date.today, today: prefill.date.today, datetoday: prefill.date.today, todaydate: prefill.date.today,
    currentdate: prefill.date.today, signingdate: prefill.date.today, agreementdate: prefill.date.today, effectivedate: prefill.date.today,
    year: prefill.date.year, currentyear: prefill.date.year,
    // ── Lead value ──────────────────────────────────────────────────────────
    contractvalue: prefill.lead.value, dealvalue: prefill.lead.value, leadvalue: prefill.lead.value, value: prefill.lead.value,
    // ── Payment terms / # of days ───────────────────────────────────────────
    ofdays: prefill.proposal.paymentDays, numberofdays: prefill.proposal.paymentDays, numofdays: prefill.proposal.paymentDays,
    paymentdays: prefill.proposal.paymentDays, netdays: prefill.proposal.paymentDays,
    paymentterms: prefill.proposal.paymentTermsLabel, net: prefill.proposal.paymentTermsLabel,
    // ── Minimum hours / # of hours ──────────────────────────────────────────
    ofhours: prefill.proposal.minimumHours, numberofhours: prefill.proposal.minimumHours, numofhours: prefill.proposal.minimumHours,
    minimumhours: prefill.proposal.minimumHours, minhours: prefill.proposal.minimumHours, tempminimumhours: prefill.proposal.minimumHours,
    ofhoursmintortempopermanent: prefill.proposal.minimumHours, ofhoursminfortempopermanent: prefill.proposal.minimumHours,
    // ── Bill rate / Markup / Placement fee ──────────────────────────────────
    billratemarkup: prefill.proposal.billingRate, billrate: prefill.proposal.billingRate, billingrate: prefill.proposal.billingRate,
    markup: prefill.proposal.billingRate, markuppercentage: prefill.proposal.billingRate, markuppercent: prefill.proposal.billingRate,
    pricingvalue: prefill.proposal.billingRate, rate: prefill.proposal.billingRate, billrateorhourlyrate: prefill.proposal.billingRate,
    placementfeepercentage: prefill.proposal.billingRate, placementfee: prefill.proposal.billingRate,
    feepercentage: prefill.proposal.billingRate, feepercent: prefill.proposal.billingRate, recruitmentfee: prefill.proposal.billingRate,
    // ── Agreement type ──────────────────────────────────────────────────────
    agreementtype: prefill.proposal.agreementTypeLabel, typeofagreement: prefill.proposal.agreementTypeLabel,
    servicetype: prefill.proposal.agreementTypeLabel,
    // ── Signing authority ────────────────────────────────────────────────────
    signingauthorityname: prefill.signingAuthority?.name ?? '',
    agencysigningauthority: prefill.signingAuthority?.name ?? '',
  };
  return map[n] ?? '';
}

// ─── In-memory cache for enriched template list ───────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const templateDetailCache: {
  data: PandaDocTemplateDetails[] | null;
  fetchedAt: number;
} = { data: null, fetchedAt: 0 };

// ─────────────────────────────────────────────────────────────────────────────

export const pandaDocService = {
  isAvailable(): boolean {
    return pandaDocClient.isConfigured();
  },

  // ── Templates ─────────────────────────────────────────────────────────────

  async listTemplates(search?: string): Promise<PandaDocTemplate[]> {
    const res = await pandaDocClient.listTemplates(search);
    return res.results ?? [];
  },

  /**
   * Fetch ALL templates (paginated) then enrich each with fields/tokens/roles.
   * Results are cached in-process for CACHE_TTL_MS (5 minutes).
   */
  async listAllTemplatesWithDetails(forceRefresh = false): Promise<PandaDocTemplateDetails[]> {
    const now = Date.now();
    if (!forceRefresh && templateDetailCache.data && now - templateDetailCache.fetchedAt < CACHE_TTL_MS) {
      return templateDetailCache.data;
    }

    // Paginate through all templates
    const allTemplates: PandaDocTemplate[] = [];
    let page = 1;
    const count = 50;

    for (;;) {
      const res = await pandaDocClient.listTemplates(undefined, page, count);
      const batch = res.results ?? [];
      allTemplates.push(...batch);
      if (batch.length < count) break;
      page++;
    }

    // Fetch details sequentially with a small delay to respect rate limits
    const enriched: PandaDocTemplateDetails[] = [];
    for (const tpl of allTemplates) {
      try {
        const raw = await pandaDocClient.getTemplateDetails(tpl.id);
        enriched.push({
          id: tpl.id,
          name: tpl.name,
          date_created: tpl.date_created,
          date_modified: tpl.date_modified,
          fields: raw.fields ?? [],
          tokens: raw.tokens ?? [],
          roles: raw.roles ?? [],
          imageBlockNames: (raw.images ?? []).map((img) => img.name),
        });
      } catch (err) {
        // Include template without detail data rather than failing the whole request
        enriched.push({ ...tpl, fields: [], tokens: [], roles: [], imageBlockNames: [] });
      }
      // 150 ms between detail requests to stay well under PandaDoc rate limits
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
    }

    templateDetailCache.data = enriched;
    templateDetailCache.fetchedAt = now;
    return enriched;
  },

  // ── Documents ─────────────────────────────────────────────────────────────

  /**
   * Create a document from a template, optionally sending it immediately.
   * Returns the created PandaDoc document.
   */
  async createFromTemplate(dto: CreateDocumentFromTemplateDTO): Promise<PandaDocDocument> {
    const payload: Record<string, unknown> = {
      name: dto.name,
      template_uuid: dto.templateId,
      recipients: dto.recipients,
    };

    if (dto.fields && Object.keys(dto.fields).length > 0) {
      payload.fields = dto.fields;
    }
    if (dto.tokens && dto.tokens.length > 0) {
      payload.tokens = dto.tokens;
    }
    if (dto.images && dto.images.length > 0) {
      payload.images = dto.images;
    }

    const doc = await pandaDocClient.createDocumentFromTemplate(payload);

    if (dto.sendSilent) {
      // PandaDoc processes templates asynchronously. The document starts as
      // 'document.uploaded' and must reach 'document.draft' before /send works.
      // Poll up to 30 seconds with 2-second intervals.
      const maxAttempts = 15;
      const intervalMs = 2000;
      let ready = false;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
        try {
          const detail = await pandaDocClient.getDocument(doc.id);
          if (detail.status === 'document.draft') {
            ready = true;
            break;
          }
          // Any terminal/unexpected status — stop waiting
          if (!['document.uploaded', 'document.draft'].includes(detail.status)) {
            break;
          }
        } catch {
          // Transient fetch error — keep polling
        }
      }

      if (!ready) {
        console.warn(`[PandaDoc] Document ${doc.id} did not reach draft state after ${maxAttempts * intervalMs / 1000}s — attempting send anyway`);
      }

      await pandaDocClient.sendDocument(doc.id, { silent: true });
    } else if (dto.waitForDraft) {
      // Poll until document.draft — /send fails with 409 while still document.uploaded.
      const maxAttempts = 20;
      const intervalMs = 2000;
      let ready = false;
      let lastStatus: string = doc.status || 'document.uploaded';
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await sleep(intervalMs);
        try {
          const detail = await pandaDocClient.getDocument(doc.id);
          lastStatus = detail.status;
          if (detail.status === 'document.draft') {
            ready = true;
            break;
          }
          if (!['document.uploaded', 'document.draft'].includes(detail.status)) {
            break;
          }
        } catch {
          // Transient fetch error — keep polling
        }
      }
      if (!ready) {
        throw new PandaDocError(
          `Document did not become ready to send (status: ${lastStatus}). Try Confirm & send again in a moment.`,
          409,
        );
      }
    }

    return doc;
  },

  async getDocument(documentId: string): Promise<PandaDocDocumentDetail> {
    return pandaDocClient.getDocument(documentId);
  },

  /** Roles / fields for a single template (used when creating employee onboarding docs). */
  async getTemplateRoles(templateId: string): Promise<string[]> {
    const raw = await pandaDocClient.getTemplateDetails(templateId);
    return (raw.roles ?? []).map((r) => r.name).filter(Boolean);
  },

  /** Roles + token names for filling an onboarding document from a template. */
  async getTemplateRolesAndTokenNames(templateId: string): Promise<{
    roles: string[];
    tokenNames: string[];
  }> {
    const raw = await pandaDocClient.getTemplateDetails(templateId);
    return {
      roles: (raw.roles ?? []).map((r) => r.name).filter(Boolean),
      tokenNames: (raw.tokens ?? []).map((t) => t.name).filter(Boolean),
    };
  },

  /**
   * Prefer a role that typically owns signature/fill fields.
   * Blindly using roles[0] can map the employee to a CC/view-only role.
   */
  pickPreferredSignerRole(roleNames: string[]): string {
    const roles = roleNames.map((r) => r.trim()).filter(Boolean);
    if (roles.length === 0) return 'Signer';
    const preferred = [
      /^signer$/i,
      /^candidate$/i,
      /^employee$/i,
      /^client$/i,
      /^recipient$/i,
      /sign/i,
      /candidate/i,
      /employee/i,
    ];
    for (const re of preferred) {
      const hit = roles.find((r) => re.test(r));
      if (hit) return hit;
    }
    return roles[0];
  },

  async sendDocumentSilent(documentId: string): Promise<void> {
    await pandaDocClient.sendDocument(documentId, { silent: true });
  },

  /**
   * Silent-send a draft document, then resolve the recipient's durable shared_link
   * (for CRM/SendGrid delivery). Falls back to a long-lived signing session URL.
   */
  async sendSilentAndResolveShareLink(
    documentId: string,
    recipientEmail: string,
  ): Promise<string> {
    const email = recipientEmail.trim().toLowerCase();
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await pandaDocClient.sendDocument(documentId, { silent: true });
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        const status =
          err instanceof PandaDocError
            ? err.statusCode
            : (err as { statusCode?: number })?.statusCode;
        if (status === 409 && attempt < 2) {
          // Still document.uploaded, or already transitioning — retry.
          await sleep(2500);
          continue;
        }
        // Already sent: continue and resolve the share link.
        try {
          const detail = await pandaDocClient.getDocument(documentId);
          if (
            detail.status &&
            detail.status !== 'document.uploaded' &&
            detail.status !== 'document.draft' &&
            detail.status !== 'document.error'
          ) {
            lastErr = undefined;
            break;
          }
        } catch {
          // ignore — rethrow original
        }
        throw err;
      }
    }
    if (lastErr) throw lastErr;

    for (let attempt = 0; attempt < 8; attempt++) {
      if (attempt > 0) await sleep(1000);
      try {
        const detail = await pandaDocClient.getDocument(documentId);
        const recipient = (detail.recipients ?? []).find(
          (r) => (r.email ?? '').trim().toLowerCase() === email,
        );
        const link = (recipient?.shared_link ?? '').trim();
        if (link) return link;
      } catch {
        // Transient — keep polling
      }
    }

    // Durable shared_link not ready — long-lived session (30 days, same as client.ts).
    return this.createSigningSession(documentId, recipientEmail.trim());
  },

  /**
   * Send a document to its recipients with a custom subject and message body.
   * PandaDoc delivers the email directly — no SendGrid involved.
   * Retries briefly on 409 (document still processing).
   */
  async sendWithMessage(documentId: string, subject: string, message?: string): Promise<void> {
    const payload: Record<string, unknown> = { subject, silent: false };
    if (message) payload.message = message;

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await pandaDocClient.sendDocument(documentId, payload);
        return;
      } catch (err) {
        lastErr = err;
        const status =
          err instanceof PandaDocError
            ? err.statusCode
            : (err as { statusCode?: number })?.statusCode;
        if (status === 409 && attempt < 2) {
          await sleep(2500);
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  },

  /**
   * Upload a file buffer as an attachment to a PandaDoc document.
   * Document must be in document.draft state.
   */
  async uploadAttachment(documentId: string, buffer: Buffer, filename: string, mimeType: string): Promise<void> {
    await pandaDocClient.uploadAttachment(documentId, buffer, filename, mimeType);
  },

  async voidDocument(documentId: string): Promise<void> {
    await pandaDocClient.voidDocument(documentId);
  },

  async downloadPdf(documentId: string): Promise<Buffer> {
    return pandaDocClient.downloadPdf(documentId);
  },

  /**
   * Create a short-lived signing session for a recipient.
   * Returns the full URL the client opens to sign: https://app.pandadoc.com/s/{id}
   * Document must be in document.sent or document.viewed status.
   */
  async createSigningSession(documentId: string, recipientEmail: string): Promise<string> {
    const session = await pandaDocClient.createSigningSession(documentId, recipientEmail);
    return `https://app.pandadoc.com/s/${session.id}`;
  },
};
