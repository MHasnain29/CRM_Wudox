import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow, format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StickyHeader } from '@/components/StickyHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  pandaDocGetTemplatesDetailed,
  fetchProposals,
  type PandaDocTemplateDetailed,
} from '@/lib/api';
import { ScopeFilterBar } from '@/components/ScopeFilterBar';
import { useScopeFilter } from '@/hooks/useElevatedScopeFilter';
import { useAuthStore } from '@/lib/authStore';
import { useEffectiveUser } from '@/lib/effectiveUser';
import { isRealAgencyId } from '@/lib/resolveAgencyId';
import {
  RefreshCw,
  Search,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  FileText,
  AlertCircle,
  FileX,
  ExternalLink,
  Send,
  Inbox,
  Clock,
  CheckCircle2,
  XCircle,
  User,
  Building2,
  Download,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';

// ─── Template card ────────────────────────────────────────────────────────────

const PROPOSAL_TYPE_LABELS: Record<'temp' | 'direct' | 'both', string> = {
  temp: 'Temp',
  direct: 'Direct',
  both: 'Both',
};

function groupTemplatesByAgency(templates: PandaDocTemplateDetailed[]): Array<{
  id: string;
  name: string;
  templates: PandaDocTemplateDetailed[];
}> {
  const map = new Map<string, { id: string; name: string; templates: PandaDocTemplateDetailed[] }>();

  for (const t of templates) {
    const agencies = t.agencies ?? [];
    if (agencies.length === 0) {
      const key = '_unassigned';
      const section = map.get(key) ?? { id: key, name: 'Unassigned', templates: [] };
      section.templates.push(t);
      map.set(key, section);
      continue;
    }
    for (const a of agencies) {
      const section = map.get(a.id) ?? { id: a.id, name: a.name, templates: [] };
      section.templates.push({
        ...t,
        proposalTypes: a.roles?.length ? a.roles : t.proposalTypes,
        agencies: undefined,
      });
      map.set(a.id, section);
    }
  }

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function ProposalTypeBadges({ types }: { types: Array<'temp' | 'direct' | 'both'> }) {
  if (types.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {types.map((role) => (
        <Badge
          key={role}
          variant="outline"
          className={
            role === 'temp'
              ? 'text-[10px] font-medium bg-amber-50 text-amber-800 border-amber-200'
              : role === 'direct'
                ? 'text-[10px] font-medium bg-violet-50 text-violet-800 border-violet-200'
                : 'text-[10px] font-medium bg-emerald-50 text-emerald-800 border-emerald-200'
          }
        >
          {PROPOSAL_TYPE_LABELS[role] ?? role}
        </Badge>
      ))}
    </div>
  );
}

function TemplateCard({
  template,
  hideAgencyBadges = false,
}: {
  template: PandaDocTemplateDetailed;
  hideAgencyBadges?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function copyMergeField(uuid: string, value: string) {
    navigator.clipboard.writeText(value);
    setCopiedId(uuid);
    setTimeout(() => setCopiedId(null), 1500);
  }

  const modifiedAgo = (() => {
    try {
      return formatDistanceToNow(new Date(template.date_modified), { addSuffix: true });
    } catch {
      return '';
    }
  })();

  const proposalTypes = (template.proposalTypes?.length
    ? template.proposalTypes
    : [...new Set((template.agencies ?? []).flatMap((a) => a.roles ?? []))]
  ).filter((r): r is 'temp' | 'direct' | 'both' => r === 'temp' || r === 'direct' || r === 'both');

  return (
    <Card className={`overflow-hidden transition-colors hover:border-primary/30 ${expanded ? 'border-primary/40' : ''}`}>
      <CardHeader className="pb-3 space-y-0">
        <button
          type="button"
          className="flex w-full items-start gap-3 text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
            <FileText className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-sm leading-snug line-clamp-2">{template.name}</p>
              {expanded ? (
                <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
              )}
            </div>
            <ProposalTypeBadges types={proposalTypes} />
            {!hideAgencyBadges && template.agencies && template.agencies.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {template.agencies.map((a) => (
                  <Badge key={a.id} variant="secondary" className="text-[10px] font-normal">
                    {a.name}
                  </Badge>
                ))}
              </div>
            )}
            {modifiedAgo && (
              <p className="text-[11px] text-muted-foreground">Updated {modifiedAgo}</p>
            )}
          </div>
        </button>

        <div className="flex flex-wrap gap-1.5 pt-3">
          <Badge variant="secondary" className="text-[11px] font-normal">
            {template.fields.length} field{template.fields.length !== 1 ? 's' : ''}
          </Badge>
          <Badge variant="outline" className="text-[11px] font-normal">
            {template.tokens.length} token{template.tokens.length !== 1 ? 's' : ''}
          </Badge>
          <Badge variant="outline" className="text-[11px] font-normal">
            {template.roles.length} role{template.roles.length !== 1 ? 's' : ''}
          </Badge>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-4 border-t">
          {/* Fields */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-3">
              Fields
            </p>
            {template.fields.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No fields defined</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs h-8">Field Name</TableHead>
                    <TableHead className="text-xs h-8">Type</TableHead>
                    <TableHead className="text-xs h-8">Merge Syntax</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {template.fields.map((f) => (
                    <TableRow key={f.uuid} className="text-xs">
                      <TableCell className="font-mono py-1.5">{f.name}</TableCell>
                      <TableCell className="py-1.5 capitalize text-muted-foreground">{f.type}</TableCell>
                      <TableCell className="py-1.5">
                        {f.merge_field ? (
                          <div className="flex items-center gap-1">
                            <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">
                              {f.merge_field}
                            </code>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => copyMergeField(f.uuid, f.merge_field!)}
                            >
                              {copiedId === f.uuid ? (
                                <Check className="h-3 w-3 text-green-600" />
                              ) : (
                                <Copy className="h-3 w-3 text-muted-foreground" />
                              )}
                            </Button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {/* Tokens */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Tokens
            </p>
            {template.tokens.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No tokens defined</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs h-8">Token Name</TableHead>
                    <TableHead className="text-xs h-8">Default Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {template.tokens.map((t, i) => (
                    <TableRow key={i} className="text-xs">
                      <TableCell className="font-mono py-1.5">{t.name}</TableCell>
                      <TableCell className="py-1.5 text-muted-foreground">
                        {t.value || <span className="italic">empty</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {/* Roles */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Roles
            </p>
            {template.roles.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No roles defined</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs h-8">Role Name</TableHead>
                    <TableHead className="text-xs h-8">Signing Order</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {template.roles.map((r) => (
                    <TableRow key={r.id} className="text-xs">
                      <TableCell className="py-1.5 font-medium">{r.name}</TableCell>
                      <TableCell className="py-1.5 text-muted-foreground">
                        {r.signing_order ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function TemplateSkeletons() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2 mt-2" />
            <div className="flex gap-2 mt-3">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

// ─── Proposal document card ───────────────────────────────────────────────────

function ProposalCard({ proposal }: { proposal: any }) {
  const sentDocs = (proposal.proposalDocuments ?? []).filter((d: any) => d.category === 'sent_to_client');
  const receivedDocs = (proposal.proposalDocuments ?? []).filter((d: any) => d.category === 'received_from_client');
  const isRejected = proposal.reviewRejectedAt && proposal.reviewRequestedAt
    && new Date(proposal.reviewRejectedAt) >= new Date(proposal.reviewRequestedAt);
  const isApproved = !!proposal.activatedById;
  const submittedBy = proposal.reviewRequestedBy
    ? `${proposal.reviewRequestedBy.firstName ?? ''} ${proposal.reviewRequestedBy.lastName ?? ''}`.trim()
    : null;
  const approvedBy = proposal.activatedBy
    ? `${proposal.activatedBy.firstName ?? ''} ${proposal.activatedBy.lastName ?? ''}`.trim()
    : null;

  return (
    <div className="border rounded-xl bg-card overflow-hidden hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-center gap-4 px-5 py-4 border-b bg-muted/20">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Building2 className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm leading-tight truncate">{proposal.lead?.client?.name ?? '—'}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {submittedBy && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <User className="h-3 w-3" />
                {submittedBy}
              </span>
            )}
            {proposal.reviewRequestedAt && (
              <span className="text-xs text-muted-foreground">
                · submitted {formatDistanceToNow(new Date(proposal.reviewRequestedAt), { addSuffix: true })}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isApproved && approvedBy && (
            <span className="text-xs text-muted-foreground hidden sm:block">by {approvedBy}</span>
          )}
          <a
            href="/proposals"
            className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="View in Proposals"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>

      {/* Rejection comment */}
      {isRejected && proposal.reviewRejectionComment && (
        <div className="px-5 py-3 bg-red-50 border-b border-red-100 flex items-start gap-2">
          <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{proposal.reviewRejectionComment}</p>
        </div>
      )}

      {/* Documents grid */}
      <div className="grid sm:grid-cols-2 gap-0 divide-y sm:divide-y-0 sm:divide-x">
        {/* Sent to client */}
        <div className="px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100">
              <Send className="h-3 w-3 text-blue-600" />
            </div>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sent to Client</span>
            {sentDocs.length > 0 && (
              <Badge variant="secondary" className="text-xs ml-auto">{sentDocs.length}</Badge>
            )}
          </div>
          {sentDocs.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No documents uploaded</p>
          ) : (
            <ul className="space-y-2">
              {sentDocs.map((doc: any) => (
                <li key={doc.id} className="flex items-center gap-2 group">
                  <FileText className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                  <span className="text-xs text-foreground truncate flex-1">{doc.name}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {doc.sentAt && (
                      <span className="text-[10px] text-muted-foreground">
                        {format(new Date(doc.sentAt), 'MMM d')}
                      </span>
                    )}
                    {doc.url && (
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Received from client */}
        <div className="px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100">
              <Inbox className="h-3 w-3 text-green-600" />
            </div>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Received from Client</span>
            {receivedDocs.length > 0 && (
              <Badge variant="secondary" className="text-xs ml-auto">{receivedDocs.length}</Badge>
            )}
          </div>
          {receivedDocs.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No documents received</p>
          ) : (
            <ul className="space-y-2">
              {receivedDocs.map((doc: any) => (
                <li key={doc.id} className="flex items-center gap-2 group">
                  <FileText className="h-3.5 w-3.5 text-green-500 shrink-0" />
                  <span className="text-xs text-foreground truncate flex-1">{doc.name}</span>
                  {doc.url && (
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-2.5 border-t bg-muted/10 flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1">
          <Send className="h-3 w-3 text-blue-500" />
          {sentDocs.length} sent
        </span>
        <span className="flex items-center gap-1">
          <Inbox className="h-3 w-3 text-green-500" />
          {receivedDocs.length} received
        </span>
        {sentDocs.length > 0 && receivedDocs.length > 0 ? (
          <span className="flex items-center gap-1 text-green-600 font-medium ml-auto">
            <CheckCircle2 className="h-3 w-3" />
            Both sides complete
          </span>
        ) : (
          <span className="flex items-center gap-1 text-amber-600 ml-auto">
            <Clock className="h-3 w-3" />
            Incomplete
          </span>
        )}
      </div>
    </div>
  );
}

// ─── (ReviewSection removed — replaced with inline tabs in main page) ─────────

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Documents() {
  const [activeTab, setActiveTab] = useState('templates');
  const [search, setSearch] = useState('');
  const [docSearch, setDocSearch] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);

  const scopeFilter = useScopeFilter();
  const currentUser = useAuthStore((s) => s.user);
  const effectiveUser = useEffectiveUser();
  const needsAgencyPick =
    scopeFilter.showAgencyFilterBar || scopeFilter.showHierarchyFilters || scopeFilter.showAgencyFilterOnly;
  const selectedAgencyId = scopeFilter.selectedAgencyId;
  const homeAgencyId = effectiveUser.isActingAs
    ? effectiveUser.subCompanyId
    : currentUser?.subCompanyId;
  const allAgenciesMode = needsAgencyPick && selectedAgencyId === 'all';
  const agencyIdForTemplates = allAgenciesMode
    ? null
    : needsAgencyPick
      ? (isRealAgencyId(selectedAgencyId)
          ? selectedAgencyId
          : isRealAgencyId(homeAgencyId)
            ? homeAgencyId
            : null)
      : (isRealAgencyId(homeAgencyId) ? homeAgencyId : null);
  const templatesEnabled = allAgenciesMode || !!agencyIdForTemplates;

  // Templates query — agency-scoped or All Agencies union via ProposalTypeTemplateMapping
  const {
    data: templatesData,
    isLoading: templatesLoading,
    isError: templatesError,
    error: templatesErrorObj,
    refetch: refetchTemplates,
    isFetching: templatesFetching,
  } = useQuery({
    queryKey: [
      'pandadoc-templates-detailed',
      allAgenciesMode ? 'all' : agencyIdForTemplates,
      refreshNonce,
    ],
    queryFn: () =>
      pandaDocGetTemplatesDetailed(
        allAgenciesMode
          ? { allAgencies: true, refresh: refreshNonce > 0 }
          : { subCompanyId: agencyIdForTemplates!, refresh: refreshNonce > 0 },
      ),
    staleTime: 5 * 60 * 1000,
    retry: 1,
    enabled: templatesEnabled && activeTab === 'templates',
  });

  // Document review query — proposals submitted for manager document review
  const {
    data: reviewData,
    isLoading: reviewLoading,
    isError: reviewError,
    refetch: refetchReview,
    isFetching: reviewFetching,
  } = useQuery({
    queryKey: ['proposals-document-review'],
    queryFn: () => fetchProposals({ documentReview: true, limit: 100 }),
    staleTime: 60 * 1000,
    retry: 1,
    enabled: activeTab === 'documents',
  });

  const templates = templatesData?.templates ?? [];
  const filteredTemplates = search.trim()
    ? templates.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    : templates;

  const agencyTemplateSections = useMemo(
    () => (allAgenciesMode ? groupTemplatesByAgency(filteredTemplates) : []),
    [allAgenciesMode, filteredTemplates],
  );

  const showAgencySections =
    allAgenciesMode &&
    agencyTemplateSections.length > 0 &&
    agencyTemplateSections.some((s) => s.id !== '_unassigned' || agencyTemplateSections.length === 1);

  const totalFields = templates.reduce((acc, t) => acc + t.fields.length, 0);
  const totalTokens = templates.reduce((acc, t) => acc + t.tokens.length, 0);

  const allReviewProposals: any[] = reviewData?.proposals ?? [];

  // Classify each proposal into a section
  function classifyProposal(p: any): 'pending' | 'rejected' | 'approved' {
    const isActivated = !!p.activatedById;
    if (isActivated) return 'approved';
    const isRejected = p.reviewRejectedAt && p.reviewRequestedAt
      && new Date(p.reviewRejectedAt) >= new Date(p.reviewRequestedAt);
    return isRejected ? 'rejected' : 'pending';
  }

  const searchFilter = (p: any) =>
    !docSearch.trim() || p.lead?.client?.name?.toLowerCase().includes(docSearch.toLowerCase());

  const pendingProposals = allReviewProposals.filter((p) => classifyProposal(p) === 'pending' && searchFilter(p));
  const rejectedProposals = allReviewProposals.filter((p) => classifyProposal(p) === 'rejected' && searchFilter(p));
  const approvedProposals = allReviewProposals.filter((p) => classifyProposal(p) === 'approved' && searchFilter(p));

  function handleRefreshTemplates() {
    setRefreshNonce((n) => n + 1);
    toast({ title: 'Refreshing', description: 'Fetching latest templates from PandaDoc…' });
  }

  function handleRefreshReview() {
    refetchReview();
  }

  const showAgencyBar =
    scopeFilter.showHierarchyFilters || scopeFilter.showAgencyFilterBar || scopeFilter.showAgencyFilterOnly;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pt-6">
        <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          PandaDoc templates and sent documents
        </p>
      </div>

      {showAgencyBar && (
        <ScopeFilterBar show filterRowProps={scopeFilter.filterRowProps} hideUserRows />
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <StickyHeader>
          <TabsList>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="documents" className="gap-2">
              Sent Documents
              {allReviewProposals.length > 0 && (
                <span className="inline-flex items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-semibold px-1.5 py-0.5 min-w-[1.25rem]">
                  {allReviewProposals.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </StickyHeader>

        {/* ── Templates tab ── */}
        <TabsContent value="templates" className="mt-6 space-y-5">
          {/* Toolbar */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search templates…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                disabled={!templatesEnabled}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshTemplates}
              disabled={!templatesEnabled || templatesFetching}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${templatesFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>

          {!templatesEnabled && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Building2 className="h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="font-medium">Select an agency</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  Choose All Agencies or a specific agency above to see mapped PandaDoc templates.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Stats bar */}
          {templatesEnabled && !templatesLoading && !templatesError && templates.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground rounded-lg border bg-muted/20 px-4 py-2.5">
              <span>
                <strong className="text-foreground">{templates.length}</strong> template{templates.length !== 1 ? 's' : ''}
              </span>
              {allAgenciesMode && agencyTemplateSections.length > 0 && (
                <span>
                  <strong className="text-foreground">
                    {agencyTemplateSections.filter((s) => s.id !== '_unassigned').length || agencyTemplateSections.length}
                  </strong>{' '}
                  agencies
                </span>
              )}
              <span>
                <strong className="text-foreground">{totalFields}</strong> fields
              </span>
              <span>
                <strong className="text-foreground">{totalTokens}</strong> tokens
              </span>
            </div>
          )}

          {/* Loading */}
          {templatesEnabled && templatesLoading && (
            <div>
              <p className="text-sm text-muted-foreground mb-4 flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Fetching templates from PandaDoc…
              </p>
              <TemplateSkeletons />
            </div>
          )}

          {/* Error */}
          {templatesEnabled && templatesError && (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="flex items-start gap-3 py-5">
                <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm text-destructive">Could not load templates</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {(templatesErrorObj as Error)?.message ?? 'Check that PANDADOC_API_KEY is configured correctly.'}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => refetchTemplates()}
                  >
                    <RefreshCw className="h-3 w-3 mr-1.5" />
                    Try again
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Empty — no agency mapping */}
          {templatesEnabled && !templatesLoading && !templatesError && templates.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <FileX className="h-14 w-14 text-muted-foreground/40 mb-3" />
                <p className="font-medium">
                  {allAgenciesMode ? 'No templates mapped for any agency' : 'No templates for this agency'}
                </p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  Map Temp / Direct / Both templates in Settings → Agencies → Proposal Templates, then refresh.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Filtered empty */}
          {templatesEnabled && !templatesLoading && !templatesError && templates.length > 0 && filteredTemplates.length === 0 && (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No templates match &quot;<strong>{search}</strong>&quot;
            </div>
          )}

          {/* Grid — All Agencies: one section per agency; single agency: flat grid */}
          {templatesEnabled && !templatesLoading && !templatesError && filteredTemplates.length > 0 && (
            showAgencySections ? (
              <div className="space-y-5">
                {agencyTemplateSections.map((section) => (
                  <Card key={section.id} className="overflow-hidden border shadow-none">
                    <div className="flex items-center justify-between gap-3 px-5 py-3.5 bg-muted/40 border-b">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background border">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <h2 className="font-semibold text-sm truncate">{section.name}</h2>
                          <p className="text-xs text-muted-foreground">
                            {section.templates.length} mapped template{section.templates.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>
                    </div>
                    <CardContent className="p-4">
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {section.templates.map((template) => (
                          <TemplateCard
                            key={`${section.id}-${template.id}`}
                            template={template}
                            hideAgencyBadges
                          />
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filteredTemplates.map((template) => (
                  <TemplateCard key={template.id} template={template} />
                ))}
              </div>
            )
          )}
        </TabsContent>

        {/* ── Sent Documents tab ── */}
        <TabsContent value="documents" className="mt-6 space-y-6">
          {/* Toolbar */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by client…"
                value={docSearch}
                onChange={(e) => setDocSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshReview}
              disabled={reviewFetching}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${reviewFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>

          {/* Loading */}
          {reviewLoading && (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="border rounded-xl p-5 space-y-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="h-3 w-1/4" />
                    </div>
                    <Skeleton className="h-6 w-24 rounded-full" />
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <Skeleton className="h-16 rounded-lg" />
                    <Skeleton className="h-16 rounded-lg" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {reviewError && (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="flex items-start gap-3 py-5">
                <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm text-destructive">Could not load documents for review</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => refetchReview()}>
                    <RefreshCw className="h-3 w-3 mr-1.5" />
                    Try again
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Global empty */}
          {!reviewLoading && !reviewError && allReviewProposals.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <FileText className="h-14 w-14 text-muted-foreground/40 mb-3" />
                <p className="font-medium">No documents submitted for review</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  When an associate uploads documents and submits for review, they'll appear here.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Status tabs */}
          {!reviewLoading && !reviewError && allReviewProposals.length > 0 && (
            <Tabs defaultValue="pending">
              <TabsList className="w-full sm:w-auto">
                <TabsTrigger value="pending" className="gap-2 flex-1 sm:flex-none">
                  <Clock className="h-3.5 w-3.5 text-amber-500" />
                  Pending
                  {pendingProposals.length > 0 && (
                    <span className="inline-flex items-center justify-center rounded-full bg-amber-100 text-amber-800 text-xs font-semibold px-1.5 py-0.5 min-w-[1.25rem]">
                      {pendingProposals.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="rejected" className="gap-2 flex-1 sm:flex-none">
                  <XCircle className="h-3.5 w-3.5 text-red-500" />
                  Rejected
                  {rejectedProposals.length > 0 && (
                    <span className="inline-flex items-center justify-center rounded-full bg-red-100 text-red-800 text-xs font-semibold px-1.5 py-0.5 min-w-[1.25rem]">
                      {rejectedProposals.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="approved" className="gap-2 flex-1 sm:flex-none">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  Approved
                  {approvedProposals.length > 0 && (
                    <span className="inline-flex items-center justify-center rounded-full bg-green-100 text-green-800 text-xs font-semibold px-1.5 py-0.5 min-w-[1.25rem]">
                      {approvedProposals.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="pending" className="mt-4 space-y-3">
                {pendingProposals.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic py-4 text-center">
                    {docSearch.trim() ? `No results match "${docSearch}"` : 'No documents pending review'}
                  </p>
                ) : (
                  pendingProposals.map((p: any) => <ProposalCard key={p.id} proposal={p} />)
                )}
              </TabsContent>

              <TabsContent value="rejected" className="mt-4 space-y-3">
                {rejectedProposals.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic py-4 text-center">
                    {docSearch.trim() ? `No results match "${docSearch}"` : 'No rejected documents'}
                  </p>
                ) : (
                  rejectedProposals.map((p: any) => <ProposalCard key={p.id} proposal={p} />)
                )}
              </TabsContent>

              <TabsContent value="approved" className="mt-4 space-y-3">
                {approvedProposals.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic py-4 text-center">
                    {docSearch.trim() ? `No results match "${docSearch}"` : 'No approved documents yet'}
                  </p>
                ) : (
                  approvedProposals.map((p: any) => <ProposalCard key={p.id} proposal={p} />)
                )}
              </TabsContent>
            </Tabs>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
