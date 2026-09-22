/**
 * Outlook / Gmail mobile often ignore CSS `background` on body/table/td
 * unless a matching `bgcolor` attribute is present.
 */
const OPEN_TAG = /<(body|table|td|th)(\s[^>]*)?>/gi;

function hexFromStyle(attrs: string): string | null {
  const m = attrs.match(/background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8})\b/i);
  return m ? m[1] : null;
}

function bgcolorFromAttrs(attrs: string): string | null {
  const fromAttr = attrs.match(/\bbgcolor\s*=\s*["']?(#[0-9a-fA-F]{3,8})/i);
  return fromAttr ? fromAttr[1] : hexFromStyle(attrs);
}

export function recoverOutboundEmailHtml(html: string): string {
  let out = (html || '').trim();
  if (!out) return html;

  if (/^<p[\s>]/i.test(out) && /<(?:!doctype|html|table|div)\b/i.test(out)) {
    const inner = out
      .replace(/^<p(?:\s[^>]*)?>/i, '')
      .replace(/<\/p>$/i, '')
      .replace(/<\/p>\s*<p(?:\s[^>]*)?>/gi, '\n');
    if (/<(?:!doctype|html[\s>]|table[\s>])/i.test(inner)) out = inner;
  }

  if (/&lt;\s*(?:!doctype|html|head|body|table|div)\b/i.test(out)) {
    out = out
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
  }

  return out;
}

export function ensureEmailDocument(html: string): string {
  const t = html.trim();
  if (!t) return t;
  if (/<!doctype/i.test(t) || /<html[\s>]/i.test(t)) return t;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="margin:0;padding:0;">${t}</body></html>`;
}

export function applyEmailClientBgcolor(html: string): string {
  if (!html) return html;

  let out = html.replace(OPEN_TAG, (full, tag: string, attrs = '') => {
    if (/\bbgcolor\s*=/i.test(attrs)) return full;
    const color = hexFromStyle(attrs);
    if (!color) return full;
    return `<${tag}${attrs} bgcolor="${color}">`;
  });

  // Copy a table's background onto its first layout <td> when that cell has none.
  // Needed for wrappers like <table style="background:#f4f6f8"><tr><td style="padding:…">.
  out = out.replace(
    /<table\b([^>]*)>(\s*(?:<!--[\s\S]*?-->\s*)*<tr\b[^>]*>\s*<td\b)([^>]*)>/gi,
    (full, tableAttrs: string, middle: string, tdAttrs: string) => {
      if (bgcolorFromAttrs(tdAttrs)) return full;
      const color = bgcolorFromAttrs(tableAttrs);
      if (!color) return full;
      return `<table${tableAttrs}>${middle}${tdAttrs} bgcolor="${color}">`;
    },
  );

  return out;
}

export function prepareOutboundEmailHtml(html: string): string {
  return applyEmailClientBgcolor(ensureEmailDocument(recoverOutboundEmailHtml(html)));
}


