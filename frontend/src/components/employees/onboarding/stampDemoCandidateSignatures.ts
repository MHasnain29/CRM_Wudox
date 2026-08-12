/**
 * DEMO only — draws a name-based cursive signature next to each
 * "Candidate Signature:" label in the local onboarding PDF.
 * Used when previewing Master employees (script/seed signed packages).
 */
import type { PDFDocument, PDFPage } from 'pdf-lib';

/** Known "Candidate Signature:" slots in candidate-onboarding-compliance-package.pdf */
const SIGNATURE_SLOTS: ReadonlyArray<{ page: number; labelX: number; labelY: number; labelW: number }> = [
  { page: 1, labelX: 72, labelY: 499.5, labelW: 120.7 },
  { page: 2, labelX: 28.5, labelY: 198.8, labelW: 120.7 },
  { page: 14, labelX: 72, labelY: 328.5, labelW: 120.7 },
  { page: 16, labelX: 72, labelY: 89.3, labelW: 120.7 },
  { page: 22, labelX: 72, labelY: 361.5, labelW: 120.7 },
];

const SIGNATURE_COLOR = '#0f2744';
const MAX_SIGNATURE_WIDTH = 200;
/** Keep short so it sits under Candidate Name without overlapping. */
const SIGNATURE_HEIGHT = 22;

function renderSignaturePng(fullName: string): Uint8Array | null {
  if (typeof document === 'undefined') return null;
  const name = fullName.trim();
  if (!name) return null;

  const canvas = document.createElement('canvas');
  const scale = 2;
  canvas.width = Math.round(MAX_SIGNATURE_WIDTH * scale);
  canvas.height = Math.round(SIGNATURE_HEIGHT * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, MAX_SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
  ctx.fillStyle = SIGNATURE_COLOR;
  ctx.textBaseline = 'alphabetic';
  // Prefer real script faces when present; italic serif otherwise.
  ctx.font =
    'italic 18px "Segoe Script", "Brush Script MT", "Apple Chancery", "Snell Roundhand", cursive';

  let fontSize = 18;
  while (fontSize > 12 && ctx.measureText(name).width > MAX_SIGNATURE_WIDTH - 4) {
    fontSize -= 1;
    ctx.font = `italic ${fontSize}px "Segoe Script", "Brush Script MT", "Apple Chancery", "Snell Roundhand", cursive`;
  }

  const baseline = SIGNATURE_HEIGHT - 5;
  ctx.fillText(name, 2, baseline);

  // Soft underline flourish under the name (signature line feel).
  const textW = Math.min(ctx.measureText(name).width + 6, MAX_SIGNATURE_WIDTH - 4);
  ctx.strokeStyle = SIGNATURE_COLOR;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(2, baseline + 2.5);
  ctx.quadraticCurveTo(textW * 0.45, baseline + 4.5, textW, baseline + 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const dataUrl = canvas.toDataURL('image/png');
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Stamp the employee full name as a demo signature beside each Candidate Signature label.
 */
export async function stampDemoCandidateSignatures(
  doc: PDFDocument,
  pages: PDFPage[],
  fullName: string,
): Promise<void> {
  const png = renderSignaturePng(fullName);
  if (!png) return;

  const image = await doc.embedPng(png);
  const drawW = Math.min(MAX_SIGNATURE_WIDTH, image.width / 2);
  const drawH = SIGNATURE_HEIGHT;

  for (const slot of SIGNATURE_SLOTS) {
    if (slot.page < 0 || slot.page >= pages.length) continue;
    const page = pages[slot.page];
    const x = slot.labelX + slot.labelW + 8;
    // Image draws from bottom-left; keep top below the Candidate Name line (~27pt above).
    const y = slot.labelY - 4;
    page.drawImage(image, {
      x,
      y,
      width: drawW,
      height: drawH,
    });
  }
}
