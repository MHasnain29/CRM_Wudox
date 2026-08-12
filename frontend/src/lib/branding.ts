import type { SubCompany } from './types';
import { canViewGlobalScope, hasPermission } from './access';
import { API_PREFIX } from './apiConfig';

/**
 * Resolve an agency logo URL for use in <img src>.
 * Full https URLs are used as-is. Raw R2 keys (when R2_PUBLIC_URL is unset)
 * are served through the public proxy endpoint so img tags work without auth headers.
 */
export function resolveAgencyLogoSrc(
  logoUrl: string | null | undefined,
  agencyId: string,
): string | null {
  const url = logoUrl?.trim();
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${API_PREFIX}/users/sub-companies/${agencyId}/logo`;
}

/**
 * Company image (`SubCompany.logoUrl`) + company display name in sidebar / top bar.
 * Super admin (global), directors, and operations managers (cross-org) see company chrome;
 * agency staff see agency record name + agency logo.
 */
export function showCompanyLogoInAppChrome(): boolean {
  return (
    canViewGlobalScope() ||
    hasPermission('agencies:global') ||
    hasPermission('agencies:cross_org')
  );
}

/** True when the app should show company display name + company logo (not agency record name / agency logo). */
export function usesCompanyBrandingInApp(): boolean {
  return showCompanyLogoInAppChrome();
}

/** Organization / agency record name (Agencies tab). Used in sidebar and titles for staff. */
export function agencyRecordName(sub: Pick<SubCompany, 'name'> | null | undefined): string {
  return sub?.name?.trim() ?? '';
}

/**
 * Company brand name: optional CRM override, then organization name.
 * Used on public sign-in, and in-app for directors, operations managers, and super admins.
 */
export function companyBrandingName(sub: Pick<SubCompany, 'appProjectName' | 'name'> | null | undefined): string {
  const custom = sub?.appProjectName?.trim() ?? '';
  if (custom) return custom;
  return sub?.name?.trim() ?? '';
}

/**
 * @deprecated Prefer `companyBrandingName` or `agencyRecordName` by context.
 * Same as `companyBrandingName` (legacy callers assumed one combined “display name”).
 */
export function projectDisplayName(sub: Pick<SubCompany, 'appProjectName' | 'name'> | null | undefined): string {
  return companyBrandingName(sub);
}

export function documentTitleFromBranding(
  sub: SubCompany | null | undefined,
): string {
  if (usesCompanyBrandingInApp()) {
    return companyBrandingName(sub);
  }
  return agencyRecordName(sub);
}

export function isValidHttpOrHttpsUrl(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
