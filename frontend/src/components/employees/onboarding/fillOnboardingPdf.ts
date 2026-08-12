import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { EmployeeOnboardingPrefill } from './buildOnboardingPrefill';
import { stampDemoCandidateSignatures } from './stampDemoCandidateSignatures';
import { stampDemoCheckboxes } from './stampDemoCheckboxes';
import { stampVacationPayOption } from './stampVacationPayOption';

export type OnboardingAnchorToken =
  | 'agency_name'
  | 'agency_hr_contact'
  | 'agency_payroll_contact'
  | 'candidate_first_name'
  | 'candidate_last_name'
  | 'candidate_vacation_pay_option';

export type OnboardingAnchorLineItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
  fontSize: number;
};

export type OnboardingAnchorBox = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  originalText?: string;
  isInline?: boolean;
  lineItems?: OnboardingAnchorLineItem[];
};

export type OnboardingAnchorMap = Partial<Record<OnboardingAnchorToken, OnboardingAnchorBox[]>>;

const TEMPLATE_URL = '/demo/candidate-onboarding-compliance-package.pdf';
const ANCHOR_MAP_URL = '/demo/onboarding-anchor-map.json';

const HIGHLIGHT = rgb(0.0235, 0.32, 0.55);
const BODY_COLOR = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const MIN_FONT_SIZE = 5;
/**
 * White-out must fully cover placeholder glyphs (else black dots remain) but
 * stay under the previous line. Body leading is ~1.15× font size; leave
 * LINE_GAP_BOOST of that as clearance for previous-line descenders.
 */
const DESCENT_FRACTION = 0.26;
const LINE_GAP_BOOST = 0.05;
/** Horizontal pad so bracket edges of "[Agency Name]" don't leave flecks. */
const WIPE_X_PAD = 1.5;
/** Small pad so value never kisses the follower / page edge. */
const VALUE_PAD = 1;

/**
 * Erase band for one text run. Uses measured box height when provided so
 * capitals/brackets are fully covered; caps the top so the line above stays.
 */
function wipeBand(
  baselineY: number,
  fontSize: number,
  boxHeight?: number,
): { y: number; height: number } {
  const fs = Math.max(fontSize || 11, 1);
  const glyphH = Math.max(boxHeight || 0, fs);
  const descent = fs * DESCENT_FRACTION;
  // Previous line ≈ +1.15×fs. Reserve a thin band for its descenders, but
  // still cover full placeholder capitals/brackets (too-short wipe left dots).
  const maxTop = baselineY + fs * (1.15 - LINE_GAP_BOOST) - fs * 0.12;
  const idealTop = baselineY + glyphH;
  const top = Math.min(idealTop, maxTop);
  const y = baselineY - descent;
  return { y, height: Math.max(fs * 0.9, top - y) };
}

function toWinAnsiSafe(text: string): string {
  return text
    .replace(/\u2194/g, '<->')
    .replace(/[\u2190\u2192]/g, '-')
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
}

function valuesFor(prefill: EmployeeOnboardingPrefill): Record<OnboardingAnchorToken, string> {
  return {
    agency_name: prefill.agency.name,
    agency_hr_contact: prefill.agency.hrSupportContact,
    agency_payroll_contact: prefill.agency.payrollSupportContact,
    candidate_first_name: prefill.employee.firstName,
    candidate_last_name: prefill.employee.lastName,
    candidate_vacation_pay_option: prefill.employee.vacationPayOption,
  };
}

let templateBytesPromise: Promise<ArrayBuffer> | null = null;
let anchorMapPromise: Promise<OnboardingAnchorMap> | null = null;

function loadTemplate(): Promise<ArrayBuffer> {
  if (!templateBytesPromise) {
    templateBytesPromise = fetch(TEMPLATE_URL).then(async (r) => {
      if (!r.ok) throw new Error('Failed to load onboarding template PDF');
      return r.arrayBuffer();
    });
  }
  return templateBytesPromise;
}

function loadAnchorMap(): Promise<OnboardingAnchorMap> {
  if (!anchorMapPromise) {
    anchorMapPromise = fetch(ANCHOR_MAP_URL).then(async (r) => {
      if (!r.ok) throw new Error('Failed to load onboarding anchor map');
      return (await r.json()) as OnboardingAnchorMap;
    });
  }
  return anchorMapPromise;
}

function startsWithPunctuation(text: string): boolean {
  return /^[,.;:!?)\]}'"]/.test(text.trimStart());
}

function nextAnchorX(
  anchorsByPage: Map<number, { x: number; y: number }[]>,
  page: number,
  y: number,
  afterX: number,
): number {
  const pts = anchorsByPage.get(page) ?? [];
  let nearest = Infinity;
  for (const pt of pts) {
    if (Math.abs(pt.y - y) <= 3 && pt.x > afterX + 5 && pt.x < nearest) {
      nearest = pt.x;
    }
  }
  return nearest;
}

function sameLineFollowers(
  box: OnboardingAnchorBox,
  lineItems: OnboardingAnchorLineItem[] | undefined,
  boundary: number,
): OnboardingAnchorLineItem[] {
  return (lineItems ?? box.lineItems ?? []).filter(
    (li) =>
      li.text &&
      li.width > 0 &&
      Math.abs(li.y - box.y) <= 2 &&
      li.x < boundary &&
      // Never redraw another placeholder as follower text.
      !/^\[[^\]]+\]$/.test(li.text.trim()),
  );
}

function followerRunWidth(bodyFont: PDFFont, items: OnboardingAnchorLineItem[]): number {
  let w = 0;
  for (const li of items) {
    const text = toWinAnsiSafe(li.text);
    if (!text.trim()) continue;
    w += bodyFont.widthOfTextAtSize(text, li.fontSize) + 1;
  }
  return w;
}

/**
 * Fit value into the free line space so it never overlaps followers / next field.
 * Short values leave a tight join; long values shrink (then ellipsize) to fit.
 */
function fitRenderedValue(
  valueFont: PDFFont,
  value: string,
  baseFontSize: number,
  maxValueWidth: number,
): { rendered: string; fontSize: number; width: number } {
  let fontSize = baseFontSize || 11;
  let rendered = value;

  while (fontSize > MIN_FONT_SIZE && valueFont.widthOfTextAtSize(rendered, fontSize) > maxValueWidth) {
    fontSize -= 0.5;
  }
  if (valueFont.widthOfTextAtSize(rendered, fontSize) > maxValueWidth) {
    while (rendered.length > 1 && valueFont.widthOfTextAtSize(`${rendered}...`, fontSize) > maxValueWidth) {
      rendered = rendered.slice(0, -1);
    }
    rendered += '...';
  }

  return {
    rendered,
    fontSize,
    width: valueFont.widthOfTextAtSize(rendered, fontSize),
  };
}

function stampValue(
  pages: PDFPage[],
  valueFont: PDFFont,
  bodyFont: PDFFont,
  box: OnboardingAnchorBox,
  value: string,
  opts?: {
    whiteoutUntilX?: number;
    lineItems?: OnboardingAnchorLineItem[];
    nextAnchorX?: number;
  },
) {
  if (box.page < 0 || box.page >= pages.length) return;
  const page = pages[box.page];
  const spanRight = opts?.whiteoutUntilX ?? box.x + box.width;
  const spanWidth = Math.max(box.width, spanRight - box.x);
  const pageRight = page.getWidth() - 36;
  const boundary = Math.min(opts?.nextAnchorX ?? Infinity, pageRight);

  const followers = sameLineFollowers(box, opts?.lineItems, boundary);
  const gapProbe = startsWithPunctuation(followers[0]?.text ?? '')
    ? 0
    : bodyFont.widthOfTextAtSize(' ', box.fontSize || 11);
  const followersWidth = followerRunWidth(bodyFont, followers);
  // Free width on this line for the filled value — reserve follower text so
  // long agency/candidate strings shrink instead of drawing on top of it.
  const lineBudget = Math.max(spanWidth, boundary - box.x - VALUE_PAD);
  const maxValueWidth = Math.max(
    spanWidth * 0.35,
    lineBudget - followersWidth - gapProbe - VALUE_PAD,
  );

  const { rendered, fontSize, width: renderedWidth } = fitRenderedValue(
    valueFont,
    value,
    box.fontSize || 11,
    maxValueWidth,
  );

  // Always wipe the full placeholder width so leftover bracket/glyph flecks
  // don't show beside a shorter filled value.
  const whiteoutWidth = Math.max(spanWidth, renderedWidth);
  const wipe = wipeBand(box.y, box.fontSize || fontSize, box.height);

  page.drawRectangle({
    x: box.x - WIPE_X_PAD,
    y: wipe.y,
    width: whiteoutWidth + WIPE_X_PAD * 2,
    height: wipe.height,
    color: WHITE,
  });

  // Erase original follower glyphs in their own band (not one tall wide wipe).
  for (const li of followers) {
    if (!li.text.trim()) continue;
    const liWipe = wipeBand(li.y, li.fontSize || box.fontSize, li.height);
    const eraseFrom = Math.max(li.x - WIPE_X_PAD, box.x + whiteoutWidth - 0.5);
    const eraseTo = Math.min(li.x + li.width + WIPE_X_PAD, boundary);
    if (eraseTo > eraseFrom) {
      page.drawRectangle({
        x: eraseFrom,
        y: liWipe.y,
        width: eraseTo - eraseFrom,
        height: liWipe.height,
        color: WHITE,
      });
    }
  }

  page.drawText(rendered, {
    x: box.x,
    y: box.y,
    size: fontSize,
    font: valueFont,
    color: HIGHLIGHT,
  });

  if (!followers.length) return;

  const gapAfterValue = startsWithPunctuation(followers[0]?.text ?? '')
    ? 0
    : bodyFont.widthOfTextAtSize(' ', fontSize);
  let cursorX = box.x + renderedWidth + gapAfterValue;

  for (const li of followers) {
    const followerText = toWinAnsiSafe(li.text);
    if (!followerText.trim()) continue;
    const liWidth = bodyFont.widthOfTextAtSize(followerText, li.fontSize);
    // Value was sized to leave room; still guard the page/next-anchor edge.
    if (cursorX + liWidth > boundary + 0.5) break;
    page.drawText(followerText, {
      x: cursorX,
      y: li.y,
      size: li.fontSize,
      font: bodyFont,
      color: BODY_COLOR,
    });
    cursorX += liWidth + 1;
  }
}

/**
 * First+Last are separate placeholders with space between them for long tokens.
 * Pair same-line boxes and stamp "First Last" once so there’s no gap.
 */
function stampPairedCandidateNames(
  pages: PDFPage[],
  valueFont: PDFFont,
  bodyFont: PDFFont,
  firstBoxes: OnboardingAnchorBox[],
  lastBoxes: OnboardingAnchorBox[],
  fullName: string,
  anchorsByPage: Map<number, { x: number; y: number }[]>,
): Set<string> {
  const used = new Set<string>();
  const lastRemaining = [...lastBoxes];

  for (const first of firstBoxes) {
    const idx = lastRemaining.findIndex(
      (last) => last.page === first.page && Math.abs(last.y - first.y) <= 2 && last.x > first.x,
    );
    if (idx < 0) continue;
    const last = lastRemaining.splice(idx, 1)[0]!;
    const spanRight = last.x + last.width;
    stampValue(pages, valueFont, bodyFont, first, fullName, {
      whiteoutUntilX: spanRight,
      // Followers after the last-name placeholder; first's lineItems are the last-name token.
      lineItems: last.lineItems,
      nextAnchorX: nextAnchorX(anchorsByPage, first.page, first.y, first.x),
    });
    used.add(`first:${first.page}:${first.x}:${first.y}`);
    used.add(`last:${last.page}:${last.x}:${last.y}`);
  }
  return used;
}

function boxKey(kind: 'first' | 'last', box: OnboardingAnchorBox): string {
  return `${kind}:${box.page}:${box.x}:${box.y}`;
}

export type FillOnboardingPdfOptions = {
  /** Master-only demo: stamp a name-based signature beside Candidate Signature labels. */
  includeDemoSignature?: boolean;
};

/**
 * DEMO: fill the local compliance PDF the same way review templates are filled
 * (white-out placeholders + stamp values + gap-close reflow). No PandaDoc.
 */
export async function fillOnboardingPdf(
  prefill: EmployeeOnboardingPrefill,
  options?: FillOnboardingPdfOptions,
): Promise<Blob> {
  const [templateBuf, anchorMap] = await Promise.all([loadTemplate(), loadAnchorMap()]);
  const doc = await PDFDocument.load(templateBuf.slice(0));
  // Regular Helvetica (not bold) so filled values match body weight; blue only.
  const valueFont = await doc.embedFont(StandardFonts.Helvetica);
  const bodyFont = valueFont;
  const pages = doc.getPages();
  const values = valuesFor(prefill);

  const anchorsByPage = new Map<number, { x: number; y: number }[]>();
  for (const token of Object.keys(anchorMap) as OnboardingAnchorToken[]) {
    for (const b of anchorMap[token] ?? []) {
      if (!anchorsByPage.has(b.page)) anchorsByPage.set(b.page, []);
      anchorsByPage.get(b.page)!.push({ x: b.x, y: b.y });
    }
  }

  const fullName = toWinAnsiSafe(
    [prefill.employee.firstName, prefill.employee.lastName].filter(Boolean).join(' '),
  ).trim();
  const pairedUsed = fullName
    ? stampPairedCandidateNames(
        pages,
        valueFont,
        bodyFont,
        anchorMap.candidate_first_name ?? [],
        anchorMap.candidate_last_name ?? [],
        fullName,
        anchorsByPage,
      )
    : new Set<string>();

  for (const token of Object.keys(values) as OnboardingAnchorToken[]) {
    if (token === 'candidate_vacation_pay_option') {
      // PandaDoc-style checkboxes; selection checkmark only on Master preview.
      stampVacationPayOption(
        pages,
        bodyFont,
        anchorMap.candidate_vacation_pay_option ?? [],
        values.candidate_vacation_pay_option,
        { showSelection: Boolean(options?.includeDemoSignature) },
      );
      continue;
    }

    if (token === 'candidate_first_name' || token === 'candidate_last_name') {
      const boxes = anchorMap[token] ?? [];
      const raw = toWinAnsiSafe(values[token] ?? '').trim();
      if (!raw) continue;
      const kind = token === 'candidate_first_name' ? 'first' : 'last';
      for (const box of boxes) {
        if (pairedUsed.has(boxKey(kind, box))) continue;
        stampValue(pages, valueFont, bodyFont, box, raw, {
          nextAnchorX: nextAnchorX(anchorsByPage, box.page, box.y, box.x),
        });
      }
      continue;
    }

    const boxes = anchorMap[token];
    const raw = toWinAnsiSafe(values[token] ?? '').trim();
    if (!boxes?.length || !raw) continue;
    for (const box of boxes) {
      stampValue(pages, valueFont, bodyFont, box, raw, {
        nextAnchorX: nextAnchorX(anchorsByPage, box.page, box.y, box.x),
      });
    }
  }

  if (options?.includeDemoSignature) {
    // Master unsigned demo only — signed agreements use real PandaDoc PDF.
    // Tick every template checkbox in-place (checkmark only, no reflow).
    await stampDemoCheckboxes(pages);
    if (fullName) {
      await stampDemoCandidateSignatures(doc, pages, fullName);
    }
  }

  const bytes = await doc.save();
  // Copy into a fresh ArrayBuffer — pdf-lib may return a view over a larger buffer.
  const copy = new Uint8Array(bytes);
  return new Blob([copy], { type: 'application/pdf' });
}
