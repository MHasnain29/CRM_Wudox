import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Plus,
  Briefcase,
  MapPin,
  Users,
  Linkedin,
  Globe,
  Building2,
  Clock,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchJobs } from '@/lib/jobsApi';
import { fetchActiveClients } from '@/lib/activeClientsApi';
import { JOB_TEMPLATES, Job, JobTemplate, JobStatus, JobType, PublishPlatform, JobFilterView, JobFilters } from '@/lib/jobTypes';
import { JobTemplateCard } from '@/components/jobs/JobTemplateCard';
import { JobStatusBadge } from '@/components/jobs/JobStatusBadge';
import { CreateJobDialog } from '@/components/jobs/CreateJobDialog';
import { JobDetailsSheet } from '@/components/jobs/JobDetailsSheet';
import { JobEmployeesDialog } from '@/components/jobs/JobEmployeesDialog';
import { EndJobPlacementsDialog } from '@/components/jobs/EndJobPlacementsDialog';
import { JobClientEmployeeSummary } from '@/components/jobs/JobClientEmployeeSummary';
import { JobsFilterBar, type JobsFilterState } from '@/components/jobs/JobsFilterBar';
import { JobsScopeFilterBar } from '@/components/jobs/JobsScopeFilterBar';
import { format } from 'date-fns';
import { useHasPermission } from '@/lib/access';
import { useLinkedAgencyScope } from '@/hooks/useLinkedAgencyScope';
import { countFilledPositions } from '@/lib/jobFilledCount';
import { getJobEndInfo } from '@/lib/jobEndDate';

const FILTER_VIEWS_KEY = 'jobFilterViews';

function loadFilterViews(): JobFilterView[] {
  try {
    const raw = localStorage.getItem(FILTER_VIEWS_KEY);
    return raw ? (JSON.parse(raw) as JobFilterView[]) : [];
  } catch {
    return [];
  }
}

const emptyFilters: JobsFilterState = {
  searchQuery: '',
  statusFilters: [],
  locationFilters: [],
  departmentFilters: [],
  employmentTypeFilters: [],
  platformFilters: [],
  jobTypeFilters: [],
  clientFilters: [],
};

/** Quick filter applied by clicking a summary card (on top of the filter bar). */
type JobCardFilter = 'all' | 'open' | 'hiring' | 'staffed';

export default function Jobs() {
  const canWriteJobs = useHasPermission('jobs:write');
  // Agency scope: agency picker / act-as / linked accounts (?linkedUserId=a,b).
  const { agencyIds, ownerIds, ownerExact, scopeKey } = useLinkedAgencyScope();
  const [searchParams] = useSearchParams();
  const clientIdFromUrl = searchParams.get('clientId') ?? '';

  const { data: jobsResult } = useQuery({
    queryKey: ['jobs', scopeKey],
    queryFn: () =>
      fetchJobs({
        pageSize: 200,
        agencyIds,
        ownerIds,
        ownerExact,
      }),
  });
  const jobs = useMemo(() => jobsResult?.data ?? [], [jobsResult]);

  const { data: clientsResult } = useQuery({
    queryKey: ['active-clients', scopeKey],
    queryFn: () =>
      fetchActiveClients({
        pageSize: 200,
        agencyIds,
      }),
  });

  const [filterViews, setFilterViews] = useState<JobFilterView[]>(loadFilterViews);

  const saveFilterView = (name: string, viewFilters: JobFilters) => {
    setFilterViews((prev) => {
      const next = [
        ...prev,
        { id: `view-${Date.now()}`, name, filters: viewFilters, createdAt: new Date() },
      ];
      localStorage.setItem(FILTER_VIEWS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const deleteFilterView = (id: string) => {
    setFilterViews((prev) => {
      const next = prev.filter((view) => view.id !== id);
      localStorage.setItem(FILTER_VIEWS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const [filters, setFilters] = useState<JobsFilterState>(() => ({
    ...emptyFilters,
    clientFilters: clientIdFromUrl ? [clientIdFromUrl] : [],
  }));
  const [currentViewId, setCurrentViewId] = useState<string | null>(null);
  const [cardFilter, setCardFilter] = useState<JobCardFilter>('all');

  const toggleCardFilter = (f: JobCardFilter) => {
    setCardFilter((prev) => (prev === f ? 'all' : f));
  };

  useEffect(() => {
    if (!clientIdFromUrl) return;
    setFilters((prev) =>
      prev.clientFilters.includes(clientIdFromUrl)
        ? prev
        : { ...prev, clientFilters: [...prev.clientFilters, clientIdFromUrl] },
    );
  }, [clientIdFromUrl]);

  const [showTemplates, setShowTemplates] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<JobTemplate | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [employeesDialogOpen, setEmployeesDialogOpen] = useState(false);
  const [jobToClose, setJobToClose] = useState<Job | null>(null);

  const liveSelectedJob = useMemo(
    () => (selectedJob ? jobs.find((j) => j.id === selectedJob.id) ?? selectedJob : null),
    [jobs, selectedJob],
  );

  const liveJobToClose = useMemo(
    () => (jobToClose ? jobs.find((j) => j.id === jobToClose.id) ?? jobToClose : null),
    [jobs, jobToClose],
  );

  const agencyJobs = jobs;

  const agencyClients = useMemo(
    () =>
      (clientsResult?.data ?? [])
        .map((c) => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [clientsResult],
  );

  const uniqueLocations = useMemo(
    () => [...new Set(agencyJobs.map((j) => j.location))].sort(),
    [agencyJobs],
  );
  const uniqueDepartments = useMemo(
    () =>
      [...new Set(agencyJobs.map((j) => j.department).filter(Boolean) as string[])].sort(),
    [agencyJobs],
  );

  const filteredJobs = useMemo(() => {
    return agencyJobs.filter((job) => {
      if (cardFilter === 'open' && job.status !== 'open') return false;
      if (
        cardFilter === 'hiring' &&
        !(job.status === 'open' && countFilledPositions(job) < job.openPositions)
      ) {
        return false;
      }
      if (cardFilter === 'staffed' && countFilledPositions(job) === 0) return false;

      if (
        filters.clientFilters.length > 0 &&
        (!job.clientId || !filters.clientFilters.includes(job.clientId))
      ) {
        return false;
      }

      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase();
        const matches =
          job.title.toLowerCase().includes(query) ||
          (job.jobCode?.toLowerCase().includes(query) ?? false) ||
          job.company.toLowerCase().includes(query) ||
          job.location.toLowerCase().includes(query);
        if (!matches) return false;
      }

      if (filters.statusFilters.length > 0 && !filters.statusFilters.includes(job.status)) {
        return false;
      }

      if (filters.jobTypeFilters.length > 0 && !filters.jobTypeFilters.includes(job.jobType)) {
        return false;
      }

      if (
        filters.locationFilters.length > 0 &&
        !filters.locationFilters.includes(job.location)
      ) {
        return false;
      }

      if (
        filters.departmentFilters.length > 0 &&
        (!job.department || !filters.departmentFilters.includes(job.department))
      ) {
        return false;
      }

      if (
        filters.employmentTypeFilters.length > 0 &&
        !filters.employmentTypeFilters.includes(job.employmentType)
      ) {
        return false;
      }

      if (filters.platformFilters.length > 0) {
        const hasAny = filters.platformFilters.some((p) => {
          if (p === 'linkedin') return job.publishSettings.linkedin;
          if (p === 'indeed') return job.publishSettings.indeed;
          if (p === 'glassdoor') return job.publishSettings.glassdoor;
          return false;
        });
        if (!hasAny) return false;
      }

      return true;
    });
  }, [agencyJobs, filters, cardFilter]);

  const clearAllFilters = () => {
    setFilters({ ...emptyFilters });
    setCurrentViewId(null);
  };

  const handleSelectTemplate = (template: JobTemplate) => {
    setSelectedTemplate(template);
    setShowTemplates(false);
    setCreateDialogOpen(true);
  };

  const handleCreateBlank = () => {
    setSelectedTemplate(null);
    setShowTemplates(false);
    setCreateDialogOpen(true);
  };

  const handleSaveView = (name: string) => {
    saveFilterView(name, {
      statusFilters: filters.statusFilters,
      locationFilters: filters.locationFilters,
      departmentFilters: filters.departmentFilters,
      employmentTypeFilters: filters.employmentTypeFilters,
      platformFilters: filters.platformFilters,
      jobTypeFilters: filters.jobTypeFilters,
      clientFilters: filters.clientFilters,
      searchQuery: filters.searchQuery,
    });
  };

  const applyFilterView = (view: JobFilterView) => {
    setFilters({
      searchQuery: view.filters.searchQuery || '',
      statusFilters: view.filters.statusFilters || [],
      locationFilters: view.filters.locationFilters || [],
      departmentFilters: view.filters.departmentFilters || [],
      employmentTypeFilters: view.filters.employmentTypeFilters || [],
      platformFilters: (view.filters.platformFilters || []) as PublishPlatform[],
      jobTypeFilters: (view.filters.jobTypeFilters || []) as JobType[],
      clientFilters: view.filters.clientFilters || [],
    });
  };

  const openJobs = agencyJobs.filter((j) => j.status === 'open').length;
  const totalPositions = agencyJobs.reduce((acc, j) => acc + j.openPositions, 0);
  const filledPositions = agencyJobs.reduce((acc, j) => acc + countFilledPositions(j), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pt-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Jobs</h1>
          <p className="text-muted-foreground">Manage job postings and templates</p>
        </div>
        {canWriteJobs && (
          <Button onClick={() => setShowTemplates(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Job
          </Button>
        )}
      </div>

      <JobsScopeFilterBar />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card
          className={`cursor-pointer transition-colors hover:bg-muted/40 ${
            cardFilter === 'all' ? 'ring-2 ring-primary' : ''
          }`}
          onClick={() => setCardFilter('all')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{agencyJobs.length}</div>
            <p className="text-xs text-muted-foreground">All jobs</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors hover:bg-muted/40 ${
            cardFilter === 'open' ? 'ring-2 ring-primary' : ''
          }`}
          onClick={() => toggleCardFilter('open')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Open Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{openJobs}</div>
            <p className="text-xs text-muted-foreground">Status: open</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors hover:bg-muted/40 ${
            cardFilter === 'hiring' ? 'ring-2 ring-primary' : ''
          }`}
          onClick={() => toggleCardFilter('hiring')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Positions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalPositions}</div>
            <p className="text-xs text-muted-foreground">Open jobs still hiring</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors hover:bg-muted/40 ${
            cardFilter === 'staffed' ? 'ring-2 ring-primary' : ''
          }`}
          onClick={() => toggleCardFilter('staffed')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Filled Positions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{filledPositions}</div>
            <p className="text-xs text-muted-foreground">Jobs with placements</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <JobsFilterBar
            filters={filters}
            onChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
            onClear={clearAllFilters}
            locations={uniqueLocations}
            departments={uniqueDepartments}
            clients={agencyClients}
            filterViews={filterViews}
            onSaveView={handleSaveView}
            onApplyView={applyFilterView}
            onDeleteView={deleteFilterView}
            currentViewId={currentViewId}
            onCurrentViewIdChange={setCurrentViewId}
          />
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[96px]">Job ID</TableHead>
                <TableHead className="min-w-[160px]">Job Title</TableHead>
                <TableHead className="min-w-[170px]">Client / Employees</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="whitespace-nowrap">Positions</TableHead>
                <TableHead className="whitespace-nowrap">Scheduled</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead>Platforms</TableHead>
                <TableHead className="whitespace-nowrap">Created</TableHead>
                {canWriteJobs && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredJobs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={canWriteJobs ? 13 : 12}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No jobs found
                  </TableCell>
                </TableRow>
              ) : (
                filteredJobs.map((job) => {
                  const maxScheduled = Math.ceil(
                    job.openPositions * (1 + job.backupPercentage / 100),
                  );
                  const endInfo = getJobEndInfo(job);
                  return (
                    <TableRow
                      key={job.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => {
                        setSelectedJob(job);
                        setDetailsOpen(true);
                      }}
                    >
                      <TableCell className="align-top">
                        <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 font-mono text-[13px] font-semibold tracking-wider text-blue-700 whitespace-nowrap">
                          {job.jobCode ?? '—'}
                        </span>
                      </TableCell>
                      <TableCell className="align-top font-medium">{job.title}</TableCell>
                      <TableCell className="align-top">
                        <JobClientEmployeeSummary job={job} compact />
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex items-center gap-1 text-sm">
                          <MapPin className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="truncate">{job.location}</span>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge
                          variant={job.jobType === 'internal' ? 'default' : 'secondary'}
                          className="font-normal"
                        >
                          {job.jobType === 'internal' ? (
                            <>
                              <Building2 className="h-3 w-3 mr-1" />
                              Internal
                            </>
                          ) : (
                            <>
                              <Users className="h-3 w-3 mr-1" />
                              External
                            </>
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex items-center gap-1.5 text-sm">
                          <Briefcase className="h-3 w-3 text-muted-foreground" />
                          {countFilledPositions(job)}/{job.openPositions}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex items-center gap-1.5 text-sm">
                          <Users className="h-3 w-3 text-muted-foreground" />
                          {job.scheduledPositions}/{maxScheduled}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <JobStatusBadge status={job.status as JobStatus} />
                      </TableCell>
                      <TableCell className="align-top">
                        <span className="flex items-center gap-1 text-sm text-muted-foreground whitespace-nowrap">
                          <Clock className="h-3 w-3 shrink-0" />
                          {job.shiftSchedule.startTime}-{job.shiftSchedule.endTime}
                        </span>
                      </TableCell>
                      <TableCell className="align-top">
                        {endInfo.endDate ? (
                          <div className="flex flex-col gap-1 items-start">
                            <span className="text-sm whitespace-nowrap">
                              {format(endInfo.endDate, 'MMM d, yyyy')}
                            </span>
                            {endInfo.isOverdue && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600 whitespace-nowrap">
                                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                                Overdue
                              </span>
                            )}
                            {endInfo.endsSoon && !endInfo.isOverdue && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600 whitespace-nowrap">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                {endInfo.daysLeft === 0 ? 'Today' : `${endInfo.daysLeft}d left`}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex items-center gap-1.5">
                          {job.publishSettings.linkedin && (
                            <Linkedin className="h-4 w-4 text-blue-600" />
                          )}
                          {job.publishSettings.indeed && (
                            <Globe className="h-4 w-4 text-purple-600" />
                          )}
                          {job.publishSettings.glassdoor && (
                            <Globe className="h-4 w-4 text-green-600" />
                          )}
                          {!job.publishSettings.linkedin &&
                            !job.publishSettings.indeed &&
                            !job.publishSettings.glassdoor && (
                              <span className="text-sm text-muted-foreground">—</span>
                            )}
                        </div>
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground whitespace-nowrap">
                        {format(new Date(job.createdAt), 'MMM d, yyyy')}
                      </TableCell>
                      {canWriteJobs && (
                        <TableCell className="align-top" onClick={(e) => e.stopPropagation()}>
                          {(job.status === 'open' || job.status === 'draft') && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              title="Close job"
                              onClick={(e) => {
                                e.stopPropagation();
                                setJobToClose(job);
                              }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showTemplates} onOpenChange={setShowTemplates}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Choose a Job Template</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="grid grid-cols-2 gap-3 pr-4">
              {JOB_TEMPLATES.map((template) => (
                <JobTemplateCard
                  key={template.id}
                  template={template}
                  onSelect={handleSelectTemplate}
                />
              ))}
            </div>
          </ScrollArea>
          <div className="flex justify-between pt-4 border-t">
            <Button variant="outline" onClick={handleCreateBlank}>
              Create Blank Job
            </Button>
            <Button variant="ghost" onClick={() => setShowTemplates(false)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <CreateJobDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        selectedTemplate={selectedTemplate}
      />

      <JobDetailsSheet
        job={liveSelectedJob}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        onManageEmployees={() => {
          setDetailsOpen(false);
          setEmployeesDialogOpen(true);
        }}
      />

      <JobEmployeesDialog
        job={liveSelectedJob}
        open={employeesDialogOpen}
        onOpenChange={setEmployeesDialogOpen}
      />

      <EndJobPlacementsDialog
        open={jobToClose != null}
        onOpenChange={(o) => {
          if (!o) setJobToClose(null);
        }}
        job={liveJobToClose}
        finalStatus="closed"
      />
    </div>
  );
}
