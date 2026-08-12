import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { authenticate } from '../middleware/auth';
import { actAsMiddleware, effectiveActorId } from '../middleware/actAs';
import prisma from '../config/database';
import { dispatchNotification, dispatchNotificationToUser } from '../services/notificationDispatch';
import { getApprovalEventKey } from '../services/notificationRegistry';
import { emitToUsers } from '../socket';
import { sendProposalSubmittedEmail, sendProposalApprovedEmail, sendProposalRejectedEmail, getAgencyBranding, sendClientEmail, buildClientProposalEmailHtml, sendReviewEmailToClient, htmlToPlainText, buildCrmReplyToAddress, resolveOutboundUserSender, type ClientProposalEmailData } from '../services/email';
import { isSenderDomainError } from '../services/senderDomainErrors';
import { sendProposalSubmittedEmail, sendProposalApprovedEmail, sendProposalRejectedEmail, getAgencyBranding, sendClientEmail, buildClientProposalEmailHtml, htmlToPlainText, buildCrmReplyToAddress, type ClientProposalEmailData } from '../services/email';
import { resolveUserSender, senderUserSelect, resolveSenderSignatureBlock, injectSenderSignature } from '../services/sender';
import {
  pandaDocService,
  matchProposalToken,
  sendPandaDocWithAgencyFrom,
  type ProposalPrefill,
} from '../services/pandadoc';
import { renderReviewPdf } from '../services/reviewPdf';
import { createActivityLog } from '../services/activityLog';
import { autoAssignOwnershipForClosedWon } from '../services/clientOwnership';
import { invalidateClientListCache } from '../services/clientListCache';
import { syncClientStatusFromLeadOutcomes } from '../services/leadClientStatus';
import { uploadToR2, getFromR2 } from '../services/r2Storage';
import { uploadSignatureImageToR2 } from '../services/signingAuthority';
import { env } from '../config/env';
import { resolveAgencyScope, resolveAllowedSubCompanyIds } from '../config/agencyScope';
import { resolveClientDetailScope } from '../services/clientAgencyAccess';
import { canReviewProposals, proposalReviewerIds } from '../services/proposalAccess';
import { ensureAccessContext, requestHasPermission } from '../utils/requestPermission';
import { isOwnDataOnlyScope } from '../services/accessContext';
import { expandLinkedOwnerScope, linkedExpansionToWhere, ownerExactFromQuery } from '../services/linkedOwnerExpand';
import { requirePermission } from '../middleware/requirePermission';
import {
  authorizeApprovalAction,
  notifyChainTargetUsers,
  performApprovalAction,
  submitEntityForApproval,
} from '../services/approvalActions';
import {
  isBothAgreementTypes,
  loadPairByProposalId,
  loadPairByPairId,
  markPairStatus,
  reviewEmailDocumentLabel,
  serializePairSummary,
  collapsePairedProposals,
  resolvePairAuthEntityId,
  pairMemberLabel,
} from '../services/proposalPair';
import { sendReviewEmailForProposal } from '../services/proposalReviewSend';
import { recordOutboundSentEmail } from '../services/recordOutboundSentEmail';
/** View/list proposal data (any proposal role grant). */
const proposalAccess = requirePermission('proposals:read', 'proposals:write', 'proposals:review');
/** Submit / edit own proposals. */
const proposalWrite = requirePermission('proposals:write');
/** Manager review, approve, reject, activate. */
const proposalReview = requirePermission('proposals:review');

const attachmentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

type UploadedProposalAttachment = { buffer: Buffer; mimetype: string; originalname: string };
type UploadAttachmentRequest = Request & { file?: UploadedProposalAttachment };

const router = Router();

async function canAccessProposalAgency(req: Request, subCompanyId: string): Promise<boolean> {
  if (!req.user) return false;
  const allowedSubCompanyIds = await resolveAllowedSubCompanyIds(req.user);
  return allowedSubCompanyIds.includes(subCompanyId);
}

// Maps proposal agreementTypes[] → ReviewTemplate.documentType slot
function reviewSlot(types: string[]): string {
  const hasTemp   = types.includes('temp');
  const hasDirect = types.some((t) => t.startsWith('direct'));
  if (hasTemp && hasDirect) return 'both_agreement';
  if (hasTemp) return 'temp_agreement';
  return 'direct_placement';
}

/**
 * Resolve which review template to use for preview/send.
 * Prefer the id stamped on the proposal at create time (history-stable).
 * Fall back to the agency's current *active* template for the agreement slot
 * (legacy rows where reviewTemplateId was never set).
 */
async function resolveReviewTemplate(
  subCompanyId: string,
  types: string[],
  stampedTemplateId?: string | null,
): Promise<{ templateId: string | null }> {
  if (stampedTemplateId) {
    const stamped = await prisma.reviewTemplate.findFirst({
      where: { id: stampedTemplateId, subCompanyId },
      select: { id: true },
    });
    if (stamped) return { templateId: stamped.id };
  }
  const slot = reviewSlot(types);
  const tpl = await prisma.reviewTemplate.findFirst({
    where: { subCompanyId, documentType: slot, isActive: true },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  });
  return { templateId: tpl?.id ?? null };
}
router.use(authenticate);
router.use(actAsMiddleware);


/** Lead is fully won or lost — awaiting-client response timer must not run. */
function isLeadAwaitingTimerTerminated(status: string): boolean {
  return status === 'closed_won' || status === 'closed_lost';
}

function isProposalAwaitingClientPhase(lead: { stage: string; status: string }): boolean {
  return lead.stage === 'awaiting_client_approval' && lead.status === 'closed_won_pending';
}

async function getAwaitingClientTimerDays(subCompanyId: string): Promise<number> {
  const row = await prisma.proposalAwaitingClientSetting.findUnique({
    where: { subCompanyId },
    select: { days: true },
  });
  return Math.max(0, row?.days ?? 7);
}

// ─── GET /proposals/default-files ─────────────────────────────────────────────
// Any authenticated user can fetch the agency's director-set default files
// so they can select them when composing a proposal.
router.get('/default-files', proposalAccess, async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
  const files = await prisma.proposalDefaultFile.findMany({
    where: { subCompanyId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, fileUrl: true, mimeType: true, createdAt: true },
  });
  return res.json({ data: files });
});

// ─── POST /proposals/attachments/upload ──────────────────────────────────────
// Upload a proposal attachment file to R2 before proposal submission.
// Returns the R2 key so it can be passed as the attachment url on submit.
router.post('/attachments/upload', proposalWrite, attachmentUpload.single('file'), async (req: UploadAttachmentRequest, res: Response) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file provided' });
  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const fileKey = `proposal-attachments/${randomUUID()}-${safeName}`;
  const url = await uploadToR2(fileKey, file.buffer, file.mimetype);
  if (!url) return res.status(503).json({ error: 'Storage not available' });
  return res.json({ fileKey: url });
});

// ─── GET /proposals/attachments/:id ──────────────────────────────────────────
// Serve a proposal attachment (auth-gated). Redirects to public URL if available,
// otherwise proxies from R2.
router.get('/attachments/:id', proposalAccess, async (req: Request, res: Response) => {
  const attachment = await prisma.proposalAttachment.findUnique({ where: { id: req.params.id } });
  if (!attachment) return res.status(404).json({ error: 'Attachment not found' });
  const url = attachment.url;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return res.redirect(302, url);
  }
  const r2 = await getFromR2(url);
  if (!r2) return res.status(404).json({ error: 'File not found in storage' });
  res.setHeader('Content-Type', r2.contentType ?? 'application/octet-stream');
  const safeName = attachment.name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '_');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  return res.send(r2.body);
});

// ─── GET /proposals/default-files/:id/preview ────────────────────────────────
// Stream a default file inline. Accepts either a ProposalSelectedDefaultFile id
// (snapshot on a proposal) or a ProposalDefaultFile id (settings library).
router.get('/default-files/:id/preview', proposalAccess, async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  // Try snapshot record first (used from the proposals detail view)
  const snapshot = await prisma.proposalSelectedDefaultFile.findUnique({
    where: { id: req.params.id },
    select: { name: true, fileUrl: true, mimeType: true },
  });

  // Fall back to original ProposalDefaultFile (used from settings)
  const original = snapshot ? null : await prisma.proposalDefaultFile.findFirst({
    where: { id: req.params.id, subCompanyId },
    select: { name: true, fileUrl: true, mimeType: true },
  });

  const file = snapshot ?? original;
  if (!file) return res.status(404).json({ error: 'File not found' });

  const fileUrl = file.fileUrl.trim();

  // If it's an absolute URL, redirect to it
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
    return res.redirect(302, fileUrl);
  }

  const r2 = await getFromR2(fileUrl);
  if (!r2) return res.status(404).json({ error: 'File not found in storage' });

  const contentType = r2.contentType ?? file.mimeType ?? 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `inline; filename="${file.name.replace(/[^\w.-]/g, '_')}"`);
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  return res.send(r2.body);
});

// ─── GET /proposals/job-titles ───────────────────────────────────────────────
// Returns the agency's allowed job titles for use as position options.
router.get('/job-titles', proposalAccess, async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
  const titles = await prisma.allowedJobTitle.findMany({
    where: { subCompanyId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  return res.json({ data: titles });
});

// ─── POST /proposals ──────────────────────────────────────────────────────────
// Called by the lead owner after filling ProposalDialog.
// Creates DB record, moves lead stage to proposal_sent, notifies managers.
router.post('/', proposalWrite, async (req: Request, res: Response) => {
  const {
    leadId,
    locationType,
    agreementTypes,
    tempPricingType,
    tempPricingValue,
    tempMinimumHours,
    directPricingType,
    directPricingValue,
    paymentTerms,
    comment,
    clientMessage,
    attachments = [],
    selectedDefaultFileIds = [],
    selectedContactId,
    pandaDocTemplateId,
    pandaDocTemplateName,
    positions = [],
    isForReview = false,
    reviewTemplateId,
  } = req.body;

  const actorId = effectiveActorId(req);

  const lead = await prisma.lead.findFirst({
    where: { id: leadId },
    include: {
      owner: { select: { id: true, firstName: true, lastName: true, email: true, reportingManagerIds: true } },
      client: { select: { id: true, name: true } },
      subCompany: { select: { id: true } },
    },
  });

  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const isOwner = lead.ownerId === actorId;
  const canSubmitAsOwner = isOwner && (await requestHasPermission(req, 'proposals:write'));
  const canSubmitAsReviewer = !isOwner && (await canReviewProposals(req));

  if (!canSubmitAsOwner && !canSubmitAsReviewer) {
    return res.status(403).json({ error: 'Not authorized to submit proposals' });
  }

  const leadAgencyId = lead.subCompany.id;

  // Only one pending proposal (or one pending Both-pair) at a time
  const existingPending = await prisma.proposal.findMany({
    where: { leadId, status: 'pending' },
    select: { id: true, proposalPairId: true },
  });
  if (existingPending.length > 0) {
    return res.status(409).json({ error: 'A pending proposal already exists for this lead' });
  }

  const ownerName = `${lead.owner.firstName ?? ''} ${lead.owner.lastName ?? ''}`.trim() || lead.owner.email;
  const types = (agreementTypes as string[]) ?? [];
  const createBothPair = isBothAgreementTypes(types);

  // Resolve agency PandaDoc type templates (Both uses temp + direct, never bothTemplate)
  const typeMapping = await prisma.proposalTypeTemplateMapping.findUnique({
    where: { subCompanyId: lead.subCompanyId },
  });

  type AttachmentIn = { name: string; size: number; type: string; url: string };
  type PositionIn = { name: string; count: number };
  const attachmentRows = (attachments as AttachmentIn[]).map((a) => ({
    name: a.name,
    size: BigInt(a.size),
    type: a.type,
    url: a.url,
  }));
  const validPositions = Array.isArray(positions)
    ? (positions as PositionIn[]).filter(
        (pos) => typeof pos.name === 'string' && pos.name.trim() && Number.isInteger(Number(pos.count)) && Number(pos.count) > 0,
      )
    : [];

  async function snapshotDefaults(tx: typeof prisma, proposalId: string) {
    if (!Array.isArray(selectedDefaultFileIds) || selectedDefaultFileIds.length === 0) return;
    const defaultFiles = await tx.proposalDefaultFile.findMany({
      where: { id: { in: selectedDefaultFileIds }, subCompanyId: leadAgencyId },
      select: { id: true, name: true, fileUrl: true, mimeType: true },
    });
    if (defaultFiles.length === 0) return;
    await tx.proposalSelectedDefaultFile.createMany({
      data: defaultFiles.map((f) => ({
        proposalId,
        defaultFileId: f.id,
        name: f.name,
        fileUrl: f.fileUrl,
        mimeType: f.mimeType ?? null,
      })),
    });
  }

  async function snapshotPositions(tx: typeof prisma, proposalId: string) {
    if (validPositions.length === 0) return;
    await tx.proposalPosition.createMany({
      data: validPositions.map((pos) => ({
        proposalId,
        name: String(pos.name).trim(),
        count: Number(pos.count),
      })),
    });
  }

  let proposal: Awaited<ReturnType<typeof prisma.proposal.create>> & { attachments: Array<{ id: string; size: bigint; name: string; type: string; url: string }> };
  let pairSiblingId: string | null = null;

  if (createBothPair) {
    if (!typeMapping?.tempTemplateId || !typeMapping?.directTemplateId) {
      return res.status(422).json({
        error: 'Both requires Temp and Direct proposal templates configured in Settings → Proposal Templates',
      });
    }

    const pairId = randomUUID();
    let tempReviewId: string | null = null;
    let directReviewId: string | null = null;
    if (Boolean(isForReview)) {
      tempReviewId = (await resolveReviewTemplate(lead.subCompanyId, ['temp'], null)).templateId;
      directReviewId = (await resolveReviewTemplate(lead.subCompanyId, ['direct_placement'], null)).templateId;
      if (!tempReviewId || !directReviewId) {
        return res.status(422).json({
          error: 'Both review requires active Temp and Direct review templates in Settings → Review Templates',
        });
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const shared = {
        leadId,
        createdById: actorId,
        locationType,
        paymentTerms,
        comment: comment ?? null,
        clientMessage: clientMessage ?? null,
        isForReview: Boolean(isForReview),
        status: 'pending' as const,
        currentStepIndex: 0,
        approvalChain: [],
        selectedContactId: selectedContactId ?? null,
        proposalPairId: pairId,
      };

      const tempRow = await tx.proposal.create({
        data: {
          ...shared,
          pairRole: 'temp',
          agreementTypes: ['temp'],
          tempPricingType: tempPricingType ?? null,
          tempPricingValue: tempPricingValue != null ? Number(tempPricingValue) : null,
          tempMinimumHours: tempMinimumHours ?? null,
          directPricingType: null,
          directPricingValue: null,
          reviewTemplateId: tempReviewId,
          pandaDocTemplateId: typeMapping.tempTemplateId,
          pandaDocTemplateName: typeMapping.tempTemplateName ?? null,
          attachments: { create: attachmentRows },
        },
        include: { attachments: true },
      });

      const directRow = await tx.proposal.create({
        data: {
          ...shared,
          pairRole: 'direct',
          agreementTypes: ['direct_placement'],
          tempPricingType: null,
          tempPricingValue: null,
          tempMinimumHours: null,
          directPricingType: directPricingType ?? null,
          directPricingValue: directPricingValue != null ? Number(directPricingValue) : null,
          reviewTemplateId: directReviewId,
          pandaDocTemplateId: typeMapping.directTemplateId,
          pandaDocTemplateName: typeMapping.directTemplateName ?? null,
          attachments: { create: attachmentRows },
        },
        include: { attachments: true },
      });

      await snapshotDefaults(tx as any, tempRow.id);
      await snapshotDefaults(tx as any, directRow.id);
      await snapshotPositions(tx as any, tempRow.id);
      await snapshotPositions(tx as any, directRow.id);

      await tx.lead.update({
        where: { id: leadId },
        data: { stage: 'proposal_sent', updatedAt: new Date() },
      });

      return { tempRow, directRow };
    });

    proposal = created.tempRow as typeof proposal;
    pairSiblingId = created.directRow.id;
  } else {
    // Stamp the review template used at create time so history/preview stay stable
    let stampedReviewTemplateId: string | null = null;
    if (Boolean(isForReview)) {
      const resolved = await resolveReviewTemplate(
        lead.subCompanyId,
        types,
        typeof reviewTemplateId === 'string' ? reviewTemplateId : null,
      );
      stampedReviewTemplateId = resolved.templateId;
    }

    proposal = await prisma.$transaction(async (tx) => {
      const p = await tx.proposal.create({
        data: {
          leadId,
          createdById: actorId,
          locationType,
          agreementTypes: types,
          tempPricingType: tempPricingType ?? null,
          tempPricingValue: tempPricingValue != null ? Number(tempPricingValue) : null,
          tempMinimumHours: tempMinimumHours ?? null,
          directPricingType: directPricingType ?? null,
          directPricingValue: directPricingValue != null ? Number(directPricingValue) : null,
          paymentTerms,
          comment: comment ?? null,
          clientMessage: clientMessage ?? null,
          isForReview: Boolean(isForReview),
          reviewTemplateId: stampedReviewTemplateId,
          status: 'pending',
          currentStepIndex: 0,
          approvalChain: [],
          selectedContactId: selectedContactId ?? null,
          pandaDocTemplateId: pandaDocTemplateId ?? null,
          pandaDocTemplateName: pandaDocTemplateName ?? null,
          attachments: { create: attachmentRows },
        },
        include: { attachments: true },
      });

      await snapshotDefaults(tx as any, p.id);
      await snapshotPositions(tx as any, p.id);

      await tx.lead.update({
        where: { id: leadId },
        data: { stage: 'proposal_sent', updatedAt: new Date() },
      });

      return p;
    }) as typeof proposal;
  }

  // Activity log (fire-and-forget)
  void (async () => {
    const u = await prisma.user.findUnique({ where: { id: actorId }, select: { firstName: true, lastName: true, email: true } });
    const actorName = u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email || 'User' : 'User';
    await createActivityLog({
      userId: actorId,
      userName: actorName,
      subCompanyId: lead.subCompany.id,
      type: 'pipeline_moved',
      description: `Lead moved from "${lead.stage}" to "proposal_sent" via proposal submission`,
      metadata: { leadId, clientId: lead.client.id, clientName: lead.client.name, fromStage: lead.stage, toStage: 'proposal_sent' },
    });
  })();

  const submitCtx = await ensureAccessContext(req);
  const submitterRole = (await prisma.user.findUnique({ where: { id: actorId }, select: { role: true } }))?.role ?? 'sales_associate';

  // Approval chain: Both pairs use ONE chain on the canonical (temp) sibling only.
  // Document rows stay paired; chain actions cannot diverge across siblings.
  const proposalApproval = await submitEntityForApproval({
    workflow: 'proposal_review',
    entityId: proposal.id,
    subCompanyId: lead.subCompany.id,
    submitterUserId: actorId,
    submitterPermissions: submitCtx?.permissions ?? [],
    submitterRoleKey: submitterRole,
  });

  if (proposalApproval && !proposalApproval.autoApproved && proposalApproval.targetRoleKey) {
    const notifierIds = await notifyChainTargetUsers({
      subCompanyId: lead.subCompany.id,
      targetRoleKey: proposalApproval.targetRoleKey,
      eventKey: getApprovalEventKey('proposal_review', 'submit'),
      context: {
        entityLabel: createBothPair ? `${lead.client.name} (Temp + Direct)` : lead.client.name,
        actorName: ownerName,
      },
      link: '/proposals',
      relatedId: proposal.id,
    });

    if (notifierIds.length > 0) {
      emitToUsers(notifierIds, 'notification:new', {
        type: 'proposal_submitted',
        proposalId: proposal.id,
        leadId,
        clientName: lead.client.name,
        ownerName,
      });

      emitToUsers([...notifierIds, actorId], 'proposal:refresh', { subCompanyId: lead.subCompany.id });

      const [agency, snapshotFiles, approverUsers] = await Promise.all([
        getAgencyBranding(lead.subCompany.id),
        prisma.proposalSelectedDefaultFile.findMany({
          where: { proposalId: proposal.id },
          select: { name: true, fileUrl: true },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.user.findMany({
          where: { id: { in: notifierIds }, isActive: true },
          select: { email: true, firstName: true, lastName: true },
        }),
      ]);
      for (const manager of approverUsers) {
        const managerName = `${manager.firstName ?? ''} ${manager.lastName ?? ''}`.trim() || manager.email;
        sendProposalSubmittedEmail({
          to: manager.email,
          managerName,
          submittedByName: ownerName,
          clientName: createBothPair ? `${lead.client.name} (Temp + Direct)` : lead.client.name,
          clientMessage: clientMessage ?? undefined,
          defaultFiles: snapshotFiles.length > 0 ? snapshotFiles : undefined,
          proposalLink: `${process.env.APP_URL ?? process.env.FRONTEND_URL}/proposals`,
          agency,
        }).catch(console.error);
      }
    }
  }

  // PandaDoc draft creation is intentionally deferred to manager approval to avoid
  // burning a credit on submission. Manager preview uses the local PDF renderer
  // (renderReviewPdf) via /pandadoc/agreement-preview — no PandaDoc API call needed
  // until the manager actually approves and the document is sent to the client.

  const pair = createBothPair ? await loadPairByProposalId(proposal.id) : null;

  return res.status(201).json({
    ...proposal,
    attachments: proposal.attachments.map((a) => ({ ...a, size: Number(a.size) })),
    siblingId: pairSiblingId,
    pair: serializePairSummary(pair),
  });
});


// ─── GET /proposals/documents/:docId/preview ─────────────────────────────────
// Stream a proposal document (any category) inline — authenticated proxy.
router.get('/documents/:docId/preview', proposalAccess, async (req: Request, res: Response) => {
  const doc = await prisma.proposalDocument.findUnique({
    where: { id: req.params.docId },
    include: { proposal: { include: { lead: { select: { subCompanyId: true } } } } },
  });
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (!(await canAccessProposalAgency(req, doc.proposal.lead.subCompanyId))) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const fileUrl = doc.url.trim();
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
    return res.redirect(302, fileUrl);
  }

  const r2 = await getFromR2(fileUrl);
  if (!r2) return res.status(404).json({ error: 'File not found in storage' });

  const contentType = r2.contentType ?? (doc.type as string) ?? 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `inline; filename="${doc.name.replace(/[^\w.-]/g, '_')}"`);
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  return res.send(r2.body);
});


// ─── GET /proposals ───────────────────────────────────────────────────────────
// List proposals — managers see all for their agency; when clientId is passed, all users with clients:read can view.
router.get('/', proposalAccess, async (req: Request, res: Response) => {
  const user = req.user!;
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const { status, page = '1', limit = '20', clientId, pendingActivation, ownerIds: ownerIdsRaw, documentReview, isForReview } = req.query as Record<string, string>;
  const skip = (Number(page) - 1) * Number(limit);

  // When filtering by clientId, allow any authenticated user (access is scoped to their agency)
  // Non-managers can only see their own proposals (for history view)
  const isManagerUser = (await canReviewProposals(req));
  if (!clientId && !isManagerUser) {
    // Associates can view their own proposals (history)
  }

  const detailScope = await resolveClientDetailScope(req, subCompanyId);

  const leadScopeForClient = clientId
    ? detailScope.viewAllAgencies
      ? { clientId, subCompanyId: { in: detailScope.subCompanyIds } }
      : {
          clientId,
          OR: [
            { subCompanyId: detailScope.primarySubCompanyId },
            { owner: { role: { in: detailScope.globalCreatorRoleKeys } } },
          ],
        }
    : { subCompanyId };

  const where: any = { lead: leadScopeForClient };
  if (!isManagerUser && !clientId) where.lead.ownerId = user.sub;
  if (status) where.status = status;

  // Owner filter: try linked expand first (any role), then manager literal IDs.
  if (ownerIdsRaw) {
    const ownerIds = ownerIdsRaw.split(',').filter(Boolean);
    if (ownerIds.length > 0) {
      const linked = await expandLinkedOwnerScope(user.sub, user.subCompanyId, ownerIds, { exact: ownerExactFromQuery(req.query) });
      if (linked) {
        const leadFilter = linkedExpansionToWhere(linked);
        where.lead = {
          ...(typeof where.lead === 'object' && where.lead ? where.lead : {}),
          ...leadFilter,
        };
      } else if (isManagerUser) {
        where.lead.ownerId = { in: ownerIds };
      }
    }
  }

  // documentReview filter: proposals submitted for manager document review (any stage)
  if (documentReview === 'true') {
    where.reviewRequestedAt = { not: null };
  }

  // isForReview filter: pre-pandadoc client review proposals
  if (isForReview === 'true') {
    where.isForReview = true;
  } else if (isForReview === 'false') {
    where.isForReview = false;
  }

  // pendingActivation filter: approved proposals awaiting client approval or activation (not yet activated)
  // Exclude review-only proposals — they are never moved to awaiting_client_approval.
  if (pendingActivation === 'true') {
    where.status = 'approved';
    where.isForReview = false;
    where.activatedAt = null;
    where.lead = { ...where.lead, status: { in: ['closed_won_pending', 'closed_won'] } };
  } else if (pendingActivation === 'false') {
    if (where.status === 'approved') {
      where.lead.status = { not: 'closed_won_pending' };
    }
  }

  const [proposals, total] = await Promise.all([
    prisma.proposal.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        attachments: true,
        positions: { orderBy: { createdAt: 'asc' } },
        selectedDefaultFiles: { orderBy: { createdAt: 'asc' } },
        proposalDocuments: {
          include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
        },
        lead: {
          include: {
            client: { select: { id: true, name: true } },
            owner: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
        reviewedBy: { select: { id: true, firstName: true, lastName: true } },
        activatedBy: { select: { id: true, firstName: true, lastName: true } },
        reviewRequestedBy: { select: { id: true, firstName: true, lastName: true } },
        reviewRejectedBy: { select: { id: true, firstName: true, lastName: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        selectedContact: { select: { id: true, name: true, email: true, title: true } },
        extensionRequests: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            requestedBy: { select: { id: true, firstName: true, lastName: true } },
            reviewedBy: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    }),
    prisma.proposal.count({ where }),
  ]);

  const awaitingDays = await getAwaitingClientTimerDays(subCompanyId);
  const accessCtx = await ensureAccessContext(req);
  // Convert BigInt `size` fields on attachments/documents to Number for JSON serialization
  const now = Date.now();
  const serialized = proposals.map((p) => {
    const latestExtensionRequest = p.extensionRequests[0] ?? null;
    const approvalAnchor = p.reviewedAt ?? p.createdAt;
    const leadTerminal = isLeadAwaitingTimerTerminated(p.lead.status);
    const effectiveDueAt = leadTerminal
      ? null
      : (p.awaitingClientDueAt ?? (approvalAnchor ? new Date(approvalAnchor.getTime() + awaitingDays * 24 * 60 * 60 * 1000) : null));
    const expired = !leadTerminal && !!effectiveDueAt && effectiveDueAt.getTime() <= now;
    const isAwaitingClient = isProposalAwaitingClientPhase(p.lead);
    const isOwnerAssociate = p.lead.ownerId === user.sub && (accessCtx ? isOwnDataOnlyScope(accessCtx) : false);
    const requiresAwaitingClientAction =
      isOwnerAssociate &&
      isAwaitingClient &&
      expired &&
      latestExtensionRequest?.status !== 'pending';

    return {
      ...p,
      awaitingClientDueAt: effectiveDueAt,
      latestExtensionRequest,
      requiresAwaitingClientAction,
      attachments: p.attachments.map((a) => ({ ...a, size: Number(a.size) })),
      proposalDocuments: p.proposalDocuments.map((d) => ({ ...d, size: Number(d.size) })),
    };
  });

  // Collapse Both pairs into one list row (canonical = temp) with pair summary
  const pairIds = [...new Set(serialized.map((p) => p.proposalPairId).filter(Boolean))] as string[];
  const pairById = new Map<string, NonNullable<Awaited<ReturnType<typeof loadPairByPairId>>>>();
  await Promise.all(
    pairIds.map(async (pid) => {
      const pair = await loadPairByPairId(pid);
      if (pair) pairById.set(pid, pair);
    }),
  );
  let collapsed = collapsePairedProposals(serialized, pairById);

  // Both pairs store signed PDFs on each sibling. The list collapses to the
  // canonical row — merge documents from every member so Signed files shows both.
  const serializedById = new Map(serialized.map((p) => [p.id, p]));
  const missingMemberIds = new Set<string>();
  for (const row of collapsed) {
    const pair = row.proposalPairId ? pairById.get(row.proposalPairId) : null;
    if (!pair) continue;
    for (const m of pair.members) {
      if (!serializedById.has(m.id)) missingMemberIds.add(m.id);
    }
  }

  const missingDocsByProposalId = new Map<
    string,
    Array<(typeof serialized)[number]['proposalDocuments'][number] & { agreementLabel?: string }>
  >();
  if (missingMemberIds.size > 0) {
    const extraDocs = await prisma.proposalDocument.findMany({
      where: { proposalId: { in: [...missingMemberIds] } },
      include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    for (const d of extraDocs) {
      const list = missingDocsByProposalId.get(d.proposalId) ?? [];
      list.push({ ...d, size: Number(d.size) });
      missingDocsByProposalId.set(d.proposalId, list);
    }
  }

  collapsed = collapsed.map((row) => {
    const pair = row.proposalPairId ? pairById.get(row.proposalPairId) : null;
    if (!pair) return row;

    const seen = new Set<string>();
    const merged: Array<(typeof row.proposalDocuments)[number] & { agreementLabel?: string }> = [];
    for (const m of pair.members) {
      const docs = [
        ...(serializedById.get(m.id)?.proposalDocuments ?? []),
        ...(missingDocsByProposalId.get(m.id) ?? []),
      ];
      for (const d of docs) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        merged.push({ ...d, agreementLabel: pairMemberLabel(m) });
      }
    }
    merged.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return { ...row, proposalDocuments: merged };
  });

  return res.json({ proposals: collapsed, total: Number(total), page: Number(page), limit: Number(limit) });
});

// ─── GET /proposals/awaiting-client-extension-requests ───────────────────────
router.get('/awaiting-client-extension-requests', proposalAccess, async (req: Request, res: Response) => {
  const user = req.user!;
  if (!(await canReviewProposals(req))) {
    return res.status(403).json({ error: 'Manager access required' });
  }

  const status = String(req.query.status ?? 'pending');
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const rows = await prisma.proposalExtensionRequest.findMany({
    where: {
      status: status as any,
      proposal: { lead: { subCompanyId: user.subCompanyId } },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      reviewedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      proposal: {
        select: {
          id: true,
          leadId: true,
          awaitingClientDueAt: true,
          lead: { select: { id: true, ownerId: true, client: { select: { id: true, name: true } } } },
        },
      },
    },
  });

  return res.json({ requests: rows });
});

// ─── POST /proposals/:id/awaiting-client-decision ────────────────────────────
router.post('/:id/awaiting-client-decision', proposalWrite, async (req: Request, res: Response) => {
  const user = req.user!;
  const proposalId = req.params.id;
  const { requestExtension, noResponseReason, extensionReason, requestedDays } = req.body ?? {};

  const submitCtx = await ensureAccessContext(req);
  if (!submitCtx || !isOwnDataOnlyScope(submitCtx)) {
    return res.status(403).json({ error: 'Only associates can submit this decision' });
  }
  if (!noResponseReason || typeof noResponseReason !== 'string' || !noResponseReason.trim()) {
    return res.status(400).json({ error: 'Reason is required' });
  }
  if (requestExtension === true) {
    if (!extensionReason || typeof extensionReason !== 'string' || !extensionReason.trim()) {
      return res.status(400).json({ error: 'Extension reason is required' });
    }
    if (!Number.isInteger(requestedDays) || requestedDays <= 0) {
      return res.status(400).json({ error: 'requestedDays must be a positive integer' });
    }
  }

  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    include: { lead: { include: { client: true, owner: true } } },
  });
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  const proposalAgencyId = await resolveAgencyScope(req);
  if (!proposalAgencyId || proposal.lead.subCompanyId !== proposalAgencyId) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  if (proposal.lead.ownerId !== effectiveActorId(req)) return res.status(403).json({ error: 'Only the lead owner can submit this decision' });
  if (isLeadAwaitingTimerTerminated(proposal.lead.status)) {
    return res.status(409).json({ error: 'Awaiting-client response timer no longer applies to this lead' });
  }
  if (proposal.lead.stage !== 'awaiting_client_approval' || proposal.lead.status !== 'closed_won_pending') {
    return res.status(409).json({ error: 'Proposal is not in Awaiting Client stage' });
  }
  const awaitingDays = await getAwaitingClientTimerDays(proposal.lead.subCompanyId);
  const approvalAnchor = proposal.reviewedAt ?? proposal.createdAt;
  const effectiveDueAt = proposal.awaitingClientDueAt ?? (approvalAnchor ? new Date(approvalAnchor.getTime() + awaitingDays * 24 * 60 * 60 * 1000) : null);
  if (!effectiveDueAt || effectiveDueAt.getTime() > Date.now()) {
    return res.status(409).json({ error: 'Awaiting-client timer has not expired yet' });
  }

  const latestRequest = await prisma.proposalExtensionRequest.findFirst({
    where: { proposalId: proposal.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true },
  });
  if (latestRequest?.status === 'pending') {
    return res.status(409).json({ error: 'An extension request is already pending manager approval' });
  }

  if (requestExtension === true) {
    const created = await prisma.$transaction(async (tx) => {
      await tx.proposal.update({
        where: { id: proposal.id },
        data: { awaitingClientReason: noResponseReason.trim() },
      });
      return tx.proposalExtensionRequest.create({
        data: {
          proposalId: proposal.id,
          requestedById: effectiveActorId(req),
          reason: extensionReason.trim(),
          requestedDays,
          status: 'pending',
          currentStepIndex: 0,
          approvalChain: [],
        },
      });
    });

    const extApproval = await submitEntityForApproval({
      workflow: 'proposal_extension',
      entityId: created.id,
      subCompanyId: proposal.lead.subCompanyId,
      submitterUserId: effectiveActorId(req),
      submitterRoleKey: submitCtx.roleKey,
      submitterPermissions: submitCtx.permissions,
    });

    if (extApproval.autoApproved) {
      emitToUsers([...new Set([effectiveActorId(req), user.sub])], 'proposal:refresh', { subCompanyId: proposal.lead.subCompanyId });
      return res.status(201).json({ request: created, autoApproved: true });
    }

    if (!extApproval.targetRoleKey) {
      return res.status(400).json({
        error: 'No approval path configured for proposal extension. Check Settings → Approvals and Settings → Roles.',
      });
    }

    const ownerName = `${proposal.lead.owner.firstName} ${proposal.lead.owner.lastName}`.trim();
    const notifierIds = await notifyChainTargetUsers({
      subCompanyId: proposal.lead.subCompanyId,
      targetRoleKey: extApproval.targetRoleKey,
      eventKey: getApprovalEventKey('proposal_extension', 'submit'),
      context: { entityLabel: proposal.lead.client.name, actorName: ownerName },
      link: '/proposals',
      relatedId: created.id,
    });

    emitToUsers(notifierIds, 'proposal:refresh', { subCompanyId: proposal.lead.subCompanyId });
    return res.status(201).json({ request: created, autoApproved: false });
  }

  const reviewerIds = new Set(await proposalReviewerIds(proposal.lead.subCompanyId));
  const reportingManagers = await prisma.user.findMany({
    where: {
      id: {
        in: proposal.lead.owner.reportingManagerIds.filter((id) => reviewerIds.has(id)),
      },
      subCompanyId: proposal.lead.subCompanyId,
      isActive: true,
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  const managerOwnerId = reportingManagers[0]?.id;
  if (!managerOwnerId) {
    return res.status(400).json({ error: 'No reporting manager found for reassignment' });
  }

  await prisma.$transaction(async (tx) => {
    await tx.proposal.update({
      where: { id: proposal.id },
      data: {
        awaitingClientReason: noResponseReason.trim(),
        awaitingClientDueAt: null,
      },
    });
    await tx.lead.update({
      where: { id: proposal.leadId },
      data: {
        stage: 'closed_lost',
        status: 'closed_lost',
        closedAt: new Date(),
        closedById: effectiveActorId(req),
        lossReason: noResponseReason.trim(),
        reassignmentLocked: true,
        lockedAssociateId: effectiveActorId(req),
      },
    });
    await syncClientStatusFromLeadOutcomes({
      tx,
      clientId: proposal.lead.clientId,
      subCompanyId: proposal.lead.subCompanyId,
      touchLastActivityAt: new Date(),
    });
  });

  await dispatchNotification({
    eventKey: 'proposal_returned_reassignment',
    userIds: reportingManagers.map((m) => m.id),
    subCompanyId: proposal.lead.subCompanyId,
    context: { entityLabel: proposal.lead.client.name },
    link: '/proposals',
    relatedId: proposal.id,
  });
  emitToUsers([proposal.lead.ownerId, ...reportingManagers.map((m) => m.id)], 'proposal:refresh', { subCompanyId: proposal.lead.subCompanyId });
  return res.json({ ok: true });
});

// ─── PATCH /proposals/awaiting-client-extension-requests/:id/:decision ───────
router.patch('/awaiting-client-extension-requests/:id/:decision', proposalReview, async (req: Request, res: Response) => {
  const user = req.user!;
  const decision = req.params.decision;
  if (decision !== 'approve' && decision !== 'reject') {
    return res.status(400).json({ error: 'Invalid decision' });
  }

  const reviewCtx = await ensureAccessContext(req);
  if (!reviewCtx) return res.status(403).json({ error: 'Forbidden' });

  const row = await prisma.proposalExtensionRequest.findUnique({
    where: { id: req.params.id },
    include: {
      proposal: {
        include: {
          lead: { include: { client: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });
  if (!row) return res.status(404).json({ error: 'Request not found' });
  if (row.proposal.lead.subCompanyId !== user.subCompanyId) return res.status(403).json({ error: 'Not authorized' });
  if (row.status !== 'pending') return res.status(409).json({ error: `Request already ${row.status}` });
  if (isLeadAwaitingTimerTerminated(row.proposal.lead.status)) {
    return res.status(409).json({ error: 'Awaiting-client response timer no longer applies to this lead' });
  }
  if (!isProposalAwaitingClientPhase(row.proposal.lead)) {
    return res.status(409).json({ error: 'Proposal is not in Awaiting Client stage' });
  }

  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
  if (decision === 'reject' && !comment) {
    return res.status(400).json({ error: 'Rejection reason is required' });
  }

  const chainResult = await performApprovalAction({
    workflow: 'proposal_extension',
    entityId: row.id,
    subCompanyId: row.proposal.lead.subCompanyId,
    actorUserId: user.sub,
    actorRoleKey: reviewCtx.roleKey,
    actorPermissions: reviewCtx.permissions,
    action: decision === 'approve' ? 'approve' : 'reject',
    remarks: comment || undefined,
  });
  if (!chainResult.ok) return res.status(chainResult.status).json({ error: chainResult.error });

  const managers = await prisma.user.findMany({
    where: { subCompanyId: row.proposal.lead.subCompanyId, id: { in: await proposalReviewerIds(row.proposal.lead.subCompanyId) }, isActive: true },
    select: { id: true },
  });
  emitToUsers([row.requestedById, ...managers.map((m) => m.id)], 'proposal:refresh', { subCompanyId: row.proposal.lead.subCompanyId });
  return res.json({ ok: true });
});


// ─── GET /proposals/:id ───────────────────────────────────────────────────────
router.get('/:id', proposalAccess, async (req: Request, res: Response) => {
  const proposal = await prisma.proposal.findUnique({
    where: { id: req.params.id },
    include: {
      lead: { select: { subCompanyId: true, ownerId: true } },
      selectedContact: { select: { id: true, name: true, email: true, title: true } },
      selectedDefaultFiles: { select: { id: true, defaultFileId: true, name: true } },
      positions: { select: { id: true, name: true, count: true } },
    },
  });
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  const proposalAgencyId = await resolveAgencyScope(req);
  if (!proposalAgencyId || proposal.lead.subCompanyId !== proposalAgencyId) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  return res.json({
    id: proposal.id,
    agreementTypes: proposal.agreementTypes,
    paymentTerms: proposal.paymentTerms,
    tempPricingType: proposal.tempPricingType,
    tempPricingValue: proposal.tempPricingValue,
    tempMinimumHours: proposal.tempMinimumHours,
    directPricingType: proposal.directPricingType,
    directPricingValue: proposal.directPricingValue,
    comment: proposal.comment,
    clientMessage: proposal.clientMessage,
    isForReview: proposal.isForReview,
    selectedContactId: proposal.selectedContactId,
    selectedDefaultFiles: proposal.selectedDefaultFiles,
    positions: proposal.positions,
  });
});

// ─── GET /proposals/:id/pandadoc-pdf ─────────────────────────────────────────
// Stream the PandaDoc agreement PDF for a proposal (draft or signed).
// Uses cached R2 preview for non-completed docs; fetches live from PandaDoc for signed docs.
router.get('/:id/pandadoc-pdf', proposalAccess, async (req: Request, res: Response) => {
  const proposal = await prisma.proposal.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      pandaDocId: true,
      pandaDocStatus: true,
      previewPdfUrl: true,
      lead: { select: { subCompanyId: true } },
    },
  });
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  const proposalAgencyId = await resolveAgencyScope(req);
  if (!proposalAgencyId || proposal.lead.subCompanyId !== proposalAgencyId) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  if (!proposal.pandaDocId) return res.status(404).json({ error: 'No PandaDoc document for this proposal' });

  try {
    let pdfBuffer: Buffer;

    // For completed (signed) docs always fetch live so we get the signed version.
    // For all other states, try the cached R2 preview first (faster), then fall back to PandaDoc.
    if (proposal.pandaDocStatus === 'document.completed') {
      pdfBuffer = await pandaDocService.downloadPdf(proposal.pandaDocId);
    } else if (proposal.previewPdfUrl) {
      const r2 = await getFromR2(proposal.previewPdfUrl);
      if (r2?.body) {
        pdfBuffer = r2.body instanceof Buffer ? r2.body : Buffer.from(r2.body as Uint8Array);
      } else {
        pdfBuffer = await pandaDocService.downloadPdf(proposal.pandaDocId);
      }
    } else {
      pdfBuffer = await pandaDocService.downloadPdf(proposal.pandaDocId);
    }

    const filename = proposal.pandaDocStatus === 'document.completed'
      ? 'signed-agreement.pdf'
      : 'agreement-draft.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return res.send(pdfBuffer);
  } catch (err: any) {
    console.error('[pandadoc-pdf] Failed to fetch PDF:', err?.message ?? err);
    return res.status(502).json({ error: 'Failed to retrieve PandaDoc PDF' });
  }
});


// ─── GET /proposals/:id/preview-email ────────────────────────────────────────
router.get('/:id/preview-email', proposalAccess, async (req: Request, res: Response) => {
  const user = req.user!;

  const proposal = await prisma.proposal.findUnique({
    where: { id: req.params.id },
    include: {
      lead: {
        include: { client: { select: { id: true, name: true } } },
      },
      selectedContact: { select: { id: true, name: true, email: true, isUnsubscribed: true } },
      selectedDefaultFiles: { select: { name: true, fileUrl: true } },
    },
  });

  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

  const contact = proposal.selectedContact;
  if (!contact) {
    return res.status(422).json({ error: 'no_contact', message: 'No client contact selected on this proposal' });
  }
  if (!contact.email) {
    return res.status(422).json({ error: 'no_email', message: 'Selected contact has no email address' });
  }

  const reviewerUser = await prisma.user.findUnique({ where: { id: user.sub }, select: { firstName: true, lastName: true, email: true } });
  const senderName = reviewerUser
    ? `${reviewerUser.firstName ?? ''} ${reviewerUser.lastName ?? ''}`.trim() || reviewerUser.email || 'Manager'
    : 'Manager';

  const agency = await getAgencyBranding(proposal.lead.subCompanyId);

  const documentShareLink: string | undefined = proposal.pandaDocId
    ? `https://app.pandadoc.com/a/#/documents/${proposal.pandaDocId}`
    : undefined;
  const missingFields: string[] = documentShareLink ? [] : ['documentLink'];

  const emailData: ClientProposalEmailData = {
    contactName: contact.name,
    clientCompanyName: proposal.lead.client.name,
    agreementTypes: proposal.agreementTypes,
    tempPricingType: proposal.tempPricingType ?? undefined,
    tempPricingValue: proposal.tempPricingValue != null ? Number(proposal.tempPricingValue) : undefined,
    directPricingType: proposal.directPricingType ?? undefined,
    directPricingValue: proposal.directPricingValue != null ? Number(proposal.directPricingValue) : undefined,
    paymentTerms: proposal.paymentTerms,
    clientMessage: proposal.clientMessage ?? undefined,
    documentShareLink,
    defaultFiles: proposal.selectedDefaultFiles,
    senderName,
    agency,
    subCompanyId: proposal.lead.subCompanyId,
    fromUserId: user.sub,
    fromEmail: reviewerUser?.email ?? null,
  };

  const { html } = await buildClientProposalEmailHtml(emailData);
  const subject = `Proposal Ready for Your Review — ${proposal.lead.client.name}`;

  return res.json({
    subject,
    html,
    to: contact.email,
    contactName: contact.name,
    documentLinkAvailable: !!documentShareLink,
    missingFields,
  });
});

// ─── POST /proposals/:id/retry-pandadoc ──────────────────────────────────────
// Re-runs PandaDoc creation for an approved proposal where pandaDocId is null.
router.post('/:id/retry-pandadoc', proposalAccess, async (req: Request, res: Response) => {
  const proposal = await prisma.proposal.findUnique({
    where: { id: req.params.id },
    include: {
      lead: {
        include: {
          owner: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
          client: { select: { id: true, name: true, industry: true, location: true, address: true, companySize: true } },
          subCompany: { select: { name: true } },
        },
      },
      selectedContact: { select: { id: true, name: true, email: true, isUnsubscribed: true, title: true, phone: true } },
      selectedDefaultFiles: { select: { name: true, fileUrl: true, mimeType: true } },
    },
  });
  if (!proposal) return res.status(404).json({ error: 'Not found' });

  const bodyParse = z.object({ signed: z.boolean().default(false), signingAuthorityId: z.string().uuid().optional() }).safeParse(req.body);
  const { signed, signingAuthorityId } = bodyParse.success ? bodyParse.data : { signed: false, signingAuthorityId: undefined };

  let signingAuthority: { id: string; name: string; signatureData: string } | null = null;
  if (signed && signingAuthorityId) {
    signingAuthority = await prisma.signingAuthority.findFirst({
      where: { id: signingAuthorityId, subCompanyId: proposal.lead.subCompanyId },
      select: { id: true, name: true, signatureData: true },
    });
  }
  // Fallback to primary signing authority if none was selected
  if (!signingAuthority) {
    const primary = await prisma.signingAuthority.findFirst({
      where: { subCompanyId: proposal.lead.subCompanyId, isPrimary: true },
      select: { id: true, name: true, signatureData: true },
    });
    if (primary) signingAuthority = primary;
  }

  const contact = proposal.selectedContact;
  if (!contact?.email || contact.isUnsubscribed) return res.json({ skipped: 'no contact' });
  if (!pandaDocService.isAvailable()) return res.json({ skipped: 'pandadoc not configured' });

  try {
    let docId = proposal.pandaDocId as string | null;
    if (!docId && proposal.pandaDocTemplateId) {
      const now = new Date();
      const nameParts = (contact.name ?? '').trim().split(/\s+/);
      const ownerName = `${proposal.lead.owner.firstName ?? ''} ${proposal.lead.owner.lastName ?? ''}`.trim() || proposal.lead.owner.email;
      const prefill: ProposalPrefill = {
        client: { name: proposal.lead.client.name ?? '', industry: proposal.lead.client.industry ?? '', location: proposal.lead.client.location ?? '', address: proposal.lead.client.address ?? '', companySize: proposal.lead.client.companySize ?? '' },
        contact: { name: contact.name ?? '', firstName: nameParts[0] ?? '', lastName: nameParts.slice(1).join(' ') || (nameParts[0] ?? ''), title: contact.title ?? '', email: contact.email ?? '', phone: contact.phone ?? '' },
        sender: { name: ownerName, firstName: proposal.lead.owner.firstName ?? '', lastName: proposal.lead.owner.lastName ?? '', email: proposal.lead.owner.email ?? '', phone: proposal.lead.owner.phone ?? '' },
        agency: { name: proposal.lead.subCompany?.name ?? '' },
        lead: { value: proposal.lead.value ? String(proposal.lead.value) : '', stage: proposal.lead.stage ?? '' },
        date: { today: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), year: String(now.getFullYear()) },
        proposal: { paymentDays: (proposal.paymentTerms as string)?.match(/\d+/)?.[0] ?? '', paymentTermsLabel: (proposal.paymentTerms as string)?.replace('net_', 'Net ') ?? '', minimumHours: proposal.tempMinimumHours != null ? String(proposal.tempMinimumHours) : '', billingRate: '', agreementTypeLabel: '' },
        ...(signingAuthority ? { signingAuthority: { name: signingAuthority.name } } : {}),
      };

      const templates = await pandaDocService.listAllTemplatesWithDetails();
      const template = templates.find(t => t.id === proposal.pandaDocTemplateId);
      const tokens = template ? template.tokens.map(t => ({ name: t.name, value: matchProposalToken(t.name, prefill) })).filter(t => t.value.trim()) : [];
      const recipientRole = template?.roles[0]?.name ?? 'Signer';

      const retryBaseUrl = (process.env.PUBLIC_API_URL ?? process.env.APP_URL ?? '').replace(/\/$/, '');
      const templateImageBlocks = template?.imageBlockNames ?? [];
      let signatureImages: Array<{ name: string; urls: string[] }> | undefined;
      if (signingAuthority) {
        const imgUrl = await uploadSignatureImageToR2(signingAuthority.id, signingAuthority.signatureData);
        if (imgUrl) {
          signatureImages = ['Agency Signature', 'Agency Signature 2']
            .filter(n => templateImageBlocks.length === 0 || templateImageBlocks.includes(n))
            .map(n => ({ name: n, urls: [imgUrl] }));
        }
      } else {
        const publicReachable =
          !!retryBaseUrl &&
          !/localhost|127\.0\.0\.1/i.test(retryBaseUrl) &&
          !/\.ngrok(-free)?\.(app|dev)/i.test(retryBaseUrl);
        if (publicReachable) {
          const transparentUrl = `${retryBaseUrl}/api/v1/public/transparent-signature`;
          signatureImages = ['Agency Signature', 'Agency Signature 2']
            .filter(n => templateImageBlocks.length === 0 || templateImageBlocks.includes(n))
            .map(n => ({ name: n, urls: [transparentUrl] }));
        }
      }

      const doc = await pandaDocService.createFromTemplate({
        templateId: proposal.pandaDocTemplateId!,
        name: `${proposal.lead.client.name} — Agreement`,
        recipients: [{ email: contact.email!, first_name: nameParts[0] || contact.name, last_name: nameParts.slice(1).join(' ') || nameParts[0] || '', role: recipientRole }],
        tokens,
        images: signatureImages,
        waitForDraft: true,
      });
      docId = doc.id;
      await prisma.proposal.update({ where: { id: proposal.id }, data: { pandaDocId: docId, pandaDocUpdatedAt: new Date() } });
    }

    if (!docId) return res.json({ skipped: 'no template or docId' });

    const contactName = (contact.name ?? '').trim() || contact.email!;
    await sendPandaDocWithAgencyFrom({
      documentId: docId,
      recipientEmail: contact.email!,
      recipientName: contactName,
      subject: `Agreement Ready for Your Review — ${proposal.lead.client.name}`,
      message: `Hi ${contactName.split(/\s+/)[0] || 'there'},\n\nPlease review and sign your agreement with ${proposal.lead.subCompany?.name ?? 'us'}.\n\nThank you.`,
      subCompanyId: proposal.lead.subCompanyId,
    });
    await prisma.proposal.update({ where: { id: proposal.id }, data: { pandaDocStatus: 'document.sent', pandaDocUpdatedAt: new Date() } });

    return res.json({ success: true, docId });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? String(err), body: err?.body ?? null });
  }
});

// ─── POST /proposals/:id/approve ─────────────────────────────────────────────
router.post('/:id/approve', proposalReview, async (req: Request, res: Response) => {
  const user = req.user!;
  const reviewCtx = await ensureAccessContext(req);
  if (!reviewCtx) return res.status(403).json({ error: 'Forbidden' });

  const bodyParse = z.object({
    signed: z.boolean().default(false),
    signingAuthorityId: z.string().uuid().optional(),
  }).safeParse(req.body);
  const { signed, signingAuthorityId } = bodyParse.success ? bodyParse.data : { signed: false, signingAuthorityId: undefined };

  const proposal = await prisma.proposal.findUnique({
    where: { id: req.params.id },
    include: {
      lead: {
        include: {
          owner: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
          client: { select: { id: true, name: true, industry: true, location: true, address: true, companySize: true } },
          subCompany: { select: { name: true } },
        },
      },
      selectedContact: { select: { id: true, name: true, email: true, isUnsubscribed: true, title: true, phone: true } },
      selectedDefaultFiles: { select: { name: true, fileUrl: true, mimeType: true } },
    },
  });

  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  if (proposal.status !== 'pending') {
    return res.status(409).json({ error: `Proposal is already ${proposal.status}` });
  }
  if (proposal.isForReview) {
    return res.status(409).json({ error: 'This is a review-only proposal — use /approve-for-review instead' });
  }

  const { authEntityId, pair } = await resolvePairAuthEntityId(proposal.id);

  const auth = await authorizeApprovalAction({
    workflow: 'proposal_review',
    entityId: authEntityId,
    subCompanyId: proposal.lead.subCompanyId,
    actorRoleKey: reviewCtx.roleKey,
    actorPermissions: reviewCtx.permissions,
    action: 'approve',
  });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const awaitingDays = await getAwaitingClientTimerDays(proposal.lead.subCompanyId);
  const awaitingDueAt = new Date(Date.now() + awaitingDays * 24 * 60 * 60 * 1000);

  // Approval moves the lead into awaiting-client with a director-configured timer.
  // For Both pairs: approve both siblings; never demote an already-won lead.
  await prisma.$transaction(async (tx) => {
    if (pair) {
      for (const member of pair.members) {
        const isCanonical = member.id === pair.canonical.id;
        await tx.proposal.update({
          where: { id: member.id },
          data: {
            status: 'approved',
            reviewedById: user.sub,
            reviewedAt: new Date(),
            ...(isCanonical
              ? { awaitingClientDueAt: awaitingDueAt, awaitingClientReason: null }
              : {}),
          },
        });
      }
    } else {
      await tx.proposal.update({
        where: { id: proposal.id },
        data: {
          status: 'approved',
          reviewedById: user.sub,
          reviewedAt: new Date(),
          awaitingClientDueAt: awaitingDueAt,
          awaitingClientReason: null,
        },
      });
    }

    const lead = await tx.lead.findUnique({
      where: { id: proposal.leadId },
      select: { status: true },
    });
    if (lead && lead.status !== 'closed_won' && lead.status !== 'closed_won_pending') {
      await tx.lead.update({
        where: { id: proposal.leadId },
        data: {
          stage: 'awaiting_client_approval',
          status: 'closed_won_pending',
          lossReason: null,
          updatedAt: new Date(),
        },
      });
      await syncClientStatusFromLeadOutcomes({
        tx,
        clientId: proposal.lead.clientId,
        subCompanyId: proposal.lead.subCompanyId,
        touchLastActivityAt: new Date(),
      });
    }
  });

  await invalidateClientListCache(proposal.lead.subCompanyId);

  const ownerName = `${proposal.lead.owner.firstName ?? ''} ${proposal.lead.owner.lastName ?? ''}`.trim() || proposal.lead.owner.email;
  const reviewerUser = await prisma.user.findUnique({ where: { id: user.sub }, select: { firstName: true, lastName: true, email: true } });
  const reviewerName = reviewerUser ? `${reviewerUser.firstName ?? ''} ${reviewerUser.lastName ?? ''}`.trim() || reviewerUser.email || 'Manager' : user.email ?? 'Manager';

  await dispatchNotificationToUser({
    userId: proposal.lead.ownerId,
    subCompanyId: proposal.lead.subCompanyId,
    eventKey: 'proposal_approved_documents_required',
    context: { entityLabel: proposal.lead.client.name, reviewerName },
    link: '/proposals',
    relatedId: proposal.id,
  });

  const approveManagers = await prisma.user.findMany({
    where: { subCompanyId: proposal.lead.subCompanyId, id: { in: await proposalReviewerIds(proposal.lead.subCompanyId) }, isActive: true },
    select: { id: true },
  });
  const approvalEventRecipients = new Set([proposal.lead.ownerId, ...approveManagers.map(m => m.id)]);
  emitToUsers(Array.from(approvalEventRecipients), 'proposal:approved', {
    proposalId: proposal.id,
    leadId: proposal.leadId,
    clientId: proposal.lead.clientId,
    clientName: proposal.lead.client.name,
    reviewerName,
  });
  emitToUsers([...approveManagers.map(m => m.id), proposal.lead.ownerId], 'proposal:refresh', { subCompanyId: proposal.lead.subCompanyId });

  const agency = await getAgencyBranding(proposal.lead.subCompanyId);
  sendProposalApprovedEmail({
    to: proposal.lead.owner.email,
    ownerName,
    clientName: proposal.lead.client.name,
    reviewerName,
    pipelineLink: `${process.env.APP_URL ?? process.env.FRONTEND_URL}/pipeline`,
    agency,
  }).catch(console.error);

  // Resolve signing authority for signed copy (agency-isolated)
  let signingAuthority: { id: string; name: string; signatureData: string } | null = null;
  if (signed && signingAuthorityId) {
    signingAuthority = await prisma.signingAuthority.findFirst({
      where: { id: signingAuthorityId, subCompanyId: proposal.lead.subCompanyId },
      select: { id: true, name: true, signatureData: true },
    });
  }
  // Fallback to primary signing authority if none was selected
  if (!signingAuthority) {
    const primary = await prisma.signingAuthority.findFirst({
      where: { subCompanyId: proposal.lead.subCompanyId, isPrimary: true },
      select: { id: true, name: true, signatureData: true },
    });
    if (primary) signingAuthority = primary;
  }

  // Send agreement email(s) to client via PandaDoc (Both = two docs)
  void (async () => {
    const targetIds = pair ? pair.members.map((m) => m.id) : [proposal.id];
    for (const targetId of targetIds) {
      const row =
        targetId === proposal.id
          ? proposal
          : await prisma.proposal.findUnique({
              where: { id: targetId },
              include: {
                lead: {
                  include: {
                    owner: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
                    client: { select: { id: true, name: true, industry: true, location: true, address: true, companySize: true } },
                    subCompany: { select: { name: true } },
                  },
                },
                selectedContact: { select: { id: true, name: true, email: true, isUnsubscribed: true, title: true, phone: true } },
                selectedDefaultFiles: { select: { name: true, fileUrl: true, mimeType: true } },
              },
            });
      if (!row) continue;

      const contact = row.selectedContact;
      if (!contact?.email || contact.isUnsubscribed) {
        console.warn(`[Approval] Skipping client email for proposal ${row.id} — no contact email or unsubscribed`);
        continue;
      }

      if (!pandaDocService.isAvailable()) {
        console.warn(`[Approval] PandaDoc not configured — skipping client agreement email for proposal ${row.id}`);
        continue;
      }

      // Both docs get the same default attachments (snapshotted on each sibling at create).
      const includeDefaults = true;
      const docLabel =
        (row.agreementTypes as string[]).includes('temp')
          ? 'Temp Agreement'
          : (row.agreementTypes as string[]).some((t: string) => t.startsWith('direct'))
            ? 'Direct Placement Agreement'
            : 'Agreement';

      try {
        let docId = row.pandaDocId as string | null;

        if (!docId && row.pandaDocTemplateId) {
          const now = new Date();
          const nameParts = (contact.name ?? '').trim().split(/\s+/);
          const rowOwnerName =
            `${row.lead.owner.firstName ?? ''} ${row.lead.owner.lastName ?? ''}`.trim() || row.lead.owner.email;
          const prefill: ProposalPrefill = {
            client: {
              name: row.lead.client.name ?? '',
              industry: row.lead.client.industry ?? '',
              location: row.lead.client.location ?? '',
              address: row.lead.client.address ?? '',
              companySize: row.lead.client.companySize ?? '',
            },
            contact: {
              name: contact.name ?? '',
              firstName: nameParts[0] ?? '',
              lastName: nameParts.slice(1).join(' ') || (nameParts[0] ?? ''),
              title: contact.title ?? '',
              email: contact.email ?? '',
              phone: contact.phone ?? '',
            },
            sender: {
              name: rowOwnerName,
              firstName: row.lead.owner.firstName ?? '',
              lastName: row.lead.owner.lastName ?? '',
              email: row.lead.owner.email ?? '',
              phone: row.lead.owner.phone ?? '',
            },
            agency: { name: row.lead.subCompany?.name ?? '' },
            lead: {
              value: row.lead.value ? String(row.lead.value) : '',
              stage: row.lead.stage ?? '',
            },
            date: {
              today: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
              year: String(now.getFullYear()),
            },
            proposal: {
              paymentDays: (row.paymentTerms as string)?.match(/\d+/)?.[0] ?? '',
              paymentTermsLabel: (row.paymentTerms as string)?.replace('net_', 'Net ') ?? '',
              minimumHours: row.tempMinimumHours != null ? String(row.tempMinimumHours) : '',
              billingRate: (() => {
                if ((row.agreementTypes as string[]).includes('temp') && row.tempPricingValue != null) {
                  const v = Number(row.tempPricingValue);
                  return row.tempPricingType === 'markup' ? `${v}%` : `$${v}/hr`;
                }
                if ((row.agreementTypes as string[]).some((t: string) => t.startsWith('direct')) && row.directPricingValue != null) {
                  const v = Number(row.directPricingValue);
                  return (row.directPricingType === 'percentage' || row.directPricingType === 'markup') ? `${v}%` : `$${v}`;
                }
                return '';
              })(),
              agreementTypeLabel: (row.agreementTypes as string[])
                .map((t: string) => (t === 'temp' ? 'Temp / Temp to Permanent' : 'Direct Placement'))
                .join(', '),
            },
            ...(signingAuthority ? { signingAuthority: { name: signingAuthority.name } } : {}),
          };

          const templates = await pandaDocService.listAllTemplatesWithDetails();
          const template = templates.find((t) => t.id === row.pandaDocTemplateId);
          const tokens = template
            ? template.tokens.map((t) => ({ name: t.name, value: matchProposalToken(t.name, prefill) })).filter((t) => t.value.trim())
            : [];
          const recipientRole = template?.roles[0]?.name ?? 'Signer';

          const baseUrl = (process.env.PUBLIC_API_URL ?? process.env.APP_URL ?? '').replace(/\/$/, '');
          const tplImageBlocks = template?.imageBlockNames ?? [];
          let signatureImages: Array<{ name: string; urls: string[] }> | undefined;
          if (signingAuthority) {
            const imgUrl = await uploadSignatureImageToR2(signingAuthority.id, signingAuthority.signatureData);
            if (imgUrl) {
              signatureImages = ['Agency Signature', 'Agency Signature 2']
                .filter((n) => tplImageBlocks.length === 0 || tplImageBlocks.includes(n))
                .map((n) => ({ name: n, urls: [imgUrl] }));
            }
          } else {
            // Only attach transparent placeholder when PandaDoc can reach our public API.
            // Dead/stale ngrok or localhost URLs cause createFromTemplate to 400.
            const publicReachable =
              !!baseUrl &&
              !/localhost|127\.0\.0\.1/i.test(baseUrl) &&
              !/\.ngrok(-free)?\.(app|dev)/i.test(baseUrl);
            if (publicReachable) {
              const transparentUrl = `${baseUrl}/api/v1/public/transparent-signature`;
              signatureImages = ['Agency Signature', 'Agency Signature 2']
                .filter((n) => tplImageBlocks.length === 0 || tplImageBlocks.includes(n))
                .map((n) => ({ name: n, urls: [transparentUrl] }));
            }
          }

          const doc = await pandaDocService.createFromTemplate({
            templateId: row.pandaDocTemplateId!,
            name: `${row.lead.client.name} — ${docLabel}`,
            recipients: [{
              email: contact.email!,
              first_name: nameParts[0] || contact.name,
              last_name: nameParts.slice(1).join(' ') || nameParts[0] || '',
              role: recipientRole,
            }],
            tokens,
            images: signatureImages,
            waitForDraft: true,
          });

          docId = doc.id;
          await prisma.proposal.update({
            where: { id: row.id },
            data: { pandaDocId: docId, pandaDocUpdatedAt: new Date() },
          });
        }

        if (!docId) continue;

        if (includeDefaults) {
          for (const f of row.selectedDefaultFiles) {
            try {
              let buf: Buffer;
              if (f.fileUrl.startsWith('http://') || f.fileUrl.startsWith('https://')) {
                const fileRes = await fetch(f.fileUrl);
                if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
                buf = Buffer.from(await fileRes.arrayBuffer());
              } else {
                const r2Result = await getFromR2(f.fileUrl);
                if (!r2Result) throw new Error('File not found in R2');
                buf = r2Result.body;
              }
              await pandaDocService.uploadAttachment(docId, buf, f.name, f.mimeType ?? 'application/octet-stream');
            } catch (err) {
              console.warn(`[Approval] Could not upload attachment "${f.name}" to PandaDoc:`, err);
            }
          }
        }

        try {
          const contactName = (contact.name ?? '').trim() || contact.email!;
          const agencyLabel = row.lead.subCompany?.name ?? 'us';
          const defaultMsg = `Hi ${contactName.split(/\s+/)[0] || 'there'},\n\nPlease review and sign your ${docLabel.toLowerCase()} with ${agencyLabel}.\n\nThank you.`;
          await sendPandaDocWithAgencyFrom({
            documentId: docId,
            recipientEmail: contact.email!,
            recipientName: contactName,
            subject: `${docLabel} Ready for Your Review — ${row.lead.client.name}`,
            message: row.clientMessage ? htmlToPlainText(row.clientMessage) : defaultMsg,
            subCompanyId: row.lead.subCompanyId,
          });
          await prisma.proposal.update({
            where: { id: row.id },
            data: { pandaDocStatus: 'document.sent', pandaDocUpdatedAt: new Date() },
          });
        } catch (sendErr: any) {
          console.warn(`[Approval] PandaDoc CRM delivery failed (${sendErr?.message}) — syncing actual PandaDoc status`);
          try {
            const detail = await pandaDocService.getDocument(docId);
            await prisma.proposal.update({
              where: { id: row.id },
              data: { pandaDocStatus: detail.status, pandaDocUpdatedAt: new Date() },
            });
          } catch (fetchErr) {
            console.error(`[Approval] Could not sync PandaDoc status after send failure:`, fetchErr);
          }
        }
      } catch (err: any) {
        console.error(`[Approval] PandaDoc client email failed for ${row.id}:`, err?.message ?? err, err?.body ?? err);
      }
    }
  })();

  await createActivityLog({
    userId: user.sub,
    userName: reviewerName,
    subCompanyId: proposal.lead.subCompanyId,
    type: 'proposal_approved',
    description: `Approved proposal for ${proposal.lead.client.name}`,
    metadata: { leadId: proposal.leadId, proposalId: proposal.id, clientId: proposal.lead.clientId, clientName: proposal.lead.client.name },
  });

  return res.json({ success: true });
});


// ─── GET /proposals/:id/review-preview ───────────────────────────────────────
// Returns a filled DOCX of the review agreement template for the manager to download/view.
// Zero PandaDoc credits — uses uploaded DOCX + docxtemplater.
router.get('/:id/review-preview', proposalAccess, async (req: Request, res: Response) => {
  if (!(await canReviewProposals(req))) {
    return res.status(403).json({ error: 'Manager access required' });
  }

  const proposal = await prisma.proposal.findUnique({
    where: { id: req.params.id },
    include: {
      lead: {
        include: {
          owner: { select: { firstName: true, lastName: true, email: true, phone: true } },
          client: { select: { name: true, industry: true, location: true, address: true, companySize: true } },
          subCompany: { select: { name: true } },
        },
      },
      selectedContact: { select: { name: true, email: true, title: true, phone: true } },
    },
  });

  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  const proposalAgencyId = await resolveAgencyScope(req);
  if (!proposalAgencyId || proposal.lead.subCompanyId !== proposalAgencyId) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  if (!proposal.isForReview) return res.status(409).json({ error: 'Not a review proposal' });

  const contact = proposal.selectedContact;
  const ownerName = `${proposal.lead.owner.firstName ?? ''} ${proposal.lead.owner.lastName ?? ''}`.trim() || proposal.lead.owner.email;
  const now = new Date();
  const nameParts = (contact?.name ?? '').trim().split(/\s+/);

  const prefill: ProposalPrefill = {
    client: {
      name: proposal.lead.client.name ?? '',
      industry: proposal.lead.client.industry ?? '',
      location: proposal.lead.client.location ?? '',
      address: proposal.lead.client.address ?? '',
      companySize: proposal.lead.client.companySize ?? '',
    },
    contact: contact ? {
      name: contact.name ?? '',
      firstName: nameParts[0] ?? '',
      lastName: nameParts.slice(1).join(' ') || (nameParts[0] ?? ''),
      title: contact.title ?? '',
      email: contact.email ?? '',
      phone: contact.phone ?? '',
    } : null,
    sender: {
      name: ownerName,
      firstName: proposal.lead.owner.firstName ?? '',
      lastName: proposal.lead.owner.lastName ?? '',
      email: proposal.lead.owner.email ?? '',
      phone: proposal.lead.owner.phone ?? '',
    },
    agency: { name: proposal.lead.subCompany?.name ?? '' },
    lead: { value: proposal.lead.value ? String(proposal.lead.value) : '', stage: proposal.lead.stage ?? '' },
    date: {
      today: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      year: String(now.getFullYear()),
    },
    proposal: {
      paymentDays: (proposal.paymentTerms as string)?.match(/\d+/)?.[0] ?? '',
      paymentTermsLabel: (proposal.paymentTerms as string)?.replace('net_', 'Net ') ?? '',
      minimumHours: proposal.tempMinimumHours != null ? String(proposal.tempMinimumHours) : '',
      billingRate: (() => {
        if ((proposal.agreementTypes as string[]).includes('temp') && proposal.tempPricingValue != null) {
          const v = Number(proposal.tempPricingValue);
          return proposal.tempPricingType === 'markup' ? `${v}%` : `$${v}/hr`;
        }
        if ((proposal.agreementTypes as string[]).some(t => t.startsWith('direct')) && proposal.directPricingValue != null) {
          const v = Number(proposal.directPricingValue);
          return (proposal.directPricingType === 'percentage' || proposal.directPricingType === 'markup') ? `${v}%` : `$${v}`;
        }
        return '';
      })(),
      agreementTypeLabel: (proposal.agreementTypes as string[])
        .map(t => t === 'temp' ? 'Temp / Temp to Permanent' : 'Direct Placement')
        .join(', '),
    },
  };

  const types = proposal.agreementTypes as string[];
  const { templateId } = await resolveReviewTemplate(
    proposal.lead.subCompanyId,
    types,
    proposal.reviewTemplateId,
  );

  let resolvedTemplate: { fileKey: string; originalFilename: string } | null = null;
  if (templateId) {
    const tpl = await prisma.reviewTemplate.findUnique({
      where: { id: templateId },
      select: { fileKey: true, originalFilename: true },
    });
    if (tpl) resolvedTemplate = tpl;
  }

  // Legacy fallback: DOCX mapping (older agencies that still use mapped DOCX templates)
  if (!resolvedTemplate) {
    const mapping = await prisma.reviewTemplateMapping.findUnique({
      where: { subCompanyId: proposal.lead.subCompanyId },
      include: {
        tempTemplate: { select: { fileKey: true, originalFilename: true } },
        directTemplate: { select: { fileKey: true, originalFilename: true } },
        bothTemplate: { select: { fileKey: true, originalFilename: true } },
      },
    });
    const hasBoth = types.includes('temp') && types.some(t => t.startsWith('direct'));
    const hasTemp = types.includes('temp') && !hasBoth;
    resolvedTemplate = hasBoth
      ? (mapping?.bothTemplate ?? mapping?.tempTemplate ?? mapping?.directTemplate ?? null)
      : hasTemp
        ? (mapping?.tempTemplate ?? mapping?.bothTemplate ?? null)
        : (mapping?.directTemplate ?? mapping?.bothTemplate ?? null);
  }

  if (!resolvedTemplate) {
    return res.status(404).json({ error: 'No review template mapped for this agreement type. Upload one in Settings → Review Templates.' });
  }

  try {
    const r2File = await getFromR2(resolvedTemplate.fileKey);
    if (!r2File) return res.status(404).json({ error: 'Template file not found in storage' });

    // PDF review templates: stream as-is (no DOCX token fill).
    if (resolvedTemplate.originalFilename.toLowerCase().endsWith('.pdf') ||
        resolvedTemplate.fileKey.toLowerCase().endsWith('.pdf')) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(resolvedTemplate.originalFilename)}"`);
      return res.send(r2File.body);
    }

    const PizZip = (await import('pizzip')).default;
    const Docxtemplater = (await import('docxtemplater')).default;
    const zip = new PizZip(r2File.body);
    const docx = new Docxtemplater(zip, { delimiters: { start: '{{', end: '}}' }, nullGetter: () => '' });
    const tokenMap: Record<string, string> = {};
    const allKeys = [
      'client', 'clientname', 'companyname', 'clientcompanyname',
      'clientindustry', 'industry', 'clientlocation', 'location',
      'clientaddress', 'address', 'companysize',
      'contactname', 'contactfirstname', 'contactlastname',
      'contacttitle', 'jobtitle', 'contactemail', 'contactphone',
      'sendername', 'senderfirstname', 'senderlastname', 'senderemail', 'senderphone',
      'agencyname', 'staffingagency',
      'date', 'today', 'currentdate', 'datetoday', 'year',
      'agreementtype', 'typeofagreement', 'servicetype', 'typeofbusiness',
      'paymentterms', 'ofdays', 'numberofdays', 'paymentdays',
      'billingrate', 'billrate', 'markup', 'markuppercentage', 'billratemarkup', 'rate',
      'minimumhours', 'ofhours', 'numberofhours',
    ];
    for (const key of allKeys) {
      const val = matchProposalToken(key, prefill);
      if (val) tokenMap[key] = val;
    }
    docx.render(tokenMap);
    const docxBuffer = docx.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });

    if (req.query.format === 'html') {
      const mammoth = await import('mammoth');
      const { value: bodyHtml } = await mammoth.convertToHtml({ buffer: docxBuffer });
      const agencyName = prefill.agency.name || 'Agreement Preview';
      const clientName = prefill.client.name || '';
      const today = prefill.date.today;
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Agreement Preview — ${clientName}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Georgia,serif;background:#f1f5f9;min-height:100vh;padding:32px 16px}
    .page{background:#fff;max-width:820px;margin:0 auto;padding:60px 72px;box-shadow:0 4px 24px rgba(0,0,0,.10);border-radius:4px}
    .header{border-bottom:3px solid #1e3a8a;padding-bottom:20px;margin-bottom:32px}
    .header-agency{font-family:system-ui,sans-serif;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#1e3a8a;margin-bottom:6px}
    .header-title{font-size:22px;font-weight:700;color:#0f172a;font-family:system-ui,sans-serif}
    .header-meta{font-size:12px;color:#64748b;margin-top:4px}
    .badge{display:inline-block;background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:4px;font-size:11px;font-weight:600;padding:3px 10px;margin-bottom:28px;font-family:system-ui,sans-serif}
    h1{font-size:20px;color:#1e3a8a;margin:28px 0 10px;font-family:system-ui,sans-serif}
    h2{font-size:16px;color:#1e40af;margin:24px 0 8px;font-family:system-ui,sans-serif}
    h3,h4,h5,h6{font-size:13px;color:#334155;margin:18px 0 6px;font-family:system-ui,sans-serif;text-transform:uppercase;letter-spacing:.06em}
    p{font-size:10.5pt;line-height:1.75;color:#1e293b;margin-bottom:12px}
    ul,ol{padding-left:22px;margin-bottom:12px}
    li{font-size:10.5pt;line-height:1.7;color:#1e293b;margin-bottom:4px}
    table{width:100%;border-collapse:collapse;margin:16px 0;font-size:10pt}
    td,th{border:1px solid #cbd5e1;padding:8px 12px;color:#1e293b;vertical-align:top}
    th{background:#f8fafc;font-weight:700;font-family:system-ui,sans-serif;font-size:10px;text-transform:uppercase;letter-spacing:.05em}
    strong,b{font-weight:700}
    em,i{font-style:italic}
    .footer{border-top:1px solid #e2e8f0;margin-top:48px;padding-top:14px;font-size:10px;color:#94a3b8;text-align:center;font-family:system-ui,sans-serif}
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="header-agency">${agencyName}</div>
      <div class="header-title">Agreement Preview — ${clientName}</div>
      <div class="header-meta">Prepared: ${today}</div>
    </div>
    <div class="badge">📋 For Review Only — No signature required at this stage</div>
    ${bodyHtml}
    <div class="footer">${agencyName} · ${today} · Confidential — For Review Purposes Only</div>
  </div>
</body>
</html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }

    const filename = resolvedTemplate.originalFilename.replace(/\.docx$/i, '') + '-preview.docx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(docxBuffer);
  } catch (err) {
    console.error('[review-preview] DOCX fill failed:', err);
    return res.status(500).json({ error: 'Failed to generate review preview' });
  }
});


// ─── GET /proposals/:id/review-pdf-preview ───────────────────────────────────
// Returns the actual review PDF inline so the manager can see it in the browser
// before approving. Uses the same renderReviewPdf path as the approval flow.
router.get('/:id/review-pdf-preview', proposalAccess, async (req: Request, res: Response) => {
  if (!(await canReviewProposals(req))) {
    return res.status(403).json({ error: 'Manager access required' });
  }

  const proposal = await prisma.proposal.findUnique({
    where: { id: req.params.id },
    include: {
      lead: {
        include: {
          owner: { select: { firstName: true, lastName: true, email: true, phone: true } },
          client: { select: { name: true, industry: true, location: true, address: true, companySize: true } },
          subCompany: { select: { name: true } },
        },
      },
      selectedContact: { select: { name: true, email: true, title: true, phone: true } },
    },
  });

  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  const proposalAgencyId = await resolveAgencyScope(req);
  if (!proposalAgencyId || proposal.lead.subCompanyId !== proposalAgencyId) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  if (!proposal.isForReview) return res.status(409).json({ error: 'Not a review proposal' });

  const contact = proposal.selectedContact;
  const ownerName = `${proposal.lead.owner.firstName ?? ''} ${proposal.lead.owner.lastName ?? ''}`.trim() || proposal.lead.owner.email;
  const now = new Date();
  const nameParts = (contact?.name ?? '').trim().split(/\s+/);

  const primarySigningAuth = await prisma.signingAuthority.findFirst({
    where: { subCompanyId: proposal.lead.subCompanyId, isPrimary: true },
    select: { name: true },
  });

  const prefill: ProposalPrefill = {
    client: {
      name: proposal.lead.client.name ?? '',
      industry: proposal.lead.client.industry ?? '',
      location: proposal.lead.client.location ?? '',
      address: proposal.lead.client.address ?? '',
      companySize: proposal.lead.client.companySize ?? '',
    },
    contact: contact ? {
      name: contact.name ?? '',
      firstName: nameParts[0] ?? '',
      lastName: nameParts.slice(1).join(' ') || (nameParts[0] ?? ''),
      title: contact.title ?? '',
      email: contact.email ?? '',
      phone: contact.phone ?? '',
    } : null,
    sender: {
      name: ownerName,
      firstName: proposal.lead.owner.firstName ?? '',
      lastName: proposal.lead.owner.lastName ?? '',
      email: proposal.lead.owner.email ?? '',
      phone: proposal.lead.owner.phone ?? '',
    },
    agency: { name: proposal.lead.subCompany?.name ?? '' },
    lead: { value: proposal.lead.value ? String(proposal.lead.value) : '', stage: proposal.lead.stage ?? '' },
    date: {
      today: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      year: String(now.getFullYear()),
    },
    proposal: {
      paymentDays: (proposal.paymentTerms as string)?.match(/\d+/)?.[0] ?? '',
      paymentTermsLabel: (proposal.paymentTerms as string)?.replace('net_', 'Net ') ?? '',
      minimumHours: proposal.tempMinimumHours != null ? String(proposal.tempMinimumHours) : '',
      billingRate: (() => {
        if ((proposal.agreementTypes as string[]).includes('temp') && proposal.tempPricingValue != null) {
          const v = Number(proposal.tempPricingValue);
          return proposal.tempPricingType === 'markup' ? `${v}%` : `$${v}/hr`;
        }
        if ((proposal.agreementTypes as string[]).some(t => t.startsWith('direct')) && proposal.directPricingValue != null) {
          const v = Number(proposal.directPricingValue);
          return (proposal.directPricingType === 'percentage' || proposal.directPricingType === 'markup') ? `${v}%` : `$${v}`;
        }
        return '';
      })(),
      agreementTypeLabel: (proposal.agreementTypes as string[])
        .map(t => t === 'temp' ? 'Temp / Temp to Permanent' : 'Direct Placement')
        .join(', '),
    },
    signingAuthority: primarySigningAuth ? { name: primarySigningAuth.name } : undefined,
  };

  const types = proposal.agreementTypes as string[];
  const { templateId } = await resolveReviewTemplate(
    proposal.lead.subCompanyId,
    types,
    proposal.reviewTemplateId,
  );

  try {
    const pdfBuffer = await renderReviewPdf(prefill, { templateId: templateId ?? undefined });
    if (!pdfBuffer) {
      return res.status(422).json({
        error: templateId
          ? 'Review template file could not be loaded from storage. Try re-uploading it in Settings → Review Templates.'
          : 'No review template has been set up for this agreement type. Ask your director to upload one in Settings.',
      });
    }
    const clientName = (proposal.lead.client.name ?? 'agreement').replace(/[^a-z0-9]/gi, '-').toLowerCase();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="review-${clientName}.pdf"`);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('[review-pdf-preview] Failed:', err);
    return res.status(500).json({ error: 'Failed to generate PDF preview' });
  }
});


// ─── GET /proposals/:id/sent-review-pdf ──────────────────────────────────────
// Serves the review PDF that was uploaded to R2 when the review email was sent.
// Accessible to the proposal owner (any role) and managers in the same subcompany.
router.get('/:id/sent-review-pdf', proposalAccess, async (req: Request, res: Response) => {
  const user = req.user!;

  const proposal = await prisma.proposal.findUnique({
    where: { id: req.params.id },
    include: {
      lead: { select: { ownerId: true, subCompanyId: true, client: { select: { name: true } } } },
    },
  });

  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  const proposalAgencyId = await resolveAgencyScope(req);
  if (!proposalAgencyId || proposal.lead.subCompanyId !== proposalAgencyId) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  if (!proposal.isForReview) return res.status(409).json({ error: 'Not a review proposal' });
  if (!proposal.reviewEmailSentAt) return res.status(404).json({ error: 'Review email has not been sent yet' });

  const isOwner = proposal.lead.ownerId === user.sub;
  const isManagerUser = (await canReviewProposals(req));
  if (!isOwner && !isManagerUser) return res.status(403).json({ error: 'Not authorized' });

  try {
    const pdfKey = `review-emails/${proposal.id}/agreement-review.pdf`;
    const r2 = await getFromR2(pdfKey);
    if (!r2) return res.status(404).json({ error: 'Sent review PDF not available' });

    const clientName = (proposal.lead.client.name ?? 'agreement').replace(/[^a-z0-9]/gi, '-').toLowerCase();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="sent-review-${clientName}.pdf"`);
    return res.send(r2.body);
  } catch (err) {
    console.error('[sent-review-pdf] Failed:', err);
    return res.status(500).json({ error: 'Failed to retrieve PDF' });
  }
});


// ─── POST /proposals/:id/approve-for-review ──────────────────────────────────
// Manager approves a review-only proposal: builds PandaDoc PDF + sends via SendGrid.
// Lead stage is intentionally NOT changed — no PandaDoc signing link is issued.
router.post('/:id/approve-for-review', proposalReview, async (req: Request, res: Response) => {
  const user = req.user!;
  const reviewCtx = await ensureAccessContext(req);
  if (!reviewCtx) return res.status(403).json({ error: 'Forbidden' });

  const proposal = await prisma.proposal.findUnique({
    where: { id: req.params.id },
    include: {
      lead: {
        include: {
          owner: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, reportingManagerIds: true, sendAsEmail: true, sendAsDisabled: true } },
          client: { select: { id: true, name: true, industry: true, location: true, address: true, companySize: true } },
          subCompany: { select: { id: true, name: true } },
        },
      },
      selectedContact: { select: { id: true, name: true, email: true, title: true, phone: true, isUnsubscribed: true } },
      selectedDefaultFiles: { select: { id: true, name: true, fileUrl: true, mimeType: true } },
      reviewTemplate: { select: { id: true, name: true, fileKey: true, originalFilename: true } },
    },
  });

  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  const proposalAgencyId = await resolveAgencyScope(req);
  if (!proposalAgencyId || proposal.lead.subCompanyId !== proposalAgencyId) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  if (!proposal.isForReview) return res.status(409).json({ error: 'This proposal is not flagged for review — use /approve instead' });
  if (proposal.status !== 'pending') return res.status(409).json({ error: `Proposal is already ${proposal.status}` });

  const { authEntityId, pair } = await resolvePairAuthEntityId(proposal.id);

  const authReview = await authorizeApprovalAction({
    workflow: 'proposal_review',
    entityId: authEntityId,
    subCompanyId: proposal.lead.subCompanyId,
    actorRoleKey: reviewCtx.roleKey,
    actorPermissions: reviewCtx.permissions,
    action: 'approve',
  });
  if (!authReview.ok) return res.status(authReview.status).json({ error: authReview.error });

  const contact = proposal.selectedContact;
  if (!contact?.email || contact.isUnsubscribed) {
    return res.status(422).json({ error: 'No valid contact email — cannot send review email' });
  }

  const reviewerUser = await prisma.user.findUnique({
    where: { id: user.sub },
    select: { firstName: true, lastName: true, email: true },
  });
  const reviewerName = reviewerUser
    ? `${reviewerUser.firstName ?? ''} ${reviewerUser.lastName ?? ''}`.trim() || reviewerUser.email || 'Manager'
    : 'Manager';

  const reviewedAt = new Date();

  // Resolve From before approve so domain errors do not leave a stuck approved state.
  let ownerSender;
  let agency;
  try {
    ({ from: ownerSender, agency } = await resolveOutboundUserSender({
      userId: proposal.lead.owner.id,
      subCompanyId: proposal.lead.subCompanyId,
      applyOmAgencyEmail: false,
    }));
  } catch (err) {
    if (isSenderDomainError(err)) {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    throw err;
  }

  // Approve in DB — lead stage intentionally left unchanged
  if (pair) {
    await markPairStatus(pair, {
      status: 'approved',
      reviewedAt,
      reviewedById: user.sub,
    });
  } else {
    await prisma.proposal.update({
      where: { id: proposal.id },
      data: { status: 'approved', reviewedAt, reviewedById: user.sub },
    });
  }

  // Send review email(s) — Both = two separate emails with Temp / Direct headings
  void (async () => {
    if (pair) {
      for (const member of pair.members) {
        const label = reviewEmailDocumentLabel(member);
        await sendReviewEmailForProposal({
          proposalId: member.id,
          documentLabel: label,
          includeDefaultFiles: true,
        });
      }
    } else {
      await sendReviewEmailForProposal({ proposalId: proposal.id });
    }
  })();

  await dispatchNotificationToUser({
    userId: proposal.lead.ownerId,
    subCompanyId: proposal.lead.subCompanyId,
    eventKey: 'proposal_approved_review',
    context: {
      entityLabel: pair ? `${proposal.lead.client.name} (Temp + Direct)` : proposal.lead.client.name,
      reviewerName,
    },
    link: '/proposals',
    relatedId: proposal.id,
  });

  const managers = await prisma.user.findMany({
    where: { subCompanyId: proposal.lead.subCompanyId, id: { in: await proposalReviewerIds(proposal.lead.subCompanyId) }, isActive: true },
    select: { id: true },
  });
  const recipients = new Set([proposal.lead.ownerId, ...managers.map(m => m.id)]);
  emitToUsers(Array.from(recipients), 'proposal:refresh', { subCompanyId: proposal.lead.subCompanyId });

  await createActivityLog({
    userId: user.sub,
    userName: reviewerName,
    subCompanyId: proposal.lead.subCompanyId,
    type: 'proposal_approved',
    description: pair
      ? `Approved review proposal for ${proposal.lead.client.name} — Temp + Direct review emails sent to client`
      : `Approved review proposal for ${proposal.lead.client.name} — review email sent to client`,
    metadata: {
      leadId: proposal.leadId,
      proposalId: proposal.id,
      clientId: proposal.lead.clientId,
      clientName: proposal.lead.client.name,
      isReviewEmail: true,
      proposalPairId: pair?.pairId ?? null,
    },
  });

  return res.json({ success: true, pair: serializePairSummary(pair) });
});


// ─── POST /proposals/:id/reject ───────────────────────────────────────────────
router.post('/:id/reject', proposalReview, async (req: Request, res: Response) => {
  const user = req.user!;
  const reviewCtx = await ensureAccessContext(req);
  if (!reviewCtx) return res.status(403).json({ error: 'Forbidden' });
  if (!(await canReviewProposals(req))) {
    return res.status(403).json({ error: 'Manager access required' });
  }

  const { rejectionComment } = req.body;
  if (!rejectionComment || typeof rejectionComment !== 'string' || !rejectionComment.trim()) {
    return res.status(400).json({ error: 'Rejection reason is required' });
  }

  const proposal = await prisma.proposal.findUnique({
    where: { id: req.params.id },
    include: {
      lead: {
        include: {
          owner: { select: { id: true, firstName: true, lastName: true, email: true } },
          client: { select: { name: true } },
        },
      },
    },
  });

  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  if (proposal.status !== 'pending') {
    return res.status(409).json({ error: `Proposal is already ${proposal.status}` });
  }

  const { authEntityId, pair } = await resolvePairAuthEntityId(proposal.id);

  const auth = await authorizeApprovalAction({
    workflow: 'proposal_review',
    entityId: authEntityId,
    subCompanyId: proposal.lead.subCompanyId,
    actorRoleKey: reviewCtx.roleKey,
    actorPermissions: reviewCtx.permissions,
    action: 'reject',
  });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  // Lead stage does NOT change on rejection
  if (pair) {
    await markPairStatus(pair, {
      status: 'rejected',
      rejectionComment: rejectionComment ?? null,
      reviewedById: user.sub,
      reviewedAt: new Date(),
    });
  } else {
    await prisma.proposal.update({
      where: { id: proposal.id },
      data: {
        status: 'rejected',
        rejectionComment: rejectionComment ?? null,
        reviewedById: user.sub,
        reviewedAt: new Date(),
      },
    });
  }

  const ownerName = `${proposal.lead.owner.firstName ?? ''} ${proposal.lead.owner.lastName ?? ''}`.trim() || proposal.lead.owner.email;
  const reviewerUser = await prisma.user.findUnique({ where: { id: user.sub }, select: { firstName: true, lastName: true, email: true } });
  const reviewerName = reviewerUser ? `${reviewerUser.firstName ?? ''} ${reviewerUser.lastName ?? ''}`.trim() || reviewerUser.email || 'Manager' : user.email ?? 'Manager';

  await dispatchNotificationToUser({
    userId: proposal.lead.ownerId,
    subCompanyId: proposal.lead.subCompanyId,
    eventKey: 'proposal_rejected',
    context: {
      entityLabel: proposal.lead.client.name,
      rejectionComment: rejectionComment ?? '',
      rejectionSuffix: rejectionComment ? `: ${rejectionComment}` : '',
    },
    link: '/pipeline',
    relatedId: proposal.id,
  });

  emitToUsers([proposal.lead.ownerId], 'proposal:rejected', {
    proposalId: proposal.id,
    leadId: proposal.leadId,
    clientName: proposal.lead.client.name,
    reviewerName,
    rejectionComment: rejectionComment ?? null,
  });

  // Trigger proposals list refresh for all managers
  const rejectManagers = await prisma.user.findMany({
    where: { subCompanyId: proposal.lead.subCompanyId, id: { in: await proposalReviewerIds(proposal.lead.subCompanyId) }, isActive: true },
    select: { id: true },
  });
  emitToUsers([...rejectManagers.map(m => m.id), proposal.lead.ownerId], 'proposal:refresh', { subCompanyId: proposal.lead.subCompanyId });

  const agency = await getAgencyBranding(proposal.lead.subCompanyId);
  sendProposalRejectedEmail({
    to: proposal.lead.owner.email,
    ownerName,
    clientName: proposal.lead.client.name,
    reviewerName,
    rejectionComment: rejectionComment ?? undefined,
    pipelineLink: `${process.env.APP_URL ?? process.env.FRONTEND_URL}/pipeline`,
    agency,
  }).catch(console.error);

  await createActivityLog({
    userId: user.sub,
    userName: reviewerName,
    subCompanyId: proposal.lead.subCompanyId,
    type: 'proposal_rejected',
    description: `Rejected proposal for ${proposal.lead.client.name}`,
    metadata: { leadId: proposal.leadId, proposalId: proposal.id, clientId: proposal.lead.clientId, clientName: proposal.lead.client.name, reason: rejectionComment },
  });

  return res.json({ success: true });
});


// ─── POST /proposals/leads/:leadId/reset ──────────────────────────────────────
// Resets a rejected lead back to 'new_lead' stage.
router.post('/leads/:leadId/reset', proposalReview, async (req: Request, res: Response) => {
  const user = req.user!;
  const { leadId } = req.params;

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { client: { select: { id: true, name: true } } },
  });

  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const canReset =
    lead.ownerId === user.sub || (await canReviewProposals(req));

  if (!canReset) return res.status(403).json({ error: 'Not authorized' });

  const rejectedProposal = await prisma.proposal.findFirst({
    where: { leadId, status: 'rejected' },
    orderBy: { createdAt: 'desc' },
  });

  if (!rejectedProposal) {
    return res.status(400).json({ error: 'No rejected proposal found for this lead' });
  }

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: leadId },
      data: { stage: 'new_lead', status: 'open', updatedAt: new Date() },
    });

    await syncClientStatusFromLeadOutcomes({
      tx,
      clientId: lead.clientId,
      subCompanyId: lead.subCompanyId,
      touchLastActivityAt: new Date(),
    });
  });

  await invalidateClientListCache(lead.subCompanyId);

  void (async () => {
    const u = await prisma.user.findUnique({ where: { id: user.sub }, select: { firstName: true, lastName: true, email: true } });
    const actorName = u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email || 'User' : 'User';
    await createActivityLog({
      userId: user.sub,
      userName: actorName,
      subCompanyId: lead.subCompanyId,
      type: 'pipeline_moved',
      description: `Reset lead for ${lead.client.name} back to new_lead after rejected proposal`,
      metadata: { leadId, clientId: lead.client.id, clientName: lead.client.name, fromStage: lead.stage, toStage: 'new_lead', reason: 'reset_after_rejected_proposal' },
    });
  })();

  return res.json({ success: true });
});

// ─── POST /proposals/:id/activate ────────────────────────────────────────────
// Manager action: activates a Closed Won Pending lead → client becomes Active.
router.post('/:id/activate', proposalReview, async (req: Request, res: Response) => {
  const user = req.user!;
  if (!(await canReviewProposals(req))) {
    return res.status(403).json({ error: 'Manager access required' });
  }

  const proposal = await prisma.proposal.findUnique({
    where: { id: req.params.id },
    include: {
      lead: {
        include: {
          owner: { select: { id: true, firstName: true, lastName: true, email: true } },
          client: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  if (proposal.status !== 'approved') {
    return res.status(409).json({ error: 'Only approved proposals can be activated' });
  }
  if (proposal.activatedAt) {
    return res.status(409).json({ error: 'Proposal has already been activated' });
  }
  if (proposal.lead.status !== 'closed_won_pending' && proposal.lead.status !== 'closed_won') {
    return res.status(409).json({ error: 'Lead must be in Closed Won state to activate' });
  }

  const pair = await loadPairByProposalId(proposal.id);

  const reviewerUser = await prisma.user.findUnique({ where: { id: user.sub }, select: { firstName: true, lastName: true, email: true } });
  const activatorName = reviewerUser ? `${reviewerUser.firstName ?? ''} ${reviewerUser.lastName ?? ''}`.trim() || reviewerUser.email || 'Manager' : 'Manager';

  const isFreshCloseWon = proposal.lead.status !== 'closed_won';
  const activatedAt = new Date();
  await prisma.$transaction(async (tx) => {
    if (pair) {
      for (const member of pair.members) {
        if (member.activatedAt) continue;
        await tx.proposal.update({
          where: { id: member.id },
          data: {
            activatedAt,
            activatedById: user.sub,
          },
        });
      }
    } else {
      await tx.proposal.update({
        where: { id: proposal.id },
        data: {
          activatedAt,
          activatedById: user.sub,
          awaitingClientDueAt: null,
        },
      });
    }

    if (pair) {
      await tx.proposal.updateMany({
        where: { proposalPairId: pair.pairId },
        data: { awaitingClientDueAt: null },
      });
    }

    await tx.lead.update({
      where: { id: proposal.leadId },
      data: { stage: 'closed_won', status: 'closed_won', closedAt: new Date(), closedById: user.sub, updatedAt: new Date() },
    });

    await syncClientStatusFromLeadOutcomes({
      tx,
      clientId: proposal.lead.clientId,
      subCompanyId: proposal.lead.subCompanyId,
      touchLastActivityAt: new Date(),
    });

    if (isFreshCloseWon) {
      await autoAssignOwnershipForClosedWon({
        tx,
        clientId: proposal.lead.clientId,
        leadId: proposal.leadId,
        subCompanyId: proposal.lead.subCompanyId,
        actorId: user.sub,
        actorName: activatorName,
        proposalId: proposal.id,
      });
    }
  });

  await invalidateClientListCache(proposal.lead.subCompanyId);

  await dispatchNotificationToUser({
    userId: proposal.lead.ownerId,
    subCompanyId: proposal.lead.subCompanyId,
    eventKey: 'proposal_approved_lead_activated',
    context: { entityLabel: proposal.lead.client.name, activatorName },
    link: '/pipeline',
    relatedId: proposal.id,
  });

  const activateManagers = await prisma.user.findMany({
    where: { subCompanyId: proposal.lead.subCompanyId, id: { in: await proposalReviewerIds(proposal.lead.subCompanyId) }, isActive: true },
    select: { id: true },
  });
  const activationEventRecipients = new Set([proposal.lead.ownerId, ...activateManagers.map(m => m.id)]);
  emitToUsers(Array.from(activationEventRecipients), 'proposal:approved', {
    proposalId: proposal.id,
    leadId: proposal.leadId,
    clientId: proposal.lead.clientId,
    clientName: proposal.lead.client.name,
    reviewerName: activatorName,
    activated: true,
  });

  // Trigger proposals list refresh for all managers + the lead owner (so CWP tab auto-removes)
  const refreshIds = new Set([...activateManagers.map(m => m.id), proposal.lead.ownerId]);
  emitToUsers(Array.from(refreshIds), 'proposal:refresh', { subCompanyId: proposal.lead.subCompanyId });
  emitToUsers(Array.from(refreshIds), 'client:refresh', { subCompanyId: proposal.lead.subCompanyId });

  await createActivityLog({
    userId: user.sub,
    userName: activatorName,
    subCompanyId: proposal.lead.subCompanyId,
    type: 'lead_won',
    description: `Activated lead for ${proposal.lead.client.name} — client is now Active`,
    metadata: { leadId: proposal.leadId, proposalId: proposal.id, clientId: proposal.lead.clientId, clientName: proposal.lead.client.name },
  });

  return res.json({ success: true });
});

// ─── POST /proposals/:id/approve-and-activate ───────────────────────────────
// Manager action during the proposal approval phase: skip the awaiting-client
// wait and move the lead straight to Closed Won. Combines /approve + /activate
// into a single transaction so we never PandaDoc-email the client.
router.post('/:id/approve-and-activate', proposalReview, async (req: Request, res: Response) => {
  const user = req.user!;
  const reviewCtx = await ensureAccessContext(req);
  if (!reviewCtx) return res.status(403).json({ error: 'Forbidden' });
  if (!(await canReviewProposals(req))) {
    return res.status(403).json({ error: 'Manager access required' });
  }

  const proposal = await prisma.proposal.findUnique({
    where: { id: req.params.id },
    include: {
      lead: {
        include: {
          owner: { select: { id: true, firstName: true, lastName: true, email: true } },
          client: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  if (proposal.status !== 'pending') {
    return res.status(409).json({ error: `Proposal is already ${proposal.status}` });
  }
  if (proposal.isForReview) {
    return res.status(409).json({ error: 'Review-only proposals cannot be activated directly' });
  }
  if (!proposal.lead.ownerId) {
    return res.status(409).json({ error: 'Lead has no assigned associate' });
  }
  if (proposal.lead.status === 'closed_won' || proposal.lead.status === 'closed_won_pending') {
    return res.status(409).json({ error: 'Lead is already in Closed Won state' });
  }

  const auth = await authorizeApprovalAction({
    workflow: 'proposal_review',
    entityId: proposal.id,
    subCompanyId: proposal.lead.subCompanyId,
    actorRoleKey: reviewCtx.roleKey,
    actorPermissions: reviewCtx.permissions,
    action: 'approve',
  });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const now = new Date();

  const reviewerUser = await prisma.user.findUnique({ where: { id: user.sub }, select: { firstName: true, lastName: true, email: true } });
  const activatorName = reviewerUser ? `${reviewerUser.firstName ?? ''} ${reviewerUser.lastName ?? ''}`.trim() || reviewerUser.email || 'Manager' : 'Manager';

  await prisma.$transaction(async (tx) => {
    await tx.proposal.update({
      where: { id: proposal.id },
      data: {
        status: 'approved',
        reviewedById: user.sub,
        reviewedAt: now,
        activatedAt: now,
        activatedById: user.sub,
      },
    });

    await tx.lead.update({
      where: { id: proposal.leadId },
      data: {
        stage: 'closed_won',
        status: 'closed_won',
        lossReason: null,
        closedAt: now,
        closedById: user.sub,
        updatedAt: now,
      },
    });

    await syncClientStatusFromLeadOutcomes({
      tx,
      clientId: proposal.lead.clientId,
      subCompanyId: proposal.lead.subCompanyId,
      touchLastActivityAt: now,
    });

    await autoAssignOwnershipForClosedWon({
      tx,
      clientId: proposal.lead.clientId,
      leadId: proposal.leadId,
      subCompanyId: proposal.lead.subCompanyId,
      actorId: user.sub,
      actorName: activatorName,
      proposalId: proposal.id,
    });
  });

  await invalidateClientListCache(proposal.lead.subCompanyId);

  await dispatchNotificationToUser({
    userId: proposal.lead.ownerId,
    subCompanyId: proposal.lead.subCompanyId,
    eventKey: 'proposal_approved_lead_activated',
    context: { entityLabel: proposal.lead.client.name, activatorName },
    link: '/pipeline',
    relatedId: proposal.id,
  });

  const managers = await prisma.user.findMany({
    where: { subCompanyId: proposal.lead.subCompanyId, id: { in: await proposalReviewerIds(proposal.lead.subCompanyId) }, isActive: true },
    select: { id: true },
  });
  const recipients = new Set([proposal.lead.ownerId, ...managers.map(m => m.id)]);
  emitToUsers(Array.from(recipients), 'proposal:approved', {
    proposalId: proposal.id,
    leadId: proposal.leadId,
    clientId: proposal.lead.clientId,
    clientName: proposal.lead.client.name,
    reviewerName: activatorName,
    activated: true,
  });
  emitToUsers(Array.from(recipients), 'proposal:refresh', { subCompanyId: proposal.lead.subCompanyId });
  emitToUsers(Array.from(recipients), 'client:refresh', { subCompanyId: proposal.lead.subCompanyId });

  await createActivityLog({
    userId: user.sub,
    userName: activatorName,
    subCompanyId: proposal.lead.subCompanyId,
    type: 'lead_won',
    description: `Activated lead for ${proposal.lead.client.name} — client is now Active`,
    metadata: { leadId: proposal.leadId, proposalId: proposal.id, clientId: proposal.lead.clientId, clientName: proposal.lead.client.name, viaApprovalShortcut: true },
  });

  return res.json({ success: true });
});


// ─── GET /proposals/:id/documents ────────────────────────────────────────────
// List documents for a proposal (sent to client + received from client).
router.get('/:id/documents', proposalAccess, async (req: Request, res: Response) => {
  const proposal = await prisma.proposal.findUnique({
    where: { id: req.params.id },
    include: { lead: { select: { subCompanyId: true } } },
  });
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  if (!(await canAccessProposalAgency(req, proposal.lead.subCompanyId))) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const documents = await prisma.proposalDocument.findMany({
    where: { proposalId: proposal.id },
    orderBy: { createdAt: 'desc' },
    include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
  });

  return res.json({ documents });
});


// ─── POST /proposals/:id/documents ───────────────────────────────────────────
// Upload a document for a Closed Won Pending proposal.
router.post('/:id/documents', proposalWrite, async (req: Request, res: Response) => {
  const user = req.user!;
  const { category, name, fileBase64, mimeType } = req.body;

  if (!category || !['sent_to_client', 'received_from_client'].includes(category)) {
    return res.status(400).json({ error: 'category must be sent_to_client or received_from_client' });
  }
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!fileBase64 || typeof fileBase64 !== 'string') {
    return res.status(400).json({ error: 'fileBase64 is required' });
  }

  const proposal = await prisma.proposal.findUnique({
    where: { id: req.params.id },
    include: { lead: { select: { subCompanyId: true, status: true, ownerId: true } } },
  });

  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  if (proposal.lead.subCompanyId !== user.subCompanyId) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  if (proposal.status !== 'approved' || !['closed_won_pending', 'closed_won'].includes(proposal.lead.status)) {
    return res.status(409).json({ error: 'Documents can only be uploaded on approved Closed Won proposals' });
  }

  // Associates can only upload for their own leads, managers can upload for any
  const isManagerUser = (await canReviewProposals(req));
  if (!isManagerUser && proposal.lead.ownerId !== effectiveActorId(req)) {
    return res.status(403).json({ error: 'You can only upload documents for your own leads' });
  }

  const maxSize = parseInt(env.MAX_FILE_SIZE ?? '10485760', 10);
  let buffer: Buffer;
  try {
    buffer = Buffer.from(fileBase64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Invalid base64 file content' });
  }
  if (buffer.length > maxSize) {
    return res.status(400).json({ error: `File too large (max ${Math.round(maxSize / 1024 / 1024)}MB)` });
  }

  const ext = name.split('.').pop()?.slice(0, 10) ?? 'bin';
  const contentType = mimeType ?? (ext === 'pdf' ? 'application/pdf' : 'application/octet-stream');
  const key = `proposal-docs/${proposal.id}/${category}/${Date.now()}-${name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

  const fileUrl = await uploadToR2(key, buffer, contentType);

  const doc = await prisma.proposalDocument.create({
    data: {
      proposalId: proposal.id,
      category,
      name: name.trim(),
      size: BigInt(buffer.length),
      type: contentType,
      url: fileUrl ?? key,
      uploadedById: effectiveActorId(req),
    },
    include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
  });

  // When a signed doc is uploaded manually, auto-advance to Pending Activations (same as PandaDoc signed flow)
  if (category === 'received_from_client') {
    const wasRejected = proposal.reviewRejectedAt && proposal.reviewRequestedAt &&
      new Date(proposal.reviewRejectedAt).getTime() >= new Date(proposal.reviewRequestedAt).getTime();
    const alreadySubmitted = proposal.reviewRequestedAt && !wasRejected;
    if (!alreadySubmitted) {
      await prisma.proposal.update({
        where: { id: proposal.id },
        data: {
          reviewRequestedAt: new Date(),
          reviewRequestedById: effectiveActorId(req),
          reviewRejectedAt: null,
          reviewRejectedById: null,
          reviewRejectionComment: null,
        },
      });
    }
  }

  // Notify managers when associate uploads a document
  if (!isManagerUser) {
    const managers = await prisma.user.findMany({
      where: { subCompanyId: proposal.lead.subCompanyId, id: { in: await proposalReviewerIds(proposal.lead.subCompanyId) }, isActive: true },
      select: { id: true },
    });
    emitToUsers(managers.map(m => m.id), 'proposal:refresh', { subCompanyId: proposal.lead.subCompanyId });
  }

  return res.status(201).json({ ...doc, size: Number(doc.size) });
});


// ─── PATCH /proposals/documents/:docId ────────────────────────────────────────
// Replace the file content of a received_from_client document.
// Only the lead owner (or a manager) can do this. Category cannot change.
router.patch('/documents/:docId', proposalWrite, async (req: Request, res: Response) => {
  const user = req.user!;
  const { name, fileBase64, mimeType } = req.body;

  if (!name || !fileBase64) {
    return res.status(400).json({ error: 'name and fileBase64 are required' });
  }

  const doc = await prisma.proposalDocument.findUnique({
    where: { id: req.params.docId },
    include: {
      proposal: {
        include: {
          lead: { select: { id: true, ownerId: true, subCompanyId: true } },
        },
      },
    },
  });

  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (doc.proposal.lead.subCompanyId !== user.subCompanyId) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  // Only received_from_client docs are replaceable this way
  if (doc.category !== 'received_from_client') {
    return res.status(400).json({ error: 'Only received_from_client documents can be replaced' });
  }

  const isManagerUser = (await canReviewProposals(req));
  if (!isManagerUser && doc.proposal.lead.ownerId !== effectiveActorId(req)) {
    return res.status(403).json({ error: 'Only the lead owner can replace this document' });
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(fileBase64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Invalid base64 content' });
  }

  const maxSize = 25 * 1024 * 1024;
  if (buffer.length > maxSize) {
    return res.status(400).json({ error: 'File too large (max 25MB)' });
  }

  const ext = name.split('.').pop()?.slice(0, 10) ?? 'bin';
  const contentType = mimeType ?? (ext === 'pdf' ? 'application/pdf' : 'application/octet-stream');
  const key = `proposal-docs/${doc.proposalId}/received_from_client/${Date.now()}-${name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  const fileUrl = await uploadToR2(key, buffer, contentType);

  const updated = await prisma.proposalDocument.update({
    where: { id: doc.id },
    data: {
      name: name.trim(),
      size: BigInt(buffer.length),
      type: contentType,
      url: fileUrl ?? key,
      uploadedById: effectiveActorId(req),
    },
    include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
  });

  // Notify managers of the replacement
  const managers = await prisma.user.findMany({
    where: { subCompanyId: user.subCompanyId, id: { in: await proposalReviewerIds(doc.proposal.lead.subCompanyId) }, isActive: true },
    select: { id: true },
  });
  emitToUsers(managers.map(m => m.id), 'proposal:refresh', { subCompanyId: user.subCompanyId });

  return res.json({ ...updated, size: Number(updated.size) });
});


// ─── POST /proposals/:id/request-review ───────────────────────────────────────
// Associate marks the proposal as ready for manager review after completing documents.
router.post('/:id/request-review', proposalWrite, async (req: Request, res: Response) => {
  const user = req.user!;

  const proposal = await prisma.proposal.findUnique({
    where: { id: req.params.id },
    include: {
      lead: {
        include: {
          owner: { select: { id: true, firstName: true, lastName: true, email: true, reportingManagerIds: true } },
          client: { select: { id: true, name: true } },
        },
      },
      proposalDocuments: { select: { category: true } },
    },
  });

  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  if (proposal.lead.subCompanyId !== user.subCompanyId) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  if (proposal.status !== 'approved' || !['closed_won_pending', 'closed_won'].includes(proposal.lead.status)) {
    return res.status(409).json({ error: 'Proposal must be approved and lead must be Closed Won' });
  }

  // Only the lead owner or a manager can request review
  const isManagerUser = (await canReviewProposals(req));
  if (!isManagerUser && proposal.lead.ownerId !== effectiveActorId(req)) {
    return res.status(403).json({ error: 'Only the lead owner can submit for review' });
  }

  // Block duplicate submissions — allow resubmission only if review was rejected after the last request
  const wasRejectedAfterRequest = proposal.reviewRejectedAt && proposal.reviewRequestedAt
    && new Date(proposal.reviewRejectedAt).getTime() >= new Date(proposal.reviewRequestedAt).getTime();
  if (proposal.reviewRequestedAt && !wasRejectedAfterRequest) {
    return res.status(409).json({ error: 'Review has already been requested for this proposal' });
  }

  // Validate that both document sides exist
  const hasSent = proposal.proposalDocuments.some(d => d.category === 'sent_to_client');
  const hasReceived = proposal.proposalDocuments.some(d => d.category === 'received_from_client');
  if (!hasSent || !hasReceived) {
    return res.status(400).json({ error: 'Both Sent to Client and Received from Client documents are required before submitting for review' });
  }

  await prisma.proposal.update({
    where: { id: proposal.id },
    data: {
      reviewRequestedAt: new Date(),
      reviewRequestedById: effectiveActorId(req),
      // Clear rejection fields on resubmission
      reviewRejectedAt: null,
      reviewRejectedById: null,
      reviewRejectionComment: null,
    },
  });

  // Resolve the actor display name
  const actorUser = await prisma.user.findUnique({ where: { id: effectiveActorId(req) }, select: { firstName: true, lastName: true, email: true } });
  const actorName = actorUser ? `${actorUser.firstName ?? ''} ${actorUser.lastName ?? ''}`.trim() || actorUser.email || 'User' : 'User';

  // Notify only the reporting managers of the lead owner — no one else
  const reportingManagerIds = (proposal.lead.owner.reportingManagerIds as string[]) ?? [];
  if (reportingManagerIds.length > 0) {
    await dispatchNotification({
      eventKey: 'proposal_submitted_documents_ready',
      userIds: reportingManagerIds,
      subCompanyId: proposal.lead.subCompanyId,
      context: { entityLabel: proposal.lead.client.name, actorName },
      link: `/proposals?manage=${proposal.id}`,
      relatedId: proposal.id,
    });

    emitToUsers(reportingManagerIds, 'notification:new', {
      type: 'proposal_review_requested',
      proposalId: proposal.id,
      leadId: proposal.leadId,
      clientName: proposal.lead.client.name,
      submittedBy: actorName,
    });
  }

  // Refresh only the reporting managers + the submitter themselves
  const refreshIds = new Set([...reportingManagerIds, user.sub]);
  emitToUsers(Array.from(refreshIds), 'proposal:refresh', { subCompanyId: proposal.lead.subCompanyId });

  await createActivityLog({
    userId: user.sub,
    userName: actorName,
    subCompanyId: proposal.lead.subCompanyId,
    type: 'proposal_approved',
    description: `Submitted ${proposal.lead.client.name} documents for manager review`,
    metadata: { leadId: proposal.leadId, proposalId: proposal.id, clientId: proposal.lead.clientId, clientName: proposal.lead.client.name },
  });

  return res.json({ success: true });
});


// ─── POST /proposals/:id/reject-review ────────────────────────────────────────
// Manager rejects the review and requests resubmission with a reason.
router.post('/:id/reject-review', proposalReview, async (req: Request, res: Response) => {
  const user = req.user!;
  if (!(await canReviewProposals(req))) {
    return res.status(403).json({ error: 'Manager access required' });
  }

  const { comment } = req.body;
  if (!comment || typeof comment !== 'string' || !comment.trim()) {
    return res.status(400).json({ error: 'Rejection reason is required' });
  }

  const proposal = await prisma.proposal.findUnique({
    where: { id: req.params.id },
    include: {
      lead: {
        include: {
          owner: { select: { id: true, firstName: true, lastName: true, email: true } },
          client: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  if (proposal.lead.subCompanyId !== user.subCompanyId) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  if (proposal.status !== 'approved' || !['closed_won_pending', 'closed_won'].includes(proposal.lead.status)) {
    return res.status(409).json({ error: 'Proposal must be approved and lead must be Closed Won' });
  }
  if (!proposal.reviewRequestedAt) {
    return res.status(409).json({ error: 'No review has been submitted for this proposal' });
  }
  // Block if already rejected after the latest request (no double-reject)
  if (proposal.reviewRejectedAt && new Date(proposal.reviewRejectedAt).getTime() >= new Date(proposal.reviewRequestedAt).getTime()) {
    return res.status(409).json({ error: 'Review has already been rejected. Waiting for associate to resubmit.' });
  }

  await prisma.proposal.update({
    where: { id: proposal.id },
    data: {
      reviewRejectedAt: new Date(),
      reviewRejectedById: user.sub,
      reviewRejectionComment: comment.trim(),
    },
  });

  const reviewerUser = await prisma.user.findUnique({ where: { id: user.sub }, select: { firstName: true, lastName: true, email: true } });
  const reviewerName = reviewerUser ? `${reviewerUser.firstName ?? ''} ${reviewerUser.lastName ?? ''}`.trim() || reviewerUser.email || 'Manager' : 'Manager';

  // Notify the lead owner (associate) about the rejection
  await dispatchNotificationToUser({
    userId: proposal.lead.ownerId,
    subCompanyId: proposal.lead.subCompanyId,
    eventKey: 'proposal_rejected_review',
    context: {
      entityLabel: proposal.lead.client.name,
      reviewerName,
      rejectionComment: comment.trim(),
    },
    link: `/proposals?manage=${proposal.id}`,
    relatedId: proposal.id,
  });

  emitToUsers([proposal.lead.ownerId], 'notification:new', {
    type: 'proposal_review_rejected',
    proposalId: proposal.id,
    leadId: proposal.leadId,
    clientName: proposal.lead.client.name,
    reviewerName,
  });

  // Refresh for lead owner, acting manager, and all agency managers
  const agencyManagers = await prisma.user.findMany({
    where: { subCompanyId: proposal.lead.subCompanyId, id: { in: await proposalReviewerIds(proposal.lead.subCompanyId) }, isActive: true },
    select: { id: true },
  });
  const allRefreshIds = new Set([proposal.lead.ownerId, user.sub, ...agencyManagers.map(m => m.id)]);
  emitToUsers(Array.from(allRefreshIds), 'proposal:refresh', { subCompanyId: proposal.lead.subCompanyId });

  await createActivityLog({
    userId: user.sub,
    userName: reviewerName,
    subCompanyId: proposal.lead.subCompanyId,
    type: 'proposal_rejected',
    description: `Rejected review for ${proposal.lead.client.name} and requested resubmission`,
    metadata: { leadId: proposal.leadId, proposalId: proposal.id, clientId: proposal.lead.clientId, clientName: proposal.lead.client.name, reason: comment.trim() },
  });

  return res.json({ success: true });
});


// ─── GET /proposals/:id/contacts ──────────────────────────────────────────────
// Fetch client contacts for the proposal's lead client.
router.get('/:id/contacts', proposalAccess, async (req: Request, res: Response) => {
  const proposal = await prisma.proposal.findUnique({
    where: { id: req.params.id },
    include: { lead: { select: { subCompanyId: true, clientId: true } } },
  });
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  if (!(await canAccessProposalAgency(req, proposal.lead.subCompanyId))) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const contacts = await prisma.clientContact.findMany({
    where: { clientId: proposal.lead.clientId },
    orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      email: true,
      title: true,
      isPrimary: true,
      isUnsubscribed: true,
    },
  });

  return res.json({ contacts });
});


// ─── POST /proposals/:id/send-to-client ──────────────────────────────────────
// Upload document(s), email them to a selected client contact, and record delivery.
router.post('/:id/send-to-client', proposalReview, async (req: Request, res: Response) => {
  const user = req.user!;
  const { contactId, files } = req.body as {
    contactId?: string;
    files?: { name: string; fileBase64: string; mimeType?: string }[];
  };

  if (!contactId || typeof contactId !== 'string') {
    return res.status(400).json({ error: 'contactId is required' });
  }
  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'At least one file is required' });
  }
  for (const f of files) {
    if (!f.name || typeof f.name !== 'string' || !f.name.trim()) {
      return res.status(400).json({ error: 'Each file must have a name' });
    }
    if (!f.fileBase64 || typeof f.fileBase64 !== 'string') {
      return res.status(400).json({ error: 'Each file must have fileBase64' });
    }
  }

  const proposal = await prisma.proposal.findUnique({
    where: { id: req.params.id },
    include: {
      lead: {
        select: {
          subCompanyId: true, status: true, ownerId: true, clientId: true,
          client: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  if (proposal.lead.subCompanyId !== user.subCompanyId) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  if (proposal.status !== 'approved' || !['closed_won_pending', 'closed_won'].includes(proposal.lead.status)) {
    return res.status(409).json({ error: 'Documents can only be sent on approved Closed Won proposals' });
  }

  const isManagerUser = (await canReviewProposals(req));
  if (!isManagerUser && proposal.lead.ownerId !== user.sub) {
    return res.status(403).json({ error: 'You can only send documents for your own leads' });
  }

  // Validate contact
  const contact = await prisma.clientContact.findFirst({
    where: { id: contactId, clientId: proposal.lead.clientId },
    select: { id: true, name: true, email: true, isUnsubscribed: true },
  });
  if (!contact) return res.status(404).json({ error: 'Client contact not found' });
  if (!contact.email) return res.status(400).json({ error: 'Selected contact has no email address' });
  if (contact.isUnsubscribed) return res.status(400).json({ error: 'Selected contact is unsubscribed' });

  // Parse and validate all files
  const maxSize = parseInt(env.MAX_FILE_SIZE ?? '10485760', 10);
  const parsedFiles: { name: string; buffer: Buffer; contentType: string }[] = [];
  for (const f of files) {
    let buffer: Buffer;
    try {
      buffer = Buffer.from(f.fileBase64, 'base64');
    } catch {
      return res.status(400).json({ error: `Invalid base64 content for file "${f.name}"` });
    }
    if (buffer.length > maxSize) {
      return res.status(400).json({ error: `File "${f.name}" is too large (max ${Math.round(maxSize / 1024 / 1024)}MB)` });
    }
    const ext = f.name.split('.').pop()?.slice(0, 10) ?? 'bin';
    const contentType = f.mimeType ?? (ext === 'pdf' ? 'application/pdf' : 'application/octet-stream');
    parsedFiles.push({ name: f.name.trim(), buffer, contentType });
  }

  // Resolve From before R2 upload so domain errors do not orphan files.
  let sender;
  let agency;
  try {
    ({ from: sender, agency } = await resolveOutboundUserSender({
      userId: user.sub,
      subCompanyId: proposal.lead.subCompanyId,
      applyOmAgencyEmail: false,
    }));
  } catch (err) {
    if (isSenderDomainError(err)) {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    throw err;
  }

  // Upload all files to R2 first
  const uploadedFiles: { name: string; url: string; size: number; contentType: string; base64: string }[] = [];
  for (const pf of parsedFiles) {
    const key = `proposal-docs/${proposal.id}/sent_to_client/${Date.now()}-${pf.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const fileUrl = await uploadToR2(key, pf.buffer, pf.contentType);
    uploadedFiles.push({
      name: pf.name,
      url: fileUrl ?? key,
      size: pf.buffer.length,
      contentType: pf.contentType,
      base64: pf.buffer.toString('base64'),
    });
  }

  // Send email with attachments
  const senderUser = await prisma.user.findUnique({
    where: { id: user.sub },
    select: { firstName: true, lastName: true, email: true },
  });
  const senderName = senderUser
    ? `${senderUser.firstName ?? ''} ${senderUser.lastName ?? ''}`.trim() || senderUser.email || 'Team'
    : 'Team';

  const agencyName = agency?.name ?? 'Our Team';
  const agencySystemFrom = {
    email: agency?.emailFromAddress ?? '',
    name: agency?.emailFromName ?? agencyName,
  };
  const fileListHtml = uploadedFiles.map((f) => `<li>${f.name}</li>`).join('');

  let emailSent = false;
  let sentSubject = '';
  let sentBodyHtml = '';
  const outboundFrom = sender.email ? sender : agencySystemFrom;
  try {
    const sig = await resolveSenderSignatureBlock(
      user.sub,
      senderName,
      agencyName,
      agency?.emailSignatureTemplate,
      {
        email: (sender.email || agencySystemFrom.email) || undefined,
        logoUrl: agency?.logoUrl,
        tagline: agency?.emailTagline,
        subCompanyId: proposal.lead.subCompanyId,
      },
    );
    sentSubject = `Documents from ${agencyName} — ${proposal.lead.client.name}`;
    sentBodyHtml = injectSenderSignature(
      `
        <p>Hello ${contact.name},</p>
        <p>${senderName} from ${agencyName} has sent you the following document(s) for your review:</p>
        <ul>${fileListHtml}</ul>
        <p>Please review and return signed copies at your earliest convenience.</p>
      `,
      sig.html,
    );
    emailSent = await sendClientEmail({
      to: [{ email: contact.email!, name: contact.name }],
      from: outboundFrom,
      replyTo: { email: buildCrmReplyToAddress(proposal.id, user.sub, agency) },
      subCompanyId: proposal.lead.subCompanyId,
      subject: sentSubject,
      html: sentBodyHtml,
      attachments: [
        ...uploadedFiles.map((f) => ({
          content: f.base64,
          filename: f.name,
          type: f.contentType,
          disposition: 'attachment' as const,
        })),
        ...sig.inlineAttachments,
      ],
    });
  } catch (err) {
    console.error('[send-to-client] Email send failed:', err);
  }

  if (!emailSent) {
    return res.status(502).json({ error: 'Failed to send email. Documents were not recorded. Please try again.' });
  }

  const actorId = effectiveActorId(req);
  await recordOutboundSentEmail({
    fromUserId: actorId,
    sentByUserId: actorId !== user.sub ? user.sub : null,
    fromName: outboundFrom.name || senderName,
    fromEmail: outboundFrom.email || '',
    subject: sentSubject,
    body: sentBodyHtml,
    subCompanyId: proposal.lead.subCompanyId,
    to: [{
      name: contact.name,
      email: contact.email!,
      clientId: proposal.lead.clientId,
      contactId: contact.id,
    }],
    clientId: proposal.lead.clientId,
    leadId: proposal.leadId,
    source: 'proposal_send_to_client',
  });

  // Email sent successfully — create DB records
  const now = new Date();
  const createdDocs = await prisma.$transaction(
    uploadedFiles.map((f) =>
      prisma.proposalDocument.create({
        data: {
          proposalId: proposal.id,
          category: 'sent_to_client',
          name: f.name,
          size: BigInt(f.size),
          type: f.contentType,
          url: f.url,
          uploadedById: user.sub,
          contactId: contact.id,
          contactName: contact.name,
          contactEmail: contact.email!,
          sentAt: now,
          deliveryStatus: 'waiting_for_response',
        },
        include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
      })
    )
  );

  // Refresh proposals list for all agency managers (and the lead owner so the
  // associate's view also auto-updates when a manager sends on their behalf).
  const managers = await prisma.user.findMany({
    where: { subCompanyId: proposal.lead.subCompanyId, id: { in: await proposalReviewerIds(proposal.lead.subCompanyId) }, isActive: true },
    select: { id: true },
  });
  const refreshIds = new Set<string>(managers.map((m) => m.id));
  refreshIds.add(proposal.lead.ownerId);
  emitToUsers(Array.from(refreshIds), 'proposal:refresh', { subCompanyId: proposal.lead.subCompanyId });

  return res.status(201).json({
    documents: createdDocs.map((d) => ({ ...d, size: Number(d.size) })),
    emailSentTo: contact.email,
  });
});


export default router;
