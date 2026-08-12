import { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search, Calendar, Mail, Eye, Edit, Trash2, Clock, Send, CheckCircle2, XCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { format } from 'date-fns';
import { CreateCampaignDialog } from '@/components/CreateCampaignDialog';
import { CampaignDetailsDialog } from '@/components/CampaignDetailsDialog';
import { AgencyBulkEmailConversionCard } from '@/components/AgencyBulkEmailConversionCard';
import { fetchCampaigns, deleteCampaign, sendCampaign, type ApiCampaign } from '@/lib/api';
import { toast } from 'sonner';
import type { Agency } from '@/hooks/useAgencyFilter';
import { useHasPermission } from '@/lib/access';
import { useAuthStore } from '@/lib/authStore';
import { ScopeFilterBar } from '@/components/ScopeFilterBar';
import { StickyHeader } from '@/components/StickyHeader';
import { useScopeFilter } from '@/hooks/useElevatedScopeFilter';
import { useScopeQueryParams, EMPTY_OWNER_SENTINEL } from '@/hooks/useScopeQueryParams';
import { PersonSectionHeader } from '@/components/PersonSectionHeader';
import { getUserRoleTitle } from '@/lib/roleLabels';

// ─── Shared helpers ──────────────────────────────────────────────────────────
function getStatusIcon(status: string) {
  switch (status) {
    case 'sent':      return <CheckCircle2 className="h-4 w-4" />;
    case 'scheduled': return <Clock className="h-4 w-4" />;
    case 'draft':     return <Edit className="h-4 w-4" />;
    case 'sending':   return <Send className="h-4 w-4" />;
    case 'failed':    return <XCircle className="h-4 w-4" />;
    default:          return <AlertCircle className="h-4 w-4" />;
  }
}

function getStatusBadgeClass(status: string) {
  switch (status) {
    case 'sent':      return 'bg-green-500/10 text-green-600 border-green-500/20';
    case 'scheduled': return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
    case 'draft':     return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
    case 'sending':   return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
    case 'failed':    return 'bg-red-500/10 text-red-600 border-red-500/20';
    default:          return '';
  }
}

function formatCampaignDateTime(iso?: string | null) {
  if (!iso) return '-';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '-';
  return format(parsed, 'MMM dd, yyyy h:mm a');
}

// ─── Per-agency section — shown when "All Agencies" is selected ─────────────
function AgencyCampaignsSection({
  agency,
  onViewAgency,
  onViewDetails,
  onSend,
  onDelete,
  ownerIds,
  scopeKey,
  viewLabel = 'View Agency',
  subtitle,
  person,
}: {
  agency: Agency;
  onViewAgency: () => void;
  onViewDetails: (c: ApiCampaign) => void;
  onSend: (c: ApiCampaign) => void;
  onDelete: (id: string) => void;
  ownerIds?: string[];
  scopeKey: string;
  viewLabel?: string;
  subtitle?: string;
  /** When set, render user identity header instead of plain agency title */
  person?: { id: string; firstName: string; lastName: string; roleTitle?: string };
}) {
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  const canManageCampaigns = useHasPermission('clients:write');
  const { data, isLoading } = useQuery({
    queryKey: ['campaigns-agency', agency.id, scopeKey],
    queryFn: () => fetchCampaigns({ subCompanyId: agency.id, ownerIds, limit: 100 }),
    staleTime: 0,
    refetchInterval: 30_000,
  });

  const campaigns = data?.data ?? [];
  const sentCampaigns  = campaigns.filter(c => c.status === 'sent');
  const totalSent      = sentCampaigns.reduce((a, c) => a + c.stats.sent, 0);
  const totalDelivered = sentCampaigns.reduce((a, c) => a + c.stats.delivered, 0);
  const totalOpened    = sentCampaigns.reduce((a, c) => a + c.stats.opened, 0);
  const totalClicked   = sentCampaigns.reduce((a, c) => a + c.stats.clicked, 0);
  const totalBounced   = sentCampaigns.reduce((a, c) => a + c.stats.bounced, 0);

  useEffect(() => {
    setPage(1);
  }, [agency.id, scopeKey, ownerIds?.join(',')]);

  const totalPages = Math.max(1, Math.ceil(campaigns.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const pageRows = campaigns.slice(startIndex, startIndex + PAGE_SIZE);

  return (
    <div className="space-y-4 pb-6 border-b last:border-b-0">
      {/* Agency / person header */}
      {person ? (
        <PersonSectionHeader
          user={person}
          roleTitle={person.roleTitle}
          subtitle={subtitle}
          onView={onViewAgency}
          viewLabel={viewLabel}
          className="mb-0"
        />
      ) : (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">{agency.name}</h2>
            {subtitle ? <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p> : null}
          </div>
          <Button size="sm" variant="outline" onClick={onViewAgency}>{viewLabel}</Button>
        </div>
      )}

      {/* Mail CR card */}
      <AgencyBulkEmailConversionCard agencyId={agency.id} title={`${agency.name} — Mail Conversion Rate`} />

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Delivery Rate</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">{totalDelivered} of {totalSent} delivered</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open Rate</CardTitle>
            <Eye className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalDelivered > 0 ? Math.round((totalOpened / totalDelivered) * 100) : 0}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">{totalOpened} emails opened</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Click Rate</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalOpened > 0 ? Math.round((totalClicked / totalOpened) * 100) : 0}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">{totalClicked} links clicked</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Bounce Rate</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalSent > 0 ? Math.round((totalBounced / totalSent) * 100) : 0}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">{totalBounced} bounced emails</p>
          </CardContent>
        </Card>
      </div>

      {/* Campaign list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
        </div>
      ) : campaigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10">
            <Mail className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm font-medium">No campaigns yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {pageRows.map((campaign) => (
            <Card key={campaign.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <CardTitle className="text-lg">{campaign.name}</CardTitle>
                      <Badge variant="secondary" className={`capitalize ${getStatusBadgeClass(campaign.status)}`}>
                        <span className="flex items-center gap-1">
                          {getStatusIcon(campaign.status)}
                          {campaign.status}
                        </span>
                      </Badge>
                    </div>
                    <CardDescription className="flex flex-col gap-1">
                      <span className="font-medium">{campaign.subject}</span>
                      <span className="text-xs">
                        List: {campaign.listName} • {campaign.totalRecipients} recipients
                      </span>
                      <span className="flex items-center gap-1 text-xs">
                        <Calendar className="h-3 w-3" />
                        {campaign.status === 'sent' ? 'Sent' : campaign.status === 'scheduled' ? 'Scheduled' : 'Created'}:{' '}
                        {campaign.status === 'sent'
                          ? formatCampaignDateTime(campaign.sentAt)
                          : campaign.status === 'scheduled'
                          ? formatCampaignDateTime(campaign.scheduledDate)
                          : formatCampaignDateTime(campaign.createdAt)}
                      </span>
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => onViewDetails(campaign)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    {canManageCampaigns && ['draft', 'scheduled'].includes(campaign.status) && (
                      <Button variant="ghost" size="sm" className="text-primary hover:text-primary" onClick={() => onSend(campaign)}>
                        <Send className="h-4 w-4" />
                      </Button>
                    )}
                    {canManageCampaigns && campaign.status === 'draft' && (
                      <Button variant="ghost" size="sm" onClick={() => onDelete(campaign.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              {campaign.status === 'sent' && (
                <CardContent>
                  <div className="grid grid-cols-6 gap-4 text-center">
                    <div><div className="text-2xl font-bold text-primary">{campaign.stats.sent}</div><div className="text-xs text-muted-foreground">Sent</div></div>
                    <div><div className="text-2xl font-bold text-green-600">{campaign.stats.delivered}</div><div className="text-xs text-muted-foreground">Delivered</div></div>
                    <div><div className="text-2xl font-bold text-blue-600">{campaign.stats.opened}</div><div className="text-xs text-muted-foreground">Opened</div></div>
                    <div><div className="text-2xl font-bold text-purple-600">{campaign.stats.clicked}</div><div className="text-xs text-muted-foreground">Clicked</div></div>
                    <div><div className="text-2xl font-bold text-yellow-600">{campaign.stats.bounced}</div><div className="text-xs text-muted-foreground">Bounced</div></div>
                    <div><div className="text-2xl font-bold text-red-600">{campaign.stats.failed}</div><div className="text-xs text-muted-foreground">Failed</div></div>
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
          {campaigns.length > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-3 mt-2 border-t">
              <div className="text-sm text-muted-foreground">
                Showing {startIndex + 1} to {Math.min(startIndex + pageRows.length, campaigns.length)} of {campaigns.length}
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
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────
export default function BulkEmails() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const canManageCampaigns = useHasPermission('clients:write');
  const preselectedListId = (location.state as { preselectedListId?: string } | null)?.preselectedListId;

  const [searchTerm, setSearchTerm] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(!!preselectedListId);
  const [selectedCampaign, setSelectedCampaign] = useState<ApiCampaign | null>(null);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  const [sendingCampaign, setSendingCampaign] = useState<ApiCampaign | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('all');

  const ownSubCompanyId = useAuthStore((s) => s.user?.subCompanyId);
  const scopeFilter = useScopeFilter();
  const {
    isElevated,
    showHierarchyFilters,
    agencies,
    selectedAgencyId,
    setSelectedAgencyId,
    setSelectedUserId,
    setSelectedManagerId,
    filterRowProps,
    selectedManagerId,
    managerParamInUrl,
    selectedUserId,
    userParamInUrl,
    getManagersForLeader,
    getAssociatesForManager,
    selectedLeaderId,
    leaderParamInUrl,
    managers: allManagers,
    showAllTeamView,
    showAgencySections,
    showManagerSections,
    sectionUsers,
  } = scopeFilter;
  const { ownerIds, scopeKey } = useScopeQueryParams(scopeFilter);

  const campaignOwnerIds = useMemo(() => {
    // Specific user chip selected → show only that user's campaigns
    if (userParamInUrl && selectedUserId !== 'all') return [selectedUserId];

    // "All Team" toggled under a specific manager → show that manager's associates only.
    // Return the empty sentinel when the manager has no team so the query returns 0 results.
    if (userParamInUrl && selectedUserId === 'all' && managerParamInUrl && selectedManagerId !== 'all') {
      const associates = getAssociatesForManager(selectedManagerId);
      return associates.length > 0 ? associates.map((a) => a.id) : [EMPTY_OWNER_SENTINEL];
    }

    // Specific manager selected (no user chip) → show that manager's own campaigns
    if (managerParamInUrl && selectedManagerId !== 'all') return [selectedManagerId];

    // All Sales Managers selected
    if (managerParamInUrl && selectedManagerId === 'all') {
      if (leaderParamInUrl && selectedLeaderId !== 'all') {
        const mgrs = getManagersForLeader(selectedLeaderId);
        return mgrs.length > 0 ? mgrs.map((m) => m.id) : allManagers.map((m) => m.id);
      }
      return allManagers.length > 0 ? allManagers.map((m) => m.id) : undefined;
    }

    // No manager param → use ownerIds (handles leader-level and elevated scope)
    return ownerIds;
  }, [managerParamInUrl, selectedManagerId, userParamInUrl, selectedUserId, leaderParamInUrl, selectedLeaderId, getManagersForLeader, getAssociatesForManager, allManagers, ownerIds]);

  // Show "All Agencies" multi-section view when elevated and no people-section mode
  const showAllAgenciesView = showAgencySections;

  // Resolve the subCompanyId to query:
  // - 'all'  → multi-section view (query disabled)
  // - 'me'   → current user's own agency (scope to ownSubCompanyId)
  // - UUID   → specific agency
  const querySubCompanyId = isElevated
    ? selectedAgencyId === 'me' ? (ownSubCompanyId ?? undefined) : selectedAgencyId !== 'all' ? selectedAgencyId : undefined
    : undefined;

  // Single-agency query — used for non-elevated users and elevated users on a specific agency tab
  const { data, isLoading } = useQuery({
    queryKey: ['campaigns', isElevated ? selectedAgencyId : 'own', ownSubCompanyId, scopeKey, campaignOwnerIds?.join(',') ?? ''],
    queryFn: () => fetchCampaigns({
      limit: 100,
      subCompanyId: querySubCompanyId,
      ownerIds: campaignOwnerIds,
    }),
    enabled: !showAllAgenciesView && !showAllTeamView,
    refetchInterval: 30_000,
  });

  const campaigns = data?.data ?? [];

  const filteredCampaigns = campaigns.filter(c => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.listName.toLowerCase().includes(searchTerm.toLowerCase());
    if (activeTab === 'all') return matchesSearch;
    return matchesSearch && c.status === activeTab;
  });

  const getCampaignCount = (status: string) => {
    if (status === 'all') return campaigns.length;
    return campaigns.filter(c => c.status === status).length;
  };

  const sentCampaigns = campaigns.filter(c => c.status === 'sent');
  const totalSent      = sentCampaigns.reduce((a, c) => a + c.stats.sent, 0);
  const totalDelivered = sentCampaigns.reduce((a, c) => a + c.stats.delivered, 0);
  const totalOpened    = sentCampaigns.reduce((a, c) => a + c.stats.opened, 0);
  const totalClicked   = sentCampaigns.reduce((a, c) => a + c.stats.clicked, 0);
  const totalBounced   = sentCampaigns.reduce((a, c) => a + c.stats.bounced, 0);

  // Invalidates both the main query and all per-agency section queries
  const invalidateAllCampaignQueries = () => {
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'campaigns' || q.queryKey[0] === 'campaigns-agency' });
  };

  const handleViewDetails = (campaign: ApiCampaign) => {
    setSelectedCampaign(campaign);
    setIsDetailsDialogOpen(true);
  };

  const handleDeleteCampaign = async (campaignId: string) => {
    const ok = await deleteCampaign(campaignId);
    if (ok) {
      invalidateAllCampaignQueries();
      toast.success('Campaign deleted');
    } else {
      toast.error('Failed to delete campaign');
    }
  };

  const handleConfirmSend = async () => {
    if (!sendingCampaign) return;
    setIsSending(true);
    const result = await sendCampaign(sendingCampaign.id);
    setIsSending(false);
    setSendingCampaign(null);
    if (result) {
      invalidateAllCampaignQueries();
      toast.success(`Campaign sent to ${result.totalRecipients} recipients`);
    } else {
      toast.error('Failed to send campaign — check that clients have email addresses');
    }
  };

  const selectedAgencyName =
    selectedAgencyId === 'me'
      ? agencies.find((a) => a.id === ownSubCompanyId)?.name
      : agencies.find((a) => a.id === selectedAgencyId)?.name;

  return (
    <div className="flex-1 space-y-6 px-8 pb-8 pt-0">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between pt-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bulk Email Campaigns</h1>
          <p className="text-muted-foreground">Create and manage email campaigns for your lists</p>
        </div>
        {canManageCampaigns && (
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Campaign
          </Button>
        )}
      </div>

      <StickyHeader zIndex={40}>
        <ScopeFilterBar show={showHierarchyFilters} filterRowProps={filterRowProps} />
      </StickyHeader>

      {/* ── People sections (All Managers / All Team) ── */}
      {showAllTeamView ? (
        sectionUsers.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-12">
            {showManagerSections
              ? 'No managers / team in this agency'
              : 'No team members in this scope'}
          </p>
        ) : (
          <div className="space-y-8">
            {sectionUsers.map((user) => {
              const agencyIdForUser =
                selectedAgencyId !== 'all' && selectedAgencyId !== 'me'
                  ? selectedAgencyId
                  : user.subCompanyId || ownSubCompanyId || '';
              const agencyName =
                agencies.find((a) => a.id === agencyIdForUser)?.name ??
                `${user.firstName} ${user.lastName}`.trim();
              if (!agencyIdForUser) {
                return (
                  <div key={user.id} className="space-y-2">
                    <h2 className="text-xl font-semibold">
                      {user.firstName} {user.lastName}
                    </h2>
                    <p className="text-sm text-muted-foreground">No agency found for this user</p>
                  </div>
                );
              }
              return (
                <AgencyCampaignsSection
                  key={user.id}
                  agency={{ id: agencyIdForUser, name: agencyName, countries: [] }}
                  person={{
                    id: user.id,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    roleTitle: getUserRoleTitle(user),
                  }}
                  subtitle={agencyName}
                  viewLabel="View"
                  onViewAgency={() =>
                    showManagerSections
                      ? setSelectedManagerId(user.id)
                      : setSelectedUserId(user.id)
                  }
                  onViewDetails={handleViewDetails}
                  onSend={(c) => setSendingCampaign(c)}
                  onDelete={handleDeleteCampaign}
                  ownerIds={[user.id]}
                  scopeKey={`${scopeKey}|user:${user.id}`}
                />
              );
            })}
          </div>
        )
      ) : showAllAgenciesView ? (
        <div className="space-y-8">
          {agencies.map((agency) => (
            <AgencyCampaignsSection
              key={agency.id}
              agency={agency}
              onViewAgency={() => setSelectedAgencyId(agency.id)}
              onViewDetails={handleViewDetails}
              onSend={(c) => setSendingCampaign(c)}
              onDelete={handleDeleteCampaign}
              ownerIds={campaignOwnerIds}
              scopeKey={`${scopeKey}|${campaignOwnerIds?.join(',') ?? ''}`}
            />
          ))}
        </div>
      ) : (
        <>
          {/* ── Mail Conversion Rate card ── */}
          {isElevated ? (
            <AgencyBulkEmailConversionCard
              agencyId={querySubCompanyId}
              title={selectedAgencyName ? `${selectedAgencyName} — Mail Conversion Rate` : undefined}
            />
          ) : (
            <AgencyBulkEmailConversionCard />
          )}

          {/* ── Overall stats across campaigns in view ── */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Delivery Rate</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">{totalDelivered} of {totalSent} delivered</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Open Rate</CardTitle>
                <Eye className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {totalDelivered > 0 ? Math.round((totalOpened / totalDelivered) * 100) : 0}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">{totalOpened} emails opened</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Click Rate</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {totalOpened > 0 ? Math.round((totalClicked / totalOpened) * 100) : 0}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">{totalClicked} links clicked</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Bounce Rate</CardTitle>
                <AlertCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {totalSent > 0 ? Math.round((totalBounced / totalSent) * 100) : 0}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">{totalBounced} bounced emails</p>
              </CardContent>
            </Card>
          </div>

          {/* ── Search and status tabs ── */}
          <div className="flex flex-col gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search campaigns..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <StickyHeader>
                <TabsList>
                  <TabsTrigger value="all">All ({getCampaignCount('all')})</TabsTrigger>
                  <TabsTrigger value="draft">Drafts ({getCampaignCount('draft')})</TabsTrigger>
                  <TabsTrigger value="scheduled">Scheduled ({getCampaignCount('scheduled')})</TabsTrigger>
                  <TabsTrigger value="sent">Sent ({getCampaignCount('sent')})</TabsTrigger>
                  <TabsTrigger value="failed">Failed ({getCampaignCount('failed')})</TabsTrigger>
                </TabsList>
              </StickyHeader>

              <TabsContent value={activeTab} className="mt-6">
                {isLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {filteredCampaigns.length === 0 ? (
                      <Card>
                        <CardContent className="flex flex-col items-center justify-center py-12">
                          <Mail className="h-12 w-12 text-muted-foreground mb-4" />
                          <p className="text-lg font-medium">No campaigns found</p>
                          <p className="text-sm text-muted-foreground mb-4">
                            {searchTerm ? 'Try adjusting your search' : 'Create your first campaign to get started'}
                          </p>
                          {!searchTerm && canManageCampaigns && (
                            <Button onClick={() => setIsCreateDialogOpen(true)}>
                              <Plus className="h-4 w-4 mr-2" />
                              Create Campaign
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    ) : (
                      filteredCampaigns.map((campaign) => (
                        <Card key={campaign.id} className="hover:shadow-md transition-shadow">
                          <CardHeader>
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <CardTitle className="text-lg">{campaign.name}</CardTitle>
                                  <Badge variant="secondary" className={`capitalize ${getStatusBadgeClass(campaign.status)}`}>
                                    <span className="flex items-center gap-1">
                                      {getStatusIcon(campaign.status)}
                                      {campaign.status}
                                    </span>
                                  </Badge>
                                </div>
                                <CardDescription className="flex flex-col gap-1">
                                  <span className="font-medium">{campaign.subject}</span>
                                  <span className="text-xs">
                                    List: {campaign.listName} • {campaign.totalRecipients} recipients
                                  </span>
                                  <span className="flex items-center gap-1 text-xs">
                                    <Calendar className="h-3 w-3" />
                                    {campaign.status === 'sent' ? 'Sent' : campaign.status === 'scheduled' ? 'Scheduled' : 'Created'}:{' '}
                                    {campaign.status === 'sent'
                                      ? formatCampaignDateTime(campaign.sentAt)
                                      : campaign.status === 'scheduled'
                                      ? formatCampaignDateTime(campaign.scheduledDate)
                                      : formatCampaignDateTime(campaign.createdAt)}
                                  </span>
                                </CardDescription>
                              </div>
                              <div className="flex gap-2">
                                <Button variant="ghost" size="sm" onClick={() => handleViewDetails(campaign)}>
                                  <Eye className="h-4 w-4" />
                                </Button>
                                {canManageCampaigns && ['draft', 'scheduled'].includes(campaign.status) && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-primary hover:text-primary"
                                    onClick={() => setSendingCampaign(campaign)}
                                  >
                                    <Send className="h-4 w-4" />
                                  </Button>
                                )}
                                {canManageCampaigns && campaign.status === 'draft' && (
                                  <Button variant="ghost" size="sm" onClick={() => handleDeleteCampaign(campaign.id)}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          </CardHeader>
                          {campaign.status === 'sent' && (
                            <CardContent>
                              <div className="grid grid-cols-6 gap-4 text-center">
                                <div>
                                  <div className="text-2xl font-bold text-primary">{campaign.stats.sent}</div>
                                  <div className="text-xs text-muted-foreground">Sent</div>
                                </div>
                                <div>
                                  <div className="text-2xl font-bold text-green-600">{campaign.stats.delivered}</div>
                                  <div className="text-xs text-muted-foreground">Delivered</div>
                                </div>
                                <div>
                                  <div className="text-2xl font-bold text-blue-600">{campaign.stats.opened}</div>
                                  <div className="text-xs text-muted-foreground">Opened</div>
                                </div>
                                <div>
                                  <div className="text-2xl font-bold text-purple-600">{campaign.stats.clicked}</div>
                                  <div className="text-xs text-muted-foreground">Clicked</div>
                                </div>
                                <div>
                                  <div className="text-2xl font-bold text-yellow-600">{campaign.stats.bounced}</div>
                                  <div className="text-xs text-muted-foreground">Bounced</div>
                                </div>
                                <div>
                                  <div className="text-2xl font-bold text-red-600">{campaign.stats.failed}</div>
                                  <div className="text-xs text-muted-foreground">Failed</div>
                                </div>
                              </div>
                            </CardContent>
                          )}
                        </Card>
                      ))
                    )}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </>
      )}

      {/* ── Dialogs ── */}
      <CreateCampaignDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onSuccess={() => invalidateAllCampaignQueries()}
        defaultListId={preselectedListId}
        subCompanyId={isElevated ? querySubCompanyId : undefined}
      />
      {selectedCampaign && (
        <CampaignDetailsDialog
          campaign={selectedCampaign}
          open={isDetailsDialogOpen}
          onOpenChange={setIsDetailsDialogOpen}
          onStatsRefreshed={() => invalidateAllCampaignQueries()}
        />
      )}

      <AlertDialog open={!!sendingCampaign} onOpenChange={(o) => { if (!o) setSendingCampaign(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send Campaign</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>"{sendingCampaign?.name}"</strong> will be sent immediately to all clients in the
              agency that have email addresses on file. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmSend} disabled={isSending}>
              {isSending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Send Now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
