/**
 * Backend-aligned role options for user management.
 * role = API/DB enum value; label = display/userType string.
 */
export const MARKETING_ROLE_KEY = 'marketing';
export const MARKETING_ROLE_LABEL = 'Sales & Marketing Executive';

export function isLegacyMarketingTitle(roleKey: string, title: string | null | undefined): boolean {
  return roleKey === MARKETING_ROLE_KEY && (title ?? '').trim().toLowerCase() === 'marketing';
}

export const ROLE_OPTIONS: { role: string; label: string }[] = [
  { role: 'super_admin', label: 'Super Admin' },
  { role: 'dev_team', label: 'Dev Team' },
  { role: 'director', label: 'Director' },
  { role: 'company_director', label: 'Company Director' },
  { role: 'sales_manager', label: 'Sales Manager' },
  { role: 'recruitment_manager', label: 'Recruitment Manager' },
  { role: 'sales_associate', label: 'Sales Associate' },
  { role: 'sales_executive', label: 'Sales Executive' },
  { role: MARKETING_ROLE_KEY, label: MARKETING_ROLE_LABEL },
  { role: 'recruiter', label: 'Recruiter' },
  { role: 'sr_recruiter', label: 'Senior Recruiter' },
  { role: 'data_entry_specialist', label: 'Data Entry Specialist' },
  { role: 'database_manager', label: 'Database Manager' },
  { role: 'operations_manager', label: 'Operations Manager' },
  { role: 'it', label: 'IT' },
];

/** Created only via Settings → Super Users (not Add New User on /users). */
export const SUPER_USERS_SCREEN_ROLES = ['super_admin', 'director', 'company_director', 'operations_manager'] as const;

export const SALES_ROLES = ['sales_associate', 'sales_executive', 'sales_manager', 'marketing'];
export const MANAGER_ROLES = ['sales_manager', 'recruitment_manager', 'company_director', 'director'];
export const ALL_LOCATION_ACCESS_ROLES = ['director', 'company_director', 'it', 'super_admin'];
export const ASSOCIATE_LEVEL_ROLES = ['sales_associate', 'sales_executive', 'marketing', 'recruiter', 'sr_recruiter', 'data_entry_specialist'];

/** Created only via Super Users → Database Managers (not regular Add User). */
export const DATABASE_MANAGER_SCREEN_ROLES = ['database_manager'] as const;
