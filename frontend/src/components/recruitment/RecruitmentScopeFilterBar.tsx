/**
 * Scope + linked-account filter bar for Recruitment pages
 * (Jobs, Employees, Active Clients, Job Matches).
 *
 * Recruitment domain → chips show Recruitment Managers + Recruiters only.
 * Data on these pages is agency-scoped (useRecruitmentAgencyId); the agency /
 * linked / act-as selection flows through the shared URL params.
 */
import { ScopeFilterBar } from '@/components/ScopeFilterBar';
import { useScopeFilter } from '@/hooks/useElevatedScopeFilter';

export function RecruitmentScopeFilterBar() {
  const { showHierarchyFilters, filterRowProps } = useScopeFilter({ domain: 'recruitment' });
  // Always mount so Linked Account chips show for own-scope users;
  // hierarchy rows only when showHierarchyFilters is true.
  return <ScopeFilterBar show={showHierarchyFilters} filterRowProps={filterRowProps} />;
}
