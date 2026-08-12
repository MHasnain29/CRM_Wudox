import { PLACEHOLDER_PATTERN, classifyPlaceholder } from './patterns';
import type { AnchorBox, AnchorExtractionResult, AnchorLineItem, AnchorMap, AnchorToken } from './types';

// pdfjs-dist is loaded lazily so it doesn't bloat cold-start for the rest of
// the app. The legacy build is the only one that works in Node without DOM
// polyfills.

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName?: string;
}

interface FlattenedItem {
  page: number;
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
}

interface FlattenedPage {
  text: string;
  items: FlattenedItem[];
}

async function loadPdfjs(): Promise<any> {
  return await import('pdfjs-dist/legacy/build/pdf.mjs');
}

async function flattenPdf(buffer: Buffer): Promise<FlattenedPage[]> {
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;
  const pages: FlattenedPage[] = [];

  for (let p = 0; p < doc.numPages; p++) {
    const page = await doc.getPage(p + 1);
    const content = await page.getTextContent();
    let text = '';
    const items: FlattenedItem[] = [];

    for (const raw of content.items as PdfTextItem[]) {
      if (typeof raw.str !== 'string') continue;
      if (text.length && !/\s$/.test(text) && !/^\s/.test(raw.str)) text += ' ';
      const itemStart = text.length;
      text += raw.str;
      items.push({
        page: p,
        start: itemStart,
        end: text.length,
        x: raw.transform[4] ?? 0,
        y: raw.transform[5] ?? 0,
        width: raw.width ?? 0,
        height: raw.height ?? 0,
        fontSize: raw.transform[0] ?? 11,
        fontName: raw.fontName ?? '',
      });
    }
    pages.push({ text, items });
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}

// pdfjs sometimes groups long runs of glyphs into a single text item. We
// linearly interpolate within each item to compute the sub-x range that
// corresponds to [matchStart, matchEnd) — keeps the white-out box faithful to
// the captured placeholder rather than spanning a whole item.
function boxForRange(
  page: FlattenedPage,
  matchStart: number,
  matchEnd: number,
  pageIndex: number,
): AnchorBox | null {
  const hits = page.items.filter((it) => it.end > matchStart && it.start < matchEnd);
  if (!hits.length) return null;

  let minX = Infinity;
  let maxRight = -Infinity;
  let minY = Infinity;
  let maxTop = -Infinity;
  let fontSize = 11;
  let originalText = '';

  for (const h of hits) {
    const itemLen = h.end - h.start;
    if (itemLen <= 0) continue;

    const offsetStart = Math.max(0, matchStart - h.start);
    const offsetEnd = Math.min(itemLen, matchEnd - h.start);
    if (offsetEnd <= offsetStart) continue;

    const avgCharWidth = h.width / itemLen;
    const subX = h.x + offsetStart * avgCharWidth;
    const subRight = h.x + offsetEnd * avgCharWidth;

    minX = Math.min(minX, subX);
    maxRight = Math.max(maxRight, subRight);
    minY = Math.min(minY, h.y);
    maxTop = Math.max(maxTop, h.y + h.height);
    fontSize = h.fontSize || fontSize;
    originalText += page.text.slice(Math.max(matchStart, h.start), Math.min(matchEnd, h.end));
  }

  if (!isFinite(minX) || !isFinite(maxRight)) return null;

  // Guard: if hits span more than one visual line the placeholder wraps across
  // a line-break — the resulting box would be incoherent and produce a bad
  // white-out. Skip this occurrence so the original text shows untouched.
  const ySpread = Math.max(...hits.map((h) => h.y)) - Math.min(...hits.map((h) => h.y));
  if (ySpread > fontSize * 0.6) return null;

  return {
    page: pageIndex,
    x: minX,
    y: minY,
    width: Math.max(1, maxRight - minX),
    height: Math.max(1, maxTop - minY),
    fontSize,
    originalText: originalText || page.text.slice(matchStart, matchEnd),
  };
}

export async function extractAnchors(buffer: Buffer): Promise<AnchorExtractionResult> {
  const map: AnchorMap = {};

  let pages: FlattenedPage[];
  try {
    pages = await flattenPdf(buffer);
  } catch (err) {
    console.warn('[anchor-extract] pdfjs flatten failed:', err);
    return { map: {}, detected: [], missed: [], totalOccurrences: 0 };
  }

  // Track every bracketed placeholder we find, and the count we managed to
  // classify into a known semantic token. Anything we couldn't classify is
  // surfaced in the log so the operator knows what was ignored.
  const unclassified: string[] = [];
  let totalPlaceholders = 0;

  for (let p = 0; p < pages.length; p++) {
    PLACEHOLDER_PATTERN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PLACEHOLDER_PATTERN.exec(pages[p].text)) !== null) {
      totalPlaceholders++;
      const inner = (m[1] ?? '').trim();
      const matchStart = m.index;
      const matchEnd = matchStart + m[0].length;

      const token = classifyPlaceholder(inner);
      if (!token) {
        unclassified.push(inner);
        if (m.index === PLACEHOLDER_PATTERN.lastIndex) PLACEHOLDER_PATTERN.lastIndex++;
        continue;
      }

      const box = boxForRange(pages[p], matchStart, matchEnd, p);
      if (box) {
        // Collect ALL text items (or partial items) on the same baseline that
        // come AFTER the placeholder in the text stream. Using matchEnd (text-
        // stream position) handles the common case where pdfjs groups the
        // placeholder and surrounding sentence into one item — we slice only
        // the post-placeholder portion via linear interpolation.
        const lineItems: AnchorLineItem[] = [];

        const boxRight = box.x + box.width;

        for (const it of pages[p].items) {
          if (it.end <= matchEnd) continue;           // before/within placeholder
          if (it.width <= 0) continue;
          if (Math.abs(it.y - box.y) > box.height * 1.5) continue; // different line

          const itemLen = Math.max(1, it.end - it.start);
          const avgCharWidth = it.width / itemLen;
          const textStart = Math.max(it.start, matchEnd);
          const text = pages[p].text.slice(textStart, it.end);
          if (!text.trim()) continue;

          const offsetInItem = textStart - it.start;
          const x = it.x + offsetInItem * avgCharWidth;

          // For items that begin AFTER the placeholder in the text stream (separate
          // pdfjs items, not a partial overlap), require the item to start within
          // 30pt of the placeholder right edge. Items further away are in a
          // different column or section (e.g. the right-side "Date:" opposite the
          // left-side "[Date]" in a two-column signature block).
          if (it.start >= matchEnd && x > boxRight + 30) continue;

          lineItems.push({
            text,
            x,
            y: it.y,
            width: Math.max((it.end - textStart) * avgCharWidth, 1),
            height: it.height || box.height,
            fontName: it.fontName,
            fontSize: it.fontSize || box.fontSize,
          });
        }

        lineItems.sort((a, b) => a.x - b.x);
        box.isInline = lineItems.length > 0;
        if (lineItems.length > 0) box.lineItems = lineItems;

        (map[token] ??= []).push(box);
      }
      if (m.index === PLACEHOLDER_PATTERN.lastIndex) PLACEHOLDER_PATTERN.lastIndex++;
    }
  }

  const detected = Object.keys(map) as AnchorToken[];
  const allTokens: AnchorToken[] = ['today', 'agency_name', 'client_name', 'client_industry', 'minimum_hours', 'bill_rate', 'payment_days', 'sender_name', 'signing_authority'];
  const missed = allTokens.filter((t) => !detected.includes(t));
  console.log(`[anchor-extract] ✅ detected: [${detected.join(', ')}] | missed: [${missed.join(', ')}] | total occurrences: ${Object.values(map).reduce((s, a) => s + (a?.length ?? 0), 0)}`);
  const totalOccurrences = detected.reduce((sum, t) => sum + (map[t]?.length ?? 0), 0);

  if (unclassified.length > 0) {
    console.log(`[anchor-extract] ${unclassified.length} placeholders not classified:`, [...new Set(unclassified)]);
  }
  if (totalPlaceholders === 0) {
    pages.forEach((page, idx) => {
      const sample = page.text.slice(0, 400).replace(/\s+/g, ' ');
      console.warn(`[anchor-extract] page ${idx + 1} sample (first 400 chars): ${sample}`);
    });
  }

  return { map, detected, missed, totalOccurrences };
}
