import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Building2, Loader2, MapPin, MoreHorizontal, Pencil, Plus, Search, Trash2, Briefcase, Eye } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchActiveClients, type ApiActiveClient } from '@/lib/activeClientsApi';
import { ActiveClientFormDialog } from '@/components/recruitment/active-clients/ActiveClientFormDialog';
import { DeleteActiveClientDialog } from '@/components/recruitment/active-clients/DeleteActiveClientDialog';
import { ActiveClientDetailsSheet } from '@/components/recruitment/active-clients/ActiveClientDetailsSheet';
import { useHasPermission } from '@/lib/access';
import { useRecruitmentAgencyId } from '@/hooks/useRecruitmentAgencyId';
import { RecruitmentScopeFilterBar } from '@/components/recruitment/RecruitmentScopeFilterBar';
import { Link } from 'react-router-dom';

/** Quick filter applied by clicking a summary card. */
type ClientCardFilter = 'all' | 'active' | 'with_jobs';

export default function ActiveClients() {
  const canWrite = useHasPermission('jobs:write');
  const { agencyId, ownerIds, ownerExact, scopeKey } = useRecruitmentAgencyId();

  const [searchQuery, setSearchQuery] = useState('');
  const [cardFilter, setCardFilter] = useState<ClientCardFilter>('all');

  const toggleCardFilter = (f: ClientCardFilter) => {
    setCardFilter((prev) => (prev === f ? 'all' : f));
  };
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ApiActiveClient | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState<ApiActiveClient | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [viewing, setViewing] = useState<ApiActiveClient | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['active-clients', agencyId ?? 'scope', scopeKey],
    queryFn: () =>
      fetchActiveClients({
        pageSize: 200,
        agencyIds: agencyId ? [agencyId] : undefined,
        ownerIds,
        ownerExact,
      }),
  });

  const agencyClients = useMemo(() => data?.data ?? [], [data]);

  const filtered = useMemo(() => {
    let rows = agencyClients;
    if (cardFilter === 'active') rows = rows.filter((c) => c.status === 'active');
    if (cardFilter === 'with_jobs') rows = rows.filter((c) => (c.jobCount ?? 0) > 0);
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase();
    return rows.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.location.toLowerCase().includes(q) ||
        c.industry.toLowerCase().includes(q) ||
        c.contactName.toLowerCase().includes(q)
    );
  }, [agencyClients, searchQuery, cardFilter]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (client: ApiActiveClient) => {
    setEditing(client);
    setFormOpen(true);
  };

  const openDelete = (client: ApiActiveClient) => {
    setDeleting(client);
    setDeleteOpen(true);
  };

  const openDetails = (client: ApiActiveClient) => {
    setViewing(client);
    setDetailsOpen(true);
  };

  return (
    <div className="space-y-6 pt-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Active Clients</h1>
          <p className="text-muted-foreground mt-1">
            Recruitment clients for job placements. Separate from Marketing Clients.
          </p>
        </div>
        {canWrite && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Add Active Client
          </Button>
        )}
      </div>

      <RecruitmentScopeFilterBar />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card
          className={`p-4 cursor-pointer transition-colors hover:bg-muted/40 ${
            cardFilter === 'all' ? 'ring-2 ring-primary' : ''
          }`}
          onClick={() => setCardFilter('all')}
        >
          <div className="text-sm text-muted-foreground">Clients</div>
          <div className="text-2xl font-semibold mt-1">{agencyClients.length}</div>
          <p className="text-xs text-muted-foreground mt-1">All clients</p>
        </Card>
        <Card
          className={`p-4 cursor-pointer transition-colors hover:bg-muted/40 ${
            cardFilter === 'active' ? 'ring-2 ring-primary' : ''
          }`}
          onClick={() => toggleCardFilter('active')}
        >
          <div className="text-sm text-muted-foreground">Active</div>
          <div className="text-2xl font-semibold mt-1">
            {agencyClients.filter((c) => c.status === 'active').length}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Status: active</p>
        </Card>
        <Card
          className={`p-4 cursor-pointer transition-colors hover:bg-muted/40 ${
            cardFilter === 'with_jobs' ? 'ring-2 ring-primary' : ''
          }`}
          onClick={() => toggleCardFilter('with_jobs')}
        >
          <div className="text-sm text-muted-foreground">Linked jobs</div>
          <div className="text-2xl font-semibold mt-1">
            {agencyClients.reduce((sum, c) => sum + (c.jobCount ?? 0), 0)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Clients with jobs</p>
        </Card>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search clients…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Industry</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Jobs</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline-block mr-2" />
                  Loading active clients…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  No active clients yet.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((client) => {
                const jobCount = client.jobCount ?? 0;
                return (
                  <TableRow
                    key={client.id}
                    className="cursor-pointer"
                    onClick={() => openDetails(client)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-medium">{client.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm">
                        <MapPin className="h-3 w-3 text-muted-foreground" />
                        {client.location}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{client.industry}</TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div>{client.contactName || '—'}</div>
                        {client.contactEmail && (
                          <div className="text-muted-foreground text-xs">{client.contactEmail}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={client.status === 'active' ? 'default' : 'secondary'}>
                        {client.status === 'active' ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/jobs?clientId=${encodeURIComponent(client.id)}`}
                        className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                        {jobCount}
                      </Link>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openDetails(client)}>
                            <Eye className="h-4 w-4 mr-2" />
                            View details
                          </DropdownMenuItem>
                          {canWrite && (
                            <>
                              <DropdownMenuItem onClick={() => openEdit(client)}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => openDelete(client)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      <ActiveClientFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        client={editing}
      />
      <DeleteActiveClientDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        client={deleting}
      />
      <ActiveClientDetailsSheet
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        client={viewing}
      />
    </div>
  );
}
