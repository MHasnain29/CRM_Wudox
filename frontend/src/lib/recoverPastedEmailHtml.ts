/**
 * Recover email HTML that was pasted as visible source in a contenteditable
 * (browser stores it as &lt;table…&gt; instead of real markup).
 */
export function recoverPastedEmailHtml(html: string): string {
  if (!html || !/&lt;\s*(?:!doctype|html|head|body|table|div)\b/i.test(html)) {
    return html;
  }
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const text = (doc.body?.textContent ?? html).trim();
    if (/<!doctype|<html[\s>]|<table[\s>]/i.test(text)) return text;
  } catch {
    /* keep original */
  }
  return html;
}
