/**
 * Roles that are org-wide — not tied to a home agency (subCompanyId stays null).
 * Operations Manager uses operations_manager_sub_companies for assigned agencies.
 */
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
