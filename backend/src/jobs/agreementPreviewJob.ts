/**
 * Background agreement preview generator.
 *
 * When an associate submits a proposal for review, scheduleAgreementPreview()
 * is called (fire-and-forget). It creates a PandaDoc draft, waits for it to
 * process, downloads the PDF, uploads to R2, and saves the result on the
 * proposal so the manager gets instant load on the next preview click.
 *
 * The proposal is stamped with a hash of all preview-affecting fields.
 * If nothing changed, subsequent calls are no-ops.
 */

import crypto from 'crypto';
import prisma from '../config/database';
import { pandaDocService, matchProposalToken, type ProposalPrefill } from '../services/pandadoc';
import { uploadToR2 } from '../services/r2Storage';

const R2_PREFIX = 'pandadoc/preview';

// ─── Hash ─────────────────────────────────────────────────────────────────────

export function computePreviewHash(p: {
  pandaDocTemplateId: string | null;
  selectedContactId: string | null;
  agreementTypes: string[];
  paymentTerms: string;
  tempPricingType: string | null;
  tempPricingValue: unknown;
  tempMinimumHours: number | null;
  directPricingType: string | null;
  directPricingValue: unknown;
}): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD — invalidate daily
  const raw = [
    p.pandaDocTemplateId ?? '',
    p.selectedContactId ?? '',
    [...p.agreementTypes].sort().join(','),
    p.paymentTerms,
    p.tempPricingType ?? '',
    String(p.tempPricingValue ?? ''),
    String(p.tempMinimumHours ?? ''),
    p.directPricingType ?? '',
    String(p.directPricingValue ?? ''),
    date,
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

// ─── Core generation ──────────────────────────────────────────────────────────

async function generateAndCache(proposalId: string): Promise<void> {
  // Fetch full proposal data
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: {
      id: true,
      pandaDocTemplateId: true,
      selectedContactId: true,
      agreementTypes: true,
      paymentTerms: true,
      tempPricingType: true,
      tempPricingValue: true,
      tempMinimumHours: true,
      directPricingType: true,
      directPricingValue: true,
      previewPdfHash: true,
      previewPdfStatus: true,
      lead: {
        select: {
          value: true,
          stage: true,
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

  if (!proposal || !proposal.pandaDocTemplateId) return;
  if (!pandaDocService.isAvailable()) return;

  const hash = computePreviewHash(proposal as Parameters<typeof computePreviewHash>[0]);

  // Skip if already cached with the same hash
  if (proposal.previewPdfHash === hash && proposal.previewPdfStatus === 'ready') {
    return;
  }

  // Mark as generating
  await prisma.proposal.update({
    where: { id: proposalId },
    data: { previewPdfStatus: 'generating', previewPdfHash: hash },
  });

  try {
    // Get template details (in-memory cached for 5 min)
    const templates = await pandaDocService.listAllTemplatesWithDetails();
    const template = templates.find((t) => t.id === proposal.pandaDocTemplateId);
    if (!template) {
      await prisma.proposal.update({ where: { id: proposalId }, data: { previewPdfStatus: 'failed' } });
      return;
    }

    const { lead } = proposal;
    const { client, owner, subCompany } = lead;

    const selectedContact = proposal.selectedContactId
      ? client.contacts.find((c) => c.id === proposal.selectedContactId)
      : client.contacts.find((c) => c.isPrimary && c.email) ?? client.contacts.find((c) => c.email);

    const contactNameParts = (selectedContact?.name ?? '').trim().split(/\s+/);
    const now = new Date();

    // Derived values
    const paymentDaysMatch = (proposal.paymentTerms as string).match(/\d+/);
    const paymentDays = paymentDaysMatch ? paymentDaysMatch[0] : '';
    const paymentTermsLabel = (proposal.paymentTerms as string).replace('net_', 'Net ');
    const minimumHours = proposal.tempMinimumHours != null ? String(proposal.tempMinimumHours) : '';

    let billingRate = '';
    if (proposal.agreementTypes.includes('temp') && proposal.tempPricingValue != null) {
      const v = Number(proposal.tempPricingValue);
      billingRate = proposal.tempPricingType === 'markup' ? `${v}%` : `$${v}/hr`;
    } else if (proposal.directPricingValue != null) {
      const v = Number(proposal.directPricingValue);
      billingRate = (proposal.directPricingType === 'markup' || proposal.directPricingType === 'percentage') ? `${v}%` : `$${v}`;
    }

    const agreementTypeLabel = proposal.agreementTypes
      .map((t: string) => t === 'temp' ? 'Temp / Temp to Permanent' : 'Direct Placement')
      .join(', ');

    const prefill: ProposalPrefill = {
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
    };

    const tokensToSend = template.tokens
      .map((t) => ({ name: t.name, value: matchProposalToken(t.name, prefill) }))
      .filter((t) => t.value.trim());

    const recipientRole = template.roles[0]?.name ?? 'Signer';
    const doc = await pandaDocService.createFromTemplate({
      templateId: proposal.pandaDocTemplateId!,
      name: `Preview Draft — ${template.name}`,
      recipients: [{
        email: owner.email ?? 'preview@staffing.app',
        first_name: owner.firstName ?? 'Preview',
        last_name: owner.lastName ?? 'Draft',
        role: recipientRole,
      }],
      tokens: tokensToSend,
    });

    // Poll until document.draft (max 30s)
    for (let i = 0; i < 15; i++) {
      await new Promise<void>((r) => setTimeout(r, 2000));
      try {
        const detail = await pandaDocService.getDocument(doc.id);
        if (detail.status === 'document.draft') break;
        if (!['document.uploaded', 'document.draft'].includes(detail.status)) break;
      } catch { /* keep polling */ }
    }

    // Download PDF
    const pdfBuffer = await pandaDocService.downloadPdf(doc.id);

    // Void the draft — fire-and-forget
    pandaDocService.voidDocument(doc.id).catch((e) =>
      console.warn('[agreementPreview] Could not void preview draft', doc.id, e)
    );

    // Upload to R2
    const r2Key = `${R2_PREFIX}/${proposalId}.pdf`;
    await uploadToR2(r2Key, pdfBuffer, 'application/pdf');

    // Save result
    await prisma.proposal.update({
      where: { id: proposalId },
      data: { previewPdfUrl: r2Key, previewPdfHash: hash, previewPdfStatus: 'ready' },
    });

    console.log(`[agreementPreview] Cached preview for proposal ${proposalId}`);
  } catch (err) {
    console.warn(`[agreementPreview] Failed to generate preview for proposal ${proposalId}:`, err);
    await prisma.proposal.update({
      where: { id: proposalId },
      data: { previewPdfStatus: 'failed' },
    }).catch(() => {});
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fire-and-forget: schedule background preview generation for a proposal.
 * Safe to call multiple times — skips if hash hasn't changed and status is ready.
 */
export function scheduleAgreementPreview(proposalId: string): void {
  void generateAndCache(proposalId);
}
