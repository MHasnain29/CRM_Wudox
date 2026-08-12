/**
 * Job Matches — open jobs with Available Master employees (skill match temporarily off).
 */
import { Link2 } from 'lucide-react';
import { EmployeeJobMatchesBoard } from '@/components/employees/matches/EmployeeJobMatchesBoard';
import { RecruitmentScopeFilterBar } from '@/components/recruitment/RecruitmentScopeFilterBar';

export default function EmployeeJobMatches() {
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border bg-muted/50">
              <Link2 className="h-4 w-4 text-muted-foreground" />
            </span>
            Job Matches
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            Browse open jobs and Available Master employees. Call or email candidates, or link them
            to the job when ready.
          </p>
        </div>
      </div>
      <RecruitmentScopeFilterBar />
      <EmployeeJobMatchesBoard />
    </div>
  );
}
