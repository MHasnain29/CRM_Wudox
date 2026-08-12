/**
 * Active Client detail — compact linked job cards + Create Job.
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { JobStatusBadge } from '@/components/jobs/JobStatusBadge';
import { CreateJobDialog } from '@/components/jobs/CreateJobDialog';
import { JobDetailsSheet } from '@/components/jobs/JobDetailsSheet';
import type { ApiActiveClient, ActiveClientJobSummary } from '@/lib/activeClientsApi';
import type { Job, JobStatus } from '@/lib/jobTypes';
import { formatJobSalary } from '@/lib/jobSalary';
import { getJobEndInfo } from '@/lib/jobEndDate';
import { useHasPermission } from '@/lib/access';
import { fetchJob } from '@/lib/jobsApi';
import { cn } from '@/lib/utils';
import {
  Briefcase,
  ChevronRight,
  Clock,
  DollarSign,
  Loader2,
  MapPin,
  Plus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

const EMPLOYMENT_LABELS: Record<string, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  temporary: 'Temporary',
  'full-time': 'Full-time',
  'part-time': 'Part-time',
};

type Props = {
  client: ApiActiveClient;
  jobs: ActiveClientJobSummary[];
  /** Hide Jobs title + Create/View actions (parent renders them outside scroll). */
  hideHeader?: boolean;
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
};

function employmentLabel(v: string): string {
  return EMPLOYMENT_LABELS[v] ?? v;
}

function isClosedOrFilled(status: string): boolean {
  return status === 'closed' || status === 'filled';
}

function Sep() {
  return (
    <span className="text-muted-foreground/40 shrink-0" aria-hidden>
      ·
    </span>
  );
}

function Meta({
  icon: Icon,
  children,
}: {
  icon?: typeof MapPin;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground min-w-0 truncate">
      {Icon ? <Icon className="h-3 w-3 shrink-0" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

function StatPill({
  label,
  value,
  suffix,
}: {
  label: string;
  value: ReactNode;
  suffix?: string;
}) {
  return (
    <div className="rounded-md bg-muted/60 px-2.5 py-1.5 min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-semibold tabular-nums truncate">
        {value}
        {suffix != null ? (
          <span className="text-xs font-normal text-muted-foreground">/{suffix}</span>
        ) : null}
      </p>
    </div>
  );
}

export function ActiveClientJobsSection({
  client,
  jobs,
  hideHeader = false,
  createOpen: createOpenProp,
  onCreateOpenChange,
}: Props) {
  const canWriteJobs = useHasPermission('jobs:write');
  const [createOpenInternal, setCreateOpenInternal] = useState(false);
  const createOpen = createOpenProp ?? createOpenInternal;
  const setCreateOpen = onCreateOpenChange ?? setCreateOpenInternal;
  const createControlled = createOpenProp !== undefined;
  const [detailsJob, setDetailsJob] = useState<Job | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLoadingId, setDetailsLoadingId] = useState<string | null>(null);

  const openJobDetails = async (jobId: string) => {
    setDetailsLoadingId(jobId);
    try {
      const job = await fetchJob(jobId);
      setDetailsJob(job);
      setDetailsOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load job');
    } finally {
      setDetailsLoadingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {!hideHeader ? (
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-muted-foreground" />
              Jobs
              <Badge variant="secondary" className="font-normal">
                {jobs.length}
              </Badge>
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Open roles linked to this client. Click a job for full details.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canWriteJobs && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                Create Job
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to={`/jobs?clientId=${encodeURIComponent(client.id)}`}>View on Jobs</Link>
            </Button>
          </div>
        </div>
      ) : null}

      {jobs.length === 0 ? (
        <div className="rounded-lg border border-dashed px-6 py-10 text-center space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Briefcase className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">No jobs yet</p>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Create a job for this client to start hiring and assigning employees.
            </p>
          </div>
          {canWriteJobs && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Create Job
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => {
            const shift = job.shiftSchedule;
            const shiftLabel =
              shift?.startTime && shift?.endTime
                ? `${shift.startTime} – ${shift.endTime}`
                : null;
            const workDaysLabel = shift?.workDays?.length
              ? shift.workDays.map((d) => d.slice(0, 3)).join(', ')
              : null;
            const loading = detailsLoadingId === job.id;
            const minimal = isClosedOrFilled(job.status);
            const pay = formatJobSalary(job.salaryMin, job.salaryMax);
            const hasPay = pay !== 'Not specified';
            const maxScheduled = Math.ceil(
              job.openPositions * (1 + job.backupPercentage / 100),
            );
            const employment = employmentLabel(job.employmentType);
            const endInfo = getJobEndInfo({
              status: job.status as JobStatus,
              shiftSchedule: {
                startTime: shift?.startTime ?? '',
                endTime: shift?.endTime ?? '',
                workDays: (shift?.workDays ?? []) as Job['shiftSchedule']['workDays'],
                jobStartDate: shift?.jobStartDate
                  ? new Date(shift.jobStartDate)
                  : new Date(),
                jobEndDate: shift?.jobEndDate ? new Date(shift.jobEndDate) : undefined,
              },
            });

            return (
              <button
                key={job.id}
                type="button"
                className={cn(
                  'w-full text-left rounded-lg border px-3.5 py-3 space-y-2',
                  'hover:border-primary/40 hover:bg-muted/30 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'disabled:opacity-60',
                  minimal ? 'bg-muted/30 opacity-90' : 'bg-card',
                )}
                disabled={loading}
                onClick={() => void openJobDetails(job.id)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold text-sm truncate min-w-0">
                    {job.title}
                  </span>
                  <JobStatusBadge status={job.status as JobStatus} />
                  <Badge
                    variant={job.jobType === 'internal' ? 'default' : 'secondary'}
                    className="text-[10px] h-5 px-1.5 font-normal shrink-0"
                  >
                    {job.jobType === 'internal' ? 'Internal' : 'External'}
                  </Badge>
                  <span className="ml-auto shrink-0 inline-flex items-center text-muted-foreground">
                    {loading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </span>
                </div>

                {minimal ? (
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <Meta>
                      {job.filledPositions}/{job.openPositions} filled
                    </Meta>
                    {job.location ? (
                      <>
                        <Sep />
                        <Meta icon={MapPin}>{job.location}</Meta>
                      </>
                    ) : null}
                    {hasPay ? (
                      <>
                        <Sep />
                        <Meta icon={DollarSign}>{pay}</Meta>
                      </>
                    ) : null}
                    {employment ? (
                      <>
                        <Sep />
                        <Meta>{employment}</Meta>
                      </>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-4 gap-1.5">
                      <StatPill
                        label="Filled"
                        value={job.filledPositions}
                        suffix={String(job.openPositions)}
                      />
                      <StatPill
                        label="Scheduled"
                        value={job.scheduledPositions}
                        suffix={String(maxScheduled)}
                      />
                      <StatPill label="Pay" value={hasPay ? pay : '—'} />
                      <StatPill label="Shift" value={shiftLabel ?? '—'} />
                    </div>
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      {job.location ? <Meta icon={MapPin}>{job.location}</Meta> : null}
                      {employment ? (
                        <>
                          {job.location ? <Sep /> : null}
                          <Meta>{employment}</Meta>
                        </>
                      ) : null}
                      {workDaysLabel ? (
                        <>
                          <Sep />
                          <Meta icon={Clock}>{workDaysLabel}</Meta>
                        </>
                      ) : null}
                      {endInfo.endDate ? (
                        <>
                          <Sep />
                          <Meta>
                            Ends {format(endInfo.endDate, 'MMM d, yyyy')}
                          </Meta>
                          {endInfo.isOverdue ? (
                            <Badge variant="destructive" className="text-[10px] h-5">
                              Overdue
                            </Badge>
                          ) : null}
                          {endInfo.endsSoon ? (
                            <Badge className="text-[10px] h-5 bg-amber-500 hover:bg-amber-500 text-white">
                              {endInfo.daysLeft === 0
                                ? 'Ends today'
                                : `Ends in ${endInfo.daysLeft}d`}
                            </Badge>
                          ) : null}
                        </>
                      ) : null}
                      <Sep />
                      <Meta icon={Users}>{job.applicantCount} applicants</Meta>
                    </div>
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}

      {!createControlled ? (
        <CreateJobDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          defaultActiveClient={{
            id: client.id,
            name: client.name,
            location: client.location,
          }}
        />
      ) : null}

      <JobDetailsSheet
        job={detailsJob}
        open={detailsOpen}
        onOpenChange={(open) => {
          setDetailsOpen(open);
          if (!open) setDetailsJob(null);
        }}
      />
    </div>
  );
}
