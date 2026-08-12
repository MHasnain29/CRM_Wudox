/**
 * DEMO: replace PDF "Selected Vacation Pay Option: [Candidate.VacationPayOption]"
 * with PandaDoc-style "Selected Option:" + two checkboxes.
 * Selected checkmark is stamped only for Master preview.
 */
import { rgb, type PDFFont, type PDFPage } from 'pdf-lib';

type VacationPayAnchorBox = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
};

const WHITE = rgb(1, 1, 1);
const BODY = rgb(0, 0, 0);
const HIGHLIGHT = rgb(0.0235, 0.32, 0.55);

/** Baked-in label left of the placeholder in the local template (page 8 / index 7). */
const LABEL_X = 72;
const LABEL_WIDTH = 172.72;

function parseSelected(value: string): 1 | 2 | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (v === '1' || v.startsWith('option 1')) return 1;
  if (v === '2' || v.startsWith('option 2')) return 2;
  return null;
}

function drawCheckbox(
  page: PDFPage,
  x: number,
  baselineY: number,
  fontSize: number,
  checked: boolean,
) {
  const size = Math.max(9, fontSize * 0.85);
  const boxY = baselineY - 1.5;
  page.drawRectangle({
    x,
    y: boxY,
    width: size,
    height: size,
    borderColor: BODY,
    borderWidth: 1,
    color: WHITE,
  });
  if (!checked) return;
  // Simple checkmark
  const inset = size * 0.2;
  page.drawLine({
    start: { x: x + inset, y: boxY + size * 0.45 },
    end: { x: x + size * 0.42, y: boxY + inset },
    thickness: 1.25,
    color: HIGHLIGHT,
  });
  page.drawLine({
    start: { x: x + size * 0.42, y: boxY + inset },
    end: { x: x + size - inset * 0.6, y: boxY + size - inset },
    thickness: 1.25,
    color: HIGHLIGHT,
  });
}

export function stampVacationPayOption(
  pages: PDFPage[],
  font: PDFFont,
  boxes: VacationPayAnchorBox[],
  vacationPayOption: string,
  opts: { showSelection: boolean },
) {
  if (!boxes.length) return;
  const selected = opts.showSelection ? parseSelected(vacationPayOption) : null;

  for (const box of boxes) {
    if (box.page < 0 || box.page >= pages.length) continue;
    const page = pages[box.page];
    const fontSize = box.fontSize || 12;
    const wipeX = Math.min(LABEL_X, box.x) - 1.5;
    const wipeRight = box.x + box.width + 1.5;
    const wipeY = box.y - fontSize * 0.28;
    const wipeH = Math.max(fontSize * 1.15, box.height + fontSize * 0.35);

    // Clear "Selected Vacation Pay Option:" + placeholder in one band.
    page.drawRectangle({
      x: wipeX,
      y: wipeY,
      width: Math.max(wipeRight - wipeX, LABEL_WIDTH + box.width),
      height: wipeH,
      color: WHITE,
    });

    const label = 'Selected Option:';
    page.drawText(label, {
      x: LABEL_X,
      y: box.y,
      size: fontSize,
      font,
      color: BODY,
    });

    let cursorX = LABEL_X + font.widthOfTextAtSize(label, fontSize) + 10;
    const boxSize = Math.max(9, fontSize * 0.85);

    drawCheckbox(page, cursorX, box.y, fontSize, selected === 1);
    cursorX += boxSize + 5;
    page.drawText('Option 1', {
      x: cursorX,
      y: box.y,
      size: fontSize,
      font,
      color: selected === 1 ? HIGHLIGHT : BODY,
    });
    cursorX += font.widthOfTextAtSize('Option 1', fontSize) + 16;

    drawCheckbox(page, cursorX, box.y, fontSize, selected === 2);
    cursorX += boxSize + 5;
    page.drawText('Option 2', {
      x: cursorX,
      y: box.y,
      size: fontSize,
      font,
      color: selected === 2 ? HIGHLIGHT : BODY,
    });
  }
}
