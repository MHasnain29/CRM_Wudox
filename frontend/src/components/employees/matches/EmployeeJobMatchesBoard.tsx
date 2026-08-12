/**
 * Board: open jobs with skill/license-matching Available Master employees.
 * Call / email / link per employee. Loads job pages on scroll.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search, Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  fetchEmployeeJobMatchBoard,
  type MatchingEmployee,
  type MatchingJob,
} from '@/lib/employeeJobMatchesApi';
import { fetchEmployee } from '@/lib/api';
import { useRecruitmentAgencyId } from '@/hooks/useRecruitmentAgencyId';
import { LinkClientJobDialog } from '@/components/employees/LinkClientJobDialog';
import { EmployeeCallInterface } from '@/components/employees/EmployeeCallInterface';
import { EmailComposeDialog } from '@/components/EmailComposeDialog';
import { useCallStore } from '@/lib/callStore';
import type { Employee } from '@/lib/employeeTypes';
import { toast } from 'sonner';
import { EmployeeJobMatchRow } from '@/components/employees/matches/EmployeeJobMatchRow';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 15;

type MatchFilter = 'all' | 'with' | 'without';

function MatchBoardSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl border p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
              <div className="flex gap-1.5">
                <Skeleton className="h-4 w-14" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-12" />
              </div>
            </div>
          </div>
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  );
}

export function EmployeeJobMatchesBoard() {
  const { agencyId, ownerIds, ownerExact, scopeKey } = useRecruitmentAgencyId();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [matchFilter, setMatchFilter] = useState<MatchFilter>('all');
  const [linkEmployee, setLinkEmployee] = useState<Employee | null>(null);
  const [initialClientId, setInitialClientId] = useState<string | undefined>();
  const [initialJobId, setInitialJobId] = useState<string | undefined>();
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [callingEmployee, setCallingEmployee] = useState<Employee | null>(null);
  const [emailingRecipients, setEmailingRecipients] = useState<
    Array<{ email: string; name: string }> | null
  >(null);
  const [isEmailOpen, setIsEmailOpen] = useState(false);
  const { openCallInterface, isCallInterfaceOpen, isMinimized, activeCall } = useCallStore();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    isError,
    error,
  } = useInfiniteQuery({
    queryKey: ['employee-job-matches', agencyId ?? 'scope', debouncedQ, scopeKey],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      fetchEmployeeJobMatchBoard({
        page: pageParam,
        pageSize: PAGE_SIZE,
        q: debouncedQ || undefined,
        agencyIds: agencyId ? [agencyId] : undefined,
        ownerIds,
        ownerExact,
      }),
    getNextPageParam: (last) => {
      const { page, totalPages } = last.pagination;
      return page < totalPages ? page + 1 : undefined;
    },
  });

  const rows = useMemo(() => {
    const all = data?.pages.flatMap((p) => (Array.isArray(p.data) ? p.data : [])) ?? [];
    if (matchFilter === 'with') return all.filter((r) => r.matchCount > 0);
    if (matchFilter === 'without') return all.filter((r) => r.matchCount === 0);
    return all;
  }, [data, matchFilter]);

  const total = data?.pages[0]?.pagination.total ?? 0;
  const loadedCount = data?.pages.reduce((n, p) => n + (p.data?.length ?? 0), 0) ?? 0;
  const withMatchCount = useMemo(
    () =>
      (data?.pages.flatMap((p) => p.data) ?? []).filter((r) => r.matchCount > 0).length,
    [data],
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { root: null, rootMargin: '200px', threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, rows.length]);

  const openLink = async (employee: MatchingEmployee, job: MatchingJob) => {
    setLinkingId(employee.id);
    try {
      const emp = await fetchEmployee(employee.id);
      setLinkEmployee(emp);
      setInitialClientId(job.activeClientId);
      setInitialJobId(job.id);
      setLinkOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load employee');
    } finally {
      setLinkingId(null);
    }
  };

  const handleCall = async (employee: MatchingEmployee) => {
    if (!employee.phone?.trim()) {
      toast.error('No phone on file');
      return;
    }
    try {
      const detail = await fetchEmployee(employee.id);
      if (!detail.phone?.trim()) {
        toast.error('No phone on file');
        return;
      }
      setCallingEmployee(detail);
      openCallInterface();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load employee for call');
    }
  };

  const handleEmail = (employee: MatchingEmployee) => {
    const trimmed = employee.email?.trim();
    if (!trimmed) {
      toast.error('No email on file');
      return;
    }
    const name = `${employee.firstName} ${employee.lastName}`.trim() || trimmed;
    setEmailingRecipients([{ email: trimmed, name }]);
    setIsEmailOpen(true);
  };

  const filters: { id: MatchFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'with', label: 'With matches' },
    { id: 'without', label: 'No matches' },
  ];

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-1 space-y-3 bg-background/95 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search jobs by title, client, or location…"
              className="pl-9"
              aria-label="Search jobs"
            />
          </div>
          {!isLoading && total > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              {loadedCount} of {total} jobs
              {withMatchCount > 0 && (
                <span className="text-foreground/80">
                  · {withMatchCount} with matches loaded
                </span>
              )}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Match filter">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={matchFilter === f.id}
              onClick={() => setMatchFilter(f.id)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                matchFilter === f.id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <MatchBoardSkeleton />
      ) : isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-12 text-center text-sm text-destructive">
          {error instanceof Error ? error.message : 'Failed to load job matches'}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-16 text-center">
          <p className="text-sm font-medium text-foreground">
            {matchFilter !== 'all'
              ? `No jobs ${matchFilter === 'with' ? 'with' : 'without'} matches in the loaded list`
              : `No open jobs found${debouncedQ ? ' for this search' : ''}`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {matchFilter !== 'all' && hasNextPage
              ? 'Scroll to load more, or switch filter to All.'
              : 'Try another search, or check that jobs are open/draft with a linked client.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <EmployeeJobMatchRow
              key={row.job.id}
              row={row}
              busyEmployeeId={linkingId}
              onLink={(emp, job) => void openLink(emp, job)}
              onCall={(emp) => void handleCall(emp)}
              onEmail={handleEmail}
            />
          ))}

          <div ref={sentinelRef} className="h-8 w-full" aria-hidden />

          {isFetchingNextPage && (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading more…
            </div>
          )}

          {!hasNextPage && loadedCount > 0 && (
            <p className="pb-2 text-center text-xs text-muted-foreground">
              All {total} jobs loaded
              {matchFilter !== 'all' ? ` · showing ${rows.length} filtered` : ''}
            </p>
          )}
        </div>
      )}

      <LinkClientJobDialog
        employee={linkEmployee}
        open={linkOpen}
        onOpenChange={(o) => {
          setLinkOpen(o);
          if (!o) {
            setLinkEmployee(null);
            setInitialClientId(undefined);
            setInitialJobId(undefined);
          }
        }}
        initialClientId={initialClientId}
        initialJobId={initialJobId}
        onChanged={() => {
          void queryClient.invalidateQueries({ queryKey: ['employee-job-matches'] });
          void queryClient.invalidateQueries({ queryKey: ['employees'] });
          void queryClient.invalidateQueries({ queryKey: ['jobs'] });
        }}
      />

      {(callingEmployee || activeCall?.employee) && isCallInterfaceOpen && !isMinimized && (
        <EmployeeCallInterface
          employee={callingEmployee ?? (activeCall!.employee as Employee)}
          subCompanyId={agencyId ?? undefined}
          open={isCallInterfaceOpen && !isMinimized}
          onOpenChange={(next) => {
            if (!next) {
              if (!activeCall || activeCall.status === 'ended') {
                setCallingEmployee(null);
              }
            }
          }}
        />
      )}

      <EmailComposeDialog
        open={isEmailOpen}
        onOpenChange={(o) => {
          setIsEmailOpen(o);
          if (!o) setEmailingRecipients(null);
        }}
        fixedRecipients={emailingRecipients}
        selectedAgencyId={agencyId ?? undefined}
      />
    </div>
  );
}
