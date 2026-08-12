/**
 * DEMO / Master preview only — tick every checkbox square in the local
 * onboarding PDF (drawn 12×12 boxes + ☐ glyphs).
 *
 * Only draws the checkmark inside existing boxes (no reflow / no resize).
 * Used when agreement is NOT signed yet; signed packages use real PandaDoc PDF.
 */
import { rgb, type PDFPage } from 'pdf-lib';

const CHECK = rgb(0.0235, 0.32, 0.55);

type CheckboxSlot = {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

const SLOTS_URL = '/demo/onboarding-checkbox-slots.json';
let slotsPromise: Promise<CheckboxSlot[]> | null = null;

function loadSlots(): Promise<CheckboxSlot[]> {
  if (!slotsPromise) {
    slotsPromise = fetch(SLOTS_URL)
      .then(async (r) => {
        if (!r.ok) throw new Error('Failed to load onboarding checkbox slots');
        return (await r.json()) as CheckboxSlot[];
      })
      .catch((err) => {
        slotsPromise = null;
        throw err;
      });
  }
  return slotsPromise;
}

function drawCheckmark(page: PDFPage, slot: CheckboxSlot) {
  const size = Math.min(slot.w, slot.h);
  const inset = size * 0.2;
  // slot.y is the bottom of the square in PDF space.
  page.drawLine({
    start: { x: slot.x + inset, y: slot.y + size * 0.45 },
    end: { x: slot.x + size * 0.42, y: slot.y + inset },
    thickness: 1.2,
    color: CHECK,
  });
  page.drawLine({
    start: { x: slot.x + size * 0.42, y: slot.y + inset },
    end: { x: slot.x + size - inset * 0.55, y: slot.y + size - inset },
    thickness: 1.2,
    color: CHECK,
  });
}

/** Tick all known template checkboxes (Master unsigned demo preview). */
export async function stampDemoCheckboxes(pages: PDFPage[]): Promise<void> {
  const slots = await loadSlots();
  for (const slot of slots) {
    if (slot.page < 0 || slot.page >= pages.length) continue;
    drawCheckmark(pages[slot.page], slot);
  }
}
