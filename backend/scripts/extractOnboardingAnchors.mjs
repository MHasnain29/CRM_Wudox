/**
 * One-off: rebuild frontend/public/demo/onboarding-anchor-map.json
 * with same-line lineItems so fill can close gaps after short values.
 *
 * Usage (from backend/): node scripts/extractOnboardingAnchors.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const pdfPath = path.join(root, 'frontend/public/demo/candidate-onboarding-compliance-package.pdf');
const outPath = path.join(root, 'frontend/public/demo/onboarding-anchor-map.json');

const PLACEHOLDER_PATTERN = /\[([^\]\n]+)\]/g;

function classify(inner) {
  const t = inner.trim();
  const lower = t.toLowerCase();
  if (lower === 'agency name') return 'agency_name';
  if (/^agency\.hrsupportcontact$/i.test(t) || /hr\s*support/.test(lower)) return 'agency_hr_contact';
  if (/^agency\.payrollsupportcontact$/i.test(t) || /payroll\s*support/.test(lower)) {
    return 'agency_payroll_contact';
  }
  if (/^candidate\.firstname$/i.test(t)) return 'candidate_first_name';
  if (/^candidate\.lastname$/i.test(t)) return 'candidate_last_name';
  if (/^candidate\.vacationpayoption$/i.test(t) || /vacation/.test(lower)) {
    return 'candidate_vacation_pay_option';
  }
  return null;
}

async function flattenPdf(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;
  const pages = [];

  for (let p = 0; p < doc.numPages; p++) {
    const page = await doc.getPage(p + 1);
    const content = await page.getTextContent();
    let text = '';
    const items = [];

    for (const raw of content.items) {
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

function boxForRange(page, matchStart, matchEnd, pageIndex) {
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

  if (!Number.isFinite(minX) || !Number.isFinite(maxRight)) return null;
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

const buffer = fs.readFileSync(pdfPath);
const pages = await flattenPdf(buffer);
const map = {};
const unclassified = new Set();

for (let p = 0; p < pages.length; p++) {
  PLACEHOLDER_PATTERN.lastIndex = 0;
  let m;
  while ((m = PLACEHOLDER_PATTERN.exec(pages[p].text)) !== null) {
    const inner = (m[1] ?? '').trim();
    const matchStart = m.index;
    const matchEnd = matchStart + m[0].length;
    const token = classify(inner);
    if (!token) {
      unclassified.add(inner);
      if (m.index === PLACEHOLDER_PATTERN.lastIndex) PLACEHOLDER_PATTERN.lastIndex++;
      continue;
    }
    const box = boxForRange(pages[p], matchStart, matchEnd, p);
    if (!box) {
      if (m.index === PLACEHOLDER_PATTERN.lastIndex) PLACEHOLDER_PATTERN.lastIndex++;
      continue;
    }

    const lineItems = [];
    const boxRight = box.x + box.width;
    for (const it of pages[p].items) {
      if (it.end <= matchEnd) continue;
      if (it.width <= 0) continue;
      // Same baseline only — next-line text must not become a reflow follower.
      if (Math.abs(it.y - box.y) > 2) continue;

      const itemLen = Math.max(1, it.end - it.start);
      const avgCharWidth = it.width / itemLen;
      const textStart = Math.max(it.start, matchEnd);
      const text = pages[p].text.slice(textStart, it.end);
      if (!text.trim()) continue;

      const offsetInItem = textStart - it.start;
      const x = it.x + offsetInItem * avgCharWidth;
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
    if (lineItems.length) {
      box.isInline = true;
      box.lineItems = lineItems;
    }
    (map[token] ??= []).push(box);
    if (m.index === PLACEHOLDER_PATTERN.lastIndex) PLACEHOLDER_PATTERN.lastIndex++;
  }
}

fs.writeFileSync(outPath, JSON.stringify(map));
const counts = Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v.length]));
const withLine = Object.values(map).flat().filter((b) => b.lineItems?.length).length;
console.log('Wrote', outPath);
console.log('counts', counts);
console.log('boxes with lineItems', withLine);
if (unclassified.size) console.log('unclassified', [...unclassified]);
