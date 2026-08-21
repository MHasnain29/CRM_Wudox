/**
 * Single source of truth for the product brand name.
 *
 * Used only as the last-resort fallback in sender-name chains
 * (`agency?.emailFromName || agency?.name || DEFAULT_BRAND_NAME`) —
 * tenant branding from the SubCompany record always wins.
 */
export const DEFAULT_BRAND_NAME = 'Wudox CRM';
