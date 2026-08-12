import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '@/lib/store';
import { CrmAttachmentList } from '@/components/CrmAttachmentList';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import {
  FileText,
  Eye,
  CheckCircle,
  XCircle,
  Search,
  Building2,
  MapPin,
  Calendar,
  User,
  File,
  Download,
  Upload,
  Loader2,
  History,
  Trophy,
  Zap,
  Send,
  Inbox,
  FileSignature,
  PenLine,
  Mail,
  AlertTriangle,
  BookOpen,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  TrendingUp,
} from 'lucide-react';
import { cn, sanitizeRichHtml } from '@/lib/utils';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { fetchProposals, approveProposal, rejectProposal, activateProposal, approveAndActivateProposal, uploadProposalDocument, replaceProposalDocument, requestProposalReview, rejectProposalReview, previewProposalEmail, pandaDocAgreementPreview, pandaDocSyncDocument, getDefaultFilePreviewUrl, getProposalDocPreviewUrl, fetchReviewPdfBlob, fetchSentReviewPdfBlob, fetchAccessibleAgencies, fetchUsers, approveForReview, downloadProposalAttachment, fetchProposalAttachmentBlob, fetchProposalExtensionRequests, submitAwaitingClientDecision, type AgreementPreviewResult, type ApiUser } from '@/lib/api';
import { ProposalChainActions } from '@/components/ProposalChainActions';
import { ProposalMakeActiveButton } from '@/components/ProposalMakeActiveButton';
import { useClientPagination, SectionPaginationBar } from '@/components/SectionPagination';
import { ApprovalQueueActions } from '@/components/ApprovalQueueActions';
import { SendAgreementDialog } from '@/components/SendAgreementDialog';
import { getUserRoleTitle } from '@/lib/roleLabels';
import { ScopeFilterBar } from '@/components/ScopeFilterBar';
import { PersonCardIdentity } from '@/components/PersonSectionHeader';
import { PairSigningStatusSection } from '@/components/proposals/PairSigningStatusSection';
import { AwaitingClientSummary } from '@/components/proposals/AwaitingClientSummary';
import { AgreementTypeChips } from '@/components/proposals/AgreementTypeChips';
import { StickyHeader } from '@/components/StickyHeader';
import { useScopeFilter } from '@/hooks/useElevatedScopeFilter';
import { resolveOwnerIds } from '@/lib/ownerScope';
import { resolveLinkedAwareOwnerIds } from '@/lib/linkedAwareOwnerIds';
import { ownerExactFlag } from '@/lib/ownerExactFlag';
import { useActAs } from '@/hooks/useActAs';
import { useWriteAgencyId } from '@/hooks/useWriteAgencyId';
import { DateRangeFilterRow } from '@/components/DateRangeFilterRow';
import { useDateRangeFilter } from '@/hooks/useDateRangeFilter';
import { proposalMatchesDateRange } from '@/lib/dateRangeFilter';
import { useCanReviewProposals, useCanWriteProposals, useIsOwnScope } from '@/lib/access';

interface ProposalDocRecord {
  id: string;
  category: 'sent_to_client' | 'received_from_client' | 'generated_for_review';
  name: string;
  size: string;
  type: string;
  url: string;
  createdAt: string;
  uploadedBy: { id: string; firstName: string; lastName: string };
  /** Present on Both-pair list rows — which sibling agreement this file belongs to. */
  agreementLabel?: string | null;
  // sent_to_client metadata (nullable for backward compat)
  contactId?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  sentAt?: string | null;
  deliveryStatus?: string | null;
}

interface ProposalRecord {
  id: string;
  status: string;
  locationType: string;
  agreementTypes: string[];
  tempPricingType?: string | null;
  tempPricingValue?: number | null;
  directPricingType?: string | null;
  directPricingValue?: number | null;
  paymentTerms: string;
  comment?: string | null;
  clientMessage?: string | null;
  rejectionComment?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
  activatedAt?: string | null;
  activatedById?: string | null;
  reviewRequestedAt?: string | null;
  reviewRejectedAt?: string | null;
  reviewRejectionComment?: string | null;
  isForReview?: boolean;
  reviewEmailSentAt?: string | null;
  lead: {
    id: string;
    ownerId: string;
    subCompanyId: string;
    status: string;
    client: { id: string; name: string };
    owner: { id: string; firstName: string; lastName: string; email: string };
  };
  attachments: { id: string; name: string; size: string; type: string; url: string }[];
  positions: { id: string; name: string; count: number }[];
  selectedDefaultFiles: { id: string; name: string; fileUrl: string; mimeType: string | null }[];
  proposalDocuments: ProposalDocRecord[];
  reviewedBy?: { id: string; firstName: string; lastName: string } | null;
  activatedBy?: { id: string; firstName: string; lastName: string } | null;
  reviewRequestedBy?: { id: string; firstName: string; lastName: string } | null;
  reviewRejectedBy?: { id: string; firstName: string; lastName: string } | null;
  pandaDocId?: string | null;
  pandaDocStatus?: string | null;
  pandaDocTemplateId?: string | null;
  pandaDocTemplateName?: string | null;
  selectedContactId?: string | null;
  selectedContact?: { id: string; name: string; email: string; title?: string | null } | null;
  awaitingClientDueAt?: string | null;
  awaitingClientReason?: string | null;
  requiresAwaitingClientAction?: boolean;
  latestExtensionRequest?: {
    id: string;
    status: 'pending' | 'approved' | 'rejected';
    reason: string;
    requestedDays: number;
    reviewComment?: string | null;
    createdAt: string;
  } | null;
  proposalPairId?: string | null;
  pairRole?: string | null;
  siblingId?: string | null;
  pair?: {
    pairId: string;
    members: Array<{
      id: string;
      pairRole: string | null;
      agreementTypes: string[];
      status: string;
      pandaDocStatus: string | null;
      pandaDocId: string | null;
      reviewEmailSentAt: string | null;
      activatedAt: string | null;
      label: string;
    }>;
  } | null;
}

interface ProposalExtensionRequestRecord {
  id: string;
  reason: string;
  requestedDays: number;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  reviewedAt?: string | null;
  reviewComment?: string | null;
  proposal: {
    id: string;
    lead: { client: { name: string } };
  };
  requestedBy: { id?: string | null; firstName?: string | null; lastName?: string | null; email?: string | null };
  reviewedBy?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
}


// ─── Module-level helpers ─────────────────────────────────────────────────
const getPaymentTermsLabel = (terms: string) => terms.replace('net_', 'Net ');
const getAgreementTypeLabel = (type: string) =>
  type === 'temp' ? 'Temp / Temp to Permanent' : 'Direct Placement';

/** Prefer pair member labels when Both was split into Temp + Direct rows. */
function getProposalAgreementLabels(p: Pick<ProposalRecord, 'agreementTypes' | 'pair'>): string[] {
  if (p.pair?.members?.length) {
    return p.pair.members.map((m) =>
      m.pairRole === 'direct' || m.agreementTypes.some((t) => t.startsWith('direct'))
        ? getAgreementTypeLabel('direct_placement')
        : getAgreementTypeLabel('temp'),
    );
  }
  return p.agreementTypes.map(getAgreementTypeLabel);
}

function getReviewPreviewMembers(
  p: Pick<ProposalRecord, 'id' | 'agreementTypes' | 'reviewEmailSentAt' | 'pair'>,
): Array<{ id: string; label: string; reviewEmailSentAt: string | null }> {
  if (p.pair?.members?.length) {
    return p.pair.members.map((m) => ({
      id: m.id,
      label: m.label || (m.pairRole === 'direct' ? 'Direct Placement' : 'Temporary Staffing'),
      reviewEmailSentAt: m.reviewEmailSentAt,
    }));
  }
  return [{
    id: p.id,
    label: p.agreementTypes.map(getAgreementTypeLabel).join(' + ') || 'Agreement Template',
    reviewEmailSentAt: p.reviewEmailSentAt ?? null,
  }];
}

/** PandaDoc (normal) preview rows — Both pairs get one row per sibling. */
function getPandaDocPreviewMembers(
  p: Pick<ProposalRecord, 'id' | 'agreementTypes' | 'pandaDocTemplateId' | 'pair'>,
): Array<{ id: string; label: string }> {
  if (p.pair?.members?.length) {
    return p.pair.members.map((m) => ({
      id: m.id,
      label: m.label || (m.pairRole === 'direct' ? 'Direct Placement' : 'Temporary Staffing'),
    }));
  }
  if (!p.pandaDocTemplateId) return [];
  return [{
    id: p.id,
    label: p.agreementTypes.map(getAgreementTypeLabel).join(' + ') || 'Agreement Template',
  }];
}

/** Awaiting-client / CWP: one signing row per Both sibling (or single row). */
function getPairSigningMembers(
  p: Pick<ProposalRecord, 'id' | 'agreementTypes' | 'pandaDocStatus' | 'pandaDocId' | 'pandaDocTemplateId' | 'pair'>,
): Array<{
  id: string;
  label: string;
  shortLabel: string;
  pandaDocStatus: string | null;
  pandaDocId: string | null;
}> {
  if (p.pair?.members?.length) {
    return p.pair.members.map((m) => {
      const isDirect = m.pairRole === 'direct' || m.agreementTypes.some((t) => t.startsWith('direct'));
      return {
        id: m.id,
        label: m.label || (isDirect ? 'Direct Placement' : 'Temporary Staffing'),
        shortLabel: isDirect ? 'Direct' : 'Temp',
        pandaDocStatus: m.pandaDocStatus,
        pandaDocId: m.pandaDocId,
      };
    });
  }
  return [{
    id: p.id,
    label: p.agreementTypes.map(getAgreementTypeLabel).join(' + ') || 'Agreement',
    shortLabel: '',
    pandaDocStatus: p.pandaDocStatus ?? null,
    pandaDocId: p.pandaDocId ?? null,
  }];
}

/** FE safety net: collapse Both siblings if API still returns both rows. */
function collapseProposalRows(rows: ProposalRecord[]): ProposalRecord[] {
  const seen = new Set<string>();
  const out: ProposalRecord[] = [];
  for (const p of rows) {
    const pairId = p.proposalPairId ?? p.pair?.pairId ?? null;
    if (!pairId) {
      out.push(p);
      continue;
    }
    if (seen.has(pairId)) continue;
    seen.add(pairId);

    if (p.pair?.members?.length) {
      out.push(p);
      continue;
    }

    const siblings = rows.filter((r) => (r.proposalPairId ?? r.pair?.pairId) === pairId);
    const temp = siblings.find((r) => r.pairRole === 'temp' || r.agreementTypes.includes('temp')) ?? siblings[0];
    const direct = siblings.find((r) => r.pairRole === 'direct' || r.agreementTypes.some((t) => t.startsWith('direct')));
    const members = [temp, direct].filter(Boolean) as ProposalRecord[];
    out.push({
      ...temp,
      pair: {
        pairId,
        members: members.map((m) => ({
          id: m.id,
          pairRole: m.pairRole ?? null,
          agreementTypes: m.agreementTypes,
          status: m.status,
          pandaDocStatus: m.pandaDocStatus ?? null,
          pandaDocId: m.pandaDocId ?? null,
          reviewEmailSentAt: m.reviewEmailSentAt ?? null,
          activatedAt: m.activatedAt ?? null,
          label: m.pairRole === 'direct' || m.agreementTypes.some((t) => t.startsWith('direct'))
            ? 'Direct Placement'
            : 'Temporary Staffing',
        })),
      },
      siblingId: direct?.id ?? null,
    });
  }
  return out;
}
const isReviewSubmitted = (p: Pick<ProposalRecord, 'reviewRequestedAt' | 'reviewRejectedAt'>) => {
  const wasRejected = p.reviewRejectedAt && p.reviewRequestedAt &&
    new Date(p.reviewRejectedAt).getTime() >= new Date(p.reviewRequestedAt).getTime();
  return !!p.reviewRequestedAt && !wasRejected;
};
// Ready for activation = signed via PandaDoc OR associate manually submitted for review.
// Both pairs: either sibling signed unlocks Make Active.
const isReadyForActivation = (
  p: Pick<ProposalRecord, 'reviewRequestedAt' | 'reviewRejectedAt' | 'pandaDocStatus' | 'pair'>,
) => {
  if (p.pair?.members?.length) {
    return p.pair.members.some((m) => m.pandaDocStatus === 'document.completed')
      || p.pandaDocStatus === 'document.completed'
      || isReviewSubmitted(p);
  }
  return p.pandaDocStatus === 'document.completed' || isReviewSubmitted(p);
};

function isLeadAwaitingTimerTerminated(status: string): boolean {
  return status === 'closed_won' || status === 'closed_lost';
}

function isProposalAwaitingClientResponsePhase(lead: { stage: string; status: string }): boolean {
  return lead.status === 'closed_won_pending' && lead.stage === 'awaiting_client_approval';
}

const shouldOpenExpiredAwaitingDecision = (
  p: Pick<ProposalRecord, 'requiresAwaitingClientAction' | 'awaitingClientDueAt' | 'latestExtensionRequest' | 'lead'>
) => {
  if (isLeadAwaitingTimerTerminated(p.lead.status)) return false;
  if (p.requiresAwaitingClientAction) return true;
  if (!isProposalAwaitingClientResponsePhase(p.lead) || !p.awaitingClientDueAt) return false;
  const dueExpired = new Date(p.awaitingClientDueAt).getTime() <= Date.now();
  if (!dueExpired) return false;
  return p.latestExtensionRequest?.status !== 'pending';
};

/** Expired UI for awaiting-client timer only while lead is still in that phase. */
const awaitingClientTimerShowsExpired = (p: Pick<ProposalRecord, 'awaitingClientDueAt' | 'lead'>) =>
  !isLeadAwaitingTimerTerminated(p.lead.status) &&
  isProposalAwaitingClientResponsePhase(p.lead) &&
  !!p.awaitingClientDueAt &&
  new Date(p.awaitingClientDueAt).getTime() <= Date.now();

const getStatusBadge = (status: string) => {
  if (status === 'approved') return <Badge className="bg-green-100 text-green-800 hover:bg-green-100"><CheckCircle className="h-3 w-3 mr-1" />Approved</Badge>;
  if (status === 'rejected') return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
};

// ─── Palette ──────────────────────────────────────────────────────────────
const AGENCY_PALETTE = [
  { bg: 'bg-blue-500/10',    border: 'border-blue-500/20',    text: 'text-blue-600',    accent: 'bg-blue-500'    },
  { bg: 'bg-purple-500/10',  border: 'border-purple-500/20',  text: 'text-purple-600',  accent: 'bg-purple-500'  },
  { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-600', accent: 'bg-emerald-500' },
  { bg: 'bg-orange-500/10',  border: 'border-orange-500/20',  text: 'text-orange-600',  accent: 'bg-orange-500'  },
  { bg: 'bg-cyan-500/10',    border: 'border-cyan-500/20',    text: 'text-cyan-600',    accent: 'bg-cyan-500'    },
  { bg: 'bg-rose-500/10',    border: 'border-rose-500/20',    text: 'text-rose-600',    accent: 'bg-rose-500'    },
];

// ─── Per-agency full proposals section ────────────────────────────────────
function AgencyProposalSection({
  agency,
  onViewAgency,
  onViewDetails,
  onViewCwp,
  onMakeActive,
  dateRange,
  ownerIds,
  scopeKey,
}: {
  agency: { id: string; name: string };
  onViewAgency: () => void;
  onViewDetails: (p: ProposalRecord) => void;
  onViewCwp: (p: ProposalRecord) => void;
  onMakeActive: (p: ProposalRecord) => void;
  dateRange: { from: Date; to: Date } | null;
  ownerIds?: string[];
  scopeKey: string;
}) {
  const [tab, setTab] = useState('pending');
  const [pendingSearch, setPendingSearch] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [cwpSearch, setCwpSearch] = useState('');
  const [paSearch, setPaSearch] = useState('');
  const [isActing, setIsActing] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectingProposal, setRejectingProposal] = useState<ProposalRecord | null>(null);

  const { data: pendingData, isLoading: pendingLoading, refetch: refetchPending } = useQuery({
    queryKey: ['agency-proposals-pending', agency.id, scopeKey],
    queryFn: () => fetchProposals({ status: 'pending', ownerIds, subCompanyId: agency.id, limit: 100 }),
    staleTime: 0,
  });

  const { data: approvedData, isLoading: approvedLoading, refetch: refetchApproved } = useQuery({
    queryKey: ['agency-proposals-approved', agency.id, scopeKey],
    queryFn: () => fetchProposals({ status: 'approved', pendingActivation: false, ownerIds, subCompanyId: agency.id, limit: 100 }),
    staleTime: 0,
  });

  const { data: rejectedData, isLoading: rejectedLoading, refetch: refetchRejected } = useQuery({
    queryKey: ['agency-proposals-rejected', agency.id, scopeKey],
    queryFn: () => fetchProposals({ status: 'rejected', ownerIds, subCompanyId: agency.id, limit: 100 }),
    staleTime: 0,
  });

  const { data: cwpData, isLoading: cwpLoading, refetch: refetchCwp } = useQuery({
    queryKey: ['agency-proposals-cwp', agency.id, scopeKey],
    queryFn: () => fetchProposals({ pendingActivation: true, ownerIds, subCompanyId: agency.id, limit: 100 }),
    staleTime: 0,
  });

  // Auto-refresh all four lists when a proposal:refresh socket event fires
  // (proposal sent / approved / rejected / activated / review-email sent / etc.).
  const refreshProposalsTrigger = useStore((s) => s.refreshProposalsTrigger);
  useEffect(() => {
    if (refreshProposalsTrigger === 0) return;
    refetchPending();
    refetchApproved();
    refetchRejected();
    refetchCwp();
  }, [refreshProposalsTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRejectConfirm = async () => {
    if (!rejectingProposal) return;
    setIsActing(true);
    try {
      await rejectProposal(rejectingProposal.id, rejectReason);
      setRejectDialogOpen(false);
      setRejectReason('');
      setRejectingProposal(null);
      refetchPending(); refetchRejected();
    } catch {
      toast.error('Failed to reject proposal');
    } finally {
      setIsActing(false);
    }
  };

  const isLoading = pendingLoading || approvedLoading || rejectedLoading || cwpLoading;

  const pendingProposals = useMemo(
    () => collapseProposalRows((pendingData?.proposals ?? []) as ProposalRecord[]),
    [pendingData],
  );

  const historyProposals = useMemo(() => {
    const all = [
      ...((approvedData?.proposals ?? []) as ProposalRecord[]),
      ...((rejectedData?.proposals ?? []) as ProposalRecord[]),
    ];
    all.sort((a, b) => new Date(b.reviewedAt ?? b.createdAt).getTime() - new Date(a.reviewedAt ?? a.createdAt).getTime());
    return all;
  }, [approvedData, rejectedData]);

  const cwpProposals = useMemo(() => (cwpData?.proposals ?? []) as ProposalRecord[], [cwpData]);

  const filteredPending = useMemo(() => pendingProposals.filter(p => {
    if (!proposalMatchesDateRange(p, dateRange)) return false;
    return !pendingSearch || p.lead.client.name.toLowerCase().includes(pendingSearch.toLowerCase()) ||
      `${p.lead.owner.firstName} ${p.lead.owner.lastName}`.toLowerCase().includes(pendingSearch.toLowerCase());
  }), [pendingProposals, pendingSearch, dateRange]);

  const filteredHistory = useMemo(() => historyProposals.filter(p => {
    if (!proposalMatchesDateRange(p, dateRange)) return false;
    return !historySearch || p.lead.client.name.toLowerCase().includes(historySearch.toLowerCase()) ||
      `${p.lead.owner.firstName} ${p.lead.owner.lastName}`.toLowerCase().includes(historySearch.toLowerCase());
  }), [historyProposals, historySearch, dateRange]);

  const agencyAwaitingClient = useMemo(() => cwpProposals.filter(p => !isReadyForActivation(p)), [cwpProposals]);
  const agencyPendingActivations = useMemo(() => cwpProposals.filter(p => isReadyForActivation(p)), [cwpProposals]);

  const filteredCwp = useMemo(() => agencyAwaitingClient.filter(p => {
    if (!proposalMatchesDateRange(p, dateRange)) return false;
    return !cwpSearch || p.lead.client.name.toLowerCase().includes(cwpSearch.toLowerCase()) ||
      `${p.lead.owner.firstName} ${p.lead.owner.lastName}`.toLowerCase().includes(cwpSearch.toLowerCase());
  }), [agencyAwaitingClient, cwpSearch, dateRange]);

  const filteredPa = useMemo(() => agencyPendingActivations.filter(p => {
    if (!proposalMatchesDateRange(p, dateRange)) return false;
    return !paSearch || p.lead.client.name.toLowerCase().includes(paSearch.toLowerCase()) ||
      `${p.lead.owner.firstName} ${p.lead.owner.lastName}`.toLowerCase().includes(paSearch.toLowerCase());
  }), [agencyPendingActivations, paSearch, dateRange]);

  const pendingPagination = useClientPagination(filteredPending, [
    agency.id,
    pendingSearch,
    dateRange?.from?.getTime(),
    dateRange?.to?.getTime(),
  ]);
  const historyPagination = useClientPagination(filteredHistory, [
    agency.id,
    historySearch,
    dateRange?.from?.getTime(),
    dateRange?.to?.getTime(),
  ]);
  const cwpPagination = useClientPagination(filteredCwp, [
    agency.id,
    cwpSearch,
    dateRange?.from?.getTime(),
    dateRange?.to?.getTime(),
  ]);
  const paPagination = useClientPagination(filteredPa, [
    agency.id,
    paSearch,
    dateRange?.from?.getTime(),
    dateRange?.to?.getTime(),
  ]);

  return (
    <>
    <Card className="border overflow-hidden">
      {/* Agency header */}
      <div className="flex items-center justify-between px-5 py-4 bg-muted/30 border-b">
        <h2 className="font-semibold text-base">{agency.name}</h2>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={onViewAgency}>
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
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="pending" className="gap-2">
                <FileText className="h-4 w-4" />Pending Review
                {filteredPending.length > 0 && <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{filteredPending.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="closed_won_pending" className="gap-2">
                <Trophy className="h-4 w-4" />Awaiting Client
                {agencyAwaitingClient.length > 0 && <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{agencyAwaitingClient.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="pending_activations" className="gap-2">
                <Zap className="h-4 w-4" />Pending Activations
                {agencyPendingActivations.length > 0 && <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{agencyPendingActivations.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-2">
                <History className="h-4 w-4" />History
                {historyProposals.length > 0 && <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{historyProposals.length}</Badge>}
              </TabsTrigger>
            </TabsList>

            {/* Pending */}
            <TabsContent value="pending" className="mt-4">
              <div className="relative max-w-sm mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search by client or owner..." value={pendingSearch} onChange={e => setPendingSearch(e.target.value)} className="pl-9" />
              </div>
              {filteredPending.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <FileText className="h-12 w-12 mb-4" /><p className="text-lg font-medium">No pending proposals</p>
                </div>
              ) : (
                <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead><TableHead>Owner</TableHead>
                      <TableHead>Agreement Type</TableHead><TableHead>Payment Terms</TableHead>
                      <TableHead>Submitted</TableHead><TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingPagination.pageRows.map(p => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="font-medium">{p.lead.client.name}</div>
                          {p.isForReview && p.selectedContact && (
                            <div className="text-xs text-muted-foreground mt-0.5">To: {p.selectedContact.name} · {p.selectedContact.email}</div>
                          )}
                          {p.isForReview && (
                            <Badge className="mt-1 text-xs bg-amber-100 text-amber-800 hover:bg-amber-100 border border-amber-300"><Mail className="h-3 w-3 mr-1" />For Review</Badge>
                          )}
                        </TableCell>
                        <TableCell><div className="flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" />{`${p.lead.owner.firstName} ${p.lead.owner.lastName}`.trim()}</div></TableCell>
                        <TableCell><AgreementTypeChips proposal={p} /></TableCell>
                        <TableCell><Badge variant="secondary">{getPaymentTermsLabel(p.paymentTerms)}</Badge></TableCell>
                        <TableCell><div className="flex items-center gap-2 text-sm text-muted-foreground"><Calendar className="h-4 w-4" />{format(new Date(p.createdAt), 'MMM d, yyyy')}</div></TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <ProposalChainActions
                              proposal={p}
                              subCompanyId={agency.id}
                              compact
                              onView={() => onViewDetails(p)}
                              makeActiveSlot={!p.isForReview ? (
                                <ProposalMakeActiveButton
                                  proposalId={p.id}
                                  subCompanyId={agency.id}
                                  onClick={() => onMakeActive(p)}
                                  disabled={isActing}
                                />
                              ) : undefined}
                              onComplete={() => {
                                refetchPending();
                                refetchApproved();
                                refetchCwp();
                              }}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
                </>
              )}
            </TabsContent>

            {/* History */}
            <TabsContent value="history" className="mt-4">
              <div className="relative max-w-sm mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search by client, owner, or reviewer..." value={historySearch} onChange={e => setHistorySearch(e.target.value)} className="pl-9" />
              </div>
              {filteredHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <History className="h-12 w-12 mb-4" /><p className="text-lg font-medium">No proposal history</p>
                </div>
              ) : (
                <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead><TableHead>Owner</TableHead>
                      <TableHead>Agreement Type</TableHead><TableHead>Payment Terms</TableHead>
                      <TableHead>Submitted</TableHead><TableHead>Status</TableHead>
                      <TableHead>Reviewed By</TableHead><TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyPagination.pageRows.map(p => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="font-medium">{p.lead.client.name}</div>
                          {p.isForReview && (
                            <Badge className="mt-1 text-xs bg-amber-100 text-amber-800 hover:bg-amber-100 border border-amber-300">
                              <Eye className="h-3 w-3 mr-1" />For Review
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell><div className="flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" />{`${p.lead.owner.firstName} ${p.lead.owner.lastName}`.trim()}</div></TableCell>
                        <TableCell><AgreementTypeChips proposal={p} /></TableCell>
                        <TableCell><Badge variant="secondary">{getPaymentTermsLabel(p.paymentTerms)}</Badge></TableCell>
                        <TableCell><div className="flex items-center gap-2 text-sm text-muted-foreground"><Calendar className="h-4 w-4" />{format(new Date(p.createdAt), 'MMM d, yyyy')}</div></TableCell>
                        <TableCell>{getStatusBadge(p.status)}</TableCell>
                        <TableCell>
                          {p.reviewedBy ? (
                            <div className="text-sm">
                              <div className="flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" />{`${p.reviewedBy.firstName} ${p.reviewedBy.lastName}`.trim()}</div>
                              {p.reviewedAt && <span className="text-xs text-muted-foreground">{format(new Date(p.reviewedAt), 'MMM d, yyyy')}</span>}
                            </div>
                          ) : <span className="text-sm text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" onClick={() => onViewDetails(p)}><Eye className="h-4 w-4 mr-1" />View</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {historyPagination.showPagination && (
                  <SectionPaginationBar
                    total={historyPagination.total}
                    startIndex={historyPagination.startIndex}
                    pageLen={historyPagination.pageRows.length}
                    totalPages={historyPagination.totalPages}
                    page={historyPagination.page}
                    onPageChange={historyPagination.setPage}
                    pageSize={historyPagination.pageSize}
                  />
                )}
                </>
              )}
            </TabsContent>

            {/* Awaiting Client */}
            <TabsContent value="closed_won_pending" className="mt-4">
              <div className="relative max-w-sm mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search by client or owner..." value={cwpSearch} onChange={e => setCwpSearch(e.target.value)} className="pl-9" />
              </div>
              {filteredCwp.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Trophy className="h-12 w-12 mb-4" /><p className="text-lg font-medium">No proposals awaiting client approval</p>
                </div>
              ) : (
                <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead><TableHead>Owner</TableHead>
                      <TableHead>Agreement Type</TableHead><TableHead>Approved</TableHead>
                      <TableHead>Client Signed</TableHead><TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cwpPagination.pageRows.map(p => {
                      const receivedCount = (p.proposalDocuments || []).filter(d => d.category === 'received_from_client').length;
                      return (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{p.lead.client.name}</TableCell>
                          <TableCell><div className="flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" />{`${p.lead.owner.firstName} ${p.lead.owner.lastName}`.trim()}</div></TableCell>
                          <TableCell><AgreementTypeChips proposal={p} /></TableCell>
                          <TableCell><div className="flex items-center gap-2 text-sm text-muted-foreground"><Calendar className="h-4 w-4" />{p.reviewedAt ? format(new Date(p.reviewedAt), 'MMM d, yyyy') : '—'}</div></TableCell>
                          <TableCell>{receivedCount > 0 ? <CheckCircle className="h-5 w-5 text-emerald-600" /> : <XCircle className="h-5 w-5 text-red-500" />}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="outline" size="sm" onClick={() => onViewCwp(p)}><Eye className="h-4 w-4 mr-1" />Manage</Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {cwpPagination.showPagination && (
                  <SectionPaginationBar
                    total={cwpPagination.total}
                    startIndex={cwpPagination.startIndex}
                    pageLen={cwpPagination.pageRows.length}
                    totalPages={cwpPagination.totalPages}
                    page={cwpPagination.page}
                    onPageChange={cwpPagination.setPage}
                    pageSize={cwpPagination.pageSize}
                  />
                )}
                </>
              )}
            </TabsContent>

            {/* Pending Activations */}
            <TabsContent value="pending_activations" className="mt-4">
              <div className="relative max-w-sm mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search by client or owner..." value={paSearch} onChange={e => setPaSearch(e.target.value)} className="pl-9" />
              </div>
              {filteredPa.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Zap className="h-12 w-12 mb-4" /><p className="text-lg font-medium">No pending activations</p>
                  <p className="text-sm">Proposals submitted for activation will appear here</p>
                </div>
              ) : (
                <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead><TableHead>Owner</TableHead>
                      <TableHead>Agreement Type</TableHead><TableHead>Approved</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paPagination.pageRows.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.lead.client.name}</TableCell>
                        <TableCell><div className="flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" />{`${p.lead.owner.firstName} ${p.lead.owner.lastName}`.trim()}</div></TableCell>
                        <TableCell><AgreementTypeChips proposal={p} /></TableCell>
                        <TableCell><div className="flex items-center gap-2 text-sm text-muted-foreground"><Calendar className="h-4 w-4" />{p.reviewedAt ? format(new Date(p.reviewedAt), 'MMM d, yyyy') : '—'}</div></TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" onClick={() => onViewCwp(p)}><Eye className="h-4 w-4 mr-1" />Manage</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {paPagination.showPagination && (
                  <SectionPaginationBar
                    total={paPagination.total}
                    startIndex={paPagination.startIndex}
                    pageLen={paPagination.pageRows.length}
                    totalPages={paPagination.totalPages}
                    page={paPagination.page}
                    onPageChange={paPagination.setPage}
                    pageSize={paPagination.pageSize}
                  />
                )}
                </>
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>

    {/* Reject Dialog */}
    <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reject Proposal</DialogTitle>
          <DialogDescription>
            The lead will stay in its current stage. The owner will be notified and can resubmit.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-4">
          <Label htmlFor={`rejectReason-${agency.id}`}>Reason <span className="text-destructive">*</span></Label>
          <Textarea
            id={`rejectReason-${agency.id}`}
            placeholder="Enter reason for rejection..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setRejectDialogOpen(false)} disabled={isActing}>Cancel</Button>
          <Button variant="destructive" onClick={handleRejectConfirm} disabled={isActing || !rejectReason.trim()}>
            {isActing ? 'Rejecting...' : 'Confirm Rejection'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

// ─── Per-user proposals summary card (manager "All Team" view) ───────────────
function UserProposalSection({
  user,
  colorIndex,
  onViewUser,
}: {
  user: ApiUser;
  colorIndex: number;
  onViewUser: () => void;
}) {
  const PAGE_SIZE = 10;
  const color = AGENCY_PALETTE[colorIndex % AGENCY_PALETTE.length];
  const fullName = `${user.firstName} ${user.lastName}`.trim();
  const initials = fullName.split(' ').map(w => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase();
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);

  const { data: pendingData, isLoading: pendingLoading } = useQuery({
    queryKey: ['user-proposals-pending', user.id],
    queryFn: () => fetchProposals({ status: 'pending', ownerIds: [user.id], limit: 100 }),
    staleTime: 0,
    retry: false,
  });

  const { data: cwpData, isLoading: cwpLoading } = useQuery({
    queryKey: ['user-proposals-cwp', user.id],
    queryFn: () => fetchProposals({ pendingActivation: true, ownerIds: [user.id], limit: 100 }),
    staleTime: 0,
    retry: false,
  });

  const pendingProposals = (pendingData?.proposals ?? []) as Array<{
    id: string;
    lead: { client: { name: string }; owner: { firstName: string; lastName: string } };
    createdAt: string;
    agreementTypes: string[];
    proposalPairId?: string | null;
    pair?: { members?: unknown[] } | null;
  }>;
  const cwpCount = cwpData?.total ?? 0;
  const isLoading = pendingLoading || cwpLoading;

  useEffect(() => {
    setPage(1);
  }, [user.id, expanded]);

  const totalPages = Math.max(1, Math.ceil(pendingProposals.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const pageRows = pendingProposals.slice(startIndex, startIndex + PAGE_SIZE);

  return (
    <Card className={cn('border overflow-hidden', color.border)}>
      <div className={cn('flex items-center justify-between px-5 py-4', color.bg)}>
        <PersonCardIdentity
          user={user}
          roleTitle={getUserRoleTitle(user)}
          accentClassName={color.accent}
        />
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 text-xs">
            <span className={cn('px-2 py-1 rounded-full font-medium border', color.bg, color.text, color.border)}>
              {pendingProposals.length} pending
            </span>
            {cwpCount > 0 && (
              <span className="px-2 py-1 rounded-full font-medium bg-amber-500/10 text-amber-600 border border-amber-500/20">
                {cwpCount} awaiting client
              </span>
            )}
          </div>
          <Button size="sm" variant="outline" className={cn('gap-1.5 text-xs shrink-0', color.border)} onClick={onViewUser}>
            View <TrendingUp className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <CardContent className="pt-4 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading proposals...</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-muted/40 rounded-lg p-3 space-y-1">
                <div className="flex items-center gap-1.5">
                  <FileText className={cn('h-4 w-4 shrink-0', color.text)} />
                  <span className="text-[11px] text-muted-foreground">Pending Review</span>
                </div>
                <p className="text-xl font-bold leading-none">{pendingProposals.length}</p>
              </div>
              <div className="bg-muted/40 rounded-lg p-3 space-y-1">
                <div className="flex items-center gap-1.5">
                  <Trophy className="h-4 w-4 shrink-0 text-amber-500" />
                  <span className="text-[11px] text-muted-foreground">Awaiting Client</span>
                </div>
                <p className="text-xl font-bold leading-none">{cwpCount}</p>
              </div>
            </div>

            {pendingProposals.length > 0 ? (
              <>
                <button
                  onClick={() => setExpanded(e => !e)}
                  className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-lg transition-colors border border-dashed border-border/40"
                >
                  {expanded
                    ? <><ChevronUp className="h-3.5 w-3.5" />Hide pending proposals</>
                    : <><ChevronDown className="h-3.5 w-3.5" />Show {pendingProposals.length} pending proposal{pendingProposals.length !== 1 ? 's' : ''}</>
                  }
                </button>
                {expanded && (
                  <div className="space-y-2">
                    <div className="overflow-x-auto rounded-lg border border-border/40">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border/50 bg-muted/30">
                            {['Client', 'Type', 'Date'].map(h => (
                              <th key={h} className={cn('py-2.5 px-3 font-medium text-xs text-muted-foreground uppercase tracking-wider', h === 'Date' ? 'text-right' : 'text-left')}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {pageRows.map(p => (
                            <tr key={p.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                              <td className="py-2.5 px-3 font-medium text-sm">{p.lead.client.name}</td>
                              <td className="py-2.5 px-3">
                                <AgreementTypeChips proposal={p} />
                              </td>
                              <td className="py-2.5 px-3 text-xs text-muted-foreground text-right">{format(new Date(p.createdAt), 'MMM d, yyyy')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {pendingProposals.length > PAGE_SIZE && (
                      <div className="flex items-center justify-between pt-3 mt-2 border-t">
                        <div className="text-sm text-muted-foreground">
                          Showing {startIndex + 1} to {Math.min(startIndex + pageRows.length, pendingProposals.length)} of {pendingProposals.length}
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
                  </div>
                )}
              </>
            ) : (
              <p className="text-center text-sm text-muted-foreground py-4">No pending proposals</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function Proposals() {
  const { currentUser, refreshProposalsTrigger } = useStore();
  const canReviewProposals = useCanReviewProposals();
  const canWriteProposals = useCanWriteProposals();
  const isManager = canReviewProposals;

  const scopeFilter = useScopeFilter();
  const {
    isElevated,
    showHierarchyFilters,
    isAgencyHierarchyViewer,
    isPureManager,
    isSingleAgencyLead,
    isAgencyScopedElevated,
    agencies,
    agenciesLoading,
    selectedAgencyId,
    selectedLeaderId,
    selectedManagerId,
    selectedUserId,
    setSelectedAgencyId,
    setSelectedUserId,
    setSelectedManagerId,
    onlyMe,
    managers: proposalManagers,
    getAssociatesForManager,
    getUsersForLeader,
    getManagersForLeader,
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
  const writeAgencyId = useWriteAgencyId(
    isElevated && selectedAgencyId !== 'all' && selectedAgencyId !== 'me'
      ? selectedAgencyId
      : currentUser?.subCompanyId,
  );
  const isAssociate = useIsOwnScope();
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedUserIdParam = searchParams.get('linkedUserId') ?? '';
  const actAs = useActAs();
  const {
    period: datePeriod,
    customRange: dateCustomRange,
    effectiveRange: dateRange,
    setPeriod: setDatePeriod,
    setCustomRange: setDateCustomRange,
  } = useDateRangeFilter();
  const [proposals, setProposals] = useState<ProposalRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProposal, setSelectedProposal] = useState<ProposalRecord | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [isActing, setIsActing] = useState(false);

  // Make Active flow — manager uploads client-signed agreement then activates
  const [makeActiveOpen, setMakeActiveOpen] = useState(false);
  const [makeActiveProposal, setMakeActiveProposal] = useState<ProposalRecord | null>(null);
  const [makeActiveFile, setMakeActiveFile] = useState<File | null>(null);
  const [makeActiveSubmitting, setMakeActiveSubmitting] = useState(false);

  // History tab state
  const [historyProposals, setHistoryProposals] = useState<ProposalRecord[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('pending');

  // Closed Won Pending tab state
  const [cwpProposals, setCwpProposals] = useState<ProposalRecord[]>([]);
  const [cwpTotal, setCwpTotal] = useState(0);
  const [cwpLoading, setCwpLoading] = useState(true);
  const [cwpSearchTerm, setCwpSearchTerm] = useState('');
  const [cwpDetailOpen, setCwpDetailOpen] = useState(false);
  const [cwpSelected, setCwpSelected] = useState<ProposalRecord | null>(null);
  const [expiredAwaitingProposal, setExpiredAwaitingProposal] = useState<ProposalRecord | null>(null);
  const [awaitingNoResponseReason, setAwaitingNoResponseReason] = useState('');
  const [awaitingRequestExtension, setAwaitingRequestExtension] = useState(false);
  const [awaitingExtensionReason, setAwaitingExtensionReason] = useState('');
  const [awaitingExtensionDays, setAwaitingExtensionDays] = useState(1);
  const [awaitingDecisionSubmitting, setAwaitingDecisionSubmitting] = useState(false);
  const [pendingExtensionRequests, setPendingExtensionRequests] = useState<ProposalExtensionRequestRecord[]>([]);
  const [pendingExtensionRequestsLoading, setPendingExtensionRequestsLoading] = useState(false);
  const [extensionRequestHistory, setExtensionRequestHistory] = useState<ProposalExtensionRequestRecord[]>([]);
  const [proposalExtensionTab, setProposalExtensionTab] = useState<'pending' | 'history'>('pending');
  const [paSearchTerm, setPaSearchTerm] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadingSent, setIsUploadingSent] = useState(false);
  const [sendManually, setSendManually] = useState(false);
  const [manualUploadChecked, setManualUploadChecked] = useState(false);
  const [replacingDocId, setReplacingDocId] = useState<string | null>(null);

  const [isActivating, setIsActivating] = useState(false);
  const [isSyncingPandaDoc, setIsSyncingPandaDoc] = useState(false);
  const [isRequestingReview, setIsRequestingReview] = useState(false);
  const [rejectReviewOpen, setRejectReviewOpen] = useState(false);
  const [rejectReviewComment, setRejectReviewComment] = useState('');
  const [isRejectingReview, setIsRejectingReview] = useState(false);

  // Agreement dialog state
  const [sendAgreementOpen, setSendAgreementOpen] = useState(false);

  // Review DOCX preview modal state
  const [reviewPreviewOpen, setReviewPreviewOpen] = useState(false);
  const [reviewPreviewHtml, setReviewPreviewHtml] = useState<string | null>(null);
  const [reviewPreviewLoading, setReviewPreviewLoading] = useState(false);
  const [reviewPreviewError, setReviewPreviewError] = useState<string | null>(null);

  // Email preview dialog state
  const [emailPreviewOpen, setEmailPreviewOpen] = useState(false);
  const [emailPreviewLoading, setEmailPreviewLoading] = useState(false);
  const [emailPreviewError, setEmailPreviewError] = useState<string | null>(null);
  const [emailPreviewData, setEmailPreviewData] = useState<{
    subject: string; html: string; to: string; contactName: string;
    documentLinkAvailable: boolean; missingFields: string[];
  } | null>(null);

  // Agreement preview dialog state
  const [agreementPreviewOpen, setAgreementPreviewOpen] = useState(false);
  const [agreementPreviewLoading, setAgreementPreviewLoading] = useState(false);
  const [agreementPreviewError, setAgreementPreviewError] = useState<string | null>(null);
  const [agreementPreviewData, setAgreementPreviewData] = useState<AgreementPreviewResult | null>(null);
  const [agreementPdfBlobUrl, setAgreementPdfBlobUrl] = useState<string | null>(null);

  // Default file preview modal state
  const [filePreviewOpen, setFilePreviewOpen] = useState(false);
  const [filePreviewName, setFilePreviewName] = useState('');
  const [filePreviewMime, setFilePreviewMime] = useState<string | null>(null);
  const [filePreviewBlobUrl, setFilePreviewBlobUrl] = useState<string | null>(null);
  const [filePreviewLoading, setFilePreviewLoading] = useState(false);

  // Agreement preview cache — keyed by proposal ID, populated in background when panel opens
  const previewCacheRef = useRef<Map<string, AgreementPreviewResult>>(new Map());
  const prefetchingRef = useRef<Set<string>>(new Set());

  const openFilePreview = async (id: string, name: string, mimeType: string | null) => {
    if (filePreviewBlobUrl) { URL.revokeObjectURL(filePreviewBlobUrl); setFilePreviewBlobUrl(null); }
    setFilePreviewName(name);
    setFilePreviewMime(mimeType);
    setFilePreviewOpen(true);
    setFilePreviewLoading(true);
    try {
      const res = await fetch(getDefaultFilePreviewUrl(id));
      if (!res.ok) throw new Error('Failed to load file');
      const blob = await res.blob();
      setFilePreviewBlobUrl(URL.createObjectURL(blob));
    } catch {
      toast.error('Could not load file preview');
      setFilePreviewOpen(false);
    } finally {
      setFilePreviewLoading(false);
    }
  };

  const openProposalDocPreview = async (docId: string, name: string, mimeType: string | null) => {
    if (filePreviewBlobUrl) { URL.revokeObjectURL(filePreviewBlobUrl); setFilePreviewBlobUrl(null); }
    setFilePreviewName(name);
    setFilePreviewMime(mimeType);
    setFilePreviewOpen(true);
    setFilePreviewLoading(true);
    try {
      const res = await fetch(getProposalDocPreviewUrl(docId));
      if (!res.ok) throw new Error('Failed to load file');
      const blob = await res.blob();
      setFilePreviewBlobUrl(URL.createObjectURL(blob));
    } catch {
      toast.error('Could not load file preview');
      setFilePreviewOpen(false);
    } finally {
      setFilePreviewLoading(false);
    }
  };

  // Resolved owner IDs for hierarchy viewers + pure managers (own-default = self exact).
  const resolvedOwnerIds = useMemo<string[] | undefined>(() => {
    if (!isAgencyHierarchyViewer && !isPureManager) return undefined;
    return resolveOwnerIds({
      isElevated,
      isPureManager,
      isSingleAgencyLead,
      isAgencyScopedElevated,
      onlyMe,
      selectedAgencyId,
      selectedLeaderId,
      selectedManagerId,
      selectedUserId,
      currentUserId: currentUser?.id,
      getAssociatesForManager,
      getUsersForLeader,
      getManagersForLeader,
      allManagers: proposalManagers,
      leaderParamInUrl,
      managerParamInUrl,
      userParamInUrl,
    });
  }, [isAgencyHierarchyViewer, isPureManager, isElevated, isSingleAgencyLead, isAgencyScopedElevated, onlyMe, selectedAgencyId, selectedLeaderId, selectedUserId, selectedManagerId, getAssociatesForManager, getUsersForLeader, getManagersForLeader, proposalManagers, currentUser?.id, leaderParamInUrl, managerParamInUrl, userParamInUrl]);

  const linkedOwnerResolve = useMemo(() => {
    return resolveLinkedAwareOwnerIds({
      linkedUserIdsRaw: linkedUserIdParam || undefined,
      actAsActive: actAs.isActive,
      currentUserId: currentUser?.id,
      scopeFilter,
    });
  }, [
    linkedUserIdParam,
    actAs.isActive,
    currentUser?.id,
    resolvedOwnerIds,
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
    proposalManagers,
    leaderParamInUrl,
    managerParamInUrl,
    userParamInUrl,
  ]);
  const linkedOwnerIdsKey =
    linkedOwnerResolve.ownerIds === undefined
      ? undefined
      : linkedOwnerResolve.ownerIds.join(',');
  const linkedOrResolvedOwnerIds = useMemo(
    () =>
      linkedOwnerIdsKey === undefined
        ? undefined
        : linkedOwnerIdsKey === ''
          ? []
          : linkedOwnerIdsKey.split(','),
    [linkedOwnerIdsKey],
  );
  const linkedOwnerExact = linkedOwnerResolve.ownerExact;

  useEffect(() => {
    ownerExactFlag.set(linkedOwnerExact);
    return () => ownerExactFlag.set(false);
  }, [linkedOwnerExact]);

  /** Prefer linked/act-as / own-default from shared resolver (includes exact via ownerExactFlag). */
  const resolveProposalOwnerIds = useCallback(() => {
    return linkedOrResolvedOwnerIds;
  }, [linkedOrResolvedOwnerIds]);

  const loadProposals = useCallback(async (silent = false) => {
    if (!isManager) return;
    if (showAgencySections || showAllTeamView) { if (!silent) setLoading(false); return; }
    if (!silent) setLoading(true);
    try {
      const ownerIds = resolveProposalOwnerIds();
      if (ownerIds !== undefined && ownerIds.length === 0) { if (!silent) setLoading(false); setProposals([]); setTotal(0); return; }
      const agencyId = isElevated && selectedAgencyId !== 'all' && selectedAgencyId !== 'me' ? selectedAgencyId : undefined;
      const res = await fetchProposals({ status: 'pending', limit: 100, ownerIds, subCompanyId: agencyId });
      setProposals(collapseProposalRows(res.proposals as ProposalRecord[]));
      setTotal(res.total);
    } catch {
      if (!silent) toast.error('Failed to load proposals');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [isManager, isElevated, selectedAgencyId, showAgencySections, showAllTeamView, resolveProposalOwnerIds]);

  const loadHistory = useCallback(async (silent = false) => {
    if (showAgencySections || showAllTeamView) { if (!silent) setHistoryLoading(false); return; }
    if (!silent) setHistoryLoading(true);
    try {
      const ownerIds = resolveProposalOwnerIds();
      if (ownerIds !== undefined && ownerIds.length === 0) { if (!silent) setHistoryLoading(false); setHistoryProposals([]); setHistoryTotal(0); return; }
      const agencyId = isElevated && selectedAgencyId !== 'all' && selectedAgencyId !== 'me' ? selectedAgencyId : undefined;
      const [approvedRes, rejectedRes] = await Promise.all([
        fetchProposals({ status: 'approved', pendingActivation: false, limit: 100, ownerIds, subCompanyId: agencyId }),
        fetchProposals({ status: 'rejected', limit: 100, ownerIds, subCompanyId: agencyId }),
      ]);
      const all = [...approvedRes.proposals, ...rejectedRes.proposals] as ProposalRecord[];
      all.sort((a, b) => new Date(b.reviewedAt ?? b.createdAt).getTime() - new Date(a.reviewedAt ?? a.createdAt).getTime());
      setHistoryProposals(all);
      setHistoryTotal(all.length);
    } catch {
      if (!silent) toast.error('Failed to load proposal history');
    } finally {
      if (!silent) setHistoryLoading(false);
    }
  }, [isElevated, selectedAgencyId, showAgencySections, showAllTeamView, resolveProposalOwnerIds]);

  const loadCwp = useCallback(async (silent = false) => {
    if (showAgencySections || showAllTeamView) { if (!silent) setCwpLoading(false); return; }
    if (!silent) setCwpLoading(true);
    try {
      const ownerIds = resolveProposalOwnerIds();
      if (ownerIds !== undefined && ownerIds.length === 0) { if (!silent) setCwpLoading(false); setCwpProposals([]); setCwpTotal(0); return; }
      const agencyId = isElevated && selectedAgencyId !== 'all' && selectedAgencyId !== 'me' ? selectedAgencyId : undefined;
      const res = await fetchProposals({ pendingActivation: true, limit: 100, ownerIds, subCompanyId: agencyId });
      setCwpProposals(res.proposals as ProposalRecord[]);
      setCwpTotal(res.total);
    } catch {
      if (!silent) toast.error('Failed to load Closed Won Pending proposals');
    } finally {
      if (!silent) setCwpLoading(false);
    }
  }, [isElevated, selectedAgencyId, showAgencySections, showAllTeamView, resolveProposalOwnerIds]);

  useEffect(() => {
    if (isManager) loadProposals();
  }, [isManager, loadProposals]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    loadCwp();
  }, [loadCwp]);

  // Auto-open Manage dialog when navigated with ?manage=proposalId
  const manageParam = searchParams.get('manage');
  useEffect(() => {
    if (!manageParam || cwpLoading) return;
    const target = cwpProposals.find((p) => p.id === manageParam);
    if (target) {
      handleViewCwpDetails(target);
      setActiveTab(isReadyForActivation(target) ? 'pending_activations' : 'closed_won_pending');
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('manage');
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manageParam, cwpLoading, cwpProposals]);

  // Auto-open proposal details when navigated with ?open=proposalId (e.g. from manager notification)
  const openParam = searchParams.get('open');
  useEffect(() => {
    if (!openParam || loading) return;
    const target = proposals.find((p) => p.id === openParam);
    if (target) {
      handleViewDetails(target);
      setActiveTab('pending');
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('open');
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openParam, loading, proposals]);

  // Auto-refresh: re-run all loaders silently when proposal:refresh socket event fires
  useEffect(() => {
    if (refreshProposalsTrigger === 0) return; // skip initial mount
    if (isManager) loadProposals(true);
    loadHistory(true);
    loadCwp(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshProposalsTrigger]);

  // Keep open modal in sync when list data refreshes (e.g. after socket-triggered reload)
  useEffect(() => {
    if (!cwpSelected) return;
    const fresh = cwpProposals.find((p) => p.id === cwpSelected.id);
    if (fresh && fresh !== cwpSelected) {
      setCwpSelected(fresh);
    }
  }, [cwpProposals]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredProposals = proposals.filter((p) => {
    if (!proposalMatchesDateRange(p, dateRange)) return false;
    const search = searchTerm.toLowerCase();
    const ownerName = `${p.lead.owner.firstName} ${p.lead.owner.lastName}`.trim();
    return (
      p.lead.client.name.toLowerCase().includes(search) ||
      ownerName.toLowerCase().includes(search)
    );
  });

  const filteredHistory = historyProposals.filter((p) => {
    if (!proposalMatchesDateRange(p, dateRange)) return false;
    const search = historySearchTerm.toLowerCase();
    const ownerName = `${p.lead.owner.firstName} ${p.lead.owner.lastName}`.trim();
    const reviewerName = p.reviewedBy ? `${p.reviewedBy.firstName} ${p.reviewedBy.lastName}`.trim() : '';
    return (
      p.lead.client.name.toLowerCase().includes(search) ||
      ownerName.toLowerCase().includes(search) ||
      reviewerName.toLowerCase().includes(search)
    );
  });

  const filteredCwp = cwpProposals.filter((p) => {
    if (!proposalMatchesDateRange(p, dateRange)) return false;
    const search = cwpSearchTerm.toLowerCase();
    const ownerName = `${p.lead.owner.firstName} ${p.lead.owner.lastName}`.trim();
    return (
      p.lead.client.name.toLowerCase().includes(search) ||
      ownerName.toLowerCase().includes(search)
    );
  });

  const awaitingClientProposals = useMemo(() => cwpProposals.filter(p => !isReadyForActivation(p)), [cwpProposals]);
  const pendingActivationProposals = useMemo(() => cwpProposals.filter(p => isReadyForActivation(p)), [cwpProposals]);
  const selectedAssociateFilterId = selectedUserId !== 'all' ? selectedUserId : null;
  const visibleProposalIds = useMemo(() => new Set(cwpProposals.map((p) => p.id)), [cwpProposals]);
  const filteredPendingExtensionRequests = useMemo(
    () => pendingExtensionRequests.filter((r) => {
      if (!visibleProposalIds.has(r.proposal.id)) return false;
      if (!selectedAssociateFilterId) return true;
      return r.requestedBy?.id === selectedAssociateFilterId;
    }),
    [pendingExtensionRequests, visibleProposalIds, selectedAssociateFilterId]
  );
  const filteredExtensionRequestHistory = useMemo(
    () => extensionRequestHistory.filter((r) => {
      if (!visibleProposalIds.has(r.proposal.id)) return false;
      if (!selectedAssociateFilterId) return true;
      return r.requestedBy?.id === selectedAssociateFilterId;
    }),
    [extensionRequestHistory, visibleProposalIds, selectedAssociateFilterId]
  );

  const filteredAwaitingClient = useMemo(() => awaitingClientProposals.filter(p => {
    if (!proposalMatchesDateRange(p, dateRange)) return false;
    const search = cwpSearchTerm.toLowerCase();
    const ownerName = `${p.lead.owner.firstName} ${p.lead.owner.lastName}`.trim();
    return !search || p.lead.client.name.toLowerCase().includes(search) || ownerName.toLowerCase().includes(search);
  }), [awaitingClientProposals, cwpSearchTerm, dateRange]);

  const filteredPendingActivation = useMemo(() => pendingActivationProposals.filter(p => {
    if (!proposalMatchesDateRange(p, dateRange)) return false;
    const search = paSearchTerm.toLowerCase();
    const ownerName = `${p.lead.owner.firstName} ${p.lead.owner.lastName}`.trim();
    return !search || p.lead.client.name.toLowerCase().includes(search) || ownerName.toLowerCase().includes(search);
  }), [pendingActivationProposals, paSearchTerm, dateRange]);

  useEffect(() => {
    if (!isAssociate) return;
    if (activeTab !== 'closed_won_pending') return;
    const target = cwpProposals.find((p) => shouldOpenExpiredAwaitingDecision(p));
    setExpiredAwaitingProposal(target ?? null);
  }, [cwpProposals, isAssociate, activeTab]);

  useEffect(() => {
    if (!isManager) return;
    setPendingExtensionRequestsLoading(true);
    Promise.all([
      fetchProposalExtensionRequests('pending'),
      fetchProposalExtensionRequests('approved'),
      fetchProposalExtensionRequests('rejected'),
    ])
      .then(([pending, approved, rejected]) => {
        setPendingExtensionRequests(pending as ProposalExtensionRequestRecord[]);
        const history = [...(approved as ProposalExtensionRequestRecord[]), ...(rejected as ProposalExtensionRequestRecord[])];
        history.sort((a, b) => {
          const aTs = new Date(a.reviewedAt ?? a.createdAt).getTime();
          const bTs = new Date(b.reviewedAt ?? b.createdAt).getTime();
          return bTs - aTs;
        });
        setExtensionRequestHistory(history);
      })
      .catch(() => {
        setPendingExtensionRequests([]);
        setExtensionRequestHistory([]);
      })
      .finally(() => setPendingExtensionRequestsLoading(false));
  }, [isManager, cwpProposals]);

  const handleViewDetails = (p: ProposalRecord) => {
    setSelectedProposal(p);
    setDetailsOpen(true);
  };

  const handleViewCwpDetails = (p: ProposalRecord) => {
    if (isAssociate && shouldOpenExpiredAwaitingDecision(p)) {
      setExpiredAwaitingProposal(p);
      return;
    }
    setCwpSelected(p);
    setCwpDetailOpen(true);
  };

  // Upload a received-from-client document (immediate upload, no email)
  const handleReceivedDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !cwpSelected) return;
    setIsUploading(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const doc = await uploadProposalDocument(cwpSelected.id, {
        category: 'received_from_client',
        name: file.name,
        fileBase64: base64,
        mimeType: file.type || undefined,
      });
      const updatedDocs = [doc, ...(cwpSelected.proposalDocuments || [])];
      const updatedProposal = { ...cwpSelected, proposalDocuments: updatedDocs };
      setCwpSelected(updatedProposal);
      setCwpProposals((prev) =>
        prev.map((p) => (p.id === cwpSelected.id ? updatedProposal : p))
      );
      toast.success('Document uploaded');
    } catch (err: any) {
      toast.error(err.message || 'Failed to upload document');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleReplaceDoc = async (docId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !cwpSelected) return;
    setReplacingDocId(docId);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const updated = await replaceProposalDocument(docId, {
        name: file.name,
        fileBase64: base64,
        mimeType: file.type || undefined,
      });
      const updatedDocs = (cwpSelected.proposalDocuments || []).map((d) =>
        d.id === docId ? updated : d
      );
      const updatedProposal = { ...cwpSelected, proposalDocuments: updatedDocs };
      setCwpSelected(updatedProposal);
      setCwpProposals((prev) => prev.map((p) => (p.id === cwpSelected.id ? updatedProposal : p)));
      toast.success('Document replaced');
    } catch (err: any) {
      toast.error(err.message || 'Failed to replace document');
    } finally {
      setReplacingDocId(null);
      e.target.value = '';
    }
  };

  const handleSentAgreementUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !cwpSelected) return;
    setIsUploadingSent(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const doc = await uploadProposalDocument(cwpSelected.id, {
        category: 'sent_to_client',
        name: file.name,
        fileBase64: base64,
        mimeType: file.type || undefined,
      });
      const updatedDocs = [doc, ...(cwpSelected.proposalDocuments || [])];
      const updatedProposal = { ...cwpSelected, proposalDocuments: updatedDocs };
      setCwpSelected(updatedProposal);
      setCwpProposals((prev) => prev.map((p) => (p.id === cwpSelected.id ? updatedProposal : p)));
      toast.success('Agreement uploaded');
    } catch (err: any) {
      toast.error(err.message || 'Failed to upload agreement');
    } finally {
      setIsUploadingSent(false);
      e.target.value = '';
    }
  };

  const handleRequestReview = async (p: ProposalRecord) => {
    if (!canWriteProposals) return;
    setIsRequestingReview(true);
    try {
      await requestProposalReview(p.id);
      // Update local state — clear rejection fields on resubmission
      const updated = { ...p, reviewRequestedAt: new Date().toISOString(), reviewRejectedAt: null, reviewRejectionComment: null, reviewRejectedBy: null };
      setCwpSelected(updated);
      setCwpProposals((prev) => prev.map((pp) => (pp.id === p.id ? updated : pp)));
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit for review');
    } finally {
      setIsRequestingReview(false);
    }
  };

  const handleRejectReview = async () => {
    if (!cwpSelected || !rejectReviewComment.trim()) return;
    setIsRejectingReview(true);
    try {
      await rejectProposalReview(cwpSelected.id, rejectReviewComment.trim());
      const updated = { ...cwpSelected, reviewRejectedAt: new Date().toISOString(), reviewRejectionComment: rejectReviewComment.trim() };
      setCwpSelected(updated);
      setCwpProposals((prev) => prev.map((pp) => (pp.id === cwpSelected.id ? updated : pp)));
      setRejectReviewOpen(false);
      setRejectReviewComment('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to reject review');
    } finally {
      setIsRejectingReview(false);
    }
  };

  // Silently prefetch agreement preview(s) when a proposal panel opens — so "Preview" is instant
  useEffect(() => {
    const p = selectedProposal;
    if (!p) return;
    const members = getPandaDocPreviewMembers(p);
    if (!members.length) return;

    for (const member of members) {
      if (previewCacheRef.current.has(member.id)) continue;
      if (prefetchingRef.current.has(member.id)) continue;

      prefetchingRef.current.add(member.id);
      (async () => {
        try {
          let result = await pandaDocAgreementPreview(member.id);
          if ('status' in result && result.status === 'still_generating') {
            let attempts = 0;
            while (attempts < 20) {
              await new Promise<void>((r) => setTimeout(r, 3000));
              result = await pandaDocAgreementPreview(member.id);
              if (!('status' in result)) break;
              attempts++;
            }
          }
          if (!('status' in result)) {
            previewCacheRef.current.set(member.id, result as AgreementPreviewResult);
          }
        } catch {
          // silent — user will see error only if they actually click Preview
        } finally {
          prefetchingRef.current.delete(member.id);
        }
      })();
    }
  }, [selectedProposal?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Preview by proposal row id (Both pairs: Temp and Direct are separate ids). */
  const handlePreviewAgreementById = async (proposalId: string) => {
    if (agreementPdfBlobUrl) { URL.revokeObjectURL(agreementPdfBlobUrl); setAgreementPdfBlobUrl(null); }

    const cached = previewCacheRef.current.get(proposalId);
    if (cached) {
      setAgreementPreviewData(cached);
      const bytes = Uint8Array.from(atob(cached.pdfBase64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/pdf' });
      setAgreementPdfBlobUrl(URL.createObjectURL(blob));
      setAgreementPreviewLoading(false);
      setAgreementPreviewError(null);
      setAgreementPreviewOpen(true);
      return;
    }

    setAgreementPreviewOpen(true);
    setAgreementPreviewData(null);
    setAgreementPreviewError(null);
    setAgreementPreviewLoading(true);
    try {
      let result = await pandaDocAgreementPreview(proposalId);

      // If background job is still running, poll every 3s (up to 60s)
      if ('status' in result && result.status === 'still_generating') {
        let attempts = 0;
        while (attempts < 20) {
          await new Promise<void>((r) => setTimeout(r, 3000));
          result = await pandaDocAgreementPreview(proposalId);
          if (!('status' in result)) break;
          attempts++;
        }
      }

      if ('status' in result) {
        setAgreementPreviewError('Preview is still being prepared. Please try again in a moment.');
        return;
      }

      previewCacheRef.current.set(proposalId, result as AgreementPreviewResult);
      setAgreementPreviewData(result as AgreementPreviewResult);
      const bytes = Uint8Array.from(atob((result as AgreementPreviewResult).pdfBase64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/pdf' });
      setAgreementPdfBlobUrl(URL.createObjectURL(blob));
    } catch (err: any) {
      setAgreementPreviewError(err?.message ?? 'Failed to generate agreement preview');
    } finally {
      setAgreementPreviewLoading(false);
    }
  };

  const handlePreviewAgreement = async (p: ProposalRecord) => {
    if (!p.pandaDocTemplateId && !p.pair?.members?.length) return;
    await handlePreviewAgreementById(p.id);
  };

  const handlePreviewEmail = async (p: ProposalRecord) => {
    setEmailPreviewOpen(true);
    setEmailPreviewData(null);
    setEmailPreviewError(null);
    setEmailPreviewLoading(true);
    try {
      const data = await previewProposalEmail(p.id);
      setEmailPreviewData(data);
    } catch (err: any) {
      setEmailPreviewError(err?.message ?? 'Failed to load email preview');
    } finally {
      setEmailPreviewLoading(false);
    }
  };

  const handleActivateLead = async () => {
    if (!cwpSelected) return;
    setIsActivating(true);
    try {
      await activateProposal(cwpSelected.id);
      toast.success(`${cwpSelected.lead.client.name} is now active — lead moved to Closed Won.`);
      setCwpDetailOpen(false);
      loadCwp();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to activate lead');
    } finally {
      setIsActivating(false);
    }
  };

  const handleSyncPandaDoc = async (pandaDocId?: string) => {
    const docId = pandaDocId ?? cwpSelected?.pandaDocId;
    if (!docId) return;
    setIsSyncingPandaDoc(true);
    try {
      const result = await pandaDocSyncDocument(docId);
      const label = result.status.replace('document.', '');
      toast.success(`Synced — document is ${label}`);
      loadCwp(true);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to sync PandaDoc status');
    } finally {
      setIsSyncingPandaDoc(false);
    }
  };

  const handleSubmitExpiredAwaitingDecision = async () => {
    if (!expiredAwaitingProposal) return;
    if (!awaitingNoResponseReason.trim()) {
      toast.error('Please provide reason for no client response');
      return;
    }
    if (awaitingRequestExtension) {
      if (!awaitingExtensionReason.trim()) {
        toast.error('Please provide extension reason');
        return;
      }
      if (!Number.isInteger(awaitingExtensionDays) || awaitingExtensionDays < 1) {
        toast.error('Extension days must be at least 1');
        return;
      }
    }

    setAwaitingDecisionSubmitting(true);
    try {
      await submitAwaitingClientDecision(expiredAwaitingProposal.id, {
        requestExtension: awaitingRequestExtension,
        noResponseReason: awaitingNoResponseReason.trim(),
        extensionReason: awaitingRequestExtension ? awaitingExtensionReason.trim() : undefined,
        requestedDays: awaitingRequestExtension ? awaitingExtensionDays : undefined,
      });
      toast.success(
        awaitingRequestExtension
          ? 'Extension request sent to your manager for approval'
          : 'Lead moved to Closed Won and released'
      );
      setExpiredAwaitingProposal(null);
      setAwaitingNoResponseReason('');
      setAwaitingRequestExtension(false);
      setAwaitingExtensionReason('');
      setAwaitingExtensionDays(1);
      loadCwp(true);
      loadHistory(true);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to submit decision');
    } finally {
      setAwaitingDecisionSubmitting(false);
    }
  };

  const refreshProposalExtensions = async () => {
    setPendingExtensionRequestsLoading(true);
    try {
      const [pending, approved, rejected] = await Promise.all([
        fetchProposalExtensionRequests('pending'),
        fetchProposalExtensionRequests('approved'),
        fetchProposalExtensionRequests('rejected'),
      ]);
      const history = [...(approved as ProposalExtensionRequestRecord[]), ...(rejected as ProposalExtensionRequestRecord[])];
      history.sort((a, b) => {
        const aTs = new Date(a.reviewedAt ?? a.createdAt).getTime();
        const bTs = new Date(b.reviewedAt ?? b.createdAt).getTime();
        return bTs - aTs;
      });
      setPendingExtensionRequests(pending as ProposalExtensionRequestRecord[]);
      setExtensionRequestHistory(history);
      await Promise.all([loadCwp(true), loadHistory(true)]);
    } finally {
      setPendingExtensionRequestsLoading(false);
    }
  };

  const handleMakeActive = (p: ProposalRecord) => {
    setMakeActiveProposal(p);
    setMakeActiveFile(null);
    setMakeActiveOpen(true);
  };

  const handleMakeActiveSubmit = async () => {
    if (!makeActiveProposal || !makeActiveFile) return;
    setMakeActiveSubmitting(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(makeActiveFile);
      });
      // Activate first — this flips proposal → approved and lead → closed_won,
      // which is required for the document-upload endpoint to accept a
      // received_from_client doc.
      await approveAndActivateProposal(makeActiveProposal.id);
      try {
        await uploadProposalDocument(makeActiveProposal.id, {
          category: 'received_from_client',
          name: makeActiveFile.name,
          fileBase64: base64,
          mimeType: makeActiveFile.type || undefined,
        });
      } catch (uploadErr: any) {
        // Lead is already active — surface a clear message so the manager can
        // retry the upload from the Closed Won proposal view.
        toast.error(
          `Lead activated, but signed document upload failed: ${uploadErr?.message ?? 'unknown error'}. Please retry from the Closed Won tab.`,
        );
        setMakeActiveOpen(false);
        setMakeActiveProposal(null);
        setMakeActiveFile(null);
        setDetailsOpen(false);
        setProposals(prev => prev.filter(x => x.id !== makeActiveProposal.id));
        setTotal(prev => Math.max(0, prev - 1));
        setActiveTab('history');
        loadProposals(true);
        loadHistory(true);
        loadCwp();
        return;
      }
      toast.success(`${makeActiveProposal.lead.client.name} is now active — lead moved to Closed Won.`);
      setMakeActiveOpen(false);
      setMakeActiveProposal(null);
      setMakeActiveFile(null);
      setDetailsOpen(false);
      setProposals(prev => prev.filter(x => x.id !== makeActiveProposal.id));
      setTotal(prev => Math.max(0, prev - 1));
      setActiveTab('history');
      loadProposals(true);
      loadHistory(true);
      loadCwp();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to make lead active');
    } finally {
      setMakeActiveSubmitting(false);
    }
  };

  const handleRejectConfirm = async () => {
    if (!selectedProposal) return;
    setIsActing(true);
    try {
      await rejectProposal(selectedProposal.id, rejectReason);
      setRejectDialogOpen(false);
      setDetailsOpen(false);
      setRejectReason('');
      setProposals(prev => prev.filter(x => x.id !== selectedProposal.id));
      setTotal(prev => Math.max(0, prev - 1));
      loadProposals(true);
      loadHistory(true);
    } catch {
      toast.error('Failed to reject proposal');
    } finally {
      setIsActing(false);
    }
  };

  const formatFileSize = (bytes: number | string) => {
    const n = Number(bytes);
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getFileIcon = (type: string) => {
    if (type.includes('pdf')) return <FileText className="h-4 w-4 text-red-500" />;
    return <File className="h-4 w-4 text-muted-foreground" />;
  };

  // Shared helper: render received-from-client upload
  const renderReceivedUploadForm = () => (
    <div className="space-y-3 p-4 rounded-lg border border-dashed border-green-300 bg-green-50/30">
      <h4 className="text-sm font-medium flex items-center gap-2">
        <Inbox className="h-4 w-4 text-green-500" />
        Upload Received Document
      </h4>
      <Button variant="outline" size="sm" disabled={isUploading} className="relative" asChild>
        <label className="cursor-pointer">
          {isUploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
          {isUploading ? 'Uploading...' : 'Choose File'}
          <input type="file" className="sr-only" onChange={handleReceivedDocUpload} disabled={isUploading} />
        </label>
      </Button>
    </div>
  );

  // PandaDoc status badge
  const getPandaDocStatusBadge = (status: string | null | undefined) => {
    if (!status) return null;
    const map: Record<string, { label: string; className: string }> = {
      'document.draft':     { label: 'Preparing', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
      'document.sent':      { label: 'Sent', className: 'bg-blue-100 text-blue-800 border-blue-200' },
      'document.viewed':    { label: 'Viewed', className: 'bg-purple-100 text-purple-800 border-purple-200' },
      'document.completed': { label: 'Signed', className: 'bg-green-100 text-green-800 border-green-200' },
      'document.declined':  { label: 'Declined', className: 'bg-red-100 text-red-800 border-red-200' },
      'document.voided':    { label: 'Voided', className: 'bg-gray-100 text-gray-600 border-gray-200' },
    };
    const s = map[status];
    if (!s) return <Badge variant="outline">{status.replace('document.', '')}</Badge>;
    return <Badge variant="outline" className={`gap-1 ${s.className}`}><PenLine className="h-3 w-3" />{s.label}</Badge>;
  };

  // Shared helper: render review status banner + submit/resubmit button
  const renderReviewSection = (p: ProposalRecord) => {
    const receivedDocs = (p.proposalDocuments || []).filter(d => d.category === 'received_from_client');
    const sentDocs = (p.proposalDocuments || []).filter(d => d.category === 'sent_to_client');
    const canSubmit = canWriteProposals && (!!p.pandaDocId || sentDocs.length > 0) && receivedDocs.length > 0;

    const wasRequested = !!p.reviewRequestedAt;
    const wasRejected = !!p.reviewRejectedAt && !!p.reviewRequestedAt
      && new Date(p.reviewRejectedAt).getTime() >= new Date(p.reviewRequestedAt).getTime();
    const isSubmittedForReview = wasRequested && !wasRejected;

    // STATE 1: Rejected — show rejection banner + resubmit button for associate
    if (wasRejected) {
      return (
        <div className="space-y-3">
          <div className="p-3 rounded-lg border border-red-200 bg-red-50 space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Resubmission Requested</Badge>
              <span className="text-xs text-red-600">
                {p.reviewRejectedBy ? `by ${p.reviewRejectedBy.firstName} ${p.reviewRejectedBy.lastName}`.trim() : ''}
                {p.reviewRejectedAt && ` on ${format(new Date(p.reviewRejectedAt), 'MMM d, yyyy h:mm a')}`}
              </span>
            </div>
            {p.reviewRejectionComment && (
              <p className="text-sm text-red-700 whitespace-pre-wrap">{p.reviewRejectionComment}</p>
            )}
          </div>
          {!isManager && (
            <Button
              className="w-full bg-blue-600 hover:bg-blue-700"
              disabled={!canSubmit || isRequestingReview}
              onClick={() => handleRequestReview(p)}
            >
              {isRequestingReview ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Resubmitting...</>
              ) : (
                <><Send className="h-4 w-4 mr-2" />Resubmit for Review</>
              )}
            </Button>
          )}
        </div>
      );
    }

    // STATE 2: Submitted for review — show status banner
    if (isSubmittedForReview) {
      return (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-blue-200 bg-blue-50">
          <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 gap-1">
            <CheckCircle className="h-3 w-3" />
            Submitted for Review
          </Badge>
          <span className="text-sm text-blue-700">
            {p.reviewRequestedBy
              ? `by ${p.reviewRequestedBy.firstName} ${p.reviewRequestedBy.lastName}`.trim()
              : ''}
            {p.reviewRequestedAt && ` on ${format(new Date(p.reviewRequestedAt), 'MMM d, yyyy h:mm a')}`}
          </span>
        </div>
      );
    }

    // STATE 3: Not yet submitted — show submit button for associates
    if (isManager) return null;

    return (
      <div className="space-y-2">
        {!canSubmit && (
          <p className="text-xs text-muted-foreground">
            Send the agreement via PandaDoc (or upload manually), then upload a received document to submit for manager review.
          </p>
        )}
        <Button
          className="w-full bg-blue-600 hover:bg-blue-700"
          disabled={!canSubmit || isRequestingReview}
          onClick={() => handleRequestReview(p)}
        >
          {isRequestingReview ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Submitting...</>
          ) : (
            <><Send className="h-4 w-4 mr-2" />Submit for Manager Review</>
          )}
        </Button>
      </div>
    );
  };

  // Associates only see the History tab
  if (!isManager) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">My Proposals</h1>
            <p className="text-muted-foreground">View your submitted proposal history</p>
          </div>
        </div>

        <ScopeFilterBar show={false} filterRowProps={filterRowProps} />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="pending" className="gap-2">
              <History className="h-4 w-4" />
              My Proposals
              {historyTotal > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{historyTotal}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="closed_won_pending" className="gap-2">
              <Trophy className="h-4 w-4" />
              Awaiting Client Approval
              {cwpTotal > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{cwpTotal}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by client..."
                  value={historySearchTerm}
                  onChange={(e) => setHistorySearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Badge variant="secondary">{historyTotal} Proposals</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {historyLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filteredHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <History className="h-12 w-12 mb-4" />
                <p className="text-lg font-medium">No proposals yet</p>
                <p className="text-sm">Your submitted proposals will appear here</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Agreement Type</TableHead>
                    <TableHead>Payment Terms</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reviewed By</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredHistory.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="font-medium">{p.lead.client.name}</div>
                        {p.isForReview && (
                          <Badge className="mt-1 text-xs bg-amber-100 text-amber-800 hover:bg-amber-100 border border-amber-300">
                            <Eye className="h-3 w-3 mr-1" />For Review
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <AgreementTypeChips proposal={p} />
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{getPaymentTermsLabel(p.paymentTerms)}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Calendar className="h-4 w-4" />
                          {format(new Date(p.createdAt), 'MMM d, yyyy')}
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(p.status)}</TableCell>
                      <TableCell>
                        {p.reviewedBy ? (
                          <div className="flex items-center gap-2 text-sm">
                            <User className="h-4 w-4 text-muted-foreground" />
                            {`${p.reviewedBy.firstName} ${p.reviewedBy.lastName}`.trim()}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => handleViewDetails(p)}>
                          <Eye className="h-4 w-4 mr-1" />
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
          </TabsContent>

          <TabsContent value="closed_won_pending">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-4">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by client..."
                      value={cwpSearchTerm}
                      onChange={(e) => setCwpSearchTerm(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Badge variant="secondary">{cwpTotal} Pending</Badge>
                </div>
              </CardHeader>
              <CardContent>
                {cwpLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredCwp.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Trophy className="h-12 w-12 mb-4" />
                    <p className="text-lg font-medium">No pending activations</p>
                    <p className="text-sm">Approved proposals awaiting documents will appear here</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>Agreement Type</TableHead>
                        <TableHead>Approved</TableHead>
                        <TableHead>Timer</TableHead>
                        <TableHead>Client Signed</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCwp.map((p) => {
                        const receivedCount = (p.proposalDocuments || []).filter(d => d.category === 'received_from_client').length;
                        const requiresAwaitingDecision = shouldOpenExpiredAwaitingDecision(p);
                        return (
                          <TableRow key={p.id}>
                            <TableCell><div className="font-medium">{p.lead.client.name}</div></TableCell>
                            <TableCell>
                              <AgreementTypeChips proposal={p} />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Calendar className="h-4 w-4" />
                                {p.reviewedAt ? format(new Date(p.reviewedAt), 'MMM d, yyyy') : '—'}
                              </div>
                            </TableCell>
                            <TableCell>
                              {p.awaitingClientDueAt ? (
                                p.latestExtensionRequest?.status === 'pending' ? (
                                  <Badge variant="secondary">Pending Manager</Badge>
                                ) : requiresAwaitingDecision ? (
                                  <Badge variant="destructive">Expired</Badge>
                                ) : (
                                  <span className="text-sm text-muted-foreground">{format(new Date(p.awaitingClientDueAt), 'MMM d, yyyy')}</span>
                                )
                              ) : <span className="text-sm text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell>{receivedCount > 0 ? <CheckCircle className="h-5 w-5 text-emerald-600" /> : <XCircle className="h-5 w-5 text-red-500" />}</TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  if (shouldOpenExpiredAwaitingDecision(p)) {
                                    setExpiredAwaitingProposal(p);
                                    return;
                                  }
                                  handleViewCwpDetails(p);
                                }}
                              >
                                <Eye className="h-4 w-4 mr-1" />
                                Manage
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Proposal Details Dialog (view only for associates) */}
        <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            {selectedProposal && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    Proposal Details — {selectedProposal.lead.client.name}
                  </DialogTitle>
                </DialogHeader>

                <div className="space-y-6 py-4">
                  <div className="flex items-center gap-3">
                    {getStatusBadge(selectedProposal.status)}
                    {selectedProposal.reviewedBy && (
                      <span className="text-sm text-muted-foreground">
                        by {`${selectedProposal.reviewedBy.firstName} ${selectedProposal.reviewedBy.lastName}`.trim()}
                        {selectedProposal.reviewedAt && ` on ${format(new Date(selectedProposal.reviewedAt), 'MMM d, yyyy')}`}
                      </span>
                    )}
                  </div>

                  {selectedProposal.isForReview && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
                      <Eye className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-amber-800">Review-Only Proposal</p>
                        <p className="text-xs text-amber-700 mt-0.5">
                          The client receives a review email with the filled agreement for reading only — no PandaDoc signing link is sent.
                        </p>
                        {selectedProposal.reviewEmailSentAt ? (
                          <p className="text-xs text-amber-600 mt-1">
                            Review email sent: {format(new Date(selectedProposal.reviewEmailSentAt), 'MMM d, yyyy')}
                          </p>
                        ) : selectedProposal.status === 'approved' ? (
                          <p className="text-xs text-amber-600 mt-1">Review email send status unknown.</p>
                        ) : null}
                      </div>
                    </div>
                  )}

                  {selectedProposal.rejectionComment && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                      <p className="text-sm font-medium text-red-800">Rejection Reason</p>
                      <p className="text-sm text-red-700 mt-1 whitespace-pre-wrap">{selectedProposal.rejectionComment}</p>
                    </div>
                  )}

                  {selectedProposal.selectedContact && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium text-muted-foreground">Send To (Client Contact)</h4>
                      <div className="flex items-start gap-2 rounded-lg border p-3 bg-muted/30">
                        <div>
                          <p className="text-sm font-medium">{selectedProposal.selectedContact.name}</p>
                          {selectedProposal.selectedContact.title && (
                            <p className="text-xs text-muted-foreground">{selectedProposal.selectedContact.title}</p>
                          )}
                          <p className="text-xs text-muted-foreground">{selectedProposal.selectedContact.email}</p>
                        </div>
                      </div>
                    </div>
                  )}

                    <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">Agreement Types</h4>
                    <AgreementTypeChips proposal={selectedProposal} />
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">Payment Terms</h4>
                    <Badge variant="secondary">{getPaymentTermsLabel(selectedProposal.paymentTerms)}</Badge>
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">Location Type</h4>
                    <Badge variant="secondary" className="capitalize">
                      {selectedProposal.locationType === 'single' ? 'Single Location' : 'Multiple Locations'}
                    </Badge>
                  </div>

                  {selectedProposal.isForReview && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <FileSignature className="h-4 w-4" />
                        Agreement Preview
                      </h4>
                      {getReviewPreviewMembers(selectedProposal).map((member) => (
                        <div
                          key={member.id}
                          className="flex items-center justify-between p-3 rounded-lg border bg-amber-50/40 border-amber-200"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{member.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {member.reviewEmailSentAt
                                ? 'the agreement sent to the client'
                                : 'template frozen at submit — not the current Settings file'}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0 ml-3 gap-1"
                            disabled={reviewPreviewLoading}
                            onClick={async () => {
                              setReviewPreviewOpen(true);
                              setReviewPreviewHtml(null);
                              setReviewPreviewError(null);
                              setReviewPreviewLoading(true);
                              try {
                                const blob = member.reviewEmailSentAt
                                  ? await fetchSentReviewPdfBlob(member.id)
                                  : await fetchReviewPdfBlob(member.id);
                                const url = URL.createObjectURL(blob);
                                setReviewPreviewHtml(url);
                              } catch (err: any) {
                                setReviewPreviewError(err.message ?? 'Failed to load preview');
                              } finally {
                                setReviewPreviewLoading(false);
                              }
                            }}
                          >
                            {reviewPreviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                            Preview {getReviewPreviewMembers(selectedProposal).length > 1
                              ? (member.label.toLowerCase().includes('direct') ? 'Direct' : 'Temp')
                              : ''}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedProposal.positions?.length > 0 && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium text-muted-foreground">
                          Positions ({selectedProposal.positions.length})
                        </h4>
                        <div className="space-y-1">
                          {selectedProposal.positions.map((pos) => (
                            <div key={pos.id} className="flex items-center justify-between p-2 rounded-lg border bg-muted/30">
                              <span className="text-sm font-medium">{pos.name}</span>
                              <span className="text-sm text-muted-foreground">×{pos.count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  <Separator />

                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">
                      Attachments ({selectedProposal.attachments?.length || 0})
                    </h4>
                    {(!selectedProposal.attachments || selectedProposal.attachments.length === 0) ? (
                      <p className="text-sm text-muted-foreground italic">No attachments</p>
                    ) : (
                      <ScrollArea className="max-h-[200px]">
                        <CrmAttachmentList
                          items={(selectedProposal.attachments ?? []).map((a) => ({
                            id: a.id,
                            name: a.name,
                            mimeType: a.type,
                            size: a.size,
                          }))}
                          fetchBlob={(item) => fetchProposalAttachmentBlob(item.id)}
                          onDownload={(item) => downloadProposalAttachment(item.id, item.name)}
                        />
                      </ScrollArea>
                    )}
                  </div>

                  {selectedProposal.selectedDefaultFiles?.length > 0 && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium text-muted-foreground">
                          Default Files Included ({selectedProposal.selectedDefaultFiles.length})
                        </h4>
                        <div className="space-y-2">
                          {selectedProposal.selectedDefaultFiles.map((f) => (
                            <div
                              key={f.id}
                              className="flex items-center justify-between p-3 rounded-lg border bg-blue-50/50"
                            >
                              <div className="flex items-center gap-3">
                                {f.mimeType?.includes('pdf') ? (
                                  <FileText className="h-4 w-4 text-red-500" />
                                ) : (
                                  <File className="h-4 w-4 text-muted-foreground" />
                                )}
                                <p className="text-sm font-medium truncate max-w-[300px]">{f.name}</p>
                              </div>
                              <Button variant="ghost" size="sm" onClick={() => openFilePreview(f.id, f.name, f.mimeType ?? null)}>
                                <Eye className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  <Separator />

                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">Comments</h4>
                    {selectedProposal.comment ? (
                      <p className="text-sm whitespace-pre-wrap p-3 rounded-lg border bg-muted/30">
                        {selectedProposal.comment}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">No comments</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    Submitted on {format(new Date(selectedProposal.createdAt), 'MMM d, yyyy h:mm a')}
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setDetailsOpen(false)}>
                    Close
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Closed Won Pending Detail Dialog (associate view) */}
        <Dialog open={cwpDetailOpen} onOpenChange={(v) => { setCwpDetailOpen(v); if (!v) { setSendAgreementOpen(false); setSendManually(false); setManualUploadChecked(false); } }}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            {cwpSelected && (() => {
              const receivedDocs = (cwpSelected.proposalDocuments || []).filter(d => d.category === 'received_from_client');
              const isSigned = isReadyForActivation(cwpSelected);
              const isDocDone = isSigned || receivedDocs.length > 0;
              const signingMembers = getPairSigningMembers(cwpSelected);
              return (
                <>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Trophy className="h-5 w-5 text-amber-500 shrink-0" />
                      Awaiting Client Approval
                    </DialogTitle>
                    <DialogDescription className="truncate" title={cwpSelected.lead.client.name}>
                      {cwpSelected.lead.client.name}
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4 py-4">
                    <AwaitingClientSummary
                      owner={cwpSelected.lead.owner}
                      agreementLabels={getProposalAgreementLabels(cwpSelected)}
                      paymentTermsLabel={getPaymentTermsLabel(cwpSelected.paymentTerms)}
                      submittedAt={cwpSelected.createdAt}
                      contact={cwpSelected.selectedContact}
                      reviewedBy={cwpSelected.reviewedBy}
                      reviewedAt={cwpSelected.reviewedAt}
                      readyToActivate={isDocDone}
                      onEmailPreview={
                        isManager && cwpSelected.selectedContact
                          ? () => handlePreviewEmail(cwpSelected)
                          : undefined
                      }
                    />

                    <PairSigningStatusSection
                      members={signingMembers}
                      receivedManual={receivedDocs.length > 0}
                      isSyncing={isSyncingPandaDoc}
                      onPreview={(id) => handlePreviewAgreementById(id)}
                      onSync={(docId) => handleSyncPandaDoc(docId)}
                    />

                    {/* Manual signed document upload — shown only when nothing uploaded yet and PandaDoc not signed */}
                    {!isDocDone && (
                      <div className="rounded-md border px-3 py-3">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <Checkbox
                            id="manual-upload-check"
                            checked={manualUploadChecked}
                            onCheckedChange={(v) => setManualUploadChecked(!!v)}
                          />
                          <span className="text-sm text-muted-foreground">
                            Upload signed document manually
                          </span>
                        </label>

                        {manualUploadChecked && (
                          <div className="mt-3 pt-3 border-t">
                            <Button variant="outline" size="sm" disabled={isUploading} className="relative" asChild>
                              <label className="cursor-pointer">
                                {isUploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                                {isUploading ? 'Uploading...' : 'Choose File'}
                                <input type="file" className="sr-only" onChange={handleReceivedDocUpload} disabled={isUploading} />
                              </label>
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    {receivedDocs.length > 0 && (
                      <div className="rounded-md border overflow-hidden">
                        <div className="px-3 py-2 border-b bg-muted/40">
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Signed files
                          </h4>
                        </div>
                        <ul className="divide-y">
                          {receivedDocs.map((doc) => (
                            <li key={doc.id} className="flex items-center gap-2 px-3 py-2.5">
                              {getFileIcon(doc.type)}
                              <div className="flex-1 min-w-0">
                                {doc.agreementLabel && (
                                  <p className="text-xs text-muted-foreground truncate">{doc.agreementLabel}</p>
                                )}
                                <p className="text-sm truncate">{doc.name}</p>
                              </div>
                              <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(doc.size)}</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 shrink-0"
                                onClick={() => openProposalDocPreview(doc.id, doc.name, doc.type || null)}
                                title="Open"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <DialogFooter className="gap-2 sm:gap-2">
                    <Button variant="outline" onClick={() => setCwpDetailOpen(false)}>
                      Close
                    </Button>
                    {isManager && isDocDone && !cwpSelected.activatedAt && (
                      <Button
                        onClick={handleActivateLead}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        {isActivating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                        {isActivating ? 'Activating...' : 'Make Lead Active'}
                      </Button>
                    )}
                  </DialogFooter>
                </>
              );
            })()}
          </DialogContent>
        </Dialog>

        {cwpSelected && (
          <SendAgreementDialog
            open={sendAgreementOpen}
            onOpenChange={setSendAgreementOpen}
            proposal={cwpSelected}
            onUpdate={(update) => {
              const updated = { ...cwpSelected, ...update };
              setCwpSelected(updated);
              setCwpProposals((prev) => prev.map((p) => (p.id === cwpSelected.id ? updated : p)));
            }}
          />
        )}

        {/* Agreement preview dialog for associate flow */}
        <Dialog
          open={agreementPreviewOpen}
          onOpenChange={(v) => {
            if (!v && agreementPdfBlobUrl) {
              URL.revokeObjectURL(agreementPdfBlobUrl);
              setAgreementPdfBlobUrl(null);
            }
            setAgreementPreviewOpen(v);
          }}
        >
          <DialogContent className="max-w-[95vw] w-full p-0 gap-0 overflow-hidden flex flex-col" style={{ height: '92vh' }}>
            <DialogHeader className="px-5 py-3 border-b shrink-0">
              <DialogTitle className="flex items-center gap-2 text-base">
                <FileSignature className="h-4 w-4 text-blue-600" />
                Review Agreement Draft
                {agreementPreviewData && (
                  <span className="text-muted-foreground font-normal">— {agreementPreviewData.templateName}</span>
                )}
              </DialogTitle>
            </DialogHeader>

            {agreementPreviewLoading && (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p className="text-sm font-medium">Loading Agreement Preview...</p>
              </div>
            )}

            {agreementPreviewError && !agreementPreviewLoading && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                <AlertTriangle className="h-8 w-8 text-orange-500" />
                <p className="text-sm text-destructive font-medium">{agreementPreviewError}</p>
              </div>
            )}

            {agreementPreviewData && !agreementPreviewLoading && (
              <div className="flex flex-1 min-h-0 bg-slate-100">
                {agreementPdfBlobUrl ? (
                  <iframe
                    src={agreementPdfBlobUrl}
                    className="flex-1 w-full border-0"
                    title="Agreement PDF Preview"
                  />
                ) : (
                  <div className="flex-1 flex items-center justify-center text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                )}
              </div>
            )}

            <div className="px-5 py-3 border-t shrink-0 flex justify-end bg-muted/20">
              <Button
                variant="outline"
                onClick={() => {
                  if (agreementPdfBlobUrl) {
                    URL.revokeObjectURL(agreementPdfBlobUrl);
                    setAgreementPdfBlobUrl(null);
                  }
                  setAgreementPreviewOpen(false);
                }}
              >
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Default file preview modal for associate flow */}
        <Dialog
          open={filePreviewOpen}
          onOpenChange={(v) => {
            if (!v && filePreviewBlobUrl) {
              URL.revokeObjectURL(filePreviewBlobUrl);
              setFilePreviewBlobUrl(null);
            }
            setFilePreviewOpen(v);
          }}
        >
          <DialogContent className="max-w-4xl w-full p-0 gap-0 overflow-hidden flex flex-col" style={{ height: '90vh' }}>
            <DialogHeader className="px-5 py-3 border-b shrink-0">
              <DialogTitle className="flex items-center gap-2 text-base">
                {filePreviewMime?.includes('pdf') ? (
                  <FileText className="h-4 w-4 text-red-500" />
                ) : (
                  <File className="h-4 w-4 text-muted-foreground" />
                )}
                {filePreviewName}
              </DialogTitle>
              <DialogDescription className="sr-only">{filePreviewName}</DialogDescription>
            </DialogHeader>
            <div className="flex-1 min-h-0 flex items-center justify-center">
              {filePreviewLoading && <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />}
              {!filePreviewLoading && filePreviewBlobUrl && (
                filePreviewMime?.startsWith('image/') ? (
                  <div className="flex items-center justify-center h-full w-full p-4">
                    <img src={filePreviewBlobUrl} alt={filePreviewName} className="max-h-full max-w-full object-contain" />
                  </div>
                ) : (
                  <iframe src={filePreviewBlobUrl} title={filePreviewName} className="w-full h-full border-0" />
                )
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!expiredAwaitingProposal} onOpenChange={() => {}}>
          <DialogContent
            className="max-w-lg [&>button]:hidden"
            onEscapeKeyDown={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>Client Response Overdue</DialogTitle>
              <DialogDescription>
                The awaiting-client timer has expired for <span className="font-medium">{expiredAwaitingProposal?.lead.client.name}</span>. Provide a reason and decide whether to request an extension.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-2">
                <Label>Why has the client not responded?</Label>
                <Textarea
                  value={awaitingNoResponseReason}
                  onChange={(e) => setAwaitingNoResponseReason(e.target.value)}
                  placeholder="Enter reason..."
                  rows={3}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={awaitingRequestExtension} onCheckedChange={(v) => setAwaitingRequestExtension(!!v)} />
                Request extension from manager
              </label>
              {awaitingRequestExtension && (
                <div className="rounded-md border p-3 space-y-3">
                  <div className="space-y-1">
                    <Label>Extension reason</Label>
                    <Textarea
                      value={awaitingExtensionReason}
                      onChange={(e) => setAwaitingExtensionReason(e.target.value)}
                      placeholder="Why do you need extra days?"
                      rows={2}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Additional days</Label>
                    <Input
                      type="number"
                      min={1}
                      value={awaitingExtensionDays}
                      onChange={(e) => setAwaitingExtensionDays(Math.max(1, parseInt(e.target.value || '1', 10)))}
                      className="w-32"
                    />
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={handleSubmitExpiredAwaitingDecision} disabled={awaitingDecisionSubmitting}>
                {awaitingDecisionSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Submit Decision
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="px-6 pb-6 pt-0 space-y-6">
      <div className="flex items-center justify-between pt-6">
        <div>
          <h1 className="text-2xl font-bold">Proposals</h1>
          <p className="text-muted-foreground">Review and approve/reject proposals</p>
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

      {/* ── All-Agencies Sectioned View ─────────────────────────────────────── */}
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
              <AgencyProposalSection
                key={agency.id}
                agency={agency}
                onViewAgency={() => setSelectedAgencyId(agency.id)}
                dateRange={dateRange}
                onViewDetails={handleViewDetails}
                onViewCwp={handleViewCwpDetails}
                onMakeActive={handleMakeActive}
                ownerIds={resolvedOwnerIds}
                scopeKey={`${scopeKey}|${resolvedOwnerIds?.join(',') ?? ''}`}
              />
            ))}
          </div>
        )
      )}

      {/* ── All Team — one section per user ─────────────────────────────────── */}
      {showAllTeamView && (
        managerTeamUsers.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-12">
            {showManagerSections ? 'No managers / team in this agency' : 'No team members in this scope'}
          </p>
        ) : (
          <div className="space-y-4">
            {managerTeamUsers.map((user, i) => (
              <UserProposalSection
                key={user.id}
                user={user}
                colorIndex={i}
                onViewUser={() =>
                  showManagerSections ? setSelectedManagerId(user.id) : setSelectedUserId(user.id)
                }
              />
            ))}
          </div>
        )
      )}

      {/* ── Single-Agency / Own Proposals Tabs ──────────────────────────────── */}
      {!showAgencySections && !showAllTeamView && <Tabs value={activeTab} onValueChange={setActiveTab}>
        <StickyHeader>
          <TabsList>
          <TabsTrigger value="pending" className="gap-2">
            <FileText className="h-4 w-4" />
            Pending Review
            {total > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{total}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="closed_won_pending" className="gap-2">
            <Trophy className="h-4 w-4" />
            Awaiting Client Approval
            {awaitingClientProposals.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{awaitingClientProposals.length}</Badge>
            )}
          </TabsTrigger>
          {isManager && (
            <TabsTrigger value="proposal_extensions" className="gap-2">
              <FileSignature className="h-4 w-4" />
              Proposal Extension Requests
              {(filteredPendingExtensionRequests.length + filteredExtensionRequestHistory.length) > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {filteredPendingExtensionRequests.length + filteredExtensionRequestHistory.length}
                </Badge>
              )}
            </TabsTrigger>
          )}
          <TabsTrigger value="pending_activations" className="gap-2">
            <Zap className="h-4 w-4" />
            Pending Activations
            {pendingActivationProposals.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{pendingActivationProposals.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="h-4 w-4" />
            History
            {historyTotal > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{historyTotal}</Badge>
            )}
          </TabsTrigger>
        </TabsList>
        </StickyHeader>

        {/* Pending Tab */}
        <TabsContent value="pending">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-4">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by client or owner..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : filteredProposals.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <FileText className="h-12 w-12 mb-4" />
                  <p className="text-lg font-medium">No pending proposals</p>
                  <p className="text-sm">All proposals have been reviewed</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Agreement Type</TableHead>
                      <TableHead>Payment Terms</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProposals.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="font-medium">{p.lead.client.name}</div>
                          {p.isForReview && p.selectedContact && (
                            <div className="text-xs text-muted-foreground mt-0.5">To: {p.selectedContact.name} · {p.selectedContact.email}</div>
                          )}
                          {p.isForReview && (
                            <Badge className="mt-1 text-xs bg-amber-100 text-amber-800 hover:bg-amber-100 border border-amber-300"><Mail className="h-3 w-3 mr-1" />For Review</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-muted-foreground" />
                            {`${p.lead.owner.firstName} ${p.lead.owner.lastName}`.trim()}
                          </div>
                        </TableCell>
                        <TableCell>
                          <AgreementTypeChips proposal={p} />
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{getPaymentTermsLabel(p.paymentTerms)}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Calendar className="h-4 w-4" />
                            {format(new Date(p.createdAt), 'MMM d, yyyy')}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <ProposalChainActions
                              proposal={p}
                              compact
                              onView={() => handleViewDetails(p)}
                              makeActiveSlot={isManager && !p.isForReview ? (
                                <ProposalMakeActiveButton
                                  proposalId={p.id}
                                  subCompanyId={p.lead.subCompanyId}
                                  onClick={() => handleMakeActive(p)}
                                  disabled={isActing}
                                />
                              ) : undefined}
                              onComplete={() => {
                                loadProposals(true);
                                loadHistory(true);
                                loadCwp();
                              }}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-4">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by client, owner, or reviewer..."
                    value={historySearchTerm}
                    onChange={(e) => setHistorySearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {historyLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : filteredHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <History className="h-12 w-12 mb-4" />
                  <p className="text-lg font-medium">No proposal history</p>
                  <p className="text-sm">Reviewed proposals will appear here</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Agreement Type</TableHead>
                      <TableHead>Payment Terms</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reviewed By</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredHistory.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="font-medium">{p.lead.client.name}</div>
                          {p.isForReview && (
                            <Badge className="mt-1 text-xs bg-amber-100 text-amber-800 hover:bg-amber-100 border border-amber-300">
                              <Eye className="h-3 w-3 mr-1" />For Review
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-muted-foreground" />
                            {`${p.lead.owner.firstName} ${p.lead.owner.lastName}`.trim()}
                          </div>
                        </TableCell>
                        <TableCell>
                          <AgreementTypeChips proposal={p} />
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{getPaymentTermsLabel(p.paymentTerms)}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Calendar className="h-4 w-4" />
                            {format(new Date(p.createdAt), 'MMM d, yyyy')}
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(p.status)}</TableCell>
                        <TableCell>
                          {p.reviewedBy ? (
                            <div className="text-sm">
                              <div className="flex items-center gap-2">
                                <User className="h-4 w-4 text-muted-foreground" />
                                {`${p.reviewedBy.firstName} ${p.reviewedBy.lastName}`.trim()}
                              </div>
                              {p.reviewedAt && (
                                <span className="text-xs text-muted-foreground">
                                  {format(new Date(p.reviewedAt), 'MMM d, yyyy')}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" onClick={() => handleViewDetails(p)}>
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Client Preview Tab */}
        {/* Awaiting Client Approval Tab */}
        <TabsContent value="closed_won_pending">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-4">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by client or owner..."
                    value={cwpSearchTerm}
                    onChange={(e) => setCwpSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Badge variant="secondary">{awaitingClientProposals.length} Awaiting Client</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {cwpLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : filteredAwaitingClient.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Trophy className="h-12 w-12 mb-4" />
                  <p className="text-lg font-medium">No proposals awaiting client approval</p>
                  <p className="text-sm">Approved proposals sent to clients will appear here</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Agreement Type</TableHead>
                      <TableHead>Approved</TableHead>
                      <TableHead>Timer</TableHead>
                      <TableHead>Client Signed</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAwaitingClient.map((p) => {
                      const receivedCount = (p.proposalDocuments || []).filter(d => d.category === 'received_from_client').length;
                      return (
                        <TableRow key={p.id}>
                          <TableCell><div className="font-medium">{p.lead.client.name}</div></TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-muted-foreground" />
                              {`${p.lead.owner.firstName} ${p.lead.owner.lastName}`.trim()}
                            </div>
                          </TableCell>
                          <TableCell>
                            <AgreementTypeChips proposal={p} />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Calendar className="h-4 w-4" />
                              {p.reviewedAt ? format(new Date(p.reviewedAt), 'MMM d, yyyy') : '—'}
                            </div>
                          </TableCell>
                          <TableCell>
                            {p.awaitingClientDueAt ? (
                              awaitingClientTimerShowsExpired(p) ? (
                                <Badge variant="destructive">Expired</Badge>
                              ) : (
                                <span className="text-sm text-muted-foreground">{format(new Date(p.awaitingClientDueAt), 'MMM d, yyyy')}</span>
                              )
                            ) : <span className="text-sm text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell>{receivedCount > 0 ? <CheckCircle className="h-5 w-5 text-emerald-600" /> : <XCircle className="h-5 w-5 text-red-500" />}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="outline" size="sm" onClick={() => handleViewCwpDetails(p)}>
                              <Eye className="h-4 w-4 mr-1" />
                              Manage
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Proposal Extension Requests Tab */}
        {isManager && (
          <TabsContent value="proposal_extensions">
            <Card>
              <CardHeader>
                <h4 className="text-sm font-medium">Proposal Extension Requests</h4>
              </CardHeader>
              <CardContent>
                <Tabs value={proposalExtensionTab} onValueChange={(value) => setProposalExtensionTab(value as 'pending' | 'history')}>
                  <TabsList className="grid w-full max-w-sm grid-cols-2">
                    <TabsTrigger value="pending">Pending ({filteredPendingExtensionRequests.length})</TabsTrigger>
                    <TabsTrigger value="history">History ({filteredExtensionRequestHistory.length})</TabsTrigger>
                  </TabsList>

                  <TabsContent value="pending" className="mt-3">
                    {pendingExtensionRequestsLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : filteredPendingExtensionRequests.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No pending requests.</p>
                    ) : (
                      <div className="space-y-2">
                        {filteredPendingExtensionRequests.map((r) => (
                          <div key={r.id} className="flex items-center justify-between gap-3 rounded border p-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{r.proposal.lead.client.name}</p>
                              <p className="text-xs text-muted-foreground truncate">{r.reason} ({r.requestedDays} days)</p>
                            </div>
                            <div className="shrink-0 min-w-[200px]">
                              <ApprovalQueueActions
                                workflow="proposal_extension"
                                entityId={r.id}
                                subCompanyId={writeAgencyId ?? currentUser.subCompanyId}
                                compact
                                onActionComplete={() => void refreshProposalExtensions()}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="history" className="mt-3">
                    {pendingExtensionRequestsLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : filteredExtensionRequestHistory.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No approved/rejected requests yet.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Associate</TableHead>
                            <TableHead>Client</TableHead>
                            <TableHead>Days</TableHead>
                            <TableHead>Reason</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Reviewed</TableHead>
                            <TableHead>Remarks</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredExtensionRequestHistory.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell>{`${r.requestedBy?.firstName ?? ''} ${r.requestedBy?.lastName ?? ''}`.trim() || r.requestedBy?.email || '—'}</TableCell>
                              <TableCell>{r.proposal.lead.client.name}</TableCell>
                              <TableCell>{r.requestedDays}</TableCell>
                              <TableCell className="max-w-[260px] truncate" title={r.reason}>{r.reason}</TableCell>
                              <TableCell>{r.status === 'approved' ? <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Approved</Badge> : <Badge variant="destructive">Rejected</Badge>}</TableCell>
                              <TableCell>{r.reviewedAt ? format(new Date(r.reviewedAt), 'MMM d, yyyy') : '—'}</TableCell>
                              <TableCell className="max-w-[260px] truncate" title={r.reviewComment ?? ''}>{r.reviewComment || '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Pending Activations Tab */}
        <TabsContent value="pending_activations">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-4">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by client or owner..."
                    value={paSearchTerm}
                    onChange={(e) => setPaSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Badge variant="secondary">{pendingActivationProposals.length} Pending Activation</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {cwpLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : filteredPendingActivation.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Zap className="h-12 w-12 mb-4" />
                  <p className="text-lg font-medium">No pending activations</p>
                  <p className="text-sm">Proposals submitted for activation will appear here</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Agreement Type</TableHead>
                      <TableHead>Approved</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPendingActivation.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell><div className="font-medium">{p.lead.client.name}</div></TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-muted-foreground" />
                            {`${p.lead.owner.firstName} ${p.lead.owner.lastName}`.trim()}
                          </div>
                        </TableCell>
                        <TableCell>
                          <AgreementTypeChips proposal={p} />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Calendar className="h-4 w-4" />
                            {p.reviewedAt ? format(new Date(p.reviewedAt), 'MMM d, yyyy') : '—'}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" onClick={() => handleViewCwpDetails(p)}>
                            <Eye className="h-4 w-4 mr-1" />
                            Manage
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>}

      {/* Proposal Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedProposal && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Proposal Details — {selectedProposal.lead.client.name}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-6 py-4">
                {/* Show status + reviewer info for reviewed proposals */}
                {selectedProposal.status !== 'pending' && (
                  <div className="flex items-center gap-3">
                    {getStatusBadge(selectedProposal.status)}
                    {selectedProposal.reviewedBy && (
                      <span className="text-sm text-muted-foreground">
                        by {`${selectedProposal.reviewedBy.firstName} ${selectedProposal.reviewedBy.lastName}`.trim()}
                        {selectedProposal.reviewedAt && ` on ${format(new Date(selectedProposal.reviewedAt), 'MMM d, yyyy')}`}
                      </span>
                    )}
                  </div>
                )}

                {/* For Review banner */}
                {selectedProposal.isForReview && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
                    <Eye className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-amber-800">Review-Only Proposal</p>
                      <p className="text-xs text-amber-700 mt-0.5">
                        A review email was sent to the client with the agreement for reading only. No PandaDoc signing request was sent.
                      </p>
                      {selectedProposal.reviewEmailSentAt && (
                        <p className="text-xs text-amber-600 mt-1">
                          Review email sent: {format(new Date(selectedProposal.reviewEmailSentAt), 'MMM d, yyyy')}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Rejection reason */}
                {selectedProposal.rejectionComment && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                    <p className="text-sm font-medium text-red-800">Rejection Reason</p>
                    <p className="text-sm text-red-700 mt-1 whitespace-pre-wrap">{selectedProposal.rejectionComment}</p>
                  </div>
                )}

                <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
                  <User className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Submitted by</p>
                    <p className="font-medium">
                      {`${selectedProposal.lead.owner.firstName} ${selectedProposal.lead.owner.lastName}`.trim()}
                    </p>
                  </div>
                </div>

                {selectedProposal.selectedContact && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">Send To (Client Contact)</h4>
                    <div className="rounded-lg border p-3 bg-muted/30">
                      <p className="text-sm font-medium">{selectedProposal.selectedContact.name}</p>
                      {selectedProposal.selectedContact.title && (
                        <p className="text-xs text-muted-foreground">{selectedProposal.selectedContact.title}</p>
                      )}
                      <p className="text-xs text-muted-foreground">{selectedProposal.selectedContact.email}</p>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Agreement Types</h4>
                  <AgreementTypeChips proposal={selectedProposal} />
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Payment Terms</h4>
                  <Badge variant="secondary">{getPaymentTermsLabel(selectedProposal.paymentTerms)}</Badge>
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Location Type</h4>
                  <Badge variant="secondary" className="capitalize">
                    {selectedProposal.locationType === 'single' ? 'Single Location' : 'Multiple Locations'}
                  </Badge>
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Primary Location</h4>
                  <div className="p-3 rounded-lg border bg-muted/30">
                    <div className="font-medium">{selectedProposal.lead.client.name}</div>
                    <div className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                      <MapPin className="h-3 w-3" />
                      Client location
                    </div>
                  </div>
                </div>

                {/* Agreement Preview Section */}
                {selectedProposal.isForReview ? (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <FileSignature className="h-4 w-4" />
                      Agreement Preview
                    </h4>
                    {getReviewPreviewMembers(selectedProposal).map((member) => (
                      <div
                        key={member.id}
                        className="flex items-center justify-between p-3 rounded-lg border bg-amber-50/40 border-amber-200"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{member.label}</p>
                          <p className="text-xs text-muted-foreground">click to review auto-filled values</p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0 ml-3 gap-1"
                          disabled={reviewPreviewLoading}
                          onClick={async () => {
                            setReviewPreviewOpen(true);
                            setReviewPreviewHtml(null);
                            setReviewPreviewError(null);
                            setReviewPreviewLoading(true);
                            try {
                              const blob = member.reviewEmailSentAt
                                ? await fetchSentReviewPdfBlob(member.id)
                                : await fetchReviewPdfBlob(member.id);
                              const url = URL.createObjectURL(blob);
                              setReviewPreviewHtml(url);
                            } catch (err: any) {
                              setReviewPreviewError(err.message ?? 'Failed to load preview');
                            } finally {
                              setReviewPreviewLoading(false);
                            }
                          }}
                        >
                          {reviewPreviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                          Preview {getReviewPreviewMembers(selectedProposal).length > 1
                            ? (member.label.toLowerCase().includes('direct') ? 'Direct' : 'Temp')
                            : ''}
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : getPandaDocPreviewMembers(selectedProposal).length > 0 ? (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <FileSignature className="h-4 w-4" />
                      Agreement Preview
                    </h4>
                    {getPandaDocPreviewMembers(selectedProposal).map((member) => (
                      <div
                        key={member.id}
                        className="flex items-center justify-between p-3 rounded-lg border bg-blue-50/40 border-blue-200"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{member.label}</p>
                          <p className="text-xs text-muted-foreground">click to review auto-filled values</p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handlePreviewAgreementById(member.id)}
                          className="shrink-0 ml-3 gap-1"
                        >
                          <BookOpen className="h-4 w-4" />
                          Preview {getPandaDocPreviewMembers(selectedProposal).length > 1
                            ? (member.label.toLowerCase().includes('direct') ? 'Direct' : 'Temp')
                            : ''}
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* Message to Client */}
                {selectedProposal.clientMessage && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      Message to Client
                    </h4>
                    <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/40">
                      <div
                        className="text-sm leading-relaxed prose prose-sm max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1"
                        dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(selectedProposal.clientMessage) }}
                      />
                    </div>
                  </div>
                )}

                {selectedProposal.positions?.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium text-muted-foreground">
                        Positions ({selectedProposal.positions.length})
                      </h4>
                      <div className="space-y-1">
                        {selectedProposal.positions.map((pos) => (
                          <div key={pos.id} className="flex items-center justify-between p-2 rounded-lg border bg-muted/30">
                            <span className="text-sm font-medium">{pos.name}</span>
                            <span className="text-sm text-muted-foreground">×{pos.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                <Separator />

                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">
                    Attachments ({selectedProposal.attachments?.length || 0})
                  </h4>
                  {(!selectedProposal.attachments || selectedProposal.attachments.length === 0) ? (
                    <p className="text-sm text-muted-foreground italic">No attachments</p>
                  ) : (
                    <ScrollArea className="max-h-[200px]">
                      <CrmAttachmentList
                        items={(selectedProposal.attachments ?? []).map((a) => ({
                          id: a.id,
                          name: a.name,
                          mimeType: a.type,
                          size: a.size,
                        }))}
                        fetchBlob={(item) => fetchProposalAttachmentBlob(item.id)}
                        onDownload={(item) => downloadProposalAttachment(item.id, item.name)}
                      />
                    </ScrollArea>
                  )}
                </div>

                {selectedProposal.selectedDefaultFiles?.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium text-muted-foreground">
                        Default Files Included ({selectedProposal.selectedDefaultFiles.length})
                      </h4>
                      <div className="space-y-2">
                        {selectedProposal.selectedDefaultFiles.map((f) => (
                          <div
                            key={f.id}
                            className="flex items-center justify-between p-3 rounded-lg border bg-blue-50/50"
                          >
                            <div className="flex items-center gap-3">
                              {f.mimeType?.includes('pdf') ? (
                                <FileText className="h-4 w-4 text-red-500" />
                              ) : (
                                <File className="h-4 w-4 text-muted-foreground" />
                              )}
                              <p className="text-sm font-medium truncate max-w-[300px]">{f.name}</p>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => openFilePreview(f.id, f.name, f.mimeType ?? null)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Comments</h4>
                  {selectedProposal.comment ? (
                    <p className="text-sm whitespace-pre-wrap p-3 rounded-lg border bg-muted/30">
                      {selectedProposal.comment}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No comments</p>
                  )}
                </div>

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  Submitted on {format(new Date(selectedProposal.createdAt), 'MMM d, yyyy h:mm a')}
                </div>
              </div>

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setDetailsOpen(false)}>
                  Close
                </Button>
                {selectedProposal.status === 'pending' && (
                  <ProposalChainActions
                    proposal={selectedProposal}
                    makeActiveSlot={isManager && !selectedProposal.isForReview ? (
                      <ProposalMakeActiveButton
                        proposalId={selectedProposal.id}
                        subCompanyId={selectedProposal.lead.subCompanyId}
                        onClick={() => handleMakeActive(selectedProposal)}
                        disabled={isActing}
                      />
                    ) : undefined}
                    onComplete={() => {
                      setDetailsOpen(false);
                      loadProposals(true);
                      loadHistory(true);
                      loadCwp();
                    }}
                  />
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Make Active — upload client-signed agreement, then activate */}
      <Dialog
        open={makeActiveOpen}
        onOpenChange={(v) => {
          if (makeActiveSubmitting) return;
          setMakeActiveOpen(v);
          if (!v) {
            setMakeActiveProposal(null);
            setMakeActiveFile(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSignature className="h-5 w-5 text-emerald-600" />
              Upload Client-Signed Agreement
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {makeActiveProposal && (
              <p className="text-sm text-muted-foreground">
                Upload the signed agreement returned by{' '}
                <span className="font-medium text-foreground">{makeActiveProposal.lead.client.name}</span>.
                Once submitted, the lead will be marked active and moved to Closed Won.
              </p>
            )}

            <label
              className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-6 text-center cursor-pointer transition ${
                makeActiveFile ? 'border-emerald-300 bg-emerald-50/40' : 'border-muted-foreground/20 hover:bg-muted/30'
              }`}
            >
              <Upload className="h-5 w-5 text-muted-foreground" />
              {makeActiveFile ? (
                <>
                  <span className="text-sm font-medium break-all">{makeActiveFile.name}</span>
                  <span className="text-xs text-muted-foreground">Click to choose a different file</span>
                </>
              ) : (
                <>
                  <span className="text-sm font-medium">Choose signed agreement</span>
                  <span className="text-xs text-muted-foreground">PDF or document file</span>
                </>
              )}
              <input
                type="file"
                accept=".pdf,.doc,.docx,application/pdf"
                className="hidden"
                disabled={makeActiveSubmitting}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setMakeActiveFile(f);
                  e.target.value = '';
                }}
              />
            </label>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMakeActiveOpen(false)}
              disabled={makeActiveSubmitting}
            >
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleMakeActiveSubmit}
              disabled={!makeActiveFile || makeActiveSubmitting}
            >
              {makeActiveSubmitting ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-1" />
              )}
              {makeActiveSubmitting ? 'Activating...' : 'Submit & Activate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email Preview Dialog */}
      <Dialog open={emailPreviewOpen} onOpenChange={setEmailPreviewOpen}>
        <DialogContent className="max-w-3xl w-full h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-blue-600" />
              Client Email Preview
            </DialogTitle>
          </DialogHeader>

          {emailPreviewLoading && (
            <div className="flex flex-1 items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-sm">Loading preview…</span>
            </div>
          )}

          {emailPreviewError && !emailPreviewLoading && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <AlertTriangle className="h-8 w-8 text-orange-500" />
              <p className="text-sm text-destructive font-medium">{emailPreviewError}</p>
            </div>
          )}

          {emailPreviewData && !emailPreviewLoading && (
            <>
              {/* Meta bar */}
              <div className="px-5 py-3 border-b bg-muted/30 shrink-0 space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground w-14 shrink-0">To:</span>
                  <span className="font-medium">{emailPreviewData.contactName}</span>
                  <span className="text-muted-foreground">({emailPreviewData.to})</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground w-14 shrink-0">Subject:</span>
                  <span className="font-medium">{emailPreviewData.subject}</span>
                </div>
              </div>

              {/* Rendered email */}
              <iframe
                srcDoc={emailPreviewData.html}
                sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                className="flex-1 w-full border-0"
                title="Client email preview"
              />
            </>
          )}

          <div className="px-6 py-3 border-t shrink-0 flex justify-end">
            <Button variant="outline" onClick={() => setEmailPreviewOpen(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Review DOCX Preview Modal */}
      <Dialog open={reviewPreviewOpen} onOpenChange={(v) => {
        if (!v && reviewPreviewHtml) { URL.revokeObjectURL(reviewPreviewHtml); setReviewPreviewHtml(null); }
        setReviewPreviewOpen(v);
      }}>
        <DialogContent className="max-w-4xl w-full flex flex-col gap-0 p-0 overflow-hidden" style={{ height: '90vh' }}>
          <DialogHeader className="px-5 py-3 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" />
              Agreement Preview — Filled
            </DialogTitle>
            <DialogDescription className="text-xs">Tokens replaced with real proposal data — this is what the client receives</DialogDescription>
          </DialogHeader>
          <div className="flex-1 relative overflow-hidden">
            {reviewPreviewLoading && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground bg-background">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Generating preview…</span>
              </div>
            )}
            {reviewPreviewError && !reviewPreviewLoading && (
              <div className="absolute inset-0 flex items-center justify-center text-destructive text-sm">{reviewPreviewError}</div>
            )}
            {reviewPreviewHtml && !reviewPreviewLoading && (
              <iframe
                src={reviewPreviewHtml}
                className="w-full h-full border-0"
                title="Agreement Preview"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Agreement Preview Dialog — two-panel: fill report + live PDF */}
      <Dialog open={agreementPreviewOpen} onOpenChange={(v) => {
        if (!v && agreementPdfBlobUrl) { URL.revokeObjectURL(agreementPdfBlobUrl); setAgreementPdfBlobUrl(null); }
        setAgreementPreviewOpen(v);
      }}>
        <DialogContent className="max-w-[95vw] w-full p-0 gap-0 overflow-hidden flex flex-col" style={{ height: '92vh' }}>
          {/* Header */}
          <DialogHeader className="px-5 py-3 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileSignature className="h-4 w-4 text-blue-600" />
              Review Agreement Draft
              {agreementPreviewData && (
                <span className="text-muted-foreground font-normal">— {agreementPreviewData.templateName}</span>
              )}
            </DialogTitle>
            {agreementPreviewData && (
              <div className="flex items-center gap-3 mt-1">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  ✓ {agreementPreviewData.filled} filled
                </span>
                {agreementPreviewData.total - agreementPreviewData.filled > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                    ⚠ {agreementPreviewData.total - agreementPreviewData.filled} missing
                  </span>
                )}
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  📋 {agreementPreviewData.total} total
                </span>
              </div>
            )}
          </DialogHeader>

          {/* Loading */}
          {agreementPreviewLoading && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <div className="text-center">
                <p className="text-sm font-medium">Loading Agreement Preview…</p>
                <p className="text-xs mt-1">Fetching pre-generated preview. If not ready yet, generating now — this may take up to 20 seconds.</p>
              </div>
            </div>
          )}

          {/* Error */}
          {agreementPreviewError && !agreementPreviewLoading && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <AlertTriangle className="h-8 w-8 text-orange-500" />
              <p className="text-sm text-destructive font-medium">{agreementPreviewError}</p>
            </div>
          )}

          {/* Two-panel body */}
          {agreementPreviewData && !agreementPreviewLoading && (
            <div className="flex flex-1 min-h-0">
              {/* Left: fill report */}
              <div className="w-[300px] shrink-0 border-r flex flex-col">
                <div className="px-3 py-2 border-b bg-muted/30 shrink-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Auto-filled Values</p>
                  <p className="text-xs text-muted-foreground mt-0.5">All values sourced from system data</p>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-4">
                  {(() => {
                    const categoryIcon: Record<string, string> = {
                      Client: '🏢', Contact: '👤', Agency: '🏛', Date: '📅', Lead: '💼', Sender: '👔', Other: '📋',
                    };
                    const categorize = (name: string) => {
                      const n = name.toLowerCase().replace(/[._\s-]/g, '');
                      if (/^(date|today|currentdate|signingdate|agreementdate|effectivedate|year|currentyear|datetoday|todaydate)/.test(n)) return 'Date';
                      if (/^(agency|staffingagency|agencycompany)/.test(n)) return 'Agency';
                      if (/^(contact|recipient)/.test(n)) return 'Contact';
                      if (['senderfirstname','senderlastname','senderemail','senderphone','repemail','salesrepemail'].includes(n) || /^(sender|repname|salesrep)/.test(n)) return 'Sender';
                      if (/^(contractvalue|dealvalue|leadvalue)$/.test(n) || n === 'value') return 'Lead';
                      if (/^(client|company|industry|location|address|companysize)/.test(n)) return 'Client';
                      return 'Other';
                    };
                    const grouped = agreementPreviewData.filledTokens.reduce<Record<string, typeof agreementPreviewData.filledTokens>>((acc, t) => {
                      const cat = categorize(t.name);
                      if (!acc[cat]) acc[cat] = [];
                      acc[cat].push(t);
                      return acc;
                    }, {});
                    return Object.entries(grouped).map(([cat, catTokens]) => (
                      <div key={cat}>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1">
                          <span>{categoryIcon[cat] ?? '📋'}</span>{cat}
                        </p>
                        <div className="space-y-2">
                          {catTokens.map((t) => (
                            <div key={t.name} className="space-y-0.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-medium text-slate-600 truncate">{t.name}</span>
                                {t.filled ? (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700 shrink-0">✓ Filled</span>
                                ) : (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 shrink-0">⚠ Missing</span>
                                )}
                              </div>
                              <input
                                readOnly
                                value={t.value || ''}
                                placeholder={t.filled ? '' : 'not set in system'}
                                className={`w-full text-xs px-2 py-1.5 rounded border outline-none ${
                                  t.filled
                                    ? 'border-green-200 bg-green-50 text-green-800'
                                    : 'border-dashed border-amber-300 bg-amber-50 text-amber-600 italic placeholder:text-amber-400'
                                }`}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>

              {/* Right: PDF preview */}
              <div className="flex-1 flex flex-col bg-slate-100">
                <div className="px-4 py-2 border-b bg-slate-50 shrink-0 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-slate-700">Document Preview</span>
                  <span className="text-xs text-muted-foreground ml-auto">Draft only — not sent to client</span>
                </div>
                {agreementPdfBlobUrl ? (
                  <iframe
                    src={agreementPdfBlobUrl}
                    className="flex-1 w-full border-0"
                    title="Agreement PDF Preview"
                  />
                ) : (
                  <div className="flex-1 flex items-center justify-center text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="px-5 py-3 border-t shrink-0 flex justify-end bg-muted/20">
            <Button variant="outline" onClick={() => {
              if (agreementPdfBlobUrl) { URL.revokeObjectURL(agreementPdfBlobUrl); setAgreementPdfBlobUrl(null); }
              setAgreementPreviewOpen(false);
            }}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reject Confirmation Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reject Proposal</DialogTitle>
            <DialogDescription>
              The lead will stay in its current stage. The owner will be notified and can resubmit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <Label htmlFor="rejectReason">Reason <span className="text-destructive">*</span></Label>
            <Textarea
              id="rejectReason"
              placeholder="Enter reason for rejection..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)} disabled={isActing}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRejectConfirm} disabled={isActing || !rejectReason.trim()}>
              {isActing ? 'Rejecting...' : 'Confirm Rejection'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Closed Won Pending Detail Dialog */}
      <Dialog open={cwpDetailOpen} onOpenChange={(v) => { setCwpDetailOpen(v); if (!v) { setSendAgreementOpen(false); setSendManually(false); setManualUploadChecked(false); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {cwpSelected && (() => {
            const receivedDocs = (cwpSelected.proposalDocuments || []).filter(d => d.category === 'received_from_client');
            const isSigned = isReadyForActivation(cwpSelected);
            const isDocDone = isSigned || receivedDocs.length > 0;
            const signingMembers = getPairSigningMembers(cwpSelected);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Trophy className="h-5 w-5 text-amber-500 shrink-0" />
                    Awaiting Client Approval
                  </DialogTitle>
                  <DialogDescription className="truncate" title={cwpSelected.lead.client.name}>
                    {cwpSelected.lead.client.name}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <AwaitingClientSummary
                    owner={cwpSelected.lead.owner}
                    agreementLabels={getProposalAgreementLabels(cwpSelected)}
                    paymentTermsLabel={getPaymentTermsLabel(cwpSelected.paymentTerms)}
                    submittedAt={cwpSelected.createdAt}
                    contact={cwpSelected.selectedContact}
                    reviewedBy={cwpSelected.reviewedBy}
                    reviewedAt={cwpSelected.reviewedAt}
                    readyToActivate={isDocDone}
                    onEmailPreview={
                      cwpSelected.selectedContact
                        ? () => handlePreviewEmail(cwpSelected)
                        : undefined
                    }
                  />

                  <PairSigningStatusSection
                    members={signingMembers}
                    receivedManual={receivedDocs.length > 0}
                    isSyncing={isSyncingPandaDoc}
                    onPreview={(id) => handlePreviewAgreementById(id)}
                    onSync={(docId) => handleSyncPandaDoc(docId)}
                  />

                  {/* Uploaded signed documents — visible to manager */}
                  {receivedDocs.length > 0 && (
                    <div className="rounded-md border overflow-hidden">
                      <div className="px-3 py-2 border-b bg-muted/40">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Signed files
                        </h4>
                      </div>
                      <ul className="divide-y">
                        {receivedDocs.map((doc) => (
                          <li key={doc.id} className="flex items-center gap-2 px-3 py-2.5">
                            {getFileIcon(doc.type)}
                            <div className="flex-1 min-w-0">
                              {doc.agreementLabel && (
                                <p className="text-xs text-muted-foreground truncate">{doc.agreementLabel}</p>
                              )}
                              <p className="text-sm truncate">{doc.name}</p>
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(doc.size)}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 shrink-0"
                              onClick={() => openProposalDocPreview(doc.id, doc.name, doc.type || null)}
                              title="Open"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <DialogFooter className="gap-2 sm:gap-2">
                  <Button variant="outline" onClick={() => setCwpDetailOpen(false)}>
                    Close
                  </Button>
                  {isDocDone && !cwpSelected.activatedAt && (
                    <Button
                      onClick={handleActivateLead}
                      disabled={isActivating}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      {isActivating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                      {isActivating ? 'Activating...' : 'Make Lead Active'}
                    </Button>
                  )}
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {cwpSelected && (
        <SendAgreementDialog
          open={sendAgreementOpen}
          onOpenChange={setSendAgreementOpen}
          proposal={cwpSelected}
          onUpdate={(update) => {
            const updated = { ...cwpSelected, ...update };
            setCwpSelected(updated);
            setCwpProposals((prev) => prev.map((p) => (p.id === cwpSelected.id ? updated : p)));
          }}
        />
      )}

      {/* Review Rejection Dialog */}
      <Dialog open={rejectReviewOpen} onOpenChange={setRejectReviewOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Request Resubmission</DialogTitle>
            <DialogDescription>
              The associate will be notified and can address the issues before resubmitting.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <Label htmlFor="rejectReviewComment">Reason <span className="text-destructive">*</span></Label>
            <Textarea
              id="rejectReviewComment"
              placeholder="Describe what needs to be corrected or resubmitted..."
              value={rejectReviewComment}
              onChange={(e) => setRejectReviewComment(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectReviewOpen(false)} disabled={isRejectingReview}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRejectReview} disabled={isRejectingReview || !rejectReviewComment.trim()}>
              {isRejectingReview ? 'Rejecting...' : 'Confirm Rejection'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!expiredAwaitingProposal} onOpenChange={() => {}}>
        <DialogContent
          className="max-w-lg [&>button]:hidden"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Client Response Overdue</DialogTitle>
            <DialogDescription>
              The awaiting-client timer has expired for <span className="font-medium">{expiredAwaitingProposal?.lead.client.name}</span>. Provide a reason and decide whether to request an extension.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Why has the client not responded?</Label>
              <Textarea
                value={awaitingNoResponseReason}
                onChange={(e) => setAwaitingNoResponseReason(e.target.value)}
                placeholder="Enter reason..."
                rows={3}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={awaitingRequestExtension} onCheckedChange={(v) => setAwaitingRequestExtension(!!v)} />
              Request extension from manager
            </label>
            {awaitingRequestExtension && (
              <div className="rounded-md border p-3 space-y-3">
                <div className="space-y-1">
                  <Label>Extension reason</Label>
                  <Textarea
                    value={awaitingExtensionReason}
                    onChange={(e) => setAwaitingExtensionReason(e.target.value)}
                    placeholder="Why do you need extra days?"
                    rows={2}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Additional days</Label>
                  <Input
                    type="number"
                    min={1}
                    value={awaitingExtensionDays}
                    onChange={(e) => setAwaitingExtensionDays(Math.max(1, parseInt(e.target.value || '1', 10)))}
                    className="w-32"
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={handleSubmitExpiredAwaitingDecision} disabled={awaitingDecisionSubmitting}>
              {awaitingDecisionSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {awaitingDecisionSubmitting
                ? (awaitingRequestExtension ? 'Requesting extension...' : 'Closing as won...')
                : (awaitingRequestExtension ? 'Request Extension' : 'Close as Won')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Default File Preview Modal */}
      <Dialog open={filePreviewOpen} onOpenChange={(v) => { if (!v && filePreviewBlobUrl) { URL.revokeObjectURL(filePreviewBlobUrl); setFilePreviewBlobUrl(null); } setFilePreviewOpen(v); }}>
        <DialogContent className="max-w-4xl w-full p-0 gap-0 overflow-hidden flex flex-col" style={{ height: '90vh' }}>
          <DialogHeader className="px-5 py-3 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              {filePreviewMime?.includes('pdf') ? (
                <FileText className="h-4 w-4 text-red-500" />
              ) : (
                <File className="h-4 w-4 text-muted-foreground" />
              )}
              {filePreviewName}
            </DialogTitle>
            <DialogDescription className="sr-only">{filePreviewName}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 flex items-center justify-center">
            {filePreviewLoading && <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />}
            {!filePreviewLoading && filePreviewBlobUrl && (
              filePreviewMime?.startsWith('image/') ? (
                <div className="flex items-center justify-center h-full w-full p-4">
                  <img src={filePreviewBlobUrl} alt={filePreviewName} className="max-h-full max-w-full object-contain" />
                </div>
              ) : (
                <iframe src={filePreviewBlobUrl} title={filePreviewName} className="w-full h-full border-0" />
              )
            )}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
