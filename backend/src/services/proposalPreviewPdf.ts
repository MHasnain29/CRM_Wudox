import PDFDocument from 'pdfkit';
import type { ProposalPrefill } from './pandadoc/pandadocService';

export async function generateProposalPreviewPdf(prefill: ProposalPrefill): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PRIMARY = '#1e3a8a';
    const GRAY = '#64748b';
    const LIGHT = '#f1f5f9';
    const BLACK = '#1e293b';
    const pageW = doc.page.width - 100; // usable width

    // ── Header ────────────────────────────────────────────────────────────────
    doc.rect(50, 40, pageW, 70).fill(PRIMARY);
    doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold')
      .text(prefill.agency.name || 'Staffing Agency', 70, 58, { width: pageW - 40 });
    doc.fontSize(10).font('Helvetica')
      .text('Agreement Preview — For Review Only', 70, 82, { width: pageW - 40 });

    doc.moveDown(3.5);

    // ── Title ─────────────────────────────────────────────────────────────────
    doc.fillColor(PRIMARY).fontSize(15).font('Helvetica-Bold')
      .text(`Proposed Agreement for ${prefill.client.name}`, 50, doc.y, { width: pageW });
    doc.moveDown(0.3);
    doc.fillColor(GRAY).fontSize(9).font('Helvetica')
      .text(`Prepared on: ${prefill.date.today}`, 50, doc.y);
    doc.moveDown(1.2);

    // helper to draw a section
    function section(title: string, rows: [string, string][]) {
      const startY = doc.y;
      doc.rect(50, startY, pageW, 22).fill(LIGHT);
      doc.fillColor(PRIMARY).fontSize(10).font('Helvetica-Bold')
        .text(title, 58, startY + 6, { width: pageW - 16 });
      doc.moveDown(0.1);

      let rowY = startY + 26;
      for (const [label, value] of rows) {
        if (!value) continue;
        doc.fillColor(GRAY).fontSize(9).font('Helvetica')
          .text(label, 58, rowY, { width: 150, continued: false });
        doc.fillColor(BLACK).fontSize(9).font('Helvetica')
          .text(value || '—', 215, rowY, { width: pageW - 165 });
        rowY += 16;
      }
      doc.y = rowY + 8;
      doc.moveDown(0.5);
    }

    // ── Client Info ───────────────────────────────────────────────────────────
    section('Client Information', [
      ['Company Name', prefill.client.name],
      ['Industry', prefill.client.industry],
      ['Location', prefill.client.location],
      ['Address', prefill.client.address],
      ['Company Size', prefill.client.companySize],
    ]);

    // ── Contact ───────────────────────────────────────────────────────────────
    section('Contact Person', [
      ['Name', prefill.contact?.name ?? ''],
      ['Title / Designation', prefill.contact?.title ?? ''],
      ['Email', prefill.contact?.email ?? ''],
      ['Phone', prefill.contact?.phone ?? ''],
    ]);

    // ── Agreement Terms ───────────────────────────────────────────────────────
    section('Agreement Terms', [
      ['Agreement Type', prefill.proposal.agreementTypeLabel],
      ['Billing Rate / Markup', prefill.proposal.billingRate],
      ['Payment Terms', prefill.proposal.paymentTermsLabel],
      ['Minimum Hours', prefill.proposal.minimumHours],
    ]);

    // ── Representative ────────────────────────────────────────────────────────
    section('Your Representative', [
      ['Name', prefill.sender.name],
      ['Email', prefill.sender.email],
      ['Phone', prefill.sender.phone],
    ]);

    // ── Disclaimer ────────────────────────────────────────────────────────────
    doc.moveDown(1);
    doc.rect(50, doc.y, pageW, 50).fill('#fefce8');
    const disclaimerY = doc.y + 8;
    doc.fillColor('#92400e').fontSize(8.5).font('Helvetica-Bold')
      .text('For Review Purposes Only', 60, disclaimerY, { width: pageW - 20 });
    doc.fillColor('#78350f').font('Helvetica')
      .text(
        'This document is a preview shared for your review. No action or signature is required at this stage. '
        + 'If you wish to proceed, please contact your representative directly.',
        60, disclaimerY + 13, { width: pageW - 20 }
      );

    // ── Footer ────────────────────────────────────────────────────────────────
    const footerY = doc.page.height - 40;
    doc.rect(50, footerY - 8, pageW, 1).fill('#e2e8f0');
    doc.fillColor(GRAY).fontSize(8).font('Helvetica')
      .text(
        `${prefill.agency.name}  ·  Generated ${prefill.date.today}  ·  Confidential`,
        50, footerY, { width: pageW, align: 'center' }
      );

    doc.end();
  });
}
