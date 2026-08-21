import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/** Client status tabs — full-width equal segments (not scope-filter chips) */
const CLIENT_STATUS_TAB =
  'group flex flex-1 min-w-0 h-9 gap-1.5 items-center justify-start text-left rounded-lg border border-transparent bg-transparent px-2.5 text-[12.5px] font-medium text-slate-600 shadow-none ' +
  'hover:text-slate-900 hover:bg-white/70 ' +
  'data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:border-slate-200/80 data-[state=active]:shadow-sm';
const CLIENT_STATUS_LABEL = 'min-w-0 flex-1 truncate text-left';
const CLIENT_STATUS_BADGE =
  'ml-auto h-5 min-w-[1.25rem] shrink-0 justify-center border-0 bg-slate-200/70 px-1.5 text-[10px] font-semibold tabular-nums text-slate-600 ' +
  'group-data-[state=active]:bg-blue-50 group-data-[state=active]:text-blue-700';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { LeadRequestDialog } from '@/components/LeadRequestDialog';
import { LeadRequestDetailsDialog } from '@/components/LeadRequestDetailsDialog';
import { ClientDetailsSheet } from '@/components/ClientDetailsSheet';
import { AddClientDialog } from '@/components/AddClientDialog';
// Advanced search removed: regular search + filters already combine.
import { FollowUpDialog } from '@/components/FollowUpDialog';
import { CreateTaskDialog } from '@/components/CreateTaskDialog';
import { AssignLeadDialog } from '@/components/AssignLeadDialog';
import { EmailComposeDialog } from '@/components/EmailComposeDialog';
import { CallInterface } from '@/components/CallInterface';
import { useCallStore } from '@/lib/callStore';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Search, UserPlus, Mail, Phone as PhoneIcon, Building2, MapPin, ArrowUpDown, ArrowUp, ArrowDown, Users, MessageSquare, PhoneCall, Calendar, CheckCircle, ArrowRight, FileText, Filter, Save, Eye, Trash2, X, Upload, Loader2, Hash } from 'lucide-react';
import { useStore } from '@/lib/store';
import { useAuthStore } from '@/lib/authStore';
import { fetchClientFacets, fetchClients, fetchLeads, fetchFollowUps, fetchClient, fetchLeadRequests, fetchUsers, fetchSuperUsers, fetchAccessibleAgencies, mapApiLeadToLead, mapApiFollowUpToFollowUp, savePendingImports, savePendingContactImports, fetchPendingClientSubmissions, fetchPendingClientEdits, fetchPendingImports, fetchPendingContactImports, bulkApprovePendingImports, bulkRejectPendingImports, bulkApprovePendingContactImports, bulkRejectPendingContactImports, fetchClientFlowConfig, fetchClientVisibilitySetting, type ContactImportRow, type PendingContactImportRecord } from '@/lib/api';
import { describeClientFlow, isAgencyClientFlowConfig } from '@/lib/clientDestinationFlow';
import { bulkPostApprovalAction } from '@/lib/approvalBulk';
import { bulkApprovalToastTitle } from '@/lib/approvalMessages';
import type { PendingManualSubmissionRecord, PendingImportRecord, PendingClientEditRecord, SavePendingImportClient } from '@/lib/api';
import { onClientRefresh } from '@/lib/socket';
import type { ApiLeadRequest, ApiUser } from '@/lib/api';
import { format } from 'date-fns';
import { Client, LeadRequest, ActivityType, FilterView, Lead, FollowUp } from '@/lib/types';
import { ImportClientsDialog } from '@/components/ImportClientsDialog';
import { PendingManualSubmissionSheet } from '@/components/PendingManualSubmissionSheet';
import { PendingClientEditSheet } from '@/components/PendingClientEditSheet';
import { PendingQueuesPanel } from '@/components/PendingQueuesPanel';
import { PendingContactImportReviewSheet } from '@/components/PendingContactImportReviewSheet';
import { PendingClientReviewSheet } from '@/components/PendingClientReviewSheet';
import { activityLogs } from '@/lib/activityData';
import { useToast } from '@/hooks/use-toast';
import {
  useCanAccessMultipleAgencies,
  useCanActOnLeads,
  useCanFinalApprovePendingClients,
  useCanApproveGlobalDatabasePending,
  useCanManagerRecommendPendingClients,
  useCanViewAgencyScope,
  useCanViewPendingClientQueue,
  useCanViewTeamScope,
  useHasPermission,
  useIsGlobalDatabaseWorkspace,
  useIsOwnScope,
  useDataScopeLevel,
} from '@/lib/access';
import { useScopeFilter } from '@/hooks/useElevatedScopeFilter';
import { useActAs } from '@/hooks/useActAs';
import { useWriteAgencyId } from '@/hooks/useWriteAgencyId';
import { resolveLinkedAwareOwnerIds } from '@/lib/linkedAwareOwnerIds';
import { ownerExactFlag } from '@/lib/ownerExactFlag';
import { resolveOwnerIds } from '@/lib/ownerScope';
import { ScopeFilterBar } from '@/components/ScopeFilterBar';
import { StickyHeader } from '@/components/StickyHeader';
import { getUserRoleTitle } from '@/lib/roleLabels';
import {
  getClientStorageMessage,
  type ClientStorageContext,
} from '@/components/ClientStorageContextBanner';
import { HeldByOtherAssociateTableRow } from '@/components/clients/HeldByOtherAssociateTableRow';
import { getCountryFlag } from '@/lib/countries';
import { ForwardedChip } from '@/components/offboarding/ForwardedChip';
import { PersonSectionHeader } from '@/components/PersonSectionHeader';
import { SUPER_USERS_SCREEN_ROLES } from '@/lib/roleOptions';

// ─── Single client tag picker ────────────────────────────────────────────────
// One client row shows at most ONE tag. Priority order, highest wins:
//   permanently_closed > unsubscribed > ex > active > lost > contacted (with outreach) > none
type ClientTag = 'permanently_closed' | 'unsubscribed' | 'ex' | 'active' | 'lost' | 'contacted' | null;

const OPEN_PIPELINE_LEAD_STATUSES = new Set(['open', 'active']);

function isOpenPipelineLeadStatus(status: string | undefined): boolean {
  return !!status && OPEN_PIPELINE_LEAD_STATUSES.has(status);
}

/** Align list row with open/active lead (API flag or leads query). */
function resolvePipelineLeadContext(
  client: {
    hasOpenLead?: boolean;
    activeLeadOwnerId?: string;
    activeLeadOwnerName?: string;
    assignedOwnerId?: string;
    assignedOwnerName?: string;
  },
  lead?: { ownerId?: string; ownerName?: string; status?: string } | null,
) {
  const pipelineFromList =
    lead && isOpenPipelineLeadStatus(lead.status) ? lead : null;
  const hasPipelineLead = Boolean(client.hasOpenLead || pipelineFromList);
  const ownerId =
    client.activeLeadOwnerId
    ?? client.assignedOwnerId
    ?? pipelineFromList?.ownerId;
  const ownerName =
    client.activeLeadOwnerName
    ?? client.assignedOwnerName
    ?? pipelineFromList?.ownerName;
  return {
    hasPipelineLead,
    ownerId,
    ownerName,
    assignedOwnerId: hasPipelineLead ? ownerId : undefined,
    assignedOwnerName: hasPipelineLead ? ownerName : undefined,
  };
}

function pickClientTag(
  client: Pick<Client, 'status' | 'hasOutreach' | 'latestLostById' | 'latestLostLeadId' | 'hasOpenLead'> & {
    _isLostForViewer?: boolean;
  },
): ClientTag {
  if (client.status === 'permanently_closed') return 'permanently_closed';
  if (client.status === 'unsubscribed') return 'unsubscribed';
  if (client.status === 'ex') return 'ex';
  if (client.status === 'active') return 'active';
  if (client.status === 'lost' || client._isLostForViewer) return 'lost';
  if (client.hasOutreach) return 'contacted';
  return null;
}

// ─── Per-agency full clients card (All-Agencies view) ────────────────────────
// Self-contained: owns its own filters/pagination/data so super users can act
// across multiple agencies in one screen without switching tabs.
type AgencyClientsCardCallbacks = {
  onViewClient: (client: Client) => void;
  onCallClient: (client: Client) => void;
  onEmailClient: (client: Client) => void;
  onFollowUpClient: (client: Client) => void;
  onAssignLead: (client: Client, mode: 'assign' | 'reassign', agencyId: string) => void;
  onRequestLead: (client: Client) => void;
  onViewLeadRequest: (request: LeadRequest) => void;
};

// Shape of one client record returned by fetchClients (matches the inline param
// type used by Clients()'s mapApiClientToClient).
type ApiClientRecord = {
  id: string;
  name: string;
  industry: string | null;
  location: string | null;
  address: string | null;
  companySize: string | null;
  status: string;
  lastActivity: string | null;
  createdAt: string;
  contactedByMe?: boolean;
  contactedByName?: string;
  hasOutreach?: boolean;
  latestOutreachByName?: string;
  hasOpenLead?: boolean;
  heldByOtherAssociate?: boolean;
  activeLeadId?: string;
  activeLeadOwnerId?: string;
  activeLeadOwnerName?: string;
  assignedOwnerId?: string;
  assignedOwnerName?: string;
  latestLostLeadId?: string;
  latestLostById?: string;
  latestLostByName?: string;
  latestLostAt?: string;
  latestLossReason?: string;
  tags: string[];
  ownershipType?: 'management' | 'associate' | null;
  ownershipUserId?: string | null;
  ownershipUserName?: string | null;
  contacts: Array<{
    id: string;
    clientId: string;
    name: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    phoneExtension: string | null;
    linkedin: string | null;
    website: string | null;
    isPrimary: boolean;
  }>;
};

function ClientIdCellContent({
  rowNum,
  serialNumber,
  showClientSerial,
}: {
  rowNum: number;
  serialNumber?: number;
  showClientSerial: boolean;
}) {
  const hasSerial = showClientSerial && typeof serialNumber === 'number';

  return (
    <div
      className="inline-flex items-center gap-2 text-sm font-semibold tabular-nums leading-none"
      title={hasSerial ? `Row ${rowNum} · Client #${serialNumber}` : `Row ${rowNum}`}
    >
      <span className="min-w-[1ch] text-foreground">{rowNum}</span>
      {hasSerial && (
        <>
          <span className="h-3.5 w-px shrink-0 bg-border/80" aria-hidden />
          <span className="text-primary tracking-tight">#{serialNumber}</span>
        </>
      )}
    </div>
  );
}

function AgencyClientsCard({
  agency,
  onViewClients,
  callbacks,
  mapApiClient,
  mapApiLeadRequest,
  showClientSerial,
  selectedAgencyId,
  ownerIds,
  scopeKey,
  viewLabel = 'View Agency',
  hideAgencyHeader = false,
}: {
  agency: { id: string; name: string };
  onViewClients: () => void;
  callbacks: AgencyClientsCardCallbacks;
  mapApiClient: (c: ApiClientRecord) => Client;
  mapApiLeadRequest: (r: ApiLeadRequest) => LeadRequest;
  showClientSerial?: boolean;
  selectedAgencyId?: string;
  ownerIds?: string[];
  scopeKey: string;
  viewLabel?: string;
  /** People sections already show PersonSectionHeader — hide duplicate agency View row */
  hideAgencyHeader?: boolean;
}) {
  const { currentUser } = useStore();
  const permissions = useAuthStore((s) => s.permissions);
  const [searchParams] = useSearchParams();
  const linkedUserIds = useMemo(
    () => (searchParams.get('linkedUserId') ?? '').split(',').filter(Boolean),
    [searchParams],
  );
  const PAGE_SIZE = 10;

  const isElevatedRole = useCanAccessMultipleAgencies();
  const isAssociate = useIsOwnScope();
  const isManagerRole = useCanViewTeamScope();
  const isDataOnlyRole = !useCanActOnLeads() && permissions.includes('clients:read');
  const canAssignLead = permissions.includes('leads:assign');
  const canFilterLostTeam = useCanViewTeamScope();

  const queryClient = useQueryClient();
  useEffect(() => onClientRefresh(() => {
    queryClient.invalidateQueries({ queryKey: ['agency-card-clients', agency.id] });
    queryClient.invalidateQueries({ queryKey: ['agency-card-counts', agency.id] });
  }), [queryClient, agency.id]);

  // Local state
  const [activeTab, setActiveTab] = useState<'all' | 'contactedByMe' | 'active' | 'lost' | 'ex' | 'unsubscribed' | 'permanently_closed' | 'management'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [apiPage, setApiPage] = useState(1);
  const [sortColumn, setSortColumn] = useState<'name' | 'industry' | 'location' | 'lastActivity' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => { setApiPage(1); }, [activeTab, debouncedSearch]);

  // Per-agency tab counts
  const { data: tabCounts } = useQuery({
    queryKey: ['agency-card-counts', agency.id, scopeKey],
    queryFn: async () => {
      const [allRes, contactedRes, activeRes, lostRes, exRes, unsubRes, permRes, mgmtRes] = await Promise.all([
        fetchClients({ page: 1, limit: 1, subCompanyId: agency.id, ownerIds }),
        fetchClients({ page: 1, limit: 1, contactedByMe: true, contactedScope: 'team', subCompanyId: agency.id, ownerIds }),
        fetchClients({ page: 1, limit: 1, status: 'active', subCompanyId: agency.id, ownerIds }),
        fetchClients({ page: 1, limit: 1, status: 'lost', lostScope: 'team', subCompanyId: agency.id, ownerIds }),
        fetchClients({ page: 1, limit: 1, status: 'ex', subCompanyId: agency.id, ownerIds }),
        fetchClients({ page: 1, limit: 1, status: 'unsubscribed', subCompanyId: agency.id, ownerIds }),
        fetchClients({ page: 1, limit: 1, status: 'permanently_closed', subCompanyId: agency.id, ownerIds }),
        fetchClients({ page: 1, limit: 1, ownershipType: 'management', subCompanyId: agency.id }),
      ]);
      return {
        all: allRes.pagination.total,
        contacted: contactedRes.pagination.total,
        active: activeRes.pagination.total,
        lost: lostRes.pagination.total,
        ex: exRes.pagination.total,
        unsubscribed: unsubRes.pagination.total,
        permanentlyClosed: permRes.pagination.total,
        management: mgmtRes.pagination.total,
      };
    },
    staleTime: 0,
  });

  // Per-agency clients list (status-filtered)
  const statusParam = activeTab === 'all' || activeTab === 'contactedByMe' || activeTab === 'management'
    ? undefined
    : activeTab;
  const contactedParam = activeTab === 'contactedByMe' ? true : undefined;
  const contactedScopeParam = activeTab === 'contactedByMe' ? 'team' as const : undefined;
  const lostScopeParam = activeTab === 'lost' ? 'team' as const : undefined;
  const ownershipTypeParam = activeTab === 'management' ? 'management' as const : undefined;
  const sortByParam = sortColumn ?? undefined;
  const sortOrderParam = sortColumn ? sortDirection : undefined;

  const { data: clientsRes, isFetching: clientsLoading } = useQuery({
    queryKey: ['agency-card-clients', agency.id, activeTab, apiPage, debouncedSearch, sortByParam, sortOrderParam, scopeKey],
    queryFn: () => fetchClients({
      page: apiPage,
      limit: PAGE_SIZE,
      search: debouncedSearch || undefined,
      status: statusParam,
      contactedByMe: contactedParam,
      contactedScope: contactedScopeParam,
      lostScope: lostScopeParam,
      ownershipType: ownershipTypeParam,
      sortBy: sortByParam,
      sortOrder: sortOrderParam,
      subCompanyId: agency.id,
      ownerIds: activeTab === 'management' ? undefined : ownerIds,
      globalDb: undefined,
    }),
    staleTime: 0,
  });

  const clients: Client[] = useMemo(
    () => (clientsRes?.data ?? []).map(mapApiClient),
    [clientsRes, mapApiClient],
  );
  const paginationTotal = clientsRes?.pagination.total ?? 0;
  const paginationTotalPages = clientsRes?.pagination.totalPages ?? 0;
  const startIndex = (apiPage - 1) * PAGE_SIZE;

  // Per-agency leads (for assign/request state) + lead requests
  const { data: leadsForAgency = [] } = useQuery({
    queryKey: ['agency-card-leads', agency.id],
    queryFn: () => fetchLeads({ limit: 1000, subCompanyId: agency.id }).then(r => r.data.map(l => mapApiLeadToLead(l, agency.name))),
    staleTime: 60 * 1000,
  });

  const { data: leadRequestsForAgency = [] } = useQuery({
    queryKey: ['agency-card-lead-requests', agency.id],
    queryFn: () => fetchLeadRequests({ subCompanyId: agency.id }).then(rs => rs.map(mapApiLeadRequest)),
    staleTime: 60 * 1000,
  });

  // Users in this agency (for reporting-manager check)
  const { data: agencyUsersRaw = [] } = useQuery({
    queryKey: ['agency-card-users', agency.id],
    queryFn: () => fetchUsers({ subCompanyId: agency.id }),
    staleTime: 2 * 60 * 1000,
  });
  const directReportIds = useMemo(
    () => agencyUsersRaw
      .filter(u => u.isActive && u.subCompanyId === agency.id && u.reportingManagerIds?.includes(currentUser.id))
      .map(u => u.id),
    [agencyUsersRaw, agency.id, currentUser.id],
  );

  // Helpers
  const getClientLead = (clientId: string) => {
    const sortLeads = (a: typeof leadsForAgency[number], b: typeof leadsForAgency[number]) => {
      const priority = (lead: typeof leadsForAgency[number]) => {
        if (lead.status === 'closed_won') return 2;
        if (isOpenPipelineLeadStatus(lead.status)) return 1;
        return 0;
      };
      const priorityDiff = priority(b) - priority(a);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    };
    return leadsForAgency.filter(l => l.clientId === clientId).sort(sortLeads)[0];
  };

  const getLeadRequest = (clientId: string) =>
    leadRequestsForAgency.find(
      (r) =>
        r.clientId === clientId &&
        r.subCompanyId === agency.id &&
        r.requestedBy === currentUser.id &&
        r.status === 'pending',
    );

  const handleSort = (col: typeof sortColumn) => {
    if (sortColumn === col) setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortColumn(col); setSortDirection('asc'); }
  };
  const sortIcon = (col: typeof sortColumn) => {
    if (sortColumn !== col) return <ArrowUpDown className="h-4 w-4 ml-1" />;
    return sortDirection === 'asc' ? <ArrowUp className="h-4 w-4 ml-1" /> : <ArrowDown className="h-4 w-4 ml-1" />;
  };

  const tabs: Array<{ value: typeof activeTab; label: string; count: number | undefined }> = [
    { value: 'all', label: 'All', count: tabCounts?.all },
    { value: 'contactedByMe', label: 'Contacted', count: tabCounts?.contacted },
    { value: 'active', label: 'Active', count: tabCounts?.active },
    { value: 'lost', label: 'Lost', count: tabCounts?.lost },
    { value: 'ex', label: 'Ex', count: tabCounts?.ex },
    { value: 'unsubscribed', label: 'Unsubscribed', count: tabCounts?.unsubscribed },
    { value: 'permanently_closed', label: 'Permanently Closed', count: tabCounts?.permanentlyClosed },
    { value: 'management', label: 'Management', count: tabCounts?.management },
  ];

  return (
    <Card className="border overflow-hidden">
      {!hideAgencyHeader && (
        <div className="flex items-center justify-between px-5 py-4 bg-muted/30 border-b">
          <h2 className="font-semibold text-base">{agency.name}</h2>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={onViewClients}>
            {viewLabel} <ArrowRight className="h-3 w-3" />
          </Button>
        </div>
      )}
      <CardContent className="pt-4 space-y-3">
        {/* Status sub-tabs (pill row) */}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          {tabs.map(t => (
            <Button
              key={t.value}
              size="sm"
              variant={activeTab === t.value ? 'default' : 'secondary'}
              className="whitespace-nowrap shrink-0"
              onClick={() => setActiveTab(t.value)}
            >
              {t.label}
              <Badge variant="outline" className="ml-2">{t.count ?? 0}</Badge>
            </Button>
          ))}
        </div>

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, industry, location..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Table */}
        {clientsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : clients.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground">No clients found</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>
                  <button onClick={() => handleSort('name')} className="flex items-center hover:text-foreground transition-colors">
                    Client Name {sortIcon('name')}
                  </button>
                </TableHead>
                <TableHead>
                  <button onClick={() => handleSort('industry')} className="flex items-center hover:text-foreground transition-colors">
                    Industry {sortIcon('industry')}
                  </button>
                </TableHead>
                <TableHead>City</TableHead>
                <TableHead>Province</TableHead>
                <TableHead>Primary Contact</TableHead>
                <TableHead>
                  <button onClick={() => handleSort('lastActivity')} className="flex items-center hover:text-foreground transition-colors">
                    Last Activity {sortIcon('lastActivity')}
                  </button>
                </TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((client, index) => {
                const lead = getClientLead(client.id);
                const leadRequest = getLeadRequest(client.id);
                const canRequest = !lead && !leadRequest;
                const primaryContact = client.contacts.find(c => c.isPrimary);
                const pipeline = resolvePipelineLeadContext(client, lead);
                const assignedOwnerId = pipeline.assignedOwnerId;
                const assignedOwnerName = pipeline.assignedOwnerName;
                const ownerIdForReporting = assignedOwnerId ?? lead?.ownerId;
                const isReportingManagerForOwner = !!ownerIdForReporting && directReportIds.includes(ownerIdForReporting);
                // Use open-pipeline state, not "any lead row": historical closed leads must not block outreach.
                const canAccessClientActions =
                  isElevatedRole
                  || isReportingManagerForOwner
                  || (assignedOwnerId ? (assignedOwnerId === currentUser.id || linkedUserIds.includes(assignedOwnerId)) : !pipeline.hasPipelineLead)
                  || Boolean(leadRequest);

                const isActive = client.status === 'active';
                const isLost =
                  (activeTab === 'lost' && !!client.latestLostLeadId)
                  || (canFilterLostTeam && client.status === 'lost')
                  || (!canFilterLostTeam && !!client.latestLostById && client.latestLostById === currentUser.id && !isActive && !client.hasOpenLead);
                const isUnsubscribed = client.status === 'unsubscribed';
                const isPermanentlyClosed = client.status === 'permanently_closed';
                const isDisabled = isUnsubscribed || isPermanentlyClosed;
                const isHeldByOtherAssociate = !!client.heldByOtherAssociate;

                if (isHeldByOtherAssociate) {
                  return (
                    <HeldByOtherAssociateTableRow key={client.id} rowNum={startIndex + index + 1} />
                  );
                }

                return (
                  <TableRow
                    key={client.id}
                    className={`${isDisabled ? 'opacity-60' : ''} cursor-pointer hover:bg-muted/50`}
                    onClick={() => callbacks.onViewClient(client)}
                  >
                    <TableCell className="w-[4.5rem] whitespace-nowrap align-middle py-3">
                      <ClientIdCellContent
                        rowNum={startIndex + index + 1}
                        serialNumber={client.serialNumber}
                        showClientSerial={!!showClientSerial}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); callbacks.onViewClient(client); }}
                          className="hover:underline text-left"
                        >
                          {client.name}
                        </button>
                        {client.forwardedFromName && (selectedAgencyId === 'all' || selectedAgencyId === 'me' || selectedAgencyId === client.forwardedFromSubCompanyId) && <ForwardedChip name={client.forwardedFromName} />}
                        {(() => {
                          const tag = pickClientTag({
                            ...client,
                            hasOpenLead: client.hasOpenLead || pipeline.hasPipelineLead,
                            _isLostForViewer: isLost,
                          });
                          if (!tag) return null;
                          if (tag === 'active') return (
                            <>
                              <Badge variant="outline" className="w-fit border-green-400 bg-green-50 px-2 py-0.5 text-xs text-green-700">Active</Badge>
                              {assignedOwnerName && (
                                <div className="text-xs text-muted-foreground">Assigned to: {assignedOwnerName}</div>
                              )}
                            </>
                          );
                          if (tag === 'lost') return (
                            <Badge variant="outline" className="w-fit border-red-400 bg-red-50 px-2 py-0.5 text-xs text-red-700">Lost</Badge>
                          );
                          if (tag === 'unsubscribed') return (
                            <Badge variant="outline" className="w-fit border-gray-400 bg-gray-50 px-2 py-0.5 text-xs text-gray-700">Unsubscribed</Badge>
                          );
                          if (tag === 'permanently_closed') return (
                            <Badge variant="outline" className="w-fit border-gray-400 bg-gray-50 px-2 py-0.5 text-xs text-gray-700">Permanently Closed</Badge>
                          );
                          if (tag === 'ex') return (
                            <Badge variant="outline" className="w-fit border-red-400 bg-red-50 px-2 py-0.5 text-xs text-red-700">Ex</Badge>
                          );
                          return (
                            <>
                              <Badge variant="outline" className="w-fit border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">Contacted</Badge>
                              {client.latestOutreachByName && (
                                <div className="text-xs text-muted-foreground">Contacted by: {client.latestOutreachByName}</div>
                              )}
                              {assignedOwnerName && (
                                <div className="text-xs text-muted-foreground">Assigned to: {assignedOwnerName}</div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </TableCell>
                    <TableCell>{client.industry}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm">
                        <MapPin className="h-3 w-3 text-muted-foreground" />
                        {client.location.split(',')[0]?.trim()}
                      </div>
                    </TableCell>
                    <TableCell>{client.location.split(',')[1]?.trim()}</TableCell>
                    <TableCell>
                      {primaryContact ? (
                        <div>
                          <div className="font-medium text-sm">{primaryContact.name}</div>
                          <div className="text-xs text-muted-foreground">{primaryContact.title}</div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">No contact</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {client.lastActivity
                        ? format(new Date(client.lastActivity), 'MMM d, yyyy')
                        : <span className="text-muted-foreground">Never</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-1">
                      {(client.ownershipType === 'management' || (client.ownershipType === 'associate' && client.ownershipUserName)) && (
                        <div className="text-xs text-muted-foreground">
                          Owned by {client.ownershipType === 'management' ? 'Management' : client.ownershipUserName}
                        </div>
                      )}
                      {isDataOnlyRole ? (
                        <span className="text-muted-foreground">—</span>
                      ) : isLost ? (
                        <div className="flex flex-col items-end gap-1">
                          <div className="text-sm text-muted-foreground">Lost by {client.latestLostByName || 'Unknown'}</div>
                          {canAccessClientActions && (
                            <div className="flex items-center justify-end gap-2">
                              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); callbacks.onCallClient(client); }}>
                                <PhoneCall className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); callbacks.onEmailClient(client); }}>
                                <Mail className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); callbacks.onFollowUpClient(client); }}>
                                <Calendar className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                          {canAssignLead && client.latestLostLeadId && !client.hasOpenLead && (
                            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); callbacks.onAssignLead(client, 'reassign', agency.id); }}>
                              Reassign Lead
                            </Button>
                          )}
                        </div>
                      ) : isActive ? (
                        <div className="flex flex-col items-end gap-2">
                          <div className="text-sm text-muted-foreground">
                            Assigned to {client.activeLeadOwnerName ?? client.assignedOwnerName ?? 'Unknown'}
                          </div>
                          {canAccessClientActions && (
                            <div className="flex items-center justify-end gap-2">
                              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); callbacks.onCallClient(client); }}>
                                <PhoneCall className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); callbacks.onEmailClient(client); }}>
                                <Mail className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); callbacks.onFollowUpClient(client); }}>
                                <Calendar className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      ) : !isUnsubscribed && !isPermanentlyClosed ? (
                        <div className="flex items-center justify-end gap-2">
                          {canAccessClientActions && (
                            <>
                              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); callbacks.onCallClient(client); }}>
                                <PhoneCall className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); callbacks.onEmailClient(client); }}>
                                <Mail className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); callbacks.onFollowUpClient(client); }}>
                                <Calendar className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          {leadRequest ? (
                            <div className="text-sm cursor-pointer hover:underline" onClick={(e) => { e.stopPropagation(); callbacks.onViewLeadRequest(leadRequest); }}>
                              <div className="font-medium text-foreground">Lead Requested</div>
                              <div className="text-xs text-muted-foreground">{format(new Date(leadRequest.requestedAt), 'MMM d, yyyy h:mm a')}</div>
                            </div>
                          ) : isAssociate && assignedOwnerId && assignedOwnerId !== currentUser.id && !linkedUserIds.includes(assignedOwnerId) ? (
                            <span className="text-sm font-medium text-muted-foreground">Assigned to someone else</span>
                          ) : assignedOwnerId && assignedOwnerId !== currentUser.id ? (
                            <div className="text-sm text-muted-foreground">Assigned to {assignedOwnerName ?? 'Unknown'}</div>
                          ) : isAssociate && canRequest ? (
                            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); callbacks.onRequestLead(client); }}>Request Lead</Button>
                          ) : canAssignLead && (!assignedOwnerId || assignedOwnerId !== currentUser.id) ? (
                            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); callbacks.onAssignLead(client, 'assign', agency.id); }}>Assign Lead</Button>
                          ) : null}
                        </div>
                      ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {/* Pagination */}
        {paginationTotalPages > 1 && (
          <div className="flex items-center justify-between pt-2 border-t">
            <div className="text-sm text-muted-foreground">
              Showing {startIndex + 1} to {startIndex + clients.length} of {paginationTotal} clients
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setApiPage(p => Math.max(1, p - 1))} disabled={apiPage === 1}>Previous</Button>
              <div className="flex items-center gap-1">
                {(() => {
                  const maxButtons = 7;
                  const start = paginationTotalPages <= maxButtons ? 1 : Math.min(Math.max(1, apiPage - 3), paginationTotalPages - maxButtons + 1);
                  const end = Math.min(start + maxButtons - 1, paginationTotalPages);
                  return Array.from({ length: end - start + 1 }, (_, i) => start + i).map(page => (
                    <Button
                      key={page}
                      variant={apiPage === page ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setApiPage(page)}
                      className="min-w-[36px]"
                    >
                      {page}
                    </Button>
                  ));
                })()}
              </div>
              <Button variant="outline" size="sm" onClick={() => setApiPage(p => Math.min(paginationTotalPages, p + 1))} disabled={apiPage === paginationTotalPages}>Next</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


export default function Clients() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { clients, setClients, leads, setLeads, followUps, setFollowUps, leadRequests, setLeadRequests, currentUser, currentSubCompany, users, addClient } = useStore();
  const { activeCall, isCallInterfaceOpen, isMinimized, openCallInterface } = useCallStore();
  const [clientsLoading, setClientsLoading] = useState(true);
  const { toast } = useToast();
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [clientListRefreshKey, setClientListRefreshKey] = useState(0);
  const [apiPage, setApiPage] = useState(1);
  const PAGE_SIZE = 10;
  const [paginationTotal, setPaginationTotal] = useState(0);
  const [paginationTotalPages, setPaginationTotalPages] = useState(0);
  const [serverTabCounts, setServerTabCounts] = useState<{ all: number | null; contactedMine: number | null; contactedTeam: number | null; active: number | null; lostMine: number | null; lostTeam: number | null; ex: number | null; unsubscribed: number | null; permanentlyClosed: number | null; management: number | null }>({
    all: null,
    contactedMine: null,
    contactedTeam: null,
    active: null,
    lostMine: null,
    lostTeam: null,
    ex: null,
    unsubscribed: null,
    permanentlyClosed: null,
    management: null,
  });
  const [tabCountsLoading, setTabCountsLoading] = useState(false);
  const [industryFilter, setIndustryFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [availabilityFilter, setAvailabilityFilter] = useState('all');
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [industryFilters, setIndustryFilters] = useState<string[]>([]);
  const [cityFilters, setCityFilters] = useState<string[]>([]);
  const [provinceFilters, setProvinceFilters] = useState<string[]>([]);
  const [companySizeFilters, setCompanySizeFilters] = useState<string[]>([]);
  const [sortColumn, setSortColumn] = useState<'name' | 'industry' | 'location' | 'lastActivity' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [activeTab, setActiveTab] = useState('all');
  const [activeClientFilter, setActiveClientFilter] = useState<'my' | 'team' | 'all'>('my');
  // Super users (director / super_admin / operations_manager) don't get the
  // mine/team dropdown — default them to 'team' so the Contacted tab shows the
  // full agency outreach instead of just their own (which is usually 0).
  const canViewAgency = useCanViewAgencyScope();
  const [contactedClientFilter, setContactedClientFilter] = useState<'mine' | 'team'>(() =>
    canViewAgency ? 'team' : 'mine',
  );
  const [lostClientFilter, setLostClientFilter] = useState<'mine' | 'team'>(() =>
    canViewAgency ? 'team' : 'mine',
  );
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [infiniteClients, setInfiniteClients] = useState<Client[]>([]);
  const [infiniteHasMore, setInfiniteHasMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const activeFilterScopeRef = useRef<string | null>(null);
  // Toggle shows the permanent per-client serial (#312) alongside the row number.
  // Lets associates verbally reference clients across screens ("open #312").
  // Defaults ON; persisted per browser so the choice survives reloads.
  const [showClientSerial, setShowClientSerial] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem('clients:showSerial');
    return stored === null ? true : stored === '1';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('clients:showSerial', showClientSerial ? '1' : '0');
  }, [showClientSerial]);

  const scopeFilter = useScopeFilter();
  const {
    agencies: accessibleAgencies,
    agenciesLoading,
    agencyUsers: agencyTabUsers,
    agencyUsersLoading: agencyTabUsersLoading,
    showHierarchyFilters,
    showAgencyFilterOnly,
    showAgencyFilterBar,
    isDatabaseManagerAgencyMode,
    isAgencyHierarchyViewer,
    isPureManager,
    isSingleAgencyLead,
    isAgencyScopedElevated,
    selectedAgencyId,
    selectedLeaderId,
    selectedManagerId,
    selectedUserId,
    setSelectedAgencyId,
    setSelectedManagerId,
    setSelectedUserId,
    onlyMe,
    managers: agencyManagers,
    getAssociatesForManager,
    getUsersForLeader,
    getManagersForLeader,
    filterRowProps,
    leaderParamInUrl,
    managerParamInUrl,
    userParamInUrl,
    scopeKey,
    showAllTeamView,
    showManagerSections,
    sectionUsers,
  } = scopeFilter;

  const canViewAnyAgency = useCanAccessMultipleAgencies();
  const canScopeClientsByAgency = canViewAnyAgency || isDatabaseManagerAgencyMode;
  const isElevated = canScopeClientsByAgency;
  const dataScopeLevel = useDataScopeLevel();

  // Elevated users (director, super_admin, etc.) default to All Agencies on
  // first load so the chip bar shows "All Authorities" pre-selected.
  useEffect(() => {
    if (!isElevated) return;
    if (searchParams.get('agencyId')) return;
    setSearchParams((prev) => { prev.set('agencyId', 'all'); return prev; }, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isElevated]);

  const canShowReportingManager = useCanViewAgencyScope();

  const { data: superUsersForLookup = [] } = useQuery({
    queryKey: ['super-users-clients-lookup'],
    queryFn: fetchSuperUsers,
    enabled: canShowReportingManager,
    staleTime: 5 * 60 * 1000,
  });

  const userNameById = useMemo(() => {
    const map = new Map<string, { firstName: string; lastName: string }>();
    for (const u of agencyTabUsers) {
      map.set(u.id, { firstName: u.firstName, lastName: u.lastName });
    }
    for (const u of superUsersForLookup) {
      map.set(u.id, { firstName: u.firstName, lastName: u.lastName });
    }
    return map;
  }, [agencyTabUsers, superUsersForLookup]);

  // Resolved agency the page should scope to (elevated: from URL; others: their own).
  const effectiveAgencyId = isElevated
    ? (accessibleAgencies.length > 1
        ? (selectedAgencyId && selectedAgencyId !== 'all' && selectedAgencyId !== 'me'
            ? selectedAgencyId
            : undefined)
        : (accessibleAgencies[0]?.id ?? currentSubCompany?.id))
    : undefined;
  const effectiveAgencyIdForClient = effectiveAgencyId ?? currentSubCompany?.id;
  // Under act-as, writes (task/follow-up/assign/sheet) must use the linked user's agency.
  const writeAgencyId = useWriteAgencyId(effectiveAgencyIdForClient);
  // Sentinel: causes queries to return zero results without skipping the request
  const SENTINEL_OWNER_ID = '00000000-0000-0000-0000-000000000000';
  // Owner IDs from hierarchy filter (elevated + single-agency leads e.g. company_director).
  const scopedOwnerIds = useMemo<string[] | undefined>(() => {
    if (isDatabaseManagerAgencyMode) return undefined;

    if (isPureManager || isAgencyHierarchyViewer) {
      const ids = resolveOwnerIds({
        isElevated: canViewAnyAgency,
        isPureManager,
        isSingleAgencyLead,
        isAgencyScopedElevated,
        onlyMe,
        selectedAgencyId,
        selectedLeaderId,
        selectedManagerId,
        selectedUserId,
        currentUserId: currentUser.id,
        getAssociatesForManager,
        getUsersForLeader,
        getManagersForLeader,
        allManagers: agencyManagers,
        leaderParamInUrl,
        managerParamInUrl,
        userParamInUrl,
      });
      if (ids !== undefined && ids.length === 0) return [SENTINEL_OWNER_ID];
      return ids;
    }

    return undefined;
  }, [isDatabaseManagerAgencyMode, isPureManager, isAgencyHierarchyViewer, canViewAnyAgency, isSingleAgencyLead, isAgencyScopedElevated, onlyMe, userParamInUrl, managerParamInUrl, selectedAgencyId, selectedLeaderId, selectedUserId, selectedManagerId, getAssociatesForManager, getUsersForLeader, getManagersForLeader, agencyManagers, currentUser.id, leaderParamInUrl]);
  const isAllAgenciesView =
    isElevated &&
    accessibleAgencies.length > 1 &&
    selectedAgencyId === 'all' &&
    !isDatabaseManagerAgencyMode &&
    !showAllTeamView &&
    selectedUserId === 'all';
  const useGlobalDbClientsUi = useIsGlobalDatabaseWorkspace();
  const isDatabaseManagerRole = currentUser.role === 'database_manager';
  const isSuperUserScreenRole = (SUPER_USERS_SCREEN_ROLES as readonly string[]).includes(currentUser.role);
  const needsDestinationConfig = isDatabaseManagerRole || isSuperUserScreenRole;

  /** DB Manager on All tab with no agency filter — show org-wide global database. */
  const isDatabaseManagerGlobalAllView =
    isDatabaseManagerRole &&
    isDatabaseManagerAgencyMode &&
    activeTab === 'all' &&
    !isAllAgenciesView &&
    !effectiveAgencyId;

  /** Global DB list on All tab (global-only workspace, or DB manager default before agency filter). */
  const isUnifiedGlobalDbTab =
    activeTab === 'all' &&
    !isAllAgenciesView &&
    (useGlobalDbClientsUi || isDatabaseManagerGlobalAllView);

  const { data: globalDbAllCount = 0 } = useQuery({
    queryKey: ['clients-global-all-count', clientListRefreshKey],
    queryFn: () => fetchClients({ page: 1, limit: 1, globalDb: true }).then((r) => r.pagination.total),
    enabled: isDatabaseManagerRole && isDatabaseManagerAgencyMode,
    staleTime: 30 * 1000,
  });

  // All-Agencies total client count (for the page subtitle)
  const { data: allAgenciesTotal = 0 } = useQuery({
    queryKey: ['all-agencies-clients-total'],
    queryFn: () => fetchClients({ page: 1, limit: 1, globalDb: true }).then(r => r.pagination.total),
    enabled: isAllAgenciesView,
    staleTime: 60 * 1000,
  });

  const linkedUserIdParam = searchParams.get('linkedUserId') ?? '';
  const linkedScopeParam = searchParams.get('linkedScope') ?? '';
  const actAs = useActAs();
  const linkedUserIds = useMemo(
    () => (linkedUserIdParam ? linkedUserIdParam.split(',').filter(Boolean) : []),
    [linkedUserIdParam],
  );
  // Linked anchors + act-as hierarchy drill (same rules as other list pages).
  // Depend on primitive scope fields — never the whole scopeFilter object (new every render).
  const linkedOwnerResolve = useMemo(() => {
    if (isDatabaseManagerAgencyMode) {
      return { ownerIds: undefined as string[] | undefined, ownerExact: false };
    }
    // Linked-aware covers own-default (exact), All chips, act-as, and linked multi.
    return resolveLinkedAwareOwnerIds({
      linkedUserIdsRaw: linkedUserIdParam || undefined,
      actAsActive: actAs.isActive,
      currentUserId: currentUser.id,
      scopeFilter,
    });
  }, [
    isDatabaseManagerAgencyMode,
    linkedUserIdParam,
    actAs.isActive,
    currentUser.id,
    isAgencyHierarchyViewer,
    isPureManager,
    isSingleAgencyLead,
    isAgencyScopedElevated,
    onlyMe,
    selectedAgencyId,
    selectedLeaderId,
    selectedManagerId,
    selectedUserId,
    getAssociatesForManager,
    getUsersForLeader,
    getManagersForLeader,
    agencyManagers,
    leaderParamInUrl,
    managerParamInUrl,
    userParamInUrl,
  ]);
  // Stabilize array identity by content so count/list effects don't infinite-loop.
  const listOwnerIdsKey =
    linkedOwnerResolve.ownerIds === undefined
      ? undefined
      : linkedOwnerResolve.ownerIds.join(',');
  const listOwnerIdsParam = useMemo(
    () =>
      listOwnerIdsKey === undefined
        ? undefined
        : listOwnerIdsKey === ''
          ? []
          : listOwnerIdsKey.split(','),
    [listOwnerIdsKey],
  );
  const listOwnerExact = linkedOwnerResolve.ownerExact;

  useEffect(() => {
    ownerExactFlag.set(listOwnerExact);
    return () => ownerExactFlag.set(false);
  }, [listOwnerExact]);
  // A specific linked agency UUID is selected (not 'all'/'own') — use for agency-scoped client fetch
  const linkedAgencyId = useMemo(
    () => /^[0-9a-f-]{36}$/i.test(linkedScopeParam) ? linkedScopeParam : undefined,
    [linkedScopeParam],
  );

  const unifiedListScopeKey = useMemo(() => {
    if (isUnifiedGlobalDbTab) return '';
    return `${selectedAgencyId}|${selectedLeaderId}|${selectedManagerId}|${selectedUserId}|${onlyMe}|${listOwnerIdsKey ?? ''}|${linkedUserIdParam}`;
  }, [isUnifiedGlobalDbTab, selectedAgencyId, selectedLeaderId, selectedManagerId, selectedUserId, onlyMe, listOwnerIdsKey, linkedUserIdParam]);
  const unifiedFetchScopeKey = useMemo(() => {
    if (isUnifiedGlobalDbTab) return 'global-all';
    // Same owner scope on every status tab (including All Clients) so filters behave consistently.
    return `${effectiveAgencyId}|${listOwnerIdsKey ?? ''}|${linkedScopeParam}|${linkedUserIdParam}|exact:${listOwnerExact ? 1 : 0}|tab:${activeTab}`;
  }, [isUnifiedGlobalDbTab, activeTab, effectiveAgencyId, listOwnerIdsKey, listOwnerExact, linkedScopeParam, linkedUserIdParam]);
  const useInfiniteScroll = !isAllAgenciesView && activeTab !== 'all' && activeTab !== 'contactedByMe' && activeTab !== 'pending';

  const permissions = useAuthStore((s) => s.permissions);
  const canFilterContactedTeam = useCanViewTeamScope();
  const canFilterLostTeam = useCanViewTeamScope();
  const canAssignLead = permissions.includes('leads:assign');
  const isAssociate = useIsOwnScope();
  const isManagerRole = useCanViewTeamScope();
  const isDataOnlyRole = !useCanActOnLeads() && permissions.includes('clients:read');
  const canFinalApprovePending = useCanFinalApprovePendingClients();
  const canApproveGlobalPending = useCanApproveGlobalDatabasePending();
  const canManagerPreApproveManual = useCanManagerRecommendPendingClients();
  const canSeePendingQueue = useCanViewPendingClientQueue() || isDatabaseManagerRole;

  const destinationAgencies = useMemo(
    () => accessibleAgencies.map((a) => ({ id: a.id, name: a.name })),
    [accessibleAgencies],
  );

  // Global-DB-only workspace: Global DB + Pending tabs (permission-expanded DB managers get full tabs).
  useEffect(() => {
    if (!useGlobalDbClientsUi) return;
    if (activeTab !== 'all' && activeTab !== 'pending') {
      setActiveTab('all');
    }
  }, [useGlobalDbClientsUi, activeTab]);
  const canWriteClients = useHasPermission('clients:write');
  const canAddContacts = useHasPermission('clients:contacts:add');

  const { data: clientFlowConfig = null } = useQuery({
    queryKey: ['client-flow-config', currentUser.role, effectiveAgencyIdForClient],
    queryFn: () =>
      fetchClientFlowConfig(
        needsDestinationConfig || !effectiveAgencyIdForClient
          ? undefined
          : { subCompanyId: effectiveAgencyIdForClient },
      ),
    enabled:
      (canWriteClients || canAddContacts) &&
      (needsDestinationConfig || !!effectiveAgencyIdForClient),
    staleTime: 60 * 1000,
  });
  const isDirector = canFinalApprovePending;
  const activeAssignedScope = activeTab === 'active' && (isAssociate || isManagerRole)
    ? (activeClientFilter === 'team' ? 'team' : 'mine')
    : undefined;

  useEffect(() => {
    if (!canFilterContactedTeam && contactedClientFilter !== 'mine') {
      setContactedClientFilter('mine');
    }
  }, [canFilterContactedTeam, contactedClientFilter]);

  useEffect(() => {
    if (!canFilterLostTeam && lostClientFilter !== 'mine') {
      setLostClientFilter('mine');
    }
  }, [canFilterLostTeam, lostClientFilter]);

  // Debounce search input (400ms) for server-side search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Resolve agency name to a stable primitive so the leads effect below doesn't
  // re-fire on every render due to the `accessibleAgencies` array reference churning
  // (the destructure default `= []` is a fresh array each render while the query is
  // disabled/loading, which would otherwise infinite-loop setLeads → re-render).
  const resolvedAgencyName = useMemo(() => {
    if (useGlobalDbClientsUi || isDatabaseManagerGlobalAllView) return 'Org-wide';
    if (!currentSubCompany?.name) return undefined;
    if (isElevated && selectedAgencyId !== 'all') {
      return accessibleAgencies.find(a => a.id === selectedAgencyId)?.name ?? currentSubCompany.name;
    }
    return currentSubCompany.name;
  }, [useGlobalDbClientsUi, isDatabaseManagerGlobalAllView, isElevated, selectedAgencyId, accessibleAgencies, currentSubCompany?.name]);

  const workingAgencyName = useMemo(() => {
    if (isAllAgenciesView) return undefined;
    if (isDatabaseManagerRole && !isDatabaseManagerAgencyMode) return undefined;
    if (isDatabaseManagerGlobalAllView) return undefined;
    return (
      accessibleAgencies.find((a) => a.id === effectiveAgencyIdForClient)?.name ??
      resolvedAgencyName
    );
  }, [
    isAllAgenciesView,
    isDatabaseManagerRole,
    isDatabaseManagerAgencyMode,
    isDatabaseManagerGlobalAllView,
    accessibleAgencies,
    effectiveAgencyIdForClient,
    resolvedAgencyName,
  ]);

  const { data: clientVisibilityDays } = useQuery({
    queryKey: ['client-visibility', effectiveAgencyIdForClient],
    queryFn: () => fetchClientVisibilitySetting({ subCompanyId: effectiveAgencyIdForClient! }),
    enabled:
      !isDatabaseManagerRole &&
      !!effectiveAgencyIdForClient &&
      currentUser.role === 'operations_manager',
    staleTime: 60 * 1000,
  });

  const clientStorageContext = useMemo((): ClientStorageContext | undefined => {
    if (needsDestinationConfig || !workingAgencyName) return undefined;
    return {
      agencyName: workingAgencyName,
      role: currentUser.role,
      visibilityDays: clientVisibilityDays?.days,
      pending: true,
    };
  }, [
    needsDestinationConfig,
    workingAgencyName,
    currentUser.role,
    clientVisibilityDays?.days,
    dataScopeLevel,
  ]);

  // Load leads for assign/request state — defer on Global DB tab so the list loads first.
  useEffect(() => {
    if (isAllAgenciesView) return;
    if (!isElevated && !currentSubCompany?.id) return;
    const subId = isElevated
      ? (effectiveAgencyId ?? (selectedAgencyId !== 'all' && selectedAgencyId !== 'me' ? selectedAgencyId : undefined))
      : (canViewAnyAgency ? currentSubCompany?.id : undefined);
    if (!subId) return;
    const agencyName = resolvedAgencyName ?? currentSubCompany?.name ?? 'Agency';
    const load = () => {
      fetchLeads({ limit: 1000, subCompanyId: subId })
        .then((res) => {
          setLeads(res.data.map((a) => mapApiLeadToLead(a, agencyName)) as Lead[]);
        })
        .catch(() => {});
    };
    if (isUnifiedGlobalDbTab) {
      const id = window.setTimeout(load, 1500);
      return () => window.clearTimeout(id);
    }
    load();
  }, [currentSubCompany?.id, currentSubCompany?.name, canViewAnyAgency, setLeads, isElevated, isAllAgenciesView, selectedAgencyId, effectiveAgencyId, resolvedAgencyName, isUnifiedGlobalDbTab]);

  const mapApiLeadRequestToLeadRequest = useCallback((api: ApiLeadRequest): LeadRequest => ({
    id: api.id,
    clientId: api.clientId,
    clientName: api.clientName,
    primaryContactName: api.primaryContactName,
    requestedBy: api.requestedBy,
    requestedByName: api.requestedByName,
    managerId: api.managerId,
    managerName: api.managerName,
    note: api.note,
    requestedAt: new Date(api.requestedAt),
    status: api.status as LeadRequest['status'],
    reviewedBy: api.reviewedBy,
    reviewedByName: api.reviewedByName,
    reviewedAt: api.reviewedAt ? new Date(api.reviewedAt) : undefined,
    subCompanyId: api.subCompanyId,
    comments: (api.comments || []).map((c) => ({ ...c, createdAt: new Date(c.createdAt) })),
  }), []);

  const loadFollowUps = useCallback(() => {
    if (!writeAgencyId) return;
    fetchFollowUps({ subCompanyId: writeAgencyId, limit: 500 })
      .then((res) => setFollowUps(res.data.map(mapApiFollowUpToFollowUp) as FollowUp[]))
      .catch(() => {});
  }, [writeAgencyId, setFollowUps]);

  useEffect(() => {
    if (!isUnifiedGlobalDbTab) {
      loadFollowUps();
      return;
    }
    const id = window.setTimeout(() => loadFollowUps(), 1500);
    return () => window.clearTimeout(id);
  }, [loadFollowUps, isUnifiedGlobalDbTab]);

  const mapApiClientToClient = useCallback((c: {
    id: string;
    serialNumber?: number;
    name: string;
    industry: string | null;
    location: string | null;
    address: string | null;
    companySize: string | null;
    status: string;
    lastActivity: string | null;
    createdAt: string;
    contactedByMe?: boolean;
    contactedByName?: string;
    hasOutreach?: boolean;
    latestOutreachByName?: string;
    hasOpenLead?: boolean;
    heldByOtherAssociate?: boolean;
    activeLeadId?: string;
    activeLeadOwnerId?: string;
    activeLeadOwnerName?: string;
    assignedOwnerId?: string;
    assignedOwnerName?: string;
    latestLostLeadId?: string;
    latestLostById?: string;
    latestLostByName?: string;
    latestLostAt?: string;
    latestLossReason?: string;
    tags: string[];
    restrictedUsers?: string[];
    ownershipType?: 'management' | 'associate' | null;
    ownershipUserId?: string | null;
    ownershipUserName?: string | null;
    forwardedFromName?: string | null;
    notes?: Array<{ id: string; clientId: string; userId: string; userName: string; userRole: string; content: string; isPublic: boolean; isPinned: boolean; createdAt: string }>;
    contacts: Array<{ id: string; clientId: string; name: string; title: string | null; email: string | null; phone: string | null; phoneExtension: string | null; linkedin: string | null; website: string | null; isPrimary: boolean }>;
  }): Client => ({
    id: c.id,
    serialNumber: c.serialNumber,
    name: c.name,
    industry: c.industry ?? '',
    location: c.location ?? '',
    address: c.address ?? '',
    companySize: c.companySize ?? '',
    tags: Array.from(new Set(c.tags ?? [])),
    contacts: (c.contacts ?? []).map((ct) => ({
      id: ct.id,
      clientId: c.id,
      name: ct.name,
      title: ct.title ?? '',
      email: ct.email ?? '',
      phone: ct.phone ?? '',
      phoneExtension: ct.phoneExtension ?? undefined,
      linkedin: ct.linkedin ?? undefined,
      website: ct.website ?? undefined,
      isPrimary: ct.isPrimary,
    })),
    lastActivity: c.lastActivity ? new Date(c.lastActivity) : undefined,
    status: c.status as Client['status'],
    createdAt: new Date(c.createdAt),
    notes: (c.notes ?? []).map(n => ({
      id: n.id,
      clientId: n.clientId,
      userId: n.userId,
      userName: n.userName,
      userRole: n.userRole as import('@/lib/types').UserRole,
      content: n.content,
      isPublic: n.isPublic,
      isPinned: n.isPinned,
      createdAt: new Date(n.createdAt),
    })),
    contactedByMe: c.contactedByMe ?? false,
    contactedByName: c.contactedByName ?? undefined,
    hasOutreach: c.hasOutreach ?? false,
    latestOutreachByName: c.latestOutreachByName ?? undefined,
    hasOpenLead: c.hasOpenLead ?? undefined,
    heldByOtherAssociate: c.heldByOtherAssociate ?? undefined,
    activeLeadId: c.activeLeadId ?? undefined,
    activeLeadOwnerId: c.activeLeadOwnerId ?? undefined,
    activeLeadOwnerName: c.activeLeadOwnerName ?? undefined,
    assignedOwnerId: c.assignedOwnerId ?? undefined,
    assignedOwnerName: c.assignedOwnerName ?? undefined,
    latestLostLeadId: c.latestLostLeadId ?? undefined,
    latestLostById: c.latestLostById ?? undefined,
    latestLostByName: c.latestLostByName ?? undefined,
    latestLostAt: c.latestLostAt ? new Date(c.latestLostAt) : undefined,
    latestLossReason: c.latestLossReason ?? undefined,
    restrictedUsers: c.restrictedUsers ?? [],
    ownershipType: c.ownershipType ?? undefined,
    ownershipUserId: c.ownershipUserId ?? null,
    ownershipUserName: c.ownershipUserName ?? null,
    forwardedFromName: c.forwardedFromName ?? null,
    forwardedFromSubCompanyId: c.forwardedFromSubCompanyId ?? null,
  }), []);

  const loadServerTabCounts = useCallback(() => {
    if (!isElevated && !currentSubCompany?.id && !isDatabaseManagerRole) return () => {};
    if (isAllAgenciesView) return () => {}; // counts not needed in sectioned view

    let cancelled = false;
    setTabCountsLoading(true);

    if (useGlobalDbClientsUi) {
      fetchClients({ page: 1, limit: 1, globalDb: true })
        .then(({ pagination }) => {
          if (cancelled) return;
          setServerTabCounts({
            all: pagination.total,
            contactedMine: 0,
            contactedTeam: 0,
            active: 0,
            lostMine: 0,
            lostTeam: 0,
            ex: 0,
            unsubscribed: 0,
            permanentlyClosed: 0,
            management: 0,
          });
          setTabCountsLoading(false);
        })
        .catch(() => {
          if (!cancelled) { setServerTabCounts((prev) => prev); setTabCountsLoading(false); }
        });
      return () => { cancelled = true; };
    }

    const agencyParam = isElevated
      ? effectiveAgencyId
      : (canViewAnyAgency ? currentSubCompany?.id : undefined);
    const ownerIdsParam = listOwnerIdsParam;
    const dbManagerGlobalAllCount =
      isDatabaseManagerRole && isDatabaseManagerAgencyMode && !agencyParam;

    Promise.all([
      fetchClients(
        useGlobalDbClientsUi || dbManagerGlobalAllCount
          ? { page: 1, limit: 1, globalDb: true }
          : { page: 1, limit: 1, subCompanyId: agencyParam, linkedAgencyId, ownerIds: ownerIdsParam },
      ),
      fetchClients({ page: 1, limit: 1, contactedByMe: true, contactedScope: 'mine', subCompanyId: agencyParam, ownerIds: ownerIdsParam }),
      canFilterContactedTeam
        ? fetchClients({ page: 1, limit: 1, contactedByMe: true, contactedScope: 'team', subCompanyId: agencyParam, ownerIds: ownerIdsParam })
        : Promise.resolve({ data: [], pagination: { page: 1, limit: 1, total: 0, totalPages: 0 } }),
      fetchClients({ page: 1, limit: 1, status: 'active', assignedScope: (isAssociate || isManagerRole) ? (activeClientFilter === 'team' ? 'team' : 'mine') : undefined, subCompanyId: agencyParam, ownerIds: ownerIdsParam }),
      fetchClients({ page: 1, limit: 1, status: 'lost', lostScope: 'mine', subCompanyId: agencyParam, ownerIds: ownerIdsParam }),
      canFilterLostTeam
        ? fetchClients({ page: 1, limit: 1, status: 'lost', lostScope: 'team', subCompanyId: agencyParam, ownerIds: ownerIdsParam })
        : Promise.resolve({ data: [], pagination: { page: 1, limit: 1, total: 0, totalPages: 0 } }),
      fetchClients({ page: 1, limit: 1, status: 'unsubscribed', subCompanyId: agencyParam, ownerIds: ownerIdsParam }),
      fetchClients({ page: 1, limit: 1, status: 'permanently_closed', subCompanyId: agencyParam, ownerIds: ownerIdsParam }),
      fetchClients({ page: 1, limit: 1, status: 'ex', subCompanyId: agencyParam, ownerIds: ownerIdsParam }),
      fetchClients({ page: 1, limit: 1, ownershipType: 'management', subCompanyId: agencyParam }),
    ])
      .then(([allClients, myContactedClients, teamContactedClients, activeClients, lostMineClients, lostTeamClients, unsubscribedClients, permanentlyClosedClients, exClients, managementClients]) => {
        if (cancelled) return;
        setServerTabCounts({
          all: allClients.pagination.total,
          contactedMine: myContactedClients.pagination.total,
          contactedTeam: teamContactedClients.pagination.total,
          active: activeClients.pagination.total,
          lostMine: lostMineClients.pagination.total,
          lostTeam: lostTeamClients.pagination.total,
          ex: exClients.pagination.total,
          unsubscribed: unsubscribedClients.pagination.total,
          permanentlyClosed: permanentlyClosedClients.pagination.total,
          management: managementClients.pagination.total,
        });
        setTabCountsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setServerTabCounts((prev) => prev);
        setTabCountsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeClientFilter, canFilterContactedTeam, canFilterLostTeam, canViewAnyAgency, currentSubCompany?.id, isManagerRole, isAssociate, isElevated, isAllAgenciesView, unifiedFetchScopeKey, isUnifiedGlobalDbTab, isDatabaseManagerRole, isDatabaseManagerAgencyMode, useGlobalDbClientsUi, activeTab, effectiveAgencyId, listOwnerIdsKey, linkedAgencyId]);

  useEffect(() => {
    if (isAllAgenciesView || useGlobalDbClientsUi) return;
    return loadServerTabCounts();
  }, [activeTab, loadServerTabCounts, clientListRefreshKey, isAllAgenciesView, useGlobalDbClientsUi]);

  useEffect(() => {
    if (activeTab === 'pending') return;
    if (isAllAgenciesView || showAllTeamView) { setClientsLoading(false); return; }
    let cancelled = false;
    setClientsLoading(true);
    const statusParam = (activeTab === 'all' || activeTab === 'management' || !['contacted', 'active', 'lost', 'ex', 'unsubscribed', 'permanently_closed'].includes(activeTab)) ? undefined : activeTab;
    const ownershipTypeParam = activeTab === 'management' ? 'management' as const : undefined;
    const assignedScopeParam = statusParam === 'active' ? activeAssignedScope : undefined;
    const lostScopeParam = statusParam === 'lost' ? (canFilterLostTeam ? lostClientFilter : 'mine') : undefined;
    const contactedByMeParam = activeTab === 'contactedByMe' ? true : undefined;
    const contactedScopeParam = activeTab === 'contactedByMe'
      ? (canFilterContactedTeam && !canViewAnyAgency ? contactedClientFilter : (onlyMe ? 'mine' : 'team'))
      : undefined;
    const isGlobalDbTab = isUnifiedGlobalDbTab;
    // Management = ownership-type pool (not people filter). All other tabs, including All Clients,
    // use the same chip/owner scope so unselected = own records everywhere.
    const listOwnerIds =
      activeTab === 'management'
        ? undefined
        : listOwnerIdsParam !== undefined
          ? listOwnerIdsParam
          : ((isAgencyHierarchyViewer || isPureManager) ? scopedOwnerIds : undefined);
    const hasLeadParam = availabilityFilter === 'available' ? false : availabilityFilter === 'non-available' ? true : undefined;
    const industryParam = industryFilters.length > 0 ? industryFilters.join(',') : undefined;
    const locationParam = [...cityFilters, ...provinceFilters].length > 0 ? [...cityFilters, ...provinceFilters].join(',') : undefined;
    const companySizeParam = companySizeFilters.length > 0 ? companySizeFilters.join(',') : undefined;
    const tagsParam = tagFilters.length > 0 ? tagFilters.join(',') : undefined;
    const sortByParam = sortColumn ? (sortColumn === 'lastActivity' ? 'lastActivity' : sortColumn) as 'name' | 'industry' | 'location' | 'lastActivity' : undefined;
    const sortOrderParam = sortColumn ? sortDirection : undefined;
    fetchClients({
      page: apiPage,
      limit: PAGE_SIZE,
      search: debouncedSearch || undefined,
      status: statusParam,
      assignedScope: assignedScopeParam,
      lostScope: lostScopeParam,
      contactedByMe: contactedByMeParam,
      contactedScope: contactedScopeParam,
      ownershipType: ownershipTypeParam,
      industry: industryParam,
      location: locationParam,
      companySize: companySizeParam,
      tags: tagsParam,
      hasLead: hasLeadParam,
      sortBy: sortByParam,
      sortOrder: sortOrderParam,
      subCompanyId: isGlobalDbTab
        ? undefined
        : (isElevated
          ? effectiveAgencyId
          : (canViewAnyAgency ? currentSubCompany?.id : undefined)),
      ownerIds: isGlobalDbTab ? undefined : listOwnerIds,
      globalDb: isGlobalDbTab ? true : undefined,
      linkedAgencyId: isGlobalDbTab || isElevated ? undefined : linkedAgencyId,
    })
      .then(({ data, pagination }) => {
        if (cancelled) return;
        const mapped = data.map(mapApiClientToClient);
        setPaginationTotal(pagination.total);
        setPaginationTotalPages(pagination.totalPages);
        if (isGlobalDbTab && (useGlobalDbClientsUi || isDatabaseManagerGlobalAllView)) {
          setServerTabCounts((prev) => ({ ...prev, all: pagination.total }));
        }
        if (useInfiniteScroll) {
          setInfiniteClients(prev => apiPage === 1 ? mapped : [...prev, ...mapped]);
          setInfiniteHasMore(pagination.total > apiPage * PAGE_SIZE);
        } else {
          setClients(mapped);
        }
      })
      .catch(() => {
        if (!cancelled) {
          // Keep existing clients on error
        }
      })
      .finally(() => {
        if (!cancelled) setClientsLoading(false);
      });
    return () => { cancelled = true; };
  }, [
    activeTab,
    apiPage,
    debouncedSearch,
    activeAssignedScope,
    canFilterLostTeam,
    contactedClientFilter,
    availabilityFilter,
    industryFilters,
    cityFilters,
    provinceFilters,
    companySizeFilters,
    tagFilters,
    lostClientFilter,
    sortColumn,
    sortDirection,
    canViewAnyAgency,
    isElevated,
    currentSubCompany?.id,
    setClients,
    mapApiClientToClient,
    clientListRefreshKey,
    currentUser.id,
    isAllAgenciesView,
    showAllTeamView,
    isUnifiedGlobalDbTab,
    unifiedFetchScopeKey,
    useInfiniteScroll,
    isUnifiedGlobalDbTab,
  ]);

  // Load next page when the sentinel becomes visible (infinite scroll tabs only)
  useEffect(() => {
    if (!useInfiniteScroll || !sentinelRef.current || !infiniteHasMore || clientsLoading) return;
    const el = sentinelRef.current;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setApiPage(p => p + 1);
    }, { threshold: 0.1 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [useInfiniteScroll, infiniteHasMore, clientsLoading]);

  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [isClientSheetOpen, setIsClientSheetOpen] = useState(false);
  const [isRequestDialogOpen, setIsRequestDialogOpen] = useState(false);
  const [isAddClientDialogOpen, setIsAddClientDialogOpen] = useState(false);
  const [isFollowUpDialogOpen, setIsFollowUpDialogOpen] = useState(false);
  const [followUpRefreshKey, setFollowUpRefreshKey] = useState(0);
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [isAssignLeadDialogOpen, setIsAssignLeadDialogOpen] = useState(false);
  const [isEmailDialogOpen, setIsEmailDialogOpen] = useState(false);
  const [emailingClient, setEmailingClient] = useState<Client | null>(null);
  const [callingClient, setCallingClient] = useState<Client | null>(null);
  const [requestingClient, setRequestingClient] = useState<Client | null>(null);
  const [assigningClient, setAssigningClient] = useState<Client | null>(null);
  const [assigningAgencyId, setAssigningAgencyId] = useState<string | null>(null);
  const assignLeadAgencyId = useWriteAgencyId(assigningAgencyId ?? effectiveAgencyIdForClient);
  const [assignDialogMode, setAssignDialogMode] = useState<'assign' | 'reassign'>('assign');
  const [selectedRequest, setSelectedRequest] = useState<LeadRequest | null>(null);
  const [isRequestDetailsOpen, setIsRequestDetailsOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [pendingManualSubmissions, setPendingManualSubmissions] = useState<PendingManualSubmissionRecord[]>([]);
  const [pendingClientEdits, setPendingClientEdits] = useState<PendingClientEditRecord[]>([]);
  const [pendingImports, setPendingImports] = useState<PendingImportRecord[]>([]);
  const [pendingContactImports, setPendingContactImports] = useState<PendingContactImportRecord[]>([]);
  const [globalPendingManual, setGlobalPendingManual] = useState<PendingManualSubmissionRecord[]>([]);
  const [globalPendingImports, setGlobalPendingImports] = useState<PendingImportRecord[]>([]);
  const [globalPendingContactImports, setGlobalPendingContactImports] = useState<PendingContactImportRecord[]>([]);
  const [globalPendingLoading, setGlobalPendingLoading] = useState(false);
  const [pendingQueueLoading, setPendingQueueLoading] = useState(false);
  const [reviewingManualSubmission, setReviewingManualSubmission] = useState<PendingManualSubmissionRecord | null>(null);
  const [reviewingClientEdit, setReviewingClientEdit] = useState<PendingClientEditRecord | null>(null);
  const [reviewingImport, setReviewingImport] = useState<PendingImportRecord | null>(null);
  const [reviewingContactImport, setReviewingContactImport] = useState<PendingContactImportRecord | null>(null);
  const [agencyUsers, setAgencyUsers] = useState<Array<Pick<ApiUser, 'id' | 'subCompanyId' | 'isActive' | 'reportingManagerIds'>>>([]);
  const linkedClientId = searchParams.get('client');

  // Views state
  const [savedViews, setSavedViews] = useState<FilterView[]>(() => {
    const stored = localStorage.getItem('clientViews');
    return stored ? JSON.parse(stored) : [];
  });
  const [currentViewId, setCurrentViewId] = useState<string | null>(null);
  const [isNewViewDialogOpen, setIsNewViewDialogOpen] = useState(false);
  const [newViewName, setNewViewName] = useState('');

  const [facets, setFacets] = useState<{ industries: string[]; cities: string[]; provinces: string[]; companySizes: string[] }>({
    industries: [],
    cities: [],
    provinces: [],
    companySizes: [],
  });

  // Facets are loaded separately so options don't disappear after filtering/pagination.
  const industries = facets.industries;
  const cities = facets.cities;
  const provinces = facets.provinces;
  const companySizes = facets.companySizes;

  // Refresh client list when socket signals a new client was created
  useEffect(() => onClientRefresh(() => setClientListRefreshKey(k => k + 1)), []);

  // Pending queue: merged across accessible agencies when viewing All Agencies; otherwise scoped to selected agency.
  useEffect(() => {
    const t = searchParams.get('tab');
    if (t === 'pending' && canSeePendingQueue) setActiveTab('pending');
  }, [searchParams, canSeePendingQueue]);

  useEffect(() => {
    if (!canSeePendingQueue && activeTab === 'pending') setActiveTab('all');
  }, [canSeePendingQueue, activeTab]);

  // `accessibleAgencies` is `[]` (a fresh array each render) when the underlying useQuery is
  // disabled for non-elevated roles. Depending on the array directly would infinite-loop the
  // effect below (same trap the leads effect documents above). Memoize to a stable primitive.
  const accessibleAgencyIdsKey = useMemo(
    () => accessibleAgencies.map((a) => a.id).join(','),
    [accessibleAgencies],
  );

  useEffect(() => {
    if (!canSeePendingQueue) {
      setPendingManualSubmissions([]);
      setPendingClientEdits([]);
      setPendingImports([]);
      setPendingContactImports([]);
      setGlobalPendingManual([]);
      setGlobalPendingImports([]);
      setGlobalPendingContactImports([]);
      setPendingQueueLoading(false);
      setGlobalPendingLoading(false);
      return;
    }

    if (useGlobalDbClientsUi) {
      if (activeTab === 'pending') setPendingQueueLoading(true);
      Promise.all([
        fetchPendingClientSubmissions().catch(() => [] as PendingManualSubmissionRecord[]),
        fetchPendingImports().catch(() => [] as PendingImportRecord[]),
        fetchPendingContactImports().catch(() => [] as PendingContactImportRecord[]),
      ])
        .then(([manual, imports, contactImports]) => {
          setPendingManualSubmissions(manual);
          setPendingImports(imports);
          setPendingContactImports(contactImports);
          setPendingClientEdits([]);
        })
        .catch((err) => {
          if (activeTab === 'pending') {
            toast({
              title: 'Failed to load pending queue',
              description: err instanceof Error ? err.message : 'Unknown error',
              variant: 'destructive',
            });
          }
        })
        .finally(() => setPendingQueueLoading(false));
      return;
    }

    let clearGlobalPendingTimer: (() => void) | undefined;

    if (canApproveGlobalPending) {
      const loadGlobalPending = () => {
        setGlobalPendingLoading(true);
        Promise.all([
          fetchPendingClientSubmissions({ scope: 'global' }).catch(() => [] as PendingManualSubmissionRecord[]),
          fetchPendingImports({ scope: 'global' }).catch(() => [] as PendingImportRecord[]),
          fetchPendingContactImports({ scope: 'global' }).catch(() => [] as PendingContactImportRecord[]),
        ])
          .then(([manual, imports, contactImports]) => {
            setGlobalPendingManual(manual);
            setGlobalPendingImports(imports);
            setGlobalPendingContactImports(contactImports);
          })
          .catch(() => {
            setGlobalPendingManual([]);
            setGlobalPendingImports([]);
            setGlobalPendingContactImports([]);
          })
          .finally(() => setGlobalPendingLoading(false));
      };
      if (activeTab === 'pending') {
        loadGlobalPending();
      } else {
        const globalPendingTimer = window.setTimeout(loadGlobalPending, 2500);
        clearGlobalPendingTimer = () => window.clearTimeout(globalPendingTimer);
      }
    } else {
      setGlobalPendingManual([]);
      setGlobalPendingImports([]);
      setGlobalPendingContactImports([]);
    }

    if (isAllAgenciesView) {
      if (!accessibleAgencies.length) {
        setPendingManualSubmissions([]);
        setPendingClientEdits([]);
        setPendingImports([]);
        setPendingContactImports([]);
        setPendingQueueLoading(false);
        return;
      }
      setPendingQueueLoading(true);
      Promise.all([
        Promise.all(
          accessibleAgencies.map((a) =>
            fetchPendingClientSubmissions({ subCompanyId: a.id }).catch(() => [] as PendingManualSubmissionRecord[]),
          ),
        ),
        Promise.all(
          accessibleAgencies.map((a) =>
            fetchPendingClientEdits({ subCompanyId: a.id }).catch(() => [] as PendingClientEditRecord[]),
          ),
        ),
        Promise.all(accessibleAgencies.map((a) => fetchPendingImports({ subCompanyId: a.id }).catch(() => []))),
        Promise.all(
          accessibleAgencies.map((a) =>
            fetchPendingContactImports({ subCompanyId: a.id }).catch(() => [] as PendingContactImportRecord[]),
          ),
        ),
      ])
        .then(([manualRows, editRows, importRows, contactImportRows]) => {
          setPendingManualSubmissions(manualRows.flat());
          setPendingClientEdits(editRows.flat());
          setPendingImports(importRows.flat());
          setPendingContactImports(contactImportRows.flat());
        })
        .catch((err) => {
          toast({
            title: 'Failed to load pending queue',
            description: err instanceof Error ? err.message : 'Unknown error',
            variant: 'destructive',
          });
        })
        .finally(() => setPendingQueueLoading(false));
      return;
    }

    if (activeTab === 'pending') setPendingQueueLoading(true);
    const pendingScope =
      effectiveAgencyId != null
        ? { subCompanyId: effectiveAgencyId }
        : currentSubCompany?.id != null
          ? { subCompanyId: currentSubCompany.id }
          : undefined;
    const loadAgencyPending = () => {
      Promise.all([
        fetchPendingClientSubmissions(pendingScope).catch(() => [] as PendingManualSubmissionRecord[]),
        fetchPendingClientEdits(pendingScope).catch(() => [] as PendingClientEditRecord[]),
        fetchPendingImports(pendingScope).catch(() => [] as PendingImportRecord[]),
        fetchPendingContactImports(pendingScope).catch(() => [] as PendingContactImportRecord[]),
      ])
        .then(([manual, edits, imports, contactImports]) => {
          setPendingManualSubmissions(manual);
          setPendingClientEdits(edits);
          setPendingImports(imports);
          setPendingContactImports(contactImports);
        })
        .catch((err) => {
          if (activeTab === 'pending') {
            toast({
              title: 'Failed to load pending queue',
              description: err instanceof Error ? err.message : 'Unknown error',
              variant: 'destructive',
            });
          }
        })
        .finally(() => setPendingQueueLoading(false));
    };
    if (activeTab === 'all') {
      const agencyPendingTimer = window.setTimeout(loadAgencyPending, 2500);
      const prevClear = clearGlobalPendingTimer;
      clearGlobalPendingTimer = () => {
        window.clearTimeout(agencyPendingTimer);
        prevClear?.();
      };
    } else {
      loadAgencyPending();
    }

    return () => {
      clearGlobalPendingTimer?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab,
    toast,
    clientListRefreshKey,
    canSeePendingQueue,
    isDatabaseManagerRole,
    canApproveGlobalPending,
    isAllAgenciesView,
    accessibleAgencyIdsKey,
    effectiveAgencyId,
    currentSubCompany?.id,
  ]);

  useEffect(() => {
    if (activeFilterScopeRef.current !== dataScopeLevel) {
      activeFilterScopeRef.current = dataScopeLevel;
      if (isAssociate) {
        setActiveClientFilter('my');
        return;
      }
      if (isManagerRole) {
        setActiveClientFilter('team');
        return;
      }
    }

    if (isAssociate) {
      if (activeClientFilter !== 'my') setActiveClientFilter('my');
      return;
    }
    if (isManagerRole) {
      if (activeClientFilter === 'all') setActiveClientFilter('team');
      return;
    }
    if (activeClientFilter === 'team') {
      setActiveClientFilter('my');
    }
  }, [activeClientFilter, dataScopeLevel, isManagerRole, isAssociate]);

  useEffect(() => {
    if (isUnifiedGlobalDbTab) return;
    if (!isElevated && !currentSubCompany?.id) return;
    let cancelled = false;

    const subId = isElevated
      ? effectiveAgencyId
      : (canViewAnyAgency ? currentSubCompany?.id : undefined);

    fetchUsers({ subCompanyId: subId })
      .then((list) => {
        if (cancelled) return;
        setAgencyUsers(
          list.map((user) => ({
            id: user.id,
            subCompanyId: user.subCompanyId,
            isActive: user.isActive,
            reportingManagerIds: user.reportingManagerIds ?? [],
          }))
        );
      })
      .catch(() => {
        if (!cancelled) setAgencyUsers([]);
      });

    return () => {
      cancelled = true;
    };
  }, [canViewAnyAgency, currentSubCompany?.id, isElevated, unifiedFetchScopeKey, isUnifiedGlobalDbTab]);

  // Load stable facets for filter dropdowns (industry/city/province/company size)
  useEffect(() => {
    if (isUnifiedGlobalDbTab) return;
    let cancelled = false;
    const subId = isUnifiedGlobalDbTab
      ? undefined
      : (isElevated
        ? effectiveAgencyId
        : (canViewAnyAgency ? currentSubCompany?.id : undefined));
    (async () => {
      const data = await fetchClientFacets({ subCompanyId: subId });
      if (!cancelled) setFacets(data);
    })().catch(() => {
      if (!cancelled) setFacets({ industries: [], cities: [], provinces: [], companySizes: [] });
    });
    return () => {
      cancelled = true;
    };
  }, [canViewAnyAgency, currentSubCompany?.id, isElevated, unifiedFetchScopeKey, isUnifiedGlobalDbTab]);

  // Reset to page 1 when filters, search, sort, or scope change (server-side list)
  useEffect(() => {
    setApiPage(1);
  }, [
    debouncedSearch,
    industryFilters,
    cityFilters,
    provinceFilters,
    companySizeFilters,
    tagFilters,
    availabilityFilter,
    sortColumn,
    sortDirection,
    activeTab,
    contactedClientFilter,
    lostClientFilter,
    unifiedListScopeKey,
  ]);

  // Reset client-side pagination when filters or tab changes (pending tab)
  useEffect(() => {
    setCurrentPage(1);
  }, [industryFilter, locationFilter, tagFilters, industryFilters, cityFilters, provinceFilters, companySizeFilters, activeTab]);

  useEffect(() => {
    if (!linkedClientId) return;
    let cancelled = false;

    fetchClient(linkedClientId)
      .then((client) => {
        if (cancelled) return;
        if (!client) {
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete('client');
            return next;
          }, { replace: true });
          return;
        }
        setSelectedClient(mapApiClientToClient(client));
        setIsClientSheetOpen(true);
      })
      .catch(() => {
        if (cancelled) return;
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete('client');
          return next;
        }, { replace: true });
      });

    return () => {
      cancelled = true;
    };
  }, [linkedClientId, mapApiClientToClient, setSearchParams]);

  // Pending clients handlers — re-throw so the wizard's catch shows the real error.
  const handleAddToPending = async (
    newClients: SavePendingImportClient[],
    options?: { subCompanyId?: string; importDestination?: 'global' | 'agency' },
  ) => {
    if (isDatabaseManagerRole || isSuperUserScreenRole) {
      const result = await savePendingImports(newClients, options);
      const directAdded =
        typeof result.autoApprovedCount === 'number' &&
        result.autoApprovedCount > 0 &&
        result.autoApprovedCount === result.count;
      if (result.destination === 'agency') {
        toast({
          title: directAdded ? 'Import completed' : 'Import queued',
          description: directAdded
            ? `CSV rows were added directly for ${result.agencyName ?? 'the selected agency'} (no pending queue).`
            : `CSV rows were saved for ${result.agencyName ?? 'the selected agency'}. They follow Client Visibility settings after approval.`,
        });
      } else {
        toast({
          title: directAdded ? 'Import completed' : 'Import queued',
          description: directAdded
            ? 'CSV rows were added directly to the global database (no pending queue).'
            : 'CSV rows were saved to the global database pending queue.',
        });
      }
      setClientListRefreshKey((k) => k + 1);
      return;
    }

    if (isAllAgenciesView) {
      toast({
        title: 'Select an agency first',
        description: 'Choose a specific agency in the top filter before importing clients.',
        variant: 'destructive',
      });
      throw new Error('Select a specific agency before importing');
    }
    const importAgencyId = effectiveAgencyIdForClient;
    if (!importAgencyId) {
      toast({
        title: 'Agency required',
        description: 'Could not determine which agency to import into.',
        variant: 'destructive',
      });
      throw new Error('Agency context required for import');
    }
    await savePendingImports(newClients, { subCompanyId: importAgencyId });
    toast({
      title: 'Import queued',
      description:
        clientFlowConfig && isAgencyClientFlowConfig(clientFlowConfig)
          ? describeClientFlow(clientFlowConfig, { flow: 'import' }) ?? 'CSV rows were saved for approval.'
          : clientStorageContext
            ? getClientStorageMessage({ ...clientStorageContext, pending: true })
            : `CSV rows were saved for ${accessibleAgencies.find((a) => a.id === importAgencyId)?.name ?? resolvedAgencyName ?? 'this agency'}. They are no longer listed on this page.`,
    });
    setClientListRefreshKey((k) => k + 1);
  };

  const handleAddContactImports = async (
    rows: ContactImportRow[],
    options?: { subCompanyId?: string; importDestination?: 'global' | 'agency' },
  ) => {
    if (isDatabaseManagerRole || isSuperUserScreenRole) {
      const result = await savePendingContactImports(rows, options);
      const directAdded =
        typeof result.autoApprovedCount === 'number' &&
        result.autoApprovedCount > 0 &&
        result.autoApprovedCount === result.count;
      toast({
        title: directAdded ? 'Contact import completed' : 'Contact import queued',
        description: directAdded
          ? `${result.count} company batch(es) of contacts were added directly.`
          : `${result.count} company batch(es) of contacts were saved for approval.`,
      });
      setClientListRefreshKey((k) => k + 1);
      return;
    }

    if (isAllAgenciesView) {
      toast({
        title: 'Select an agency first',
        description: 'Choose a specific agency in the top filter before importing contacts.',
        variant: 'destructive',
      });
      throw new Error('Select a specific agency before importing');
    }
    const importAgencyId = effectiveAgencyIdForClient;
    if (!importAgencyId) {
      toast({
        title: 'Agency required',
        description: 'Could not determine which agency to import into.',
        variant: 'destructive',
      });
      throw new Error('Agency context required for import');
    }
    const result = await savePendingContactImports(rows, { subCompanyId: importAgencyId });
    const directAdded =
      typeof result.autoApprovedCount === 'number' &&
      result.autoApprovedCount > 0 &&
      result.autoApprovedCount === result.count;
    toast({
      title: directAdded ? 'Contact import completed' : 'Contact import queued',
      description: directAdded
        ? `${result.count} company batch(es) of contacts were added.`
        : `${result.count} company batch(es) of contacts were saved for approval (contact import workflow).`,
    });
    setClientListRefreshKey((k) => k + 1);
  };

  // Bulk approve/reject imports — one API call per agency (not one HTTP request per row).
  const runBulkOnImports = async (
    ids: string[],
    action: 'approve' | 'reject',
  ): Promise<void> => {
    const rowsById = new Map(pendingImports.map((r) => [r.id, r]));
    const byAgency = new Map<string, string[]>();
    for (const id of ids) {
      const row = rowsById.get(id);
      if (!row) continue;
      const list = byAgency.get(row.subCompanyId) ?? [];
      list.push(id);
      byAgency.set(row.subCompanyId, list);
    }

    let ok = 0;
    const failures: string[] = [];
    const succeededIds = new Set<string>();

    for (const [subCompanyId, agencyIds] of byAgency) {
      try {
        if (action === 'approve') {
          const result = await bulkApprovePendingImports(agencyIds, { subCompanyId });
          ok += result.approved;
          for (const f of result.failed) {
            failures.push(f.name || f.id);
          }
          agencyIds
            .filter((id) => !result.failed.some((f) => f.id === id))
            .forEach((id) => succeededIds.add(id));
        } else {
          const result = await bulkRejectPendingImports(agencyIds, { subCompanyId });
          ok += result.deleted;
          agencyIds.forEach((id) => succeededIds.add(id));
        }
      } catch (err) {
        for (const id of agencyIds) {
          const row = rowsById.get(id);
          failures.push(row?.name || id);
        }
        console.error('bulk pending-import action failed', { subCompanyId, action, err });
      }
    }

    if (succeededIds.size > 0) {
      setPendingImports((prev) => prev.filter((r) => !succeededIds.has(r.id)));
    }
    if (ok > 0 && action === 'approve') setClientListRefreshKey((k) => k + 1);
    if (failures.length === 0) {
      toast({
        title: action === 'approve' ? 'Clients approved' : 'Imports rejected',
        description: `${ok} row(s) processed in bulk.`,
      });
    } else {
      toast({
        title: `Completed with ${failures.length} failure(s)`,
        description: `${ok} succeeded. Failed: ${failures.slice(0, 5).join(', ')}${failures.length > 5 ? '…' : ''}`,
        variant: 'destructive',
      });
    }
  };

  const handleBulkApproveImports = (ids: string[]) => runBulkOnImports(ids, 'approve');
  const handleBulkRejectImports = (ids: string[]) => runBulkOnImports(ids, 'reject');

  const runBulkOnContactImports = async (
    ids: string[],
    action: 'approve' | 'reject',
  ): Promise<void> => {
    const rowsById = new Map(pendingContactImports.map((r) => [r.id, r]));
    const byAgency = new Map<string, string[]>();
    for (const id of ids) {
      const row = rowsById.get(id);
      if (!row?.subCompanyId) continue;
      const list = byAgency.get(row.subCompanyId) ?? [];
      list.push(id);
      byAgency.set(row.subCompanyId, list);
    }

    let ok = 0;
    const failures: string[] = [];
    const succeededIds = new Set<string>();

    for (const [subCompanyId, agencyIds] of byAgency) {
      try {
        if (action === 'approve') {
          const result = await bulkApprovePendingContactImports(agencyIds, { subCompanyId });
          ok += result.approved;
          for (const f of result.failed) failures.push(f.id);
          agencyIds
            .filter((id) => !result.failed.some((f) => f.id === id))
            .forEach((id) => succeededIds.add(id));
        } else {
          const result = await bulkRejectPendingContactImports(agencyIds, { subCompanyId });
          ok += result.rejected;
          agencyIds.forEach((id) => succeededIds.add(id));
        }
      } catch (err) {
        for (const id of agencyIds) failures.push(id);
        console.error('bulk pending-contact-import action failed', { subCompanyId, action, err });
      }
    }

    if (succeededIds.size > 0) {
      setPendingContactImports((prev) => prev.filter((r) => !succeededIds.has(r.id)));
    }
    if (ok > 0 && action === 'approve') setClientListRefreshKey((k) => k + 1);
    toast({
      title: action === 'approve' ? 'Contact imports approved' : 'Contact imports rejected',
      description:
        failures.length === 0
          ? `${ok} row(s) processed.`
          : `${ok} succeeded, ${failures.length} failed.`,
      variant: failures.length ? 'destructive' : undefined,
    });
  };

  const handleBulkApproveContactImports = (ids: string[]) =>
    runBulkOnContactImports(ids, 'approve');
  const handleBulkRejectContactImports = (ids: string[]) =>
    runBulkOnContactImports(ids, 'reject');

  // Bulk approve/reject/manager-approve for "Manual client submissions". Sequential to avoid
  // hammering the single-row endpoints (each director-approve creates a Client transactionally).
  const runBulkOnManual = async (
    ids: string[],
    action: 'approve' | 'reject' | 'managerApprove',
  ): Promise<void> => {
    const rowsById = new Map(pendingManualSubmissions.map((r) => [r.id, r]));
    const items = ids
      .map((id) => rowsById.get(id))
      .filter((r): r is PendingManualSubmissionRecord => !!r)
      .map((r) => ({ id: r.id, subCompanyId: r.subCompanyId, label: r.name }));
    const chainAction = action === 'managerApprove' ? 'forward' : action;
    const { ok, failures } = await bulkPostApprovalAction('client_manual_add', items, chainAction);
    if (ok > 0) {
      setClientListRefreshKey((k) => k + 1);
      if (action === 'approve' || action === 'reject') {
        setPendingManualSubmissions((prev) => prev.filter((r) => !ids.includes(r.id)));
      } else {
        const refreshed = await Promise.all(
          [...new Set(items.map((i) => i.subCompanyId).filter((id): id is string => !!id))].map((subCompanyId) =>
            fetchPendingClientSubmissions({ subCompanyId }).catch(() => [] as PendingManualSubmissionRecord[]),
          ),
        );
        setPendingManualSubmissions(refreshed.flat());
      }
    }
    if (failures.length === 0) {
      toast({
        title: bulkApprovalToastTitle(chainAction, ok),
        description: ok === 1 ? '1 submission processed.' : `${ok} submissions processed.`,
      });
    } else {
      toast({
        title: `Completed with ${failures.length} failure(s)`,
        description: `${ok} succeeded. Failed: ${failures.slice(0, 5).join(', ')}${failures.length > 5 ? '…' : ''}`,
        variant: 'destructive',
      });
    }
  };

  const handleBulkApproveManual = (ids: string[]) => runBulkOnManual(ids, 'approve');
  const handleBulkRejectManual = (ids: string[]) => runBulkOnManual(ids, 'reject');
  const handleBulkManagerApproveManual = (ids: string[]) => runBulkOnManual(ids, 'managerApprove');

  const runBulkOnGlobalManual = async (
    ids: string[],
    action: 'approve' | 'reject' | 'managerApprove',
  ): Promise<void> => {
    const rowsById = new Map(globalPendingManual.map((r) => [r.id, r]));
    const items = ids
      .map((id) => rowsById.get(id))
      .filter((r): r is PendingManualSubmissionRecord => !!r)
      .map((r) => ({ id: r.id, subCompanyId: r.subCompanyId, label: r.name }));
    const chainAction = action === 'managerApprove' ? 'forward' : action;
    const { ok, failures } = await bulkPostApprovalAction('database_client_add', items, chainAction);
    if (ok > 0) {
      setClientListRefreshKey((k) => k + 1);
      if (action === 'approve' || action === 'reject') {
        setGlobalPendingManual((prev) => prev.filter((r) => !ids.includes(r.id)));
      } else {
        const refreshed = await fetchPendingClientSubmissions({ scope: 'global' }).catch(
          () => [] as PendingManualSubmissionRecord[],
        );
        setGlobalPendingManual(refreshed);
      }
    }
    if (failures.length === 0) {
      toast({
        title: bulkApprovalToastTitle(chainAction, ok),
        description: ok === 1 ? '1 global submission processed.' : `${ok} global submissions processed.`,
      });
    } else {
      toast({
        title: `Completed with ${failures.length} failure(s)`,
        description: `${ok} succeeded. Failed: ${failures.slice(0, 5).join(', ')}${failures.length > 5 ? '…' : ''}`,
        variant: 'destructive',
      });
    }
  };

  const handleBulkApproveGlobalManual = (ids: string[]) => runBulkOnGlobalManual(ids, 'approve');
  const handleBulkRejectGlobalManual = (ids: string[]) => runBulkOnGlobalManual(ids, 'reject');

  const runBulkOnGlobalImports = async (ids: string[], action: 'approve' | 'reject'): Promise<void> => {
    const rowsById = new Map(globalPendingImports.map((r) => [r.id, r]));
    const items = ids
      .map((id) => rowsById.get(id))
      .filter((r): r is PendingImportRecord => !!r)
      .map((r) => ({ id: r.id, subCompanyId: r.subCompanyId, label: r.name }));
    const { ok, failures } = await bulkPostApprovalAction('database_client_import', items, action);
    if (ok > 0) {
      setClientListRefreshKey((k) => k + 1);
      setGlobalPendingImports((prev) => prev.filter((r) => !ids.includes(r.id)));
    }
    toast({
      title: action === 'approve' ? `Approved ${ok} import(s)` : `Rejected ${ok} import(s)`,
      description: failures.length > 0 ? `Failed: ${failures.slice(0, 3).join(', ')}` : undefined,
      variant: failures.length === ids.length ? 'destructive' : 'default',
    });
  };

  const handleBulkApproveGlobalImports = (ids: string[]) => runBulkOnGlobalImports(ids, 'approve');
  const handleBulkRejectGlobalImports = (ids: string[]) => runBulkOnGlobalImports(ids, 'reject');

  const runBulkOnEdit = async (
    ids: string[],
    action: 'approve' | 'reject' | 'managerApprove',
  ): Promise<void> => {
    const rowsById = new Map(pendingClientEdits.map((r) => [r.id, r]));
    const items = ids
      .map((id) => rowsById.get(id))
      .filter((r): r is PendingClientEditRecord => !!r)
      .map((r) => ({ id: r.id, subCompanyId: r.subCompanyId, label: r.name }));
    const chainAction = action === 'managerApprove' ? 'forward' : action;
    const { ok, failures } = await bulkPostApprovalAction('client_manual_edit', items, chainAction);
    if (ok > 0) {
      setClientListRefreshKey((k) => k + 1);
      if (action === 'approve' || action === 'reject') {
        setPendingClientEdits((prev) => prev.filter((r) => !ids.includes(r.id)));
      } else {
        const refreshed = await Promise.all(
          [...new Set(items.map((i) => i.subCompanyId))].map((subCompanyId) =>
            fetchPendingClientEdits({ subCompanyId }).catch(() => [] as PendingClientEditRecord[]),
          ),
        );
        setPendingClientEdits(refreshed.flat());
      }
    }
    if (failures.length === 0) {
      toast({
        title: bulkApprovalToastTitle(chainAction, ok),
        description: ok === 1 ? '1 edit processed.' : `${ok} edits processed.`,
      });
    } else {
      toast({
        title: `Completed with ${failures.length} failure(s)`,
        description: `${ok} succeeded. Failed: ${failures.slice(0, 3).join(', ')}${failures.length > 3 ? '…' : ''}`,
        variant: failures.length === ids.length ? 'destructive' : 'default',
      });
    }
  };

  const refreshPendingQueue = () => setClientListRefreshKey((k) => k + 1);

  const handleBulkApproveEdit = (ids: string[]) => runBulkOnEdit(ids, 'approve');
  const handleBulkRejectEdit = (ids: string[]) => runBulkOnEdit(ids, 'reject');
  const handleBulkManagerApproveEdit = (ids: string[]) => runBulkOnEdit(ids, 'managerApprove');

  const toggleTagFilter = (tag: string) => {
    setTagFilters(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const toggleIndustryFilter = (industry: string) => {
    setIndustryFilters(prev => 
      prev.includes(industry) ? prev.filter(i => i !== industry) : [...prev, industry]
    );
  };

  const toggleCityFilter = (city: string) => {
    setCityFilters(prev => 
      prev.includes(city) ? prev.filter(c => c !== city) : [...prev, city]
    );
  };

  const toggleProvinceFilter = (province: string) => {
    setProvinceFilters(prev => 
      prev.includes(province) ? prev.filter(p => p !== province) : [...prev, province]
    );
  };

  const toggleCompanySizeFilter = (size: string) => {
    setCompanySizeFilters(prev => 
      prev.includes(size) ? prev.filter(s => s !== size) : [...prev, size]
    );
  };

  const saveCurrentView = () => {
    if (!newViewName.trim()) {
      toast({
        title: "Error",
        description: "Please enter a view name",
        variant: "destructive",
      });
      return;
    }

    const newView: FilterView = {
      id: Date.now().toString(),
      name: newViewName,
      type: 'clients',
      filters: {
        industryFilters,
        cityFilters,
        provinceFilters,
        companySizeFilters,
        tagFilters,
        availabilityFilter,
      },
      createdAt: new Date(),
    };

    const updatedViews = [...savedViews, newView];
    setSavedViews(updatedViews);
    localStorage.setItem('clientViews', JSON.stringify(updatedViews));
    setCurrentViewId(newView.id);
    setIsNewViewDialogOpen(false);
    setNewViewName('');
    
    toast({
      title: "View saved",
      description: `View "${newViewName}" has been saved successfully`,
    });
  };

  const applyView = (viewId: string) => {
    const view = savedViews.find(v => v.id === viewId);
    if (!view) return;

    setIndustryFilters(view.filters.industryFilters || []);
    setCityFilters(view.filters.cityFilters || []);
    setProvinceFilters(view.filters.provinceFilters || []);
    setCompanySizeFilters(view.filters.companySizeFilters || []);
    setTagFilters(view.filters.tagFilters || []);
    setAvailabilityFilter(view.filters.availabilityFilter || 'all');
    setCurrentViewId(viewId);
    
    toast({
      title: "View applied",
      description: `Filters from "${view.name}" have been applied`,
    });
  };

  const deleteView = (viewId: string) => {
    const view = savedViews.find(v => v.id === viewId);
    const updatedViews = savedViews.filter(v => v.id !== viewId);
    setSavedViews(updatedViews);
    localStorage.setItem('clientViews', JSON.stringify(updatedViews));
    
    if (currentViewId === viewId) {
      setCurrentViewId(null);
    }
    
    toast({
      title: "View deleted",
      description: `View "${view?.name}" has been deleted`,
    });
  };

  const clearAllFilters = () => {
    setSearchInput('');
    setIndustryFilters([]);
    setCityFilters([]);
    setProvinceFilters([]);
    setCompanySizeFilters([]);
    setTagFilters([]);
    setAvailabilityFilter('all');
    setCurrentViewId(null);
  };

  // Advanced search removed: use regular search + filters together.
  
  // For elevated users browsing another agency, prefer that agency's records over their own.
  const agencyIdForFilters = effectiveAgencyIdForClient ?? currentSubCompany?.id;

  const getClientLead = (clientId: string) => {
    const sortLeads = (a: typeof leads[number], b: typeof leads[number]) => {
      const priority = (lead: typeof leads[number]) => {
        if (lead.status === 'closed_won') return 2;
        if (isOpenPipelineLeadStatus(lead.status)) return 1;
        return 0;
      };
      const priorityDiff = priority(b) - priority(a);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    };

    const subCompanyLeads = leads
      .filter((lead) => lead.clientId === clientId && lead.subCompanyId === agencyIdForFilters)
      .sort(sortLeads);
    if (subCompanyLeads.length > 0) return subCompanyLeads[0];

    return leads
      .filter((lead) => lead.clientId === clientId)
      .sort(sortLeads)[0];
  };

  const directReportIds = agencyUsers
    .filter((user) =>
      user.isActive &&
      user.subCompanyId === agencyIdForFilters &&
      user.reportingManagerIds?.includes(currentUser.id)
    )
    .map((user) => user.id);

  const getLeadRequest = (clientId: string) => {
    return leadRequests.find(
      (req) =>
        req.clientId === clientId &&
        req.subCompanyId === agencyIdForFilters &&
        req.requestedBy === currentUser.id &&
        req.status === 'pending',
    );
  };
  
  const canRequestLead = (clientId: string) => {
    const existingLead = getClientLead(clientId);
    const existingRequest = getLeadRequest(clientId);
    return !existingLead && !existingRequest;
  };

  const handleRequestLead = (client: Client, e: React.MouseEvent) => {
    e.stopPropagation();
    if (canAssignLead) {
      setAssigningClient(client);
      setAssignDialogMode(client.status === 'lost' && !!client.latestLostLeadId ? 'reassign' : 'assign');
      setAssigningAgencyId(null);
      setIsAssignLeadDialogOpen(true);
    } else {
      setRequestingClient(client);
      setIsRequestDialogOpen(true);
    }
  };

  const handleViewRequest = (request: LeadRequest, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedRequest(request);
    setIsRequestDetailsOpen(true);
  };

  const handleViewClient = (client: Client) => {
    if (client.heldByOtherAssociate) return;
    setSelectedClient(client);
    setIsClientSheetOpen(true);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('client', client.id);
      return next;
    }, { replace: true });
  };

  const getActivityIcon = (type: ActivityType) => {
    switch (type) {
      case 'call_made':
        return <PhoneCall className="h-4 w-4" />;
      case 'meeting_scheduled':
        return <Calendar className="h-4 w-4" />;
      case 'task_created':
      case 'task_completed':
      case 'task_status_changed':
        return <CheckCircle className="h-4 w-4" />;
      case 'pipeline_moved':
        return <ArrowRight className="h-4 w-4" />;
      case 'comment_added':
        return <MessageSquare className="h-4 w-4" />;
      case 'email_sent':
        return <Mail className="h-4 w-4" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  const getActivityColor = (type: ActivityType) => {
    switch (type) {
      case 'call_made':
        return 'text-blue-500';
      case 'meeting_scheduled':
        return 'text-purple-500';
      case 'task_completed':
        return 'text-green-500';
      case 'task_created':
      case 'task_status_changed':
        return 'text-orange-500';
      case 'pipeline_moved':
        return 'text-indigo-500';
      case 'email_sent':
        return 'text-pink-500';
      default:
        return 'text-muted-foreground';
    }
  };

  const handleSort = (column: typeof sortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (column: typeof sortColumn) => {
    if (sortColumn !== column) return <ArrowUpDown className="h-4 w-4 ml-1" />;
    return sortDirection === 'asc' ? <ArrowUp className="h-4 w-4 ml-1" /> : <ArrowDown className="h-4 w-4 ml-1" />;
  };

  
  const isServerDrivenList = activeTab === 'all' || activeTab === 'contactedByMe' || activeTab === 'management' || ['contacted', 'active', 'lost', 'ex', 'unsubscribed', 'permanently_closed'].includes(activeTab);

  const globalTabCount = isDatabaseManagerGlobalAllView
    ? globalDbAllCount
    : (serverTabCounts.all ?? (activeTab === 'all' ? paginationTotal : clients.length));
  const contactedTabCount = contactedClientFilter === 'team'
    ? serverTabCounts.contactedTeam ?? 0
    : serverTabCounts.contactedMine ?? (activeTab === 'contactedByMe' ? paginationTotal : clients.filter((client) => client.contactedByMe).length);
  const lostTabCount = lostClientFilter === 'team'
    ? serverTabCounts.lostTeam ?? 0
    : serverTabCounts.lostMine ?? 0;
  const listSubtitle = activeTab === 'contactedByMe'
    ? contactedClientFilter === 'team'
      ? 'Team contacted clients'
      : 'My contacted clients'
    : activeTab === 'pending'
      ? 'Manual submissions awaiting approval'
      : activeTab === 'active'
        ? 'Active clients'
        : activeTab === 'lost'
          ? lostClientFilter === 'team'
            ? 'My team lost clients'
            : 'My lost clients'
          : activeTab === 'management'
            ? 'Management-owned clients'
            : isUnifiedGlobalDbTab
              ? 'Global client database'
              : isDatabaseManagerRole && isDatabaseManagerAgencyMode && activeTab === 'all'
                ? 'Agency clients'
                : 'All clients';
  const agencyPendingCount =
    pendingManualSubmissions.length +
    pendingClientEdits.length +
    pendingImports.length +
    pendingContactImports.length;
  const globalPendingCount = globalPendingManual.length + globalPendingImports.length;
  const totalPendingCount = isDatabaseManagerRole
    ? agencyPendingCount
    : agencyPendingCount + (canApproveGlobalPending ? globalPendingCount : 0);

  const listSubtitleCount = activeTab === 'pending'
    ? totalPendingCount
    : isAllAgenciesView
      ? allAgenciesTotal
      : isServerDrivenList
        ? paginationTotal
        : clients.length;

  const filteredClients = isServerDrivenList
    ? clients.filter((client) => {
        if (isAssociate && (client as Client & { restrictedUsers?: string[] }).restrictedUsers?.includes(currentUser.id)) {
          return false;
        }
        return true;
      })
    : clients.filter((client) => {
        if (isAssociate && (client as Client & { restrictedUsers?: string[] }).restrictedUsers?.includes(currentUser.id)) return false;
        const matchesIndustry = industryFilters.length === 0 || industryFilters.includes(client.industry);
        const [clientCity, clientProvince] = client.location.split(',').map((s) => s.trim());
        const matchesCity = cityFilters.length === 0 || cityFilters.includes(clientCity);
        const matchesProvince = provinceFilters.length === 0 || provinceFilters.includes(clientProvince);
        const matchesCompanySize = companySizeFilters.length === 0 || companySizeFilters.includes(client.companySize);
        const matchesTags = tagFilters.length === 0 || tagFilters.some((tag) => client.tags.includes(tag));
        const hasLead = !!getClientLead(client.id);
        let matchesAvailability = true;
        if (availabilityFilter === 'available') matchesAvailability = !hasLead;
        else if (availabilityFilter === 'non-available') matchesAvailability = hasLead;
        const matchesTab = activeTab === 'all' || client.status === activeTab;
        let matchesOwnership = true;
        if (activeTab === 'active' && activeClientFilter === 'my') {
          const clientLead = getClientLead(client.id);
          matchesOwnership = (client.assignedOwnerId ?? clientLead?.ownerId) === currentUser.id;
        } else if (activeTab === 'active' && activeClientFilter === 'team') {
          const clientLead = getClientLead(client.id);
          const assignedOwnerId = client.assignedOwnerId ?? clientLead?.ownerId;
          matchesOwnership = assignedOwnerId ? directReportIds.includes(assignedOwnerId) : false;
        }
        return matchesIndustry && matchesCity && matchesProvince && matchesCompanySize && matchesTags && matchesAvailability && matchesTab && matchesOwnership;
      });

  const sortedClients = isServerDrivenList ? filteredClients : [...filteredClients].sort((a, b) => {
    if (!sortColumn) return 0;
    let comparison = 0;
    switch (sortColumn) {
      case 'name': comparison = a.name.localeCompare(b.name); break;
      case 'industry': comparison = a.industry.localeCompare(b.industry); break;
      case 'location': comparison = a.location.localeCompare(b.location); break;
      case 'lastActivity':
        comparison = (a.lastActivity ? new Date(a.lastActivity).getTime() : 0) - (b.lastActivity ? new Date(b.lastActivity).getTime() : 0);
        break;
      default: return 0;
    }
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  const totalPages = isServerDrivenList ? paginationTotalPages : Math.ceil(sortedClients.length / itemsPerPage);
  const currentPageNum = isServerDrivenList ? apiPage : currentPage;
  const startIndex = isServerDrivenList ? (apiPage - 1) * PAGE_SIZE : (currentPage - 1) * itemsPerPage;
  const paginatedClients = isServerDrivenList ? sortedClients : sortedClients.slice(startIndex, startIndex + itemsPerPage);

  // For infinite-scroll tabs, render the accumulated list directly; for paginated tabs use paginatedClients.
  const displayClients = useInfiniteScroll
    ? infiniteClients.filter(client =>
        !(isAssociate && (client as Client & { restrictedUsers?: string[] }).restrictedUsers?.includes(currentUser.id))
      )
    : paginatedClients;

  // Don't replace the table with a full-page spinner while loading *more* rows (page > 1).
  const showLoadingSpinner = clientsLoading && activeTab !== 'pending' && !(useInfiniteScroll && apiPage > 1);
  
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pt-6">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold text-foreground">Clients</h1>
          <p className="text-muted-foreground mt-1">
            {listSubtitle} — {listSubtitleCount.toLocaleString()} clients
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* canFilterUsers && (
            <UserMultiSelect
              users={filterUsers}
              selectedIds={selectedUserIds}
              onChange={setSelectedUserIds}
              isLoading={usersLoading}
            />
          ) */}
          {canWriteClients && (
            <Button
              variant="outline"
              onClick={() => setIsImportDialogOpen(true)}
              disabled={isAllAgenciesView && !needsDestinationConfig}
              title={
                isAllAgenciesView && !needsDestinationConfig
                  ? 'Select a specific agency in the top filter before importing'
                  : undefined
              }
              className="gap-2"
            >
              <Upload className="h-4 w-4" />
              Import clients
            </Button>
          )}
          {canWriteClients && (
            <Button
              onClick={() => setIsAddClientDialogOpen(true)}
              disabled={isAllAgenciesView && !needsDestinationConfig}
              title={
                isAllAgenciesView && !needsDestinationConfig
                  ? 'Select a specific agency in the top filter before adding a client'
                  : undefined
              }
              className="gap-2"
            >
              <UserPlus className="h-4 w-4" />
              Add Client
            </Button>
          )}
        </div>
      </div>

      {/* ── Per-person / manager sections (All Managers / All Team) ───────── */}
      {showAllTeamView && (
        <>
          {showAgencyFilterBar && (
            <StickyHeader zIndex={40}>
              <ScopeFilterBar
                show={showAgencyFilterBar}
                filterRowProps={filterRowProps}
                hideUserRows={showAgencyFilterOnly}
              />
            </StickyHeader>
          )}
          {sectionUsers.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-12">
              {showManagerSections
                ? 'No managers / team in this agency'
                : 'No team members in this scope'}
            </p>
          ) : (
            <div className="space-y-6">
              <div className="flex justify-end">
                <label
                  htmlFor="show-client-serial-people"
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 cursor-pointer select-none transition-colors',
                    showClientSerial
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted/60',
                  )}
                >
                  <Hash
                    className={cn(
                      'h-3.5 w-3.5',
                      showClientSerial ? 'text-primary' : 'text-muted-foreground',
                    )}
                  />
                  <span className="text-sm font-medium">Client #</span>
                  <Switch
                    id="show-client-serial-people"
                    checked={showClientSerial}
                    onCheckedChange={(v) => setShowClientSerial(v === true)}
                  />
                </label>
              </div>
              {sectionUsers.map((user) => {
                const agencyIdForUser =
                  selectedAgencyId !== 'all' && selectedAgencyId !== 'me'
                    ? selectedAgencyId
                    : user.subCompanyId || currentSubCompany?.id || '';
                const agencyNameForUser =
                  accessibleAgencies.find((a) => a.id === agencyIdForUser)?.name ??
                  `${user.firstName} ${user.lastName}`.trim();
                return (
                  <div key={user.id} className="space-y-2">
                    <PersonSectionHeader
                      user={user}
                      roleTitle={getUserRoleTitle(user)}
                      subtitle={agencyNameForUser || undefined}
                      onView={() =>
                        showManagerSections
                          ? setSelectedManagerId(user.id)
                          : setSelectedUserId(user.id)
                      }
                    />
                    {agencyIdForUser ? (
                      <AgencyClientsCard
                        agency={{ id: agencyIdForUser, name: agencyNameForUser }}
                        onViewClients={() =>
                          showManagerSections
                            ? setSelectedManagerId(user.id)
                            : setSelectedUserId(user.id)
                        }
                        hideAgencyHeader
                        mapApiClient={mapApiClientToClient}
                        mapApiLeadRequest={mapApiLeadRequestToLeadRequest}
                        showClientSerial={showClientSerial}
                        selectedAgencyId={selectedAgencyId}
                        ownerIds={[user.id]}
                        scopeKey={`${scopeKey}|user:${user.id}`}
                        callbacks={{
                          onViewClient: (client) => handleViewClient(client),
                          onCallClient: async (client) => {
                            const full = await fetchClient(client.id);
                            const fullClient = full ? mapApiClientToClient(full) : client;
                            setCallingClient(fullClient);
                            openCallInterface(fullClient);
                          },
                          onEmailClient: (client) => {
                            setEmailingClient(client);
                            setIsEmailDialogOpen(true);
                          },
                          onFollowUpClient: (client) => {
                            setSelectedClient(client);
                            setIsFollowUpDialogOpen(true);
                          },
                          onAssignLead: (client, mode, agencyId) => {
                            setAssigningClient(client);
                            setAssignDialogMode(mode);
                            setAssigningAgencyId(agencyId);
                            setIsAssignLeadDialogOpen(true);
                          },
                          onRequestLead: (client) => {
                            setRequestingClient(client);
                            setIsRequestDialogOpen(true);
                          },
                          onViewLeadRequest: (request) => {
                            setSelectedRequest(request);
                            setIsRequestDetailsOpen(true);
                          },
                        }}
                      />
                    ) : (
                      <p className="text-center text-sm text-muted-foreground py-8">
                        No agency found for this user
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── All-Agencies Sectioned View ──────────────────────────────────── */}
      {isAllAgenciesView && (
        <>
          {showAgencyFilterBar && (
            <StickyHeader zIndex={40}>
              <ScopeFilterBar
                show={showAgencyFilterBar}
                filterRowProps={filterRowProps}
                hideUserRows={showAgencyFilterOnly}
              />
            </StickyHeader>
          )}
          {agenciesLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-3 text-muted-foreground">Loading agencies...</span>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex justify-end">
              <label
                htmlFor="show-client-serial-all"
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 cursor-pointer select-none transition-colors',
                  showClientSerial
                    ? 'border-primary/40 bg-primary/10 text-foreground'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted/60',
                )}
              >
                <Hash className={cn('h-3.5 w-3.5', showClientSerial ? 'text-primary' : 'text-muted-foreground')} />
                <span className="text-sm font-medium">Client #</span>
                <Switch
                  id="show-client-serial-all"
                  checked={showClientSerial}
                  onCheckedChange={(v) => setShowClientSerial(v === true)}
                />
              </label>
            </div>
            {accessibleAgencies.map((agency) => (
              <AgencyClientsCard
                key={agency.id}
                agency={agency}
                onViewClients={() => setSelectedAgencyId(agency.id)}
                mapApiClient={mapApiClientToClient}
                mapApiLeadRequest={mapApiLeadRequestToLeadRequest}
                showClientSerial={showClientSerial}
                selectedAgencyId={selectedAgencyId}
                ownerIds={scopedOwnerIds}
                scopeKey={unifiedListScopeKey}
                callbacks={{
                  onViewClient: (client) => handleViewClient(client),
                  onCallClient: async (client) => {
                    const full = await fetchClient(
                      client.id,
                      isAllAgenciesView ? { allAgencies: true } : undefined,
                    );
                    const fullClient = full ? mapApiClientToClient(full) : client;
                    setCallingClient(fullClient);
                    openCallInterface(fullClient);
                  },
                  onEmailClient: (client) => {
                    setEmailingClient(client);
                    setIsEmailDialogOpen(true);
                  },
                  onFollowUpClient: (client) => {
                    setSelectedClient(client);
                    setIsFollowUpDialogOpen(true);
                  },
                  onAssignLead: (client, mode, agencyId) => {
                    setAssigningClient(client);
                    setAssignDialogMode(mode);
                    setAssigningAgencyId(agencyId);
                    setIsAssignLeadDialogOpen(true);
                  },
                  onRequestLead: (client) => {
                    setRequestingClient(client);
                    setIsRequestDialogOpen(true);
                  },
                  onViewLeadRequest: (request) => {
                    setSelectedRequest(request);
                    setIsRequestDetailsOpen(true);
                  },
                }}
              />
            ))}
            {canApproveGlobalPending && (
            <div className="pt-8 mt-2 border-t space-y-4">
              <h2 className="text-lg font-semibold tracking-tight">Global database — pending approvals</h2>
              <PendingQueuesPanel
                title="Global database submissions"
                description="Clients submitted by Database Managers for org-wide approval. The configured route is Director / Operations Manager only — no manager pre-approval step."
                pendingQueueLoading={globalPendingLoading}
                pendingManualSubmissions={globalPendingManual}
                onReviewManual={setReviewingManualSubmission}
                canDirectorActManual={canFinalApprovePending}
                onBulkApproveManual={handleBulkApproveGlobalManual}
                onBulkRejectManual={handleBulkRejectGlobalManual}
                enableManagerForward={false}
                pendingImports={globalPendingImports}
                onReviewImport={setReviewingImport}
                canBulkActImports={isDirector}
                onBulkApproveImports={handleBulkApproveGlobalImports}
                onBulkRejectImports={handleBulkRejectGlobalImports}
                pendingContactImports={globalPendingContactImports}
                onReviewContactImport={setReviewingContactImport}
                canBulkActContactImports={isDirector}
                onBulkApproveContactImports={handleBulkApproveContactImports}
                onBulkRejectContactImports={handleBulkRejectContactImports}
              />
            </div>
            )}
            {canSeePendingQueue && !isDatabaseManagerRole && (
            <div className="pt-8 mt-2 border-t space-y-4">
              <h2 className="text-lg font-semibold tracking-tight">Pending client approvals (all agencies)</h2>
              <PendingQueuesPanel
                showAgencyColumn
                agencyNameById={(id) => accessibleAgencies.find((a) => a.id === id)?.name}
                pendingQueueLoading={pendingQueueLoading}
                pendingManualSubmissions={pendingManualSubmissions}
                onReviewManual={setReviewingManualSubmission}
                canDirectorActManual={canFinalApprovePending}
                onBulkApproveManual={handleBulkApproveManual}
                onBulkRejectManual={handleBulkRejectManual}
                canManagerActManual={canManagerPreApproveManual}
                onBulkManagerApproveManual={handleBulkManagerApproveManual}
                pendingClientEdits={pendingClientEdits}
                onReviewEdit={setReviewingClientEdit}
                canDirectorActEdit={canFinalApprovePending}
                onBulkApproveEdit={canFinalApprovePending ? handleBulkApproveEdit : undefined}
                onBulkRejectEdit={canFinalApprovePending ? handleBulkRejectEdit : undefined}
                onBulkManagerApproveEdit={handleBulkManagerApproveEdit}
                pendingImports={pendingImports}
                onReviewImport={setReviewingImport}
                canBulkActImports={isDirector}
                onBulkApproveImports={handleBulkApproveImports}
                onBulkRejectImports={handleBulkRejectImports}
                pendingContactImports={pendingContactImports}
                onReviewContactImport={setReviewingContactImport}
                canBulkActContactImports={isDirector}
                onBulkApproveContactImports={handleBulkApproveContactImports}
                onBulkRejectContactImports={handleBulkRejectContactImports}
              />
            </div>
            )}
          </div>
          )}
        </>
      )}

      {!isAllAgenciesView && !showAllTeamView && (
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <StickyHeader zIndex={40}>
          <ScopeFilterBar
            show={showAgencyFilterBar}
            filterRowProps={filterRowProps}
            hideUserRows={showAgencyFilterOnly}
          />
          <div className="w-full pt-1.5">
            <TabsList className="flex w-full h-auto flex-nowrap items-stretch gap-1 rounded-xl border border-slate-200/60 bg-slate-100/80 p-1">
          <TabsTrigger value="all" className={CLIENT_STATUS_TAB}>
            <span className={CLIENT_STATUS_LABEL}>{isUnifiedGlobalDbTab ? 'Global DB Clients' : 'All Clients'}</span>
            <Badge variant="secondary" className={CLIENT_STATUS_BADGE}>
              {globalTabCount}
            </Badge>
          </TabsTrigger>
          {!useGlobalDbClientsUi && (
          <>
          <TabsTrigger value="contactedByMe" className={CLIENT_STATUS_TAB}>
            <span className={CLIENT_STATUS_LABEL}>Contacted</span>
            <Badge variant="secondary" className={CLIENT_STATUS_BADGE}>
              {tabCountsLoading ? <span className="inline-block h-3 w-5 rounded animate-pulse bg-muted" /> : contactedTabCount}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="active" className={CLIENT_STATUS_TAB}>
            <span className={CLIENT_STATUS_LABEL}>Active</span>
            <Badge variant="secondary" className={CLIENT_STATUS_BADGE}>
              {tabCountsLoading ? <span className="inline-block h-3 w-5 rounded animate-pulse bg-muted" /> : (serverTabCounts.active ?? 0)}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="lost" className={CLIENT_STATUS_TAB}>
            <span className={CLIENT_STATUS_LABEL}>Lost</span>
            <Badge variant="secondary" className={CLIENT_STATUS_BADGE}>
              {tabCountsLoading ? <span className="inline-block h-3 w-5 rounded animate-pulse bg-muted" /> : lostTabCount}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="ex" className={CLIENT_STATUS_TAB}>
            <span className={CLIENT_STATUS_LABEL}>Ex</span>
            <Badge variant="secondary" className={CLIENT_STATUS_BADGE}>
              {tabCountsLoading ? <span className="inline-block h-3 w-5 rounded animate-pulse bg-muted" /> : (serverTabCounts.ex ?? 0)}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="unsubscribed" className={CLIENT_STATUS_TAB}>
            <span className={CLIENT_STATUS_LABEL}>Unsubscribed</span>
            <Badge variant="secondary" className={CLIENT_STATUS_BADGE}>
              {tabCountsLoading ? <span className="inline-block h-3 w-5 rounded animate-pulse bg-muted" /> : (serverTabCounts.unsubscribed ?? 0)}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="permanently_closed" className={CLIENT_STATUS_TAB} title="Permanently Closed">
            <span className={CLIENT_STATUS_LABEL}>Permanently Closed</span>
            <Badge variant="secondary" className={CLIENT_STATUS_BADGE}>
              {tabCountsLoading ? <span className="inline-block h-3 w-5 rounded animate-pulse bg-muted" /> : (serverTabCounts.permanentlyClosed ?? 0)}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="management" className={CLIENT_STATUS_TAB}>
            <span className={CLIENT_STATUS_LABEL}>Management</span>
            <Badge variant="secondary" className={CLIENT_STATUS_BADGE}>
              {tabCountsLoading ? <span className="inline-block h-3 w-5 rounded animate-pulse bg-muted" /> : (serverTabCounts.management ?? 0)}
            </Badge>
          </TabsTrigger>
          </>
          )}
          {canSeePendingQueue && (
          <TabsTrigger value="pending" className={CLIENT_STATUS_TAB}>
            <span className={CLIENT_STATUS_LABEL}>Pending</span>
            <Badge
              variant={totalPendingCount > 0 ? 'default' : 'secondary'}
              className={cn(
                CLIENT_STATUS_BADGE,
                totalPendingCount > 0 && 'bg-blue-600 text-white group-data-[state=active]:bg-blue-600 group-data-[state=active]:text-white',
              )}
            >
              {totalPendingCount}
            </Badge>
          </TabsTrigger>
          )}
          </TabsList>
          </div>
        </StickyHeader>

        {activeTab !== 'pending' && (
        <TabsContent value={activeTab} className="mt-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 flex-wrap">
              {!(activeTab === 'active' && (isAssociate || isManagerRole)) && (
                <Select value={currentViewId || 'default'} onValueChange={(value) => {
                  if (value === 'default') {
                    clearAllFilters();
                  } else {
                    applyView(value);
                  }
                }}>
                  <SelectTrigger className="w-full sm:w-48">
                    <Eye className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Select View" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">All Clients (Default)</SelectItem>
                    {savedViews.map(view => (
                      <SelectItem key={view.id} value={view.id}>
                        {view.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {activeTab === 'active' && isManagerRole && (
                <Select value={activeClientFilter === 'all' ? 'my' : activeClientFilter} onValueChange={(value: 'my' | 'team') => setActiveClientFilter(value)}>
                  <SelectTrigger className="w-full sm:w-44">
                    <Users className="h-4 w-4 mr-2" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="my">My Active</SelectItem>
                    <SelectItem value="team">My Team</SelectItem>
                  </SelectContent>
                </Select>
              )}

              {activeTab === 'active' && !isAssociate && !isManagerRole && !canViewAnyAgency && (
                <Select value={activeClientFilter === 'team' ? 'my' : activeClientFilter} onValueChange={(value: 'my' | 'all') => setActiveClientFilter(value)}>
                  <SelectTrigger className="w-full sm:w-40">
                    <Users className="h-4 w-4 mr-2" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="my">My Clients</SelectItem>
                    <SelectItem value="all">All Clients</SelectItem>
                  </SelectContent>
                </Select>
              )}

              {activeTab === 'contactedByMe' && canFilterContactedTeam && !canViewAnyAgency && (
                <Select value={contactedClientFilter} onValueChange={(value: 'mine' | 'team') => setContactedClientFilter(value)}>
                  <SelectTrigger className="w-full sm:w-48">
                    <Users className="h-4 w-4 mr-2" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mine">My Contacted</SelectItem>
                    <SelectItem value="team">Team Contacted</SelectItem>
                  </SelectContent>
                </Select>
              )}

              {activeTab === 'lost' && canFilterLostTeam && !canViewAnyAgency && (
                <Select value={lostClientFilter} onValueChange={(value: 'mine' | 'team') => setLostClientFilter(value)}>
                  <SelectTrigger className="w-full sm:w-48">
                    <Users className="h-4 w-4 mr-2" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mine">My Lost</SelectItem>
                    <SelectItem value="team">My Team Lost</SelectItem>
                  </SelectContent>
                </Select>
              )}

              {(industryFilters.length > 0 || cityFilters.length > 0 || provinceFilters.length > 0 || companySizeFilters.length > 0 || tagFilters.length > 0 || availabilityFilter !== 'all') && (
                <Dialog open={isNewViewDialogOpen} onOpenChange={setIsNewViewDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Save className="h-4 w-4 mr-2" />
                      Save View
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Save Current View</DialogTitle>
                    <DialogDescription>
                      Save your current filter settings as a view for quick access later
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="view-name">View Name</Label>
                      <Input
                        id="view-name"
                        placeholder="e.g., Hot Leads in Tech"
                        value={newViewName}
                        onChange={(e) => setNewViewName(e.target.value)}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsNewViewDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={saveCurrentView}>Save View</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              )}

              {savedViews.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Eye className="h-4 w-4 mr-2" />
                      Manage Views ({savedViews.length})
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-3 bg-popover" align="start">
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm mb-2">Saved Views</h4>
                      {savedViews.map(view => (
                        <div key={view.id} className="flex items-center justify-between p-2 hover:bg-accent hover:text-accent-foreground rounded">
                          <div className="flex-1">
                            <p className="text-sm font-medium">{view.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(view.createdAt), 'MMM d, yyyy')}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteView(view.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              )}

              {(industryFilters.length > 0 || cityFilters.length > 0 || provinceFilters.length > 0 || companySizeFilters.length > 0 || tagFilters.length > 0) && (
                <Button variant="ghost" size="sm" onClick={clearAllFilters}>
                  Clear All Filters
                </Button>
              )}

              <label
                htmlFor="show-client-serial"
                className={cn(
                  'ml-auto inline-flex items-center gap-2 rounded-full border px-3 py-1.5 cursor-pointer select-none transition-colors',
                  showClientSerial
                    ? 'border-primary/40 bg-primary/10 text-foreground'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted/60',
                )}
              >
                <Hash className={cn('h-3.5 w-3.5', showClientSerial ? 'text-primary' : 'text-muted-foreground')} />
                <span className="text-sm font-medium">Client #</span>
                <Switch
                  id="show-client-serial"
                  checked={showClientSerial}
                  onCheckedChange={(v) => setShowClientSerial(v === true)}
                />
              </label>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1 flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, industry, location..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full sm:w-48 justify-start">
                  <Building2 className="h-4 w-4 mr-2" />
                  Industry
                  {industryFilters.length > 0 && (
                    <Badge variant="secondary" className="ml-auto">
                      {industryFilters.length}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-3 bg-popover max-h-80 overflow-y-auto" align="start">
                <div className="space-y-2">
                  <h4 className="font-medium text-sm mb-2">Filter by Industry</h4>
                  {industries.map((industry) => (
                    <div key={industry} className="flex items-center space-x-2">
                      <Checkbox
                        id={`industry-${industry}`}
                        checked={industryFilters.includes(industry)}
                        onCheckedChange={() => toggleIndustryFilter(industry)}
                      />
                      <label
                        htmlFor={`industry-${industry}`}
                        className="text-sm cursor-pointer flex-1"
                      >
                        {industry}
                      </label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full sm:w-48 justify-start">
                  <MapPin className="h-4 w-4 mr-2" />
                  Province
                  {provinceFilters.length > 0 && (
                    <Badge variant="secondary" className="ml-auto">
                      {provinceFilters.length}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-3 bg-popover max-h-80 overflow-y-auto" align="start">
                <div className="space-y-2">
                  <h4 className="font-medium text-sm mb-2">Filter by Province</h4>
                  {provinces.map((province) => (
                    <div key={province} className="flex items-center space-x-2">
                      <Checkbox
                        id={`province-${province}`}
                        checked={provinceFilters.includes(province)}
                        onCheckedChange={() => toggleProvinceFilter(province)}
                      />
                      <label
                        htmlFor={`province-${province}`}
                        className="text-sm cursor-pointer flex-1"
                      >
                        {province}
                      </label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full sm:w-48 justify-start">
                  <MapPin className="h-4 w-4 mr-2" />
                  City
                  {cityFilters.length > 0 && (
                    <Badge variant="secondary" className="ml-auto">
                      {cityFilters.length}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-3 bg-popover max-h-80 overflow-y-auto" align="start">
                <div className="space-y-2">
                  <h4 className="font-medium text-sm mb-2">Filter by City</h4>
                  {cities.map((city) => (
                    <div key={city} className="flex items-center space-x-2">
                      <Checkbox
                        id={`city-${city}`}
                        checked={cityFilters.includes(city)}
                        onCheckedChange={() => toggleCityFilter(city)}
                      />
                      <label
                        htmlFor={`city-${city}`}
                        className="text-sm cursor-pointer flex-1"
                      >
                        {city}
                      </label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full sm:w-48 justify-start">
                  <Users className="h-4 w-4 mr-2" />
                  Company Size
                  {companySizeFilters.length > 0 && (
                    <Badge variant="secondary" className="ml-auto">
                      {companySizeFilters.length}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-3 bg-popover max-h-80 overflow-y-auto" align="start">
                <div className="space-y-2">
                  <h4 className="font-medium text-sm mb-2">Filter by Company Size</h4>
                  {companySizes.map((size) => (
                    <div key={size} className="flex items-center space-x-2">
                      <Checkbox
                        id={`size-${size}`}
                        checked={companySizeFilters.includes(size)}
                        onCheckedChange={() => toggleCompanySizeFilter(size)}
                      />
                      <label
                        htmlFor={`size-${size}`}
                        className="text-sm cursor-pointer flex-1"
                      >
                        {size}
                      </label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {showLoadingSpinner ? (
            <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
              <Loader2 className="h-10 w-10 animate-spin mb-4" />
              <p className="text-sm font-medium">Loading clients...</p>
            </div>
          ) : (
          <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>
                  <button 
                    onClick={() => handleSort('name')}
                    className="flex items-center hover:text-foreground transition-colors"
                  >
                    Client Name
                    {getSortIcon('name')}
                  </button>
                </TableHead>
                <TableHead>
                  <button 
                    onClick={() => handleSort('industry')}
                    className="flex items-center hover:text-foreground transition-colors"
                  >
                    Industry
                    {getSortIcon('industry')}
                  </button>
                </TableHead>
                <TableHead>City</TableHead>
                <TableHead>Province</TableHead>
                <TableHead>Primary Contact</TableHead>
                <TableHead>
                  <button 
                    onClick={() => handleSort('lastActivity')}
                    className="flex items-center hover:text-foreground transition-colors"
                  >
                    Last Activity
                    {getSortIcon('lastActivity')}
                  </button>
                </TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayClients.map((client, index) => {
                const lead = getClientLead(client.id);
                const leadRequest = getLeadRequest(client.id);
                const canRequest = canRequestLead(client.id);
                const primaryContact = client.contacts.find(c => c.isPrimary);
                // Only treat as "assigned" when there is an open/active lead.
                // Closed-won/lost history should not block manager reassignment actions.
                const pipeline = resolvePipelineLeadContext(client, lead);
                const assignedOwnerId = pipeline.assignedOwnerId;
                const assignedOwnerName = pipeline.assignedOwnerName;
                // Client actions (Call, Email, Follow-Up):
                // - Director, super admin, operations manager: always allowed regardless of lead state.
                // - Reporting manager of the lead's owner (open or closed lead): always allowed.
                // - The assigned associate of an open lead: allowed.
                // - No open pipeline lead: anyone may act (associate can initiate contact).
                // - Pending lead request (mine): keep outreach while waiting for approval.
                const ownerIdForReportingCheck = assignedOwnerId ?? lead?.ownerId;
                const isReportingManagerForOwner = !!ownerIdForReportingCheck && directReportIds.includes(ownerIdForReportingCheck);
                const canAccessClientActions =
                  isElevated
                  || isReportingManagerForOwner
                  || (assignedOwnerId
                    ? (assignedOwnerId === currentUser.id || linkedUserIds.includes(assignedOwnerId))
                    : !pipeline.hasPipelineLead)
                  || Boolean(leadRequest);
                const isActive = client.status === 'active';
                // Lost badge visibility:
                // - Lost tab: always show (backend already filters by scope)
                // - Managers: show based on client status (they have oversight)
                // - Associates: only show if they personally lost this client AND client is not won (Active wins over Lost in Global)
                const isLost =
                  (activeTab === 'lost' && !!client.latestLostLeadId)
                  || (canFilterLostTeam && client.status === 'lost')
                  || (!canFilterLostTeam && !!client.latestLostById && client.latestLostById === currentUser.id && !isActive && !client.hasOpenLead);
                const isUnsubscribed = client.status === 'unsubscribed';
                const isPermanentlyClosed = client.status === 'permanently_closed';
                const isDisabled = isUnsubscribed || isPermanentlyClosed;
                const isHeldByOtherAssociate = !!client.heldByOtherAssociate;
                const isOwnClientForAssociate =
                  pipeline.ownerId === currentUser.id
                  || linkedUserIds.includes(pipeline.ownerId ?? '')
                  || (!!client.latestLostById && (client.latestLostById === currentUser.id || linkedUserIds.includes(client.latestLostById)));
                const showAgencyStatusBadges =
                  !isAssociate || activeTab !== 'all' || isOwnClientForAssociate;

                const rowNum = useInfiniteScroll ? index + 1 : startIndex + index + 1;

                if (isHeldByOtherAssociate) {
                  return (
                    <HeldByOtherAssociateTableRow key={client.id} rowNum={rowNum} />
                  );
                }

                  return (
                    <TableRow
                      key={client.id}
                      className={`${isDisabled ? 'opacity-60' : ''} cursor-pointer hover:bg-muted/50`}
                      onClick={() => handleViewClient(client)}
                    >
                      <TableCell className="w-[4.5rem] whitespace-nowrap align-middle py-3">
                        <ClientIdCellContent
                          rowNum={rowNum}
                          serialNumber={client.serialNumber}
                          showClientSerial={showClientSerial}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => handleViewClient(client)}
                            className="hover:underline text-left"
                          >
                            {client.name}
                          </button>
                          {client.forwardedFromName && (selectedAgencyId === 'all' || selectedAgencyId === 'me' || selectedAgencyId === client.forwardedFromSubCompanyId) && <ForwardedChip name={client.forwardedFromName} />}
                          {showAgencyStatusBadges && (() => {
                            const tag = pickClientTag({
                              ...client,
                              hasOpenLead: client.hasOpenLead || pipeline.hasPipelineLead,
                              _isLostForViewer: isLost,
                            });
                            if (!tag) return null;
                            const blurClass = '';
                            const showOwnerLine =
                              canFilterLostTeam ||
                              (isAssociate && (assignedOwnerId === currentUser.id || linkedUserIds.includes(assignedOwnerId ?? '')));
                            if (tag === 'active') return (
                              <>
                                <Badge variant="outline" className={`w-fit border-green-400 bg-green-50 px-2 py-0.5 text-xs text-green-700 ${blurClass}`}>Active</Badge>
                                {showOwnerLine && assignedOwnerName && (
                                  <div className={`text-xs text-muted-foreground ${blurClass}`}>Assigned to: {assignedOwnerName}</div>
                                )}
                              </>
                            );
                            if (tag === 'lost') return (
                              <>
                                <Badge variant="outline" className={`w-fit border-red-400 bg-red-50 px-2 py-0.5 text-xs text-red-700 ${blurClass}`}>Lost</Badge>
                                {canFilterLostTeam && (
                                  <div className={`text-xs text-muted-foreground ${blurClass}`}>Lost by: {client.latestLostByName || 'Unknown'}</div>
                                )}
                                {canFilterLostTeam && client.hasOpenLead && (
                                  <div className={`text-xs text-muted-foreground italic ${blurClass}`}>Reassigned</div>
                                )}
                              </>
                            );
                            if (tag === 'unsubscribed') return (
                              <Badge variant="outline" className={`w-fit border-gray-400 bg-gray-50 px-2 py-0.5 text-xs text-gray-700 ${blurClass}`}>Unsubscribed</Badge>
                            );
                            if (tag === 'permanently_closed') return (
                              <Badge variant="outline" className={`w-fit border-gray-400 bg-gray-50 px-2 py-0.5 text-xs text-gray-700 ${blurClass}`}>Permanently Closed</Badge>
                            );
                            if (tag === 'ex') return (
                              <Badge variant="outline" className={`w-fit border-red-400 bg-red-50 px-2 py-0.5 text-xs text-red-700 ${blurClass}`}>Ex</Badge>
                            );
                            return (
                              <>
                                <Badge variant="outline" className={`w-fit border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-700 ${blurClass}`}>Contacted</Badge>
                                {canFilterContactedTeam && client.latestOutreachByName && (
                                  <div className={`text-xs text-muted-foreground ${blurClass}`}>Contacted by: {client.latestOutreachByName}</div>
                                )}
                                {assignedOwnerName && (
                                  <div className={`text-xs text-muted-foreground ${blurClass}`}>Assigned to: {assignedOwnerName}</div>
                                )}
                              </>
                            );
                          })()}
                          {activeTab === 'all' && canFilterLostTeam && client.latestLostLeadId && !isLost && (
                            <div className="text-xs text-muted-foreground">
                            {client.hasOpenLead && client.activeLeadOwnerName ? `Reassigned to ${client.activeLeadOwnerName}` : ''}
                            </div>
                          )}
                          {activeTab === 'contactedByMe' && contactedClientFilter === 'team' && client.contactedByName && (
                            <div className="text-xs text-muted-foreground">
                              Contacted By: {client.contactedByName}
                            </div>
                          )}
                        </div>
                      </TableCell>
                     <TableCell >
                      {client.industry}
                    </TableCell>
                    <TableCell >
                      <div className="flex items-center gap-1 text-sm">
                        <MapPin className="h-3 w-3 text-muted-foreground" />
                        {client.location.split(',')[0]?.trim()}
                      </div>
                    </TableCell>
                    <TableCell >
                      {client.location.split(',')[1]?.trim()}
                    </TableCell>
                    <TableCell >
                      {primaryContact ? (
                        <div>
                          <div className="font-medium text-sm">{primaryContact.name}</div>
                          <div className="text-xs text-muted-foreground">{primaryContact.title}</div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">No contact</span>
                      )}
                    </TableCell>
                      <TableCell >
                        {client.lastActivity ? (
                          format(new Date(client.lastActivity), 'MMM d, yyyy')
                        ) : (
                          <span className="text-muted-foreground">Never</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-1">
                        {(client.ownershipType === 'management' || (client.ownershipType === 'associate' && client.ownershipUserName)) && (
                          <div className="text-xs text-muted-foreground">
                            Owned by {client.ownershipType === 'management' ? 'Management' : client.ownershipUserName}
                          </div>
                        )}
                        {isDataOnlyRole ? (
                          <span className="text-muted-foreground">—</span>
                        ) : isLost ? (
                          <div className="flex flex-col items-end gap-1">
                            <div className="text-sm text-muted-foreground">
                              Lost by {client.latestLostByName || 'Unknown'}
                            </div>
                            {canAccessClientActions && (
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const full = await fetchClient(client.id);
                                    const fullClient = full ? mapApiClientToClient(full) : client;
                                    setCallingClient(fullClient);
                                    openCallInterface(fullClient);
                                  }}
                                >
                                  <PhoneCall className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEmailingClient(client);
                                    setIsEmailDialogOpen(true);
                                  }}
                                >
                                  <Mail className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedClient(client);
                                    setIsFollowUpDialogOpen(true);
                                  }}
                                >
                                  <Calendar className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                            {canAssignLead && client.latestLostLeadId && !client.hasOpenLead && (
                              <Button variant="outline" size="sm" onClick={(e) => handleRequestLead(client, e)}>
                                Reassign Lead
                              </Button>
                            )}
                          </div>
                        ) : isActive ? (
                          <div className="flex flex-col items-end gap-2">
                            <div className="text-sm text-muted-foreground">
                              Assigned to {client.activeLeadOwnerName ?? client.assignedOwnerName ?? 'Unknown'}
                            </div>
                            {canAccessClientActions && (
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const full = await fetchClient(client.id);
                                    const fullClient = full ? mapApiClientToClient(full) : client;
                                    setCallingClient(fullClient);
                                    openCallInterface(fullClient);
                                  }}
                                >
                                  <PhoneCall className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEmailingClient(client);
                                    setIsEmailDialogOpen(true);
                                  }}
                                >
                                  <Mail className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedClient(client);
                                    setIsFollowUpDialogOpen(true);
                                  }}
                                >
                                  <Calendar className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </div>
                        ) : !isUnsubscribed && !isPermanentlyClosed ? (
                          <div className="flex items-center justify-end gap-2">
                            {/* Communication buttons: assigned associate, their reporting manager,
                                director, super admin, and operations manager. When unassigned, anyone may act. */}
                            {canAccessClientActions && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const full = await fetchClient(client.id);
                                    const fullClient = full ? mapApiClientToClient(full) : client;
                                    setCallingClient(fullClient);
                                    openCallInterface(fullClient);
                                  }}
                                >
                                  <PhoneCall className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEmailingClient(client);
                                    setIsEmailDialogOpen(true);
                                  }}
                                >
                                  <Mail className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedClient(client);
                                    setIsFollowUpDialogOpen(true);
                                  }}
                                >
                                  <Calendar className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                            {/* Request/Assign Lead: Sales Associate sees "Request Lead", managers/Director/Super Admin see "Assign Lead" */}
                            {leadRequest ? (
                              <div
                                className="text-sm cursor-pointer hover:underline"
                                onClick={(e) => handleViewRequest(leadRequest, e)}
                              >
                                <div className="font-medium text-foreground">Lead Requested</div>
                                <div className="text-xs text-muted-foreground">
                                  {format(new Date(leadRequest.requestedAt), 'MMM d, yyyy h:mm a')}
                                </div>
                              </div>
                            ) : isAssociate && assignedOwnerId && assignedOwnerId !== currentUser.id && !linkedUserIds.includes(assignedOwnerId) ? (
                              <span className="text-sm font-medium text-muted-foreground">Assigned to someone else</span>
                            ) : assignedOwnerId && assignedOwnerId !== currentUser.id && !linkedUserIds.includes(assignedOwnerId) ? (
                              <div className="text-sm text-muted-foreground">
                                Assigned to {assignedOwnerName || users.find(u => u.id === assignedOwnerId)?.name || 'Unknown'}
                              </div>
                            ) : isAssociate && canRequest ? (
                              <Button variant="outline" size="sm" onClick={(e) => handleRequestLead(client, e)}>
                                Request Lead
                              </Button>
                            ) : canAssignLead && (!assignedOwnerId || assignedOwnerId !== currentUser.id) ? (
                              <Button variant="outline" size="sm" onClick={(e) => handleRequestLead(client, e)}>
                                Assign Lead
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                );
              })}
            </TableBody>
          </Table>
          
          {/* Pagination — Global DB and Contacted tabs only */}
          {!useInfiniteScroll && totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-4 border-t">
              <div className="text-sm text-muted-foreground">
                Showing {startIndex + 1} to {startIndex + displayClients.length} of {isServerDrivenList ? paginationTotal : sortedClients.length} clients
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => isServerDrivenList ? setApiPage((p) => Math.max(1, p - 1)) : setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPageNum === 1}
                >
                  Previous
                </Button>
                <div className="flex items-center gap-1">
                  {(() => {
                    const maxButtons = 10;
                    const start = totalPages <= maxButtons ? 1 : Math.min(Math.max(1, currentPageNum - 4), totalPages - maxButtons + 1);
                    const end = Math.min(start + maxButtons - 1, totalPages);
                    return Array.from({ length: end - start + 1 }, (_, i) => start + i).map((page) => (
                      <Button
                        key={page}
                        variant={currentPageNum === page ? "default" : "outline"}
                        size="sm"
                        onClick={() => isServerDrivenList ? setApiPage(page) : setCurrentPage(page)}
                        className="min-w-[40px]"
                      >
                        {page}
                      </Button>
                    ));
                  })()}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => isServerDrivenList ? setApiPage((p) => Math.min(totalPages, p + 1)) : setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPageNum === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}

          {/* Infinite scroll sentinel and end-of-list indicator */}
          {useInfiniteScroll && (
            <>
              {(infiniteHasMore || clientsLoading) && (
                <div ref={sentinelRef} className="flex items-center justify-center py-6">
                  {clientsLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
                </div>
              )}
              {!infiniteHasMore && !clientsLoading && infiniteClients.length > 0 && (
                <div className="text-center py-4 text-sm text-muted-foreground border-t">
                  Showing all {infiniteClients.length} clients
                </div>
              )}
            </>
          )}

          {!clientsLoading && displayClients.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No clients found matching your criteria
            </div>
          )}
          </>
          )}
        </CardContent>
      </Card>
        </TabsContent>
        )}

        {/* Pending Tab Content */}
        {canSeePendingQueue && (
        <TabsContent value="pending" className="mt-4 space-y-6">
          {canApproveGlobalPending && !isAllAgenciesView && (
            <PendingQueuesPanel
              title="Global database submissions"
              description="Clients submitted by Database Managers for org-wide approval. The configured route is Director / Operations Manager only — no manager pre-approval step."
              pendingQueueLoading={globalPendingLoading}
              pendingManualSubmissions={globalPendingManual}
              onReviewManual={setReviewingManualSubmission}
              canDirectorActManual={canFinalApprovePending}
              onBulkApproveManual={handleBulkApproveGlobalManual}
              onBulkRejectManual={handleBulkRejectGlobalManual}
              enableManagerForward={false}
              pendingImports={globalPendingImports}
              onReviewImport={setReviewingImport}
              canBulkActImports={isDirector}
              onBulkApproveImports={handleBulkApproveGlobalImports}
              onBulkRejectImports={handleBulkRejectGlobalImports}
              pendingContactImports={globalPendingContactImports}
              onReviewContactImport={setReviewingContactImport}
              canBulkActContactImports={isDirector}
              onBulkApproveContactImports={handleBulkApproveContactImports}
              onBulkRejectContactImports={handleBulkRejectContactImports}
            />
          )}
          {isDatabaseManagerRole ? (
            <PendingQueuesPanel
              title="My global database submissions"
              description="Track status of clients you submitted. They become visible org-wide after final approval."
              readOnly
              pendingQueueLoading={pendingQueueLoading}
              pendingManualSubmissions={pendingManualSubmissions}
              onReviewManual={setReviewingManualSubmission}
              pendingImports={pendingImports}
              onReviewImport={setReviewingImport}
              pendingContactImports={pendingContactImports}
              onReviewContactImport={setReviewingContactImport}
            />
          ) : (
          <PendingQueuesPanel
            pendingQueueLoading={pendingQueueLoading}
            pendingManualSubmissions={pendingManualSubmissions}
            onReviewManual={setReviewingManualSubmission}
            canDirectorActManual={canFinalApprovePending}
            onBulkApproveManual={handleBulkApproveManual}
            onBulkRejectManual={handleBulkRejectManual}
            canManagerActManual={canManagerPreApproveManual}
            onBulkManagerApproveManual={handleBulkManagerApproveManual}
            pendingClientEdits={pendingClientEdits}
            onReviewEdit={setReviewingClientEdit}
            canDirectorActEdit={canFinalApprovePending}
            onBulkApproveEdit={canFinalApprovePending ? handleBulkApproveEdit : undefined}
            onBulkRejectEdit={canFinalApprovePending ? handleBulkRejectEdit : undefined}
            onBulkManagerApproveEdit={handleBulkManagerApproveEdit}
            pendingImports={pendingImports}
            onReviewImport={setReviewingImport}
            canBulkActImports={isDirector}
            onBulkApproveImports={handleBulkApproveImports}
            onBulkRejectImports={handleBulkRejectImports}
            pendingContactImports={pendingContactImports}
            onReviewContactImport={setReviewingContactImport}
            canBulkActContactImports={isDirector}
            onBulkApproveContactImports={handleBulkApproveContactImports}
            onBulkRejectContactImports={handleBulkRejectContactImports}
          />
          )}
        </TabsContent>
        )}
      </Tabs>
      )}

      <PendingClientEditSheet
        edit={reviewingClientEdit}
        onClose={() => setReviewingClientEdit(null)}
        onQueueChanged={refreshPendingQueue}
      />

      <PendingManualSubmissionSheet
        submission={reviewingManualSubmission}
        onClose={() => setReviewingManualSubmission(null)}
        onQueueChanged={() => {
          refreshPendingQueue();
          setActiveTab('all');
        }}
      />

      <PendingClientReviewSheet
        pending={reviewingImport}
        onClose={() => setReviewingImport(null)}
        onQueueChanged={refreshPendingQueue}
      />

      <PendingContactImportReviewSheet
        pending={reviewingContactImport}
        onClose={() => setReviewingContactImport(null)}
        onQueueChanged={refreshPendingQueue}
      />

      {/* Client Details Sheet */}
      <ClientDetailsSheet
        allAgenciesView={isAllAgenciesView}
        open={isClientSheetOpen}
        onOpenChange={(open) => {
          setIsClientSheetOpen(open);
          if (!open) {
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              next.delete('client');
              return next;
            }, { replace: true });
          }
        }}
        client={selectedClient}
        subCompanyId={writeAgencyId}
        onClientUpdated={setSelectedClient}
        onPendingEditSubmitted={refreshPendingQueue}
        onAddFollowUpClick={() => {
          setIsFollowUpDialogOpen(true);
        }}
        followUpRefreshKey={followUpRefreshKey}
        onAddTaskClick={() => {
          setIsTaskDialogOpen(true);
        }}
      />

      <LeadRequestDialog
        open={isRequestDialogOpen}
        onOpenChange={setIsRequestDialogOpen}
        client={requestingClient}
        onSuccess={(created) => {
          if (!created) return;
          if (created.autoApproved || created.status === 'approved') {
            const subId = isElevated
              ? (selectedAgencyId !== 'all' ? selectedAgencyId : currentSubCompany?.id)
              : (canViewAnyAgency ? currentSubCompany?.id : undefined);
            const agencyName = resolvedAgencyName ?? currentSubCompany?.name ?? '';
            if (subId) {
              fetchLeads({ limit: 1000, subCompanyId: subId })
                .then((res) => setLeads(res.data.map((a) => mapApiLeadToLead(a, agencyName)) as Lead[]))
                .catch(() => {});
            }
            setClientListRefreshKey((k) => k + 1);
            return;
          }
          setLeadRequests([mapApiLeadRequestToLeadRequest(created), ...leadRequests]);
        }}
      />

      <LeadRequestDetailsDialog
        open={isRequestDetailsOpen}
        onOpenChange={setIsRequestDetailsOpen}
        request={selectedRequest}
      />

      <AddClientDialog
        open={isAddClientDialogOpen}
        onOpenChange={setIsAddClientDialogOpen}
        subCompanyId={needsDestinationConfig ? undefined : writeAgencyId}
        clientFlowConfig={clientFlowConfig}
        destinationAgencies={destinationAgencies}
        storageContext={clientStorageContext}
        onClientAdded={() => setClientListRefreshKey((k) => k + 1)}
        onPendingSubmitted={() => setClientListRefreshKey((k) => k + 1)}
      />

      <FollowUpDialog
        open={isFollowUpDialogOpen}
        onOpenChange={setIsFollowUpDialogOpen}
        clientId={selectedClient?.id || ''}
        clientName={selectedClient?.name || ''}
        subCompanyId={writeAgencyId}
        client={selectedClient || undefined}
        onFollowUpCreated={() => { loadFollowUps(); setFollowUpRefreshKey(k => k + 1); }}
      />

      <CreateTaskDialog
        open={isTaskDialogOpen}
        onOpenChange={setIsTaskDialogOpen}
        subCompanyId={writeAgencyId}
        onTaskCreated={() => setClientListRefreshKey((k) => k + 1)}
      />

      <AssignLeadDialog
        open={isAssignLeadDialogOpen}
        onOpenChange={(open) => {
          setIsAssignLeadDialogOpen(open);
          if (!open) {
            setAssigningClient(null);
            setAssigningAgencyId(null);
            setAssignDialogMode('assign');
          }
        }}
        client={assigningClient}
        subCompanyId={assignLeadAgencyId}
        mode={assignDialogMode}
        sourceLeadId={assigningClient?.latestLostLeadId}
        onSuccess={() => {
          setClientListRefreshKey((k) => k + 1);
          if (assigningClient?.id && selectedClient?.id === assigningClient.id) {
            fetchClient(assigningClient.id).then((client) => {
              if (client) setSelectedClient(mapApiClientToClient(client));
            });
          }
        }}
      />

      <EmailComposeDialog
        open={isEmailDialogOpen}
        onOpenChange={(open) => {
          setIsEmailDialogOpen(open);
          if (!open) setEmailingClient(null);
        }}
        defaultClientId={emailingClient?.id}
        defaultContactId={emailingClient?.contacts.find(c => c.isPrimary)?.id}
        selectedAgencyId={selectedAgencyId}
        onSent={() => {
          setClientListRefreshKey((k) => k + 1);
        }}
      />

      {/* Call Interface */}
      {(callingClient || activeCall?.client) && (isCallInterfaceOpen && !isMinimized) && (
        <CallInterface
          client={callingClient || activeCall!.client}
          open={isCallInterfaceOpen && !isMinimized}
          onOpenChange={(open) => {
            if (!open) setCallingClient(null);
          }}
          onSummarySaved={(clientId) => {
            setClientListRefreshKey((k) => k + 1);
            if (selectedClient?.id === clientId) {
              fetchClient(clientId).then((client) => {
                if (client) setSelectedClient(mapApiClientToClient(client));
              });
            }
          }}
        />
      )}

      {/* Import Clients Dialog */}
      <ImportClientsDialog
        open={isImportDialogOpen}
        onOpenChange={setIsImportDialogOpen}
        onImport={handleAddToPending}
        onImportContacts={handleAddContactImports}
        clientFlowConfig={clientFlowConfig}
        destinationAgencies={destinationAgencies}
        storageContext={clientStorageContext}
        targetAgencyName={
          isAllAgenciesView
            ? undefined
            : accessibleAgencies.find((a) => a.id === effectiveAgencyIdForClient)?.name ?? resolvedAgencyName
        }
        targetSubCompanyId={needsDestinationConfig ? undefined : writeAgencyId}
      />

    </div>
  );
}
