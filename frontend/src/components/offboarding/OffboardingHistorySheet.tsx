import { useQuery } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { fetchOffboardingHistory, type OffboardingHistoryCounts, type OffboardingHistoryEntry } from '@/lib/api';
import { format } from 'date-fns';
import { Loader2, LogOut } from 'lucide-react';

interface Props {
  userId: string;
  userName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const COUNT_LABELS: { key: keyof OffboardingHistoryCounts; label: string }[] = [
  { key: 'emailCount', label: 'Emails' },
  { key: 'clientCount', label: 'Clients' },
  { key: 'pipelineCount', label: 'Pipeline' },
  { key: 'leadCount', label: 'Leads' },
  { key: 'taskCount', label: 'Tasks' },
  { key: 'meetingCount', label: 'Meetings' },
  { key: 'followUpCount', label: 'Follow-ups' },
];

function total(c: OffboardingHistoryCounts) {
  return c.emailCount + c.clientCount + c.pipelineCount + c.leadCount + c.taskCount + c.meetingCount + c.followUpCount;
}

function CountRows({ counts }: { counts: OffboardingHistoryCounts }) {
  const rows = COUNT_LABELS.filter((l) => counts[l.key] > 0);
  return (
    <div className="space-y-1.5">
      {rows.map(({ key, label }) => (
        <div key={key} className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="text-sm tabular-nums">{counts[key]}</span>
        </div>
      ))}
    </div>
  );
}

function DepartedEntry({ entry, userName }: { entry: OffboardingHistoryEntry; userName: string }) {
  const t = total(entry.totalCounts);
  const firstName = userName.split(' ')[0];
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 bg-muted/30 border-b border-border">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold">{format(new Date(entry.committedAt), 'MMM d, yyyy')}</p>
            <p className="text-xs text-muted-foreground">
              {firstName} left and their data was reassigned to colleagues
            </p>
            <p className="text-xs text-muted-foreground">
              Processed by {entry.admin.firstName} {entry.admin.lastName}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-semibold tabular-nums">{t}</p>
            <p className="text-xs text-muted-foreground">items reassigned</p>
          </div>
        </div>
      </div>

      {entry.recipients && entry.recipients.length > 0 && (
        <div className="divide-y divide-border">
          {entry.recipients.map((r) => (
            <div key={r.userId} className="px-4 py-3">
              <p className="text-sm font-medium mb-0.5">{r.firstName} {r.lastName}</p>
              <p className="text-xs text-muted-foreground mb-2.5">took over the following from {firstName}</p>
              <CountRows counts={r} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReceivedEntry({ entry, userName }: { entry: OffboardingHistoryEntry; userName: string }) {
  const counts = entry.myReceivedCounts!;
  const t = total(counts);
  const firstName = userName.split(' ')[0];
  const fromName = `${entry.departingUser.firstName} ${entry.departingUser.lastName}`;
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 bg-muted/30 border-b border-border">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold">{format(new Date(entry.committedAt), 'MMM d, yyyy')}</p>
            <p className="text-xs text-muted-foreground">
              {firstName} received data from <span className="text-foreground font-medium">{fromName}</span> who left
            </p>
            <p className="text-xs text-muted-foreground">
              Processed by {entry.admin.firstName} {entry.admin.lastName}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-semibold tabular-nums">{t}</p>
            <p className="text-xs text-muted-foreground">items received</p>
          </div>
        </div>
      </div>

      <div className="px-4 py-3">
        <p className="text-xs text-muted-foreground mb-2.5">
          The following were transferred to {firstName}
        </p>
        <CountRows counts={counts} />
      </div>
    </div>
  );
}

export function OffboardingHistorySheet({ userId, userName, open, onOpenChange }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['offboarding-history', userId],
    queryFn: () => fetchOffboardingHistory(userId),
    enabled: open,
    staleTime: 30_000,
  });

  const hasDeparted = (data?.departed?.length ?? 0) > 0;
  const hasReceived = (data?.received?.length ?? 0) > 0;
  const hasAny = hasDeparted || hasReceived;
  const firstName = userName.split(' ')[0];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[460px] overflow-y-auto">
        <SheetHeader className="pb-5">
          <SheetTitle className="flex items-center gap-2">
            <LogOut className="h-4 w-4 text-muted-foreground" />
            Offboarding History
          </SheetTitle>
          <SheetDescription>{userName}</SheetDescription>
        </SheetHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            Failed to load offboarding history.
          </div>
        )}

        {!isLoading && !error && !hasAny && (
          <div className="text-center py-16 text-muted-foreground">
            <LogOut className="h-8 w-8 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">No offboarding records</p>
            <p className="text-xs mt-1 opacity-60">No data has been transferred for this user.</p>
          </div>
        )}

        {!isLoading && hasAny && (
          <div className="space-y-8">
            {hasDeparted && (
              <section className="space-y-3">
                <p className="text-xs text-muted-foreground">When {firstName} left the company</p>
                {data!.departed.map((entry) => (
                  <DepartedEntry key={entry.id} entry={entry} userName={userName} />
                ))}
              </section>
            )}

            {hasReceived && (
              <section className="space-y-3">
                <p className="text-xs text-muted-foreground">Data {firstName} received from departing colleagues</p>
                {data!.received.map((entry) => (
                  <ReceivedEntry key={entry.id} entry={entry} userName={userName} />
                ))}
              </section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
