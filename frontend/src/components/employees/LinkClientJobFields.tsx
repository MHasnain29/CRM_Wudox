/**
 * Active Client + Job pickers for Link to Client (recruitment).
 * Lists all active clients in Matched Skills / Others; jobs for the selected client
 * include skill matches first, then remaining open/draft jobs.
 */
import { Label } from '@/components/ui/label';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import { JobCodeBadge } from '@/components/jobs/JobCodeBadge';
import { LinkClientTrainingPreview } from '@/components/employees/LinkClientTrainingPreview';
import { useQuery } from '@tanstack/react-query';
import { fetchActiveClients } from '@/lib/activeClientsApi';
import { fetchMatchingJobsForEmployee } from '@/lib/employeeJobMatchesApi';
import { fetchJobs } from '@/lib/jobsApi';
import { jobSearchValue, jobSelectLabel } from '@/lib/jobSearch';
import { useEffect, useMemo } from 'react';

type ClientOption = {
  id: string;
  name: string;
  clientTraining?: boolean;
  hasTrainingDocument?: boolean;
  trainingFileName?: string | null;
};

type JobOption = {
  id: string;
  title: string;
  status: string;
  jobCode?: string | null;
};

type Props = {
  employeeId: string;
  clientId: string;
  jobId: string;
  onClientChange: (clientId: string) => void;
  onJobChange: (jobId: string) => void;
  agencyId?: string | null;
  disabled?: boolean;
  /** Prefill from Job Matches board (applied once when options load). */
  initialClientId?: string;
  initialJobId?: string;
};

function toComboboxOption(c: ClientOption) {
  return { value: c.id, label: c.name, searchValue: c.name };
}

function toJobComboboxOption(j: JobOption) {
  return {
    value: j.id,
    label: jobSelectLabel(j),
    searchValue: jobSearchValue(j),
    renderOption: (
      <span className="flex min-w-0 items-center gap-1.5">
        <JobCodeBadge code={j.jobCode} />
        <span className="truncate">{j.title}</span>
        <span className="shrink-0 text-muted-foreground">· {j.status}</span>
      </span>
    ),
  };
}

export function LinkClientJobFields({
  employeeId,
  clientId,
  jobId,
  onClientChange,
  onJobChange,
  agencyId,
  disabled,
  initialClientId,
  initialJobId,
}: Props) {
  const agencyIds = agencyId ? [agencyId] : undefined;

  const { data: clientsResult, isLoading: clientsLoading } = useQuery({
    queryKey: ['active-clients', 'link-picker', agencyId ?? 'scope'],
    queryFn: () =>
      fetchActiveClients({
        status: 'active',
        pageSize: 200,
        agencyIds,
      }),
    enabled: Boolean(employeeId),
  });

  const { data: matchingJobs = [], isLoading: matchesLoading } = useQuery({
    queryKey: ['employee-matching-jobs', employeeId, agencyId ?? 'scope'],
    queryFn: () =>
      fetchMatchingJobsForEmployee(employeeId, {
        status: ['open', 'draft'],
        agencyIds,
      }),
    enabled: Boolean(employeeId),
  });

  const { data: clientJobsResult, isLoading: clientJobsLoading } = useQuery({
    queryKey: ['jobs', 'link-picker', clientId, agencyId ?? 'scope'],
    queryFn: () =>
      fetchJobs({
        activeClientId: clientId,
        status: ['open', 'draft'],
        pageSize: 200,
        agencyIds,
      }),
    enabled: Boolean(clientId),
  });

  const allClients = useMemo((): ClientOption[] => {
    const fromApi = (clientsResult?.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      clientTraining: c.clientTraining,
      hasTrainingDocument: c.hasTrainingDocument,
      trainingFileName: c.trainingFileName,
    }));
    // Keep training flags from matching jobs if list API is thin / stale
    const byId = new Map(fromApi.map((c) => [c.id, c]));
    for (const j of matchingJobs) {
      const id = j.activeClientId;
      if (!id) continue;
      const fromMatch = {
        id,
        name: j.activeClient?.name ?? j.activeClientName ?? j.company,
        clientTraining: j.activeClient?.clientTraining,
        hasTrainingDocument: j.activeClient?.hasTrainingDocument,
        trainingFileName: j.activeClient?.trainingFileName,
      };
      const existing = byId.get(id);
      if (!existing) {
        byId.set(id, fromMatch);
      } else if (fromMatch.clientTraining && !existing.clientTraining) {
        byId.set(id, { ...existing, ...fromMatch, name: existing.name });
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [clientsResult?.data, matchingJobs]);

  const matchedClientIds = useMemo(() => {
    const ids = new Set<string>();
    for (const j of matchingJobs) {
      if (j.activeClientId) ids.add(j.activeClientId);
    }
    return ids;
  }, [matchingJobs]);

  const matchedClients = useMemo(
    () => allClients.filter((c) => matchedClientIds.has(c.id)),
    [allClients, matchedClientIds],
  );

  const otherClients = useMemo(
    () => allClients.filter((c) => !matchedClientIds.has(c.id)),
    [allClients, matchedClientIds],
  );

  const selectedClient = useMemo(
    () => allClients.find((c) => c.id === clientId) ?? null,
    [allClients, clientId],
  );

  const matchingJobIdsForClient = useMemo(() => {
    if (!clientId) return new Set<string>();
    return new Set(
      matchingJobs.filter((j) => j.activeClientId === clientId).map((j) => j.id),
    );
  }, [matchingJobs, clientId]);

  const matchedJobOptions = useMemo((): JobOption[] => {
    if (!clientId) return [];
    return matchingJobs
      .filter((j) => j.activeClientId === clientId)
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((j) => ({
        id: j.id,
        title: j.title,
        status: j.status,
        jobCode: j.jobCode,
      }));
  }, [matchingJobs, clientId]);

  const otherJobOptions = useMemo((): JobOption[] => {
    if (!clientId) return [];
    const rows = clientJobsResult?.data ?? [];
    return rows
      .filter((j) => !matchingJobIdsForClient.has(j.id))
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((j) => ({
        id: j.id,
        title: j.title,
        status: j.status,
        jobCode: j.jobCode,
      }));
  }, [clientJobsResult?.data, clientId, matchingJobIdsForClient]);

  const allJobOptions = useMemo(
    () => [...matchedJobOptions, ...otherJobOptions],
    [matchedJobOptions, otherJobOptions],
  );

  const clientGroups = useMemo(
    () =>
      [
        {
          heading: 'Matched Skills',
          options: matchedClients.map(toComboboxOption),
        },
        {
          heading: 'Others',
          options: otherClients.map(toComboboxOption),
        },
      ].filter((g) => g.options.length > 0),
    [matchedClients, otherClients],
  );

  const jobGroups = useMemo(
    () =>
      [
        {
          heading: 'Matched Skills',
          options: matchedJobOptions.map(toJobComboboxOption),
        },
        {
          heading: 'Others',
          options: otherJobOptions.map(toJobComboboxOption),
        },
      ].filter((g) => g.options.length > 0),
    [matchedJobOptions, otherJobOptions],
  );

  // Apply board prefill once options are available
  useEffect(() => {
    if (!initialClientId || clientId) return;
    if (!allClients.some((c) => c.id === initialClientId)) return;
    onClientChange(initialClientId);
  }, [initialClientId, clientId, allClients, onClientChange]);

  useEffect(() => {
    if (!initialJobId || jobId || !clientId) return;
    if (!allJobOptions.some((j) => j.id === initialJobId)) return;
    onJobChange(initialJobId);
  }, [initialJobId, jobId, clientId, allJobOptions, onJobChange]);

  const isLoading = clientsLoading || matchesLoading;
  const jobsLoading = Boolean(clientId) && (matchesLoading || clientJobsLoading);
  const noClients = !isLoading && allClients.length === 0;

  const clientPlaceholder = isLoading
    ? 'Loading clients…'
    : noClients
      ? 'No active clients'
      : 'Select active client';

  const jobPlaceholder = !clientId
    ? 'Select a client first'
    : jobsLoading
      ? 'Loading jobs…'
      : allJobOptions.length === 0
        ? 'No open jobs for this client'
        : 'Select job';

  return (
    <div className="space-y-3">
      {noClients && (
        <p className="text-xs text-muted-foreground rounded-md border border-dashed px-3 py-2">
          No active clients available. Add an Active Client first.
        </p>
      )}
      <div className="space-y-1.5">
        <Label className="text-xs">
          Active Client <span className="text-destructive">*</span>
        </Label>
        <SearchableCombobox
          value={clientId}
          onValueChange={(v) => {
            onClientChange(v);
            onJobChange('');
          }}
          groups={clientGroups}
          placeholder={clientPlaceholder}
          searchPlaceholder="Search clients…"
          emptyMessage="No client found."
          disabled={disabled || noClients}
          loading={isLoading}
          loadingLabel="Loading clients…"
        />
      </div>
      {selectedClient?.clientTraining ? (
        <LinkClientTrainingPreview
          activeClientId={selectedClient.id}
          clientName={selectedClient.name}
          training={{
            clientTraining: true,
            hasTrainingDocument: selectedClient.hasTrainingDocument,
            trainingFileName: selectedClient.trainingFileName,
          }}
        />
      ) : null}
      <div className="space-y-1.5">
        <Label className="text-xs">
          Job <span className="text-destructive">*</span>
        </Label>
        <SearchableCombobox
          value={jobId}
          onValueChange={onJobChange}
          groups={jobGroups}
          placeholder={jobPlaceholder}
          searchPlaceholder="Search by job ID or name…"
          emptyMessage="No job found."
          disabled={disabled || !clientId || noClients}
          loading={jobsLoading}
          loadingLabel="Loading jobs…"
        />
        {clientId && allJobOptions.length === 0 && !jobsLoading && (
          <p className="text-xs text-muted-foreground">
            No open or draft jobs for this client.
          </p>
        )}
      </div>
    </div>
  );
}
