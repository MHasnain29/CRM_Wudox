import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { ProposalPrefill } from '../../pandadoc/pandadocService';
import type { AnchorMap, AnchorToken } from './types';

/**
 * StandardFonts (Helvetica etc.) use WinAnsi encoding and throw on characters
 * outside that set (e.g. ↔, smart quotes, ellipsis). Map common glyphs to ASCII
 * and drop anything else so PDF fill never fails on real CRM data.
 */
function toWinAnsiSafe(text: string): string {
  return text
    .replace(/\u2194/g, '<->')   // ↔
    .replace(/[\u2190\u2192]/g, '-') // ← →
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, '-') // en/em dash
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
}

function valueFor(token: AnchorToken, prefill: ProposalPrefill): string {
  let raw = '';
  switch (token) {
    case 'today':           raw = prefill.date.today; break;
    case 'agency_name':     raw = prefill.agency.name || ''; break;
    case 'client_name':     raw = prefill.client.name || ''; break;
    case 'client_industry': raw = prefill.client.industry || ''; break;
    case 'minimum_hours':   raw = prefill.proposal.minimumHours || ''; break;
    case 'payment_days':    raw = prefill.proposal.paymentDays || ''; break;
    case 'sender_name':       raw = prefill.sender.name || ''; break;
    case 'signing_authority': raw = prefill.signingAuthority?.name || ''; break;
    // Strip trailing % — template already has "% plus Hst" after placeholder.
    case 'bill_rate':         raw = (prefill.proposal.billingRate || '').replace(/%$/, ''); break;
  }
  return toWinAnsiSafe(raw);
}

function mapToStandardFont(fontName: string): StandardFonts {
  const n = (fontName || '').toLowerCase().replace(/[^a-z]/g, '');
  if (n.includes('times') || n.includes('roman') || n.includes('georgia') || n.includes('garamond')) {
    return StandardFonts.TimesRoman;
  }
  if (n.includes('courier') || n.includes('mono') || n.includes('consolas')) {
    return StandardFonts.Courier;
  }
  return StandardFonts.Helvetica;
}

const HIGHLIGHT        = rgb(0.0235, 0.32, 0.55);
const BODY_COLOR       = rgb(0, 0, 0);
const WHITE            = rgb(1, 1, 1);
const OVERFLOW_FACTOR      = 3;
const MIN_FONT_SIZE        = 5;
const DESCENT_FRACTION     = 0.28;
const ASCENT_OVERHANG      = 1.5;
// How many pixels a reflowed follower may extend past its natural right edge
// (li.x + li.width) or the next anchor boundary before we give up and drop it.
// This absorbs the font-metric gap between the original PDF font and Helvetica
// Bold used for the substituted value.
const REFLOW_TOLERANCE = 10;

export async function fillTemplateWithAnchors(
  templatePdfBuffer: Buffer,
  anchorMap: AnchorMap,
  prefill: ProposalPrefill,
): Promise<Buffer> {
  const doc      = await PDFDocument.load(templatePdfBuffer);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const regularH = await doc.embedFont(StandardFonts.Helvetica);
  const regularT = await doc.embedFont(StandardFonts.TimesRoman);
  const regularC = await doc.embedFont(StandardFonts.Courier);
  const pages    = doc.getPages();

  function regularFontFor(fontName: string) {
    const sf = mapToStandardFont(fontName);
    if (sf === StandardFonts.TimesRoman) return regularT;
    if (sf === StandardFonts.Courier)    return regularC;
    return regularH;
  }

  // Build a per-page list of all anchor boxes so reflow can stop before
  // the next anchor on the same line rather than pushing followers into it.
  type AnchorPoint = { x: number; y: number };
  const anchorsByPage = new Map<number, AnchorPoint[]>();
  for (const token of Object.keys(anchorMap) as AnchorToken[]) {
    for (const b of (anchorMap[token] ?? [])) {
      if (!anchorsByPage.has(b.page)) anchorsByPage.set(b.page, []);
      anchorsByPage.get(b.page)!.push({ x: b.x, y: b.y });
    }
  }

  // Returns the x of the nearest anchor that is to the right of afterX on the
  // same line (within 3px y-tolerance), or Infinity if there is none.
  function nextAnchorX(page: number, y: number, afterX: number): number {
    const pts = anchorsByPage.get(page) ?? [];
    let nearest = Infinity;
    for (const pt of pts) {
      if (Math.abs(pt.y - y) <= 3 && pt.x > afterX + 5 && pt.x < nearest) {
        nearest = pt.x;
      }
    }
    return nearest;
  }

  for (const token of Object.keys(anchorMap) as AnchorToken[]) {
    const boxes = anchorMap[token];
    if (!boxes?.length) continue;
    const value = valueFor(token, prefill).trim();
    if (!value) continue;

    for (const box of boxes) {
      if (box.page < 0 || box.page >= pages.length) continue;
      const page = pages[box.page];

      // 1 — choose the largest font size that fits within OVERFLOW_FACTOR × box.width.
      const maxWidth = box.width * OVERFLOW_FACTOR;
      let fontSize = box.fontSize || 11;
      while (fontSize > MIN_FONT_SIZE && boldFont.widthOfTextAtSize(value, fontSize) > maxWidth) {
        fontSize -= 0.5;
      }
      let rendered = value;
      if (boldFont.widthOfTextAtSize(rendered, fontSize) > maxWidth) {
        while (rendered.length > 1 && boldFont.widthOfTextAtSize(rendered + '...', fontSize) > maxWidth) {
          rendered = rendered.slice(0, -1);
        }
        rendered += '...';
      }

      const renderedWidth = boldFont.widthOfTextAtSize(rendered, fontSize);

      // 2 — white-out covers whichever is wider: placeholder or rendered value.
      const whiteoutWidth    = Math.max(box.width, renderedWidth);
      const mainWhiteoutRight = box.x + whiteoutWidth + 1;
      const descent           = box.fontSize * DESCENT_FRACTION;
      page.drawRectangle({
        x:      box.x - 1,
        y:      box.y - descent,
        width:  whiteoutWidth + 2,
        height: box.height + descent + ASCENT_OVERHANG,
        color:  WHITE,
      });

      // 3 — draw the substituted value in bold blue.
      page.drawText(rendered, {
        x:     box.x,
        y:     box.y,
        size:  fontSize,
        font:  boldFont,
        color: HIGHLIGHT,
      });

      // 4 — gap-close reflow for same-line followers.
      //
      // Boundary rule: never push followers past the start of the next anchor
      // on the same line — that anchor has its own whiteout and if we draw into
      // its territory the two whiteouts fight each other and produce garbling.
      const boundary = nextAnchorX(box.page, box.y, box.x);

      const sameLineItems = (box.lineItems ?? []).filter(
        li => li.text && li.width > 0
           && Math.abs(li.y - box.y) <= 2
           && li.x < boundary,  // exclude items already in the next anchor's column
      );

      if (sameLineItems.length) {
        // Erase any lineItem tail that hangs past the main whiteout but before
        // the boundary.  The main whiteout already covers li.x < mainWhiteoutRight,
        // but a long item can start inside it and end outside — that tail needs a
        // targeted erase so nothing bleeds through.
        for (const li of sameLineItems) {
          if (!li.text.trim()) continue;
          const liRight = li.x + li.width;
          if (liRight > mainWhiteoutRight) {
            const liDescent = li.fontSize * DESCENT_FRACTION;
            const eraseFrom = Math.max(li.x - 1, mainWhiteoutRight - 1);
            const eraseTo   = Math.min(liRight + 2, boundary);
            if (eraseTo > eraseFrom) {
              page.drawRectangle({
                x:      eraseFrom,
                y:      li.y - liDescent,
                width:  eraseTo - eraseFrom,
                height: li.fontSize + liDescent + ASCENT_OVERHANG,
                color:  WHITE,
              });
            }
          }
        }

        // Redraw followers at their new positions (pulled left when value is
        // shorter than placeholder, pushed right when wider).  Stop as soon as
        // an item won't fit before the next anchor boundary — it is better to
        // omit a follower than to push it into the adjacent anchor's area.
        const trailingSpace = boldFont.widthOfTextAtSize(' ', fontSize);
        let cursorX = box.x + renderedWidth + trailingSpace;

        for (const li of sameLineItems) {
          if (!li.text.trim()) { cursorX += li.width; continue; }

          const followerText = toWinAnsiSafe(li.text);
          if (!followerText.trim()) { cursorX += li.width; continue; }

          const liFont  = regularFontFor(li.fontName);
          const liWidth = liFont.widthOfTextAtSize(followerText, li.fontSize);

          // Stop if drawing at cursorX would push this item too far past either:
          //   (a) the next anchor's start (boundary), or
          //   (b) the item's natural right edge in the original PDF (li.x + li.width),
          //       which is where hardcoded non-anchor text immediately follows.
          // REFLOW_TOLERANCE absorbs the font-metric gap between the original PDF font
          // and Helvetica Bold — small overflows are cleaned up by the next anchor's
          // whiteout anyway.
          const tighterBound = Math.min(boundary, li.x + li.width);
          if (cursorX + liWidth > tighterBound + REFLOW_TOLERANCE) break;

          // Erase at the original position only if it is outside the main
          // whiteout (items inside it were already covered in step 2).
          if (li.x >= mainWhiteoutRight) {
            const liDescent = li.fontSize * DESCENT_FRACTION;
            page.drawRectangle({
              x:      li.x - 1,
              y:      li.y - liDescent,
              width:  li.width + 2,
              height: li.fontSize + liDescent + ASCENT_OVERHANG,
              color:  WHITE,
            });
          }

          page.drawText(followerText, {
            x:     cursorX,
            y:     li.y,
            size:  li.fontSize,
            font:  liFont,
            color: BODY_COLOR,
          });
          cursorX += liWidth + 1;
        }
      }
    }
  }

  return Buffer.from(await doc.save());
}
