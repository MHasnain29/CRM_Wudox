/** Org-wide roles — no home agency (matches backend AGENCY_INDEPENDENT_ROLES). */
export const AGENCY_INDEPENDENT_ROLES = [
  'super_admin',
  'director',
  'operations_manager',
  'data_entry_specialist',
  'database_manager',
] as const;

export type AgencyIndependentRole = (typeof AGENCY_INDEPENDENT_ROLES)[number];

export function isAgencyIndependentRole(role: string | null | undefined): role is AgencyIndependentRole {
  return !!role && (AGENCY_INDEPENDENT_ROLES as readonly string[]).includes(role);
}

export function formatUserAgencyLabel(
  role: string | null | undefined,
  subCompanyName: string | null | undefined,
): string {
  if (isAgencyIndependentRole(role)) return 'Org-wide';
  if (subCompanyName) return subCompanyName;
  return '—';
}
