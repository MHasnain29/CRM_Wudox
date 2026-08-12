import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors, useDraggable, useDroppable } from '@dnd-kit/core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Phone, CalendarClock, Lock, Filter, Save, Eye, Trash2, Calendar, DollarSign, Building2, X, Mail, FileText, CheckCircle2, ChevronDown, ChevronUp, TrendingUp, ArrowRightLeft } from 'lucide-react';
import { ForwardedChip } from '@/components/offboarding/ForwardedChip';
import { useStore } from '@/lib/store';
import { useCallStore } from '@/lib/callStore';
import { useEffectiveUser } from '@/lib/effectiveUser';
import { useWriteAgencyId } from '@/hooks/useWriteAgencyId';
import { fetchLeads, uploadDocument, updateLeadApi, submitProposal, uploadProposalAttachment, resetLeadAfterRejection, fetchProposalById, type ApiUser } from '@/lib/api';
import { ScopeFilterBar } from '@/components/ScopeFilterBar';
import { PersonCardIdentity } from '@/components/PersonSectionHeader';
import { StickyHeader } from '@/components/StickyHeader';
import { useScopeFilter } from '@/hooks/useElevatedScopeFilter';
import { useScopeQueryParams } from '@/hooks/useScopeQueryParams';
import { DateRangeFilterRow } from '@/components/DateRangeFilterRow';
import { useDateRangeFilter } from '@/hooks/useDateRangeFilter';
import { leadMatchesDateRange } from '@/lib/dateRangeFilter';
import { getSocket } from '@/lib/socket';
import { Loader2 } from 'lucide-react';
import { Lead, LeadStage, FilterView, Client, ProposalAttachment, AgreementType, AgreementPricing, PaymentTerms } from '@/lib/types';
import { TemperatureBadge } from '@/components/TemperatureBadge';
import { ClientDetailsSheet } from '@/components/ClientDetailsSheet';
import { FollowUpDialog } from '@/components/FollowUpDialog';
import { CreateTaskDialog } from '@/components/CreateTaskDialog';
import { TaskDetailDialog } from '@/components/TaskDetailDialog';
import { ProposalDialog, type ProposalDialogInitialValues } from '@/components/ProposalDialog';
import { ProposalDetailsDialog } from '@/components/ProposalDetailsDialog';
import { EmailComposeDialog } from '@/components/EmailComposeDialog';
import { CallInterface } from '@/components/CallInterface';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useToast } from '@/hooks/use-toast';
import { getLighterColor, cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/authStore';
import {
  useCanActOnLeads,
  useCanMovePipelineLeads,
  useCanWriteProposals,
  useHasPermission,
  useCanViewTeamScope,
  useDataScopeLevel,
} from '@/lib/access';
import { ReassignLeadDialog } from '@/components/ReassignLeadDialog';
// import { UserTabButton } from '@/components/UserTabButton';
import { getUserRoleTitle } from '@/lib/roleLabels';

/**
 * Main-board drag guard — mirrors backend ensureLeadWritableByRequester / getDataScope:
 * - Sub-company-wide roles may move any lead in scope (director, super_admin, dev_team).
 * - Managers may move own leads + direct reports.
 * - Everyone else: own leads only.
 */
/** Only proposal approval may place a lead here (status closed_won_pending) */
const STAGE_NO_MANUAL_DROP_AWAITING_CLIENT = 'awaiting_client_approval' satisfies LeadStage;

function canRequesterMoveLeadOnPipeline(
  lead: Pick<Lead, 'ownerId' | 'ownerName'>,
  currentUser: { id: string },
  agencyUsersForReporting: Pick<ApiUser, 'id' | 'reportingManagerIds'>[],
  dataScopeLevel: 'own' | 'team' | 'agency' | 'global',
  canMovePipeline: boolean,
): boolean {
  if (!canMovePipeline) return false;
  if (lead.ownerId === currentUser.id) return true;
  if (dataScopeLevel === 'agency' || dataScopeLevel === 'global') return true;
  if (dataScopeLevel !== 'team') return false;
  const owner = agencyUsersForReporting.find((u) => u.id === lead.ownerId);
  if (!owner?.reportingManagerIds?.length) return false;
  return owner.reportingManagerIds.includes(currentUser.id);
}

function DraggableLeadCard({
  lead,
  isOwnLead,
  canDrag,
  client,
  onViewClick,
  onAddFollowUpClick,
  onProposalClick,
  onEmailClick,
  onCallClick,
  onNewProposalClick,
  onResubmitReviewClick,
  onResetLeadClick,
  onReassignClick,
  canWriteProposals = false,
}: {
  lead: Lead;
  /** Lead is owned by the viewer (action bar, lock icon). */
  isOwnLead: boolean;
  /** May drag on pipeline (pipeline:write or leads:write). */
  canDrag: boolean;
  canWriteProposals?: boolean;
  client: Client;
  onViewClick: () => void;
  onAddFollowUpClick: (lead: Lead) => void;
  onProposalClick?: (lead: Lead) => void;
  onEmailClick: (lead: Lead) => void;
  onCallClick: (lead: Lead) => void;
  onNewProposalClick?: (lead: Lead) => void;
  onResubmitReviewClick?: (lead: Lead) => void;
  onResetLeadClick?: (leadId: string) => void;
  onReassignClick?: (lead: Lead) => void;
}) {
  const canCall = useHasPermission('voice:use');
  const canEmail = useCanActOnLeads();
  const canFollowUp = useHasPermission('clients:write');
  const isClosedLost = lead.status === 'closed_lost' || lead.stage === 'closed_lost';
  const isClosedWon = lead.status === 'closed_won' || lead.stage === 'closed_won';
  const isAwaitingApproval = lead.status === 'closed_won_pending';
  const isInProposal = lead.stage === 'proposal_sent';
  const isTerminal = isClosedLost || isClosedWon || isAwaitingApproval || isInProposal;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
    disabled: !canDrag || isTerminal,
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined;

  const hasProposal = lead.stage === 'proposal_sent' && lead.proposalData;
  const isRejected = lead.latestProposalStatus === 'rejected';
  const isPending = lead.latestProposalStatus === 'pending';
  const isPreviewSentToClient = lead.latestProposalStatus === 'approved'
    && lead.latestProposalIsForReview
    && !!lead.latestProposalReviewEmailSentAt;

  return (
    <div ref={setNodeRef} style={style} {...(!isTerminal ? { ...listeners, ...attributes } : {})}>
      <Card
        className={`${isClosedLost ? 'cursor-default opacity-70 border-l-red-400' : isClosedWon ? 'cursor-default opacity-70 border-l-emerald-400' : isAwaitingApproval ? 'cursor-default opacity-80 border-l-amber-400' : isInProposal ? 'cursor-default border-l-violet-400' : canDrag ? 'cursor-grab active:cursor-grabbing hover:shadow-md' : 'cursor-default opacity-60'} ${isDragging ? 'opacity-50 shadow-lg' : ''} border-l-4 transition-shadow`}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {!isOwnLead && <Lock className="h-3 w-3 text-muted-foreground" />}
                <span className="font-medium text-sm truncate">{client.name}</span>
                {hasProposal && (
                  <FileText className="h-3 w-3 text-violet-500" />
                )}
              </div>
              {lead.forwardedFromName && <ForwardedChip name={lead.forwardedFromName} />}
              <div className="text-xs text-muted-foreground">{lead.ownerName}</div>
            </div>
            <div className="ml-2">
              <TemperatureBadge temperature={lead.temperature} />
            </div>
          </div>
          
          {lead.notes && (
            <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
              {lead.notes}
            </p>
          )}
          
          <div className="flex flex-col gap-2 text-xs text-muted-foreground mb-3">
            {lead.lastActivity && (
              <div>Last: {format(new Date(lead.lastActivity), 'MMM d')}</div>
            )}
            {lead.nextFollowUp && (
              <div>Next: {format(new Date(lead.nextFollowUp), 'MMM d')}</div>
            )}
          </div>

          {/* Closed Lost banner */}
          {isClosedLost && (
            <div className="mb-3 rounded border border-red-200 bg-red-50 px-2 py-1">
              <p className="text-xs font-medium text-red-700">Closed Lost</p>
            </div>
          )}

          {/* Closed Won banner */}
          {isClosedWon && (
            <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-2 py-1">
              <p className="text-xs font-medium text-emerald-700">Closed Won</p>
            </div>
          )}

          {/* Pending proposal badge */}
          {isPending && (
            <div className="mb-3 rounded border border-blue-200 bg-blue-50 px-2 py-1">
              <p className="text-xs font-medium text-blue-700">Proposal Pending Review</p>
            </div>
          )}

          {/* Preview sent to client banner */}
          {isPreviewSentToClient && isOwnLead && (
            <div className="mb-3 rounded border border-violet-200 bg-violet-50 p-2">
              <p className="text-xs font-medium text-violet-700">Preview Sent to Client</p>
              {/* <p className="text-xs text-violet-500 mt-0.5">Client is reviewing the agreement</p> */}
              <Button
                size="sm"
                className="mt-2 h-6 text-xs px-2 w-full bg-violet-600 hover:bg-violet-700 text-white"
                onClick={(e) => { e.stopPropagation(); onResubmitReviewClick?.(lead); }}
              >
                Submit Again
              </Button>
            </div>
          )}

          {/* View Proposal button for proposal_sent stage */}
          {hasProposal && onProposalClick && (
            <Button
              size="sm"
              variant="outline"
              className="w-full mb-3 text-xs h-7"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onProposalClick(lead);
              }}
            >
              <FileText className="h-3 w-3 mr-1" />
              View Proposal Details
            </Button>
          )}

          {/* Rejected proposal UI */}
          {isRejected && isOwnLead && (
            <div className="mb-3 rounded border border-red-200 bg-red-50 p-2">
              <p className="text-xs font-medium text-red-700">Proposal Rejected</p>
              {lead.latestRejectionComment && (
                <p className="mt-1 text-xs text-red-600 line-clamp-2">{lead.latestRejectionComment}</p>
              )}
              <div className="mt-2 flex gap-2">
                {canWriteProposals && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs px-2 w-full"
                  onClick={(e) => { e.stopPropagation(); onNewProposalClick?.(lead); }}
                >
                  Submit Again
                </Button>
                )}
              </div>
            </div>
          )}
          
          {isOwnLead && !isTerminal && (
            <div className={`grid gap-1 pt-3 border-t border-border ${
              [true, canCall, canEmail, canFollowUp, !!onReassignClick].filter(Boolean).length === 5
                ? 'grid-cols-5'
                : [true, canCall, canEmail, canFollowUp, !!onReassignClick].filter(Boolean).length === 4
                  ? 'grid-cols-4'
                  : 'grid-cols-3'
            }`}>
              <Button 
                size="sm" 
                variant="ghost" 
                className="h-8 text-xs px-1"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewClick();
                }}
              >
                <Eye className="h-3 w-3" />
              </Button>
              {canCall && (
              <Button 
                size="sm" 
                variant="ghost" 
                className="h-8 text-xs px-1"
                onClick={(e) => {
                  e.stopPropagation();
                  onCallClick(lead);
                }}
              >
                <Phone className="h-3 w-3" />
              </Button>
              )}
              {canEmail && (
              <Button 
                size="sm" 
                variant="ghost" 
                className="h-8 text-xs px-1"
                onClick={(e) => {
                  e.stopPropagation();
                  onEmailClick(lead);
                }}
              >
                <Mail className="h-3 w-3" />
              </Button>
              )}
              {canFollowUp && (
              <Button 
                size="sm" 
                variant="ghost" 
                className="h-8 text-xs px-1"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddFollowUpClick(lead);
                }}
              >
                <CalendarClock className="h-3 w-3" />
              </Button>
              )}
              {onReassignClick && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs px-1"
                  title="Reassign lead"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReassignClick(lead);
                  }}
                >
                  <ArrowRightLeft className="h-3 w-3" />
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DroppableColumn({
  stage,
  leads,
  clients,
  stageLabel,
  stageColor,
  onViewLead,
  onAddFollowUp,
  onProposalClick,
  onEmailClick,
  onCallClick,
  onNewProposalClick,
  onResubmitReviewClick,
  onResetLeadClick,
  onReassignClick,
  canDragLead,
  isOwnLead,
  canWriteProposals = false,
}: {
  stage: LeadStage;
  leads: Lead[];
  clients: Client[];
  stageLabel: string;
  stageColor: string;
  onViewLead: (lead: Lead) => void;
  onAddFollowUp: (lead: Lead) => void;
  onProposalClick: (lead: Lead) => void;
  onEmailClick: (lead: Lead) => void;
  onCallClick: (lead: Lead) => void;
  onNewProposalClick: (lead: Lead) => void;
  onResubmitReviewClick?: (lead: Lead) => void;
  onResetLeadClick: (leadId: string) => void;
  onReassignClick?: (lead: Lead) => void;
  canDragLead?: (lead: Lead) => boolean;
  isOwnLead: (lead: Lead) => boolean;
  canWriteProposals?: boolean;
}) {
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  const dragAllowed = canDragLead ?? (() => false);
  const { setNodeRef, isOver } = useDroppable({
    id: stage,
  });
  
  const stageLeads = leads.filter(l => {
    const isClosedLost = l.status === 'closed_lost' || l.stage === 'closed_lost';
    if (isClosedLost) return stage === 'closed_lost';
    const isClosedWon = l.status === 'closed_won' || l.stage === 'closed_won';
    if (isClosedWon) return stage === 'closed_won';
    return l.stage === stage;
  });

  useEffect(() => {
    setPage(1);
  }, [stage, stageLeads.length]);

  const totalPages = Math.max(1, Math.ceil(stageLeads.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const pageRows = stageLeads.slice(startIndex, startIndex + PAGE_SIZE);
  const bgColor = getLighterColor(stageColor);
  
  return (
    <div className="flex-shrink-0 w-80 flex flex-col">
      <div
        ref={setNodeRef}
        className={`border-2 rounded-xl p-4 flex flex-col flex-1 min-h-0 transition-all ${isOver ? 'ring-2 ring-primary shadow-lg scale-105' : 'shadow-sm'}`}
        style={{ 
          backgroundColor: bgColor,
          borderColor: isOver ? undefined : stageColor + '33'
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: stageColor }}
            />
            {stageLabel}
          </h3>
          <Badge variant="secondary" className="font-semibold">{stageLeads.length}</Badge>
        </div>
        
        <div className="space-y-3 overflow-y-auto flex-1 min-h-0 pr-1">
          {stageLeads.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No leads in this stage
            </div>
          ) : (
            pageRows.map(lead => {
              const client = clients.find(c => c.id === lead.clientId);
              
              if (!client) return null;
              
              return (
                <DraggableLeadCard
                  key={lead.id}
                  lead={lead}
                  isOwnLead={isOwnLead(lead)}
                  canDrag={dragAllowed(lead)}
                  client={client}
                  onViewClick={() => onViewLead(lead)}
                  onAddFollowUpClick={onAddFollowUp}
                  onProposalClick={onProposalClick}
                  onEmailClick={onEmailClick}
                  onCallClick={onCallClick}
                  onNewProposalClick={onNewProposalClick}
                  onResubmitReviewClick={onResubmitReviewClick}
                  onResetLeadClick={onResetLeadClick}
                  onReassignClick={onReassignClick}
                  canWriteProposals={canWriteProposals}
                />
              );
            })
          )}
        </div>
        {stageLeads.length > PAGE_SIZE && (
          <div className="flex flex-col gap-2 pt-3 mt-2 border-t shrink-0">
            <div className="text-[11px] text-muted-foreground">
              Showing {startIndex + 1} to {Math.min(startIndex + pageRows.length, stageLeads.length)} of {stageLeads.length}
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
              >
                Prev
              </Button>
              {(() => {
                const maxButtons = 5;
                const start =
                  totalPages <= maxButtons
                    ? 1
                    : Math.min(Math.max(1, safePage - 2), totalPages - maxButtons + 1);
                const end = Math.min(start + maxButtons - 1, totalPages);
                return Array.from({ length: end - start + 1 }, (_, i) => start + i).map((p) => (
                  <Button
                    key={p}
                    variant={safePage === p ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 min-w-[28px] px-1.5 text-xs"
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </Button>
                ));
              })()}
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function mapApiLeadToLead(apiLead: { id: string; clientId: string; ownerId: string; subCompanyId: string; stage: string; status: string; temperature: string | null; lastActivity: string | null; nextFollowUp: string | null; notes: string | null; createdAt: string; updatedAt: string; closedAt?: string | null; client: { name: string }; owner: { firstName: string; lastName: string }; latestProposalId?: string | null; latestProposalStatus?: string | null; latestRejectionComment?: string | null; latestProposalIsForReview?: boolean; latestProposalReviewEmailSentAt?: string | null; forwardedFromName?: string | null; forwardedFromSubCompanyId?: string | null }, subCompanyName: string): Lead {
  return {
    id: apiLead.id,
    clientId: apiLead.clientId,
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
    latestProposalId: apiLead.latestProposalId ?? null,
    latestProposalStatus: (apiLead.latestProposalStatus as Lead['latestProposalStatus']) ?? null,
    latestRejectionComment: apiLead.latestRejectionComment ?? null,
    latestProposalIsForReview: apiLead.latestProposalIsForReview ?? false,
    latestProposalReviewEmailSentAt: apiLead.latestProposalReviewEmailSentAt ?? null,
    forwardedFromName: apiLead.forwardedFromName ?? null,
    forwardedFromSubCompanyId: apiLead.forwardedFromSubCompanyId ?? null,
  };
}

// ─── Palette: one colour per agency section (cycles) ──────────────────────
const AGENCY_PALETTE = [
  { bg: 'bg-blue-500/10',    border: 'border-blue-500/20',    text: 'text-blue-600',    accent: 'bg-blue-500'    },
  { bg: 'bg-purple-500/10',  border: 'border-purple-500/20',  text: 'text-purple-600',  accent: 'bg-purple-500'  },
  { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-600', accent: 'bg-emerald-500' },
  { bg: 'bg-orange-500/10',  border: 'border-orange-500/20',  text: 'text-orange-600',  accent: 'bg-orange-500'  },
  { bg: 'bg-cyan-500/10',    border: 'border-cyan-500/20',    text: 'text-cyan-600',    accent: 'bg-cyan-500'    },
  { bg: 'bg-rose-500/10',    border: 'border-rose-500/20',    text: 'text-rose-600',    accent: 'bg-rose-500'    },
];

// ─── Per-user pipeline section (full kanban, manager "All Team" view) ────────
function UserPipelineSection({
  user,
  onViewBoard,
  onProposalClick,
  onNewProposalClick,
  onResubmitReviewClick,
  onEmailClick,
  onCallClick,
  onResetLeadClick,
  onReassignClick,
  canDragLead,
  canWriteProposals,
  dateRange,
}: {
  user: ApiUser;
  onViewBoard: () => void;
  onProposalClick: (lead: Lead) => void;
  onNewProposalClick: (lead: Lead, previousStage: LeadStage) => void;
  onResubmitReviewClick?: (lead: Lead, previousStage: LeadStage) => void;
  onEmailClick: (lead: Lead) => void;
  onCallClick: (lead: Lead) => void;
  onResetLeadClick: (leadId: string) => void;
  onReassignClick?: (lead: Lead) => void;
  canDragLead: (lead: Lead) => boolean;
  canWriteProposals: boolean;
  dateRange: { from: Date; to: Date } | null;
}) {
  const { pipelineStages, updateLead, setClients, currentSubCompany } = useStore();
  const [showLost, setShowLost] = useState(true);
  const [tempFilters, setTempFilters] = useState<string[]>([]);
  const [industryFilters, setIndustryFilters] = useState<string[]>([]);
  const [locationFilters, setLocationFilters] = useState<string[]>([]);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const writeAgencyId = useWriteAgencyId(selectedLead?.subCompanyId);
  const [isFollowUpOpen, setIsFollowUpOpen] = useState(false);
  const [followUpRefreshKey, setFollowUpRefreshKey] = useState(0);
  const [isCreateTaskDialogOpen, setIsCreateTaskDialogOpen] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const { data: leadsData, isLoading, refetch } = useQuery({
    queryKey: ['user-pipeline-leads-full', user.id],
    queryFn: () => fetchLeads({ ownerIds: [user.id], limit: 500 }),
    staleTime: 0,
  });

  const rawLeads = leadsData?.data ?? [];
  const subCompanyName = currentSubCompany?.name ?? '';
  const isOwnLeadForSection = (l: Lead) => l.ownerId === user.id;

  const localClients = useMemo<Client[]>(() =>
    Array.from(new Map(rawLeads.map(l => [l.clientId, {
      id: l.clientId,
      name: l.client.name,
      industry: (l.client as any).industry ?? '',
      location: (l.client as any).location ?? '',
      address: '',
      companySize: '',
      tags: (l.client as any).tags ?? [],
      contacts: [],
      status: 'active' as Client['status'],
      createdAt: new Date(),
      notes: [],
    }])).values()),
    [rawLeads]
  );

  useEffect(() => {
    if (localClients.length === 0) return;
    const existing = useStore.getState().clients;
    const existingIds = new Set(existing.map(c => c.id));
    const missing = localClients.filter(c => !existingIds.has(c.id));
    if (missing.length > 0) setClients([...existing, ...missing]);
  }, [localClients, setClients]);

  const leads = useMemo(() => rawLeads.map(l => mapApiLeadToLead(l, subCompanyName)), [rawLeads, subCompanyName]);

  const stageOrder = useMemo(() => [...pipelineStages].sort((a, b) => a.order - b.order), [pipelineStages]);
  const stageLabels = useMemo(() => pipelineStages.reduce((acc, s) => { acc[s.id] = s.label; return acc; }, {} as Record<string, string>), [pipelineStages]);
  const stageColors = useMemo(() => pipelineStages.reduce((acc, s) => { acc[s.id] = s.color; return acc; }, {} as Record<string, string>), [pipelineStages]);
  const stageIds = useMemo(() => stageOrder.map(s => s.id as LeadStage), [stageOrder]);

  const industries = useMemo(() => [...new Set(localClients.map(c => c.industry).filter(Boolean))].sort(), [localClients]);
  const locations  = useMemo(() => [...new Set(localClients.map(c => c.location).filter(Boolean))].sort(), [localClients]);
  const allTags    = useMemo(() => [...new Set(localClients.flatMap(c => c.tags))].sort(), [localClients]);

  const filteredLeads = useMemo(() => leads.filter(l => {
    const client = localClients.find(c => c.id === l.clientId);
    if (!showLost && (l.status === 'closed_lost' || l.stage === 'closed_lost')) return false;
    if (!leadMatchesDateRange(l, dateRange)) return false;
    if (tempFilters.length > 0 && !tempFilters.includes(l.temperature)) return false;
    if (industryFilters.length > 0 && (!client || !industryFilters.includes(client.industry))) return false;
    if (locationFilters.length > 0 && (!client || !locationFilters.includes(client.location))) return false;
    if (tagFilters.length > 0 && (!client || !tagFilters.some(t => client.tags.includes(t)))) return false;
    return true;
  }), [leads, localClients, showLost, dateRange, tempFilters, industryFilters, locationFilters, tagFilters]);

  const activeLead   = activeId ? leads.find(l => l.id === activeId) : null;
  const activeClient = activeLead ? localClients.find(c => c.id === activeLead.clientId) : null;

  const toggleFilter = (value: string, current: string[], set: (v: string[]) => void) =>
    set(current.includes(value) ? current.filter(v => v !== value) : [...current, value]);

  const handleDragStart = (event: DragStartEvent) => setActiveId(event.active.id as string);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) { setActiveId(null); return; }
    const leadId = active.id as string;
    const newStage = over.id as LeadStage;
    const lead = leads.find(l => l.id === leadId);
    if (!lead || lead.stage === newStage) { setActiveId(null); return; }
    if (!canDragLead(lead)) {
      toast.error('You do not have permission to move leads on the pipeline');
      setActiveId(null);
      return;
    }
    if (lead.status === 'closed_won_pending') { toast.error('This lead is awaiting client approval and cannot be moved'); setActiveId(null); return; }
    if (lead.stage === 'proposal_sent') { setActiveId(null); return; }
    if (lead.stage === 'closed_won') { toast.error('Closed Won leads cannot be moved'); setActiveId(null); return; }
    if (newStage === 'closed_won') { toast.error('Leads can only move to Closed Won when a proposal is approved'); setActiveId(null); return; }
    if (newStage === 'closed_lost') { toast.error('Leads cannot be manually moved to Closed Lost'); setActiveId(null); return; }
    if (newStage === STAGE_NO_MANUAL_DROP_AWAITING_CLIENT) {
      toast.error('Awaiting Client Approval is only set when a proposal is approved');
      setActiveId(null);
      return;
    }
    if (newStage === 'proposal_sent') {
      if (!canWriteProposals) {
        toast.error('You do not have permission to create proposals');
        setActiveId(null);
        return;
      }
      updateLead(leadId, { stage: newStage });
      onNewProposalClick(lead, lead.stage);
      setActiveId(null); return;
    }
    const previousStage = lead.stage;
    const previousStatus = lead.status;
    updateLead(leadId, { stage: newStage });
    try {
      await updateLeadApi(leadId, { stage: newStage });
      toast.success('Lead updated', { description: `Moved to ${stageLabels[newStage] || newStage}` });
      refetch();
    } catch {
      toast.error('Failed to update lead stage');
      updateLead(leadId, { stage: previousStage, status: previousStatus });
    }
    setActiveId(null);
  };

  const fullName = `${user.firstName} ${user.lastName}`.trim();

  return (
    <>
      <Card className="border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 bg-muted/40 border-b">
          <PersonCardIdentity
            user={user}
            roleTitle={getUserRoleTitle(user)}
            subtitle={`${leads.length} lead${leads.length !== 1 ? 's' : ''}`}
          />
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={onViewBoard}>
            View Board <TrendingUp className="h-3 w-3" />
          </Button>
        </div>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading pipeline...</span>
            </div>
          ) : (
            <>
              {/* Filters */}
              <div className="flex gap-2 flex-wrap items-center mb-4">
                <div className="flex items-center space-x-2">
                  <Checkbox id={`show-lost-${user.id}`} checked={showLost} onCheckedChange={checked => setShowLost(checked === true)} />
                  <label htmlFor={`show-lost-${user.id}`} className="text-sm cursor-pointer">Show Lost Leads</label>
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                      <Filter className="h-4 w-4" />Temperature
                      {tempFilters.length > 0 && <Badge variant="secondary" className="ml-1">{tempFilters.length}</Badge>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-3 bg-popover" align="start">
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm mb-2">Filter by Temperature</h4>
                      {['hot', 'warm', 'cold'].map(temp => (
                        <div key={temp} className="flex items-center space-x-2">
                          <Checkbox id={`temp-${user.id}-${temp}`} checked={tempFilters.includes(temp)} onCheckedChange={() => toggleFilter(temp, tempFilters, setTempFilters)} />
                          <label htmlFor={`temp-${user.id}-${temp}`} className="text-sm capitalize cursor-pointer">{temp}</label>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                {industries.length > 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2">
                        <Filter className="h-4 w-4" />Industry
                        {industryFilters.length > 0 && <Badge variant="secondary" className="ml-1">{industryFilters.length}</Badge>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-3 bg-popover" align="start">
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm mb-2">Filter by Industry</h4>
                        {industries.map(ind => (
                          <div key={ind} className="flex items-center space-x-2">
                            <Checkbox id={`ind-${user.id}-${ind}`} checked={industryFilters.includes(ind)} onCheckedChange={() => toggleFilter(ind, industryFilters, setIndustryFilters)} />
                            <label htmlFor={`ind-${user.id}-${ind}`} className="text-sm cursor-pointer">{ind}</label>
                          </div>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
                {locations.length > 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2">
                        <Filter className="h-4 w-4" />Location
                        {locationFilters.length > 0 && <Badge variant="secondary" className="ml-1">{locationFilters.length}</Badge>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-3 bg-popover" align="start">
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm mb-2">Filter by Location</h4>
                        {locations.map(loc => (
                          <div key={loc} className="flex items-center space-x-2">
                            <Checkbox id={`loc-${user.id}-${loc}`} checked={locationFilters.includes(loc)} onCheckedChange={() => toggleFilter(loc, locationFilters, setLocationFilters)} />
                            <label htmlFor={`loc-${user.id}-${loc}`} className="text-sm cursor-pointer">{loc}</label>
                          </div>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
                {allTags.length > 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2">
                        <Filter className="h-4 w-4" />Tags
                        {tagFilters.length > 0 && <Badge variant="secondary" className="ml-1">{tagFilters.length}</Badge>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-3 bg-popover" align="start">
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm mb-2">Filter by Tags</h4>
                        {allTags.map(tag => (
                          <div key={tag} className="flex items-center space-x-2">
                            <Checkbox id={`tag-${user.id}-${tag}`} checked={tagFilters.includes(tag)} onCheckedChange={() => toggleFilter(tag, tagFilters, setTagFilters)} />
                            <label htmlFor={`tag-${user.id}-${tag}`} className="text-sm cursor-pointer">{tag}</label>
                          </div>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
              {/* Kanban board */}
              <div className="overflow-x-auto pb-4">
                <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                  <div className="flex gap-4 min-w-max items-stretch" style={{ height: 'calc(55vh - 150px)', minHeight: '320px' }}>
                    {stageIds.map(stage => (
                      <DroppableColumn
                        key={stage}
                        stage={stage}
                        leads={filteredLeads}
                        clients={localClients}
                        stageLabel={stageLabels[stage as string] || stage}
                        stageColor={stageColors[stage as string] || '#6b7280'}
                        onViewLead={setSelectedLead}
                        onAddFollowUp={(lead) => { setSelectedLead(lead); setIsFollowUpOpen(true); }}
                        onProposalClick={onProposalClick}
                        onEmailClick={onEmailClick}
                        onCallClick={onCallClick}
                        onNewProposalClick={(lead) => onNewProposalClick(lead, lead.stage)}
                        onResubmitReviewClick={onResubmitReviewClick ? (lead) => onResubmitReviewClick(lead, lead.stage) : undefined}
                        onResetLeadClick={onResetLeadClick}
                        onReassignClick={onReassignClick}
                        canDragLead={canDragLead}
                        isOwnLead={isOwnLeadForSection}
                        canWriteProposals={canWriteProposals}
                      />
                    ))}
                  </div>
                  <DragOverlay>
                    {activeLead ? (
                      <Card className="cursor-grabbing opacity-90 rotate-3">
                        <CardContent className="p-4">
                          <span className="font-medium text-sm">{activeClient?.name || 'Unknown'}</span>
                        </CardContent>
                      </Card>
                    ) : null}
                  </DragOverlay>
                </DndContext>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <ClientDetailsSheet
        open={!!selectedLead}
        onOpenChange={(open) => !open && setSelectedLead(null)}
        client={selectedLead ? localClients.find(c => c.id === selectedLead.clientId) || null : null}
        subCompanyId={writeAgencyId}
        followUpRefreshKey={followUpRefreshKey}
        showActions={true}
        onCallClick={() => selectedLead && onCallClick(selectedLead)}
        onEmailClick={() => { if (selectedLead) onEmailClick(selectedLead); }}
        onAddTaskClick={() => setIsCreateTaskDialogOpen(true)}
        onAddFollowUpClick={() => setIsFollowUpOpen(true)}
      />
      <FollowUpDialog
        open={isFollowUpOpen}
        onOpenChange={(open) => { setIsFollowUpOpen(open); if (!open) setSelectedLead(null); }}
        clientId={selectedLead?.clientId || ''}
        clientName={selectedLead ? localClients.find(c => c.id === selectedLead.clientId)?.name || '' : ''}
        leadId={selectedLead?.id}
        subCompanyId={writeAgencyId}
        client={selectedLead ? localClients.find(c => c.id === selectedLead.clientId) : undefined}
        onFollowUpCreated={() => setFollowUpRefreshKey((k) => k + 1)}
      />
      <CreateTaskDialog
        open={isCreateTaskDialogOpen}
        onOpenChange={setIsCreateTaskDialogOpen}
        subCompanyId={writeAgencyId}
        defaultLinkType="lead"
        defaultLinkId={selectedLead?.id}
      />
    </>
  );
}

// ─── Per-agency pipeline section card (rendered for each agency in "All" view) ─
function AgencyPipelineSection({
  agency,
  onViewBoard,
  onProposalClick,
  onNewProposalClick,
  onResubmitReviewClick,
  onEmailClick,
  onCallClick,
  onResetLeadClick,
  onReassignClick,
  canDragLead,
  canWriteProposals,
  dateRange,
  ownerIds,
  scopeKey,
}: {
  agency: { id: string; name: string };
  onViewBoard: () => void;
  onProposalClick: (lead: Lead) => void;
  onNewProposalClick: (lead: Lead, previousStage: LeadStage) => void;
  onResubmitReviewClick?: (lead: Lead, previousStage: LeadStage) => void;
  onEmailClick: (lead: Lead) => void;
  onCallClick: (lead: Lead) => void;
  onResetLeadClick: (leadId: string) => void;
  onReassignClick?: (lead: Lead) => void;
  canDragLead: (lead: Lead) => boolean;
  canWriteProposals: boolean;
  dateRange: { from: Date; to: Date } | null;
  ownerIds?: string[];
  scopeKey: string;
}) {
  const { pipelineStages, updateLead, setClients, currentUser } = useStore();
  const effectiveUser = useEffectiveUser();
  const [showLost, setShowLost] = useState(true);
  const [tempFilters, setTempFilters] = useState<string[]>([]);
  const [industryFilters, setIndustryFilters] = useState<string[]>([]);
  const [locationFilters, setLocationFilters] = useState<string[]>([]);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const writeAgencyId = useWriteAgencyId(selectedLead?.subCompanyId);
  const [isFollowUpOpen, setIsFollowUpOpen] = useState(false);
  const [followUpRefreshKey, setFollowUpRefreshKey] = useState(0);
  const [isCreateTaskDialogOpen, setIsCreateTaskDialogOpen] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const { data: leadsData, isLoading, refetch } = useQuery({
    queryKey: ['agency-pipeline-leads', agency.id, scopeKey],
    queryFn: () => fetchLeads({ agencyIds: [agency.id], ownerIds, limit: 500 }),
    staleTime: 0,
  });

  const rawLeads = leadsData?.data ?? [];
  const isOwnLeadForAgencyBoard = (l: Lead) => l.ownerId === effectiveUser.id;

  const localClients = useMemo<Client[]>(() =>
    Array.from(new Map(rawLeads.map(l => [l.clientId, {
      id: l.clientId,
      name: l.client.name,
      industry: (l.client as any).industry ?? '',
      location: (l.client as any).location ?? '',
      address: '',
      companySize: '',
      tags: (l.client as any).tags ?? [],
      contacts: [],
      status: 'active' as Client['status'],
      createdAt: new Date(),
      notes: [],
    }])).values()),
    [rawLeads]
  );

  useEffect(() => {
    if (localClients.length === 0) return;
    const existing = useStore.getState().clients;
    const existingIds = new Set(existing.map(c => c.id));
    const missing = localClients.filter(c => !existingIds.has(c.id));
    if (missing.length > 0) setClients([...existing, ...missing]);
  }, [localClients, setClients]);

  const leads = useMemo(() => rawLeads.map(l => mapApiLeadToLead(l, agency.name)), [rawLeads, agency.name]);

  const stageOrder = useMemo(() => [...pipelineStages].sort((a, b) => a.order - b.order), [pipelineStages]);
  const stageLabels = useMemo(() => pipelineStages.reduce((acc, s) => { acc[s.id] = s.label; return acc; }, {} as Record<string, string>), [pipelineStages]);
  const stageColors = useMemo(() => pipelineStages.reduce((acc, s) => { acc[s.id] = s.color; return acc; }, {} as Record<string, string>), [pipelineStages]);
  const stageIds = useMemo(() => stageOrder.map(s => s.id as LeadStage), [stageOrder]);

  const industries = useMemo(() => [...new Set(localClients.map(c => c.industry).filter(Boolean))].sort(), [localClients]);
  const locations = useMemo(() => [...new Set(localClients.map(c => c.location).filter(Boolean))].sort(), [localClients]);
  const allTags = useMemo(() => [...new Set(localClients.flatMap(c => c.tags))].sort(), [localClients]);

  const filteredLeads = useMemo(() => leads.filter(l => {
    const client = localClients.find(c => c.id === l.clientId);
    if (!showLost && (l.status === 'closed_lost' || l.stage === 'closed_lost')) return false;
    if (!leadMatchesDateRange(l, dateRange)) return false;
    if (tempFilters.length > 0 && !tempFilters.includes(l.temperature)) return false;
    if (industryFilters.length > 0 && (!client || !industryFilters.includes(client.industry))) return false;
    if (locationFilters.length > 0 && (!client || !locationFilters.includes(client.location))) return false;
    if (tagFilters.length > 0 && (!client || !tagFilters.some(t => client.tags.includes(t)))) return false;
    return true;
  }), [leads, localClients, showLost, dateRange, tempFilters, industryFilters, locationFilters, tagFilters]);

  const activeLead = activeId ? leads.find(l => l.id === activeId) : null;
  const activeClient = activeLead ? localClients.find(c => c.id === activeLead.clientId) : null;

  const toggleFilter = (value: string, current: string[], set: (v: string[]) => void) =>
    set(current.includes(value) ? current.filter(v => v !== value) : [...current, value]);

  const handleDragStart = (event: DragStartEvent) => setActiveId(event.active.id as string);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) { setActiveId(null); return; }
    const leadId = active.id as string;
    const newStage = over.id as LeadStage;
    const lead = leads.find(l => l.id === leadId);
    if (!lead || lead.stage === newStage) { setActiveId(null); return; }
    if (!canDragLead(lead)) {
      toast.error('You do not have permission to move leads on the pipeline');
      setActiveId(null);
      return;
    }

    if (lead.status === 'closed_won_pending') {
      toast.error('This lead is awaiting client approval and cannot be moved');
      setActiveId(null); return;
    }
    if (lead.stage === 'proposal_sent') { setActiveId(null); return; }
    if (lead.stage === 'closed_won') {
      toast.error('Closed Won leads cannot be moved');
      setActiveId(null); return;
    }
    if (newStage === 'closed_won') {
      toast.error('Leads can only move to Closed Won when a proposal is approved');
      setActiveId(null); return;
    }
    if (newStage === 'closed_lost') {
      toast.error('Leads cannot be manually moved to Closed Lost');
      setActiveId(null); return;
    }
    if (newStage === STAGE_NO_MANUAL_DROP_AWAITING_CLIENT) {
      toast.error('Awaiting Client Approval is only set when a proposal is approved');
      setActiveId(null);
      return;
    }
    if (newStage === 'proposal_sent') {
      if (!canWriteProposals) {
        toast.error('You do not have permission to create proposals');
        setActiveId(null);
        return;
      }
      updateLead(leadId, { stage: newStage });
      onNewProposalClick(lead, lead.stage);
      setActiveId(null); return;
    }

    const previousStage = lead.stage;
    const previousStatus = lead.status;
    updateLead(leadId, { stage: newStage });
    try {
      await updateLeadApi(leadId, { stage: newStage });
      toast.success('Lead updated', { description: `Moved to ${stageLabels[newStage] || newStage}` });
      refetch();
    } catch {
      toast.error('Failed to update lead stage');
      updateLead(leadId, { stage: previousStage, status: previousStatus });
    }
    setActiveId(null);
  };

  return (
    <>
      <Card className="border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 bg-muted/30 border-b">
          <h2 className="font-semibold text-base">{agency.name}</h2>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={onViewBoard}>
            View Board <TrendingUp className="h-3 w-3" />
          </Button>
        </div>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading pipeline...</span>
            </div>
          ) : (
            <>
              {/* Filters */}
              <div className="flex gap-2 flex-wrap items-center mb-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id={`show-lost-${agency.id}`}
                    checked={showLost}
                    onCheckedChange={checked => setShowLost(checked === true)}
                  />
                  <label htmlFor={`show-lost-${agency.id}`} className="text-sm cursor-pointer">Show Lost Leads</label>
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                      <Filter className="h-4 w-4" />Temperature
                      {tempFilters.length > 0 && <Badge variant="secondary" className="ml-1">{tempFilters.length}</Badge>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-3 bg-popover" align="start">
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm mb-2">Filter by Temperature</h4>
                      {['hot', 'warm', 'cold'].map(temp => (
                        <div key={temp} className="flex items-center space-x-2">
                          <Checkbox id={`temp-${agency.id}-${temp}`} checked={tempFilters.includes(temp)} onCheckedChange={() => toggleFilter(temp, tempFilters, setTempFilters)} />
                          <label htmlFor={`temp-${agency.id}-${temp}`} className="text-sm capitalize cursor-pointer">{temp}</label>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                {industries.length > 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2">
                        <Filter className="h-4 w-4" />Industry
                        {industryFilters.length > 0 && <Badge variant="secondary" className="ml-1">{industryFilters.length}</Badge>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-3 bg-popover" align="start">
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm mb-2">Filter by Industry</h4>
                        {industries.map(ind => (
                          <div key={ind} className="flex items-center space-x-2">
                            <Checkbox id={`ind-${agency.id}-${ind}`} checked={industryFilters.includes(ind)} onCheckedChange={() => toggleFilter(ind, industryFilters, setIndustryFilters)} />
                            <label htmlFor={`ind-${agency.id}-${ind}`} className="text-sm cursor-pointer">{ind}</label>
                          </div>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
                {locations.length > 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2">
                        <Filter className="h-4 w-4" />Location
                        {locationFilters.length > 0 && <Badge variant="secondary" className="ml-1">{locationFilters.length}</Badge>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-3 bg-popover" align="start">
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm mb-2">Filter by Location</h4>
                        {locations.map(loc => (
                          <div key={loc} className="flex items-center space-x-2">
                            <Checkbox id={`loc-${agency.id}-${loc}`} checked={locationFilters.includes(loc)} onCheckedChange={() => toggleFilter(loc, locationFilters, setLocationFilters)} />
                            <label htmlFor={`loc-${agency.id}-${loc}`} className="text-sm cursor-pointer">{loc}</label>
                          </div>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
                {allTags.length > 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2">
                        <Filter className="h-4 w-4" />Tags
                        {tagFilters.length > 0 && <Badge variant="secondary" className="ml-1">{tagFilters.length}</Badge>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-3 bg-popover" align="start">
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm mb-2">Filter by Tags</h4>
                        {allTags.map(tag => (
                          <div key={tag} className="flex items-center space-x-2">
                            <Checkbox id={`tag-${agency.id}-${tag}`} checked={tagFilters.includes(tag)} onCheckedChange={() => toggleFilter(tag, tagFilters, setTagFilters)} />
                            <label htmlFor={`tag-${agency.id}-${tag}`} className="text-sm cursor-pointer">{tag}</label>
                          </div>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
              {/* Kanban board */}
              <div className="overflow-x-auto pb-4">
                <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                  <div className="flex gap-4 min-w-max items-stretch" style={{ height: 'calc(55vh - 150px)', minHeight: '320px' }}>
                    {stageIds.map(stage => (
                      <DroppableColumn
                        key={stage}
                        stage={stage}
                        leads={filteredLeads}
                        clients={localClients}
                        stageLabel={stageLabels[stage as string] || stage}
                        stageColor={stageColors[stage as string] || '#6b7280'}
                        onViewLead={setSelectedLead}
                        onAddFollowUp={(lead) => { setSelectedLead(lead); setIsFollowUpOpen(true); }}
                        onProposalClick={onProposalClick}
                        onEmailClick={onEmailClick}
                        onCallClick={onCallClick}
                        onNewProposalClick={(lead) => onNewProposalClick(lead, lead.stage)}
                        onResubmitReviewClick={onResubmitReviewClick ? (lead) => onResubmitReviewClick(lead, lead.stage) : undefined}
                        onResetLeadClick={onResetLeadClick}
                        onReassignClick={onReassignClick}
                        canDragLead={canDragLead}
                        isOwnLead={isOwnLeadForAgencyBoard}
                        canWriteProposals={canWriteProposals}
                      />
                    ))}
                  </div>
                  <DragOverlay>
                    {activeLead ? (
                      <Card className="cursor-grabbing opacity-90 rotate-3">
                        <CardContent className="p-4">
                          <span className="font-medium text-sm">{activeClient?.name || 'Unknown'}</span>
                        </CardContent>
                      </Card>
                    ) : null}
                  </DragOverlay>
                </DndContext>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <ClientDetailsSheet
        open={!!selectedLead}
        onOpenChange={(open) => !open && setSelectedLead(null)}
        client={selectedLead ? localClients.find(c => c.id === selectedLead.clientId) || null : null}
        subCompanyId={writeAgencyId}
        followUpRefreshKey={followUpRefreshKey}
        showActions={true}
        onCallClick={() => selectedLead && onCallClick(selectedLead)}
        onEmailClick={() => { if (selectedLead) { onEmailClick(selectedLead); } }}
        onAddTaskClick={() => setIsCreateTaskDialogOpen(true)}
        onAddFollowUpClick={() => setIsFollowUpOpen(true)}
      />
      <FollowUpDialog
        open={isFollowUpOpen}
        onOpenChange={(open) => { setIsFollowUpOpen(open); if (!open) setSelectedLead(null); }}
        clientId={selectedLead?.clientId || ''}
        clientName={selectedLead ? localClients.find(c => c.id === selectedLead.clientId)?.name || '' : ''}
        leadId={selectedLead?.id}
        subCompanyId={writeAgencyId}
        client={selectedLead ? localClients.find(c => c.id === selectedLead.clientId) : undefined}
        onFollowUpCreated={() => setFollowUpRefreshKey((k) => k + 1)}
      />
      <CreateTaskDialog
        open={isCreateTaskDialogOpen}
        onOpenChange={setIsCreateTaskDialogOpen}
        subCompanyId={writeAgencyId}
        defaultLinkType="lead"
        defaultLinkId={selectedLead?.id}
      />
    </>
  );
}

export default function Pipeline() {
  const { leads, clients, currentUser, updateLead, pipelineStages, setLeads, setClients, currentSubCompany } = useStore();
  const effectiveUser = useEffectiveUser();
  const { activeCall, isCallInterfaceOpen, isMinimized, openCallInterface } = useCallStore();
  const { toast: showToast } = useToast();
  const {
    period: datePeriod,
    customRange: dateCustomRange,
    effectiveRange: dateRange,
    setPeriod: setDatePeriod,
    setCustomRange: setDateCustomRange,
    isActive: isDateFilterActive,
  } = useDateRangeFilter();
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [isRefetching, setIsRefetching] = useState(false);
  // Tracks whether we've completed the first successful load so filter changes
  // don't replace the entire board with a spinner.
  const hasLoaded = useRef(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'pipeline' | 'active'>('pipeline');
  const [activeSearch, setActiveSearch] = useState('');
  const [activeOwnerFilter, setActiveOwnerFilter] = useState<string>('all');
  const permissions = useAuthStore((s) => s.permissions);
  const canReassignLead =
    permissions.includes('leads:reassign') || permissions.includes('leads:reassign_approve');
  const canMovePipeline = useCanMovePipelineLeads();
  const canWriteProposals = useCanWriteProposals();
  const dataScopeLevel = useDataScopeLevel();

  const scopeFilter = useScopeFilter();
  const {
    isElevated,
    showHierarchyFilters,
    isAgencyHierarchyViewer,
    isPureManager,
    agencies,
    agenciesLoading,
    agencyUsers,
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
    filterRowProps,
    teamUsers: managerTeamUsers,
    showAllTeamView,
    showAgencySections,
    showManagerSections,
    leaderParamInUrl,
    managerParamInUrl,
    userParamInUrl,
    scopeKey,
  } = scopeFilter;

  const { ownerIds: elevatedOwnerIds } = useScopeQueryParams(scopeFilter);

  const reportingUsersForMoveCheck = isElevated
    ? agencyUsers
    : managerTeamUsers;

  const canMoveLeadAsCurrentUser = useCallback(
    (lead: Lead) =>
      canRequesterMoveLeadOnPipeline(
        lead,
        effectiveUser,
        reportingUsersForMoveCheck ?? [],
        dataScopeLevel,
        canMovePipeline,
      ),
    [effectiveUser, reportingUsersForMoveCheck, dataScopeLevel, canMovePipeline],
  );

  const canSeeTeamLeads = useCanViewTeamScope();

  const setClientStatusInStore = useCallback((clientId: string, status: Client['status']) => {
    const currentClients = useStore.getState().clients;
    if (!currentClients.some((client) => client.id === clientId && client.status !== status)) return;

    setClients(
      currentClients.map((client) =>
        client.id === clientId ? { ...client, status } : client
      )
    );
  }, [setClients]);

  // Reset hasLoaded when the agency/subcompany changes so a full spinner shows
  useEffect(() => {
    hasLoaded.current = false;
  }, [currentSubCompany?.id, selectedAgencyId, selectedManagerId, selectedUserId]);

  const loadLeads = useCallback(async () => {
    if (!currentSubCompany?.id) return;
    // Agency-card / people-section views load via section components — skip main board fetch
    if (showAgencySections || showAllTeamView) {
      setLeadsLoading(false);
      return;
    }
    // First load → full-page spinner. Subsequent loads (filter change) → background refetch.
    if (!hasLoaded.current) {
      setLeadsLoading(true);
    } else {
      setIsRefetching(true);
    }
    try {
      const ownerIds = elevatedOwnerIds;
      if (ownerIds !== undefined && ownerIds.length === 0) {
        setLeads([]);
        hasLoaded.current = true;
        return;
      }
      const res = await fetchLeads({
        limit: 500,
        ownerIds,
        subCompanyId: isElevated ? undefined : currentSubCompany.id,
        agencyIds: isElevated && selectedAgencyId !== 'all' && selectedAgencyId !== 'me' ? [selectedAgencyId] : undefined,
      });

      // Build clients from lead response data (no extra API call needed)
      const clientsFromLeads: Client[] = Array.from(
        new Map(res.data.map((l) => [l.clientId, {
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
        }])).values()
      );

      // Merge: keep full data for clients already in store, add missing ones
      const existing = useStore.getState().clients;
      const existingIds = new Set(existing.map((c) => c.id));
      const missing = clientsFromLeads.filter((c) => !existingIds.has(c.id));
      if (missing.length > 0) setClients([...existing, ...missing]);

      setLeads(res.data.map((a) => mapApiLeadToLead(a, currentSubCompany.name)));
      hasLoaded.current = true;
    } catch {
      showToast({ title: 'Error', description: 'Failed to load pipeline', variant: 'destructive' });
    } finally {
      setLeadsLoading(false);
      setIsRefetching(false);
    }
  }, [currentSubCompany?.id, currentSubCompany?.name, isElevated, isPureManager, selectedAgencyId, showAllTeamView, setLeads, setClients, showToast, elevatedOwnerIds]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  // Socket listeners for real-time proposal updates
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    socket.on('proposal:approved', ({ leadId, clientId, activated }: { leadId: string; clientId?: string; clientName: string; reviewerName: string; activated?: boolean }) => {
      const currentLeads = useStore.getState().leads;
      setLeads(
        currentLeads.map((l) =>
          l.id === leadId
            ? activated
              ? {
                  ...l,
                  stage: 'closed_won' as LeadStage,
                  status: 'closed_won' as Lead['status'],
                  latestProposalStatus: 'approved' as const,
                }
              : {
                  ...l,
                  stage: 'awaiting_client_approval' as LeadStage,
                  status: 'closed_won_pending' as Lead['status'],
                  latestProposalStatus: 'approved' as const,
                }
            : l
        )
      );
      // Only activate the client when the manager explicitly activates (not on approval)
      if (activated && clientId) {
        setClientStatusInStore(clientId, 'active');
      }
      // Toast is handled by TopBar's SSE notification system — no duplicate toast here
    });

    socket.on('proposal:rejected', ({ leadId, clientName, reviewerName, rejectionComment }: { leadId: string; clientName: string; reviewerName: string; rejectionComment?: string }) => {
      const currentLeads = useStore.getState().leads;
      setLeads(
        currentLeads.map((l) =>
          l.id === leadId
            ? { ...l, latestProposalStatus: 'rejected' as const, latestRejectionComment: rejectionComment ?? null }
            : l
        )
      );
      // Toast is handled by TopBar's SSE notification system — no duplicate toast here
    });

    return () => {
      socket.off('proposal:approved');
      socket.off('proposal:rejected');
    };
  }, [setClientStatusInStore, setLeads]);

  // Reload pipeline when a lead is assigned/created/updated via socket
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onLeadRefresh = () => loadLeads();
    const onProposalRefresh = () => loadLeads();

    socket.on('lead:refresh', onLeadRefresh);
    // Also reload when any proposal event fires (sent / approved / rejected /
    // activated / review-email sent / etc.) so lead cards reflect the new
    // proposal status without a page reload, even if the targeted optimistic
    // listeners above miss the event.
    socket.on('proposal:refresh', onProposalRefresh);

    return () => {
      socket.off('lead:refresh', onLeadRefresh);
      socket.off('proposal:refresh', onProposalRefresh);
    };
  }, [loadLeads]);

  const [temperatureFilters, setTemperatureFilters] = useState<string[]>([]);
  const [industryFilters, setIndustryFilters] = useState<string[]>([]);
  const [locationFilters, setLocationFilters] = useState<string[]>([]);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [showClosedLost, setShowClosedLost] = useState(true);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const writeAgencyId = useWriteAgencyId(selectedLead?.subCompanyId);
  const [isFollowUpDialogOpen, setIsFollowUpDialogOpen] = useState(false);
  const [followUpRefreshKey, setFollowUpRefreshKey] = useState(0);
  const [isCreateTaskDialogOpen, setIsCreateTaskDialogOpen] = useState(false);
  const [isProposalDialogOpen, setIsProposalDialogOpen] = useState(false);
  const [isProposalDetailsOpen, setIsProposalDetailsOpen] = useState(false);
  const [isEmailDialogOpen, setIsEmailDialogOpen] = useState(false);
  const [emailingLead, setEmailingLead] = useState<Lead | null>(null);
  const [callingClient, setCallingClient] = useState<Client | null>(null);
  const [viewingProposalLead, setViewingProposalLead] = useState<Lead | null>(null);
  const [pendingProposalLead, setPendingProposalLead] = useState<{ leadId: string; subCompanyId: string; previousStage: LeadStage } | null>(null);
  const proposalWriteAgencyId = useWriteAgencyId(pendingProposalLead?.subCompanyId);
  const [proposalDialogInitialValues, setProposalDialogInitialValues] = useState<ProposalDialogInitialValues | undefined>(undefined);
  const [resetConfirmLeadId, setResetConfirmLeadId] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [isSubmittingProposal, setIsSubmittingProposal] = useState(false);
  const [reassignLead, setReassignLead] = useState<Lead | null>(null);
  const [isReassignDialogOpen, setIsReassignDialogOpen] = useState(false);

  const openReassignDialog = useCallback((lead: Lead) => {
    setReassignLead(lead);
    setIsReassignDialogOpen(true);
  }, []);

  // Views state
  const [savedViews, setSavedViews] = useState<FilterView[]>(() => {
    const stored = localStorage.getItem('pipelineViews');
    return stored ? JSON.parse(stored) : [];
  });
  const [currentViewId, setCurrentViewId] = useState<string | null>(null);
  const [isNewViewDialogOpen, setIsNewViewDialogOpen] = useState(false);
  const [newViewName, setNewViewName] = useState('');

  // Get stage labels and colors from pipelineStages
  const stageLabels = pipelineStages.reduce((acc, stage) => {
    acc[stage.id] = stage.label;
    return acc;
  }, {} as Record<string, string>);

  const stageColors = pipelineStages.reduce((acc, stage) => {
    acc[stage.id] = stage.color;
    return acc;
  }, {} as Record<string, string>);

  const stageOrder = pipelineStages.sort((a, b) => a.order - b.order).map(s => s.id);
  
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // Get unique industries, locations, and tags from clients that have leads for this user
  const myLeadClientIds = leads.filter(l => l.ownerId === effectiveUser.id).map(l => l.clientId);
  const myLeadClients = clients.filter(c => myLeadClientIds.includes(c.id));
  const industries = Array.from(new Set(myLeadClients.map(c => c.industry))).sort();
  const locations = Array.from(new Set(myLeadClients.map(c => c.location))).sort();
  const allTags = Array.from(new Set(myLeadClients.flatMap(c => c.tags))).sort();

  const toggleTemperatureFilter = (temp: string) => {
    setTemperatureFilters(prev => 
      prev.includes(temp) ? prev.filter(t => t !== temp) : [...prev, temp]
    );
  };

  const toggleIndustryFilter = (industry: string) => {
    setIndustryFilters(prev => 
      prev.includes(industry) ? prev.filter(i => i !== industry) : [...prev, industry]
    );
  };

  const toggleLocationFilter = (location: string) => {
    setLocationFilters(prev => 
      prev.includes(location) ? prev.filter(l => l !== location) : [...prev, location]
    );
  };

  const toggleTagFilter = (tag: string) => {
    setTagFilters(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const saveCurrentView = () => {
    if (!newViewName.trim()) {
      showToast({
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
        temperatureFilters,
        industryFilters,
        locationFilters,
        tagFilters,
      },
      createdAt: new Date(),
    };

    const updatedViews = [...savedViews, newView];
    setSavedViews(updatedViews);
    localStorage.setItem('pipelineViews', JSON.stringify(updatedViews));
    setCurrentViewId(newView.id);
    setIsNewViewDialogOpen(false);
    setNewViewName('');
    
    showToast({
      title: "View saved",
      description: `View "${newViewName}" has been saved successfully`,
    });
  };

  const applyView = (viewId: string) => {
    const view = savedViews.find(v => v.id === viewId);
    if (!view) return;

    setTemperatureFilters(view.filters.temperatureFilters || []);
    setIndustryFilters(view.filters.industryFilters || []);
    setLocationFilters(view.filters.locationFilters || []);
    setTagFilters(view.filters.tagFilters || []);
    setCurrentViewId(viewId);
    
    showToast({
      title: "View applied",
      description: `Filters from "${view.name}" have been applied`,
    });
  };

  const deleteView = (viewId: string) => {
    const view = savedViews.find(v => v.id === viewId);
    const updatedViews = savedViews.filter(v => v.id !== viewId);
    setSavedViews(updatedViews);
    localStorage.setItem('pipelineViews', JSON.stringify(updatedViews));
    
    if (currentViewId === viewId) {
      setCurrentViewId(null);
    }
    
    showToast({
      title: "View deleted",
      description: `View "${view?.name}" has been deleted`,
    });
  };

  const clearAllFilters = () => {
    setTemperatureFilters([]);
    setIndustryFilters([]);
    setLocationFilters([]);
    setTagFilters([]);
    setCurrentViewId(null);
  };
  
  const activeLead = activeId ? leads.find(l => l.id === activeId) : null;
  const activeClient = activeLead ? clients.find(c => c.id === activeLead.clientId) : null;
  
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };
  
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) {
      setActiveId(null);
      return;
    }

    const leadId = active.id as string;
    const newStage = over.id as LeadStage;
    const lead = leads.find(l => l.id === leadId);

    if (!lead) {
      setActiveId(null);
      return;
    }

    if (!canMoveLeadAsCurrentUser(lead)) {
      toast.error('Cannot move lead', {
        description: !canMovePipeline
          ? 'You do not have permission to move leads on the pipeline'
          : lead.ownerId !== effectiveUser.id
            ? `This lead is assigned to ${lead.ownerName}`
            : 'You do not have permission to move this lead',
      });
      setActiveId(null);
      return;
    }

    if (lead.stage !== newStage) {
      // Leads awaiting client approval cannot be manually moved
      if (lead.status === 'closed_won_pending') {
        toast.error('This lead is awaiting client approval and cannot be moved');
        setActiveId(null);
        return;
      }

      // Leads in proposal section cannot be manually moved
      if (lead.stage === 'proposal_sent') { setActiveId(null); return; }

      // Closed Won leads cannot be moved
      if (lead.stage === 'closed_won') {
        toast.error('Closed Won leads cannot be moved');
        setActiveId(null);
        return;
      }

      // Closed Won is only reachable via proposal approval — block manual drag
      if (newStage === 'closed_won') {
        toast.error('Leads can only move to Closed Won when a proposal is approved by a manager');
        setActiveId(null);
        return;
      }

      // Closed Lost cannot be set via drag — must be done through the lead actions
      if (newStage === 'closed_lost') {
        toast.error('Leads cannot be manually moved to Closed Lost');
        setActiveId(null);
        return;
      }

      if (newStage === STAGE_NO_MANUAL_DROP_AWAITING_CLIENT) {
        toast.error('Awaiting Client Approval is only set when a proposal is approved');
        setActiveId(null);
        return;
      }

      // Dragging to proposal_sent opens the proposal dialog — API call happens on submit
      if (newStage === 'proposal_sent') {
        if (!canWriteProposals) {
          toast.error('You do not have permission to create proposals');
          setActiveId(null);
          return;
        }
        updateLead(leadId, { stage: newStage }); // optimistic
        setPendingProposalLead({ leadId, subCompanyId: lead.subCompanyId, previousStage: lead.stage });
        setIsProposalDialogOpen(true);
        setActiveId(null);
        return;
      }

      // All other stages: optimistic update then persist to DB
      const previousStage = lead.stage;
      const previousStatus = lead.status;
      const previousClientStatus = clients.find((client) => client.id === lead.clientId)?.status;
      updateLead(leadId, { stage: newStage });
      try {
        await updateLeadApi(leadId, { stage: newStage });
        toast.success('Lead updated', { description: `Moved to ${stageLabels[newStage] || newStage}` });
      } catch {
        toast.error('Failed to update lead stage');
        updateLead(leadId, { stage: previousStage, status: previousStatus });
        if (previousClientStatus) {
          setClientStatusInStore(lead.clientId, previousClientStatus);
        }
      }
    }

    setActiveId(null);
  };

  const handleProposalSave = async (data: {
    locationType: 'single' | 'multiple';
    selectedClients: string[];
    agreementTypes: AgreementType[];
    tempPricing?: AgreementPricing;
    directPricing?: AgreementPricing;
    paymentTerms: PaymentTerms;
    comment: string;
    clientMessage: string;
    isForReview: boolean;
    reviewTemplateId?: string;
    attachments: ProposalAttachment[];
    attachmentFiles?: File[];
    selectedDefaultFileIds: string[];
    selectedContactId?: string;
    pandaDocTemplateId?: string;
    pandaDocTemplateName?: string;
    positions: { name: string; count: number }[];
  }) => {
    if (!pendingProposalLead) return;

    const leadId = pendingProposalLead.leadId;
    const previousStage = pendingProposalLead.previousStage;
    setIsSubmittingProposal(true);

    try {
      // Upload any attachment files to R2 before submitting, replacing the ephemeral blob URLs
      const uploadedAttachments = data.attachmentFiles?.length
        ? await Promise.all(
            data.attachmentFiles.map(async (file, i) => {
              const { fileKey } = await uploadProposalAttachment(file);
              const meta = data.attachments[i];
              return { id: meta?.id ?? '', name: meta?.name ?? file.name, size: meta?.size ?? file.size, type: meta?.type ?? file.type, url: fileKey };
            })
          )
        : [];

      await submitProposal({
        leadId,
        locationType: data.locationType,
        agreementTypes: data.agreementTypes,
        tempPricingType: data.tempPricing?.pricingType,
        tempPricingValue: data.tempPricing?.pricingValue,
        tempMinimumHours: data.tempPricing?.minimumHours,
        directPricingType: data.directPricing?.pricingType,
        directPricingValue: data.directPricing?.pricingValue,
        paymentTerms: data.paymentTerms,
        comment: data.comment || undefined,
        clientMessage: data.clientMessage || undefined,
        isForReview: data.isForReview,
        reviewTemplateId: data.reviewTemplateId,
        attachments: uploadedAttachments,
        selectedDefaultFileIds: data.selectedDefaultFileIds ?? [],
        selectedContactId: data.selectedContactId,
        pandaDocTemplateId: data.pandaDocTemplateId,
        pandaDocTemplateName: data.pandaDocTemplateName,
        positions: data.positions ?? [],
      });

      // Update local state: stage is now proposal_sent, proposal is pending
      updateLead(leadId, {
        stage: 'proposal_sent',
        latestProposalStatus: 'pending',
      });
    } catch (err: any) {
      // Revert optimistic stage update
      updateLead(leadId, { stage: previousStage });
      if (err?.message?.includes('pending proposal already exists')) {
        toast.error('A proposal is already pending for this lead.');
      } else {
        toast.error('Failed to submit proposal.');
      }
    } finally {
      setIsSubmittingProposal(false);
      setPendingProposalLead(null);
    }
  };

  const handleProposalCancel = () => {
    if (pendingProposalLead) {
      updateLead(pendingProposalLead.leadId, { stage: pendingProposalLead.previousStage });
    }
    setPendingProposalLead(null);
  };

  const handleResetLead = async () => {
    if (!resetConfirmLeadId) return;
    setIsResetting(true);
    try {
      await resetLeadAfterRejection(resetConfirmLeadId);
      updateLead(resetConfirmLeadId, {
        stage: 'new_lead',
        status: 'open',
        latestProposalStatus: null,
        latestRejectionComment: null,
      });
      toast.success('Lead reset to New Lead stage.');
    } catch {
      toast.error('Failed to reset lead.');
    } finally {
      setIsResetting(false);
      setResetConfirmLeadId(null);
    }
  };
  
  const handleResubmitReviewClick = async (lead: Lead, previousStage: LeadStage) => {
    setPendingProposalLead({ leadId: lead.id, subCompanyId: lead.subCompanyId, previousStage });
    setIsProposalDialogOpen(true);

    if (lead.latestProposalId) {
      const proposal = await fetchProposalById(lead.latestProposalId);
      if (proposal) {
        setProposalDialogInitialValues({
          agreementTypes: proposal.agreementTypes as import('@/lib/types').AgreementType[],
          paymentTerms: proposal.paymentTerms as import('@/lib/types').PaymentTerms,
          tempPricingType: (proposal.tempPricingType ?? 'markup') as import('@/lib/types').PricingType,
          tempPricingValue: proposal.tempPricingValue?.toString() ?? '',
          tempMinimumHours: proposal.tempMinimumHours?.toString() ?? '480',
          directPricingType: (proposal.directPricingType ?? 'markup') as import('@/lib/types').PricingType,
          directPricingValue: proposal.directPricingValue?.toString() ?? '',
          comment: proposal.comment ?? '',
          clientMessage: proposal.clientMessage ?? '',
          selectedContactId: proposal.selectedContactId ?? undefined,
          selectedDefaultFileIds: proposal.selectedDefaultFiles
            .map((f) => f.defaultFileId)
            .filter((id): id is string => !!id),
          positions: proposal.positions.map((p) => ({ name: p.name, count: p.count })),
        });
      }
    }
  };

  const myLeads = leads.filter(l => {
    const client = clients.find(c => c.id === l.clientId);
    if (!client) return false;

    if (!showClosedLost && (l.status === 'closed_lost' || l.stage === 'closed_lost')) return false;
    if (!leadMatchesDateRange(l, dateRange)) return false;

    const matchesOwner = true;

    const matchesTemperature = temperatureFilters.length === 0 || temperatureFilters.includes(l.temperature);
    const matchesIndustry = industryFilters.length === 0 || industryFilters.includes(client.industry);
    const matchesLocation = locationFilters.length === 0 || locationFilters.includes(client.location);
    const matchesTags = tagFilters.length === 0 || tagFilters.some(tag => client.tags.includes(tag));

    return matchesOwner && matchesTemperature && matchesIndustry && matchesLocation && matchesTags;
  });
  
  if (leadsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Active (won) leads — scoped by role then filtered by search + owner
  const allActiveLeads = leads.filter(l => {
    if (l.status !== 'closed_won') return false;
    if (!canSeeTeamLeads) return l.ownerId === effectiveUser.id;
    return true;
  });
  const activeLeadOwners = Array.from(
    new Map(allActiveLeads.map(l => [l.ownerId, l.ownerName])).entries()
  ).map(([id, name]) => ({ id, name }));
  const activeLeads = allActiveLeads.filter(l => {
    const client = clients.find(c => c.id === l.clientId);
    const clientName = client?.name ?? l.clientName ?? '';
    if (activeSearch && !clientName.toLowerCase().includes(activeSearch.toLowerCase())) return false;
    if (activeOwnerFilter !== 'all' && l.ownerId !== activeOwnerFilter) return false;
    if (!leadMatchesDateRange(l, dateRange)) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pt-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Pipeline</h1>
          <p className="text-muted-foreground mt-1 flex items-center gap-2">
            {myLeads.length} lead{myLeads.length !== 1 ? 's' : ''}
            {isDateFilterActive && <span className="text-xs">(filtered)</span>}
            {isRefetching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          </p>
        </div>
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

      {/* ── Manager / Team Sectioned View ────────────────────────────────────── */}
      {showAllTeamView && (
        managerTeamUsers.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-12">
            {showManagerSections ? 'No managers / team in this agency' : 'No team members in this scope'}
          </p>
        ) : (
          <div className="space-y-5">
            {managerTeamUsers.map((user) => (
              <UserPipelineSection
                key={user.id}
                user={user}
                onViewBoard={() =>
                  showManagerSections ? setSelectedManagerId(user.id) : setSelectedUserId(user.id)
                }
                onProposalClick={(lead) => { setViewingProposalLead(lead); setIsProposalDetailsOpen(true); }}
                onNewProposalClick={(lead, previousStage) => { setPendingProposalLead({ leadId: lead.id, subCompanyId: lead.subCompanyId, previousStage }); setProposalDialogInitialValues(undefined); setIsProposalDialogOpen(true); }}
                onResubmitReviewClick={handleResubmitReviewClick}
                onEmailClick={(lead) => { setEmailingLead(lead); setIsEmailDialogOpen(true); }}
                onCallClick={(lead) => { const client = clients.find(c => c.id === lead.clientId); if (client) { setCallingClient(client); openCallInterface(client); } }}
                onResetLeadClick={(leadId) => setResetConfirmLeadId(leadId)}
                onReassignClick={canReassignLead ? openReassignDialog : undefined}
                canDragLead={canMoveLeadAsCurrentUser}
                canWriteProposals={canWriteProposals}
                dateRange={dateRange}
              />
            ))}
          </div>
        )
      )}

      {!showAgencySections && !showAllTeamView && <div className="flex items-center gap-2 flex-wrap">
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

        {(temperatureFilters.length > 0 || industryFilters.length > 0 || locationFilters.length > 0 || tagFilters.length > 0) && (
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
                  <Label htmlFor="view-name-pipeline">View Name</Label>
                  <Input
                    id="view-name-pipeline"
                    placeholder="e.g., Hot Tech Leads"
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

        {(temperatureFilters.length > 0 || industryFilters.length > 0 || locationFilters.length > 0 || tagFilters.length > 0) && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters}>
            Clear All Filters
          </Button>
        )}
      </div>}

      {!showAgencySections && !showAllTeamView && <div className="flex gap-2 flex-wrap items-center">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="show-closed-lost"
            checked={showClosedLost}
            onCheckedChange={(checked) => setShowClosedLost(checked === true)}
          />
          <label htmlFor="show-closed-lost" className="text-sm cursor-pointer">
            Show Lost Leads
          </label>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2">
              <Filter className="h-4 w-4" />
              Temperature
              {temperatureFilters.length > 0 && (
                <Badge variant="secondary" className="ml-1">
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
                    id={`temp-pipeline-${temp}`}
                    checked={temperatureFilters.includes(temp)}
                    onCheckedChange={() => toggleTemperatureFilter(temp)}
                  />
                  <label
                    htmlFor={`temp-pipeline-${temp}`}
                    className="text-sm capitalize cursor-pointer flex-1"
                  >
                    {temp}
                  </label>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2">
              <Filter className="h-4 w-4" />
              Industry
              {industryFilters.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {industryFilters.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-3 bg-popover" align="start">
            <div className="space-y-2">
              <h4 className="font-medium text-sm mb-2">Filter by Industry</h4>
              {industries.map((industry) => (
                <div key={industry} className="flex items-center space-x-2">
                  <Checkbox
                    id={`industry-pipeline-${industry}`}
                    checked={industryFilters.includes(industry)}
                    onCheckedChange={() => toggleIndustryFilter(industry)}
                  />
                  <label
                    htmlFor={`industry-pipeline-${industry}`}
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
            <Button variant="outline" className="gap-2">
              <Filter className="h-4 w-4" />
              Location
              {locationFilters.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {locationFilters.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-3 bg-popover" align="start">
            <div className="space-y-2">
              <h4 className="font-medium text-sm mb-2">Filter by Location</h4>
              {locations.map((location) => (
                <div key={location} className="flex items-center space-x-2">
                  <Checkbox
                    id={`location-pipeline-${location}`}
                    checked={locationFilters.includes(location)}
                    onCheckedChange={() => toggleLocationFilter(location)}
                  />
                  <label
                    htmlFor={`location-pipeline-${location}`}
                    className="text-sm cursor-pointer flex-1"
                  >
                    {location}
                  </label>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2">
              <Filter className="h-4 w-4" />
              Tags
              {tagFilters.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {tagFilters.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-3 bg-popover" align="start">
            <div className="space-y-2">
              <h4 className="font-medium text-sm mb-2">Filter by Tags</h4>
              {allTags.map((tag) => (
                <div key={tag} className="flex items-center space-x-2">
                  <Checkbox
                    id={`tag-pipeline-${tag}`}
                    checked={tagFilters.includes(tag)}
                    onCheckedChange={() => toggleTagFilter(tag)}
                  />
                  <label
                    htmlFor={`tag-pipeline-${tag}`}
                    className="text-sm cursor-pointer flex-1"
                  >
                    {tag}
                  </label>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>}

      {/* ── All-Agencies Sectioned View ──────────────────────────────────────── */}
      {showAgencySections && (
        agenciesLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-3 text-muted-foreground">Loading agencies...</span>
          </div>
        ) : agencies.length === 0 ? (
          <Card className="border-border/40">
            <CardContent className="flex items-center justify-center py-12">
              <p className="text-muted-foreground text-sm">No agencies found</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-5">
            {agencies.map((agency) => (
              <AgencyPipelineSection
                key={agency.id}
                agency={agency}
                onViewBoard={() => setSelectedAgencyId(agency.id)}
                onProposalClick={(lead) => { setViewingProposalLead(lead); setIsProposalDetailsOpen(true); }}
                onNewProposalClick={(lead, previousStage) => { setPendingProposalLead({ leadId: lead.id, subCompanyId: lead.subCompanyId, previousStage }); setProposalDialogInitialValues(undefined); setIsProposalDialogOpen(true); }}
                onResubmitReviewClick={handleResubmitReviewClick}
                onEmailClick={(lead) => { setEmailingLead(lead); setIsEmailDialogOpen(true); }}
                onCallClick={(lead) => { const client = clients.find(c => c.id === lead.clientId); if (client) { setCallingClient(client); openCallInterface(client); } }}
                onResetLeadClick={(leadId) => setResetConfirmLeadId(leadId)}
                onReassignClick={canReassignLead ? openReassignDialog : undefined}
                canDragLead={canMoveLeadAsCurrentUser}
                canWriteProposals={canWriteProposals}
                dateRange={dateRange}
                ownerIds={elevatedOwnerIds}
                scopeKey={`${scopeKey}|${elevatedOwnerIds?.join(',') ?? ''}`}
              />
            ))}
          </div>
        )
      )}

      {/* ── Single-Agency / Own Kanban Board ─────────────────────────────────── */}
      {!showAgencySections && !showAllTeamView && (
      <div className="overflow-x-auto pb-4">
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 min-w-max items-stretch" style={{ height: 'calc(100vh - 260px)' }}>
            {stageOrder.map(stage => (
              <DroppableColumn
                key={stage}
                stage={stage}
                leads={myLeads}
                clients={clients}
                stageLabel={stageLabels[stage] || stage}
                stageColor={stageColors[stage] || '#6b7280'}
                canDragLead={canMoveLeadAsCurrentUser}
                isOwnLead={(l) => l.ownerId === effectiveUser.id}
                canWriteProposals={canWriteProposals}
                onViewLead={(lead) => setSelectedLead(lead)}
                onAddFollowUp={(lead) => {
                  setSelectedLead(lead);
                  setIsFollowUpDialogOpen(true);
                }}
                onProposalClick={(lead) => {
                  setViewingProposalLead(lead);
                  setIsProposalDetailsOpen(true);
                }}
                onEmailClick={(lead) => {
                  setEmailingLead(lead);
                  setIsEmailDialogOpen(true);
                }}
                onCallClick={(lead) => {
                  const client = clients.find(c => c.id === lead.clientId);
                  if (client) {
                    setCallingClient(client);
                    openCallInterface(client);
                  }
                }}
                onNewProposalClick={(lead) => {
                  setPendingProposalLead({ leadId: lead.id, subCompanyId: lead.subCompanyId, previousStage: lead.stage });
                  setProposalDialogInitialValues(undefined);
                  setIsProposalDialogOpen(true);
                }}
                onResubmitReviewClick={(lead) => handleResubmitReviewClick(lead, lead.stage)}
                onResetLeadClick={(leadId) => setResetConfirmLeadId(leadId)}
                onReassignClick={canReassignLead ? openReassignDialog : undefined}
              />
            ))}
          </div>
          <DragOverlay>
            {activeLead ? (
              <Card className="cursor-grabbing opacity-90 rotate-3">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <span className="font-medium text-sm">{activeClient?.name || 'Unknown'}</span>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
      )}

      <ClientDetailsSheet
        open={!!selectedLead}
        onOpenChange={(open) => !open && setSelectedLead(null)}
        client={selectedLead ? clients.find(c => c.id === selectedLead.clientId) || null : null}
        subCompanyId={writeAgencyId}
        followUpRefreshKey={followUpRefreshKey}
        showActions={true}
        onCallClick={() => {
          if (selectedLead) {
            const client = clients.find(c => c.id === selectedLead.clientId);
            if (client) {
              setCallingClient(client);
              openCallInterface(client);
            }
          }
        }}
        onEmailClick={() => {
          if (selectedLead) {
            setEmailingLead(selectedLead);
            setIsEmailDialogOpen(true);
          }
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
        clientName={selectedLead ? clients.find(c => c.id === selectedLead.clientId)?.name || '' : ''}
        leadId={selectedLead?.id}
        subCompanyId={writeAgencyId}
        client={selectedLead ? clients.find(c => c.id === selectedLead.clientId) : undefined}
        onFollowUpCreated={() => setFollowUpRefreshKey((k) => k + 1)}
      />

      <CreateTaskDialog
        open={isCreateTaskDialogOpen}
        onOpenChange={setIsCreateTaskDialogOpen}
        subCompanyId={writeAgencyId}
        defaultLinkType="lead"
        defaultLinkId={selectedLead?.id}
      />

      <ProposalDialog
        open={isProposalDialogOpen}
        onOpenChange={(v) => { setIsProposalDialogOpen(v); if (!v) setProposalDialogInitialValues(undefined); }}
        leadSubCompanyId={proposalWriteAgencyId ?? pendingProposalLead?.subCompanyId}
        onSave={handleProposalSave}
        onCancel={() => { handleProposalCancel(); setProposalDialogInitialValues(undefined); }}
        clients={clients}
        currentClientId={pendingProposalLead ? leads.find(l => l.id === pendingProposalLead.leadId)?.clientId || '' : ''}
        isSubmitting={isSubmittingProposal}
        initialValues={proposalDialogInitialValues}
      />

      <ProposalDetailsDialog
        open={isProposalDetailsOpen}
        onOpenChange={setIsProposalDetailsOpen}
        lead={viewingProposalLead}
        client={viewingProposalLead ? clients.find(c => c.id === viewingProposalLead.clientId) || null : null}
        clients={clients}
      />

      <EmailComposeDialog
        open={isEmailDialogOpen}
        onOpenChange={setIsEmailDialogOpen}
        defaultClientId={emailingLead?.clientId}
        selectedAgencyId={selectedAgencyId}
      />

      {/* Call Interface */}
      {(callingClient || activeCall?.client) && (isCallInterfaceOpen && !isMinimized) && (
        <CallInterface
          client={callingClient || activeCall!.client}
          open={isCallInterfaceOpen && !isMinimized}
          onOpenChange={(open) => {
            if (!open) setCallingClient(null);
          }}
        />
      )}

      {/* Reset Lead Confirmation Dialog */}
      <ReassignLeadDialog
        open={isReassignDialogOpen}
        onOpenChange={(open) => {
          setIsReassignDialogOpen(open);
          if (!open) setReassignLead(null);
        }}
        lead={reassignLead}
        onSuccess={() => {
          setReassignLead(null);
          void loadLeads();
        }}
      />

      <AlertDialog open={!!resetConfirmLeadId} onOpenChange={(open) => !open && setResetConfirmLeadId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Lead to New Lead?</AlertDialogTitle>
          </AlertDialogHeader>
          <p className="text-sm text-muted-foreground px-1">
            This will move the lead back to the <strong>New Lead</strong> stage and clear the rejected proposal status. You can then resubmit a new proposal.
          </p>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setResetConfirmLeadId(null)} disabled={isResetting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleResetLead} disabled={isResetting}>
              {isResetting ? 'Resetting...' : 'Reset Lead'}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
