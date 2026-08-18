import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Search, Phone, CalendarClock, CheckSquare, Plus, Clock, XCircle, Check, X, Lock, ArrowUpDown, ArrowUp, ArrowDown, Filter, Save, Eye, Trash2, Mail, PhoneCall, Calendar, Paperclip, Download, ChevronDown, ChevronUp, TrendingUp, ArrowRightLeft } from 'lucide-react';
import { useClientPagination, SectionPaginationBar, formatSafeDate } from '@/components/SectionPagination';
import { useStore } from '@/lib/store';
import { useAuthStore } from '@/lib/authStore';
import { format } from 'date-fns';
import { StageBadge } from '@/components/StageBadge';
import { TemperatureBadge } from '@/components/TemperatureBadge';
import { LeadRequestDetailsDialog } from '@/components/LeadRequestDetailsDialog';
import { ClientDetailsSheet } from '@/components/ClientDetailsSheet';
import { FollowUpDialog } from '@/components/FollowUpDialog';
import { CreateTaskDialog } from '@/components/CreateTaskDialog';
import { LeadRequest, FilterView, Lead, Client } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useOnNotification } from '@/hooks/useOnNotification';
import { onLeadRefresh, onReassignmentRefresh } from '@/lib/socket';
import { fetchLeads, fetchLeadRequests, fetchDocuments, downloadDocument, fetchDocumentBlob, ApiDocument, fetchAccessibleAgencies, fetchLeadExtensionRequests, submitLeadDeadlineDecision, getPendingLeadReassignmentRequests, getAllLeadReassignmentRequests, type ApiLeadExtensionRequest, type ApiLeadReassignmentRequest, type ApiLead } from '@/lib/api';
import { ApprovalQueueActions } from '@/components/ApprovalQueueActions';
import { ReassignLeadDialog } from '@/components/ReassignLeadDialog';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { getUserRoleTitle } from '@/lib/roleLabels';
import { ScopeFilterBar } from '@/components/ScopeFilterBar';
import { StickyHeader } from '@/components/StickyHeader';
import { CrmAttachmentList } from '@/components/CrmAttachmentList';
import { inferMimeFromFilename } from '@/lib/fileAttachmentUtils';
import { useScopeFilter } from '@/hooks/useElevatedScopeFilter';
import { useScopeQueryParams } from '@/hooks/useScopeQueryParams';
import { useEffectiveUser } from '@/lib/effectiveUser';
import { useWriteAgencyId } from '@/hooks/useWriteAgencyId';
import { DateRangeFilterRow } from '@/components/DateRangeFilterRow';
import { useDateRangeFilter } from '@/hooks/useDateRangeFilter';
import { leadMatchesDateRange } from '@/lib/dateRangeFilter';
import { ForwardedChip } from '@/components/offboarding/ForwardedChip';
import { PersonSectionHeader } from '@/components/PersonSectionHeader';
import {
  useCanActOnLeads,
  useCanViewTeamScope,
  useHasPermission,
  useIsOwnScope,
} from '@/lib/access';

/** Populate store clients from lead rows so ClientDetailsSheet can open (same as Pipeline). */
function mergeClientsFromLeadApiData(
  leads: Array<{ clientId: string; client: { name: string; industry?: string | null; location?: string | null } }>,
) {
  if (leads.length === 0) return;
  const clientsFromLeads: Client[] = Array.from(
    new Map(
      leads.map((l) => [
        l.clientId,
        {
          id: l.clientId,
          name: l.client.name,
          industry: l.client.industry ?? '',
          location: l.client.location ?? '',
          address: '',
          companySize: '',
          tags: [],
          contacts: [],
          status: 'active' as Client['status'],
          createdAt: new Date(),
          notes: [],
        },
      ]),
    ).values(),
  );
  const { clients, setClients } = useStore.getState();
  const existingIds = new Set(clients.map((c) => c.id));
  const missing = clientsFromLeads.filter((c) => !existingIds.has(c.id));
  if (missing.length > 0) setClients([...clients, ...missing]);
}

function mapApiLeadToLead(apiLead: { id: string; clientId: string; ownerId: string; subCompanyId: string; stage: string; status: string; temperature: string | null; lastActivity: string | null; nextFollowUp: string | null; notes: string | null; createdAt: string; updatedAt: string; closedAt?: string | null; leadDeadline?: string | null; extensionRequested?: boolean; extensionReason?: string | null; extensionDays?: number | null; extensionStatus?: 'pending' | 'approved' | 'rejected' | null; extensionRequestedAt?: string | null; extensionReviewedAt?: string | null; reviewedBy?: string | null; managerRemarks?: string | null; reassignmentLocked?: boolean; lockedAssociateId?: string | null; requiresDeadlineAction?: boolean; client: { name: string }; owner: { firstName: string; lastName: string }; forwardedFromName?: string | null; forwardedFromSubCompanyId?: string | null }, subCompanyName: string): Lead {
  return {
    id: apiLead.id,
    clientId: apiLead.clientId,
    clientName: apiLead.client?.name,
    ownerId: apiLead.ownerId,
    ownerName: `${apiLead.owner.firstName} ${apiLead.owner.lastName}`.trim(),
    subCompanyId: apiLead.subCompanyId,
    subCompanyName,
    stage: apiLead.stage,
    status: apiLead.status as Lead['status'],
    temperature: (apiLead.temperature as Lead['temperature']) ?? 'warm',
    lastActivity: apiLead.lastActivity ? new Date(apiLead.lastActivity) : undefined,
    nextFollowUp: apiLead.nextFollowUp ? new Date(apiLead.nextFollowUp) : undefined,
    createdAt: new Date(apiLead.createdAt),
    updatedAt: new Date(apiLead.updatedAt),
    closedAt: apiLead.closedAt ? new Date(apiLead.closedAt) : undefined,
    notes: apiLead.notes ?? undefined,
    leadDeadline: apiLead.leadDeadline ? new Date(apiLead.leadDeadline) : undefined,
    extensionRequested: apiLead.extensionRequested ?? undefined,
    extensionReason: apiLead.extensionReason ?? undefined,
    extensionDays: apiLead.extensionDays ?? undefined,
    extensionStatus: apiLead.extensionStatus ?? null,
    extensionRequestedAt: apiLead.extensionRequestedAt ? new Date(apiLead.extensionRequestedAt) : undefined,
    extensionReviewedAt: apiLead.extensionReviewedAt ? new Date(apiLead.extensionReviewedAt) : undefined,
    reviewedBy: apiLead.reviewedBy ?? undefined,
    managerRemarks: apiLead.managerRemarks ?? undefined,
    reassignmentLocked: apiLead.reassignmentLocked ?? false,
    lockedAssociateId: apiLead.lockedAssociateId ?? undefined,
    requiresDeadlineAction: apiLead.requiresDeadlineAction ?? false,
    forwardedFromName: apiLead.forwardedFromName ?? null,
    forwardedFromSubCompanyId: apiLead.forwardedFromSubCompanyId ?? null,
  };
}

/** Must match backend STAGES_EXEMPT_FROM_LEAD_DEADLINE_ENFORCEMENT — proposal path has its own timers. */
const LEAD_DEADLINE_EXEMPT_STAGES = new Set([
  'proposal_sent',
  'awaiting_client_approval',
  'closed_won',
  'closed_lost',
]);

const shouldOpenLeadDeadlineDecision = (lead: Lead) => {
  if (lead.status !== 'open' && lead.status !== 'active') return false;
  if (LEAD_DEADLINE_EXEMPT_STAGES.has(lead.stage)) return false;
  if (lead.requiresDeadlineAction) return true;
  if (!lead.leadDeadline) return false;
  if (lead.extensionStatus === 'pending') return false;
  return new Date(lead.leadDeadline).getTime() <= Date.now();
};

function mapApiLeadRequestToLeadRequest(api: { id: string; clientId: string; clientName: string; primaryContactName: string; requestedBy: string; requestedByName: string; managerId: string; managerName: string; note: string; requestedAt: string; status: string; reviewedBy?: string; reviewedByName?: string; reviewedAt?: string; subCompanyId: string; comments: Array<{ id: string; userId: string; userName: string; text: string; createdAt: string }> }): LeadRequest {
  return {
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
    comments: api.comments.map((c) => ({ ...c, createdAt: new Date(c.createdAt) })),
  };
}


// ─── Per-agency full leads section ───────────────────────────────────────
function AgencyLeadsSection({
  agency,
  onViewLeads,
  dateRange,
  ownerIds,
  scopeKey,
}: {
  agency: { id: string; name: string };
  onViewLeads: () => void;
  dateRange: { from: Date; to: Date } | null;
  ownerIds?: string[];
  scopeKey: string;
}) {
  const { tasks, clients, currentUser, pipelineStages } = useStore();
  const { id: effectiveUserId } = useEffectiveUser();
  const { toast } = useToast();
  const canCall = useHasPermission('voice:use');
  const canEmail = useCanActOnLeads();
  const canFollowUp = useHasPermission('clients:write');

  const [tab, setTab] = useState<'pending-review' | 'active' | 'rejected'>('pending-review');
  const [reviewingRequest, setReviewingRequest] = useState<string | null>(null);
  const [reviewComments, setReviewComments] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [stageFilters, setStageFilters] = useState<string[]>([]);
  const [temperatureFilters, setTemperatureFilters] = useState<string[]>([]);
  const [sortColumn, setSortColumn] = useState<'client' | 'temperature' | 'stage' | 'owner' | 'lastActivity' | 'nextFollowUp' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const writeAgencyId = useWriteAgencyId(selectedLead?.subCompanyId ?? agency.id);
  const [isLeadSheetOpen, setIsLeadSheetOpen] = useState(false);
  const [isFollowUpDialogOpen, setIsFollowUpDialogOpen] = useState(false);
  const [followUpRefreshKey, setFollowUpRefreshKey] = useState(0);
  const [isCreateTaskDialogOpen, setIsCreateTaskDialogOpen] = useState(false);
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [selectedLeadTasks, setSelectedLeadTasks] = useState<ReturnType<typeof useStore>['tasks']>([]);

  const { data: leadsData, isLoading: leadsLoading } = useQuery({
    queryKey: ['agency-leads-summary', agency.id, scopeKey],
    queryFn: () => fetchLeads({ agencyIds: [agency.id], ownerIds, limit: 500 }),
    staleTime: 0,
  });

  const { data: requestsData = [], isLoading: requestsLoading, refetch: refetchRequests } = useQuery({
    queryKey: ['agency-lead-requests-summary', agency.id, scopeKey],
    queryFn: () =>
      fetchLeadRequests({
        subCompanyId: agency.id,
        requestedByIds: ownerIds,
      }),
    staleTime: 2 * 60 * 1000,
  });

  const isLoading = leadsLoading || requestsLoading;
  const allLeads = useMemo(() => leadsData?.data ?? [], [leadsData]);

  useEffect(() => {
    mergeClientsFromLeadApiData(allLeads);
  }, [allLeads]);
  const sortedStages = useMemo(() => [...pipelineStages].sort((a, b) => a.order - b.order), [pipelineStages]);
  const stageRank = useMemo(() => sortedStages.reduce((acc, s, i) => { acc[s.id] = i; return acc; }, {} as Record<string, number>), [sortedStages]);
  const tempOrder: Record<string, number> = { hot: 3, warm: 2, cold: 1 };

  const pendingReqs  = useMemo(() => requestsData.filter(r => r.status === 'pending'), [requestsData]);
  const rejectedReqs = useMemo(() => requestsData.filter(r => r.status === 'rejected'), [requestsData]);

  const filteredActiveLeads = useMemo(() => allLeads.filter((l: any) => {
    const name = (l.client?.name ?? '').toLowerCase();
    const owner = `${l.owner?.firstName ?? ''} ${l.owner?.lastName ?? ''}`.trim().toLowerCase();
    if (searchTerm && !name.includes(searchTerm.toLowerCase()) && !owner.includes(searchTerm.toLowerCase())) return false;
    if (stageFilters.length > 0 && !stageFilters.includes(l.stage)) return false;
    if (temperatureFilters.length > 0 && !temperatureFilters.includes(l.temperature ?? 'warm')) return false;
    if (!leadMatchesDateRange({
      status: l.status,
      closedAt: l.closedAt ? new Date(l.closedAt) : undefined,
      createdAt: new Date(l.createdAt),
      updatedAt: new Date(l.updatedAt),
    }, dateRange)) return false;
    return true;
  }), [allLeads, searchTerm, stageFilters, temperatureFilters, dateRange]);

  const sortedLeads = useMemo(() => {
    if (!sortColumn) return filteredActiveLeads;
    return [...filteredActiveLeads].sort((a: any, b: any) => {
      let cmp = 0;
      switch (sortColumn) {
        case 'client':       cmp = (a.client?.name ?? '').localeCompare(b.client?.name ?? ''); break;
        case 'temperature':  cmp = (tempOrder[a.temperature ?? 'warm'] ?? 2) - (tempOrder[b.temperature ?? 'warm'] ?? 2); break;
        case 'stage':        cmp = (stageRank[a.stage] ?? 0) - (stageRank[b.stage] ?? 0); break;
        case 'owner':        cmp = (`${a.owner?.firstName ?? ''} ${a.owner?.lastName ?? ''}`).localeCompare(`${b.owner?.firstName ?? ''} ${b.owner?.lastName ?? ''}`); break;
        case 'lastActivity': cmp = (a.lastActivity ? new Date(a.lastActivity).getTime() : 0) - (b.lastActivity ? new Date(b.lastActivity).getTime() : 0); break;
        case 'nextFollowUp': cmp = (a.nextFollowUp ? new Date(a.nextFollowUp).getTime() : 0) - (b.nextFollowUp ? new Date(b.nextFollowUp).getTime() : 0); break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [filteredActiveLeads, sortColumn, sortDirection, stageRank]);

  const handleSort = (col: typeof sortColumn) => {
    if (sortColumn === col) setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortColumn(col); setSortDirection('asc'); }
  };
  const getSortIcon = (col: typeof sortColumn) => {
    if (sortColumn !== col) return <ArrowUpDown className="h-4 w-4 ml-1" />;
    return sortDirection === 'asc' ? <ArrowUp className="h-4 w-4 ml-1" /> : <ArrowDown className="h-4 w-4 ml-1" />;
  };

  const finishLeadRequestReview = () => {
    setReviewingRequest(null);
    setReviewComments('');
    void refetchRequests();
  };

  const handleLeadClick = (rawLead: ApiLead) => {
    mergeClientsFromLeadApiData([rawLead]);
    setSelectedLead(mapApiLeadToLead(rawLead, agency.name));
    setIsLeadSheetOpen(true);
  };

  const pendingPagination = useClientPagination(pendingReqs, [agency.id]);
  const activePagination = useClientPagination(sortedLeads, [
    agency.id,
    searchTerm,
    stageFilters.join(','),
    temperatureFilters.join(','),
    dateRange?.from?.getTime(),
    dateRange?.to?.getTime(),
    sortColumn,
    sortDirection,
  ]);
  const rejectedPagination = useClientPagination(rejectedReqs, [agency.id]);

  return (
    <>
      <Card className="border overflow-hidden">
        {/* Agency header */}
        <div className="flex items-center justify-between px-5 py-4 bg-muted/30 border-b">
          <h2 className="font-semibold text-base">{agency.name}</h2>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={onViewLeads}>
            View Agency <TrendingUp className="h-3 w-3" />
          </Button>
        </div>

        <CardContent className="pt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
            </div>
          ) : (
            <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
              <TabsList className="grid w-full max-w-md grid-cols-3">
                <TabsTrigger value="pending-review">Pending Review ({pendingReqs.length})</TabsTrigger>
                <TabsTrigger value="active">Active ({filteredActiveLeads.length})</TabsTrigger>
                <TabsTrigger value="rejected">Rejected ({rejectedReqs.length})</TabsTrigger>
              </TabsList>

              {/* Pending Review */}
              <TabsContent value="pending-review" className="mt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Requested By</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead>Requested At</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingPagination.pageRows.map(req => (
                      <TableRow key={req.id}>
                        <TableCell className="font-medium">{req.clientName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{req.primaryContactName}</TableCell>
                        <TableCell>{req.requestedByName}</TableCell>
                        <TableCell className="max-w-xs"><p className="text-sm truncate" title={req.note}>{req.note}</p></TableCell>
                        <TableCell className="text-sm">{formatSafeDate(req.requestedAt, 'MMM d, h:mm a')}</TableCell>
                        <TableCell className="text-right">
                          {reviewingRequest === req.id ? (
                            <div className="space-y-2 min-w-[280px] text-left">
                              <Textarea placeholder="Add note (required for rejection)" value={reviewComments} onChange={e => setReviewComments(e.target.value)} className="text-sm" rows={2} />
                              <ApprovalQueueActions
                                workflow="lead_request"
                                entityId={req.id}
                                subCompanyId={req.subCompanyId}
                                remarks={reviewComments}
                                requireRemarksForReject
                                forwardLabel="Forward lead"
                                compact
                                onActionComplete={finishLeadRequestReview}
                              />
                              <div className="flex justify-end">
                                <Button size="sm" variant="outline" onClick={() => { setReviewingRequest(null); setReviewComments(''); }}>Cancel</Button>
                              </div>
                            </div>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => setReviewingRequest(req.id)}>Review</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {pendingReqs.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">No pending lead requests</p>}
                {pendingPagination.showPagination && (
                  <SectionPaginationBar
                    total={pendingPagination.total}
                    startIndex={pendingPagination.startIndex}
                    pageLen={pendingPagination.pageRows.length}
                    totalPages={pendingPagination.totalPages}
                    page={pendingPagination.page}
                    onPageChange={pendingPagination.setPage}
                    pageSize={pendingPagination.pageSize}
                  />
                )}
              </TabsContent>

              {/* Active */}
              <TabsContent value="active" className="mt-4 space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search leads..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-9" />
                  </div>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full sm:w-36 justify-start">
                        <Filter className="h-4 w-4 mr-2" />Stage
                        {stageFilters.length > 0 && <Badge variant="secondary" className="ml-auto">{stageFilters.length}</Badge>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-52 p-3 bg-popover" align="start">
                      <h4 className="font-medium text-sm mb-2">Filter by Stage</h4>
                      {sortedStages.map(stage => (
                        <div key={stage.id} className="flex items-center space-x-2 mb-1.5">
                          <Checkbox id={`${agency.id}-stage-${stage.id}`} checked={stageFilters.includes(stage.id)} onCheckedChange={() => setStageFilters(f => f.includes(stage.id) ? f.filter(s => s !== stage.id) : [...f, stage.id])} />
                          <label htmlFor={`${agency.id}-stage-${stage.id}`} className="text-sm cursor-pointer">{stage.label}</label>
                        </div>
                      ))}
                    </PopoverContent>
                  </Popover>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full sm:w-40 justify-start">
                        <Filter className="h-4 w-4 mr-2" />Temperature
                        {temperatureFilters.length > 0 && <Badge variant="secondary" className="ml-auto">{temperatureFilters.length}</Badge>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-48 p-3 bg-popover" align="start">
                      <h4 className="font-medium text-sm mb-2">Filter by Temperature</h4>
                      {['hot', 'warm', 'cold'].map(temp => (
                        <div key={temp} className="flex items-center space-x-2 mb-1.5">
                          <Checkbox id={`${agency.id}-temp-${temp}`} checked={temperatureFilters.includes(temp)} onCheckedChange={() => setTemperatureFilters(f => f.includes(temp) ? f.filter(t => t !== temp) : [...f, temp])} />
                          <label htmlFor={`${agency.id}-temp-${temp}`} className="text-sm capitalize cursor-pointer">{temp}</label>
                        </div>
                      ))}
                    </PopoverContent>
                  </Popover>
                  {(searchTerm || stageFilters.length > 0 || temperatureFilters.length > 0) && (
                    <Button variant="ghost" size="sm" onClick={() => { setSearchTerm(''); setStageFilters([]); setTemperatureFilters([]); }}>Clear</Button>
                  )}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead><button onClick={() => handleSort('client')} className="flex items-center hover:text-foreground transition-colors">Client{getSortIcon('client')}</button></TableHead>
                      <TableHead><button onClick={() => handleSort('temperature')} className="flex items-center hover:text-foreground transition-colors">Temperature{getSortIcon('temperature')}</button></TableHead>
                      <TableHead><button onClick={() => handleSort('stage')} className="flex items-center hover:text-foreground transition-colors">Stage{getSortIcon('stage')}</button></TableHead>
                      <TableHead><button onClick={() => handleSort('owner')} className="flex items-center hover:text-foreground transition-colors">Owner{getSortIcon('owner')}</button></TableHead>
                      <TableHead>Tasks</TableHead>
                      <TableHead><button onClick={() => handleSort('lastActivity')} className="flex items-center hover:text-foreground transition-colors">Last Activity{getSortIcon('lastActivity')}</button></TableHead>
                      <TableHead><button onClick={() => handleSort('nextFollowUp')} className="flex items-center hover:text-foreground transition-colors">Next Follow-Up{getSortIcon('nextFollowUp')}</button></TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activePagination.pageRows.map((lead: any) => {
                      const isOwn = lead.ownerId === effectiveUserId;
                      const leadTasks = tasks.filter(t => t.linkType === 'lead' && t.linkId === lead.id);
                      const completedTasks = leadTasks.filter(t => t.status === 'done');
                      const ownerName = `${lead.owner?.firstName ?? ''} ${lead.owner?.lastName ?? ''}`.trim();
                      return (
                        <TableRow key={lead.id}>
                          <TableCell className="font-medium">
                            <button onClick={() => handleLeadClick(lead)} className="hover:underline text-left">{lead.client?.name ?? 'Unknown'}</button>
                          </TableCell>
                          <TableCell><TemperatureBadge temperature={(lead.temperature ?? 'warm') as 'hot' | 'warm' | 'cold'} /></TableCell>
                          <TableCell><StageBadge stage={lead.stage} /></TableCell>
                          <TableCell className="text-sm font-medium">{ownerName}</TableCell>
                          <TableCell>
                            {leadTasks.length > 0 ? (
                              <Badge variant="outline" className="gap-1 cursor-pointer hover:bg-accent hover:text-accent-foreground" onClick={() => { setSelectedLeadTasks(leadTasks); setIsTaskDialogOpen(true); }}>
                                <CheckSquare className="h-3 w-3" />{completedTasks.length}/{leadTasks.length}
                              </Badge>
                            ) : <span className="text-muted-foreground text-sm">-</span>}
                          </TableCell>
                          <TableCell className="text-sm">{formatSafeDate(lead.lastActivity, 'MMM d, yyyy', 'Never')}</TableCell>
                          <TableCell className="text-sm">{formatSafeDate(lead.nextFollowUp, 'MMM d, h:mm a')}</TableCell>
                          <TableCell className="text-right">
                            {isOwn && (canCall || canEmail || canFollowUp) && (
                              <div className="flex items-center justify-end gap-1">
                                {canCall && (
                                  <Button variant="ghost" size="sm" onClick={() => toast({ description: 'Call feature coming soon' })}><PhoneCall className="h-4 w-4" /></Button>
                                )}
                                {canEmail && (
                                  <Button variant="ghost" size="sm" onClick={() => toast({ description: 'Email feature coming soon' })}><Mail className="h-4 w-4" /></Button>
                                )}
                                {canFollowUp && (
                                  <Button variant="ghost" size="sm" onClick={() => { handleLeadClick(lead); setIsFollowUpDialogOpen(true); }}><Calendar className="h-4 w-4" /></Button>
                                )}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {sortedLeads.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">No active leads found</p>}
                {activePagination.showPagination && (
                  <SectionPaginationBar
                    total={activePagination.total}
                    startIndex={activePagination.startIndex}
                    pageLen={activePagination.pageRows.length}
                    totalPages={activePagination.totalPages}
                    page={activePagination.page}
                    onPageChange={activePagination.setPage}
                    pageSize={activePagination.pageSize}
                  />
                )}
              </TabsContent>

              {/* Rejected */}
              <TabsContent value="rejected" className="mt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Requested By</TableHead>
                      <TableHead>Requested At</TableHead>
                      <TableHead>Rejected At</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rejectedPagination.pageRows.map(req => (
                      <TableRow key={req.id}>
                        <TableCell className="font-medium">{req.clientName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{req.primaryContactName}</TableCell>
                        <TableCell>{req.requestedByName}</TableCell>
                        <TableCell className="text-sm">{formatSafeDate(req.requestedAt, 'MMM d, h:mm a')}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm text-destructive">
                            <XCircle className="h-4 w-4" />
                            {formatSafeDate(req.reviewedAt, 'MMM d, h:mm a', '')}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {rejectedReqs.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">No rejected requests</p>}
                {rejectedPagination.showPagination && (
                  <SectionPaginationBar
                    total={rejectedPagination.total}
                    startIndex={rejectedPagination.startIndex}
                    pageLen={rejectedPagination.pageRows.length}
                    totalPages={rejectedPagination.totalPages}
                    page={rejectedPagination.page}
                    onPageChange={rejectedPagination.setPage}
                    pageSize={rejectedPagination.pageSize}
                  />
                )}
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>

      <ClientDetailsSheet
        open={isLeadSheetOpen}
        onOpenChange={setIsLeadSheetOpen}
        client={selectedLead ? clients.find(c => c.id === selectedLead.clientId) || null : null}
        subCompanyId={writeAgencyId}
        followUpRefreshKey={followUpRefreshKey}
        showActions={true}
        onCallClick={() => toast({ description: 'Call feature coming soon' })}
        onEmailClick={() => toast({ description: 'Email feature coming soon' })}
        onAddTaskClick={() => setIsCreateTaskDialogOpen(true)}
        onAddFollowUpClick={() => setIsFollowUpDialogOpen(true)}
      />
      <FollowUpDialog
        open={isFollowUpDialogOpen}
        onOpenChange={setIsFollowUpDialogOpen}
        clientId={selectedLead?.clientId || ''}
        clientName={selectedLead?.clientName ?? clients.find(c => c.id === selectedLead?.clientId)?.name ?? ''}
        leadId={selectedLead?.id}
        subCompanyId={writeAgencyId}
        client={selectedLead ? clients.find(c => c.id === selectedLead.clientId) || undefined : undefined}
        onFollowUpCreated={() => setFollowUpRefreshKey((k) => k + 1)}
      />
      <CreateTaskDialog
        open={isCreateTaskDialogOpen}
        onOpenChange={setIsCreateTaskDialogOpen}
        subCompanyId={writeAgencyId}
      />
      <AlertDialog open={isTaskDialogOpen} onOpenChange={setIsTaskDialogOpen}>
        <AlertDialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Tasks ({selectedLeadTasks.length})</AlertDialogTitle>
          </AlertDialogHeader>
          <div className="space-y-4 mt-4">
            {selectedLeadTasks.map(task => (
              <Card key={task.id}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold">{task.title}</h4>
                        <Badge variant={task.status === 'done' ? 'default' : 'secondary'}>
                          {task.status === 'done' ? 'Done' : task.status === 'in_progress' ? 'In Progress' : 'To Do'}
                        </Badge>
                        <Badge variant={task.priority === 'urgent' ? 'destructive' : task.priority === 'high' ? 'default' : 'outline'}>{task.priority}</Badge>
                      </div>
                      {task.description && <p className="text-sm text-muted-foreground">{task.description}</p>}
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1"><Clock className="h-3 w-3" /><span>Assigned: {format(new Date(task.createdAt), 'MMM d, yyyy')}</span></div>
                        <div className="flex items-center gap-1"><CalendarClock className="h-3 w-3" /><span>Due: {format(new Date(task.dueDate), 'MMM d, yyyy')}</span></div>
                      </div>
                      {task.completedAt && <div className="text-sm text-muted-foreground">Completed: {format(new Date(task.completedAt), 'MMM d, yyyy')}</div>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="flex justify-end mt-4"><AlertDialogCancel>Close</AlertDialogCancel></div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Per-user leads section for All Team view ─────────────────────────────
function TeamLeadsSection({ user }: { user: { id: string; firstName: string; lastName: string } }) {
  const PAGE_SIZE = 10;
  const [tab, setTab] = useState<'pending-review' | 'active' | 'rejected'>('pending-review');
  const [page, setPage] = useState(1);

  const { data: leadsData, isLoading: leadsLoading } = useQuery({
    queryKey: ['user-leads-summary', user.id],
    queryFn: () => fetchLeads({ ownerIds: [user.id], limit: 500 }),
    staleTime: 0,
  });

  const { data: requestsData = [], isLoading: requestsLoading } = useQuery({
    queryKey: ['user-lead-requests-summary', user.id],
    queryFn: () => fetchLeadRequests({ requestedByIds: [user.id] }),
    staleTime: 2 * 60 * 1000,
  });

  const isLoading = leadsLoading || requestsLoading;
  const allLeads = useMemo(() => leadsData?.data ?? [], [leadsData]);
  const pendingReqs = useMemo(
    () => requestsData.filter((r: { status?: string }) => r.status === 'pending'),
    [requestsData],
  );
  const rejectedReqs = useMemo(
    () => requestsData.filter((r: { status?: string }) => r.status === 'rejected'),
    [requestsData],
  );

  useEffect(() => {
    setPage(1);
  }, [tab, user.id]);

  const paginate = <T,>(rows: T[]) => {
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const startIndex = (safePage - 1) * PAGE_SIZE;
    const pageRows = rows.slice(startIndex, startIndex + PAGE_SIZE);
    return { totalPages, safePage, startIndex, pageRows, total: rows.length };
  };

  const renderPagination = (total: number, startIndex: number, pageLen: number, totalPages: number, safePage: number) => {
    if (total <= PAGE_SIZE) return null;
    return (
      <div className="flex items-center justify-between pt-3 mt-2 border-t">
        <div className="text-sm text-muted-foreground">
          Showing {startIndex + 1} to {Math.min(startIndex + pageLen, total)} of {total}
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
    );
  };

  const pendingPage = paginate(pendingReqs);
  const activePage = paginate(allLeads);
  const rejectedPage = paginate(rejectedReqs);

  return (
    <Card className="border overflow-hidden">
      <CardContent className="pt-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
          </div>
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="grid w-full max-w-md grid-cols-3">
              <TabsTrigger value="pending-review">Pending Review ({pendingReqs.length})</TabsTrigger>
              <TabsTrigger value="active">Active ({allLeads.length})</TabsTrigger>
              <TabsTrigger value="rejected">Rejected ({rejectedReqs.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="pending-review" className="mt-4">
              {pendingReqs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No pending requests</p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Note</TableHead>
                        <TableHead>Requested At</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingPage.pageRows.map((req: any) => (
                        <TableRow key={req.id}>
                          <TableCell className="font-medium">
                            {req.clientName ?? req.client?.name ?? '—'}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {req.primaryContactName ?? '—'}
                          </TableCell>
                          <TableCell className="max-w-xs">
                            <p className="text-sm truncate" title={req.note}>
                              {req.note}
                            </p>
                          </TableCell>
                          <TableCell className="text-sm">
                            {formatSafeDate(req.requestedAt, 'MMM d, h:mm a')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {renderPagination(
                    pendingPage.total,
                    pendingPage.startIndex,
                    pendingPage.pageRows.length,
                    pendingPage.totalPages,
                    pendingPage.safePage,
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="active" className="mt-4">
              {allLeads.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No active leads</p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>Stage</TableHead>
                        <TableHead>Temperature</TableHead>
                        <TableHead>Last Activity</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activePage.pageRows.map((lead: any) => (
                        <TableRow key={lead.id}>
                          <TableCell className="font-medium">{lead.client?.name ?? '—'}</TableCell>
                          <TableCell>
                            <StageBadge stage={lead.stage} />
                          </TableCell>
                          <TableCell>
                            <TemperatureBadge temperature={lead.temperature ?? 'warm'} />
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatSafeDate(lead.lastActivity, 'MMM d')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {renderPagination(
                    activePage.total,
                    activePage.startIndex,
                    activePage.pageRows.length,
                    activePage.totalPages,
                    activePage.safePage,
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="rejected" className="mt-4">
              {rejectedReqs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No rejected requests</p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>Note</TableHead>
                        <TableHead>Requested At</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rejectedPage.pageRows.map((req: any) => (
                        <TableRow key={req.id}>
                          <TableCell className="font-medium">
                            {req.clientName ?? req.client?.name ?? '—'}
                          </TableCell>
                          <TableCell className="max-w-xs">
                            <p className="text-sm truncate" title={req.note}>
                              {req.note}
                            </p>
                          </TableCell>
                          <TableCell className="text-sm">
                            {formatSafeDate(req.requestedAt, 'MMM d, h:mm a')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {renderPagination(
                    rejectedPage.total,
                    rejectedPage.startIndex,
                    rejectedPage.pageRows.length,
                    rejectedPage.totalPages,
                    rejectedPage.safePage,
                  )}
                </>
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

export default function Leads() {
  const { leads, clients, currentUser, tasks, users, leadRequests, setLeads, setLeadRequests, currentSubCompany, pipelineStages } = useStore();
  const { id: effectiveUserId } = useEffectiveUser();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [leadsLoading, setLeadsLoading] = useState(true);
  const {
    period: datePeriod,
    customRange: dateCustomRange,
    effectiveRange: dateRange,
    setPeriod: setDatePeriod,
    setCustomRange: setDateCustomRange,
  } = useDateRangeFilter();

  const canViewTeam = useCanViewTeamScope();
  const isOwnScope = useIsOwnScope();
  const canReviewLeadRequests = useHasPermission('leads:assign');
  const canApproveLeads = useHasPermission('leads:approve');
  const canManagerRecommendLeads = useHasPermission('leads:manager_recommend');
  const canViewLeadExtensionQueue =
    canReviewLeadRequests || canApproveLeads || canManagerRecommendLeads;

  const scopeFilter = useScopeFilter();
  const {
    isElevated,
    showHierarchyFilters,
    isAgencyHierarchyViewer,
    isPureManager,
    agencies,
    agenciesLoading,
    selectedAgencyId,
    selectedLeaderId,
    selectedManagerId,
    selectedUserId,
    setSelectedAgencyId,
    setSelectedManagerId,
    setSelectedUserId,
    onlyMe,
    getAssociatesForManager,
    getUsersForLeader,
    teamUsers: managerTeamUsers,
    filterRowProps,
    leaderParamInUrl,
    managerParamInUrl,
    userParamInUrl,
    scopeKey,
    showAllTeamView,
    showAgencySections,
    showManagerSections,
  } = scopeFilter;

  const { ownerIds: elevatedOwnerIds } = useScopeQueryParams(scopeFilter);
  const linkedUserIdParam = searchParams.get('linkedUserId') ?? '';

  const canSeeAllPendingLeadRequests = isElevated;

  const loadCounterRef = useRef(0);

  const loadData = useCallback(async () => {
    if (!currentSubCompany?.id) return;
    if (showAgencySections || showAllTeamView) { setLeadsLoading(false); return; }
    const counter = ++loadCounterRef.current;
    setLeadsLoading(true);
    try {
      // useScopeQueryParams already expands linked anchors + act-as hierarchy drill
      const ownerIds = elevatedOwnerIds;
      const linkedIds = linkedUserIdParam ? linkedUserIdParam.split(',').filter(Boolean) : null;
      if (ownerIds !== undefined && ownerIds.length === 0) {
        if (counter === loadCounterRef.current) { setLeads([]); setLeadRequests([]); setLeadsLoading(false); }
        return;
      }
      // Linked accounts: cross-agency by requestedByIds.
      // Elevated: agency + optional owner scope (requestedByIds) so team/manager chips filter pending.
      const leadRequestsParams = !isElevated && linkedIds
        ? { requestedByIds: ownerIds ?? linkedIds }
        : {
            subCompanyId: isElevated
              ? (selectedAgencyId !== 'all' && selectedAgencyId !== 'me' ? selectedAgencyId : undefined)
              : currentSubCompany.id,
            ...(ownerIds?.length ? { requestedByIds: ownerIds } : {}),
          };
      const [leadsRes, requests] = await Promise.all([
        fetchLeads({
          limit: 500,
          agencyIds: isElevated && selectedAgencyId !== 'all' && selectedAgencyId !== 'me' ? [selectedAgencyId] : undefined,
          ownerIds,
        }),
        fetchLeadRequests(leadRequestsParams),
      ]);
      if (counter !== loadCounterRef.current) return;
      const subName = currentSubCompany.name;
      mergeClientsFromLeadApiData(leadsRes.data);
      setLeads(leadsRes.data.map((a) => mapApiLeadToLead(a, subName)));
      const mappedRequests = requests.map(mapApiLeadRequestToLeadRequest);
      let filteredRequests = mappedRequests;
      if (isPureManager && currentUser?.id) {
        filteredRequests = mappedRequests.filter(r => r.managerId === effectiveUserId);
      } else if (selectedLeaderId !== 'all') {
        const leaderUserIds = new Set(getUsersForLeader(selectedLeaderId).map((u) => u.id));
        filteredRequests = mappedRequests.filter(
          (r) => leaderUserIds.has(r.managerId) || leaderUserIds.has(r.requestedBy),
        );
      } else if (selectedManagerId !== 'all') {
        filteredRequests = mappedRequests.filter(r => r.managerId === selectedManagerId);
      } else if (selectedUserId !== 'all' && selectedUserId !== 'me') {
        filteredRequests = mappedRequests.filter(r => r.requestedBy === selectedUserId);
      }
      setLeadRequests(filteredRequests);
    } catch (e) {
      if (counter !== loadCounterRef.current) return;
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed to load leads', variant: 'destructive' });
    } finally {
      if (counter === loadCounterRef.current) setLeadsLoading(false);
    }
  }, [currentSubCompany?.id, currentSubCompany?.name, isElevated, isPureManager, selectedAgencyId, selectedLeaderId, selectedManagerId, selectedUserId, getUsersForLeader, setLeads, setLeadRequests, toast, currentUser?.id, elevatedOwnerIds, linkedUserIdParam]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useOnNotification(loadData);

  useEffect(() => onLeadRefresh(loadData), [loadData]);

  // Sync selectedRequest when leadRequests store updates (e.g. after socket refresh from comment)
  useEffect(() => {
    if (!selectedRequest) return;
    const updated = leadRequests.find((r) => r.id === selectedRequest.id);
    if (updated) setSelectedRequest(updated);
  }, [leadRequests]);

  // Auto-open review panel when navigated from toast/bell with ?review=<requestId>
  useEffect(() => {
    const reviewId = searchParams.get('review');
    if (!reviewId || !leadRequests.some((r) => r.id === reviewId)) return;
    setActiveTab('pending-review');
    setReviewingRequest(reviewId);
    setSearchParams((prev) => { prev.delete('review'); return prev; }, { replace: true });
  }, [searchParams, leadRequests, setSearchParams]);

  // Auto-switch tab when navigated from notification with ?tab=<name>
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (!tab) return;
    setActiveTab(tab);
    setSearchParams((prev) => { prev.delete('tab'); return prev; }, { replace: true });
  }, [searchParams, setSearchParams]);

  const permissions = useAuthStore((s) => s.permissions);
  const canReassignLead = permissions.includes('leads:reassign') || permissions.includes('leads:reassign_approve');
  const canCall = useHasPermission('voice:use');
  const canEmail = useCanActOnLeads();
  const canFollowUp = useHasPermission('clients:write');
  const isManager = isPureManager;
  const canSeeAllLeads = canReviewLeadRequests && canViewTeam;

  // Get stage labels from pipelineStages
  const stageLabels = pipelineStages.reduce((acc, stage) => {
    acc[stage.id] = stage.label;
    return acc;
  }, {} as Record<string, string>);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [stageFilters, setStageFilters] = useState<string[]>([]);
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [temperatureFilters, setTemperatureFilters] = useState<string[]>([]);
  const [selectedLeadTasks, setSelectedLeadTasks] = useState<typeof tasks>([]);
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<LeadRequest | null>(null);
  const [isRequestDetailsOpen, setIsRequestDetailsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(isOwnScope ? 'active' : 'pending-review');
  const [reviewingRequest, setReviewingRequest] = useState<string | null>(null);
  const [reviewComments, setReviewComments] = useState('');
  const [reviewAttachments, setReviewAttachments] = useState<ApiDocument[]>([]);
  const [reviewAttachmentsLoading, setReviewAttachmentsLoading] = useState(false);
  const [leadExtensionPending, setLeadExtensionPending] = useState<ApiLeadExtensionRequest[]>([]);
  const [leadExtensionHistory, setLeadExtensionHistory] = useState<ApiLeadExtensionRequest[]>([]);
  const [leadExtensionTab, setLeadExtensionTab] = useState<'pending' | 'history'>('pending');
  const [loadingLeadExtensions, setLoadingLeadExtensions] = useState(false);
  const [selectedLead, setSelectedLead] = useState<typeof leads[0] | null>(null);
  const writeAgencyId = useWriteAgencyId(selectedLead?.subCompanyId);
  const [isLeadSheetOpen, setIsLeadSheetOpen] = useState(false);
  const [isFollowUpDialogOpen, setIsFollowUpDialogOpen] = useState(false);
  const [followUpRefreshKey, setFollowUpRefreshKey] = useState(0);
  const [isCreateTaskDialogOpen, setIsCreateTaskDialogOpen] = useState(false);
  const [expiredLeadForDecision, setExpiredLeadForDecision] = useState<Lead | null>(null);
  const [deadlineDecisionReason, setDeadlineDecisionReason] = useState('');
  const [deadlineRequestExtension, setDeadlineRequestExtension] = useState(false);
  const [deadlineRequestedDays, setDeadlineRequestedDays] = useState(1);
  const [submittingDeadlineDecision, setSubmittingDeadlineDecision] = useState(false);
  const [sortColumn, setSortColumn] = useState<'client' | 'temperature' | 'stage' | 'owner' | 'lastActivity' | 'nextFollowUp' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [reassignLead, setReassignLead] = useState<Lead | null>(null);
  const [isReassignDialogOpen, setIsReassignDialogOpen] = useState(false);
  const [pendingReassignmentsCount, setPendingReassignmentsCount] = useState(0);
  const [reassignmentRequests, setReassignmentRequests] = useState<ApiLeadReassignmentRequest[]>([]);
  const [loadingReassignments, setLoadingReassignments] = useState(false);
  const [reassignmentView, setReassignmentView] = useState<'pending' | 'history'>('pending');
  const [reassignmentHistory, setReassignmentHistory] = useState<ApiLeadReassignmentRequest[]>([]);
  const [loadingReassignmentHistory, setLoadingReassignmentHistory] = useState(false);

  // Views state
  const [savedViews, setSavedViews] = useState<FilterView[]>(() => {
    const stored = localStorage.getItem('leadViews');
    return stored ? JSON.parse(stored) : [];
  });
  const [currentViewId, setCurrentViewId] = useState<string | null>(null);
  const [isNewViewDialogOpen, setIsNewViewDialogOpen] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  
  const toggleTemperatureFilter = (temp: string) => {
    setTemperatureFilters(prev => 
      prev.includes(temp) ? prev.filter(t => t !== temp) : [...prev, temp]
    );
  };

  const toggleStageFilter = (stage: string) => {
    setStageFilters(prev => 
      prev.includes(stage) ? prev.filter(s => s !== stage) : [...prev, stage]
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
      type: 'leads',
      filters: {
        stageFilters,
        ownerFilter: canSeeAllLeads ? ownerFilter : undefined,
        temperatureFilters,
      },
      createdAt: new Date(),
    };

    const updatedViews = [...savedViews, newView];
    setSavedViews(updatedViews);
    localStorage.setItem('leadViews', JSON.stringify(updatedViews));
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

    setStageFilters(view.filters.stageFilters || []);
    if (canSeeAllLeads && view.filters.ownerFilter) {
      setOwnerFilter(view.filters.ownerFilter);
    }
    setTemperatureFilters(view.filters.temperatureFilters || []);
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
    localStorage.setItem('leadViews', JSON.stringify(updatedViews));
    
    if (currentViewId === viewId) {
      setCurrentViewId(null);
    }
    
    toast({
      title: "View deleted",
      description: `View "${view?.name}" has been deleted`,
    });
  };

  const clearAllFilters = () => {
    setSearchTerm('');
    setStageFilters([]);
    if (canSeeAllLeads) {
      setOwnerFilter('all');
    }
    setTemperatureFilters([]);
    setCurrentViewId(null);
  };
  
  const filteredLeads = leads.filter(lead => {
    const client = clients.find(c => c.id === lead.clientId);
    
    if (isOwnScope && client?.restrictedUsers?.includes(effectiveUserId)) {
      return false;
    }
    
    const matchesSearch = client?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.ownerName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStage = stageFilters.length === 0 || stageFilters.includes(lead.stage);
    const matchesTemperature = temperatureFilters.length === 0 || temperatureFilters.includes(lead.temperature);
    const matchesDate = leadMatchesDateRange(lead, dateRange);
    
    if (isOwnScope) {
      const hasLinkedFilter = !!linkedUserIdParam && linkedUserIdParam.split(',').some(id => id !== currentUser?.id);
      if (hasLinkedFilter) return matchesSearch && matchesStage && matchesTemperature && matchesDate;
      return matchesSearch && matchesStage && matchesTemperature && matchesDate && lead.ownerId === effectiveUserId;
    }

    // Manager user-tab filter takes priority over the owner dropdown
    if (isManager && selectedUserId !== 'all' && selectedUserId !== 'me') {
      return matchesSearch && matchesStage && matchesTemperature && matchesDate && lead.ownerId === selectedUserId;
    }
    if (onlyMe && selectedLeaderId !== 'all') {
      const leaderUserIds = new Set(getUsersForLeader(selectedLeaderId).map((u) => u.id));
      return matchesSearch && matchesStage && matchesTemperature && matchesDate && leaderUserIds.has(lead.ownerId);
    }
    // Toggle deselected but a specific manager chip is active → filter by that manager only
    if (onlyMe && selectedManagerId !== 'all') {
      return matchesSearch && matchesStage && matchesTemperature && matchesDate && lead.ownerId === selectedManagerId;
    }
    // Toggle deselected, All Managers active, drilled into specific agency → all leads in that agency
    if (onlyMe && isElevated && selectedAgencyId !== 'all' && selectedAgencyId !== 'me') {
      return matchesSearch && matchesStage && matchesTemperature && matchesDate;
    }
    // Toggle deselected, no specific chip → only own leads
    if (onlyMe) {
      return matchesSearch && matchesStage && matchesTemperature && matchesDate && lead.ownerId === effectiveUserId;
    }

    // Marketing managers and above can see all leads and filter by owner
    const matchesOwner = ownerFilter === 'all' ||
      (ownerFilter === 'me' && lead.ownerId === effectiveUserId) ||
      (ownerFilter !== 'all' && ownerFilter !== 'me' && lead.ownerId === ownerFilter);
    return matchesSearch && matchesStage && matchesTemperature && matchesDate && matchesOwner;
  });
  
  const getClientName = (lead: Lead) => {
    return lead.clientName ?? clients.find(c => c.id === lead.clientId)?.name ?? 'Unknown';
  };
  
  const isOwnLead = (lead: typeof leads[0]) => {
    return lead.ownerId === effectiveUserId;
  };

  // Get lead requests for sales associates — use linked user IDs when a user filter is active
  const requestedByIds = useMemo(() => {
    if (linkedUserIdParam) return new Set(linkedUserIdParam.split(',').filter(Boolean));
    return new Set([currentUser.id]);
  }, [linkedUserIdParam, currentUser.id]);

  const requestedLeads = leadRequests.filter(
    req => requestedByIds.has(req.requestedBy) && req.status === 'pending'
  );

  const rejectedLeads = leadRequests.filter(
    req => requestedByIds.has(req.requestedBy) && req.status === 'rejected'
  );

  // Managers+: pending/rejected review lists (agency-wide vs current agency from scope).
  const pendingReviewLeads = canSeeAllLeads
    ? leadRequests.filter(
        (req) =>
          req.status === 'pending' &&
          (canSeeAllPendingLeadRequests ? true : req.subCompanyId === currentSubCompany?.id) &&
          ((isElevated || isManager) && selectedUserId !== 'all' && selectedUserId !== 'me' ? req.requestedBy === selectedUserId : true)
      )
    : [];

  const rejectedReviewLeads = canSeeAllLeads
    ? leadRequests.filter(
        (req) =>
          req.status === 'rejected' &&
          (canSeeAllPendingLeadRequests ? true : req.subCompanyId === currentSubCompany?.id) &&
          ((isElevated || isManager) && selectedUserId !== 'all' && selectedUserId !== 'me' ? req.requestedBy === selectedUserId : true)
      )
    : [];
  const resolvedLeadExtensionHistory = useMemo(
    () =>
      leadExtensionHistory.filter(
        (req) => req.status === 'approved' || req.status === 'rejected' || req.status === 'returned'
      ),
    [leadExtensionHistory]
  );
  const selectedAssociateFilterId = (isElevated || isManager) && selectedUserId !== 'all' && selectedUserId !== 'me' ? selectedUserId : null;
  const visibleLeadIds = useMemo(() => new Set(leads.map((lead) => lead.id)), [leads]);
  const filteredLeadExtensionPending = useMemo(
    () => leadExtensionPending.filter((req) => {
      if (!visibleLeadIds.has(req.leadId)) return false;
      if (!selectedAssociateFilterId) return true;
      return req.requestedById === selectedAssociateFilterId || req.requestedBy?.id === selectedAssociateFilterId;
    }),
    [leadExtensionPending, visibleLeadIds, selectedAssociateFilterId]
  );
  const filteredResolvedLeadExtensionHistory = useMemo(
    () => resolvedLeadExtensionHistory.filter((req) => {
      if (!visibleLeadIds.has(req.leadId)) return false;
      if (!selectedAssociateFilterId) return true;
      return req.requestedById === selectedAssociateFilterId || req.requestedBy?.id === selectedAssociateFilterId;
    }),
    [resolvedLeadExtensionHistory, visibleLeadIds, selectedAssociateFilterId]
  );

  useEffect(() => {
    if (!canViewLeadExtensionQueue) return;
    setLoadingLeadExtensions(true);
    Promise.all([
      fetchLeadExtensionRequests('pending'),
      fetchLeadExtensionRequests(),
    ])
      .then(([pending, all]) => {
        setLeadExtensionPending(pending);
        setLeadExtensionHistory(all);
      })
      .catch(() => {
        setLeadExtensionPending([]);
        setLeadExtensionHistory([]);
      })
      .finally(() => setLoadingLeadExtensions(false));
  }, [canViewLeadExtensionQueue, leads.length]);

  useEffect(() => {
    if (!isOwnScope) return;
    const expired = filteredLeads.find((lead) => shouldOpenLeadDeadlineDecision(lead));
    setExpiredLeadForDecision(expired ?? null);
  }, [isOwnScope, filteredLeads]);

  const isSuperUser = permissions.includes('leads:reassign_approve');

  const loadReassignmentRequests = useCallback(async () => {
    if (!isSuperUser) return;
    setLoadingReassignments(true);
    try {
      const list = await getPendingLeadReassignmentRequests();
      setReassignmentRequests(list);
      setPendingReassignmentsCount(list.length);
    } catch {
      // ignore
    } finally {
      setLoadingReassignments(false);
    }
  }, [isSuperUser]);

  // When a specific agency tab is selected, narrow the displayed reassignments
  // to just that agency. "All Agencies" shows the full cross-agency list.
  const visibleReassignmentRequests = useMemo(
    () => (selectedAgencyId === 'all' || selectedAgencyId === 'me')
      ? reassignmentRequests
      : reassignmentRequests.filter((r) => r.subCompanyId === selectedAgencyId),
    [reassignmentRequests, selectedAgencyId],
  );
  const visibleReassignmentHistory = useMemo(
    () => (selectedAgencyId === 'all' || selectedAgencyId === 'me')
      ? reassignmentHistory
      : reassignmentHistory.filter((r) => r.subCompanyId === selectedAgencyId),
    [reassignmentHistory, selectedAgencyId],
  );
  const visiblePendingReassignmentsCount = visibleReassignmentRequests.length;

  const loadReassignmentHistory = useCallback(async () => {
    if (!isSuperUser) return;
    setLoadingReassignmentHistory(true);
    try {
      const list = await getAllLeadReassignmentRequests();
      // Show only non-pending in history (pending lives in the queue above)
      setReassignmentHistory(list.filter((r) => r.status !== 'pending'));
    } catch {
      // ignore
    } finally {
      setLoadingReassignmentHistory(false);
    }
  }, [isSuperUser]);

  useEffect(() => {
    loadReassignmentRequests();
  }, [loadReassignmentRequests, leads.length]);

  useEffect(() => {
    if (reassignmentView === 'history') loadReassignmentHistory();
  }, [reassignmentView, loadReassignmentHistory]);

  // Real-time refresh: when any reassignment event happens on the server, refetch.
  useEffect(() => {
    if (!isSuperUser) return;
    const unsubscribe = onReassignmentRefresh(() => {
      loadReassignmentRequests();
      if (reassignmentView === 'history') loadReassignmentHistory();
      loadData();
    });
    return unsubscribe;
  }, [isSuperUser, loadReassignmentRequests, loadReassignmentHistory, loadData, reassignmentView]);

  const finishReassignmentReview = () => {
    void Promise.all([loadReassignmentRequests(), loadData()]);
  };

  const handleViewRequest = (request: LeadRequest) => {
    setSelectedRequest(request);
    setIsRequestDetailsOpen(true);
  };

  useEffect(() => {
    if (!reviewingRequest) { setReviewAttachments([]); return; }
    const req = pendingReviewLeads.find(r => r.id === reviewingRequest);
    if (!req) return;
    setReviewAttachmentsLoading(true);
    fetchDocuments({ clientId: req.clientId })
      .then(docs => setReviewAttachments(docs.filter(d => d.type === 'lead_request_attachment')))
      .catch(() => setReviewAttachments([]))
      .finally(() => setReviewAttachmentsLoading(false));
  }, [reviewingRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  const finishLeadRequestReview = () => {
    setReviewingRequest(null);
    setReviewComments('');
    loadData();
  };

  const handleSubmitDeadlineDecision = async () => {
    if (!expiredLeadForDecision) return;
    if (!deadlineDecisionReason.trim()) {
      toast({ title: 'Reason required', description: 'Please provide a reason before submitting.', variant: 'destructive' });
      return;
    }
    if (deadlineRequestExtension && (!Number.isInteger(deadlineRequestedDays) || deadlineRequestedDays < 1)) {
      toast({ title: 'Invalid days', description: 'Additional days must be at least 1.', variant: 'destructive' });
      return;
    }
    setSubmittingDeadlineDecision(true);
    try {
      const result = await submitLeadDeadlineDecision({
        leadId: expiredLeadForDecision.id,
        requestExtension: deadlineRequestExtension,
        reason: deadlineDecisionReason.trim(),
        requestedDays: deadlineRequestExtension ? deadlineRequestedDays : undefined,
      });
      toast({
        title: deadlineRequestExtension
          ? result.autoApproved
            ? 'Extension approved'
            : 'Extension requested'
          : 'Lead returned',
        description: deadlineRequestExtension
          ? result.autoApproved
            ? 'Your extension was applied immediately per agency approval settings.'
            : 'Your request was sent to the next approver in the role chain.'
          : 'The lead was closed after deadline with no extension request. Your manager was not notified.',
      });
      setExpiredLeadForDecision(null);
      setDeadlineDecisionReason('');
      setDeadlineRequestExtension(false);
      setDeadlineRequestedDays(1);
      loadData();
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed to submit decision', variant: 'destructive' });
    } finally {
      setSubmittingDeadlineDecision(false);
    }
  };

  const refreshLeadExtensions = useCallback(async () => {
    const [pending, all] = await Promise.all([
      fetchLeadExtensionRequests('pending'),
      fetchLeadExtensionRequests(),
    ]);
    setLeadExtensionPending(pending);
    setLeadExtensionHistory(all);
  }, []);

  const finishLeadExtensionReview = () => {
    void Promise.all([refreshLeadExtensions(), loadData()]);
  };

  const handleLeadClick = (lead: typeof leads[0]) => {
    mergeClientsFromLeadApiData([
      {
        clientId: lead.clientId,
        client: { name: lead.clientName ?? 'Unknown', industry: null, location: null },
      },
    ]);
    setSelectedLead(lead);
    setIsLeadSheetOpen(true);
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

  const temperatureOrder = { hot: 3, warm: 2, cold: 1 };
  const stageOrder = { 
    contact_made: 1, 
    qualified: 2, 
    proposal: 3, 
    negotiation: 4, 
    closed_won: 5, 
    closed_lost: 6 
  };

  const sortedLeads = [...filteredLeads].sort((a, b) => {
    if (!sortColumn) return 0;

    let comparison = 0;
    
    switch (sortColumn) {
      case 'client':
        comparison = getClientName(a).localeCompare(getClientName(b));
        break;
      case 'temperature':
        comparison = temperatureOrder[a.temperature] - temperatureOrder[b.temperature];
        break;
      case 'stage':
        comparison = stageOrder[a.stage] - stageOrder[b.stage];
        break;
      case 'owner':
        comparison = a.ownerName.localeCompare(b.ownerName);
        break;
      case 'lastActivity': {
        const dateA = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
        const dateB = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
        comparison = dateA - dateB;
        break;
      }
      case 'nextFollowUp': {
        const followUpA = a.nextFollowUp ? new Date(a.nextFollowUp).getTime() : 0;
        const followUpB = b.nextFollowUp ? new Date(b.nextFollowUp).getTime() : 0;
        comparison = followUpA - followUpB;
        break;
      }
    }

    return sortDirection === 'asc' ? comparison : -comparison;
  });
  
  if (leadsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="pt-6">
        <h1 className="text-3xl font-bold text-foreground">Leads</h1>
      </div>

      {/* ── Agency / Manager / User Tab Bars ─────────────────────────────────── */}
      <StickyHeader zIndex={40}>
        <ScopeFilterBar show={showHierarchyFilters} filterRowProps={filterRowProps} />

        <DateRangeFilterRow
          period={datePeriod}
          customRange={dateCustomRange}
          onPeriodChange={setDatePeriod}
          onCustomRangeChange={setDateCustomRange}
        />
      </StickyHeader>

      {/* ── All-Agencies Sectioned View ──────────────────────────────────────── */}
      {showAgencySections && (
        agenciesLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-3 text-muted-foreground">Loading agencies...</span>
          </div>
        ) : (
          <div className="space-y-6">
            {agencies.map(agency => (
              <AgencyLeadsSection
                key={agency.id}
                agency={agency}
                onViewLeads={() => setSelectedAgencyId(agency.id)}
                dateRange={dateRange}
                ownerIds={elevatedOwnerIds}
                scopeKey={`${scopeKey}|${elevatedOwnerIds?.join(',') ?? ''}`}
              />
            ))}
          </div>
        )
      )}

      {/* ── Per-user Sectioned View (All Managers / All Team) ───────────────── */}
      {showAllTeamView && (
        managerTeamUsers.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-12">
            {showManagerSections ? 'No managers / team in this agency' : 'No team members in this scope'}
          </p>
        ) : (
          <div className="space-y-6">
            {managerTeamUsers.map((user) => (
              <div key={user.id}>
                <PersonSectionHeader
                  user={user}
                  roleTitle={getUserRoleTitle(user)}
                  onView={() =>
                    showManagerSections ? setSelectedManagerId(user.id) : setSelectedUserId(user.id)
                  }
                />
                <TeamLeadsSection user={user} />
              </div>
            ))}
          </div>
        )
      )}

      {isOwnScope ? (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <StickyHeader>
            <TabsList className="grid w-full max-w-md grid-cols-3">
              <TabsTrigger value="active">
                Active ({filteredLeads.length})
              </TabsTrigger>
              <TabsTrigger value="requested">
                Requested ({requestedLeads.length})
              </TabsTrigger>
              <TabsTrigger value="rejected">
                Rejected ({rejectedLeads.length})
              </TabsTrigger>
            </TabsList>
          </StickyHeader>

          {/* Active Leads Tab */}
          <TabsContent value="active" className="mt-6">
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2 flex-wrap">
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
                        <SelectItem value="default">All Leads (Default)</SelectItem>
                        {savedViews.map(view => (
                          <SelectItem key={view.id} value={view.id}>
                            {view.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {(searchTerm || stageFilters.length > 0 || temperatureFilters.length > 0) && (
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
                            <Label htmlFor="view-name-leads">View Name</Label>
                            <Input
                              id="view-name-leads"
                              placeholder="e.g., Hot Leads in Proposal"
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

                    {(stageFilters.length > 0 || temperatureFilters.length > 0) && (
                      <Button variant="ghost" size="sm" onClick={clearAllFilters}>
                        Clear All Filters
                      </Button>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search leads..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full sm:w-48 justify-start">
                        <Filter className="h-4 w-4 mr-2" />
                        Stage
                        {stageFilters.length > 0 && (
                          <Badge variant="secondary" className="ml-auto">
                            {stageFilters.length}
                          </Badge>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-3 bg-popover" align="start">
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm mb-2">Filter by Stage</h4>
                        {pipelineStages.map((stage) => (
                          <div key={stage.id} className="flex items-center space-x-2">
                            <Checkbox
                              id={`stage-sa-${stage.id}`}
                              checked={stageFilters.includes(stage.id)}
                              onCheckedChange={() => toggleStageFilter(stage.id)}
                            />
                            <label
                              htmlFor={`stage-sa-${stage.id}`}
                              className="text-sm cursor-pointer flex-1"
                            >
                              {stage.label}
                            </label>
                          </div>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full sm:w-48 justify-start">
                        <Filter className="h-4 w-4 mr-2" />
                        Temperature
                        {temperatureFilters.length > 0 && (
                          <Badge variant="secondary" className="ml-auto">
                            {temperatureFilters.length}
                          </Badge>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-3 bg-popover" align="start">
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm mb-2">Filter by Temperature</h4>
                        {['hot', 'warm', 'cold'].map((temp) => (
                          <div key={temp} className="flex items-center space-x-2">
                            <Checkbox
                              id={`temp-lead-${temp}`}
                              checked={temperatureFilters.includes(temp)}
                              onCheckedChange={() => toggleTemperatureFilter(temp)}
                            />
                            <label
                              htmlFor={`temp-lead-${temp}`}
                              className="text-sm capitalize cursor-pointer flex-1"
                            >
                              {temp}
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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <button 
                          onClick={() => handleSort('client')}
                          className="flex items-center hover:text-foreground transition-colors"
                        >
                          Client
                          {getSortIcon('client')}
                        </button>
                      </TableHead>
                      <TableHead>
                        <button 
                          onClick={() => handleSort('temperature')}
                          className="flex items-center hover:text-foreground transition-colors"
                        >
                          Temperature
                          {getSortIcon('temperature')}
                        </button>
                      </TableHead>
                      <TableHead>
                        <button 
                          onClick={() => handleSort('stage')}
                          className="flex items-center hover:text-foreground transition-colors"
                        >
                          Stage
                          {getSortIcon('stage')}
                        </button>
                      </TableHead>
                      <TableHead>
                        <button 
                          onClick={() => handleSort('owner')}
                          className="flex items-center hover:text-foreground transition-colors"
                        >
                          Owner
                          {getSortIcon('owner')}
                        </button>
                      </TableHead>
                      <TableHead>Tasks</TableHead>
                      <TableHead>
                        <button 
                          onClick={() => handleSort('lastActivity')}
                          className="flex items-center hover:text-foreground transition-colors"
                        >
                          Last Activity
                          {getSortIcon('lastActivity')}
                        </button>
                      </TableHead>
                      <TableHead>
                        <button 
                          onClick={() => handleSort('nextFollowUp')}
                          className="flex items-center hover:text-foreground transition-colors"
                        >
                          Next Follow-Up
                          {getSortIcon('nextFollowUp')}
                        </button>
                      </TableHead>
                      <TableHead>Deadline</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedLeads.map(lead => {
                      const isOwn = isOwnLead(lead);
                      const leadTasks = tasks.filter(t => t.linkType === 'lead' && t.linkId === lead.id);
                      const completedTasks = leadTasks.filter(t => t.status === 'done');
                      const totalTasks = leadTasks.length;
                      
                      return (
                        <TableRow key={lead.id} className={!isOwn ? 'opacity-60' : ''}>
                          <TableCell className="font-medium">
                            <div className="flex flex-col gap-1">
                              <button
                                onClick={() => handleLeadClick(lead)}
                                className="flex items-center gap-2 hover:underline text-left"
                              >
                                {!isOwn && <Lock className="h-4 w-4 text-muted-foreground" />}
                                {getClientName(lead)}
                              </button>
                              {lead.forwardedFromName && (selectedAgencyId === 'all' || selectedAgencyId === 'me' || selectedAgencyId === lead.forwardedFromSubCompanyId) && <ForwardedChip name={lead.forwardedFromName} />}
                            </div>
                          </TableCell>
                          <TableCell>
                            <TemperatureBadge temperature={lead.temperature} />
                          </TableCell>
                          <TableCell>
                            <StageBadge stage={lead.stage} />
                          </TableCell>
                          <TableCell>
                            <div>
                              <div className="font-medium text-sm">{lead.ownerName}</div>
                              <div className="text-xs text-muted-foreground">{lead.subCompanyName}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {totalTasks > 0 ? (
                              <Badge 
                                variant="outline" 
                                className="gap-1 cursor-pointer hover:bg-accent hover:text-accent-foreground"
                                onClick={() => {
                                  setSelectedLeadTasks(leadTasks);
                                  setIsTaskDialogOpen(true);
                                }}
                              >
                                <CheckSquare className="h-3 w-3" />
                                {completedTasks.length}/{totalTasks}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {lead.lastActivity ? (
                              format(new Date(lead.lastActivity), 'MMM d, yyyy')
                            ) : (
                              <span className="text-muted-foreground">Never</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {lead.nextFollowUp ? (
                              <span className="text-sm">
                                {format(new Date(lead.nextFollowUp), 'MMM d, h:mm a')}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {lead.leadDeadline ? (
                              lead.extensionStatus === 'pending' ? (
                                <Badge variant="secondary">Extension pending</Badge>
                              ) : lead.extensionStatus === 'approved' && lead.leadDeadline ? (
                                <span className="text-sm text-muted-foreground">{format(new Date(lead.leadDeadline), 'MMM d, yyyy')}</span>
                              ) : shouldOpenLeadDeadlineDecision(lead) ? (
                                <Badge variant="destructive">Expired</Badge>
                              ) : (
                                <span className="text-sm text-muted-foreground">{format(new Date(lead.leadDeadline), 'MMM d, yyyy')}</span>
                              )
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {isOwn && (canCall || canEmail || canFollowUp) && (
                                <>
                                  {canCall && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toast({ description: "Call feature coming soon" });
                                    }}
                                  >
                                    <PhoneCall className="h-4 w-4" />
                                  </Button>
                                  )}
                                  {canEmail && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toast({ description: "Email feature coming soon" });
                                    }}
                                  >
                                    <Mail className="h-4 w-4" />
                                  </Button>
                                  )}
                                  {canFollowUp && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      mergeClientsFromLeadApiData([
                                        {
                                          clientId: lead.clientId,
                                          client: { name: getClientName(lead), industry: null, location: null },
                                        },
                                      ]);
                                      setSelectedLead(lead);
                                      setIsFollowUpDialogOpen(true);
                                    }}
                                  >
                                    <Calendar className="h-4 w-4" />
                                  </Button>
                                  )}
                                </>
                              )}
                              {canReassignLead && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="Reassign lead"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setReassignLead(lead);
                                    setIsReassignDialogOpen(true);
                                  }}
                                >
                                  <ArrowRightLeft className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                {sortedLeads.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    No active leads found
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Requested Leads Tab */}
          <TabsContent value="requested" className="mt-6">
            <Card>
              <CardHeader>
                <h3 className="text-lg font-semibold">Requested Leads</h3>
                <p className="text-sm text-muted-foreground">
                  Leads you've requested and are awaiting approval
                </p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client Name</TableHead>
                      <TableHead>Primary Contact</TableHead>
                      <TableHead>Manager</TableHead>
                      <TableHead>Requested At</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requestedLeads.map(request => (
                      <TableRow key={request.id}>
                        <TableCell className="font-medium">
                          {request.clientName}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {request.primaryContactName}
                        </TableCell>
                        <TableCell>{request.managerName}</TableCell>
                        <TableCell>
                          {format(new Date(request.requestedAt), 'MMM d, h:mm a')}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">Pending</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleViewRequest(request)}
                          >
                            View Details
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {requestedLeads.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    No pending lead requests
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Rejected Leads Tab */}
          <TabsContent value="rejected" className="mt-6">
            <Card>
              <CardHeader>
                <h3 className="text-lg font-semibold">Rejected Lead Requests</h3>
                <p className="text-sm text-muted-foreground">
                  Lead requests that were not approved
                </p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client Name</TableHead>
                      <TableHead>Primary Contact</TableHead>
                      <TableHead>Manager</TableHead>
                      <TableHead>Requested At</TableHead>
                      <TableHead>Rejected At</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rejectedLeads.map(request => (
                      <TableRow key={request.id}>
                        <TableCell className="font-medium">
                          {request.clientName}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {request.primaryContactName}
                        </TableCell>
                        <TableCell>{request.managerName}</TableCell>
                        <TableCell>
                          {format(new Date(request.requestedAt), 'MMM d, h:mm a')}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm text-destructive">
                            <XCircle className="h-4 w-4" />
                            {request.reviewedAt && format(new Date(request.reviewedAt), 'MMM d, h:mm a')}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleViewRequest(request)}
                          >
                            View Details
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {rejectedLeads.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    No rejected lead requests
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      ) : !showAgencySections && !showAllTeamView && (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <StickyHeader>
            <TabsList className={`grid w-full ${isSuperUser ? 'max-w-3xl grid-cols-5' : 'max-w-2xl grid-cols-4'}`}>
              <TabsTrigger value="pending-review">
                Pending Review ({pendingReviewLeads.length})
              </TabsTrigger>
              <TabsTrigger value="active">
                Active ({filteredLeads.length})
              </TabsTrigger>
              <TabsTrigger value="rejected">
                Rejected ({rejectedReviewLeads.length})
              </TabsTrigger>
              <TabsTrigger value="lead-extensions">
                Lead Extensions ({filteredLeadExtensionPending.length + filteredResolvedLeadExtensionHistory.length})
              </TabsTrigger>
              {isSuperUser && (
                <TabsTrigger value="reassignments" className="relative">
                  Reassignments
                  {visiblePendingReassignmentsCount > 0 && (
                    <span className="ml-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-xs font-bold">
                      {visiblePendingReassignmentsCount}
                    </span>
                  )}
                </TabsTrigger>
              )}
            </TabsList>
          </StickyHeader>

          {/* Pending Review Tab */}
          <TabsContent value="pending-review" className="mt-6">
            <Card>
              <CardHeader>
                <h3 className="text-lg font-semibold">Pending Lead Requests</h3>
                <p className="text-sm text-muted-foreground">
                  Review and approve or reject lead requests from your team
                </p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Requested By</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead>Requested At</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingReviewLeads.map(request => (
                      <TableRow key={request.id}>
                        <TableCell className="font-medium">
                          {request.clientName}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {request.primaryContactName}
                        </TableCell>
                        <TableCell>{request.requestedByName}</TableCell>
                        <TableCell className="max-w-xs">
                          <p className="text-sm truncate" title={request.note}>
                            {request.note}
                          </p>
                        </TableCell>
                        <TableCell>
                          {format(new Date(request.requestedAt), 'MMM d, h:mm a')}
                        </TableCell>
                        <TableCell className="text-right">
                          {reviewingRequest === request.id ? (
                            <div className="space-y-2 min-w-[300px]">
                              <div className="text-left mb-2">
                                <p className="text-sm font-medium mb-1">Original Request:</p>
                                <p className="text-sm text-muted-foreground mb-3">{request.note}</p>
                              </div>
                              {/* Attachments */}
                              <div className="text-left mb-3">
                                <div className="flex items-center gap-1.5 mb-2">
                                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                                  <p className="text-sm font-medium">
                                    Attachments
                                    {reviewAttachments.length > 0 && (
                                      <span className="ml-1.5 text-xs text-muted-foreground font-normal">({reviewAttachments.length})</span>
                                    )}
                                  </p>
                                </div>
                                {reviewAttachmentsLoading ? (
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    Loading...
                                  </div>
                                ) : reviewAttachments.length === 0 ? (
                                  <p className="text-xs text-muted-foreground italic">No attachments</p>
                                ) : (
                                  <CrmAttachmentList
                                    items={reviewAttachments.map((doc) => ({
                                      id: doc.id,
                                      name: doc.name,
                                      mimeType: inferMimeFromFilename(doc.name),
                                      size: null,
                                    }))}
                                    fetchBlob={(item) => fetchDocumentBlob(item.id)}
                                    onDownload={(item) => downloadDocument(item.id, item.name)}
                                  />
                                )}
                              </div>
                              <Textarea
                                placeholder="Add approval/rejection note (required for rejection)"
                                value={reviewComments}
                                onChange={(e) => setReviewComments(e.target.value)}
                                className="mb-2"
                              />
                              <ApprovalQueueActions
                                workflow="lead_request"
                                entityId={request.id}
                                subCompanyId={request.subCompanyId}
                                remarks={reviewComments}
                                requireRemarksForReject
                                forwardLabel="Forward lead"
                                onActionComplete={finishLeadRequestReview}
                              />
                              <div className="flex justify-end">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setReviewingRequest(null);
                                    setReviewComments('');
                                  }}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setReviewingRequest(request.id)}
                            >
                              Review
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {pendingReviewLeads.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    No pending lead requests
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Active Leads Tab */}
          <TabsContent value="active" className="mt-6">
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2 flex-wrap">
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
                        <SelectItem value="default">All Leads (Default)</SelectItem>
                        {savedViews.map(view => (
                          <SelectItem key={view.id} value={view.id}>
                            {view.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {(searchTerm || stageFilters.length > 0 || ownerFilter !== 'all' || temperatureFilters.length > 0) && (
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
                            <Label htmlFor="view-name-leads-mgr">View Name</Label>
                            <Input
                              id="view-name-leads-mgr"
                              placeholder="e.g., Hot Leads in Proposal"
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

                    {(stageFilters.length > 0 || ownerFilter !== 'all' || temperatureFilters.length > 0) && (
                      <Button variant="ghost" size="sm" onClick={clearAllFilters}>
                        Clear All Filters
                      </Button>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search leads..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full sm:w-48 justify-start">
                        <Filter className="h-4 w-4 mr-2" />
                        Stage
                        {stageFilters.length > 0 && (
                          <Badge variant="secondary" className="ml-auto">
                            {stageFilters.length}
                          </Badge>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-3 bg-popover" align="start">
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm mb-2">Filter by Stage</h4>
                        {pipelineStages.map((stage) => (
                          <div key={stage.id} className="flex items-center space-x-2">
                            <Checkbox
                              id={`stage-mgr-${stage.id}`}
                              checked={stageFilters.includes(stage.id)}
                              onCheckedChange={() => toggleStageFilter(stage.id)}
                            />
                            <label
                              htmlFor={`stage-mgr-${stage.id}`}
                              className="text-sm cursor-pointer flex-1"
                            >
                              {stage.label}
                            </label>
                          </div>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full sm:w-48 justify-start">
                        <Filter className="h-4 w-4 mr-2" />
                        Temperature
                        {temperatureFilters.length > 0 && (
                          <Badge variant="secondary" className="ml-auto">
                            {temperatureFilters.length}
                          </Badge>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-3 bg-popover" align="start">
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm mb-2">Filter by Temperature</h4>
                        {['hot', 'warm', 'cold'].map((temp) => (
                          <div key={temp} className="flex items-center space-x-2">
                            <Checkbox
                              id={`temp-mgr-lead-${temp}`}
                              checked={temperatureFilters.includes(temp)}
                              onCheckedChange={() => toggleTemperatureFilter(temp)}
                            />
                            <label
                              htmlFor={`temp-mgr-lead-${temp}`}
                              className="text-sm capitalize cursor-pointer flex-1"
                            >
                              {temp}
                            </label>
                          </div>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                    <SelectTrigger className="w-full sm:w-48">
                      <SelectValue placeholder="Owner" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Owners</SelectItem>
                      <SelectItem value="me">My Leads</SelectItem>
                      {users.map(user => (
                        user.id !== currentUser.id && (
                          <SelectItem key={user.id} value={user.id}>
                            {user.name}
                          </SelectItem>
                        )
                      ))}
                    </SelectContent>
                  </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <button 
                          onClick={() => handleSort('client')}
                          className="flex items-center hover:text-foreground transition-colors"
                        >
                          Client
                          {getSortIcon('client')}
                        </button>
                      </TableHead>
                      <TableHead>
                        <button 
                          onClick={() => handleSort('temperature')}
                          className="flex items-center hover:text-foreground transition-colors"
                        >
                          Temperature
                          {getSortIcon('temperature')}
                        </button>
                      </TableHead>
                      <TableHead>
                        <button 
                          onClick={() => handleSort('stage')}
                          className="flex items-center hover:text-foreground transition-colors"
                        >
                          Stage
                          {getSortIcon('stage')}
                        </button>
                      </TableHead>
                      <TableHead>
                        <button 
                          onClick={() => handleSort('owner')}
                          className="flex items-center hover:text-foreground transition-colors"
                        >
                          Owner
                          {getSortIcon('owner')}
                        </button>
                      </TableHead>
                      <TableHead>Tasks</TableHead>
                      <TableHead>
                        <button 
                          onClick={() => handleSort('lastActivity')}
                          className="flex items-center hover:text-foreground transition-colors"
                        >
                          Last Activity
                          {getSortIcon('lastActivity')}
                        </button>
                      </TableHead>
                      <TableHead>
                        <button 
                          onClick={() => handleSort('nextFollowUp')}
                          className="flex items-center hover:text-foreground transition-colors"
                        >
                          Next Follow-Up
                          {getSortIcon('nextFollowUp')}
                        </button>
                      </TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedLeads.map(lead => {
                      const isOwn = isOwnLead(lead);
                      const leadTasks = tasks.filter(t => t.linkType === 'lead' && t.linkId === lead.id);
                      const completedTasks = leadTasks.filter(t => t.status === 'done');
                      const totalTasks = leadTasks.length;
                      
                      return (
                        <TableRow key={lead.id}>
                          <TableCell className="font-medium">
                            <div className="flex flex-col gap-1">
                              <button
                                onClick={() => handleLeadClick(lead)}
                                className="hover:underline text-left"
                              >
                                {getClientName(lead)}
                              </button>
                              {lead.forwardedFromName && (selectedAgencyId === 'all' || selectedAgencyId === 'me' || selectedAgencyId === lead.forwardedFromSubCompanyId) && <ForwardedChip name={lead.forwardedFromName} />}
                            </div>
                          </TableCell>
                          <TableCell>
                            <TemperatureBadge temperature={lead.temperature} />
                          </TableCell>
                          <TableCell>
                            <StageBadge stage={lead.stage} />
                          </TableCell>
                          <TableCell>
                            <div>
                              <div className="font-medium text-sm">{lead.ownerName}</div>
                              <div className="text-xs text-muted-foreground">{lead.subCompanyName}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {totalTasks > 0 ? (
                              <Badge 
                                variant="outline" 
                                className="gap-1 cursor-pointer hover:bg-accent hover:text-accent-foreground"
                                onClick={() => {
                                  setSelectedLeadTasks(leadTasks);
                                  setIsTaskDialogOpen(true);
                                }}
                              >
                                <CheckSquare className="h-3 w-3" />
                                {completedTasks.length}/{totalTasks}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {lead.lastActivity ? (
                              format(new Date(lead.lastActivity), 'MMM d, yyyy')
                            ) : (
                              <span className="text-muted-foreground">Never</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {lead.nextFollowUp ? (
                              <span className="text-sm">
                                {format(new Date(lead.nextFollowUp), 'MMM d, h:mm a')}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              {isOwn && (canCall || canEmail || canFollowUp) && (
                                <>
                                  {canCall && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toast({ description: "Call feature coming soon" });
                                    }}
                                  >
                                    <PhoneCall className="h-4 w-4" />
                                  </Button>
                                  )}
                                  {canEmail && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toast({ description: "Email feature coming soon" });
                                    }}
                                  >
                                    <Mail className="h-4 w-4" />
                                  </Button>
                                  )}
                                  {canFollowUp && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      mergeClientsFromLeadApiData([
                                        {
                                          clientId: lead.clientId,
                                          client: { name: getClientName(lead), industry: null, location: null },
                                        },
                                      ]);
                                      setSelectedLead(lead);
                                      setIsFollowUpDialogOpen(true);
                                    }}
                                  >
                                    <Calendar className="h-4 w-4" />
                                  </Button>
                                  )}
                                </>
                              )}
                              {canReassignLead && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="Reassign lead"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setReassignLead(lead);
                                    setIsReassignDialogOpen(true);
                                  }}
                                >
                                  <ArrowRightLeft className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                {sortedLeads.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    No leads found matching your criteria
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Rejected Leads Tab */}
          <TabsContent value="rejected" className="mt-6">
            <Card>
              <CardHeader>
                <h3 className="text-lg font-semibold">Rejected Lead Requests</h3>
                <p className="text-sm text-muted-foreground">
                  Lead requests that were not approved
                </p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client Name</TableHead>
                      <TableHead>Primary Contact</TableHead>
                      <TableHead>Requested By</TableHead>
                      <TableHead>Requested At</TableHead>
                      <TableHead>Rejected At</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rejectedReviewLeads.map(request => (
                      <TableRow key={request.id}>
                        <TableCell className="font-medium">
                          {request.clientName}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {request.primaryContactName}
                        </TableCell>
                        <TableCell>{request.requestedByName}</TableCell>
                        <TableCell>
                          {format(new Date(request.requestedAt), 'MMM d, h:mm a')}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm text-destructive">
                            <XCircle className="h-4 w-4" />
                            {request.reviewedAt && format(new Date(request.reviewedAt), 'MMM d, h:mm a')}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleViewRequest(request)}
                          >
                            View Details
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {rejectedReviewLeads.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    No rejected lead requests
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Lead Extension Requests Tab */}
          <TabsContent value="lead-extensions" className="mt-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Lead Extension Requests</h3>
                  <Badge variant="secondary">{filteredLeadExtensionPending.length} pending</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {loadingLeadExtensions ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : (
                  <Tabs value={leadExtensionTab} onValueChange={(value) => setLeadExtensionTab(value as 'pending' | 'history')}>
                    <TabsList className="grid w-full max-w-sm grid-cols-2">
                      <TabsTrigger value="pending">Pending ({filteredLeadExtensionPending.length})</TabsTrigger>
                      <TabsTrigger value="history">History ({filteredResolvedLeadExtensionHistory.length})</TabsTrigger>
                    </TabsList>

                    <TabsContent value="pending" className="mt-4 space-y-2">
                      {filteredLeadExtensionPending.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No pending extension requests.</p>
                      ) : (
                        filteredLeadExtensionPending.map((req) => (
                          <div key={req.id} className="rounded border p-3 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium truncate">{req.lead?.client?.name ?? 'Lead'}</p>
                              <p className="text-xs text-muted-foreground truncate">{req.reason} ({req.requestedDays} days)</p>
                            </div>
                            <div className="shrink-0 min-w-[200px]">
                              <ApprovalQueueActions
                                workflow="lead_extension"
                                entityId={req.id}
                                subCompanyId={writeAgencyId ?? currentSubCompany?.id}
                                compact
                                onActionComplete={finishLeadExtensionReview}
                              />
                            </div>
                          </div>
                        ))
                      )}
                    </TabsContent>

                    <TabsContent value="history" className="mt-4">
                      {filteredResolvedLeadExtensionHistory.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No extension decisions yet (approved, rejected, or returned without extension).
                        </p>
                      ) : (
                        <div className="h-[calc(100vh-320px)] min-h-[420px] overflow-y-auto rounded border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Associate</TableHead>
                                <TableHead>Lead</TableHead>
                                <TableHead>Days</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Requested</TableHead>
                                <TableHead>Reviewed</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {filteredResolvedLeadExtensionHistory.map((req) => (
                                <TableRow key={req.id}>
                                  <TableCell>{`${req.requestedBy?.firstName ?? ''} ${req.requestedBy?.lastName ?? ''}`.trim() || req.requestedBy?.email || '—'}</TableCell>
                                  <TableCell>
                                    <div className="space-y-0.5">
                                      <div>{req.lead?.client?.name ?? '—'}</div>
                                      <div className="text-xs text-muted-foreground truncate max-w-[220px]">{req.reason}</div>
                                      {req.managerRemarks && <div className="text-xs text-muted-foreground truncate max-w-[220px]">Remarks: {req.managerRemarks}</div>}
                                    </div>
                                  </TableCell>
                                  <TableCell>{req.status === 'returned' ? '—' : req.requestedDays}</TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={
                                        req.status === 'approved'
                                          ? 'default'
                                          : req.status === 'returned'
                                            ? 'secondary'
                                            : 'destructive'
                                      }
                                    >
                                      {req.status === 'returned' ? 'Returned (no extension)' : req.status}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>{format(new Date(req.requestedAt), 'MMM d, yyyy')}</TableCell>
                                  <TableCell>{req.reviewedAt ? format(new Date(req.reviewedAt), 'MMM d, yyyy') : '—'}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Reassignment Requests Tab — super users only */}
          {isSuperUser && (
            <TabsContent value="reassignments" className="mt-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <ArrowRightLeft className="h-5 w-5" />
                        Lead Reassignment Requests
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        Review pending requests or browse the full history.
                      </p>
                    </div>
                    {visiblePendingReassignmentsCount > 0 && reassignmentView === 'pending' && (
                      <Badge variant="destructive">{visiblePendingReassignmentsCount} pending</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <Button
                      variant={reassignmentView === 'pending' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setReassignmentView('pending')}
                    >
                      Pending {visiblePendingReassignmentsCount > 0 && `(${visiblePendingReassignmentsCount})`}
                    </Button>
                    <Button
                      variant={reassignmentView === 'history' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setReassignmentView('history')}
                    >
                      History
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {reassignmentView === 'history' ? (
                    loadingReassignmentHistory ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : visibleReassignmentHistory.length === 0 ? (
                      <p className="text-center text-sm text-muted-foreground py-12">
                        No reassignment history yet
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {visibleReassignmentHistory.map((req) => {
                          const clientName = req.lead?.client?.name ?? 'Unknown';
                          const requesterName = req.requestedBy
                            ? `${req.requestedBy.firstName} ${req.requestedBy.lastName}`.trim()
                            : 'Unknown';
                          const currentOwnerName = req.currentOwner
                            ? `${req.currentOwner.firstName} ${req.currentOwner.lastName}`.trim()
                            : 'Unknown';
                          const proposedOwnerName = req.proposedOwner
                            ? `${req.proposedOwner.firstName} ${req.proposedOwner.lastName}`.trim()
                            : 'Unknown';
                          const reviewerName = req.reviewedBy
                            ? `${req.reviewedBy.firstName} ${req.reviewedBy.lastName}`.trim()
                            : null;
                          const statusVariant: 'default' | 'destructive' | 'secondary' =
                            req.status === 'completed' ? 'default'
                              : req.status === 'rejected' ? 'destructive'
                              : 'secondary';
                          return (
                            <div key={req.id} className="rounded-lg border p-3 space-y-1.5">
                              <div className="flex items-start justify-between gap-3 flex-wrap">
                                <div className="space-y-1 min-w-0 flex-1">
                                  <div className="font-semibold">{clientName}</div>
                                  <div className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
                                    <span>{currentOwnerName}</span>
                                    <ArrowRightLeft className="h-3 w-3" />
                                    <span className="text-foreground font-medium">{proposedOwnerName}</span>
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    Requested by <span className="font-medium">{requesterName}</span>
                                    {req.requestedBy?.role && (
                                      <span className="ml-1">({getUserRoleTitle(req.requestedBy)})</span>
                                    )}
                                    {' · '}
                                    {format(new Date(req.requestedAt), 'MMM d, h:mm a')}
                                  </div>
                                  {reviewerName && req.reviewedAt && (
                                    <div className="text-xs text-muted-foreground">
                                      {req.status === 'rejected' ? 'Rejected' : req.status === 'completed' ? 'Approved' : 'Reviewed'} by{' '}
                                      <span className="font-medium">{reviewerName}</span> · {format(new Date(req.reviewedAt), 'MMM d, h:mm a')}
                                    </div>
                                  )}
                                  {req.subCompany && (
                                    <Badge variant="outline" className="text-xs mt-1">{req.subCompany.name}</Badge>
                                  )}
                                </div>
                                <Badge variant={statusVariant} className="capitalize">
                                  {req.status}
                                </Badge>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )
                  ) : loadingReassignments ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : visibleReassignmentRequests.length === 0 ? (
                    <p className="text-center text-sm text-muted-foreground py-12">
                      No pending reassignment requests
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {visibleReassignmentRequests.map((req) => {
                        const clientName = req.lead?.client?.name ?? 'Unknown';
                        const requesterName = req.requestedBy
                          ? `${req.requestedBy.firstName} ${req.requestedBy.lastName}`.trim()
                          : 'Unknown';
                        const currentOwnerName = req.currentOwner
                          ? `${req.currentOwner.firstName} ${req.currentOwner.lastName}`.trim()
                          : 'Unknown';
                        const proposedOwnerName = req.proposedOwner
                          ? `${req.proposedOwner.firstName} ${req.proposedOwner.lastName}`.trim()
                          : 'Unknown';

                        return (
                          <div key={req.id} className="rounded-lg border p-4 space-y-3">
                            <div className="flex items-start justify-between gap-3 flex-wrap">
                              <div className="space-y-1 min-w-0 flex-1">
                                <div className="font-semibold">{clientName}</div>
                                <div className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
                                  <span>{currentOwnerName}</span>
                                  <ArrowRightLeft className="h-3 w-3" />
                                  <span className="text-foreground font-medium">{proposedOwnerName}</span>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  Requested by <span className="font-medium">{requesterName}</span>
                                  {req.requestedBy?.role && (
                                    <span className="ml-1">({getUserRoleTitle(req.requestedBy)})</span>
                                  )}
                                  {' · '}
                                  {format(new Date(req.requestedAt), 'MMM d, h:mm a')}
                                </div>
                                {req.subCompany && (
                                  <Badge variant="outline" className="text-xs mt-1">{req.subCompany.name}</Badge>
                                )}
                              </div>
                              <div className="min-w-[200px]">
                                <ApprovalQueueActions
                                  workflow="lead_reassignment"
                                  entityId={req.id}
                                  subCompanyId={req.subCompanyId}
                                  compact
                                  onActionComplete={finishReassignmentReview}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      )}

      <LeadRequestDetailsDialog
        open={isRequestDetailsOpen}
        onOpenChange={setIsRequestDetailsOpen}
        request={selectedRequest}
      />

      <ReassignLeadDialog
        open={isReassignDialogOpen}
        onOpenChange={setIsReassignDialogOpen}
        lead={reassignLead}
        onSuccess={() => {
          setReassignLead(null);
          loadData();
          if (isSuperUser) {
            loadReassignmentRequests();
          }
        }}
      />


      <ClientDetailsSheet
        open={isLeadSheetOpen}
        onOpenChange={setIsLeadSheetOpen}
        client={selectedLead ? clients.find(c => c.id === selectedLead.clientId) || null : null}
        subCompanyId={writeAgencyId}
        followUpRefreshKey={followUpRefreshKey}
        showActions={true}
        onCallClick={() => {
          toast({
            title: "Call feature",
            description: "Call functionality coming soon",
          });
        }}
        onEmailClick={() => {
          toast({
            title: "Email feature",
            description: "Email functionality coming soon",
          });
        }}
        onAddTaskClick={() => setIsCreateTaskDialogOpen(true)}
        onAddFollowUpClick={() => {
          setIsFollowUpDialogOpen(true);
        }}
      />

      <FollowUpDialog
        open={isFollowUpDialogOpen}
        onOpenChange={setIsFollowUpDialogOpen}
        clientId={selectedLead?.clientId || ''}
        clientName={selectedLead?.clientName ?? clients.find(c => c.id === selectedLead?.clientId)?.name ?? ''}
        leadId={selectedLead?.id}
        subCompanyId={writeAgencyId}
        client={selectedLead ? clients.find(c => c.id === selectedLead.clientId) || undefined : undefined}
        onFollowUpCreated={() => setFollowUpRefreshKey((k) => k + 1)}
      />

      <CreateTaskDialog
        open={isCreateTaskDialogOpen}
        onOpenChange={setIsCreateTaskDialogOpen}
        subCompanyId={writeAgencyId}
      />

      <AlertDialog open={isTaskDialogOpen} onOpenChange={setIsTaskDialogOpen}>
        <AlertDialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Tasks ({selectedLeadTasks.length})</AlertDialogTitle>
          </AlertDialogHeader>
          <div className="space-y-4 mt-4">
            {selectedLeadTasks.map(task => (
              <Card key={task.id}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold">{task.title}</h4>
                        <Badge variant={task.status === 'done' ? 'default' : 'secondary'}>
                          {task.status === 'done' ? 'Done' : task.status === 'in_progress' ? 'In Progress' : 'To Do'}
                        </Badge>
                        <Badge variant={
                          task.priority === 'urgent' ? 'destructive' : 
                          task.priority === 'high' ? 'default' : 
                          'outline'
                        }>
                          {task.priority}
                        </Badge>
                      </div>
                      {task.description && (
                        <p className="text-sm text-muted-foreground">{task.description}</p>
                      )}
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          <span>Assigned: {format(new Date(task.createdAt), 'MMM d, yyyy')}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <CalendarClock className="h-3 w-3" />
                          <span>Due: {format(new Date(task.dueDate), 'MMM d, yyyy')}</span>
                        </div>
                      </div>
                      {task.completedAt && (
                        <div className="text-sm text-muted-foreground">
                          Completed: {format(new Date(task.completedAt), 'MMM d, yyyy')}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="flex justify-end mt-4">
            <AlertDialogCancel>Close</AlertDialogCancel>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!expiredLeadForDecision} onOpenChange={() => {}}>
        <DialogContent
          className="max-w-lg [&>button]:hidden"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Lead Deadline Reached</DialogTitle>
            <DialogDescription>
              Deadline expired for <span className="font-medium">{expiredLeadForDecision ? getClientName(expiredLeadForDecision) : 'this lead'}</span>.
              Provide details and choose whether to request an extension.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Reason</Label>
              <Textarea
                value={deadlineDecisionReason}
                onChange={(e) => setDeadlineDecisionReason(e.target.value)}
                placeholder="Why is the lead not closed won yet?"
                rows={3}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={deadlineRequestExtension} onCheckedChange={(v) => setDeadlineRequestExtension(!!v)} />
              Request extension
            </label>
            {deadlineRequestExtension && (
              <div className="space-y-1">
                <Label>Additional days</Label>
                <Input
                  type="number"
                  min={1}
                  value={deadlineRequestedDays}
                  onChange={(e) => setDeadlineRequestedDays(Math.max(1, parseInt(e.target.value || '1', 10)))}
                  className="w-32"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={handleSubmitDeadlineDecision} disabled={submittingDeadlineDecision}>
              {submittingDeadlineDecision ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {submittingDeadlineDecision
                ? (deadlineRequestExtension ? 'Requesting extension...' : 'Returning lead...')
                : (deadlineRequestExtension ? 'Request Extension' : 'Return Lead')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
