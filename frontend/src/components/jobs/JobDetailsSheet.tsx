/**
 * Job detail sheet — compact fixed chrome + tabbed body.
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Job, JobStatus } from '@/lib/jobTypes';
import { useQueryClient } from '@tanstack/react-query';
import { updateJobStatus } from '@/lib/jobsApi';
import { countFilledPositions } from '@/lib/jobFilledCount';
import { formatJobSalary, getJobSalaryType } from '@/lib/jobSalary';
import { getJobEndInfo } from '@/lib/jobEndDate';
import { JobStatusBadge } from './JobStatusBadge';
import { JobCodeBadge } from './JobCodeBadge';
import { JobClientEmployeeSummary } from './JobClientEmployeeSummary';
import { EndJobPlacementsDialog } from './EndJobPlacementsDialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  MapPin,
  Building2,
  Users,
  Clock,
  DollarSign,
  Linkedin,
  Globe,
  Play,
  CheckCircle,
  XCircle,
  Briefcase,
  GraduationCap,
  Calendar,
  CalendarDays,
  UserPlus,
} from 'lucide-react';
import { format } from 'date-fns';

interface JobDetailsSheetProps {
  job: Job | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onManageEmployees?: () => void;
}

function DetailCell({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="text-base text-foreground break-words font-medium">{children}</div>
    </div>
  );
}

function MetricTile({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: typeof Briefcase;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md bg-muted/50 px-2.5 py-1.5 min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1 truncate">
        <Icon className="h-3 w-3 shrink-0" />
        {label}
      </p>
      <div className="mt-0.5 text-sm font-semibold leading-tight truncate">{children}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-lg font-semibold tracking-tight">{children}</h3>;
}

export function JobDetailsSheet({
  job: jobProp,
  open,
  onOpenChange,
  onManageEmployees,
}: JobDetailsSheetProps) {
  const queryClient = useQueryClient();
  const [endJobOpen, setEndJobOpen] = useState(false);
  const [endJobStatus, setEndJobStatus] = useState<'closed' | 'filled'>('closed');
  const [statusBusy, setStatusBusy] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    setActiveTab('overview');
  }, [jobProp?.id]);

  const job = jobProp;

  if (!job) return null;

  const handleStatusChange = async (status: JobStatus) => {
    if (status === 'closed' || status === 'filled') {
      setEndJobStatus(status);
      setEndJobOpen(true);
      return;
    }
    setStatusBusy(true);
    try {
      await updateJobStatus(job.id, status);
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast.success(`Job status updated to ${status}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setStatusBusy(false);
    }
  };

  const filled = countFilledPositions(job);
  const maxScheduled = Math.ceil(job.openPositions * (1 + job.backupPercentage / 100));
  const salaryType = getJobSalaryType(job.salaryMin, job.salaryMax);
  const endInfo = getJobEndInfo(job);
  const shift = job.shiftSchedule;
  const shiftLabel =
    shift?.startTime && shift?.endTime ? `${shift.startTime} – ${shift.endTime}` : '—';
  const hasDescriptionContent = Boolean(
    job.description || job.requirements || job.responsibilities
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[92vh] w-[95vw] max-w-[1400px] flex-col gap-0 overflow-hidden p-0 rounded-xl sm:rounded-xl [&>button]:right-4 [&>button]:top-4 [&>button]:z-50 [&>button]:flex [&>button]:h-8 [&>button]:w-8 [&>button]:items-center [&>button]:justify-center [&>button]:rounded-full [&>button]:border [&>button]:bg-background [&>button]:opacity-100 [&>button]:shadow-sm [&>button]:transition-colors [&>button]:hover:bg-muted">
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex flex-col flex-1 min-h-0"
          >
            {/* Compact fixed header chrome */}
            <div className="shrink-0 z-10 bg-background border-b">
              <SheetHeader className="px-5 pt-3 pb-2 space-y-2 text-left">
                <div className="flex items-center gap-2 flex-wrap min-w-0 pr-8">
                  <SheetTitle className="text-base sm:text-lg font-semibold truncate">
                    {job.title}
                  </SheetTitle>
                  <Badge
                    variant={job.jobType === 'internal' ? 'default' : 'secondary'}
                    className="gap-1 text-[11px] h-5 px-1.5 shrink-0"
                  >
                    {job.jobType === 'internal' ? (
                      <Building2 className="h-3 w-3" />
                    ) : (
                      <Users className="h-3 w-3" />
                    )}
                    {job.jobType === 'internal' ? 'Internal' : 'External'}
                  </Badge>
                  <JobStatusBadge status={job.status} />
                </div>
                <SheetDescription className="flex items-center gap-2 flex-wrap text-xs !mt-0">
                  <span className="font-medium text-foreground/75 truncate">{job.company}</span>
                  <JobCodeBadge code={job.jobCode} />
                  <span className="inline-flex items-center gap-1 text-muted-foreground truncate">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {job.location}
                  </span>
                </SheetDescription>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  <MetricTile label="Positions" icon={Briefcase}>
                    <span className="tabular-nums">
                      {filled}
                      <span className="text-xs font-normal text-muted-foreground">
                        /{job.openPositions}
                      </span>
                    </span>
                  </MetricTile>
                  <MetricTile label="Scheduled" icon={Users}>
                    <span className="tabular-nums">
                      {job.scheduledPositions}
                      <span className="text-xs font-normal text-muted-foreground">
                        /{maxScheduled}
                      </span>
                    </span>
                  </MetricTile>
                  <MetricTile label="Pay" icon={DollarSign}>
                    <span className="truncate block text-xs sm:text-sm">
                      {formatJobSalary(job.salaryMin, job.salaryMax)}
                      {(job.salaryMin != null || job.salaryMax != null) && (
                        <Badge variant="outline" className="ml-1 text-[9px] h-4 px-1 align-middle">
                          {salaryType === 'fixed' ? 'Fixed' : 'Range'}
                        </Badge>
                      )}
                    </span>
                  </MetricTile>
                  <MetricTile label="Shift" icon={Clock}>
                    <span className="truncate block text-xs sm:text-sm">{shiftLabel}</span>
                  </MetricTile>
                </div>
              </SheetHeader>

              <div className="px-5 py-1.5 border-t flex flex-wrap items-center gap-1.5 bg-muted/20">
                {onManageEmployees && job.status === 'open' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={onManageEmployees}
                  >
                    <UserPlus className="h-3.5 w-3.5 mr-1" />
                    Manage Employees
                  </Button>
                )}
                {job.status === 'draft' && (
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={statusBusy}
                    onClick={() => void handleStatusChange('open')}
                  >
                    <Play className="h-3.5 w-3.5 mr-1" />
                    Publish Job
                  </Button>
                )}
                {(job.status === 'draft' || job.status === 'open') && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={statusBusy}
                    onClick={() => void handleStatusChange('closed')}
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1" />
                    Close
                  </Button>
                )}
                {job.status === 'open' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 text-xs"
                    disabled={statusBusy}
                    onClick={() => void handleStatusChange('filled')}
                  >
                    <CheckCircle className="h-3.5 w-3.5 mr-1" />
                    Mark Filled
                  </Button>
                )}
                {(job.status === 'closed' || job.status === 'filled') && (
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={statusBusy}
                    onClick={() => void handleStatusChange('open')}
                  >
                    <Play className="h-3.5 w-3.5 mr-1" />
                    Reopen Job
                  </Button>
                )}
              </div>

              {(endInfo.isOverdue || endInfo.endsSoon) && (
                <div className="px-5 py-1.5 border-t">
                  <div
                    className={
                      endInfo.isOverdue
                        ? 'rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs text-destructive'
                        : 'rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs text-amber-800'
                    }
                  >
                    {endInfo.isOverdue
                      ? `End date (${format(endInfo.endDate!, 'MMM d, yyyy')}) passed — end placements and close.`
                      : endInfo.daysLeft === 0
                        ? 'Ends today — prepare to end placements and close.'
                        : `Ends in ${endInfo.daysLeft} day${endInfo.daysLeft === 1 ? '' : 's'} — prepare to end placements.`}
                  </div>
                </div>
              )}

              <div className="px-5 py-1.5 border-t">
                <TabsList className="w-full h-8 flex flex-wrap justify-start gap-0.5 p-0.5">
                  <TabsTrigger value="overview" className="flex-1 min-w-[4.5rem] text-xs h-7 px-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=active]:font-semibold">
                    Overview
                  </TabsTrigger>
                  <TabsTrigger value="staffing" className="flex-1 min-w-[4.5rem] text-xs h-7 px-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=active]:font-semibold">
                    Staffing
                  </TabsTrigger>
                  <TabsTrigger value="schedule" className="flex-1 min-w-[4.5rem] text-xs h-7 px-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=active]:font-semibold">
                    Schedule
                  </TabsTrigger>
                  <TabsTrigger value="criteria" className="flex-1 min-w-[4.5rem] text-xs h-7 px-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=active]:font-semibold">
                    Criteria
                  </TabsTrigger>
                  <TabsTrigger value="description" className="flex-1 min-w-[4.5rem] text-xs h-7 px-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=active]:font-semibold">
                    Description
                  </TabsTrigger>
                </TabsList>
              </div>
            </div>

            <ScrollArea className="flex-1 min-h-0">
              <div className="px-8 py-7">
                <TabsContent value="overview" className="mt-0 space-y-8">
                  <div className="space-y-4">
                    <SectionTitle>Overview</SectionTitle>
                    <div className="rounded-xl border bg-card p-6 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5">
                      <DetailCell label="Department">{job.department || '—'}</DetailCell>
                      <DetailCell label="Employment">
                        <span className="capitalize">{job.employmentType}</span>
                      </DetailCell>
                      <DetailCell label="Work mode">
                        <span className="capitalize">{job.screeningCriteria.remoteOption}</span>
                      </DetailCell>
                      <DetailCell label="End date">
                        <span className="inline-flex items-center gap-2 flex-wrap">
                          <CalendarDays className="h-4 w-4 text-muted-foreground" />
                          {endInfo.endDate ? format(endInfo.endDate, 'MMM d, yyyy') : '—'}
                        </span>
                      </DetailCell>
                      <DetailCell label="Applicants">{job.applicantCount}</DetailCell>
                      <DetailCell label="Backup pool">{job.backupPercentage}%</DetailCell>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <SectionTitle>Published to</SectionTitle>
                    <div className="flex flex-wrap gap-2.5">
                      <Badge
                        variant={job.publishSettings.linkedin ? 'default' : 'outline'}
                        className={cn(
                          'text-sm px-3 py-1.5',
                          job.publishSettings.linkedin ? 'bg-blue-600' : 'opacity-50'
                        )}
                      >
                        <Linkedin className="h-4 w-4 mr-1.5" />
                        LinkedIn
                      </Badge>
                      <Badge
                        variant={job.publishSettings.indeed ? 'default' : 'outline'}
                        className={cn(
                          'text-sm px-3 py-1.5',
                          job.publishSettings.indeed ? 'bg-purple-600' : 'opacity-50'
                        )}
                      >
                        <Globe className="h-4 w-4 mr-1.5" />
                        Indeed
                      </Badge>
                      <Badge
                        variant={job.publishSettings.glassdoor ? 'default' : 'outline'}
                        className={cn(
                          'text-sm px-3 py-1.5',
                          job.publishSettings.glassdoor ? 'bg-green-600' : 'opacity-50'
                        )}
                      >
                        <Globe className="h-4 w-4 mr-1.5" />
                        Glassdoor
                      </Badge>
                    </div>
                  </div>

                  <div className="space-y-1.5 text-base text-muted-foreground border-t pt-5">
                    <p>
                      Created by {job.createdByName} on{' '}
                      {format(new Date(job.createdAt), 'MMM d, yyyy')}
                    </p>
                    <p>Last updated: {format(new Date(job.updatedAt), 'MMM d, yyyy h:mm a')}</p>
                  </div>
                </TabsContent>

                <TabsContent value="staffing" className="mt-0 space-y-8">
                  <JobClientEmployeeSummary job={job} />

                  {job.jobType === 'external' && (
                    <div className="space-y-4">
                      <div>
                        <SectionTitle>Scheduling capacity</SectionTitle>
                        <p className="text-base text-muted-foreground mt-1">
                          Positions, backup pool, and current roster.
                        </p>
                      </div>
                      <div className="rounded-xl border bg-card p-6 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5">
                        <DetailCell label="Open positions">{job.openPositions}</DetailCell>
                        <DetailCell label="Max scheduled">{maxScheduled}</DetailCell>
                        <DetailCell label="Currently scheduled">
                          {job.scheduledPositions} / {maxScheduled}
                        </DetailCell>
                        <DetailCell label="Assigned">{(job.assignments || []).length}</DetailCell>
                        <DetailCell label="Filled">{filled}</DetailCell>
                        <DetailCell label="Backup %">{job.backupPercentage}%</DetailCell>
                      </div>
                    </div>
                  )}

                  {job.jobType === 'internal' && (
                    <div className="space-y-4">
                      <SectionTitle>Capacity</SectionTitle>
                      <div className="rounded-xl border bg-card p-6 grid grid-cols-2 gap-x-6 gap-y-5">
                        <DetailCell label="Open positions">{job.openPositions}</DetailCell>
                        <DetailCell label="Assigned">{(job.assignments || []).length}</DetailCell>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="schedule" className="mt-0 space-y-4">
                  {shift ? (
                    <>
                      <SectionTitle>Shift schedule</SectionTitle>
                      <div className="rounded-xl border bg-card p-6 space-y-5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                          <DetailCell label="Hours">
                            <span className="inline-flex items-center gap-2">
                              <Clock className="h-4 w-4 text-muted-foreground" />
                              {shiftLabel}
                            </span>
                          </DetailCell>
                          <DetailCell label="Date range">
                            <span className="inline-flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              {format(new Date(shift.jobStartDate), 'MMM d, yyyy')}
                              {shift.jobEndDate && (
                                <> – {format(new Date(shift.jobEndDate), 'MMM d, yyyy')}</>
                              )}
                            </span>
                          </DetailCell>
                        </div>
                        {shift.workDays?.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Work days
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {shift.workDays.map((day) => (
                                <Badge key={day} variant="outline" className="text-sm px-3 py-1">
                                  {day.slice(0, 3)}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl border border-dashed px-8 py-14 text-center">
                      <p className="text-base text-muted-foreground">
                        No shift schedule set for this job.
                      </p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="criteria" className="mt-0 space-y-8">
                  {job.licenseRequired && job.requiredLicenseTypes.length > 0 && (
                    <div className="space-y-4">
                      <SectionTitle>Required licenses</SectionTitle>
                      <div className="flex flex-wrap gap-2">
                        {job.requiredLicenseTypes.map((type) => (
                          <Badge
                            key={type}
                            variant="outline"
                            className="border-amber-300 bg-amber-50 text-amber-800 text-sm px-3 py-1"
                          >
                            {type}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    <SectionTitle>Screening criteria</SectionTitle>
                    <div className="rounded-xl border bg-card p-6 space-y-5">
                      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                        <DetailCell label="Min experience">
                          {job.screeningCriteria.minExperienceYears} years
                        </DetailCell>
                        {job.screeningCriteria.educationLevel && (
                          <DetailCell label="Education">
                            <span className="inline-flex items-center gap-2">
                              <GraduationCap className="h-4 w-4 text-muted-foreground" />
                              {job.screeningCriteria.educationLevel}
                            </span>
                          </DetailCell>
                        )}
                      </div>

                      {job.screeningCriteria.requiredSkills.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Required skills
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {job.screeningCriteria.requiredSkills.map((skill) => (
                              <Badge key={skill} className="text-sm px-3 py-1">
                                {skill}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {job.screeningCriteria.preferredSkills.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Preferred skills
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {job.screeningCriteria.preferredSkills.map((skill) => (
                              <Badge key={skill} variant="secondary" className="text-sm px-3 py-1">
                                {skill}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {job.screeningCriteria.certifications &&
                        job.screeningCriteria.certifications.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Certifications
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {job.screeningCriteria.certifications.map((cert) => (
                                <Badge key={cert} variant="outline" className="text-sm px-3 py-1">
                                  {cert}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="description" className="mt-0 space-y-8">
                  {hasDescriptionContent ? (
                    <>
                      {job.description && (
                        <div className="space-y-3">
                          <SectionTitle>Description</SectionTitle>
                          <div className="rounded-xl border bg-card p-6">
                            <p className="text-base text-muted-foreground whitespace-pre-wrap leading-relaxed">
                              {job.description}
                            </p>
                          </div>
                        </div>
                      )}
                      {job.requirements && (
                        <div className="space-y-3">
                          <SectionTitle>Requirements</SectionTitle>
                          <div className="rounded-xl border bg-card p-6">
                            <p className="text-base text-muted-foreground whitespace-pre-wrap leading-relaxed">
                              {job.requirements}
                            </p>
                          </div>
                        </div>
                      )}
                      {job.responsibilities && (
                        <div className="space-y-3">
                          <SectionTitle>Responsibilities</SectionTitle>
                          <div className="rounded-xl border bg-card p-6">
                            <p className="text-base text-muted-foreground whitespace-pre-wrap leading-relaxed">
                              {job.responsibilities}
                            </p>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="rounded-xl border border-dashed px-8 py-14 text-center">
                      <p className="text-base text-muted-foreground">
                        No description, requirements, or responsibilities for this job.
                      </p>
                    </div>
                  )}
                </TabsContent>
              </div>
            </ScrollArea>
          </Tabs>
        </DialogContent>
      </Dialog>
      <EndJobPlacementsDialog
        open={endJobOpen}
        onOpenChange={setEndJobOpen}
        job={job}
        finalStatus={endJobStatus}
      />
    </>
  );
}
