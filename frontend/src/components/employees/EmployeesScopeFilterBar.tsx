/**
 * Scope + linked-account filter bar for the Employees page.
 * Thin alias over the shared recruitment bar.
 */
import { RecruitmentScopeFilterBar } from '@/components/recruitment/RecruitmentScopeFilterBar';

export function EmployeesScopeFilterBar() {
  return <RecruitmentScopeFilterBar />;
}
