/**
 * PandaDoc routes
 *
 * Public webhook (no auth):
 *   POST /api/v1/pandadoc/webhook
 *
 * Protected proxy endpoints:
 *   GET  /api/v1/pandadoc/templates
 *   GET  /api/v1/pandadoc/documents/:id
 *
 * Configure in PandaDoc dashboard:
 *   Settings → API & Webhooks → Webhook Subscriptions
 *   URL: https://<your-domain>/api/v1/pandadoc/webhook
 *   Events: document_state_changed, recipient_completed
 */

import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { env } from '../config/env';
import prisma from '../config/database';
import type { Permission } from '../config/permissions';
import { dispatchNotificationToUser } from '../services/notificationDispatch';
import { createActivityLog } from '../services/activityLog';
import { emitToUsers } from '../socket';
import { uploadToR2, getFromR2 } from '../services/r2Storage';
import { getAgencyBranding, sendSignedDocumentConfirmationEmail, resolveOutboundUserSender } from '../services/email';
import { isSenderDomainError } from '../services/senderDomainErrors';
import { computePreviewHash } from '../jobs/agreementPreviewJob';
import {
  pandaDocService,
  sendPandaDocWithAgencyFrom,
  PandaDocWebhookPayload,
  PandaDocDocumentStatus,
  PandaDocError,
  type ProposalPrefill,
} from '../services/pandadoc';
import {
  filterTemplatesByAllowedIds,
  getAllowedPandaDocTemplateIds,
  getAllowedPandaDocTemplateIdsForAgencies,
  getPandaDocTemplateMappingMeta,
} from '../services/pandadoc/agencyTemplates';
import { resolveAgencyScope, resolveAllowedSubCompanyIds } from '../config/agencyScope';
import { ensureAccessContext, ensurePermissionKeys } from '../utils/requestPermission';
import { canAccessMultipleAgencies } from '../services/accessContext';
import { renderReviewPdf } from '../services/reviewPdf';
import { generateProposalPreviewPdf } from '../services/proposalPreviewPdf';
import { proposalReviewerIds } from '../services/proposalAccess';
import { DEFAULT_BRAND_NAME } from '../config/branding';

/** LIST templates: Documents page uses proposals:*; send/create often leads:write. */
const TEMPLATE_LIST_PERMS: Permission[] = [
  'leads:write',
  'proposals:read',
  'proposals:write',
  'proposals:review',
];

async function canAccessPandaDocCatalog(req: Request): Promise<boolean> {
  if (req.user?.role === 'super_admin') return true;
  try {
    const keys = await ensurePermissionKeys(req);
    return keys.includes('settings:write');
  } catch {
    return false;
  }
}

/**
 * Resolve which agency mapping(s) apply to a template LIST request.
 * - ?allAgencies=1 → union of mappings for every agency the caller may access
 * - else → single agency from resolveAgencyScope (fail closed if none)
 */
async function resolveTemplateListAllowedIds(req: Request): Promise<{
  allowedIds: string[];
  agencyIds: string[];
  allAgencies: boolean;
}> {
  const allAgencies =
    req.query.allAgencies === '1' || req.query.allAgencies === 'true';

  if (allAgencies) {
    if (!req.user) return { allowedIds: [], agencyIds: [], allAgencies: true };
    const ctx = await ensureAccessContext(req);
    const canMulti = ctx ? canAccessMultipleAgencies(ctx) : false;
    if (!canMulti && req.user.role !== 'database_manager' && req.user.role !== 'super_admin') {
      // Single-agency users: fall back to their home agency only
      const home = req.user.subCompanyId;
      if (!home) return { allowedIds: [], agencyIds: [], allAgencies: false };
      const allowedIds = await getAllowedPandaDocTemplateIds(home);
      return { allowedIds, agencyIds: [home], allAgencies: false };
    }
    const agencyIds = await resolveAllowedSubCompanyIds(req.user, req);
    const allowedIds = await getAllowedPandaDocTemplateIdsForAgencies(agencyIds);
    return { allowedIds, agencyIds, allAgencies: true };
  }

  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) return { allowedIds: [], agencyIds: [], allAgencies: false };
  const allowedIds = await getAllowedPandaDocTemplateIds(subCompanyId);
  return { allowedIds, agencyIds: [subCompanyId], allAgencies: false };
}

export const pandaDocRouter = Router();

// ─── Signature verification ───────────────────────────────────────────────────

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── Webhook handler helpers ──────────────────────────────────────────────────

/**
 * Map PandaDoc document status to a human-readable label for notifications.
 */
function statusLabel(status: PandaDocDocumentStatus): string {
  const map: Partial<Record<PandaDocDocumentStatus, string>> = {
    'document.completed': 'signed',
    'document.declined': 'declined',
    'document.voided': 'voided',
    'document.viewed': 'viewed',
    'document.sent': 'sent',
  };
  return map[status] ?? status.replace('document.', '');
}

/**
 * Core webhook processing — find proposal by pandaDocId, update DB, notify owner.
 */
async function handleDocumentStateChanged(
  documentId: string,
  documentName: string,
  status: PandaDocDocumentStatus,
): Promise<void> {
  const proposal = await prisma.proposal.findFirst({
    where: { pandaDocId: documentId },
    include: {
      lead: {
        select: {
          id: true,
          ownerId: true,
          subCompanyId: true,
          client: { select: { name: true } },
        },
      },
      selectedContact: {
        select: { id: true, name: true, email: true, isUnsubscribed: true, emailBounced: true, emailInvalid: true },
      },
      selectedDefaultFiles: {
        select: { id: true, name: true, fileUrl: true, mimeType: true },
      },
    },
  });

  if (!proposal) {
    // Recruitment onboarding docs are tracked on Employee, not Proposal.
    const { handleEmployeeOnboardingWebhook } = await import('../services/employeeOnboardingDocs');
    const handledOnboarding = await handleEmployeeOnboardingWebhook(
      documentId,
      status,
      documentName,
    );
    if (handledOnboarding) return;

    const { handleActiveClientTrainingWebhook } = await import(
      '../services/activeClientTrainingPandaDoc'
    );
    const handledTraining = await handleActiveClientTrainingWebhook(
      documentId,
      status,
      documentName,
    );
    if (!handledTraining) {
      console.warn(
        '[PandaDoc] Webhook: no proposal, employee, or client-training found for pandaDocId',
        documentId,
      );
    }
    return;
  }

  // Update proposal pandaDoc status in DB
  await prisma.proposal.update({
    where: { id: proposal.id },
    data: {
      pandaDocStatus: status,
      pandaDocUpdatedAt: new Date(),
    },
  });

  const lead = proposal.lead;
  const clientName = lead.client?.name ?? 'Client';
  const label = statusLabel(status);

  // On completion: auto-download signed PDF and store as received document
  if (status === 'document.completed') {
    try {
      const pdfBuffer = await pandaDocService.downloadPdf(documentId);
      const r2Key = `pandadoc/${proposal.id}/${documentId}.pdf`;
      const fileUrl = await uploadToR2(r2Key, pdfBuffer, 'application/pdf');
      if (fileUrl) {
        await prisma.proposalDocument.create({
          data: {
            proposalId: proposal.id,
            category: 'received_from_client',
            name: `${documentName} (Signed).pdf`,
            size: BigInt(pdfBuffer.length),
            type: 'application/pdf',
            url: fileUrl,
            uploadedById: lead.ownerId,
            deliveryStatus: 'signed',
          },
        });
        console.log(`[PandaDoc] Signed PDF stored for proposal ${proposal.id}`);
      }

      // Send confirmation email to client with signed PDF + default files attached
      try {
        const contact = proposal.selectedContact;
        if (!contact?.email) {
          console.warn(`[PandaDoc] No selected contact email for proposal ${proposal.id} — skipping confirmation email`);
        } else if (contact.isUnsubscribed || contact.emailBounced || contact.emailInvalid) {
          console.warn(`[PandaDoc] Contact ${contact.id} is unsubscribed/bounced — skipping confirmation email`);
        } else {
          // Download each default file (best-effort — skip failures)
          const defaultFileAttachments: { filename: string; content: Buffer; mimeType: string }[] = [];
          for (const f of proposal.selectedDefaultFiles) {
            try {
              let buf: Buffer;
              if (f.fileUrl.startsWith('http://') || f.fileUrl.startsWith('https://')) {
                const res = await fetch(f.fileUrl);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                buf = Buffer.from(await res.arrayBuffer());
              } else {
                const r2 = await getFromR2(f.fileUrl);
                if (!r2) throw new Error('Not found in R2');
                buf = r2.body;
              }
              defaultFileAttachments.push({
                filename: f.name,
                content: buf,
                mimeType: f.mimeType ?? 'application/octet-stream',
              });
            } catch (fileErr) {
              console.warn(`[PandaDoc] Could not fetch default file "${f.name}" for proposal ${proposal.id}:`, fileErr);
            }
          }

          const agency = await getAgencyBranding(lead.subCompanyId);
          const clientCompanyName = lead.client?.name ?? 'Client';
          const signedPdfFilename = `${documentName} (Signed).pdf`;

          let signedFrom;
          try {
            ({ from: signedFrom } = await resolveOutboundUserSender({
              userId: lead.ownerId,
              subCompanyId: lead.subCompanyId,
              applyOmAgencyEmail: false,
            }));
          } catch (err) {
            if (isSenderDomainError(err)) {
              console.warn(
                `[PandaDoc] Skipping signed confirmation email — ${err.code}: ${err.message} proposal=${proposal.id}`,
              );
              signedFrom = null;
            } else {
              throw err;
            }
          }
          if (signedFrom) {
            await sendSignedDocumentConfirmationEmail({
              toEmail: contact.email,
              contactName: contact.name,
              clientCompanyName,
              senderName: agency?.name ?? DEFAULT_BRAND_NAME,
              agency,
              signedPdfBuffer: pdfBuffer,
              signedPdfFilename,
              defaultFileAttachments,
              proposalId: proposal.id,
              subCompanyId: lead.subCompanyId,
              from: signedFrom,
              fromUserId: lead.ownerId,
            });
            console.log(`[PandaDoc] Signed confirmation email sent to ${contact.email} for proposal ${proposal.id}`);
          }
        }
      } catch (emailErr) {
        console.error('[PandaDoc] Failed to send signed confirmation email', emailErr);
      }
    } catch (err) {
      console.error('[PandaDoc] Failed to download/store signed PDF', err);
    }
  }

  // Notify lead owner
  if (lead.ownerId) {
    if (status === 'document.completed') {
      await dispatchNotificationToUser({
        userId: lead.ownerId,
        subCompanyId: lead.subCompanyId,
        eventKey: 'proposal_signed',
        context: { entityLabel: clientName },
        link: `/proposals?manage=${proposal.id}`,
        relatedId: proposal.id,
      });
    } else if (status === 'document.declined') {
      await dispatchNotificationToUser({
        userId: lead.ownerId,
        subCompanyId: lead.subCompanyId,
        eventKey: 'proposal_declined',
        context: { entityLabel: clientName },
        link: `/proposals?manage=${proposal.id}`,
        relatedId: proposal.id,
      });
    }
  }

  // Emit socket refresh to lead owner + users with proposals:review (RBAC)
  const reviewerIds = await proposalReviewerIds(lead.subCompanyId);
  const recipientIds = [...new Set([
    ...(lead.ownerId ? [lead.ownerId] : []),
    ...reviewerIds,
  ])];
  emitToUsers(recipientIds, 'proposal:refresh', {
    proposalId: proposal.id,
    pandaDocStatus: status,
    label,
  });

  console.log(`[PandaDoc] Proposal ${proposal.id} pandaDocStatus → ${status}`);
}

// ─── POST /pandadoc/webhook ───────────────────────────────────────────────────

pandaDocRouter.post('/webhook', (req: Request, res: Response) => {
  // Acknowledge immediately — PandaDoc retries on non-2xx
  res.status(200).json({ received: true });

  const secret = env.PANDADOC_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers['x-pandadoc-signature'];
    if (typeof sig !== 'string') {
      console.warn('[PandaDoc] Webhook missing x-pandadoc-signature — processing anyway (secret configured but header absent)');
      // Allow through — PandaDoc may not send the header until the secret is saved in the dashboard
    } else {
      const rawBody = (req as any).rawBody?.toString('utf8') ?? JSON.stringify(req.body);
      if (!verifySignature(rawBody, sig, secret)) {
        console.warn('[PandaDoc] Webhook signature mismatch — discarding');
        return;
      }
    }
  }

  const events: PandaDocWebhookPayload[] = Array.isArray(req.body) ? req.body : [req.body];

  void (async () => {
    for (const event of events) {
      if (!event?.event || !event?.data?.id) continue;

      console.log('[PandaDoc] Event:', event.event, event.data.id, event.data.status);

      try {
        if (event.event === 'document_state_changed') {
          await handleDocumentStateChanged(
            event.data.id,
            event.data.name,
            event.data.status,
          );
        }
        // recipient_completed: no extra action needed — document.completed fires after all sign
      } catch (err) {
        console.error('[PandaDoc] Error processing webhook event', event.event, err);
      }
    }
  })();
});

// ─── GET /pandadoc/templates ──────────────────────────────────────────────────
// Default: agency-scoped via ProposalTypeTemplateMapping (fail closed).
// ?allAgencies=1: union of mappings for all agencies the caller can access.
// ?catalog=1|true: full PandaDoc list for Settings writers only.

pandaDocRouter.get(
  '/templates',
  authenticate,
  requirePermission(...TEMPLATE_LIST_PERMS),
  async (req: Request, res: Response) => {
    try {
      if (!pandaDocService.isAvailable()) {
        return res.status(503).json({ error: 'PandaDoc integration is not configured' });
      }
      const search = typeof req.query.q === 'string' ? req.query.q : undefined;
      const catalog =
        req.query.catalog === '1' || req.query.catalog === 'true';

      if (catalog) {
        if (!(await canAccessPandaDocCatalog(req))) {
          return res.status(403).json({ error: 'Catalog access requires settings:write' });
        }
        const templates = await pandaDocService.listTemplates(search);
        return res.json({ templates });
      }

      const { allowedIds } = await resolveTemplateListAllowedIds(req);
      if (allowedIds.length === 0) {
        return res.json({ templates: [] });
      }
      const all = await pandaDocService.listTemplates(search);
      return res.json({ templates: filterTemplatesByAllowedIds(all, allowedIds) });
    } catch (err) {
      return handleError(res, err);
    }
  },
);

// ─── GET /pandadoc/templates/details — enriched list with fields/tokens/roles ─
// Agency-scoped (or allAgencies union). No catalog mode.

pandaDocRouter.get(
  '/templates/details',
  authenticate,
  requirePermission(...TEMPLATE_LIST_PERMS),
  async (req: Request, res: Response) => {
    try {
      if (!pandaDocService.isAvailable()) {
        return res.status(503).json({ error: 'PandaDoc integration is not configured. Ensure PANDADOC_API_KEY is set.' });
      }
      const forceRefresh = req.query.refresh === 'true';
      const { allowedIds, agencyIds, allAgencies } = await resolveTemplateListAllowedIds(req);
      if (allowedIds.length === 0) {
        return res.json({ templates: [], total: 0 });
      }
      const all = await pandaDocService.listAllTemplatesWithDetails(forceRefresh);
      let templates = filterTemplatesByAllowedIds(all, allowedIds);

      if (agencyIds.length > 0) {
        const meta = await getPandaDocTemplateMappingMeta(agencyIds);
        // Always attach agency breakdown for All Agencies; single-agency gets proposalTypes only.
        const showAgencyBreakdown = allAgencies || agencyIds.length > 1;
        templates = templates.map((t) => {
          const agencies = meta.get(t.id) ?? [];
          const proposalTypes = [...new Set(agencies.flatMap((a) => a.roles))];
          return {
            ...t,
            proposalTypes,
            ...(showAgencyBreakdown ? { agencies } : {}),
          };
        });
      }

      return res.json({ templates, total: templates.length });
    } catch (err) {
      return handleError(res, err);
    }
  },
);

// ─── GET /pandadoc/prefill/:proposalId — auto-fill data for agreement wizard ──

pandaDocRouter.get(
  '/prefill/:proposalId',
  authenticate,
  requirePermission('leads:write'),
  async (req: Request, res: Response) => {
    try {
      const { proposalId } = req.params;
      const contactId = typeof req.query.contactId === 'string' ? req.query.contactId : undefined;

      const proposal = await prisma.proposal.findUnique({
        where: { id: proposalId },
        select: {
          id: true,
          agreementTypes: true,
          paymentTerms: true,
          tempPricingType: true,
          tempPricingValue: true,
          tempMinimumHours: true,
          directPricingType: true,
          directPricingValue: true,
          lead: {
            select: {
              value: true,
              stage: true,
              client: {
                select: {
                  name: true,
                  industry: true,
                  location: true,
                  address: true,
                  companySize: true,
                  contacts: {
                    select: {
                      id: true,
                      name: true,
                      title: true,
                      email: true,
                      phone: true,
                      isPrimary: true,
                      isUnsubscribed: true,
                    },
                    orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
                  },
                },
              },
              owner: {
                select: { firstName: true, lastName: true, email: true, phone: true },
              },
              subCompany: {
                select: { name: true },
              },
            },
          },
        },
      });

      if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

      const { lead } = proposal;
      const { client, owner, subCompany } = lead;

      const selectedContact = contactId
        ? client.contacts.find((c) => c.id === contactId)
        : client.contacts.find((c) => c.isPrimary && c.email) ?? client.contacts.find((c) => c.email);

      const nameParts = (selectedContact?.name ?? '').trim().split(/\s+/);
      const now = new Date();

      // ── Proposal-level computed values ────────────────────────────────────────
      const paymentDaysMatch = (proposal.paymentTerms as string | null)?.match(/\d+/);
      const paymentDays = paymentDaysMatch ? paymentDaysMatch[0] : '';
      const paymentTermsLabel = (proposal.paymentTerms as string | null)?.replace('net_', 'Net ') ?? '';
      const minimumHours = proposal.tempMinimumHours != null ? String(proposal.tempMinimumHours) : '';

      const agreementTypes = (proposal.agreementTypes as string[]) ?? [];
      let billingRate = '';
      if (agreementTypes.includes('temp') && proposal.tempPricingValue != null) {
        const v = Number(proposal.tempPricingValue);
        billingRate = proposal.tempPricingType === 'markup' ? `${v}%` : `$${v}/hr`;
      } else if (agreementTypes.includes('direct_placement') && proposal.directPricingValue != null) {
        const v = Number(proposal.directPricingValue);
        billingRate = (proposal.directPricingType === 'percentage' || proposal.directPricingType === 'markup') ? `${v}%` : `$${v}`;
      }

      const agreementTypeLabel = agreementTypes
        .map((t: string) => (t === 'temp' ? 'Temporary' : t === 'direct_placement' ? 'Direct Placement' : t))
        .join(' & ');

      return res.json({
        client: {
          name: client.name ?? '',
          industry: client.industry ?? '',
          location: client.location ?? '',
          address: client.address ?? '',
          companySize: client.companySize ?? '',
        },
        contact: selectedContact
          ? {
              name: selectedContact.name ?? '',
              firstName: nameParts[0] ?? '',
              lastName: nameParts.slice(1).join(' ') || (nameParts[0] ?? ''),
              title: selectedContact.title ?? '',
              email: selectedContact.email ?? '',
              phone: selectedContact.phone ?? '',
            }
          : null,
        sender: {
          name: `${owner.firstName} ${owner.lastName}`.trim(),
          firstName: owner.firstName,
          lastName: owner.lastName,
          email: owner.email,
          phone: owner.phone ?? '',
        },
        agency: { name: subCompany.name },
        lead: {
          value: lead.value ? String(lead.value) : '',
          stage: lead.stage ?? '',
        },
        date: {
          today: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
          todayShort: now.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }),
          year: String(now.getFullYear()),
        },
        proposal: {
          paymentDays,
          paymentTermsLabel,
          minimumHours,
          billingRate,
          agreementTypeLabel,
        },
        contacts: client.contacts.map((c) => ({
          id: c.id,
          name: c.name,
          title: c.title,
          email: c.email,
          phone: c.phone,
          isPrimary: c.isPrimary,
          isUnsubscribed: c.isUnsubscribed,
        })),
        selectedContactId: selectedContact?.id ?? null,
      });
    } catch (err) {
      return handleError(res, err);
    }
  },
);

// ─── GET /pandadoc/sent-documents — proposals with a linked PandaDoc document ─

pandaDocRouter.get(
  '/sent-documents',
  authenticate,
  requirePermission('leads:write'),
  async (req: Request, res: Response) => {
    try {
      const subCompanyId = req.user!.subCompanyId;

      const documents = await prisma.proposal.findMany({
        where: { pandaDocId: { not: null }, lead: { subCompanyId } },
        select: {
          id: true,
          pandaDocId: true,
          pandaDocStatus: true,
          pandaDocUpdatedAt: true,
          createdAt: true,
          lead: {
            select: {
              id: true,
              client: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { pandaDocUpdatedAt: 'desc' },
        take: 200,
      });

      return res.json({ documents });
    } catch (err) {
      return handleError(res, err);
    }
  },
);

// ─── GET /pandadoc/documents/:id ─────────────────────────────────────────────

pandaDocRouter.get(
  '/documents/:id',
  authenticate,
  requirePermission('leads:write'),
  async (req: Request, res: Response) => {
    try {
      if (!pandaDocService.isAvailable()) {
        return res.status(503).json({ error: 'PandaDoc integration is not configured' });
      }
      const doc = await pandaDocService.getDocument(req.params.id);
      return res.json({ document: doc });
    } catch (err) {
      return handleError(res, err);
    }
  },
);

// ─── POST /pandadoc/documents — create + send from template ──────────────────

const sendDocSchema = z.object({
  proposalId: z.string().uuid(),
  templateId: z.string().min(1),
  recipientEmail: z.string().email(),
  recipientFirstName: z.string().min(1),
  recipientLastName: z.string().min(1),
  recipientRole: z.string().min(1),
  message: z.string().optional(),
  tokens: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
});

pandaDocRouter.post(
  '/documents',
  authenticate,
  requirePermission('leads:write', 'proposals:write'),
  async (req: Request, res: Response) => {
    try {
      if (!pandaDocService.isAvailable()) {
        return res.status(503).json({ error: 'PandaDoc integration is not configured' });
      }

      const parsed = sendDocSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      }

      const { proposalId, templateId, recipientEmail, recipientFirstName, recipientLastName, recipientRole, tokens } = parsed.data;

      const proposal = await prisma.proposal.findUnique({
        where: { id: proposalId },
        select: {
          id: true,
          isForReview: true,
          selectedContactId: true,
          pandaDocId: true,
          pandaDocStatus: true,
          lead: { select: { id: true, ownerId: true, subCompanyId: true, clientId: true, client: { select: { name: true } } } },
        },
      });

      if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found' });
      }
      if (proposal.isForReview) {
        return res.status(409).json({ error: 'Review proposals do not use PandaDoc — no credits will be consumed' });
      }

      // Agency guard: only templates mapped for the proposal's agency
      const allowedIds = await getAllowedPandaDocTemplateIds(proposal.lead.subCompanyId);
      if (!allowedIds.includes(templateId)) {
        return res.status(403).json({
          error: 'This PandaDoc template is not assigned to the proposal agency. Map it in Settings → Proposal Templates.',
        });
      }

      // Prevent duplicate sends unless previous doc is voided or declined
      const activeStatuses = ['document.draft', 'document.sent', 'document.viewed', 'document.completed'];
      if (proposal.pandaDocId && proposal.pandaDocStatus && activeStatuses.includes(proposal.pandaDocStatus)) {
        return res.status(409).json({
          error: 'A document is already active for this proposal. Void it before sending a new one.',
          pandaDocStatus: proposal.pandaDocStatus,
        });
      }

      const doc = await pandaDocService.createFromTemplate({
        templateId,
        name: `${proposal.lead.client.name} — Agreement`,
        recipients: [{ email: recipientEmail, first_name: recipientFirstName, last_name: recipientLastName, role: recipientRole }],
        tokens,
        waitForDraft: true,
      });

      const recipientName = `${recipientFirstName} ${recipientLastName}`.trim() || recipientEmail;
      const subject = `Agreement Ready for Your Review — ${proposal.lead.client.name}`;
      const agency = await getAgencyBranding(proposal.lead.subCompanyId);
      const agencyLabel = agency?.name ?? 'us';
      const message =
        parsed.data.message?.trim() ||
        `Hi ${recipientFirstName},\n\nPlease review and sign your agreement with ${agencyLabel}.\n\nThank you.`;

      // CRM/SendGrid so From shows agency name (not PandaDoc workspace member).
      await sendPandaDocWithAgencyFrom({
        documentId: doc.id,
        recipientEmail,
        recipientName,
        subject,
        message,
        subCompanyId: proposal.lead.subCompanyId,
      });

      await prisma.proposal.update({
        where: { id: proposalId },
        data: { pandaDocId: doc.id, pandaDocStatus: 'document.sent', pandaDocUpdatedAt: new Date() },
      });

      // Persist into the CRM sent-email stream so "Sent" shows a complete history.
      const [pandaSendAgency, sender] = await Promise.all([
        Promise.resolve(agency),
        prisma.user.findUnique({
          where: { id: req.user!.sub },
          select: { email: true, firstName: true, lastName: true },
        }),
      ]);
      const fromEmail = pandaSendAgency?.emailFromAddress || sender?.email || '';
      const fromName =
        (pandaSendAgency?.emailFromName || '').trim() ||
        (pandaSendAgency?.name || '').trim() ||
        [sender?.firstName, sender?.lastName].filter(Boolean).join(' ') ||
        sender?.email ||
        DEFAULT_BRAND_NAME;
      const pandaDocUrl = `https://app.pandadoc.com/a/#/documents/${doc.id}`;
      const body = `<p>An agreement was sent to <strong>${recipientName}</strong> (${recipientEmail}).</p>
<p>Recipient role: ${recipientRole}</p>
<p>Document status: sent</p>
<p style="margin-top:16px">
  <a href="${pandaDocUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 14px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:13px;line-height:1.2">
    View document in PandaDoc
  </a>
</p>`;

      const sentEmail = await prisma.email.create({
        data: {
          subCompanyId: proposal.lead.subCompanyId,
          fromUserId: req.user!.sub,
          fromName,
          fromEmail,
          subject,
          body,
          folder: 'sent',
          clientId: proposal.lead.clientId,
          leadId: proposal.lead.id,
          isRead: true,
          recipients: {
            create: {
              recipientType: 'to',
              name: recipientName,
              emailAddress: recipientEmail,
              clientId: proposal.lead.clientId,
              contactId: proposal.selectedContactId ?? null,
            },
          },
        },
      });

      await createActivityLog({
        userId: req.user!.sub,
        userName: fromName,
        subCompanyId: proposal.lead.subCompanyId,
        type: 'email_sent',
        description: `Sent PandaDoc agreement to ${recipientName}`,
        metadata: {
          clientId: proposal.lead.clientId,
          clientName: proposal.lead.client.name,
          leadId: proposal.lead.id,
          proposalId,
          emailId: sentEmail.id,
          isPandaDocEmail: true,
          pandaDocId: doc.id,
          recipientEmail,
        },
      });

      emitToUsers([proposal.lead.ownerId, req.user!.sub], 'email:refresh', {
        subCompanyId: proposal.lead.subCompanyId,
      });

      return res.json({ documentId: doc.id, status: doc.status });
    } catch (err) {
      return handleError(res, err);
    }
  },
);

// ─── POST /pandadoc/documents/:id/void ───────────────────────────────────────

pandaDocRouter.post(
  '/documents/:id/void',
  authenticate,
  requirePermission('leads:write'),
  async (req: Request, res: Response) => {
    try {
      if (!pandaDocService.isAvailable()) {
        return res.status(503).json({ error: 'PandaDoc integration is not configured' });
      }

      const documentId = req.params.id;

      await pandaDocService.voidDocument(documentId);

      // Update the linked proposal's status
      await prisma.proposal.updateMany({
        where: { pandaDocId: documentId },
        data: { pandaDocStatus: 'document.voided', pandaDocUpdatedAt: new Date() },
      });

      return res.json({ voided: true });
    } catch (err) {
      return handleError(res, err);
    }
  },
);

// ─── POST /pandadoc/documents/:id/sync — replay missed webhook ───────────────
// Fetches current document status from PandaDoc API and re-runs handleDocumentStateChanged,
// which downloads the signed PDF, stores it, sends notifications, and emits socket refresh.

pandaDocRouter.post(
  '/documents/:id/sync',
  authenticate,
  requirePermission('leads:write'),
  async (req: Request, res: Response) => {
    try {
      if (!pandaDocService.isAvailable()) {
        return res.status(503).json({ error: 'PandaDoc integration is not configured' });
      }

      const documentId = req.params.id;
      const doc = await pandaDocService.getDocument(documentId);

      await handleDocumentStateChanged(documentId, doc.name, doc.status as PandaDocDocumentStatus);

      return res.json({ documentId, status: doc.status, synced: true });
    } catch (err) {
      return handleError(res, err);
    }
  },
);

// ─── POST /pandadoc/agreement-preview ─────────────────────────────────────────
// Creates a PandaDoc draft with all tokens auto-filled from proposal data,
// downloads the PDF, voids the draft, and returns base64 + fill report.

interface PreviewPrefill {
  client: { name: string; industry: string; location: string; address: string; companySize: string };
  contact: { name: string; firstName: string; lastName: string; title: string; email: string; phone: string } | null;
  sender: { name: string; firstName: string; lastName: string; email: string; phone: string };
  agency: { name: string };
  lead: { value: string; stage: string };
  date: { today: string; year: string };
  proposal: {
    paymentDays: string;       // "30" extracted from net_30
    paymentTermsLabel: string; // "Net 30"
    minimumHours: string;      // tempMinimumHours as string
    billingRate: string;       // formatted: "45%" or "$28/hr" or "15%"
    agreementTypeLabel: string; // "Temp / Temp to Permanent" or "Direct Placement"
  };
  signingAuthority?: { name: string };
}

function matchTokenPreview(rawName: string, prefill: PreviewPrefill): string {
  // Strip ALL non-alphanumeric so "#", "$", "%", "/", ",", spaces etc. are removed
  // e.g. "# of days" → "ofdays", "bill rate $/markup %" → "billratemarkup"
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
    // "Signing Authority, Designation" → stripped: "signingauthoritydesignation"
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
    // "# of days" → stripped: "ofdays"
    ofdays: prefill.proposal.paymentDays, numberofdays: prefill.proposal.paymentDays, numofdays: prefill.proposal.paymentDays,
    paymentdays: prefill.proposal.paymentDays, netdays: prefill.proposal.paymentDays,
    paymentterms: prefill.proposal.paymentTermsLabel, net: prefill.proposal.paymentTermsLabel,
    // ── Minimum hours / # of hours ──────────────────────────────────────────
    // "# of hours" → stripped: "ofhours", "# of Hours (Min. for Temp to Permanent)" → "ofhoursmintortempopermanent" (matches "ofhours" prefix? no — need exact)
    ofhours: prefill.proposal.minimumHours, numberofhours: prefill.proposal.minimumHours, numofhours: prefill.proposal.minimumHours,
    minimumhours: prefill.proposal.minimumHours, minhours: prefill.proposal.minimumHours, tempminimumhours: prefill.proposal.minimumHours,
    ofhoursmintortempopermanent: prefill.proposal.minimumHours, ofhoursminfortempopermanent: prefill.proposal.minimumHours,
    // ── Bill rate / Markup ──────────────────────────────────────────────────
    // "bill rate $/markup %" / "Placement_Fee_Percentage" → billingRate
    billratemarkup: prefill.proposal.billingRate, billrate: prefill.proposal.billingRate, billingrate: prefill.proposal.billingRate,
    markup: prefill.proposal.billingRate, markuppercentage: prefill.proposal.billingRate, markuppercent: prefill.proposal.billingRate,
    pricingvalue: prefill.proposal.billingRate, rate: prefill.proposal.billingRate, billrateorhourlyrate: prefill.proposal.billingRate,
    placementfeepercentage: prefill.proposal.billingRate, placementfee: prefill.proposal.billingRate,
    feepercentage: prefill.proposal.billingRate, feepercent: prefill.proposal.billingRate, recruitmentfee: prefill.proposal.billingRate,
    // ── Agreement type ──────────────────────────────────────────────────────
    agreementtype: prefill.proposal.agreementTypeLabel, typeofagreement: prefill.proposal.agreementTypeLabel,
    servicetype: prefill.proposal.agreementTypeLabel,
  };
  return map[n] ?? '';
}

/**
 * Build the same prefill data shape the live preview uses, but from a Prisma
 * proposal row — for the signed-doc fast path which can't call PandaDoc.
 */
type SignedPrefillSource = {
  selectedContactId: string | null;
  agreementTypes: unknown;
  paymentTerms: unknown;
  tempPricingType: string | null;
  tempPricingValue: unknown;
  tempMinimumHours: number | null;
  directPricingType: string | null;
  directPricingValue: unknown;
  lead: {
    value: unknown;
    stage: string | null;
    client: {
      name: string | null; industry: string | null; location: string | null; address: string | null; companySize: string | null;
      contacts: Array<{ id: string; name: string | null; title: string | null; email: string | null; phone: string | null; isPrimary: boolean }>;
    };
    owner: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null };
    subCompany: { name: string | null };
  };
};

function buildPreviewPrefill(p: SignedPrefillSource): PreviewPrefill {
  const { lead } = p;
  const { client, owner, subCompany } = lead;
  const selectedContact = p.selectedContactId
    ? client.contacts.find((c) => c.id === p.selectedContactId)
    : client.contacts.find((c) => c.isPrimary && c.email) ?? client.contacts.find((c) => c.email);
  const nameParts = (selectedContact?.name ?? '').trim().split(/\s+/);
  const now = new Date();

  const paymentDaysMatch = (p.paymentTerms as string | null)?.match(/\d+/);
  const paymentDays = paymentDaysMatch ? paymentDaysMatch[0] : '';
  const paymentTermsLabel = (p.paymentTerms as string | null)?.replace('net_', 'Net ') ?? '';
  const minimumHours = p.tempMinimumHours != null ? String(p.tempMinimumHours) : '';

  const agreementTypes = (p.agreementTypes as string[]) ?? [];
  let billingRate = '';
  if (agreementTypes.includes('temp') && p.tempPricingValue != null) {
    const v = Number(p.tempPricingValue);
    billingRate = p.tempPricingType === 'markup' ? `${v}%` : `$${v}/hr`;
  } else if ((agreementTypes.includes('direct_placement') || agreementTypes.includes('direct')) && p.directPricingValue != null) {
    const v = Number(p.directPricingValue);
    billingRate = (p.directPricingType === 'markup' || p.directPricingType === 'percentage') ? `${v}%` : `$${v}`;
  }

  const agreementTypeLabel = agreementTypes
    .map((t) => t === 'temp' ? 'Temp / Temp to Permanent' : 'Direct Placement')
    .join(', ');

  return {
    client: { name: client.name ?? '', industry: client.industry ?? '', location: client.location ?? '', address: client.address ?? '', companySize: client.companySize ?? '' },
    contact: selectedContact ? {
      name: selectedContact.name ?? '',
      firstName: nameParts[0] ?? '',
      lastName: nameParts.slice(1).join(' ') || (nameParts[0] ?? ''),
      title: selectedContact.title ?? '',
      email: selectedContact.email ?? '',
      phone: selectedContact.phone ?? '',
    } : null,
    sender: {
      name: `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim() || (owner.email ?? ''),
      firstName: owner.firstName ?? '',
      lastName: owner.lastName ?? '',
      email: owner.email ?? '',
      phone: owner.phone ?? '',
    },
    agency: { name: subCompany.name ?? '' },
    lead: { value: lead.value ? String(lead.value) : '', stage: lead.stage ?? '' },
    date: {
      today: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      year: String(now.getFullYear()),
    },
    proposal: { paymentDays, paymentTermsLabel, minimumHours, billingRate, agreementTypeLabel },
  };
}

/**
 * Optional CRM fields (address, company size) — excluded from the fill report
 * so blank values don't show as "missing". Mapping is commented out above too.
 */
function isOptionalFillToken(rawName: string): boolean {
  const n = rawName.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    n === 'clientaddress' ||
    n === 'address' ||
    n === 'companysize' ||
    n === 'clientcompanysize'
  );
}

/**
 * Build a displayable {name,value,filled}[] list from a proposal's prefill data
 * for the signed-doc fast path (no PandaDoc template tokens available).
 */
function buildSignedFilledTokens(p: SignedPrefillSource): Array<{ name: string; value: string; filled: boolean }> {
  const prefill = buildPreviewPrefill(p);
  const items: Array<{ name: string; value: string }> = [
    { name: 'Client Name', value: prefill.client.name },
    { name: 'Client Industry', value: prefill.client.industry },
    { name: 'Client Location', value: prefill.client.location },
    // Optional CRM extras — commented out so empty values don't inflate "missing"
    // { name: 'Client Address', value: prefill.client.address },
    // { name: 'Company Size', value: prefill.client.companySize },
    { name: 'Contact Name', value: prefill.contact?.name ?? '' },
    { name: 'Contact First Name', value: prefill.contact?.firstName ?? '' },
    { name: 'Contact Last Name', value: prefill.contact?.lastName ?? '' },
    { name: 'Contact Title', value: prefill.contact?.title ?? '' },
    { name: 'Contact Email', value: prefill.contact?.email ?? '' },
    { name: 'Contact Phone', value: prefill.contact?.phone ?? '' },
    { name: 'Sender Name', value: prefill.sender.name },
    { name: 'Sender Email', value: prefill.sender.email },
    { name: 'Sender Phone', value: prefill.sender.phone },
    { name: 'Agency Name', value: prefill.agency.name },
    { name: 'Date', value: prefill.date.today },
    { name: 'Year', value: prefill.date.year },
    { name: 'Lead Value', value: prefill.lead.value },
    { name: 'Payment Terms', value: prefill.proposal.paymentTermsLabel },
    { name: 'Payment Days', value: prefill.proposal.paymentDays },
    { name: 'Minimum Hours', value: prefill.proposal.minimumHours },
    { name: 'Bill Rate / Markup', value: prefill.proposal.billingRate },
    { name: 'Agreement Type', value: prefill.proposal.agreementTypeLabel },
  ];
  return items.map((i) => ({ name: i.name, value: i.value, filled: !!i.value.trim() }));
}

pandaDocRouter.post(
  '/agreement-preview',
  authenticate,
  requirePermission('leads:write'),
  async (req: Request, res: Response) => {
    try {
      if (!pandaDocService.isAvailable()) {
        return res.status(503).json({ error: 'PandaDoc integration is not configured' });
      }

      const { proposalId } = req.body;
      if (!proposalId || typeof proposalId !== 'string') {
        return res.status(400).json({ error: 'proposalId is required' });
      }

      const proposal = await prisma.proposal.findUnique({
        where: { id: proposalId },
        select: {
          id: true,
          isForReview: true,
          reviewTemplateId: true,
          pandaDocId: true,
          pandaDocStatus: true,
          pandaDocTemplateId: true,
          pandaDocTemplateName: true,
          selectedContactId: true,
          agreementTypes: true,
          paymentTerms: true,
          tempPricingType: true,
          tempPricingValue: true,
          tempMinimumHours: true,
          directPricingType: true,
          directPricingValue: true,
          previewPdfUrl: true,
          previewPdfHash: true,
          previewPdfStatus: true,
          lead: {
            select: {
              value: true,
              stage: true,
              subCompanyId: true,
              client: {
                select: {
                  name: true, industry: true, location: true, address: true, companySize: true,
                  contacts: {
                    select: { id: true, name: true, title: true, email: true, phone: true, isPrimary: true },
                    orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
                  },
                },
              },
              owner: { select: { firstName: true, lastName: true, email: true, phone: true } },
              subCompany: { select: { name: true } },
            },
          },
        },
      });

      if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
      if (proposal.isForReview) {
        return res.status(422).json({ error: 'review_proposal', message: 'Use /proposals/:id/review-preview for review proposals — no PandaDoc credits needed' });
      }
      if (!proposal.pandaDocTemplateId) {
        return res.status(422).json({ error: 'No PandaDoc template selected on this proposal' });
      }

      // ── Fast path: document is signed — serve the stored signed PDF from R2,
      // no PandaDoc API call needed (the webhook saved it on completion). ────
      if (proposal.pandaDocStatus === 'document.completed') {
        const signedDoc = await prisma.proposalDocument.findFirst({
          where: { proposalId: proposal.id, category: 'received_from_client', deliveryStatus: 'signed' },
          orderBy: { createdAt: 'desc' },
          select: { url: true, name: true },
        });
        if (signedDoc?.url) {
          try {
            let pdfBuffer: Buffer | null = null;
            if (signedDoc.url.startsWith('http://') || signedDoc.url.startsWith('https://')) {
              const r = await fetch(signedDoc.url);
              if (r.ok) pdfBuffer = Buffer.from(await r.arrayBuffer());
            } else {
              const r2 = await getFromR2(signedDoc.url);
              if (r2) pdfBuffer = r2.body;
            }
            if (pdfBuffer) {
              // Synthesize filled tokens from the prefill data so the left panel
              // still shows the values that were used. Avoids any PandaDoc call.
              const filledTokens = buildSignedFilledTokens(proposal);
              const filledCount = filledTokens.filter((t) => t.filled).length;
              return res.json({
                pdfBase64: pdfBuffer.toString('base64'),
                templateName: proposal.pandaDocTemplateName ?? signedDoc.name ?? '',
                filledTokens,
                total: filledTokens.length,
                filled: filledCount,
                cached: true,
              });
            }
          } catch (err) {
            console.warn('[PandaDoc] Could not load stored signed PDF, falling through:', err);
          }
        }
      }

      // ── Fast path: document already exists — just download its PDF ─────────
      if (proposal.pandaDocId && proposal.pandaDocStatus === 'document.draft') {
        try {
          const pdfBuffer = await pandaDocService.downloadPdf(proposal.pandaDocId);
          const templates = await pandaDocService.listAllTemplatesWithDetails();
          const tpl = templates.find((t) => t.id === proposal.pandaDocTemplateId);
          return res.json({
            pdfBase64: pdfBuffer.toString('base64'),
            templateName: tpl?.name ?? proposal.pandaDocTemplateName ?? '',
            filledTokens: [],
            total: tpl?.tokens.length ?? 0,
            filled: tpl?.tokens.length ?? 0,
            cached: true,
          });
        } catch (err) {
          // Fall through to full generation if download fails
          console.warn('[PandaDoc] Fast preview download failed, falling back to generation:', err);
        }
      }

      // ── Cache check ────────────────────────────────────────────────────────
      const currentHash = computePreviewHash(proposal as Parameters<typeof computePreviewHash>[0]);

      if (proposal.previewPdfStatus === 'ready' && proposal.previewPdfHash === currentHash && proposal.previewPdfUrl) {
        const jsonKey = proposal.previewPdfUrl.replace(/\.pdf$/, '.json');
        const [cached, cachedMeta] = await Promise.all([
          getFromR2(proposal.previewPdfUrl),
          getFromR2(jsonKey),
        ]);
        if (cached) {
          if (cachedMeta) {
            const meta = JSON.parse(cachedMeta.body.toString()) as {
              templateName: string;
              filledTokens: { name: string; value: string; filled: boolean }[];
              total: number;
              filled: number;
            };
            return res.json({
              pdfBase64: cached.body.toString('base64'),
              templateName: meta.templateName,
              filledTokens: meta.filledTokens,
              total: meta.total,
              filled: meta.filled,
              cached: true,
            });
          }
          // Old cache entry without JSON — fall through to live generation so fill report is computed
        }
      }

      if (proposal.previewPdfStatus === 'generating') {
        // Background job is running — tell frontend to poll
        return res.status(202).json({ status: 'still_generating' });
      }

      // Cache miss or stale — run live generation and cache result in background
      // ── End cache check ────────────────────────────────────────────────────

      // Get template details (cached)
      const templates = await pandaDocService.listAllTemplatesWithDetails();
      const template = templates.find((t) => t.id === proposal.pandaDocTemplateId);
      if (!template) {
        return res.status(404).json({ error: 'Template not found in PandaDoc. It may have been deleted.' });
      }

      // Build prefill data (same logic as /prefill/:proposalId)
      const { lead } = proposal;
      const { client, owner, subCompany } = lead;

      const selectedContact = proposal.selectedContactId
        ? client.contacts.find((c) => c.id === proposal.selectedContactId)
        : client.contacts.find((c) => c.isPrimary && c.email) ?? client.contacts.find((c) => c.email);

      const contactNameParts = (selectedContact?.name ?? '').trim().split(/\s+/);
      const now = new Date();

      // Derived proposal values
      const paymentDaysMatch = (proposal.paymentTerms as string).match(/\d+/);
      const paymentDays = paymentDaysMatch ? paymentDaysMatch[0] : '';
      const paymentTermsLabel = (proposal.paymentTerms as string).replace('net_', 'Net ');
      const minimumHours = proposal.tempMinimumHours != null ? String(proposal.tempMinimumHours) : '';

      // Format billing rate: prefer temp pricing, fall back to direct
      let billingRate = '';
      if (proposal.agreementTypes.includes('temp') && proposal.tempPricingValue != null) {
        const v = Number(proposal.tempPricingValue);
        billingRate = proposal.tempPricingType === 'markup' ? `${v}%` : `$${v}/hr`;
      } else if ((proposal.agreementTypes.includes('direct_placement') || proposal.agreementTypes.includes('direct')) && proposal.directPricingValue != null) {
        const v = Number(proposal.directPricingValue);
        billingRate = (proposal.directPricingType === 'markup' || proposal.directPricingType === 'percentage') ? `${v}%` : `$${v}`;
      }

      const agreementTypeLabel = proposal.agreementTypes
        .map((t: string) => t === 'temp' ? 'Temp / Temp to Permanent' : 'Direct Placement')
        .join(', ');

      const prefill: PreviewPrefill = {
        client: { name: client.name ?? '', industry: client.industry ?? '', location: client.location ?? '', address: client.address ?? '', companySize: client.companySize ?? '' },
        contact: selectedContact ? {
          name: selectedContact.name ?? '',
          firstName: contactNameParts[0] ?? '',
          lastName: contactNameParts.slice(1).join(' ') || (contactNameParts[0] ?? ''),
          title: selectedContact.title ?? '',
          email: selectedContact.email ?? '',
          phone: selectedContact.phone ?? '',
        } : null,
        sender: {
          name: `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim() || (owner.email ?? ''),
          firstName: owner.firstName ?? '',
          lastName: owner.lastName ?? '',
          email: owner.email ?? '',
          phone: owner.phone ?? '',
        },
        agency: { name: subCompany.name ?? '' },
        lead: { value: lead.value ? String(lead.value) : '', stage: lead.stage ?? '' },
        date: {
          today: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
          year: String(now.getFullYear()),
        },
        proposal: { paymentDays, paymentTermsLabel, minimumHours, billingRate, agreementTypeLabel },
        signingAuthority: await prisma.signingAuthority.findFirst({
          where: { subCompanyId: lead.subCompanyId, isPrimary: true },
          select: { name: true },
        }).then(r => r ? { name: r.name } : undefined),
      };

      // Map every token to its auto-filled value (skip optional CRM extras)
      const filledTokens = template.tokens
        .filter((t) => !isOptionalFillToken(t.name))
        .map((t) => ({
          name: t.name,
          value: matchTokenPreview(t.name, prefill),
          filled: !!matchTokenPreview(t.name, prefill).trim(),
        }));

      // Render PDF locally — no PandaDoc API call, no credit consumed.
      // Prefers the director's uploaded PDF (filled via anchors) when available;
      // falls back to the hardcoded staffing-agreement renderer, and finally to
      // the generic preview PDF.
      const proposalPrefill = prefill as unknown as ProposalPrefill;
      const agreementTypes = proposal.agreementTypes as string[];
      // Prefer template stamped on the proposal; fall back to current active Settings slot.
      let reviewTemplateId: string | undefined = proposal.reviewTemplateId ?? undefined;
      if (!reviewTemplateId) {
        const reviewSlot = (() => {
          const hasTemp = agreementTypes.includes('temp');
          const hasDirect = agreementTypes.some((t) => t.startsWith('direct'));
          if (hasTemp && hasDirect) return 'both_agreement';
          if (hasTemp) return 'temp_agreement';
          return 'direct_placement';
        })();
        const reviewTpl = await prisma.reviewTemplate.findFirst({
          where: { subCompanyId: lead.subCompanyId, documentType: reviewSlot, isActive: true },
          select: { id: true },
          orderBy: { createdAt: 'desc' },
        });
        reviewTemplateId = reviewTpl?.id;
      } else {
        // Ensure stamped id still belongs to this agency (retired rows are OK).
        const stamped = await prisma.reviewTemplate.findFirst({
          where: { id: reviewTemplateId, subCompanyId: lead.subCompanyId },
          select: { id: true },
        });
        if (!stamped) reviewTemplateId = undefined;
      }
      let pdfBuffer: Buffer;
      try {
        const rendered = await renderReviewPdf(proposalPrefill, { templateId: reviewTemplateId });
        if (!rendered) {
          pdfBuffer = await generateProposalPreviewPdf(proposalPrefill);
        } else {
          pdfBuffer = rendered;
        }
      } catch (renderErr) {
        console.warn('[PandaDoc preview] renderReviewPdf failed, using fallback renderer:', renderErr);
        pdfBuffer = await generateProposalPreviewPdf(proposalPrefill);
      }

      const filled = filledTokens.filter((t) => t.filled).length;

      // Cache result in background for next time (PDF + JSON fill report)
      void (async () => {
        try {
          const r2Key = `pandadoc/preview/${proposalId}.pdf`;
          const tokensMeta = { templateName: template.name, filledTokens, total: template.tokens.length, filled };
          await Promise.all([
            uploadToR2(r2Key, pdfBuffer, 'application/pdf'),
            uploadToR2(`pandadoc/preview/${proposalId}.json`, Buffer.from(JSON.stringify(tokensMeta)), 'application/json'),
          ]);
          await prisma.proposal.update({
            where: { id: proposalId },
            data: { previewPdfUrl: r2Key, previewPdfHash: currentHash, previewPdfStatus: 'ready' },
          });
        } catch { /* Non-fatal */ }
      })();

      return res.json({
        pdfBase64: pdfBuffer.toString('base64'),
        templateName: template.name,
        filledTokens,
        total: template.tokens.length,
        filled,
      });
    } catch (err) {
      return handleError(res, err);
    }
  },
);

// ─── Error helper ─────────────────────────────────────────────────────────────

function handleError(res: Response, err: unknown): Response {
  if (err instanceof PandaDocError) {
    return res.status(err.statusCode ?? 500).json({
      error: err.message,
      details: err.body,
    });
  }
  console.error('[PandaDoc] Unexpected error', err);
  return res.status(500).json({ error: 'Internal server error' });
}
