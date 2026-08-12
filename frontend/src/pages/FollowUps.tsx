import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Calendar, AlertCircle, Building2, MapPin, Mail, Phone, Loader2, User, TrendingUp } from 'lucide-react';
import { useClientPagination, SectionPaginationBar } from '@/components/SectionPagination';
import { useStore } from '@/lib/store';
import { format, isBefore, isToday, isThisWeek } from 'date-fns';
import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FollowUpDetailDialog } from '@/components/FollowUpDetailDialog';
import { FollowUpDoneDialog } from '@/components/FollowUpDoneDialog';
import { FollowUpRescheduleDialog } from '@/components/FollowUpRescheduleDialog';
import { FollowUp } from '@/lib/types';
import { fetchFollowUps, mapApiFollowUpToFollowUp, updateFollowUpApi, addFollowUpCommentApi, fetchUsers, type ApiUser } from '@/lib/api';
import { TabChipText, TabChipUser } from '@/components/TabChip';
import { getUserRoleTitle } from '@/lib/roleLabels';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { UserMultiSelect } from '@/components/UserMultiSelect';
import { ScopeFilterBar } from '@/components/ScopeFilterBar';
import { PersonCardIdentity } from '@/components/PersonSectionHeader';
import { StickyHeader } from '@/components/StickyHeader';
import { ForwardedChip } from '@/components/offboarding/ForwardedChip';
import { useSearchParams } from 'react-router-dom';
import { useScopeFilter } from '@/hooks/useElevatedScopeFilter';
import { useScopeQueryParams } from '@/hooks/useScopeQueryParams';
import { useCanViewTeamScope } from '@/lib/access';

// ─── Palette: one colour per agency section (cycles) ────────────────────────
const AGENCY_PALETTE = [
  { bg: 'bg-blue-500/10',    border: 'border-blue-500/20',    text: 'text-blue-600',    accent: 'bg-blue-500'    },
  { bg: 'bg-purple-500/10',  border: 'border-purple-500/20',  text: 'text-purple-600',  accent: 'bg-purple-500'  },
  { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-600', accent: 'bg-emerald-500' },
  { bg: 'bg-orange-500/10',  border: 'border-orange-500/20',  text: 'text-orange-600',  accent: 'bg-orange-500'  },
  { bg: 'bg-cyan-500/10',    border: 'border-cyan-500/20',    text: 'text-cyan-600',    accent: 'bg-cyan-500'    },
  { bg: 'bg-rose-500/10',    border: 'border-rose-500/20',    text: 'text-rose-600',    accent: 'bg-rose-500'    },
];

function PaginatedFollowUpGroup({
  title,
  items,
  variant,
  agencyId,
  renderCard,
}: {
  title: string;
  items: FollowUp[];
  variant: 'destructive' | 'default' | 'secondary';
  agencyId: string;
  renderCard: (followUp: FollowUp) => ReactNode;
}) {
  const {
    pageRows,
    startIndex,
    total,
    totalPages,
    page,
    setPage,
    pageSize,
    showPagination,
  } = useClientPagination(items, [agencyId, title]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {variant === 'destructive' && <AlertCircle className="h-4 w-4 text-destructive" />}
        {variant === 'default' && <Calendar className="h-4 w-4 text-primary" />}
        <h4 className="font-medium text-sm">{title}</h4>
        <Badge variant={variant} className="text-xs">{items.length}</Badge>
      </div>
      {items.length === 0 ? (
        <div className="text-center py-4 text-sm text-muted-foreground">No follow-ups</div>
      ) : (
        <>
          <div className="space-y-3">{pageRows.map(renderCard)}</div>
          {showPagination && (
            <SectionPaginationBar
              total={total}
              startIndex={startIndex}
              pageLen={pageRows.length}
              totalPages={totalPages}
              page={page}
              onPageChange={setPage}
              pageSize={pageSize}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Per-agency follow-up section (full view, rendered for each agency in "All" view) ─
function AgencyFollowUpsSection({
  agency,
  onViewAgency,
  ownerIds,
  scopeKey,
}: {
  agency: { id: string; name: string };
  onViewAgency: () => void;
  ownerIds?: string[];
  scopeKey: string;
}) {
  const { clients } = useStore();
  const [selectedFollowUp, setSelectedFollowUp] = useState<FollowUp | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [doneDialogOpen, setDoneDialogOpen] = useState(false);
  const [rescheduleDialogOpen, setRescheduleDialogOpen] = useState(false);

  const { data: agencyUsersData, isLoading: agencyUsersLoading } = useQuery({
    queryKey: ['agency-users-followups', agency.id],
    queryFn: () => fetchUsers({ subCompanyId: agency.id }),
    staleTime: 5 * 60 * 1000,
  });

  const agencyUserIdSet = useMemo(
    () => new Set((agencyUsersData ?? []).filter(u => u.isActive).map(u => u.id)),
    [agencyUsersData],
  );

  // When specific users are requested, only fetch if at least one belongs to this agency.
  // Wait for agencyUsersData to load before deciding — avoids premature empty result.
  const ownerIdsForAgency = useMemo(() => {
    if (!ownerIds) return undefined; // no filter → fetch all for this agency
    if (!agencyUsersData) return undefined; // still loading, defer decision
    const intersection = ownerIds.filter(id => agencyUserIdSet.has(id));
    return intersection;
  }, [ownerIds, agencyUsersData, agencyUserIdSet]);

  // Skip the follow-ups fetch when we know the selected user(s) don't belong here
  const canFetchFollowUps = !ownerIds || !agencyUsersData || (ownerIdsForAgency?.length ?? 0) > 0;

  const { data: fuData, isLoading: fuLoading, refetch } = useQuery({
    queryKey: ['agency-followups-full', agency.id, scopeKey],
    queryFn: () => fetchFollowUps({
      agencyIds: [agency.id],
      ownerIds: ownerIdsForAgency !== undefined ? ownerIdsForAgency : ownerIds,
      limit: 500,
    }),
    staleTime: 0,
    enabled: canFetchFollowUps,
  });

  const isLoading = agencyUsersLoading || (canFetchFollowUps && fuLoading);

  const allFUs = useMemo(
    () => (fuData?.data ?? [])
      .map(mapApiFollowUpToFollowUp)
      .filter(fu => {
        // Must be an active user in this agency
        if (agencyUserIdSet.size > 0 && !agencyUserIdSet.has(fu.ownerId)) return false;
        // Must match the explicitly requested owner scope — prevents subordinate data leaking in
        if (ownerIds && ownerIds.length > 0 && !ownerIds.includes(fu.ownerId)) return false;
        return true;
      }),
    [fuData, agencyUserIdSet, ownerIds],
  );
  const pendingFUs = allFUs.filter(f => !f.completed);

  const overdueItems  = pendingFUs.filter(f => isBefore(new Date(f.dueDate), new Date()));
  const todayItems    = pendingFUs.filter(f => isToday(new Date(f.dueDate)));
  const thisWeekItems = pendingFUs.filter(f => isThisWeek(new Date(f.dueDate)) && !isToday(new Date(f.dueDate)));
  const laterItems    = pendingFUs.filter(f => !isThisWeek(new Date(f.dueDate)));

  const getClient  = (id: string) => clients.find(c => c.id === id);
  const getContact = (clientId: string, contactId?: string) => {
    if (!contactId) return null;
    return clients.find(c => c.id === clientId)?.contacts.find(ct => ct.id === contactId) ?? null;
  };

  const renderCard = (followUp: FollowUp) => {
    const client = getClient(followUp.clientId);
    const contact = getContact(followUp.clientId, followUp.contactId);
    const lastComment = followUp.comments.length > 0 ? followUp.comments[followUp.comments.length - 1] : null;
    return (
      <div
        key={followUp.id}
        className="flex items-start justify-between p-4 rounded-lg border border-border bg-card hover:shadow-md transition-shadow cursor-pointer"
        onClick={() => { setSelectedFollowUp(followUp); setDetailDialogOpen(true); }}
      >
        <div className="flex-1 space-y-3">
          <div>
            <div className="font-semibold text-lg">{followUp.clientName ?? client?.name ?? 'Unknown client'}</div>
            {followUp.forwardedFromName && <ForwardedChip name={followUp.forwardedFromName} />}
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              {client && (
                <>
                  <div className="flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5" />
                    <span>{client.industry}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    <span>{client.location}</span>
                  </div>
                </>
              )}
            </div>
          </div>
          {contact && (
            <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
              <div className="font-medium text-sm">Contact Person</div>
              <div className="text-sm">{contact.name}{contact.isPrimary && <Badge variant="secondary" className="ml-2 text-xs">Primary</Badge>}</div>
              {contact.email && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Mail className="h-3 w-3" /><span>{contact.email}</span>
                </div>
              )}
              {(contact.phone || contact.phoneExtension) && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Phone className="h-3 w-3" />
                  <span>
                    {contact.phone}
                    {contact.phoneExtension?.trim() && <span className="ml-1">ext. {contact.phoneExtension.trim()}</span>}
                  </span>
                </div>
              )}
            </div>
          )}
          {lastComment && (
            <div className="bg-accent/50 rounded-md p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Last Update</span>
                <span className="text-xs text-muted-foreground">{format(new Date(lastComment.createdAt), 'MMM d, h:mm a')}</span>
              </div>
              <p className="text-sm">{lastComment.content}</p>
              <span className="text-xs text-muted-foreground">- {lastComment.userName}</span>
            </div>
          )}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              <span>Due: {format(new Date(followUp.dueDate), 'MMM d, yyyy h:mm a')}</span>
            </div>
            <div>Owner: {followUp.ownerName}</div>
          </div>
        </div>
        <div className="flex gap-2 ml-4 flex-shrink-0">
          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setSelectedFollowUp(followUp); setDoneDialogOpen(true); }}>
            <CheckCircle2 className="h-4 w-4 mr-1" />Done
          </Button>
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setSelectedFollowUp(followUp); setRescheduleDialogOpen(true); }}>
            Reschedule
          </Button>
        </div>
      </div>
    );
  };

  const renderGroup = (title: string, items: FollowUp[], variant: 'destructive' | 'default' | 'secondary') => (
    <PaginatedFollowUpGroup
      key={title}
      title={title}
      items={items}
      variant={variant}
      agencyId={agency.id}
      renderCard={renderCard}
    />
  );

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">{agency.name}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {pendingFUs.length} pending · {allFUs.filter(f => f.completed).length} done
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={onViewAgency}>View Agency</Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-6">
              {overdueItems.length > 0 && renderGroup('Overdue', overdueItems, 'destructive')}
              {renderGroup('Today', todayItems, 'default')}
              {thisWeekItems.length > 0 && renderGroup('This Week', thisWeekItems, 'secondary')}
              {laterItems.length > 0 && renderGroup('Later', laterItems, 'secondary')}
              {pendingFUs.length === 0 && (
                <div className="text-center py-16 text-muted-foreground">No pending follow-ups</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      <FollowUpDetailDialog
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
        followUp={selectedFollowUp}
      />
      <FollowUpDoneDialog
        open={doneDialogOpen}
        onOpenChange={setDoneDialogOpen}
        followUpId={selectedFollowUp?.id || ''}
        clientName={selectedFollowUp ? (selectedFollowUp.clientName ?? clients.find(c => c.id === selectedFollowUp.clientId)?.name ?? '') : ''}
        onSuccess={() => refetch()}
      />
      <FollowUpRescheduleDialog
        open={rescheduleDialogOpen}
        onOpenChange={setRescheduleDialogOpen}
        followUpId={selectedFollowUp?.id || ''}
        clientName={selectedFollowUp ? (selectedFollowUp.clientName ?? clients.find(c => c.id === selectedFollowUp.clientId)?.name ?? '') : ''}
        currentDate={selectedFollowUp?.dueDate || new Date()}
        onSuccess={() => refetch()}
      />
    </>
  );
}

// ─── Per-user follow-up section card (manager "All Team" view) ───────────────
function UserFollowUpsSection({
  user,
  colorIndex,
  onViewFollowUps,
}: {
  user: ApiUser;
  colorIndex: number;
  onViewFollowUps: () => void;
}) {
  const PAGE_SIZE = 10;
  const color = AGENCY_PALETTE[colorIndex % AGENCY_PALETTE.length];
  const fullName = `${user.firstName} ${user.lastName}`.trim();
  const initials = fullName.split(' ').map(w => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase();
  const [page, setPage] = useState(1);

  const { data: fuData, isLoading } = useQuery({
    queryKey: ['user-followups-section', user.id],
    queryFn: () => fetchFollowUps({ ownerIds: [user.id], limit: 500 }),
    staleTime: 0,
    retry: false,
  });

  const userFUs = useMemo(() =>
    (fuData?.data ?? []).map(mapApiFollowUpToFollowUp).filter(f => f.ownerId === user.id),
    [fuData, user.id]
  );
  const pendingCount = userFUs.filter(f => !f.completed).length;
  const overdueCount = userFUs.filter(f => !f.completed && isBefore(new Date(f.dueDate), new Date())).length;
  const todayCount   = userFUs.filter(f => !f.completed && isToday(new Date(f.dueDate))).length;
  const doneCount    = userFUs.filter(f => f.completed).length;

  useEffect(() => {
    setPage(1);
  }, [user.id]);

  const totalPages = Math.max(1, Math.ceil(userFUs.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const pageRows = userFUs.slice(startIndex, startIndex + PAGE_SIZE);

  return (
    <Card className={cn('border overflow-hidden', color.border)}>
      <div className={cn('flex items-center justify-between px-5 py-4', color.bg)}>
        <PersonCardIdentity
          user={user}
          roleTitle={getUserRoleTitle(user)}
          subtitle={`${userFUs.length} follow-up${userFUs.length !== 1 ? 's' : ''}`}
          accentClassName={color.accent}
        />
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 text-xs">
            <span className={cn('px-2 py-1 rounded-full font-medium border', color.bg, color.text, color.border)}>{pendingCount} pending</span>
            {overdueCount > 0 && <span className="px-2 py-1 rounded-full font-medium bg-red-500/10 text-red-600 border border-red-500/20">{overdueCount} overdue</span>}
            {todayCount > 0 && <span className="px-2 py-1 rounded-full font-medium bg-orange-500/10 text-orange-600 border border-orange-500/20">{todayCount} today</span>}
            <span className="px-2 py-1 rounded-full font-medium bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">{doneCount} done</span>
          </div>
          <Button size="sm" variant="outline" className={cn('gap-1.5 text-xs shrink-0', color.border)} onClick={onViewFollowUps}>
            View Follow-Ups <TrendingUp className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <CardContent className="pt-4 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading follow-ups...</span>
          </div>
        ) : userFUs.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-6">No follow-ups assigned</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Pending', count: pendingCount, cls: `${color.bg} ${color.text} ${color.border}` },
                { label: 'Overdue', count: overdueCount, cls: 'bg-red-500/10 text-red-600 border-red-500/20' },
                { label: 'Today',   count: todayCount,   cls: 'bg-orange-500/10 text-orange-600 border-orange-500/20' },
                { label: 'Done',    count: doneCount,    cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
              ].map(s => (
                <div key={s.label} className={cn('flex items-center gap-1.5 rounded-lg px-3 py-2 min-w-[80px] border', s.cls)}>
                  <div>
                    <p className="text-xs font-bold leading-tight">{s.count}</p>
                    <p className="text-[10px] leading-tight">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {pageRows.map((fu) => {
                const overdue = !fu.completed && isBefore(new Date(fu.dueDate), new Date());
                return (
                  <div key={fu.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{fu.clientName ?? 'Unknown client'}</p>
                      <p className="text-xs text-muted-foreground">
                        Due {format(new Date(fu.dueDate), 'MMM d, yyyy h:mm a')}
                      </p>
                    </div>
                    <Badge variant={fu.completed ? 'secondary' : overdue ? 'destructive' : 'outline'} className="shrink-0 text-xs">
                      {fu.completed ? 'Done' : overdue ? 'Overdue' : 'Pending'}
                    </Badge>
                  </div>
                );
              })}
            </div>
            {userFUs.length > PAGE_SIZE && (
              <div className="flex items-center justify-between pt-3 mt-2 border-t">
                <div className="text-sm text-muted-foreground">
                  Showing {startIndex + 1} to {Math.min(startIndex + pageRows.length, userFUs.length)} of {userFUs.length}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage === 1}
                  >
                    Previous
                  </Button>
                  <div className="flex items-center gap-1">
                    {(() => {
                      const maxButtons = 7;
                      const start =
                        totalPages <= maxButtons
                          ? 1
                          : Math.min(Math.max(1, safePage - 3), totalPages - maxButtons + 1);
                      const end = Math.min(start + maxButtons - 1, totalPages);
                      return Array.from({ length: end - start + 1 }, (_, i) => start + i).map((p) => (
                        <Button
                          key={p}
                          variant={safePage === p ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setPage(p)}
                          className="min-w-[36px]"
                        >
                          {p}
                        </Button>
                      ));
                    })()}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage === totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Combined All-Team follow-ups (manager "All Team" view) ─────────────────
function TeamFollowUpsSection({ teamUsers }: { teamUsers: ApiUser[] }) {
  const { clients } = useStore();
  const [selectedFollowUp, setSelectedFollowUp] = useState<FollowUp | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [doneDialogOpen, setDoneDialogOpen] = useState(false);
  const [rescheduleDialogOpen, setRescheduleDialogOpen] = useState(false);

  const ownerIds = useMemo(() => teamUsers.map(u => u.id), [teamUsers]);

  const { data: fuData, isLoading, refetch } = useQuery({
    queryKey: ['team-followups-full', ownerIds.join(',')],
    queryFn: () => fetchFollowUps({ ownerIds, limit: 500 }),
    staleTime: 0,
    enabled: ownerIds.length > 0,
  });

  const allFUs = useMemo(() => (fuData?.data ?? []).map(mapApiFollowUpToFollowUp), [fuData]);
  const pendingFUs = allFUs.filter(f => !f.completed);

  const overdueItems  = pendingFUs.filter(f => isBefore(new Date(f.dueDate), new Date()));
  const todayItems    = pendingFUs.filter(f => isToday(new Date(f.dueDate)));
  const thisWeekItems = pendingFUs.filter(f => isThisWeek(new Date(f.dueDate)) && !isToday(new Date(f.dueDate)));
  const laterItems    = pendingFUs.filter(f => !isThisWeek(new Date(f.dueDate)));

  const getClient  = (id: string) => clients.find(c => c.id === id);
  const getContact = (clientId: string, contactId?: string) => {
    if (!contactId) return null;
    return clients.find(c => c.id === clientId)?.contacts.find(ct => ct.id === contactId) ?? null;
  };

  const renderCard = (followUp: FollowUp) => {
    const client = getClient(followUp.clientId);
    const contact = getContact(followUp.clientId, followUp.contactId);
    const lastComment = followUp.comments.length > 0 ? followUp.comments[followUp.comments.length - 1] : null;
    return (
      <div
        key={followUp.id}
        className="flex items-start justify-between p-4 rounded-lg border border-border bg-card hover:shadow-md transition-shadow cursor-pointer"
        onClick={() => { setSelectedFollowUp(followUp); setDetailDialogOpen(true); }}
      >
        <div className="flex-1 space-y-3">
          <div>
            <div className="font-semibold text-lg">{followUp.clientName ?? client?.name ?? 'Unknown client'}</div>
            {followUp.forwardedFromName && <ForwardedChip name={followUp.forwardedFromName} />}
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              {client && (
                <>
                  <div className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /><span>{client.industry}</span></div>
                  <div className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /><span>{client.location}</span></div>
                </>
              )}
            </div>
          </div>
          {contact && (
            <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
              <div className="font-medium text-sm">Contact Person</div>
              <div className="text-sm">{contact.name}{contact.isPrimary && <Badge variant="secondary" className="ml-2 text-xs">Primary</Badge>}</div>
              {contact.email && <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Mail className="h-3 w-3" /><span>{contact.email}</span></div>}
              {(contact.phone || contact.phoneExtension) && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Phone className="h-3 w-3" />
                  <span>{contact.phone}{contact.phoneExtension?.trim() && <span className="ml-1">ext. {contact.phoneExtension.trim()}</span>}</span>
                </div>
              )}
            </div>
          )}
          {lastComment && (
            <div className="bg-accent/50 rounded-md p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Last Update</span>
                <span className="text-xs text-muted-foreground">{format(new Date(lastComment.createdAt), 'MMM d, h:mm a')}</span>
              </div>
              <p className="text-sm">{lastComment.content}</p>
              <span className="text-xs text-muted-foreground">- {lastComment.userName}</span>
            </div>
          )}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /><span>Due: {format(new Date(followUp.dueDate), 'MMM d, yyyy h:mm a')}</span></div>
            <div>Owner: {followUp.ownerName}</div>
          </div>
        </div>
        <div className="flex gap-2 ml-4 flex-shrink-0">
          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setSelectedFollowUp(followUp); setDoneDialogOpen(true); }}>
            <CheckCircle2 className="h-4 w-4 mr-1" />Done
          </Button>
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setSelectedFollowUp(followUp); setRescheduleDialogOpen(true); }}>
            Reschedule
          </Button>
        </div>
      </div>
    );
  };

  const renderGroup = (title: string, items: FollowUp[], variant: 'destructive' | 'default' | 'secondary') => (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {variant === 'destructive' && <AlertCircle className="h-4 w-4 text-destructive" />}
        {variant === 'default' && <Calendar className="h-4 w-4 text-primary" />}
        <h4 className="font-medium text-sm">{title}</h4>
        <Badge variant={variant} className="text-xs">{items.length}</Badge>
      </div>
      {items.length === 0 ? (
        <div className="text-center py-4 text-sm text-muted-foreground">No follow-ups</div>
      ) : (
        <div className="space-y-3">{items.map(renderCard)}</div>
      )}
    </div>
  );

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">All Team Follow-Ups</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {pendingFUs.length} pending · {allFUs.filter(f => f.completed).length} done
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-6">
              {overdueItems.length > 0 && renderGroup('Overdue', overdueItems, 'destructive')}
              {renderGroup('Today', todayItems, 'default')}
              {thisWeekItems.length > 0 && renderGroup('This Week', thisWeekItems, 'secondary')}
              {laterItems.length > 0 && renderGroup('Later', laterItems, 'secondary')}
              {pendingFUs.length === 0 && (
                <div className="text-center py-16 text-muted-foreground">No pending follow-ups</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      <FollowUpDetailDialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen} followUp={selectedFollowUp} />
      <FollowUpDoneDialog
        open={doneDialogOpen}
        onOpenChange={setDoneDialogOpen}
        followUpId={selectedFollowUp?.id || ''}
        clientName={selectedFollowUp ? (selectedFollowUp.clientName ?? clients.find(c => c.id === selectedFollowUp.clientId)?.name ?? '') : ''}
        onSuccess={() => refetch()}
      />
      <FollowUpRescheduleDialog
        open={rescheduleDialogOpen}
        onOpenChange={setRescheduleDialogOpen}
        followUpId={selectedFollowUp?.id || ''}
        clientName={selectedFollowUp ? (selectedFollowUp.clientName ?? clients.find(c => c.id === selectedFollowUp.clientId)?.name ?? '') : ''}
        currentDate={selectedFollowUp?.dueDate || new Date()}
        onSuccess={() => refetch()}
      />
    </>
  );
}

export default function FollowUps() {
  const { followUps, setFollowUps, clients, currentUser, currentSubCompany, updateFollowUp } = useStore();
  const [selectedFollowUp, setSelectedFollowUp] = useState<FollowUp | null>(null);
  const [doneDialogOpen, setDoneDialogOpen] = useState(false);
  const [rescheduleDialogOpen, setRescheduleDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showMine, setShowMine] = useState(false);

  const agencyId = currentSubCompany?.id ?? currentUser.subCompanyId;
  const isManager = useCanViewTeamScope();

  const scopeFilter = useScopeFilter();
  const {
    isElevated,
    showHierarchyFilters,
    isAgencyHierarchyViewer,
    isPureManager,
    agencies,
    selectedAgencyId,
    selectedLeaderId,
    selectedManagerId,
    selectedUserId,
    setSelectedAgencyId,
    setSelectedUserId,
    setSelectedManagerId,
    onlyMe,
    getAssociatesForManager,
    getUsersForLeader,
    teamUsers: managerTeamUsers,
    showAllTeamView,
    showAgencySections,
    showManagerSections,
    filterRowProps,
    leaderParamInUrl,
    managerParamInUrl,
    userParamInUrl,
    scopeKey,
  } = scopeFilter;

  const { ownerIds: elevatedOwnerIds } = useScopeQueryParams(scopeFilter);
  const [followUpSearchParams, setFollowUpSearchParams] = useSearchParams();
  const linkedUserIdParam = followUpSearchParams.get('linkedUserId') ?? '';
  const openParam = followUpSearchParams.get('open');

  const loadCounterRef = useRef(0);

  const loadFollowUps = useCallback(async () => {
    if (!agencyId) return;
    if (showAgencySections || showAllTeamView) { setLoading(false); return; }
    if (showAllTeamView) { setLoading(false); return; }
    const counter = ++loadCounterRef.current;
    setLoading(true);
    try {
      const ownerIds = elevatedOwnerIds;
      if (ownerIds !== undefined && ownerIds.length === 0) {
        if (counter === loadCounterRef.current) { setFollowUps([]); setLoading(false); }
        return;
      }
      const { data } = await fetchFollowUps({
        agencyIds: isElevated && selectedAgencyId !== 'all' && selectedAgencyId !== 'me' ? [selectedAgencyId] : undefined,
        subCompanyId: isElevated ? undefined : (isManager ? undefined : agencyId),
        ownerIds,
        limit: 500,
      });
      if (counter !== loadCounterRef.current) return;
      const mapped = data.map(mapApiFollowUpToFollowUp);
      setFollowUps(mapped);
    } catch {
      if (counter !== loadCounterRef.current) return;
      toast.error('Failed to load follow-ups');
      setFollowUps([]);
    } finally {
      if (counter === loadCounterRef.current) setLoading(false);
    }
  }, [agencyId, isManager, isElevated, showAllTeamView, selectedAgencyId, setFollowUps, elevatedOwnerIds, linkedUserIdParam]);

  useEffect(() => {
    loadFollowUps();
  }, [loadFollowUps]);

  useEffect(() => {
    if (!openParam || loading) return;
    const target = followUps.find(f => f.id === openParam);
    if (target) {
      setSelectedFollowUp(target);
      setDetailDialogOpen(true);
    }
    setFollowUpSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('open');
      return next;
    }, { replace: true });
  }, [openParam, loading, followUps, setFollowUpSearchParams]);

  // Apply owner filter client-side so the display updates immediately and reliably.
  // "My Follow-Ups" takes priority over the multi-select when active.
  const myFollowUps = useMemo(() => {
    if (isElevated && selectedAgencyId === 'me') return followUps.filter(f => f.ownerId === currentUser.id);
    if (isElevated && selectedAgencyId !== 'all') {
      if (selectedUserId !== 'all' && selectedUserId !== 'me') return followUps.filter(f => f.ownerId === selectedUserId);
      // "All Team" selected — API already returned team associates; pass data through as-is
      if (userParamInUrl && selectedUserId === 'all') return followUps;
      // Specific manager chip (no All Team) — show only that manager's own records
      if (selectedManagerId !== 'all') return followUps.filter(f => f.ownerId === selectedManagerId);
      // Specific leader chip with no manager/user drill — show only that leader's own records
      if (!managerParamInUrl && selectedLeaderId !== 'all' && selectedLeaderId !== 'me') {
        return followUps.filter(f => f.ownerId === selectedLeaderId);
      }
      return followUps;
    }
    if (isPureManager && selectedUserId !== 'all') return followUps.filter(f => f.ownerId === selectedUserId);
    if (showMine) return followUps.filter(f => f.ownerId === currentUser.id);
    // linkedUserIdParam contains multiple IDs when All Linked Users / specific linked user active
    const hasLinkedFilter = !!linkedUserIdParam && linkedUserIdParam.split(',').some(id => id !== currentUser.id);
    if (hasLinkedFilter) return followUps;
    return isManager ? followUps : followUps.filter(f => f.ownerId === currentUser.id);
  }, [followUps, isManager, isElevated, isPureManager, selectedAgencyId, selectedManagerId, selectedUserId, selectedLeaderId, managerParamInUrl, userParamInUrl, currentUser.id, showMine, linkedUserIdParam]);
  
  const overdueFollowUps = myFollowUps.filter(f => 
    !f.completed && isBefore(new Date(f.dueDate), new Date())
  );
  
  const todayFollowUps = myFollowUps.filter(f =>
    !f.completed && isToday(new Date(f.dueDate))
  );
  
  const thisWeekFollowUps = myFollowUps.filter(f =>
    !f.completed && isThisWeek(new Date(f.dueDate)) && !isToday(new Date(f.dueDate))
  );
  
  const laterFollowUps = myFollowUps.filter(f =>
    !f.completed && !isThisWeek(new Date(f.dueDate))
  );
  
  const getClient = (clientId: string) => {
    return clients.find(c => c.id === clientId);
  };

  const getContact = (clientId: string, contactId?: string) => {
    if (!contactId) return null;
    const client = clients.find(c => c.id === clientId);
    return client?.contacts.find(c => c.id === contactId) || null;
  };
  
  const FollowUpSection = ({ title, items, variant }: {
    title: string;
    items: typeof myFollowUps;
    variant: 'destructive' | 'default' | 'secondary';
  }) => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            {variant === 'destructive' && <AlertCircle className="h-5 w-5 text-destructive" />}
            {variant === 'default' && <Calendar className="h-5 w-5 text-primary" />}
            {title}
          </CardTitle>
          <Badge variant={variant}>{items.length}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No follow-ups
          </div>
        ) : (
          <div className="space-y-3">
            {items.map(followUp => {
              const client = getClient(followUp.clientId);
              const contact = getContact(followUp.clientId, followUp.contactId);
              const lastComment = followUp.comments.length > 0 
                ? followUp.comments[followUp.comments.length - 1]
                : null;
              
              return (
                <div 
                  key={followUp.id} 
                  className="flex items-start justify-between p-4 rounded-lg border border-border bg-card hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => {
                    setSelectedFollowUp(followUp);
                    setDetailDialogOpen(true);
                  }}
                >
                  <div className="flex-1 space-y-3">
                    <div>
                      <div className="font-semibold text-lg">{followUp.clientName ?? client?.name ?? 'Unknown client'}</div>
            {followUp.forwardedFromName && (selectedAgencyId === 'all' || selectedAgencyId === 'me' || selectedAgencyId === followUp.forwardedFromSubCompanyId) && <ForwardedChip name={followUp.forwardedFromName} />}
                      <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                        {client && (
                          <>
                            <div className="flex items-center gap-1">
                              <Building2 className="h-3.5 w-3.5" />
                              <span>{client.industry}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5" />
                              <span>{client.location}</span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    
                    {contact && (
                      <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
                        <div className="font-medium text-sm">Contact Person</div>
                        <div className="text-sm">{contact.name}{contact.isPrimary && <Badge variant="secondary" className="ml-2 text-xs">Primary</Badge>}</div>
                        {contact.email && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Mail className="h-3 w-3" />
                            <span>{contact.email}</span>
                          </div>
                        )}
                        {(contact.phone || contact.phoneExtension) && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Phone className="h-3 w-3" />
                            <span>
                              {contact.phone}
                              {contact.phoneExtension?.trim() && (
                                <span className="ml-1">ext. {contact.phoneExtension.trim()}</span>
                              )}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Last Comment */}
                    {lastComment && (
                      <div className="bg-accent/50 rounded-md p-3 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">Last Update</span>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(lastComment.createdAt), 'MMM d, h:mm a')}
                          </span>
                        </div>
                        <p className="text-sm">{lastComment.content}</p>
                        <span className="text-xs text-muted-foreground">- {lastComment.userName}</span>
                      </div>
                    )}
                    
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        <span>Due: {format(new Date(followUp.dueDate), 'MMM d, yyyy h:mm a')}</span>
                      </div>
                      <div>Owner: {followUp.ownerName}</div>
                    </div>
                  </div>
                  
                  <div className="flex gap-2 ml-4 flex-shrink-0">
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFollowUp(followUp);
                        setDoneDialogOpen(true);
                      }}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Done
                    </Button>
                    <Button 
                      size="sm" 
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFollowUp(followUp);
                        setRescheduleDialogOpen(true);
                      }}
                    >
                      Reschedule
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
  
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 pt-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Follow-Ups</h1>
          <p className="text-muted-foreground mt-1">
            {loading ? 'Loading...' : `${myFollowUps.filter(f => !f.completed).length} pending follow-ups`}
          </p>
        </div>
        {/* {canFilter && (
          <div className="flex items-center gap-2">
            <Button
              variant={showMine ? 'default' : 'outline'}
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => {
                if (!showMine) setSelectedUserIds([]);
                setShowMine(prev => !prev);
              }}
            >
              <User className="h-4 w-4" />
              My Follow-Ups
            </Button>
          </div>
        )} */}
      </div>

      <StickyHeader zIndex={40}>
        <ScopeFilterBar show={showHierarchyFilters} filterRowProps={filterRowProps} />
      </StickyHeader>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
      <>
      {/* All Agencies sections — one card per agency */}
      {showAgencySections && (
        agencies.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-12">No agencies in scope</p>
        ) : (
          <div className="space-y-3">
            {agencies.map((agency) => (
              <AgencyFollowUpsSection
                key={agency.id}
                agency={agency}
                onViewAgency={() => setSelectedAgencyId(agency.id)}
                ownerIds={elevatedOwnerIds}
                scopeKey={`${scopeKey}|${elevatedOwnerIds?.join(',') ?? ''}`}
              />
            ))}
          </div>
        )
      )}

      {/* Manager / Team — one section per user */}
      {showAllTeamView && (
        managerTeamUsers.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-12">
            {showManagerSections ? 'No managers / team in this agency' : 'No team members in this scope'}
          </p>
        ) : (
          <div className="space-y-4">
            {managerTeamUsers.map((user, i) => (
              <UserFollowUpsSection
                key={user.id}
                user={user}
                colorIndex={i}
                onViewFollowUps={() =>
                  showManagerSections ? setSelectedManagerId(user.id) : setSelectedUserId(user.id)
                }
              />
            ))}
          </div>
        )
      )}

      {!showAgencySections && !showAllTeamView && <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Overdue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {overdueFollowUps.length}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">
              {todayFollowUps.length}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Completed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">
              {myFollowUps.filter(f => f.completed).length}
            </div>
          </CardContent>
        </Card>
      </div>
      
      <div className="space-y-6">
        {overdueFollowUps.length > 0 && (
          <FollowUpSection
            title="Overdue"
            items={overdueFollowUps}
            variant="destructive"
          />
        )}
        
        <FollowUpSection
          title="Today"
          items={todayFollowUps}
          variant="default"
        />
        
        <FollowUpSection
          title="This Week"
          items={thisWeekFollowUps}
          variant="secondary"
        />
        
        <FollowUpSection
          title="Later"
          items={laterFollowUps}
          variant="secondary"
        />
      </div>

      </>}

      {/* Dialogs */}
      <FollowUpDetailDialog
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
        followUp={selectedFollowUp}
      />

      <FollowUpDoneDialog
        open={doneDialogOpen}
        onOpenChange={setDoneDialogOpen}
        followUpId={selectedFollowUp?.id || ''}
        clientName={selectedFollowUp ? (selectedFollowUp.clientName ?? clients.find(c => c.id === selectedFollowUp.clientId)?.name ?? '') : ''}
        onSuccess={loadFollowUps}
      />

      <FollowUpRescheduleDialog
        open={rescheduleDialogOpen}
        onOpenChange={setRescheduleDialogOpen}
        followUpId={selectedFollowUp?.id || ''}
        clientName={selectedFollowUp ? (selectedFollowUp.clientName ?? clients.find(c => c.id === selectedFollowUp.clientId)?.name ?? '') : ''}
        currentDate={selectedFollowUp?.dueDate || new Date()}
        onSuccess={loadFollowUps}
      />
      </>
      )}
    </div>
  );
}
