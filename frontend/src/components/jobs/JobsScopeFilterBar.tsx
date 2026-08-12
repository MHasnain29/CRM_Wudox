/**
 * Scope + linked-account filter bar for the Jobs page.
 * Thin alias over the shared recruitment bar.
 */
import { RecruitmentScopeFilterBar } from '@/components/recruitment/RecruitmentScopeFilterBar';

export function JobsScopeFilterBar() {
  return <RecruitmentScopeFilterBar />;
}
