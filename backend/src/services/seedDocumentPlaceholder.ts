/**
 * Placeholder PDF bytes for seed:// employee documents (no R2 object).
 * Lets demo/seed uploads open in the in-app preview modal.
 */

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Build a minimal one-page PDF showing the document label. */
export function buildSeedPlaceholderPdf(label: string): Buffer {
  const line1 = escapePdfText('Demo seed document');
  const line2 = escapePdfText((label || 'document').slice(0, 80));
  const stream = [
    'BT',
    '/F1 18 Tf',
    '72 720 Td',
    `(${line1}) Tj`,
    '0 -28 Td',
    '/F1 12 Tf',
    `(${line2}) Tj`,
    '0 -24 Td',
    '(Not stored in R2 — preview placeholder.) Tj',
    'ET',
  ].join('\n');

  const objects: string[] = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  objects.push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
  );
  objects.push(`4 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj\n`);
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

export function isSeedDocumentUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.startsWith('seed://');
}
