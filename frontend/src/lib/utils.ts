import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const MODAL_OUTSIDE_IGNORE_SELECTORS = "[data-sonner-toaster], [data-snip-ignore]";

type RadixOutsideEvent = {
  target: EventTarget | null;
  detail?: { originalEvent?: { target: EventTarget | null } };
};

/** Radix outside-dismiss events are CustomEvents; the clicked element is on detail.originalEvent. */
export function getRadixOutsideEventTarget(event: RadixOutsideEvent): EventTarget | null {
  return event.detail?.originalEvent?.target ?? event.target;
}

/** Prevent Radix dialogs/sheets from closing when interacting with global overlays (toasts, snip tool). */
export function shouldIgnoreModalOutsideInteraction(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el?.closest?.(MODAL_OUTSIDE_IGNORE_SELECTORS));
}

export function isSnipSessionActive(): boolean {
  return document.body.hasAttribute("data-snip-active");
}

/** Returns true when a Radix modal/sheet should stay open for this outside interaction. */
export function shouldPreventModalOutsideDismiss(event: RadixOutsideEvent, snipIgnore?: boolean): boolean {
  if (shouldIgnoreModalOutsideInteraction(getRadixOutsideEventTarget(event))) return true;
  if (isSnipSessionActive() && !snipIgnore) return true;
  return false;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

export function getLighterColor(hex: string, amount: number = 0.9): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  const lighten = (value: number) => Math.round(value + (255 - value) * amount);
  const r = lighten(rgb.r);
  const g = lighten(rgb.g);
  const b = lighten(rgb.b);

  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Repair stored email bodies that were generated before the rich-text fix:
 * the original bug double-escaped `clientMessage` HTML inside a wrapper
 * `<p style="...white-space:pre-wrap">&lt;p&gt;...&lt;/p&gt;</p>`. This unwraps
 * that wrapper and decodes the inner entities so the saved copy renders cleanly
 * in the in-app Emails viewer. No-op for bodies that don't match the pattern.
 */
export function repairLegacyEmailBody(html: string | null | undefined): string {
  if (!html) return '';
  const decode = (s: string) =>
    s
      .replace(/&amp;nbsp;/gi, '&nbsp;')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  return html.replace(
    /<p\b[^>]*white-space\s*:\s*pre-wrap[^>]*>([\s\S]*?)<\/p>/gi,
    (match, inner: string) => {
      if (!/&lt;|&gt;|&amp;/i.test(inner)) return match;
      return `<div style="margin:0 0 14px">${decode(inner)}</div>`;
    },
  );
}

/**
 * Sanitize rich-text HTML produced by EmailRichTextEditor before rendering it
 * via dangerouslySetInnerHTML. Strips dangerous tags (script/style/iframe/etc.),
 * inline event handlers (on*=), and javascript:/data: URLs while preserving
 * normal formatting (p, br, strong, em, lists, links, etc.).
 */
export function sanitizeRichHtml(input: string | null | undefined): string {
  if (!input) return '';
  let html = String(input);
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta|noscript)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta|noscript)\b[^>]*\/?>/gi, '');
  html = html.replace(/\s(on[a-z]+)\s*=\s*"[^"]*"/gi, '');
  html = html.replace(/\s(on[a-z]+)\s*=\s*'[^']*'/gi, '');
  html = html.replace(/\s(on[a-z]+)\s*=\s*[^\s>]+/gi, '');
  html = html.replace(/(href|src|xlink:href)\s*=\s*"\s*(javascript|data|vbscript):[^"]*"/gi, '$1="#"');
  html = html.replace(/(href|src|xlink:href)\s*=\s*'\s*(javascript|data|vbscript):[^']*'/gi, "$1='#'");
  return html;
}
