/**
 * One job row on the Job Matches board: job summary + matching employees.
 * Call / email / link actions on each matching employee.
 */
import { Briefcase, Link2, Loader2, Mail, MapPin, PhoneCall, UserCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type {
  JobMatchBoardRow,
  MatchingEmployee,
  MatchingJob,
} from '@/lib/employeeJobMatchesApi';

type Props = {
  row: JobMatchBoardRow;
  busyEmployeeId: string | null;
  onLink: (employee: MatchingEmployee, job: MatchingJob) => void;
  onCall: (employee: MatchingEmployee) => void;
  onEmail: (employee: MatchingEmployee) => void;
};

export function EmployeeJobMatchRow({
  row,
  busyEmployeeId,
  onLink,
  onCall,
  onEmail,
}: Props) {
  const job = row.job;
  const hasMatches = row.matchCount > 0;
  const requiredSkills = job.requiredSkills ?? [];

  return (
    <article
      className={cn(
        'rounded-xl border bg-card transition-colors',
        hasMatches ? 'border-border' : 'border-dashed border-muted-foreground/25 bg-muted/20',
      )}
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Briefcase className="h-5 w-5 shrink-0 text-muted-foreground" />
            <h3 className="truncate text-sm font-semibold tracking-tight">{job.title}</h3>
            <Badge
              variant={hasMatches ? 'default' : 'outline'}
              className="shrink-0 text-[10px] font-medium"
            >
              {hasMatches
                ? `${row.matchCount} employee${row.matchCount === 1 ? '' : 's'}`
                : 'No matches'}
            </Badge>
            {job.status && (
              <Badge variant="secondary" className="shrink-0 text-[10px] font-normal capitalize">
                {job.status}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-7 text-xs text-muted-foreground">
            <span className="truncate">{job.activeClientName || job.company}</span>
            {(job.location || '').trim() && (
              <span className="inline-flex items-center gap-0.5 truncate">
                <MapPin className="h-3 w-3 shrink-0" />
                {job.location}
              </span>
            )}
            {job.openPositions > 0 && <span>{job.openPositions} open</span>}
            {job.licenseRequired && job.requiredLicenseTypes.length > 0 && (
              <span className="truncate">License: {job.requiredLicenseTypes.join(', ')}</span>
            )}
          </div>
          {requiredSkills.length > 0 && (
            <div className="flex flex-wrap gap-1 pl-7">
              {requiredSkills.slice(0, 8).map((s) => (
                <Badge key={s} variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">
                  {s}
                </Badge>
              ))}
              {requiredSkills.length > 8 && (
                <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
                  +{requiredSkills.length - 8}
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>

      {hasMatches ? (
        <ul className="divide-y border-t">
          {row.matchingEmployees.map((emp) => {
            const name = `${emp.firstName} ${emp.lastName}`.trim() || 'Employee';
            const busy = busyEmployeeId === emp.id;
            const hasPhone = Boolean(emp.phone?.trim());
            const hasEmail = Boolean(emp.email?.trim());
            const skills = emp.skills ?? [];
            return (
              <li
                key={emp.id}
                className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                    <UserCircle2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{name}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-5 text-xs text-muted-foreground">
                    {emp.email && <span className="truncate">{emp.email}</span>}
                    {emp.phone && <span className="truncate">{emp.phone}</span>}
                    {(emp.city || emp.province) && (
                      <span className="truncate">
                        {[emp.city, emp.province].filter(Boolean).join(', ')}
                      </span>
                    )}
                  </div>
                  {skills.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1 pl-5">
                      {skills.slice(0, 5).map((s) => (
                        <Badge
                          key={s}
                          variant="outline"
                          className="px-1.5 py-0 text-[10px] font-normal"
                        >
                          {s}
                        </Badge>
                      ))}
                      {skills.length > 5 && (
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
                          +{skills.length - 5}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1 self-start sm:self-center">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          disabled={!hasPhone}
                          onClick={() => onCall(emp)}
                          aria-label={hasPhone ? `Call ${name}` : 'No phone on file'}
                        >
                          <PhoneCall className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {hasPhone ? 'Call' : 'No phone on file'}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          disabled={!hasEmail}
                          onClick={() => onEmail(emp)}
                          aria-label={hasEmail ? `Email ${name}` : 'No email on file'}
                        >
                          <Mail className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {hasEmail ? 'Email' : 'No email on file'}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 shrink-0 px-2.5 text-xs"
                    disabled={busy}
                    onClick={() => onLink(emp, job)}
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        <Link2 className="mr-1 h-3.5 w-3.5" />
                        Link
                      </>
                    )}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="border-t border-dashed px-4 py-3 text-xs text-muted-foreground">
          No available Master employees match this job&apos;s skills and licenses yet.
        </p>
      )}
    </article>
  );
}
