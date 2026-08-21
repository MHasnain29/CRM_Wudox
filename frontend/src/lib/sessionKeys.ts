/** Shared localStorage keys for auth and session scoping. */
export const TOKEN_KEY = 'wudox_token';
export const REFRESH_KEY = 'wudox_refresh_token';
export const SELECTED_AGENCY_KEY = 'wudox_selected_agency_id';
export const AGENCY_FILTER_KEY = 'wudox_agency_filter_ids';
export const USER_FILTER_PREFIX = 'wudox_user_filter_';

// One-time cleanup of pre-rebrand keys: browsers that logged in before the
// NA Staffing → Wudox rename still hold live tokens under the old names, and
// logout only removes the new keys. Safe to delete this block once all
// pre-rebrand refresh tokens have expired (7-day TTL).
try {
  ['na_staffing_token', 'na_staffing_refresh_token', 'na_staffing_selected_agency_id', 'na_agency_filter_ids']
    .forEach((key) => localStorage.removeItem(key));
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith('na_user_filter_')) localStorage.removeItem(key);
  }
} catch {
  // localStorage unavailable (tests/SSR) — nothing to clean
}
