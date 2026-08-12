import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Building2, UserCircle2 } from 'lucide-react';
import type { Job } from '@/lib/jobTypes';
import { useQuery } from '@tanstack/react-query';
import { fetchActiveClient } from '@/lib/activeClientsApi';
import { countFilledPositions } from '@/lib/jobFilledCount';

interface JobClientEmployeeSummaryProps {
  job: Job;
  /** Compact row variant for table cells */
  compact?: boolean;
}

function staffingStatusLabel(job: Job): {
  label: string;
  className: string;
} {
  const filled = countFilledPositions(job);
  const open = Math.max(0, job.openPositions);
  const pending = Math.max(0, open - filled);

  if (filled === 0 && pending === 0) {
    return {
      label: 'Unassigned',
      className: 'bg-muted text-muted-foreground',
    };
  }

  if (filled === 0) {
    return {
      label: `Pending · ${pending}`,
      className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    };
  }

  if (pending === 0) {
    return {
      label: `Filled · ${filled}`,
      className:
        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    };
  }

  return {
    label: `Filled ${filled} · Pending ${pending}`,
    className:
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  };
}

export function JobClientEmployeeSummary({ job, compact }: JobClientEmployeeSummaryProps) {
  // Full client details only needed for the expanded card
  const { data: client } = useQuery({
    queryKey: ['active-client', job.clientId],
    queryFn: () => fetchActiveClient(job.clientId!),
    enabled: !compact && Boolean(job.clientId),
  });

  const clientName = client?.name ?? job.company;
  const assignments = job.assignments || [];
  const activeAssignments = assignments.filter((a) => a.isActive);
  const displayAssignments = activeAssignments.length > 0 ? activeAssignments : assignments;
  const staffing = staffingStatusLabel(job);

  if (compact) {
    return (
      <div className="space-y-1.5 min-w-0">
        <div className="flex items-center gap-1 text-sm font-medium truncate">
          <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="truncate">{clientName}</span>
        </div>
        <Badge variant="outline" className={`h-5 px-1.5 text-[11px] font-medium ${staffing.className}`}>
          {staffing.label}
        </Badge>
        {displayAssignments.length > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground truncate">
            <UserCircle2 className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {displayAssignments.length === 1
                ? displayAssignments[0].employeeName
                : `${displayAssignments[0].employeeName} +${displayAssignments.length - 1}`}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 border rounded-xl bg-muted/30 space-y-4">
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Active Client
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
          <Link to="/active-clients" className="text-base font-semibold hover:underline">
            {clientName}
          </Link>
          {client?.location && (
            <span className="text-base text-muted-foreground">· {client.location}</span>
          )}
        </div>
        {client?.contactName && (
          <p className="text-sm text-muted-foreground pl-7">
            Contact: {client.contactName}
            {client.contactPhone ? ` · ${client.contactPhone}` : ''}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Assigned Employees
        </div>
        {displayAssignments.length === 0 ? (
          <p className="text-base text-muted-foreground">No employees assigned yet.</p>
        ) : (
          <div className="space-y-2.5">
            {displayAssignments.map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center gap-2 text-base border rounded-lg px-3 py-2 bg-background/60"
              >
                <Badge variant={a.isBackup ? 'secondary' : 'outline'} className="gap-1.5 shrink-0 text-sm px-2.5 py-1">
                  <UserCircle2 className="h-3.5 w-3.5" />
                  {a.employeeName}
                  {a.isBackup && <span className="text-muted-foreground">(backup)</span>}
                  {!a.isActive && <span className="text-muted-foreground">(inactive)</span>}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
