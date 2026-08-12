import type { AnchorToken } from './types';

// Generic bracketed-placeholder detector. Finds ANY [text] occurrence in the
// PDF — works regardless of the exact wording the director chose.
// /g for multi-match (a placeholder can appear several times in one template).
export const PLACEHOLDER_PATTERN = /\[([^\]\n]+)\]/g;

// Heuristic classifier — given the inside of a placeholder (e.g. "Agency Name"
// from "[Agency Name]"), returns the semantic token it represents, or null if
// the placeholder is not one we know how to fill.
//
// Order matters: more-specific multi-word checks come first so generic single
// words don't steal them.
export function classifyPlaceholder(inner: string): AnchorToken | null {
  const t = inner.toLowerCase().replace(/[\s_]+/g, ' ').trim();
  if (!t) return null;

  // Specific compound concepts first
  if (/\bbill\s*rate\b/.test(t) || /\bmarkup\b/.test(t) || /\bhourly\s*rate\b/.test(t) || /\bplacement\s*fee\b/.test(t) || /\bfee\s*percent/.test(t)) return 'bill_rate';
  if (/\btype\s*of\s*business\b/.test(t) || /\bindustry\b/.test(t)) return 'client_industry';
  if (/\b(signing|signature)\s*authority\b/.test(t) || /\bdesignation\b/.test(t) || /\bsigned\s*by\b/.test(t) || /\bauthorized\s*signatory\b/.test(t)) return 'signing_authority';

  // "# of hours" / "minimum hours" / "probationary period"
  if (/\bhours?\b/.test(t) || /\bprobation/.test(t)) return 'minimum_hours';
  // "# of days" / "payment days" / "net days"
  if (/\bdays?\b/.test(t) || /\bnet\b/.test(t)) return 'payment_days';

  // Generic noun keywords (last because they're broader)
  if (/\b(client|recipient|customer)\b/.test(t)) return 'client_name';
  if (/\bagency\b/.test(t) || /\bcompany\s*name\b/.test(t)) return 'agency_name';
  if (/\bdate\b/.test(t) || /\btoday\b/.test(t)) return 'today';

  return null;
}
