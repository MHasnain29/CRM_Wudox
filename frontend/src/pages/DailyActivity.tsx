import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import {
  Activity,
  Building2,
  Calendar,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  Mail,
  Phone,
  Search,
  UserCircle,
  Users,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { StickyHeader } from '@/components/StickyHeader';
import { useStore } from '@/lib/store';
import {
  fetchAccessibleAgencies,
  fetchDailyActivityHierarchy,
  fetchDailyActivityItems,
  markNotificationRead,
  type DailyActivityFilter,
  type DailyActivityHierarchyResponse,
  type DailyActivityItemDto,
  type DailyActivityKind,
  type DailyActivityTreeNode,
} from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { toast } from 'sonner';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  countActionToday,
  DAILY_ACTIVITY_STATUS_STYLES,
  getDailyActivityStatusLabel,
} from '@/lib/dailyActivityDisplay';
import { useCanAccessMultipleAgencies, useCanViewTeamScope } from '@/lib/access';
import { DailyActivityApprovalRow } from '@/components/daily-activity/DailyActivityApprovalRow';

const FILTERS: { id: DailyActivityFilter; label: string }[] = [
  { id: 'action_today', label: 'To do today' },
  { id: 'completed_today', label: 'Done today' },
  { id: 'awaiting_approval', label: 'Pending requests' },
];

const KIND_LABELS: Record<DailyActivityKind, string> = {
  task: 'Task',
  meeting: 'Meeting',
  follow_up: 'Follow-up',
  lead: 'Lead',
  proposal: 'Proposal',
  call: 'Call',
  email: 'Email',
  note: 'Note',
  lead_request: 'Lead request',
  client_submission: 'Client submission',
  client_edit: 'Client edit',
  notification: 'Notification',
  reminder: 'Reminder',
  resource_request: 'Request',
  lead_extension: 'Lead extension',
  proposal_extension: 'Proposal extension',
  employee: 'Employee',
};

const KIND_ICONS: Record<DailyActivityKind, typeof Activity> = {
  task: CheckSquare,
  meeting: Calendar,
  follow_up: Clock,
  lead: UserCircle,
  proposal: FileText,
  call: Phone,
  email: Mail,
  note: FileText,
  lead_request: UserCircle,
  client_submission: Building2,
  client_edit: Building2,
  notification: Activity,
  reminder: Clock,
  resource_request: FileText,
  lead_extension: UserCircle,
  proposal_extension: FileText,
  employee: Users,
};

function userDisplayName(node: DailyActivityTreeNode): string {
  if (node.isUnassignedGroup) return 'Unassigned';
  return `${node.user.firstName} ${node.user.lastName}`.trim() || node.user.roleLabel;
}

function findTreeNode(nodes: DailyActivityTreeNode[], userId: string): DailyActivityTreeNode | null {
  for (const node of nodes) {
    if (!node.isUnassignedGroup && node.user.id === userId) return node;
    const found = findTreeNode(node.children, userId);
    if (found) return found;
  }
  return null;
}

const WORKLOAD_COLUMNS: {
  filter: DailyActivityFilter;
  label: string;
  active: string;
  zero: string;
  count: (c: DailyActivityTreeNode['counters']) => number;
}[] = [
  {
    filter: 'action_today',
    label: 'Today',
    active: 'text-blue-700 bg-blue-50',
    zero: 'text-muted-foreground/50 bg-muted/40',
    count: (c) => countActionToday(c),
  },
  {
    filter: 'completed_today',
    label: 'Done',
    active: 'text-green-700 bg-green-50',
    zero: 'text-muted-foreground/50 bg-muted/40',
    count: (c) => Math.max(0, c.completed_today ?? 0),
  },
];

function userInitials(node: DailyActivityTreeNode): string {
  if (node.isUnassignedGroup) return '?';
  const f = node.user.firstName?.[0] ?? '';
  const l = node.user.lastName?.[0] ?? '';
  return (f + l).toUpperCase() || '?';
}

function formatAgendaDateLabel(dateLabel: string): string {
  try {
    return format(parseISO(dateLabel), 'MMM d, yyyy');
  } catch {
    return dateLabel;
  }
}

function buildPageSubtitle(
  bounds: DailyActivityHierarchyResponse['bounds'] | undefined,
  canFilterAgencies: boolean,
  selectedAgencyId: string,
  agencies: { id: string; name: string }[],
): string {
  if (!bounds?.dateLabel) return 'Your work agenda and team workload';

  const datePart = formatAgendaDateLabel(bounds.dateLabel);

  if (!canFilterAgencies) {
    return datePart;
  }

  if (selectedAgencyId === 'all') {
    return `${datePart} · All agencies`;
  }
  const name = agencies.find((a) => a.id === selectedAgencyId)?.name ?? 'Selected agency';
  return `${datePart} · ${name}`;
}

function WorkloadGrid({
  c,
  activeFilter,
  onPick,
}: {
  c: DailyActivityTreeNode['counters'];
  activeFilter: DailyActivityFilter;
  onPick: (filter: DailyActivityFilter) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 w-full mt-2">
      {WORKLOAD_COLUMNS.map((col) => {
        const value = col.count(c);
        const displayValue = Math.max(0, value);
        const hasValue = displayValue > 0;
        const isActive = activeFilter === col.filter;
        return (
          <button
            key={col.filter}
            type="button"
            disabled={!hasValue}
            onClick={(e) => {
              e.stopPropagation();
              if (hasValue) onPick(col.filter);
            }}
            className={cn(
              'rounded-md px-1 py-1.5 text-center min-w-0',
              hasValue ? col.active : col.zero,
              isActive && 'ring-2 ring-primary/40',
              hasValue && 'cursor-pointer hover:opacity-90',
              !hasValue && 'cursor-default',
            )}
            title={`${col.label}: ${displayValue}${hasValue ? ' — filter agenda' : ''}`}
          >
            <div className="text-sm font-semibold tabular-nums leading-none">{displayValue}</div>
            <div className="mt-0.5 truncate text-[10px] font-medium leading-tight">{col.label}</div>
          </button>
        );
      })}
    </div>
  );
}

function HierarchyNode({
  node,
  depth,
  selectedUserId,
  onSelectUser,
  activeFilter,
  onWorkloadPick,
  defaultOpen,
}: {
  node: DailyActivityTreeNode;
  depth: number;
  selectedUserId: string | null;
  onSelectUser: (id: string | null) => void;
  activeFilter: DailyActivityFilter;
  onWorkloadPick: (userId: string, filter: DailyActivityFilter) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? depth < 1);
  const hasChildren = node.children.length > 0;
  const id = node.user.id;
  const isGroup = node.isUnassignedGroup;
  const selected = !isGroup && selectedUserId === id;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          'rounded-lg border p-2.5 space-y-2 transition-colors',
          selected ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20' : 'bg-card/60 hover:bg-muted/30',
        )}
        style={{ marginLeft: depth * 14 }}
      >
        <div className="flex items-start gap-2">
        {hasChildren ? (
          <CollapsibleTrigger asChild>
            <button type="button" className="p-0.5 shrink-0" aria-label={open ? 'Collapse' : 'Expand'}>
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </CollapsibleTrigger>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        {!isGroup && (
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
              selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
            )}
          >
            {userInitials(node)}
          </div>
        )}
        <button
          type="button"
          className="flex-1 text-left min-w-0"
          onClick={() => !isGroup && onSelectUser(id)}
          disabled={isGroup}
        >
          <div className="font-medium text-sm truncate">{userDisplayName(node)}</div>
          {!isGroup && (
            <div className="text-xs text-muted-foreground">{node.user.roleLabel}</div>
          )}
        </button>
        </div>
        {!isGroup && (
          <WorkloadGrid
            c={node.counters}
            activeFilter={activeFilter}
            onPick={(f) => onWorkloadPick(id, f)}
          />
        )}
      </div>
      {hasChildren && (
        <CollapsibleContent className="mt-1 pl-1">
          {node.children.map((child) => (
            <HierarchyNode
              key={child.user.id}
              node={child}
              depth={depth + 1}
              selectedUserId={selectedUserId}
              onSelectUser={onSelectUser}
              activeFilter={activeFilter}
              onWorkloadPick={onWorkloadPick}
            />
          ))}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

function ActivityRow({
  item,
  onOpen,
}: {
  item: DailyActivityItemDto;
  onOpen: (item: DailyActivityItemDto) => void;
}) {
  const Icon = KIND_ICONS[item.kind] ?? Activity;
  const when = item.dueAt ?? item.occurredAt;

  return (
    <button
      type="button"
      className="flex w-full items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer"
      onClick={() => onOpen(item)}
    >
      <div className="mt-0.5 rounded-md bg-muted p-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium truncate">{item.title}</span>
          <Badge variant="outline" className={cn('text-xs', DAILY_ACTIVITY_STATUS_STYLES[item.status])}>
            {getDailyActivityStatusLabel(item)}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {KIND_LABELS[item.kind] ?? item.kind}
          </Badge>
        </div>
        {item.subtitle && (
          <p className="text-sm text-muted-foreground truncate mt-0.5">{item.subtitle}</p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          {item.ownerName}
          {when && ` · ${format(parseISO(when), 'MMM d, h:mm a')}`}
        </p>
      </div>
      <span className="shrink-0 text-xs font-medium text-primary">Open →</span>
    </button>
  );
}

type DailyActivityPanelProps = {
  embedded?: boolean;
  onTodayCountChange?: (count: number) => void;
  /** Close parent modal before navigating (header daily agenda) */
  onClose?: () => void;
};

export function DailyActivityPanel({
  embedded = false,
  onTodayCountChange,
  onClose,
}: DailyActivityPanelProps) {
  const { currentUser } = useStore();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<DailyActivityFilter>('action_today');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [agendaScopeLabel, setAgendaScopeLabel] = useState<string | null>(null);
  const [hierarchy, setHierarchy] = useState<DailyActivityHierarchyResponse | null>(null);
  const [items, setItems] = useState<DailyActivityItemDto[]>([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 0 });
  const [loadingHierarchy, setLoadingHierarchy] = useState(true);
  const [loadingItems, setLoadingItems] = useState(true);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hierarchyReqId = useRef(0);
  const itemsReqId = useRef(0);

  const canViewTeam = useCanViewTeamScope();
  const canFilterAgencies = useCanAccessMultipleAgencies();
  const showHierarchy = canViewTeam;

  const { data: agencies = [], isLoading: agenciesLoading } = useQuery({
    queryKey: ['accessible-agencies'],
    queryFn: fetchAccessibleAgencies,
    enabled: canFilterAgencies,
    staleTime: 5 * 60 * 1000,
  });

  const [selectedAgencyId, setSelectedAgencyId] = useState<string>('all');

  useEffect(() => {
    if (!canFilterAgencies || !agencies.length) return;
    if (selectedAgencyId !== 'all' && !agencies.some((a) => a.id === selectedAgencyId)) {
      setSelectedAgencyId('all');
    }
  }, [agencies, canFilterAgencies, selectedAgencyId]);

  const agencyIdsParam = useMemo(() => {
    if (!canFilterAgencies) return undefined;
    if (selectedAgencyId === 'all') return undefined;
    return [selectedAgencyId];
  }, [canFilterAgencies, selectedAgencyId]);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadHierarchy = useCallback(async () => {
    const reqId = ++hierarchyReqId.current;
    setLoadingHierarchy(true);
    try {
      const data = await fetchDailyActivityHierarchy(agencyIdsParam);
      if (reqId !== hierarchyReqId.current) return;
      setHierarchy(data);
      const viewerNode =
        currentUser?.id != null ? findTreeNode(data.tree, currentUser.id) : null;
      if (viewerNode) {
        onTodayCountChange?.(countActionToday(viewerNode.counters));
      }
      // Do not push 0 when viewer row is missing — that wiped a valid header badge
    } catch {
      if (reqId !== hierarchyReqId.current) return;
      toast.error('Failed to load team hierarchy');
    } finally {
      if (reqId === hierarchyReqId.current) setLoadingHierarchy(false);
    }
  }, [agencyIdsParam, currentUser?.id, onTodayCountChange]);

  const loadItems = useCallback(async () => {
    const reqId = ++itemsReqId.current;
    setLoadingItems(true);
    try {
      const res = await fetchDailyActivityItems({
        filter,
        q: searchDebounced || undefined,
        userId: selectedUserId ?? undefined,
        page: 1,
        limit: 100,
        agencyIds: agencyIdsParam,
      });
      if (reqId !== itemsReqId.current) return;
      setItems(res.data);
      setPagination({
        page: res.pagination.page,
        total: res.pagination.total,
        totalPages: res.pagination.totalPages,
      });
    } catch {
      if (reqId !== itemsReqId.current) return;
      toast.error('Failed to load activities');
    } finally {
      if (reqId === itemsReqId.current) setLoadingItems(false);
    }
  }, [filter, searchDebounced, selectedUserId, agencyIdsParam]);

  useEffect(() => {
    setSelectedUserId(null);
    setAgendaScopeLabel(null);
  }, [selectedAgencyId]);

  const selectTeamMember = useCallback((userId: string | null, label: string | null) => {
    setSelectedUserId(userId);
    setAgendaScopeLabel(label);
  }, []);

  const pickWorkload = useCallback(
    (userId: string, workloadFilter: DailyActivityFilter) => {
      const node = findTreeNode(hierarchy?.tree ?? [], userId);
      const name = node ? userDisplayName(node) : 'Selected';
      selectTeamMember(userId, name);
      setFilter(workloadFilter);
    },
    [hierarchy?.tree, selectTeamMember],
  );

  const handleSelectUser = useCallback(
    (userId: string | null) => {
      if (!userId) {
        selectTeamMember(null, null);
        return;
      }
      const node = findTreeNode(hierarchy?.tree ?? [], userId);
      selectTeamMember(userId, node ? userDisplayName(node) : null);
    },
    [hierarchy?.tree, selectTeamMember],
  );

  const refreshAll = useCallback(() => {
    void loadHierarchy();
    void loadItems();
  }, [loadHierarchy, loadItems]);

  useEffect(() => {
    void loadHierarchy();
  }, [loadHierarchy]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const schedule = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(refreshAll, 600);
    };
    const events = [
      'task:refresh',
      'followup:refresh',
      'lead:refresh',
      'proposal:refresh',
      'meeting:refresh',
      'call:refresh',
      'email:refresh',
      'notification:new',
      'client:refresh',
    ];
    for (const ev of events) socket.on(ev, schedule);
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      for (const ev of events) socket.off(ev, schedule);
    };
  }, [refreshAll]);

  const viewerCounters = useMemo(() => {
    if (!currentUser?.id || !hierarchy?.tree.length) return null;
    return findTreeNode(hierarchy.tree, currentUser.id)?.counters ?? null;
  }, [currentUser?.id, hierarchy]);

  /** Tiles: Entire team → agency totals; selected person → that row; else viewer personal. */
  const statTiles = useMemo(() => {
    if (!hierarchy) return [];

    let counters = viewerCounters;
    if (showHierarchy && selectedUserId === null && hierarchy.totals) {
      counters = {
        total: hierarchy.totals.total,
        today: hierarchy.totals.today,
        pending: hierarchy.totals.pending,
        overdue: hierarchy.totals.overdue,
        awaiting_approval: hierarchy.totals.awaiting_approval,
        completed_today: hierarchy.totals.completed_today,
        action_today: hierarchy.totals.action_today,
      };
    } else if (selectedUserId) {
      counters = findTreeNode(hierarchy.tree, selectedUserId)?.counters ?? null;
    }

    if (!counters) return [];

    return [
      {
        label: showHierarchy && selectedUserId === null ? 'Team to do today' : 'To do today',
        value: countActionToday(counters),
        valueClass: 'text-foreground',
      },
      {
        label: showHierarchy && selectedUserId === null ? 'Team done today' : 'Done today',
        value: Math.max(0, counters.completed_today ?? 0),
        valueClass: 'text-green-600',
      },
    ];
  }, [hierarchy, viewerCounters, showHierarchy, selectedUserId]);

  const goToRecord = async (item: DailyActivityItemDto) => {
    navigate(item.link.startsWith('/') ? item.link : `/${item.link}`);
    if (item.kind === 'notification') {
      try {
        await markNotificationRead(item.entityId);
      } catch {
        /* ignore */
      }
    }
  };

  const handleOpen = (item: DailyActivityItemDto) => {
    onClose?.();
    void goToRecord(item);
  };

  return (
    <div className={cn('space-y-4', embedded && 'space-y-3')}>
      <header className={cn('space-y-3', !embedded && 'pt-6')}>
        <div>
          {!embedded ? (
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Daily Agenda</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {buildPageSubtitle(hierarchy?.bounds, canFilterAgencies, selectedAgencyId, agencies)}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {buildPageSubtitle(hierarchy?.bounds, canFilterAgencies, selectedAgencyId, agencies)}
            </p>
          )}
        </div>

        {canFilterAgencies && agencies.length > 0 && (
          <StickyHeader>
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
              <Button
                size="sm"
                variant={selectedAgencyId === 'all' ? 'default' : 'secondary'}
                className="whitespace-nowrap shrink-0"
                onClick={() => setSelectedAgencyId('all')}
              >
                All Agencies
              </Button>
              {agenciesLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-1 shrink-0" />
              ) : (
                agencies.map((agency) => (
                  <Button
                    key={agency.id}
                    size="sm"
                    variant={selectedAgencyId === agency.id ? 'default' : 'secondary'}
                    className="whitespace-nowrap shrink-0"
                    onClick={() => setSelectedAgencyId(agency.id)}
                  >
                    {agency.name}
                  </Button>
                ))
              )}
            </div>
          </StickyHeader>
        )}

        {statTiles.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {statTiles.map((s) => (
              <div key={s.label} className="rounded-lg border bg-card px-3 py-2 shadow-sm">
                <p className={cn('text-xl font-bold tabular-nums leading-none', s.valueClass)}>{s.value}</p>
                <p className="mt-1 text-[11px] font-medium text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        )}
      </header>

      <div
        className={cn(
          'grid gap-4',
          showHierarchy ? 'lg:grid-cols-[minmax(17rem,20rem)_1fr]' : 'grid-cols-1',
        )}
      >
        {showHierarchy && (
          <Card className="border shadow-sm">
            <CardHeader className="shrink-0 space-y-1 border-b bg-muted/20 py-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 shrink-0" />
                Team
              </CardTitle>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Counts are per person. Click a name or Today/Done for that person only, or Entire team for everyone.
              </p>
            </CardHeader>
            <CardContent className="p-3">
              {loadingHierarchy ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : hierarchy?.tree.length ? (
                <div className="space-y-2">
                  <Button
                    variant={selectedUserId === null ? 'secondary' : 'ghost'}
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => selectTeamMember(null, null)}
                  >
                    Entire team
                  </Button>
                  {hierarchy.tree.map((node) => (
                    <HierarchyNode
                      key={node.user.id}
                      node={node}
                      depth={0}
                      selectedUserId={selectedUserId}
                      onSelectUser={handleSelectUser}
                      activeFilter={filter}
                      onWorkloadPick={pickWorkload}
                      defaultOpen
                    />
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">No team members</p>
              )}
            </CardContent>
          </Card>
        )}

        <div className="flex min-w-0 flex-col gap-3">
          <div className="shrink-0 space-y-2 rounded-lg border bg-card p-3 shadow-sm">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-9"
                placeholder="Search agenda..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => {
                const pendingCount =
                  f.id === 'awaiting_approval'
                    ? Math.max(
                        0,
                        (selectedUserId
                          ? findTreeNode(hierarchy?.tree ?? [], selectedUserId)?.counters
                              ?.awaiting_approval
                          : hierarchy?.totals.awaiting_approval) ?? 0,
                      )
                    : null;
                return (
                  <Button
                    key={f.id}
                    size="sm"
                    className="h-8"
                    variant={filter === f.id ? 'default' : 'outline'}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label}
                    {pendingCount != null && pendingCount > 0 && (
                      <Badge
                        variant={filter === f.id ? 'secondary' : 'outline'}
                        className="ml-1.5 h-5 min-w-5 px-1.5 text-[10px]"
                      >
                        {pendingCount}
                      </Badge>
                    )}
                  </Button>
                );
              })}
            </div>
          </div>

          <Card className="border shadow-sm">
            <CardHeader className="shrink-0 space-y-1 border-b bg-muted/20 py-3">
              <div className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">Agenda</CardTitle>
                <span className="text-xs text-muted-foreground shrink-0">
                  {pagination.total} item{pagination.total !== 1 ? 's' : ''}
                </span>
              </div>
              {showHierarchy && (
                <p className="text-xs text-muted-foreground">
                  Showing:{' '}
                  {selectedUserId === null ? 'Entire team' : agendaScopeLabel ?? 'Selected'}
                </p>
              )}
            </CardHeader>
            <CardContent className="p-3">
              {loadingItems ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <CheckCircle2 className="mb-3 h-10 w-10 text-muted-foreground/40" />
                  <p className="text-sm font-medium text-foreground">Nothing here</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {filter === 'awaiting_approval'
                      ? 'No pending approval requests'
                      : 'Try another filter or clear the search'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((item) =>
                    filter === 'awaiting_approval' ? (
                      <DailyActivityApprovalRow
                        key={item.id}
                        item={item}
                        onOpen={handleOpen}
                      />
                    ) : (
                      <ActivityRow
                        key={item.id}
                        item={item}
                        onOpen={handleOpen}
                      />
                    ),
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** @deprecated Use header Daily Agenda modal instead */
export default function DailyActivity() {
  return <DailyActivityPanel />;
}
