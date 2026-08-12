import { fillTemplateWithAnchors } from './anchors/fillTemplate';
import type { ProposalPrefill } from '../pandadoc/pandadocService';
import prisma from '../../config/database';
import { getFromR2 } from '../r2Storage';
import type { AnchorMap } from './anchors/types';

/**
 * Render a review PDF by overlaying real proposal values onto the director's
 * uploaded template. The original PDF is preserved exactly — only the
 * [placeholder] positions are white-outed and stamped with bold blue values.
 *
 * Returns null if no templateId is supplied or R2 fetch fails.
 * Returns the original PDF buffer unfilled if anchorMap is missing (old upload
 * or PDF had no recognized placeholders) — manager still sees the template.
 */
export async function renderReviewPdf(
  prefill: ProposalPrefill,
  options: { templateId?: string } = {},
): Promise<Buffer | null> {
  if (!options.templateId) return null;

  try {
    const template = await prisma.reviewTemplate.findUnique({
      where: { id: options.templateId },
      select: { fileKey: true, anchorMap: true },
    });
    if (!template?.fileKey) return null;

    const r2 = await getFromR2(template.fileKey);
    if (!r2?.body) return null;
    const buf = r2.body instanceof Buffer ? r2.body : Buffer.from(r2.body as Uint8Array);

    if (template.anchorMap && typeof template.anchorMap === 'object' && !Array.isArray(template.anchorMap)) {
      return await fillTemplateWithAnchors(buf, template.anchorMap as AnchorMap, prefill);
    }

    // anchorMap missing (old upload or no recognized placeholders) — return original unfilled
    return buf;
  } catch (err) {
    console.warn('[renderReviewPdf] overlay failed:', err);
    return null;
  }
}
