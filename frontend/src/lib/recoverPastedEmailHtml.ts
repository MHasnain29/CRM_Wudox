/**
 * Recover and detect email HTML so table layouts never go through contenteditable.
 */

export function isFullEmailHtml(html: string): boolean {
  const t = (html || '').trim();
  return /^<!doctype/i.test(t) || /^<html[\s>]/i.test(t);
}

/** True when this is real markup, including comment-prefixed table emails. */
export function looksLikeEmailMarkup(html: string): boolean {
  const t = (html || '').trim();
  if (!t) return false;
  if (isFullEmailHtml(t)) return true;
  if (/^<[a-z]/i.test(t)) return true;
  if (/^<!--/.test(t) && /<(?:table|div|p|h[1-6]|tr|td|span|a|img)\b/i.test(t)) return true;
  return false;
}

/**
 * Table / full-document emails must be previewed in an iframe and sent as-is.
 * Contenteditable strips <html>/<body>, drops comments, and unwraps tables.
 */
export function isStructuredEmailHtml(html: string): boolean {
  const t = (html || '').trim();
  if (!t) return false;
  if (isFullEmailHtml(t)) return true;
  if (/<!doctype|<html[\s>]/i.test(t)) return true;
  if (/<table\b/i.test(t)) return true;
  if (/^<!--/.test(t) && /<(?:table|div|td)\b/i.test(t)) return true;
  const styleCount = (t.match(/style\s*=/gi) || []).length;
  if (styleCount >= 5 && /<(?:div|td|table|span)\b/i.test(t)) return true;
  return false;
}

function unwrapParagraphWrappedMarkup(html: string): string {
  const t = html.trim();
  if (!/^<p[\s>]/i.test(t)) return html;
  if (!/<(?:!doctype|html|table|div)\b/i.test(t)) return html;

  const inner = t
    .replace(/^<p(?:\s[^>]*)?>/i, '')
    .replace(/<\/p>$/i, '')
    .replace(/<\/p>\s*<p(?:\s[^>]*)?>/gi, '\n');

  if (/<(?:!doctype|html[\s>]|table[\s>])/i.test(inner)) return inner;
  return html;
}

export function recoverPastedEmailHtml(html: string): string {
  if (!html) return html;

  let out = unwrapParagraphWrappedMarkup(html);

  if (/&lt;\s*(?:!doctype|html|head|body|table|div)\b/i.test(out)) {
    try {
      const doc = new DOMParser().parseFromString(out, 'text/html');
      const text = (doc.body?.textContent ?? out).trim();
      if (/<!doctype|<html[\s>]|<table[\s>]/i.test(text)) out = text;
    } catch {
      /* keep current */
    }
  }

  return out;
}

/** iframe srcdoc: wrap fragments so body/table backgrounds still paint. */
export function emailPreviewSrcDoc(html: string): string {
  const recovered = recoverPastedEmailHtml(html).trim();
  if (!recovered) return recovered;
  if (/<!doctype/i.test(recovered) || /<html[\s>]/i.test(recovered)) return recovered;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;">${recovered}</body></html>`;
}

/** List-row snippet: visible text only, never leftover CSS attributes. */
export function emailBodyPlainPreview(html: string, max = 120): string {
  const recovered = recoverPastedEmailHtml(html);
  if (!recovered.trim()) return '';
  try {
    const doc = new DOMParser().parseFromString(emailPreviewSrcDoc(recovered), 'text/html');
    const text = (doc.body?.innerText || doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, max) + (text.length > max ? '…' : '');
  } catch {
    /* fall through */
  }
  const stripped = recovered.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return stripped.slice(0, max) + (stripped.length > max ? '…' : '');
}
