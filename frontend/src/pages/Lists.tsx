import { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Building2, MapPin, ArrowUpDown, ArrowUp, ArrowDown, Users, Filter, Save, Trash2, List, Edit, ArrowLeft, Eye, Mail, PhoneCall, Calendar, Search as SearchIcon, Archive, ArchiveRestore, Loader2, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStore } from '@/lib/store';
import { getUserRoleTitle } from '@/lib/roleLabels';
import { fetchClients, fetchClientFacets, fetchMailingLists, createMailingList, updateMailingList, deleteMailingList, addMembersToList, fetchMailingListMembers, fetchAssignableUsers, addListAssignees, removeListAssignee, archiveMailingList, type ApiUser, type ApiMailingList, type ApiAssignableUser } from '@/lib/api';
import { onListChanged } from '@/lib/socket';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { useWriteAgencyId } from '@/hooks/useWriteAgencyId';
import { useEffectiveUser } from '@/lib/effectiveUser';
import { FollowUpDialog } from '@/components/FollowUpDialog';
import { ClientDetailsSheet } from '@/components/ClientDetailsSheet';
import { Client } from '@/lib/types';
import { getCountryFlag } from '@/lib/countries';
import { useHasPermission } from '@/lib/access';
import { ScopeFilterBar } from '@/components/ScopeFilterBar';
import { StickyHeader } from '@/components/StickyHeader';
import { PersonSectionHeader, PersonCardIdentity } from '@/components/PersonSectionHeader';
import { useScopeFilter } from '@/hooks/useElevatedScopeFilter';
import { useScopeQueryParams } from '@/hooks/useScopeQueryParams';
import { useListClientPreview } from '@/hooks/useListClientPreview';
import { mapApiClientToListClient, matchesAnyFilter, isDefaultListStatusSelection, DEFAULT_LIST_STATUS_FILTERS, applyListAttributeFilters } from '@/lib/listClientPreview';

interface SavedList {
  id: string;
  name: string;
  filters: {
    industryFilters?: string[];
    locationFilters?: string[];
    tagFilters?: string[];
    companySizeFilters?: string[];
    statusFilters?: string[];
    rangeType: 'all' | 'custom';
    rangeStart?: number;
    rangeEnd?: number;
  };
  createdAt: Date;
  createdBy: {
    id: string;
    name: string;
  };
  assignedTo?: Assignee | Assignee[];
  isArchived?: boolean;
  /** DB mailing-list id (set once synced/enriched); enables assignment + archive. */
  dbId?: string;
}

type Assignee = { id: string; name: string };

/** Normalize the single-or-array assignee shape to an array. */
function assigneeList(l: { assignedTo?: Assignee | Assignee[] | { name?: string } | null }): Assignee[] {
  if (!l.assignedTo) return [];
  if (Array.isArray(l.assignedTo)) return l.assignedTo;
  const a = l.assignedTo as Partial<Assignee>;
  return a.id ? [{ id: a.id, name: a.name ?? '' }] : [];
}

/** Comma-joined assignee names, or a dash when none. */
function assigneeNames(l: { assignedTo?: Assignee | Assignee[] | { name?: string } | null }): string {
  const names = assigneeList(l).map((a) => a.name).filter(Boolean);
  return names.length > 0 ? names.join(', ') : '-';
}

/** Whether a user is an assignee of the list. */
function isAssignedToUser(l: { assignedTo?: Assignee | Assignee[] | null }, userId: string): boolean {
  return assigneeList(l).some((a) => a.id === userId);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Demo data for lists
const demoLists: SavedList[] = [
  {
    id: 'demo-list-1',
    name: 'Tech Companies - Toronto',
    filters: {
      industryFilters: ['Technology'],
      locationFilters: ['Toronto, ON'],
      tagFilters: [],
      companySizeFilters: [],
      rangeType: 'all',
    },
    createdAt: new Date('2025-11-15'),
    createdBy: { id: 'user1', name: 'John Smith' },
    assignedTo: { id: 'user1', name: 'John Smith' },
  },
  {
    id: 'demo-list-2',
    name: 'Healthcare Prospects',
    filters: {
      industryFilters: ['Healthcare'],
      locationFilters: [],
      tagFilters: [],
      companySizeFilters: ['1000-5000 employees', '5000+ employees'],
      rangeType: 'custom',
      rangeStart: 1,
      rangeEnd: 20,
    },
    createdAt: new Date('2025-11-10'),
    createdBy: { id: 'user2', name: 'Sarah Johnson' },
    assignedTo: { id: 'user1', name: 'John Smith' },
  },
  {
    id: 'demo-list-3',
    name: 'Manufacturing - Quebec',
    filters: {
      industryFilters: ['Manufacturing'],
      locationFilters: ['Montreal, QC'],
      tagFilters: [],
      companySizeFilters: [],
      rangeType: 'all',
    },
    createdAt: new Date('2025-11-05'),
    createdBy: { id: 'user1', name: 'John Smith' },
    assignedTo: { id: 'user2', name: 'Sarah Johnson' },
  },
  {
    id: 'demo-list-4',
    name: 'VIP Clients Outreach',
    filters: {
      industryFilters: [],
      locationFilters: [],
      tagFilters: ['VIP'],
      companySizeFilters: [],
      rangeType: 'all',
    },
    createdAt: new Date('2025-10-28'),
    createdBy: { id: 'user3', name: 'Mike Wilson' },
    assignedTo: { id: 'user1', name: 'John Smith' },
  },
  {
    id: 'demo-list-5',
    name: 'Old Retail List',
    filters: {
      industryFilters: ['Retail'],
      locationFilters: [],
      tagFilters: [],
      companySizeFilters: [],
      rangeType: 'all',
    },
    createdAt: new Date('2025-09-15'),
    createdBy: { id: 'user1', name: 'John Smith' },
    isArchived: true,
  },
  {
    id: 'demo-list-6',
    name: 'Seasonal Hiring - Archived',
    filters: {
      industryFilters: [],
      locationFilters: [],
      tagFilters: ['Seasonal'],
      companySizeFilters: [],
      rangeType: 'custom',
      rangeStart: 1,
      rangeEnd: 15,
    },
    createdAt: new Date('2025-08-20'),
    createdBy: { id: 'user2', name: 'Sarah Johnson' },
    assignedTo: { id: 'user1', name: 'John Smith' },
    isArchived: true,
  },
];

const TEAM_PALETTE = [
  { bg: 'bg-blue-500/10',    border: 'border-blue-500/20',    text: 'text-blue-600',    accent: 'bg-blue-500'    },
  { bg: 'bg-purple-500/10',  border: 'border-purple-500/20',  text: 'text-purple-600',  accent: 'bg-purple-500'  },
  { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-600', accent: 'bg-emerald-500' },
  { bg: 'bg-orange-500/10',  border: 'border-orange-500/20',  text: 'text-orange-600',  accent: 'bg-orange-500'  },
  { bg: 'bg-cyan-500/10',    border: 'border-cyan-500/20',    text: 'text-cyan-600',    accent: 'bg-cyan-500'    },
  { bg: 'bg-rose-500/10',    border: 'border-rose-500/20',    text: 'text-rose-600',    accent: 'bg-rose-500'    },
];

// ─── Per-agency lists section (All Agencies view) ────────────────────────────
function AgencyListsSection({
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
  const { data: lists = [], isLoading } = useQuery({
    queryKey: ['agency-lists-section', agency.id, scopeKey],
    queryFn: () =>
      fetchMailingLists({
        subCompanyId: agency.id,
        createdByIds: ownerIds,
      }),
    staleTime: 0,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base font-semibold">{agency.name}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {lists.length} mailing list{lists.length !== 1 ? 's' : ''}
            </p>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={onViewAgency}>
            View Agency <TrendingUp className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : lists.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No mailing lists</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lists.map((list) => (
                <TableRow key={list.id}>
                  <TableCell className="font-medium">{list.name}</TableCell>
                  <TableCell className="text-muted-foreground">{list.description ?? '—'}</TableCell>
                  <TableCell className="text-right">{list.memberCount}</TableCell>
                  <TableCell>{new Date(list.createdAt).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Per-user lists section (full table, manager "All Team" view) ────────────
function UserListsSection({
  user,
  colorIndex,
  savedLists,
  onViewLists,
  onViewListData,
  onDeleteList,
  onArchiveList,
  onRestoreList,
  onEditList,
}: {
  user: ApiUser;
  colorIndex: number;
  savedLists: SavedList[];
  onViewLists: () => void;
  onViewListData: (list: SavedList) => void;
  onDeleteList: (id: string) => void;
  onArchiveList: (id: string) => void;
  onRestoreList: (id: string) => void;
  onEditList: (list: SavedList) => void;
}) {
  const PAGE_SIZE = 10;
  const color = TEAM_PALETTE[colorIndex % TEAM_PALETTE.length];
  const fullName = `${user.firstName} ${user.lastName}`.trim();
  const initials = fullName.split(' ').map(w => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase();
  const [tab, setTab] = useState<'all' | 'assigned' | 'created' | 'archived'>('all');
  const [page, setPage] = useState(1);

  const userLists = useMemo(() =>
    savedLists.filter(l => l.createdBy.id === user.id || isAssignedToUser(l, user.id)),
    [savedLists, user.id]
  );

  const filteredLists = useMemo(() => {
    switch (tab) {
      case 'all':      return userLists.filter(l => !l.isArchived);
      case 'assigned': return userLists.filter(l => !l.isArchived && isAssignedToUser(l, user.id));
      case 'created':  return userLists.filter(l => !l.isArchived && l.createdBy.id === user.id);
      case 'archived': return userLists.filter(l => l.isArchived);
      default:         return userLists.filter(l => !l.isArchived);
    }
  }, [userLists, tab, user.id]);

  useEffect(() => {
    setPage(1);
  }, [user.id, tab]);

  const totalPages = Math.max(1, Math.ceil(filteredLists.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const pageRows = filteredLists.slice(startIndex, startIndex + PAGE_SIZE);

  const totalActive = userLists.filter(l => !l.isArchived).length;

  return (
    <Card className={cn('border overflow-hidden', color.border)}>
      <div className={cn('flex items-center justify-between px-5 py-4', color.bg)}>
        <PersonCardIdentity
          user={user}
          roleTitle={getUserRoleTitle(user)}
          subtitle={`${totalActive} list${totalActive !== 1 ? 's' : ''}`}
          accentClassName={color.accent}
        />
        <Button variant="outline" size="sm" onClick={onViewLists}>
          View Lists
        </Button>
      </div>
      <CardContent className="pt-4 pb-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="all">
              All
              <Badge variant="secondary" className="ml-2">{userLists.filter(l => !l.isArchived).length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="assigned">
              Assigned to User
              <Badge variant="secondary" className="ml-2">{userLists.filter(l => !l.isArchived && isAssignedToUser(l, user.id)).length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="created">
              Created by User
              <Badge variant="secondary" className="ml-2">{userLists.filter(l => !l.isArchived && l.createdBy.id === user.id).length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="archived">
              Archived
              <Badge variant="secondary" className="ml-2">{userLists.filter(l => l.isArchived).length}</Badge>
            </TabsTrigger>
          </TabsList>
          <TabsContent value={tab} className="mt-4">
            {filteredLists.length === 0 ? (
              <div className="text-center py-8">
                <List className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  {tab === 'archived' ? 'No archived lists' : 'No lists'}
                </p>
              </div>
            ) : (
              <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>List Name</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Created By</TableHead>
                    <TableHead>Assigned To</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((list) => (
                    <TableRow key={list.id}>
                      <TableCell>
                        <button onClick={() => onViewListData(list)} className="text-primary hover:underline font-medium">
                          {list.name}
                        </button>
                      </TableCell>
                      <TableCell>{format(new Date(list.createdAt), 'MMM d, yyyy')}</TableCell>
                      <TableCell>{list.createdBy.name}</TableCell>
                      <TableCell>{assigneeNames(list)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {!list.isArchived && (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => onEditList(list)}>
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => onArchiveList(list.id)}>
                                <Archive className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          {list.isArchived && (
                            <Button variant="ghost" size="sm" onClick={() => onRestoreList(list.id)}>
                              <ArchiveRestore className="h-4 w-4" />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => onDeleteList(list.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filteredLists.length > PAGE_SIZE && (
                <div className="flex items-center justify-between pt-3 mt-2 border-t px-1">
                  <div className="text-sm text-muted-foreground">
                    Showing {startIndex + 1} to {Math.min(startIndex + pageRows.length, filteredLists.length)} of {filteredLists.length}
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
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

/** Per-user lists table used in All Team / All Managers people view (with client-side pagination). */
function PaginatedTeamUserListsCard({
  lists,
  mode,
  canManageLists,
  onViewListData,
  onEditList,
  onArchiveList,
  onDeleteList,
}: {
  lists: Array<{
    id: string;
    name: string;
    description?: string | null;
    memberCount?: number;
    createdAt: string | Date;
    createdBy?: { name?: string };
    assignedTo?: Assignee | Assignee[] | { name?: string } | null;
  }>;
  mode: 'elevated' | 'local';
  canManageLists: boolean;
  onViewListData: (list: any) => void;
  onEditList: (list: any) => void;
  onArchiveList: (id: string) => void;
  onDeleteList: (id: string) => void;
}) {
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [lists.length, mode]);

  if (lists.length === 0) {
    return <p className="text-center text-sm text-muted-foreground py-8">No data yet</p>;
  }

  const totalPages = Math.max(1, Math.ceil(lists.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const pageRows = lists.slice(startIndex, startIndex + PAGE_SIZE);

  return (
    <>
      {mode === 'elevated' ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Members</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((list) => (
              <TableRow key={list.id}>
                <TableCell className="font-medium">{list.name}</TableCell>
                <TableCell className="text-muted-foreground">{list.description ?? '—'}</TableCell>
                <TableCell className="text-right">{list.memberCount}</TableCell>
                <TableCell>{new Date(list.createdAt).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>List Name</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Created By</TableHead>
              <TableHead>Assigned To</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((list) => (
              <TableRow key={list.id}>
                <TableCell>
                  <button
                    onClick={() => onViewListData(list)}
                    className="text-primary hover:underline font-medium"
                  >
                    {list.name}
                  </button>
                </TableCell>
                <TableCell>{format(new Date(list.createdAt), 'MMM d, yyyy')}</TableCell>
                <TableCell>{list.createdBy?.name}</TableCell>
                <TableCell>{assigneeNames(list)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {canManageLists && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => onEditList(list)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => onArchiveList(list.id)}>
                          <Archive className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => onDeleteList(list.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {lists.length > PAGE_SIZE && (
        <div className="flex items-center justify-between pt-3 mt-2 border-t px-4 pb-3">
          <div className="text-sm text-muted-foreground">
            Showing {startIndex + 1} to {Math.min(startIndex + pageRows.length, lists.length)} of {lists.length}
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
  );
}

export default function Lists() {
  const { clients, leads, currentUser, currentSubCompany, setClients } = useStore();
  const { id: effectiveSelfId } = useEffectiveUser();
  const { toast } = useToast();
  const canManageLists = useHasPermission('clients:write');
  const scopeFilter = useScopeFilter();
  const {
    isElevated,
    isAgencyHierarchyViewer,
    showHierarchyFilters,
    isPureManager,
    agencies,
    selectedAgencyId,
    selectedLeaderId,
    selectedManagerId,
    selectedUserId,
    setSelectedAgencyId,
    setSelectedUserId,
    setSelectedManagerId,
    teamUsers: managerTeamUsers,
    showAllTeamView,
    showAgencySections,
    showManagerSections,
    filterRowProps,
    onlyMe,
    leaderParamInUrl,
    managerParamInUrl,
    userParamInUrl,
  } = scopeFilter;
  const listWriteAgencyId = useWriteAgencyId(
    isElevated && selectedAgencyId !== 'all' && selectedAgencyId !== 'me' && selectedAgencyId
      ? selectedAgencyId
      : currentSubCompany?.id,
  );
  const previewAgencyId =
    selectedAgencyId && selectedAgencyId !== 'all' && selectedAgencyId !== 'me'
      ? selectedAgencyId
      : listWriteAgencyId ?? currentSubCompany?.id;
  const { ownerIds: scopeOwnerIds, scopeKey } = useScopeQueryParams(scopeFilter);
  const [listsSearchParams] = useSearchParams();
  const linkedUserIdParam = listsSearchParams.get('linkedUserId') ?? '';

  // Fetch agency lists from API when an agency is drilled into
  const agencyDrilledIn =
    showHierarchyFilters &&
    !!selectedAgencyId &&
    selectedAgencyId !== 'all' &&
    selectedAgencyId !== 'me';

  // Edge case: elevated user viewing All Sales Managers (agencyId=all + managerId=all, or
  // specific leader + managerId=all). showAllTeamView is true but scopeOwnerIds is undefined
  // because "all managers" doesn't resolve to specific IDs in resolveOwnerIds.
  // We must explicitly pass the manager IDs so the DB query fires correctly.
  const isElevatedAllTeamView = showAllTeamView && !isPureManager;
  const elevatedTeamOwnerIds = useMemo(() => {
    if (!isElevatedAllTeamView) return undefined;
    const ids = managerTeamUsers.map((u) => u.id);
    return ids.length > 0 ? ids : undefined;
  }, [isElevatedAllTeamView, managerTeamUsers]);

  // Enable query when agency is drilled OR a specific user/group chip is selected
  // OR elevated user has All Sales Managers active (elevatedTeamOwnerIds set)
  // OR a linked-user filter is active (cross-agency view for own-scope users)
  const userDrilledInAllAgencies = !agencyDrilledIn && isAgencyHierarchyViewer && scopeOwnerIds !== undefined;
  const hasLinkedListFilter = !!linkedUserIdParam && !!scopeOwnerIds && scopeOwnerIds.length > 0;
  const shouldFetchAgencyLists = agencyDrilledIn || userDrilledInAllAgencies || !!elevatedTeamOwnerIds || hasLinkedListFilter;
  // Prefer concrete selected-user scope over All Managers/All Team section IDs.
  const effectiveListOwnerIds =
    scopeOwnerIds?.length === 1 ? scopeOwnerIds : (elevatedTeamOwnerIds ?? scopeOwnerIds);

  // Own-default (no hierarchy chips) or an explicit self person chip → personal Saved Lists chrome.
  const isSelfChip = (id?: string) => !!id && id !== 'all' && id !== 'me' && id === currentUser.id;
  const viewingSelf =
    onlyMe ||
    (!leaderParamInUrl &&
      !managerParamInUrl &&
      !userParamInUrl &&
      selectedAgencyId !== 'all') ||
    isSelfChip(selectedManagerId) ||
    isSelfChip(selectedLeaderId) ||
    isSelfChip(selectedUserId);

  const { data: agencyListsRaw = [], isLoading: agencyListsLoading, refetch: refetchAgencyLists } = useQuery({
    queryKey: ['agency-mailing-lists', selectedAgencyId, scopeKey, elevatedTeamOwnerIds?.join(',') ?? '', linkedUserIdParam],
    queryFn: () => fetchMailingLists({
      subCompanyId: agencyDrilledIn ? selectedAgencyId : undefined,
      createdByIds: effectiveListOwnerIds,
    }),
    enabled: shouldFetchAgencyLists,
    staleTime: 0,
  });

  const filteredAgencyLists = agencyListsRaw;

  useEffect(() => {
    fetchClients({ limit: 500, subCompanyId: previewAgencyId }).then(({ data }) => {
      setClients(data.map(mapApiClientToListClient));
    });
  }, [previewAgencyId, setClients]);

  useEffect(() => {
    fetchClientFacets({ subCompanyId: previewAgencyId }).then((res) => {
      if (res.industries) setFacetIndustries(res.industries);
    });
  }, [previewAgencyId]);

  // Sync localStorage lists → DB (runs once after clients are loaded)
  const syncedRef = useRef(false);
  useEffect(() => {
    if (clients.length === 0 || syncedRef.current) return;
    syncedRef.current = true;

    const stored = localStorage.getItem('savedLists');
    if (!stored) return;
    let localLists: SavedList[] = [];
    try { localLists = JSON.parse(stored); } catch { return; }
    const nonArchived = localLists.filter((l) => !l.isArchived);
    if (nonArchived.length === 0) return;

    // Helper: resolve filter criteria to matching client IDs
    const resolveClientIds = (list: SavedList): string[] => {
      const activeStatusFilters = list.filters.statusFilters ?? ['contacted', 'active', 'lost', 'ex', 'none'];
      let filtered = clients.filter((c) => {
        if (!matchesStatusFilters(c.status, activeStatusFilters)) return false;
        if (list.filters.industryFilters?.length && !matchesAnyFilter(c.industry, list.filters.industryFilters)) return false;
        if (list.filters.locationFilters?.length && !matchesAnyFilter(c.location, list.filters.locationFilters)) return false;
        if (list.filters.tagFilters?.length && !c.tags.some((t) => list.filters.tagFilters!.includes(t))) return false;
        if (list.filters.companySizeFilters?.length && !matchesAnyFilter(c.companySize, list.filters.companySizeFilters)) return false;
        return true;
      });
      if (list.filters.rangeType === 'custom' && list.filters.rangeStart != null && list.filters.rangeEnd != null) {
        filtered = filtered.slice(list.filters.rangeStart - 1, list.filters.rangeEnd);
      }
      return filtered.map((c) => c.id);
    };

    fetchMailingLists().then((dbLists) => {
      const dbByName = new Map(dbLists.map((l) => [l.name.toLowerCase(), l]));

      nonArchived.forEach(async (localList) => {
        let dbList = dbByName.get(localList.name.toLowerCase());
        if (!dbList) {
          const payload: { name: string; createdById?: string } = { name: localList.name };
          if (UUID_RE.test(localList.createdBy.id)) payload.createdById = localList.createdBy.id;
          dbList = await createMailingList(payload) ?? undefined;
          if (!dbList) return;
        }
        // Only populate members if the DB list currently has none
        if (dbList.memberCount === 0) {
          const ids = resolveClientIds(localList);
          if (ids.length > 0) addMembersToList(dbList.id, ids);
        }
      });
    });
  }, [clients]);

  // Patch demo list placeholder IDs ('user1','user2'...) to real team member UUIDs once loaded
  const demoPatchedRef = useRef(false);
  useEffect(() => {
    if (!isPureManager || managerTeamUsers.length === 0 || demoPatchedRef.current) return;
    demoPatchedRef.current = true;
    setSavedLists(prev => {
      const updated = prev.map(list => {
        const creatorMatch = list.createdBy.id.match(/^user(\d+)$/);
        if (!creatorMatch) return list;
        const creatorIdx = (parseInt(creatorMatch[1]) - 1) % managerTeamUsers.length;
        const cu = managerTeamUsers[creatorIdx];
        const currentAssignee = assigneeList(list)[0];
        const assigneeMatch = currentAssignee?.id.match(/^user(\d+)$/);
        const assignedTo = assigneeMatch
          ? (() => {
              const aIdx = (parseInt(assigneeMatch[1]) - 1) % managerTeamUsers.length;
              const au = managerTeamUsers[aIdx];
              return { id: au.id, name: `${au.firstName} ${au.lastName}`.trim() };
            })()
          : list.assignedTo;
        return {
          ...list,
          createdBy: { id: cu.id, name: `${cu.firstName} ${cu.lastName}`.trim() },
          assignedTo,
        };
      });
      const hasChanges = updated.some((u, i) => u.createdBy.id !== prev[i].createdBy.id);
      if (!hasChanges) return prev;
      localStorage.setItem('savedLists', JSON.stringify(updated));
      return updated;
    });
  }, [isPureManager, managerTeamUsers]);

  const [searchTerm, setSearchTerm] = useState('');
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [industryFilters, setIndustryFilters] = useState<string[]>([]);
  const [locationFilters, setLocationFilters] = useState<string[]>([]);
  const [industrySearch, setIndustrySearch] = useState('');
  const [locationSearch, setLocationSearch] = useState('');
  const [facetIndustries, setFacetIndustries] = useState<string[]>([]);
  const [companySizeFilters, setCompanySizeFilters] = useState<string[]>([]);
  const [statusFilters, setStatusFilters] = useState<string[]>([...DEFAULT_LIST_STATUS_FILTERS]);
  const [rangeType, setRangeType] = useState<'all' | 'custom'>('all');
  const [rangeStart, setRangeStart] = useState<string>('1');
  const [rangeEnd, setRangeEnd] = useState<string>('10');
  const [showPreview, setShowPreview] = useState(false);
  const [sortColumn, setSortColumn] = useState<'name' | 'industry' | 'location' | 'companySize' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [activeTab, setActiveTab] = useState('all');
  const [listTab, setListTab] = useState<'all' | 'assigned' | 'created' | 'archived'>('all');
  const [teamListTab, setTeamListTab] = useState<'all' | 'assigned' | 'created' | 'archived'>('all');
  const [viewSearchTerm, setViewSearchTerm] = useState('');
  const [isFollowUpDialogOpen, setIsFollowUpDialogOpen] = useState(false);
  const [followUpClient, setFollowUpClient] = useState<Client | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [isClientSheetOpen, setIsClientSheetOpen] = useState(false);

  // Saved lists state - initialize with demo data if empty
  const [savedLists, setSavedLists] = useState<SavedList[]>(() => {
    const stored = localStorage.getItem('savedLists');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.length > 0) return parsed;
    }
    // Return demo data if no stored lists
    return demoLists;
  });
  const [viewingListId, setViewingListId] = useState<string | null>(null);
  const [isNewListDialogOpen, setIsNewListDialogOpen] = useState(false);
  const [isEditListDialogOpen, setIsEditListDialogOpen] = useState(false);
  const {
    clients: serverPreviewClients,
    isFetching: previewFetching,
    isError: previewError,
    usingServerPreview,
  } = useListClientPreview(
    {
      industryFilters,
      locationFilters,
      tagFilters,
      companySizeFilters,
      subCompanyId:
        selectedAgencyId && selectedAgencyId !== 'all' && selectedAgencyId !== 'me'
          ? selectedAgencyId
          : selectedAgencyId === 'all'
            ? undefined
            : previewAgencyId,
    },
    isNewListDialogOpen || isEditListDialogOpen,
  );
  const [editingList, setEditingList] = useState<SavedList | null>(null);
  const [newListName, setNewListName] = useState('');
  const canAssignLists = useHasPermission('lists:assign');
  const [assigningList, setAssigningList] = useState<SavedList | null>(null);
  const [assignableUsers, setAssignableUsers] = useState<ApiAssignableUser[]>([]);
  const [assignLoading, setAssignLoading] = useState(false);
  const [pendingAssignees, setPendingAssignees] = useState<Assignee[]>([]);
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignSearch, setAssignSearch] = useState('');
  const [editingApiList, setEditingApiList] = useState<ApiMailingList | null>(null);
  const [editApiName, setEditApiName] = useState('');
  const [editApiDesc, setEditApiDesc] = useState('');
  const [editApiSaving, setEditApiSaving] = useState(false);

  // DB lists the current user created or is assigned to (backend widens the owner filter to include assignees).
  const { data: myDbLists = [], refetch: refetchMyDbLists } = useQuery({
    queryKey: ['my-mailing-lists', currentUser.id],
    queryFn: () => fetchMailingLists({ createdByIds: [currentUser.id] }),
    staleTime: 0,
  });

  const toAssignees = (l: ApiMailingList): Assignee[] =>
    l.assignedTo.map((a) => ({ id: a.id, name: `${a.firstName} ${a.lastName}`.trim() }));

  const dbByName = useMemo(() => {
    // Only map names that are unique in the DB result — ambiguous names can't be matched safely.
    const seen = new Map<string, ApiMailingList | null>();
    for (const l of myDbLists) {
      const key = l.name.toLowerCase();
      seen.set(key, seen.has(key) ? null : l);
    }
    const m = new Map<string, ApiMailingList>();
    for (const [key, l] of seen) if (l) m.set(key, l);
    return m;
  }, [myDbLists]);

  // Names that appear more than once among local lists — never overlay these (ambiguous).
  const duplicateLocalNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of savedLists) counts.set(l.name.toLowerCase(), (counts.get(l.name.toLowerCase()) ?? 0) + 1);
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [savedLists]);

  // Overlay DB assignment/archive state onto local lists (matched by unique name), and surface DB
  // lists assigned to me that have no local counterpart so assignees actually see them.
  const enrichedLists = useMemo(() => {
    const usedDbIds = new Set<string>();
    const merged: SavedList[] = savedLists.map((l) => {
      const key = l.name.toLowerCase();
      if (duplicateLocalNames.has(key)) return l; // ambiguous — leave as local-only
      const db = dbByName.get(key);
      if (!db || usedDbIds.has(db.id)) return l;
      usedDbIds.add(db.id);
      return { ...l, dbId: db.id, assignedTo: toAssignees(db), isArchived: db.isArchived };
    });
    for (const db of myDbLists) {
      if (usedDbIds.has(db.id)) continue; // already overlaid onto a local list by name
      // Surface every DB list I created or am assigned to that has no local counterpart —
      // elevated users' lists live only in the DB, not localStorage.
      merged.push({
        id: `db-${db.id}`,
        dbId: db.id,
        name: db.name,
        filters: { rangeType: 'all' },
        createdAt: new Date(db.createdAt),
        createdBy: {
          id: db.createdBy?.id ?? '',
          name: db.createdBy ? `${db.createdBy.firstName} ${db.createdBy.lastName}`.trim() : 'Unknown',
        },
        assignedTo: toAssignees(db),
        isArchived: db.isArchived,
      });
    }
    return merged;
  }, [savedLists, myDbLists, dbByName, duplicateLocalNames, currentUser.id]);

  // Refresh assignment overlay in real time — via Socket.io when available, and via the
  // notification SSE channel (reliable even when Socket.io is offline) as a fallback.
  useEffect(() => onListChanged(() => { void refetchMyDbLists(); void refetchAgencyLists(); }), [refetchMyDbLists, refetchAgencyLists]);
  useEffect(() => {
    const handler = () => { void refetchMyDbLists(); void refetchAgencyLists(); };
    window.addEventListener('notifications:refresh', handler);
    return () => window.removeEventListener('notifications:refresh', handler);
  }, [refetchMyDbLists, refetchAgencyLists]);

  // Effective owner ID for "Assigned/Created by" filters
  const effectiveListOwnerId = isPureManager && selectedUserId !== 'all' ? selectedUserId : currentUser.id;

  // Filter lists to only those created by or assigned to the selected team member
  const userFilteredBase = useMemo(() => {
    if (isElevated && selectedAgencyId === 'me') return enrichedLists.filter(l => l.createdBy.id === currentUser.id);
    if (!isPureManager || selectedUserId === 'all') return enrichedLists;
    return enrichedLists.filter(l => l.createdBy.id === selectedUserId || isAssignedToUser(l, selectedUserId));
  }, [isElevated, isPureManager, selectedAgencyId, selectedUserId, enrichedLists, currentUser.id]);

  // Extract unique values for filters — industries come from /clients/facets so newly-added industries always appear
  const allIndustries = facetIndustries.length > 0
    ? facetIndustries
    : Array.from(new Set(clients.map(c => c.industry).filter(Boolean))).sort();
  const allLocations = Array.from(new Set(clients.map(c => c.location).filter(Boolean))).sort();
  const allTags = Array.from(new Set(clients.flatMap(c => c.tags))).sort();
  const allCompanySizes = Array.from(new Set(clients.map(c => c.companySize).filter(Boolean))).sort();

  const toggleIndustryFilter = (industry: string) => {
    setIndustryFilters(prev => prev.includes(industry) ? prev.filter(i => i !== industry) : [...prev, industry]);
  };
  
  const toggleLocationFilter = (location: string) => {
    setLocationFilters(prev => prev.includes(location) ? prev.filter(l => l !== location) : [...prev, location]);
  };
  
  const toggleTagFilter = (tag: string) => {
    setTagFilters(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };
  
  const toggleCompanySizeFilter = (size: string) => {
    setCompanySizeFilters(prev => prev.includes(size) ? prev.filter(s => s !== size) : [...prev, size]);
  };

  const toggleStatusFilter = (status: string) => {
    setStatusFilters(prev => prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]);
  };

  const clearAllFilters = () => {
    setSearchTerm('');
    setIndustryFilters([]);
    setLocationFilters([]);
    setTagFilters([]);
    setCompanySizeFilters([]);
    setStatusFilters([...DEFAULT_LIST_STATUS_FILTERS]);
    setRangeType('all');
    setRangeStart('1');
    setRangeEnd('10');
    setShowPreview(false);
  };

  const saveCurrentList = () => {
    if (!newListName.trim()) {
      toast({
        description: 'Please enter a list name',
        variant: 'destructive'
      });
      return;
    }
    const newList: SavedList = {
      id: `list-${Date.now()}`,
      name: newListName.trim(),
      filters: {
        industryFilters,
        locationFilters,
        tagFilters,
        companySizeFilters,
        statusFilters,
        rangeType,
        rangeStart: rangeType === 'custom' ? parseInt(rangeStart) : undefined,
        rangeEnd: rangeType === 'custom' ? parseInt(rangeEnd) : undefined
      },
      createdAt: new Date(),
      createdBy: {
        id: effectiveSelfId,
        name: currentUser.name
      }
    };
    const updatedLists = [...savedLists, newList];
    setSavedLists(updatedLists);
    localStorage.setItem('savedLists', JSON.stringify(updatedLists));
    // Sync to DB and populate members from current filters
    createMailingList({ name: newList.name, subCompanyId: listWriteAgencyId }).then(async (dbList) => {
      if (!dbList) return;
      const clientIds = previewClients.map((c) => c.id);
      if (clientIds.length > 0) await addMembersToList(dbList.id, clientIds);
      void refetchMyDbLists();
    });
    setIsNewListDialogOpen(false);
    setNewListName('');
    clearAllFilters();
    toast({
      description: `List "${newList.name}" saved successfully`
    });
  };

  const updateList = () => {
    if (!editingList || !newListName.trim()) {
      toast({
        description: 'Please enter a list name',
        variant: 'destructive'
      });
      return;
    }
    const updatedList: SavedList = {
      ...editingList,
      name: newListName.trim(),
      filters: {
        industryFilters,
        locationFilters,
        tagFilters,
        companySizeFilters,
        statusFilters,
        rangeType,
        rangeStart: rangeType === 'custom' ? parseInt(rangeStart) : undefined,
        rangeEnd: rangeType === 'custom' ? parseInt(rangeEnd) : undefined
      }
    };
    const updatedLists = savedLists.map(l => l.id === editingList.id ? updatedList : l);
    setSavedLists(updatedLists);
    localStorage.setItem('savedLists', JSON.stringify(updatedLists));
    setIsEditListDialogOpen(false);
    setEditingList(null);
    setNewListName('');
    clearAllFilters();
    toast({
      description: `List "${updatedList.name}" updated successfully`
    });
  };

  const openEditDialog = (list: SavedList) => {
    setEditingList(list);
    setNewListName(list.name);
    setIndustryFilters(list.filters.industryFilters || []);
    setLocationFilters(list.filters.locationFilters || []);
    setTagFilters(list.filters.tagFilters || []);
    setCompanySizeFilters(list.filters.companySizeFilters || []);
    setStatusFilters(list.filters.statusFilters ?? ['contacted', 'active', 'lost', 'ex', 'none']);
    setRangeType(list.filters.rangeType);
    setRangeStart(list.filters.rangeStart?.toString() || '1');
    setRangeEnd(list.filters.rangeEnd?.toString() || '10');
    setShowPreview(false);
    setIsEditListDialogOpen(true);
  };

  const viewListData = (list: SavedList) => {
    setIndustryFilters(list.filters.industryFilters || []);
    setLocationFilters(list.filters.locationFilters || []);
    setTagFilters(list.filters.tagFilters || []);
    setCompanySizeFilters(list.filters.companySizeFilters || []);
    setViewingListId(list.id);
  };

  const backToLists = () => {
    setViewingListId(null);
    setActiveTab('all');
    setViewSearchTerm('');
    clearAllFilters();
  };

  const deleteList = (listId: string) => {
    const target = enrichedLists.find(l => l.id === listId);
    const updatedLists = savedLists.filter(l => l.id !== listId);
    setSavedLists(updatedLists);
    localStorage.setItem('savedLists', JSON.stringify(updatedLists));
    if (viewingListId === listId) {
      setViewingListId(null);
    }
    // Delete the DB list directly by id when known (covers assigned/DB-only lists too).
    if (target?.dbId) {
      deleteMailingList(target.dbId).then(() => { void refetchMyDbLists(); });
    }
    toast({
      description: 'List deleted successfully'
    });
  };

  const setArchivedState = async (listId: string, archived: boolean) => {
    const target = enrichedLists.find(l => l.id === listId);
    const successMsg = archived ? 'List archived successfully' : 'List restored successfully';

    if (target?.dbId) {
      const updated = await archiveMailingList(target.dbId, archived);
      if (!updated) {
        toast({ description: `Could not ${archived ? 'archive' : 'restore'} this list`, variant: 'destructive' });
        return;
      }
      void refetchMyDbLists();
    }

    // Reflect in the local (filter-defined) list registry when present.
    if (savedLists.some(l => l.id === listId)) {
      const updatedLists = savedLists.map(l => (l.id === listId ? { ...l, isArchived: archived } : l));
      setSavedLists(updatedLists);
      localStorage.setItem('savedLists', JSON.stringify(updatedLists));
    }
    toast({ description: successMsg });
  };

  const archiveList = (listId: string) => setArchivedState(listId, true);
  const restoreList = (listId: string) => setArchivedState(listId, false);

  const openAssignDialog = async (list: SavedList) => {
    if (!list.dbId) {
      toast({ description: 'Add at least one client to this list before assigning it.', variant: 'destructive' });
      return;
    }
    setAssigningList(list);
    setPendingAssignees(assigneeList(list)); // staged selection starts from current assignees
    setAssignSearch('');
    setAssignLoading(true);
    const users = await fetchAssignableUsers(list.dbId);
    setAssignableUsers(users);
    setAssignLoading(false);
  };

  // Toggle a person in the staged selection (no network call until Done).
  const stagePerson = (person: Assignee) => {
    setPendingAssignees((prev) =>
      prev.some((p) => p.id === person.id) ? prev : [...prev, person],
    );
  };
  const unstagePerson = (userId: string) => {
    setPendingAssignees((prev) => prev.filter((p) => p.id !== userId));
  };

  // Commit the staged selection: apply adds + removes vs the list's current assignees.
  const saveAssignees = async () => {
    if (!assigningList?.dbId) { setAssigningList(null); return; }
    const original = assigneeList(assigningList).map((a) => a.id);
    const pending = pendingAssignees.map((p) => p.id);
    const toAdd = pending.filter((id) => !original.includes(id));
    const toRemove = original.filter((id) => !pending.includes(id));

    if (toAdd.length === 0 && toRemove.length === 0) { setAssigningList(null); return; }

    setAssignSaving(true);
    try {
      if (toAdd.length > 0) await addListAssignees(assigningList.dbId, toAdd);
      for (const id of toRemove) await removeListAssignee(assigningList.dbId, id);
      refreshAllLists();
      toast({ description: 'Assignments updated' });
    } catch {
      toast({ description: 'Could not update assignments', variant: 'destructive' });
    } finally {
      setAssignSaving(false);
      setAssigningList(null);
    }
  };

  const refreshAllLists = () => { void refetchMyDbLists(); void refetchAgencyLists(); };

  // Adapt a DB list (agency drill-in view) to the local SavedList shape for the shared handlers.
  const apiListToSaved = (l: ApiMailingList): SavedList => ({
    id: `db-${l.id}`,
    dbId: l.id,
    name: l.name,
    filters: { rangeType: 'all' },
    createdAt: new Date(l.createdAt),
    createdBy: {
      id: l.createdBy?.id ?? '',
      name: l.createdBy ? `${l.createdBy.firstName} ${l.createdBy.lastName}`.trim() : 'Unknown',
    },
    assignedTo: toAssignees(l),
    isArchived: l.isArchived,
  });

  const archiveApiList = async (l: ApiMailingList) => {
    const updated = await archiveMailingList(l.id, !l.isArchived);
    if (!updated) { toast({ description: 'Could not update this list', variant: 'destructive' }); return; }
    refreshAllLists();
    toast({ description: l.isArchived ? 'List restored successfully' : 'List archived successfully' });
  };

  const deleteApiList = async (l: ApiMailingList) => {
    await deleteMailingList(l.id);
    refreshAllLists();
    toast({ description: 'List deleted successfully' });
  };

  const openEditApiList = (l: ApiMailingList) => {
    setEditingApiList(l);
    setEditApiName(l.name);
    setEditApiDesc(l.description ?? '');
  };

  const saveEditApiList = async () => {
    if (!editingApiList || !editApiName.trim()) {
      toast({ description: 'Please enter a list name', variant: 'destructive' });
      return;
    }
    setEditApiSaving(true);
    const updated = await updateMailingList(editingApiList.id, {
      name: editApiName.trim(),
      description: editApiDesc.trim() || undefined,
    });
    setEditApiSaving(false);
    if (!updated) {
      toast({ description: 'Could not update this list', variant: 'destructive' });
      return;
    }
    refreshAllLists();
    setEditingApiList(null);
    toast({ description: 'List updated successfully' });
  };

  // Filter lists based on tab
  const getFilteredLists = () => {
    return userFilteredBase.filter(list => {
      switch (listTab) {
        case 'all':
          return !list.isArchived;
        case 'assigned':
          return !list.isArchived && isAssignedToUser(list, effectiveListOwnerId);
        case 'created':
          return !list.isArchived && list.createdBy.id === effectiveListOwnerId;
        case 'archived':
          return list.isArchived;
        default:
          return !list.isArchived;
      }
    });
  };

  const filteredLists = getFilteredLists();

  // Check if client has an assigned lead
  const hasAssignedLead = (clientId: string) => {
    return leads.some(l => l.clientId === clientId && l.subCompanyId === (listWriteAgencyId ?? currentSubCompany.id));
  };

  const matchesStatusFilters = (clientStatus: string, filters: string[]) => {
    if (filters.length === 0) return true;
    if (!clientStatus && filters.includes('none')) return true;
    if (clientStatus && filters.includes(clientStatus)) return true;
    return false;
  };

  // Apply filters for preview and viewing.
  // When industry/location/tags/size are set, matching clients come from the API
  // (full agency), not the 500-client snapshot used for the rest of this page.
  const getFilteredClients = () => {
    const source = usingServerPreview ? serverPreviewClients : clients;
    const applyStatus = !usingServerPreview || !isDefaultListStatusSelection(statusFilters);
    return applyListAttributeFilters(source, {
      industryFilters,
      locationFilters,
      tagFilters,
      companySizeFilters,
    }).filter((client) => {
      if (applyStatus && statusFilters.length > 0 && !matchesStatusFilters(client.status, statusFilters)) {
        return false;
      }
      if (searchTerm && !client.name.toLowerCase().includes(searchTerm.toLowerCase()) && !client.address.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }
      return true;
    });
  };

  const filteredClients = getFilteredClients();

  // Apply range
  const getClientsWithRange = (filtered: typeof clients) => {
    if (rangeType === 'all') {
      return filtered;
    }
    const start = parseInt(rangeStart) - 1;
    const end = parseInt(rangeEnd);
    return filtered.slice(start, end);
  };

  const previewClients = getClientsWithRange(filteredClients);
  const totalFilteredCount = filteredClients.length;
  const rangedCount = getClientsWithRange(filteredClients).length;

  // Apply sorting for viewing list
  const viewingList = viewingListId ? enrichedLists.find(l => l.id === viewingListId) : null;

  // For DB-backed lists (created + synced, or assigned to me), the members are the source of truth —
  // show the actual clients in the list, not a re-derivation from local filter criteria.
  const { data: viewMembers = [] } = useQuery({
    queryKey: ['view-list-members', viewingList?.dbId ?? ''],
    queryFn: () => fetchMailingListMembers(viewingList!.dbId!),
    enabled: !!viewingList?.dbId,
    staleTime: 0,
  });
  const viewMemberClientIds = useMemo(() => new Set(viewMembers.map(m => m.clientId)), [viewMembers]);

  const getViewListClients = () => {
    if (!viewingList) return [];
    const useDbMembers = !!viewingList.dbId;
    const activeStatusFilters = viewingList.filters.statusFilters ?? ['contacted', 'active', 'lost', 'ex', 'none'];
    let filtered = clients.filter(client => {
      if (useDbMembers) {
        // Membership is defined by the DB list, not by filter criteria.
        if (!viewMemberClientIds.has(client.id)) return false;
        if (activeTab !== 'all' && client.status !== activeTab) return false;
        if (viewSearchTerm && !client.name.toLowerCase().includes(viewSearchTerm.toLowerCase()) && !client.address.toLowerCase().includes(viewSearchTerm.toLowerCase())) {
          return false;
        }
        return true;
      }
      if (!matchesStatusFilters(client.status, activeStatusFilters)) {
        return false;
      }
      // Apply tab filter
      if (activeTab !== 'all' && client.status !== activeTab) {
        return false;
      }

      // Apply search filter
      if (viewSearchTerm && !client.name.toLowerCase().includes(viewSearchTerm.toLowerCase()) && !client.address.toLowerCase().includes(viewSearchTerm.toLowerCase())) {
        return false;
      }

      if (viewingList.filters.industryFilters && viewingList.filters.industryFilters.length > 0 && !matchesAnyFilter(client.industry, viewingList.filters.industryFilters)) {
        return false;
      }
      if (viewingList.filters.locationFilters && viewingList.filters.locationFilters.length > 0 && !matchesAnyFilter(client.location, viewingList.filters.locationFilters)) {
        return false;
      }
      if (viewingList.filters.tagFilters && viewingList.filters.tagFilters.length > 0 && !client.tags.some(tag => viewingList.filters.tagFilters!.includes(tag))) {
        return false;
      }
      if (viewingList.filters.companySizeFilters && viewingList.filters.companySizeFilters.length > 0 && !matchesAnyFilter(client.companySize, viewingList.filters.companySizeFilters)) {
        return false;
      }
      return true;
    });
    
    if (viewingList.filters.rangeType === 'custom' && viewingList.filters.rangeStart && viewingList.filters.rangeEnd) {
      const start = viewingList.filters.rangeStart - 1;
      const end = viewingList.filters.rangeEnd;
      filtered = filtered.slice(start, end);
    }
    
    return filtered;
  };

  const sortedClients = [...(viewingList ? getViewListClients() : filteredClients)].sort((a, b) => {
    if (!sortColumn) return 0;
    const aValue = a[sortColumn];
    const bValue = b[sortColumn];
    if (sortDirection === 'asc') {
      return aValue > bValue ? 1 : -1;
    } else {
      return aValue < bValue ? 1 : -1;
    }
  });

  const handleSort = (column: 'name' | 'industry' | 'location' | 'companySize') => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const handleViewClient = (client: Client) => {
    setSelectedClient(client);
    setIsClientSheetOpen(true);
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/10 text-green-600 border-green-500/20';
      case 'contacted':
        return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
      case 'lost':
        return 'bg-red-500/10 text-red-600 border-red-500/20';
      case 'ex':
        return 'bg-slate-900/10 text-slate-900 border-slate-900/20';
      case 'unsubscribed':
        return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
      case 'permanently_closed':
        return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
      default:
        return '';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pt-6">
        <div>
          <h1 className="text-3xl font-bold">Lists</h1>
          <p className="text-muted-foreground">
            {viewingList ? `Viewing: ${viewingList.name}` : 'Manage and organize your client lists'}
          </p>
        </div>
        <div className="flex gap-2">

          {viewingList && (
            <Button variant="outline" onClick={backToLists}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Lists
            </Button>
          )}
          {canManageLists && (
          <Dialog open={isNewListDialogOpen} onOpenChange={setIsNewListDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create List
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create New List</DialogTitle>
                <DialogDescription>
                  Configure filters for your list
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="list-name">List Name</Label>
                  <Input
                    id="list-name"
                    placeholder="Enter list name"
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                  />
                </div>
                <div className="space-y-4">
                  <div>
                    <Label>Range</Label>
                    <div className="space-y-2">
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="range"
                            value="all"
                            checked={rangeType === 'all'}
                            onChange={(e) => setRangeType(e.target.value as 'all' | 'custom')}
                            className="w-4 h-4"
                          />
                          <span>All</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="range"
                            value="custom"
                            checked={rangeType === 'custom'}
                            onChange={(e) => setRangeType(e.target.value as 'all' | 'custom')}
                            className="w-4 h-4"
                          />
                          <span>Custom Range</span>
                        </label>
                      </div>
                      {rangeType === 'custom' && (
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min="1"
                            placeholder="Start"
                            value={rangeStart}
                            onChange={(e) => setRangeStart(e.target.value)}
                            className="w-24"
                          />
                          <span>-</span>
                          <Input
                            type="number"
                            min="1"
                            placeholder="End"
                            value={rangeEnd}
                            onChange={(e) => setRangeEnd(e.target.value)}
                            className="w-24"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Industry</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-between">
                            <span>{industryFilters.length > 0 ? `${industryFilters.length} selected` : 'All Industries'}</span>
                            <Filter className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-2">
                          <Input
                            placeholder="Search..."
                            value={industrySearch}
                            onChange={(e) => setIndustrySearch(e.target.value)}
                            className="mb-2 h-8 text-sm"
                          />
                          <div
                            className="space-y-2 h-48 overflow-y-auto"
                            onWheel={(e) => e.stopPropagation()}
                          >
                            {allIndustries
                              .filter((i) => i.toLowerCase().includes(industrySearch.toLowerCase()))
                              .map((industry) => (
                                <div key={industry} className="flex items-center space-x-2 px-1">
                                  <Checkbox
                                    id={`industry-${industry}`}
                                    checked={industryFilters.includes(industry)}
                                    onCheckedChange={() => toggleIndustryFilter(industry)}
                                  />
                                  <Label htmlFor={`industry-${industry}`} className="cursor-pointer flex-1">
                                    {industry}
                                  </Label>
                                </div>
                              ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div>
                      <Label>Location</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-between">
                            <span>{locationFilters.length > 0 ? `${locationFilters.length} selected` : 'All Locations'}</span>
                            <Filter className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-2">
                          <Input
                            placeholder="Search..."
                            value={locationSearch}
                            onChange={(e) => setLocationSearch(e.target.value)}
                            className="mb-2 h-8 text-sm"
                          />
                          <div
                            className="space-y-2 h-48 overflow-y-auto"
                            onWheel={(e) => e.stopPropagation()}
                          >
                            {allLocations
                              .filter((l) => l.toLowerCase().includes(locationSearch.toLowerCase()))
                              .map((location) => (
                                <div key={location} className="flex items-center space-x-2 px-1">
                                  <Checkbox
                                    id={`location-${location}`}
                                    checked={locationFilters.includes(location)}
                                    onCheckedChange={() => toggleLocationFilter(location)}
                                  />
                                  <Label htmlFor={`location-${location}`} className="cursor-pointer flex-1">
                                    {location}
                                  </Label>
                                </div>
                              ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div>
                      <Label>Tags</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-between">
                            <span>{tagFilters.length > 0 ? `${tagFilters.length} selected` : 'All Tags'}</span>
                            <Filter className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64">
                          <div className="space-y-2">
                            {allTags.map((tag) => (
                              <div key={tag} className="flex items-center space-x-2">
                                <Checkbox
                                  id={`tag-${tag}`}
                                  checked={tagFilters.includes(tag)}
                                  onCheckedChange={() => toggleTagFilter(tag)}
                                />
                                <Label htmlFor={`tag-${tag}`} className="cursor-pointer flex-1">
                                  {tag}
                                </Label>
                              </div>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div>
                      <Label>Company Size</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-between">
                            <span>{companySizeFilters.length > 0 ? `${companySizeFilters.length} selected` : 'All Sizes'}</span>
                            <Filter className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64">
                          <div className="space-y-2">
                            {allCompanySizes.map((size) => (
                              <div key={size} className="flex items-center space-x-2">
                                <Checkbox
                                  id={`size-${size}`}
                                  checked={companySizeFilters.includes(size)}
                                  onCheckedChange={() => toggleCompanySizeFilter(size)}
                                />
                                <Label htmlFor={`size-${size}`} className="cursor-pointer flex-1">
                                  {size}
                                </Label>
                              </div>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Client Status</Label>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  {[
                    { value: 'contacted', label: 'Contacted' },
                    { value: 'active', label: 'Active' },
                    { value: 'lost', label: 'Lost' },
                    { value: 'ex', label: 'Ex Client' },
                    { value: 'none', label: 'No Status' },
                  ].map(({ value, label }) => (
                    <div key={value} className="flex items-center space-x-2">
                      <Checkbox
                        id={`status-${value}`}
                        checked={statusFilters.includes(value)}
                        onCheckedChange={() => toggleStatusFilter(value)}
                      />
                      <Label htmlFor={`status-${value}`} className="cursor-pointer font-normal">
                        {label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              {showPreview && (
                <div className="space-y-2 border-t pt-4">
                  <div className="flex items-center justify-between">
                    <Label>Preview</Label>
                    <Badge variant="secondary">
                      {previewFetching && usingServerPreview
                        ? 'Loading…'
                        : previewError
                          ? 'Error'
                          : `${rangedCount} ${rangedCount === 1 ? 'client' : 'clients'}`}
                    </Badge>
                  </div>
                  {previewFetching && usingServerPreview ? (
                    <p className="text-sm text-muted-foreground text-center py-3 flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Finding matching clients…
                    </p>
                  ) : previewError ? (
                    <p className="text-sm text-muted-foreground text-center py-3">Could not load clients for this agency. Try again.</p>
                  ) : previewClients.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-3">No clients match these filters</p>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {previewClients.map((client) => {
                        return (
                          <div key={client.id} className="rounded-lg border bg-card text-sm overflow-hidden">
                            {/* Company info */}
                            <div className="px-3 pt-2.5 pb-2">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="font-medium truncate">{client.name}</span>
                                <Badge variant="secondary" className={`capitalize text-[10px] py-0 px-1.5 h-4 shrink-0 ${getStatusBadgeClass(client.status)}`}>
                                  {client.status}
                                </Badge>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                                {client.industry && <span className="flex items-center gap-1"><Building2 className="h-3 w-3 shrink-0" />{client.industry}</span>}
                                {client.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3 shrink-0" />{client.location}</span>}
                                {client.companySize && <span className="flex items-center gap-1"><Users className="h-3 w-3 shrink-0" />{client.companySize}</span>}
                              </div>
                              {client.tags.length > 0 && (
                                <div className="flex gap-1 flex-wrap mt-1.5">
                                  {client.tags.map(t => <Badge key={t} variant="outline" className="text-[10px] py-0 px-1.5 h-4">{t}</Badge>)}
                                </div>
                              )}
                            </div>

                            {/* Primary contact strip */}
                            {(() => {
                              const primary = client.contacts.find(c => c.isPrimary) ?? client.contacts[0];
                              if (!primary) return null;
                              const otherCount = client.contacts.length - 1;
                              return (
                                <div className="border-t px-3 py-2 bg-muted/20 flex items-start gap-2">
                                  <div className="h-5 w-5 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-px">
                                    <span className="text-[9px] font-bold text-primary leading-none">
                                      {primary.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                                    </span>
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1 flex-wrap">
                                      <span className="font-medium text-xs">{primary.name}</span>
                                      {primary.title && <span className="text-[11px] text-muted-foreground">· {primary.title}</span>}
                                    </div>
                                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
                                      {primary.phone && <span className="flex items-center gap-1"><PhoneCall className="h-3 w-3 shrink-0" />{primary.phone}{primary.phoneExtension ? ` x${primary.phoneExtension}` : ''}</span>}
                                      {primary.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3 shrink-0" />{primary.email}</span>}
                                    </div>
                                  </div>
                                  {otherCount > 0 && (
                                    <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">+{otherCount} more</span>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => {
                  setIsNewListDialogOpen(false);
                  setNewListName('');
                  clearAllFilters();
                }}>
                  Cancel
                </Button>
                <Button variant="secondary" onClick={() => setShowPreview(true)} disabled={previewFetching && usingServerPreview}>
                  <Eye className="h-4 w-4 mr-2" />
                  Show Preview
                </Button>
                <Button onClick={saveCurrentList} disabled={(previewFetching && usingServerPreview) || previewError}>
                  <Save className="h-4 w-4 mr-2" />
                  Save List
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          )}

          {canManageLists && (
          <Dialog open={isEditListDialogOpen} onOpenChange={setIsEditListDialogOpen}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Edit List</DialogTitle>
                <DialogDescription>
                  Update filters for your list
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="edit-list-name">List Name</Label>
                  <Input
                    id="edit-list-name"
                    placeholder="Enter list name"
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                  />
                </div>
                <div className="space-y-4">
                  <div>
                    <Label>Range</Label>
                    <div className="space-y-2">
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="edit-range"
                            value="all"
                            checked={rangeType === 'all'}
                            onChange={(e) => setRangeType(e.target.value as 'all' | 'custom')}
                            className="w-4 h-4"
                          />
                          <span>All</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="edit-range"
                            value="custom"
                            checked={rangeType === 'custom'}
                            onChange={(e) => setRangeType(e.target.value as 'all' | 'custom')}
                            className="w-4 h-4"
                          />
                          <span>Custom Range</span>
                        </label>
                      </div>
                      {rangeType === 'custom' && (
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min="1"
                            placeholder="Start"
                            value={rangeStart}
                            onChange={(e) => setRangeStart(e.target.value)}
                            className="w-24"
                          />
                          <span>-</span>
                          <Input
                            type="number"
                            min="1"
                            placeholder="End"
                            value={rangeEnd}
                            onChange={(e) => setRangeEnd(e.target.value)}
                            className="w-24"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Industry</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-between">
                            <span>{industryFilters.length > 0 ? `${industryFilters.length} selected` : 'All Industries'}</span>
                            <Filter className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-2">
                          <Input
                            placeholder="Search..."
                            value={industrySearch}
                            onChange={(e) => setIndustrySearch(e.target.value)}
                            className="mb-2 h-8 text-sm"
                          />
                          <div
                            className="space-y-2 h-48 overflow-y-auto"
                            onWheel={(e) => e.stopPropagation()}
                          >
                            {allIndustries
                              .filter((i) => i.toLowerCase().includes(industrySearch.toLowerCase()))
                              .map((industry) => (
                                <div key={industry} className="flex items-center space-x-2 px-1">
                                  <Checkbox
                                    id={`edit-industry-${industry}`}
                                    checked={industryFilters.includes(industry)}
                                    onCheckedChange={() => toggleIndustryFilter(industry)}
                                  />
                                  <Label htmlFor={`edit-industry-${industry}`} className="cursor-pointer flex-1">
                                    {industry}
                                  </Label>
                                </div>
                              ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div>
                      <Label>Location</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-between">
                            <span>{locationFilters.length > 0 ? `${locationFilters.length} selected` : 'All Locations'}</span>
                            <Filter className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-2">
                          <Input
                            placeholder="Search..."
                            value={locationSearch}
                            onChange={(e) => setLocationSearch(e.target.value)}
                            className="mb-2 h-8 text-sm"
                          />
                          <div
                            className="space-y-2 h-48 overflow-y-auto"
                            onWheel={(e) => e.stopPropagation()}
                          >
                            {allLocations
                              .filter((l) => l.toLowerCase().includes(locationSearch.toLowerCase()))
                              .map((location) => (
                                <div key={location} className="flex items-center space-x-2 px-1">
                                  <Checkbox
                                    id={`edit-location-${location}`}
                                    checked={locationFilters.includes(location)}
                                    onCheckedChange={() => toggleLocationFilter(location)}
                                  />
                                  <Label htmlFor={`edit-location-${location}`} className="cursor-pointer flex-1">
                                    {location}
                                  </Label>
                                </div>
                              ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div>
                      <Label>Tags</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-between">
                            <span>{tagFilters.length > 0 ? `${tagFilters.length} selected` : 'All Tags'}</span>
                            <Filter className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64">
                          <div className="space-y-2">
                            {allTags.map((tag) => (
                              <div key={tag} className="flex items-center space-x-2">
                                <Checkbox
                                  id={`edit-tag-${tag}`}
                                  checked={tagFilters.includes(tag)}
                                  onCheckedChange={() => toggleTagFilter(tag)}
                                />
                                <Label htmlFor={`edit-tag-${tag}`} className="cursor-pointer flex-1">
                                  {tag}
                                </Label>
                              </div>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div>
                      <Label>Company Size</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-between">
                            <span>{companySizeFilters.length > 0 ? `${companySizeFilters.length} selected` : 'All Sizes'}</span>
                            <Filter className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64">
                          <div className="space-y-2">
                            {allCompanySizes.map((size) => (
                              <div key={size} className="flex items-center space-x-2">
                                <Checkbox
                                  id={`edit-size-${size}`}
                                  checked={companySizeFilters.includes(size)}
                                  onCheckedChange={() => toggleCompanySizeFilter(size)}
                                />
                                <Label htmlFor={`edit-size-${size}`} className="cursor-pointer flex-1">
                                  {size}
                                </Label>
                              </div>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Client Status</Label>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  {[
                    { value: 'contacted', label: 'Contacted' },
                    { value: 'active', label: 'Active' },
                    { value: 'lost', label: 'Lost' },
                    { value: 'ex', label: 'Ex Client' },
                    { value: 'none', label: 'No Status' },
                  ].map(({ value, label }) => (
                    <div key={value} className="flex items-center space-x-2">
                      <Checkbox
                        id={`edit-status-${value}`}
                        checked={statusFilters.includes(value)}
                        onCheckedChange={() => toggleStatusFilter(value)}
                      />
                      <Label htmlFor={`edit-status-${value}`} className="cursor-pointer font-normal">
                        {label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              {showPreview && (
                <div className="space-y-2 border-t pt-4">
                  <div className="flex items-center justify-between">
                    <Label>Preview</Label>
                    <Badge variant="secondary">
                      {previewFetching && usingServerPreview
                        ? 'Loading…'
                        : previewError
                          ? 'Error'
                          : `${rangedCount} ${rangedCount === 1 ? 'client' : 'clients'}`}
                    </Badge>
                  </div>
                  {previewFetching && usingServerPreview ? (
                    <p className="text-sm text-muted-foreground text-center py-3 flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Finding matching clients…
                    </p>
                  ) : previewError ? (
                    <p className="text-sm text-muted-foreground text-center py-3">Could not load clients for this agency. Try again.</p>
                  ) : previewClients.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-3">No clients match these filters</p>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {previewClients.map((client) => {
                        return (
                          <div key={client.id} className="rounded-lg border bg-card text-sm overflow-hidden">
                            {/* Company info */}
                            <div className="px-3 pt-2.5 pb-2">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="font-medium truncate">{client.name}</span>
                                <Badge variant="secondary" className={`capitalize text-[10px] py-0 px-1.5 h-4 shrink-0 ${getStatusBadgeClass(client.status)}`}>
                                  {client.status}
                                </Badge>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                                {client.industry && <span className="flex items-center gap-1"><Building2 className="h-3 w-3 shrink-0" />{client.industry}</span>}
                                {client.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3 shrink-0" />{client.location}</span>}
                                {client.companySize && <span className="flex items-center gap-1"><Users className="h-3 w-3 shrink-0" />{client.companySize}</span>}
                              </div>
                              {client.tags.length > 0 && (
                                <div className="flex gap-1 flex-wrap mt-1.5">
                                  {client.tags.map(t => <Badge key={t} variant="outline" className="text-[10px] py-0 px-1.5 h-4">{t}</Badge>)}
                                </div>
                              )}
                            </div>

                            {/* Primary contact strip */}
                            {(() => {
                              const primary = client.contacts.find(c => c.isPrimary) ?? client.contacts[0];
                              if (!primary) return null;
                              const otherCount = client.contacts.length - 1;
                              return (
                                <div className="border-t px-3 py-2 bg-muted/20 flex items-start gap-2">
                                  <div className="h-5 w-5 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-px">
                                    <span className="text-[9px] font-bold text-primary leading-none">
                                      {primary.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                                    </span>
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1 flex-wrap">
                                      <span className="font-medium text-xs">{primary.name}</span>
                                      {primary.title && <span className="text-[11px] text-muted-foreground">· {primary.title}</span>}
                                    </div>
                                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
                                      {primary.phone && <span className="flex items-center gap-1"><PhoneCall className="h-3 w-3 shrink-0" />{primary.phone}{primary.phoneExtension ? ` x${primary.phoneExtension}` : ''}</span>}
                                      {primary.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3 shrink-0" />{primary.email}</span>}
                                    </div>
                                  </div>
                                  {otherCount > 0 && (
                                    <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">+{otherCount} more</span>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => {
                  setIsEditListDialogOpen(false);
                  setEditingList(null);
                  setNewListName('');
                  clearAllFilters();
                }}>
                  Cancel
                </Button>
                <Button variant="secondary" onClick={() => setShowPreview(true)} disabled={previewFetching && usingServerPreview}>
                  <Eye className="h-4 w-4 mr-2" />
                  Show Preview
                </Button>
                <Button onClick={updateList} disabled={(previewFetching && usingServerPreview) || previewError}>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          )}
        </div>
      </div>

      {/* Elevated (director/OM): agency-level filter rows */}
      <StickyHeader zIndex={40}>
        <ScopeFilterBar show={showHierarchyFilters} filterRowProps={filterRowProps} />
      </StickyHeader>

      {/* All Agencies — one section per agency */}
      {showAgencySections && (
        agencies.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-12">No agencies in scope</p>
        ) : (
          <div className="space-y-4">
            {agencies.map((agency) => (
              <AgencyListsSection
                key={agency.id}
                agency={agency}
                onViewAgency={() => setSelectedAgencyId(agency.id)}
                ownerIds={scopeOwnerIds}
                scopeKey={`${scopeKey}|${scopeOwnerIds?.join(',') ?? ''}`}
              />
            ))}
          </div>
        )
      )}

      {/* Manager / Team — one section per user (local lists for pure managers;
          API mailing lists for elevated All Managers / All Team). */}
      {showAllTeamView && (
        managerTeamUsers.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-12">
            {showManagerSections ? 'No managers / team in this agency' : 'No team members in this scope'}
          </p>
        ) : isElevatedAllTeamView && agencyListsLoading ? (
          <p className="text-center text-sm text-muted-foreground py-12">Loading lists…</p>
        ) : (
          <div className="space-y-6">
            {managerTeamUsers.map((user) => {
              const userLists = isElevatedAllTeamView
                ? filteredAgencyLists.filter((l) => l.createdBy?.id === user.id || isAssignedToUser(l, user.id))
                : enrichedLists.filter(
                    (l) =>
                      !l.isArchived &&
                      (l.createdBy.id === user.id || isAssignedToUser(l, user.id)),
                  );
              return (
                <div key={user.id}>
                  <PersonSectionHeader
                    user={user}
                    roleTitle={getUserRoleTitle(user)}
                    onView={() =>
                      showManagerSections ? setSelectedManagerId(user.id) : setSelectedUserId(user.id)
                    }
                  />
                  <Card>
                    <CardContent className="p-0">
                      <PaginatedTeamUserListsCard
                        lists={userLists as any[]}
                        mode={isElevatedAllTeamView ? 'elevated' : 'local'}
                        canManageLists={canManageLists}
                        onViewListData={viewListData}
                        onEditList={openEditDialog}
                        onArchiveList={archiveList}
                        onDeleteList={deleteList}
                      />
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Elevated: agency lists when drilled / specific user — not in people-section mode */}
      {shouldFetchAgencyLists && !viewingSelf && !showAllTeamView && selectedAgencyId !== 'all' && (
        <Card>
          <CardHeader>
            <CardTitle>Agency Mailing Lists</CardTitle>
          </CardHeader>
          <CardContent>
            {agencyListsLoading ? (
              <p className="text-sm text-muted-foreground">Loading lists…</p>
            ) : filteredAgencyLists.length === 0 ? (
              <p className="text-sm text-muted-foreground">No mailing lists found.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Members</TableHead>
                    <TableHead>Assigned To</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAgencyLists.map((list) => (
                    <TableRow key={list.id}>
                      <TableCell className="font-medium">{list.name}</TableCell>
                      <TableCell className="text-muted-foreground">{list.description ?? '—'}</TableCell>
                      <TableCell className="text-right">{list.memberCount}</TableCell>
                      <TableCell>{assigneeNames(list)}</TableCell>
                      <TableCell>{new Date(list.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {!list.isArchived && canAssignLists && list.createdBy?.id === currentUser.id && (
                            <Button variant="ghost" size="sm" title="Assign list" onClick={() => openAssignDialog(apiListToSaved(list))}>
                              <Users className="h-4 w-4" />
                            </Button>
                          )}
                          {!list.isArchived && canManageLists && (
                            <Button variant="ghost" size="sm" title="Edit" onClick={() => openEditApiList(list)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                          )}
                          {canManageLists && (
                            <Button variant="ghost" size="sm" title={list.isArchived ? 'Restore' : 'Archive'} onClick={() => archiveApiList(list)}>
                              {list.isArchived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                            </Button>
                          )}
                          {canManageLists && (
                            <Button variant="ghost" size="sm" title="Delete" onClick={() => deleteApiList(list)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {!showAllTeamView && (!shouldFetchAgencyLists || viewingSelf) && selectedAgencyId !== 'all' && <Card>
        <CardHeader>
          <CardTitle>{viewingList ? `${viewingList.name} - Clients` : 'Saved Lists'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {!viewingList ? (
            <div>
              <Tabs value={listTab} onValueChange={(v) => setListTab(v as typeof listTab)} className="w-full mb-6">
                <TabsList>
                  <TabsTrigger value="all">
                    All
                    <Badge variant="secondary" className="ml-2">
                      {userFilteredBase.filter(l => !l.isArchived).length}
                    </Badge>
                  </TabsTrigger>
                  <TabsTrigger value="assigned">
                    {isPureManager && selectedUserId !== 'all' ? 'Assigned to User' : 'Assigned to Me'}
                    <Badge variant="secondary" className="ml-2">
                      {userFilteredBase.filter(l => !l.isArchived && isAssignedToUser(l, effectiveListOwnerId)).length}
                    </Badge>
                  </TabsTrigger>
                  <TabsTrigger value="created">
                    {isPureManager && selectedUserId !== 'all' ? 'Created by User' : 'Created by Me'}
                    <Badge variant="secondary" className="ml-2">
                      {userFilteredBase.filter(l => !l.isArchived && l.createdBy.id === effectiveListOwnerId).length}
                    </Badge>
                  </TabsTrigger>
                  <TabsTrigger value="archived">
                    Archived
                    <Badge variant="secondary" className="ml-2">
                      {userFilteredBase.filter(l => l.isArchived).length}
                    </Badge>
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {filteredLists.length === 0 ? (
                <div className="text-center py-12">
                  <List className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">
                    {listTab === 'archived' ? 'No archived lists' : 'No lists yet'}
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    {listTab === 'archived' 
                      ? 'Archived lists will appear here'
                      : listTab === 'assigned'
                      ? 'No lists assigned to you'
                      : listTab === 'created'
                      ? 'Create your first list to organize your clients'
                      : 'Create your first list to organize your clients'
                    }
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>List Name</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Created By</TableHead>
                      <TableHead>Assigned To</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLists.map((list) => (
                      <TableRow key={list.id}>
                        <TableCell>
                          <button
                            onClick={() => viewListData(list)}
                            className="text-primary hover:underline font-medium"
                          >
                            {list.name}
                          </button>
                        </TableCell>
                        <TableCell>{format(new Date(list.createdAt), 'MMM d, yyyy')}</TableCell>
                        <TableCell>{list.createdBy.name}</TableCell>
                        <TableCell>{assigneeNames(list)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {!list.isArchived && canAssignLists && list.createdBy.id === currentUser.id && (
                              <Button variant="ghost" size="sm" title="Assign list" onClick={() => openAssignDialog(list)}>
                                <Users className="h-4 w-4" />
                              </Button>
                            )}
                            {!list.isArchived && canManageLists && (
                              <>
                                <Button variant="ghost" size="sm" onClick={() => openEditDialog(list)}>
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => archiveList(list.id)}>
                                  <Archive className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                            {list.isArchived && canManageLists && (
                              <Button variant="ghost" size="sm" onClick={() => restoreList(list.id)}>
                                <ArchiveRestore className="h-4 w-4" />
                              </Button>
                            )}
                            {canManageLists && (
                              <Button variant="ghost" size="sm" onClick={() => deleteList(list.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          ) : (
            // Show list view with tabs
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <StickyHeader>
                <TabsList className="w-full justify-start">
                <TabsTrigger value="all">
                  All Clients
                  <Badge variant="secondary" className="ml-2">
                    {getViewListClients().length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="contacted">
                  Contacted
                  <Badge variant="secondary" className="ml-2">
                    {clients.filter(c => {
                      const inList = getViewListClients().some(lc => lc.id === c.id);
                      return inList && c.status === 'contacted';
                    }).length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="active" disabled className="opacity-50 cursor-not-allowed">
                  Active
                  <Badge variant="secondary" className="ml-2">0</Badge>
                </TabsTrigger>
                <TabsTrigger value="lost" disabled className="opacity-50 cursor-not-allowed">
                  Lost
                  <Badge variant="secondary" className="ml-2">0</Badge>
                </TabsTrigger>
                <TabsTrigger value="ex" disabled className="opacity-50 cursor-not-allowed">
                  Ex
                  <Badge variant="secondary" className="ml-2">0</Badge>
                </TabsTrigger>
                <TabsTrigger value="unsubscribed">
                  Unsubscribed
                  <Badge variant="secondary" className="ml-2">
                    {clients.filter(c => {
                      const inList = getViewListClients().some(lc => lc.id === c.id);
                      return inList && c.status === 'unsubscribed';
                    }).length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="permanently_closed">
                  Permanently Closed
                  <Badge variant="secondary" className="ml-2">
                    {clients.filter(c => {
                      const inList = getViewListClients().some(lc => lc.id === c.id);
                      return inList && c.status === 'permanently_closed';
                    }).length}
                  </Badge>
                </TabsTrigger>
              </TabsList>
              </StickyHeader>

              <TabsContent value={activeTab} className="mt-4">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search..."
                        value={viewSearchTerm}
                        onChange={(e) => setViewSearchTerm(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  </div>

                  {sortedClients.length === 0 ? (
                    <div className="text-center py-12">
                      <List className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <h3 className="text-lg font-semibold mb-2">No clients found</h3>
                      <p className="text-muted-foreground">No clients match the selected filters</p>
                    </div>
                  ) : (
                    <div>
                      <div className="mb-4 text-sm text-muted-foreground">
                        Showing {sortedClients.length} client{sortedClients.length !== 1 ? 's' : ''}
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-16">#</TableHead>
                            <TableHead>
                              <Button variant="ghost" size="sm" className="h-auto p-0 hover:bg-transparent" onClick={() => handleSort('name')}>
                                Name
                                {sortColumn === 'name' && (sortDirection === 'asc' ? <ArrowUp className="ml-2 h-4 w-4" /> : <ArrowDown className="ml-2 h-4 w-4" />)}
                                {sortColumn !== 'name' && <ArrowUpDown className="ml-2 h-4 w-4" />}
                              </Button>
                            </TableHead>
                            <TableHead>
                              <Button variant="ghost" size="sm" className="h-auto p-0 hover:bg-transparent" onClick={() => handleSort('industry')}>
                                Industry
                                {sortColumn === 'industry' && (sortDirection === 'asc' ? <ArrowUp className="ml-2 h-4 w-4" /> : <ArrowDown className="ml-2 h-4 w-4" />)}
                                {sortColumn !== 'industry' && <ArrowUpDown className="ml-2 h-4 w-4" />}
                              </Button>
                            </TableHead>
                            <TableHead>
                              <Button variant="ghost" size="sm" className="h-auto p-0 hover:bg-transparent" onClick={() => handleSort('location')}>
                                Location
                                {sortColumn === 'location' && (sortDirection === 'asc' ? <ArrowUp className="ml-2 h-4 w-4" /> : <ArrowDown className="ml-2 h-4 w-4" />)}
                                {sortColumn !== 'location' && <ArrowUpDown className="ml-2 h-4 w-4" />}
                              </Button>
                            </TableHead>
                            <TableHead>
                              <Button variant="ghost" size="sm" className="h-auto p-0 hover:bg-transparent" onClick={() => handleSort('companySize')}>
                                Size
                                {sortColumn === 'companySize' && (sortDirection === 'asc' ? <ArrowUp className="ml-2 h-4 w-4" /> : <ArrowDown className="ml-2 h-4 w-4" />)}
                                {sortColumn !== 'companySize' && <ArrowUpDown className="ml-2 h-4 w-4" />}
                              </Button>
                            </TableHead>
                            <TableHead>Tags</TableHead>
                            <TableHead>Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sortedClients.map((client, index) => (
                            <TableRow 
                              key={client.id}
                              className="cursor-pointer hover:bg-muted/50"
                              onClick={() => handleViewClient(client)}
                            >
                              <TableCell className="font-medium">{index + 1}</TableCell>
                              <TableCell>
                                <div>
                                  <div className="font-medium">{client.name}</div>
                                  <div className="text-sm text-muted-foreground">{client.address}</div>
                                  <Badge 
                                    variant="secondary" 
                                    className={`capitalize w-fit text-[10px] py-0 px-1.5 h-4 mt-1 ${getStatusBadgeClass(client.status)}`}
                                  >
                                    {client.status}
                                  </Badge>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Building2 className="h-4 w-4 text-muted-foreground" />
                                  {client.industry}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <MapPin className="h-4 w-4 text-muted-foreground" />
                                  {client.location}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Users className="h-4 w-4 text-muted-foreground" />
                                  {client.companySize}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  {client.tags.map((tag) => (
                                    <Badge key={tag} variant="outline" className="text-xs">
                                      {tag}
                                    </Badge>
                                  ))}
                                </div>
                              </TableCell>
                              <TableCell onClick={(e) => e.stopPropagation()}>
                                <div className="flex gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toast({ description: 'Call feature coming soon' });
                                    }}
                                  >
                                    <PhoneCall className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toast({ description: 'Email feature coming soon' });
                                    }}
                                  >
                                    <Mail className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setFollowUpClient(client);
                                      setIsFollowUpDialogOpen(true);
                                    }}
                                  >
                                    <Calendar className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>}

      {followUpClient && (
        <FollowUpDialog
          open={isFollowUpDialogOpen}
          onOpenChange={setIsFollowUpDialogOpen}
          clientId={followUpClient.id}
          clientName={followUpClient.name}
          subCompanyId={listWriteAgencyId}
        />
      )}

      {selectedClient && (
        <ClientDetailsSheet
          open={isClientSheetOpen}
          onOpenChange={setIsClientSheetOpen}
          client={selectedClient}
          subCompanyId={listWriteAgencyId}
        />
      )}

      <Dialog open={!!editingApiList} onOpenChange={(open) => { if (!open && !editApiSaving) setEditingApiList(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit list</DialogTitle>
            <DialogDescription>Update the list name and description.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-api-name">Name</Label>
              <Input id="edit-api-name" value={editApiName} onChange={(e) => setEditApiName(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="edit-api-desc">Description</Label>
              <Input id="edit-api-desc" value={editApiDesc} onChange={(e) => setEditApiDesc(e.target.value)} placeholder="Optional" className="mt-1.5" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingApiList(null)} disabled={editApiSaving}>Cancel</Button>
            <Button onClick={saveEditApiList} disabled={editApiSaving}>
              {editApiSaving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</> : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!assigningList} onOpenChange={(open) => { if (!open && !assignSaving) setAssigningList(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign “{assigningList?.name}”</DialogTitle>
            <DialogDescription>
              Pick who to share this list with, then click Save. They’ll see it under “Assigned to me”.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground">Selected</Label>
              {pendingAssignees.length > 0 ? (
                <div className="flex flex-wrap gap-2 mt-2">
                  {pendingAssignees.map((a) => (
                    <Badge key={a.id} variant="secondary" className="gap-1">
                      {a.name}
                      <button
                        type="button"
                        className="ml-1 text-muted-foreground hover:text-destructive"
                        onClick={() => unstagePerson(a.id)}
                        aria-label={`Remove ${a.name}`}
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground mt-2">No one selected.</p>
              )}
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Add someone</Label>
              {assignLoading ? (
                <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : (() => {
                const pendingIds = new Set(pendingAssignees.map((p) => p.id));
                const q = assignSearch.trim().toLowerCase();
                const available = assignableUsers
                  .filter((u) => !pendingIds.has(u.id))
                  .filter((u) => !q || `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) || u.roleLabel.toLowerCase().includes(q));
                if (assignableUsers.filter((u) => !pendingIds.has(u.id)).length === 0) {
                  return <p className="text-sm text-muted-foreground mt-2">No one else available to assign.</p>;
                }
                return (
                  <div className="mt-2 space-y-2">
                    <div className="relative">
                      <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={assignSearch}
                        onChange={(e) => setAssignSearch(e.target.value)}
                        placeholder="Search people…"
                        className="pl-8 h-9"
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto border rounded-md divide-y">
                      {available.length === 0 ? (
                        <p className="text-sm text-muted-foreground px-3 py-2">No matches.</p>
                      ) : available.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => stagePerson({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim() })}
                          className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted text-left"
                        >
                          <span>{u.firstName} {u.lastName}</span>
                          <span className="text-xs text-muted-foreground">{u.roleLabel}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssigningList(null)} disabled={assignSaving}>Cancel</Button>
            <Button onClick={saveAssignees} disabled={assignSaving}>
              {assignSaving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</> : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
