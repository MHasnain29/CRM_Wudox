/**
 * Active Client detail: linked jobs and currently placed employees (live API).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Briefcase,
  Loader2,
  MapPin,
  Users,
  Building2,
  Mail,
  Phone,
  Factory,
  StickyNote,
  Plus,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchActiveClient, type ApiActiveClient } from '@/lib/activeClientsApi';
import { ActiveClientJobsSection } from '@/components/recruitment/active-clients/ActiveClientJobsSection';
import { CreateJobDialog } from '@/components/jobs/CreateJobDialog';
import { useHasPermission } from '@/lib/access';

type Props = {
  client: ApiActiveClient | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ActiveClientDetailsSheet({ client, open, onOpenChange }: Props) {
  const canWriteJobs = useHasPermission('jobs:write');
  const [createJobOpen, setCreateJobOpen] = useState(false);
  const { data: detail, isLoading } = useQuery({
    queryKey: ['active-client', client?.id],
    queryFn: () => fetchActiveClient(client!.id),
    enabled: open && Boolean(client?.id),
  });

  if (!client) return null;

  const clientJobs = detail?.jobs ?? [];
  const placed = detail?.placements ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] w-[95vw] max-w-[1400px] flex-col gap-0 overflow-hidden p-0 rounded-xl sm:rounded-xl [&>button]:right-4 [&>button]:top-4 [&>button]:z-50 [&>button]:flex [&>button]:h-8 [&>button]:w-8 [&>button]:items-center [&>button]:justify-center [&>button]:rounded-full [&>button]:border [&>button]:bg-background [&>button]:opacity-100 [&>button]:shadow-sm [&>button]:transition-colors [&>button]:hover:bg-muted">
        <SheetHeader className="px-6 pt-6 pb-5 space-y-4 border-b shrink-0 text-left">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0 space-y-1">
              <SheetTitle className="flex items-center gap-2 text-2xl">
                <Building2 className="h-6 w-6 shrink-0 text-muted-foreground" />
                <span className="truncate">{client.name}</span>
              </SheetTitle>
              <SheetDescription className="flex items-center gap-1.5 text-sm">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                {client.location}
              </SheetDescription>
            </div>
            <Badge
              variant={client.status === 'active' ? 'default' : 'secondary'}
              className="capitalize shrink-0 mt-1"
            >
              {client.status}
            </Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-muted/50 px-3 py-2.5 space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Factory className="h-3 w-3" />
                Industry
              </p>
              <p className="font-medium">{client.industry || '—'}</p>
            </div>
            <div className="rounded-lg bg-muted/50 px-3 py-2.5 space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Primary contact
              </p>
              <p className="font-medium">{client.contactName || '—'}</p>
              <div className="flex flex-col gap-0.5 text-muted-foreground">
                {client.contactEmail ? (
                  <span className="inline-flex items-center gap-1.5 truncate">
                    <Mail className="h-3.5 w-3.5 shrink-0" />
                    {client.contactEmail}
                  </span>
                ) : null}
                {client.contactPhone ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    {client.contactPhone}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {client.notes ? (
            <div className="rounded-lg border bg-background px-3 py-2.5 text-sm space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <StickyNote className="h-3 w-3" />
                Notes
              </p>
              <p className="text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {client.notes}
              </p>
            </div>
          ) : null}
        </SheetHeader>

        <div className="shrink-0 px-6 py-3 border-b flex items-start justify-between gap-3 flex-wrap bg-background">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-muted-foreground" />
              Jobs
              <Badge variant="secondary" className="font-normal">
                {isLoading ? '…' : clientJobs.length}
              </Badge>
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Open roles linked to this client. Click a job for full details.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canWriteJobs && (
              <Button onClick={() => setCreateJobOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                Create Job
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to={`/jobs?clientId=${encodeURIComponent(client.id)}`}>View on Jobs</Link>
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 py-5 space-y-8">
            {isLoading ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2 py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading jobs & placements…
              </p>
            ) : (
              <>
                <ActiveClientJobsSection
                  client={client}
                  jobs={clientJobs}
                  hideHeader
                  createOpen={createJobOpen}
                  onCreateOpenChange={setCreateJobOpen}
                />

                <Separator />

                <div className="space-y-4">
                  <div>
                    <h3 className="text-base font-semibold flex items-center gap-2">
                      <Users className="h-5 w-5 text-muted-foreground" />
                      Placed employees
                      <Badge variant="secondary" className="font-normal">
                        {placed.length}
                      </Badge>
                    </h3>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Employees currently assigned on this client&apos;s jobs.
                    </p>
                  </div>

                  {placed.length === 0 ? (
                    <div className="rounded-lg border border-dashed px-6 py-8 text-center">
                      <p className="text-sm text-muted-foreground">
                        No employees currently assigned.
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {placed.map((p) => (
                        <div
                          key={p.id}
                          className="rounded-lg border bg-card px-4 py-3 space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm">{p.employeeName}</span>
                          </div>
                          {p.positionTitle ? (
                            <p className="text-sm text-muted-foreground">{p.positionTitle}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </ScrollArea>

        <CreateJobDialog
          open={createJobOpen}
          onOpenChange={setCreateJobOpen}
          defaultActiveClient={{
            id: client.id,
            name: client.name,
            location: client.location,
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
