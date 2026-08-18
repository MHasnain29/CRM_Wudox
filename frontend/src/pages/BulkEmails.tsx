import { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search, Mail, Eye, Trash2, Send, CheckCircle2, XCircle, AlertCircle, Loader2, Clock, Edit, BarChart3, TrendingUp, MousePointerClick, Inbox } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getStatusIcon(status: string) {
  switch (status) {
    case 'sent':      return <CheckCircle2 className="h-3 w-3" />;
    case 'scheduled': return <Clock className="h-3 w-3" />;
    case 'draft':     return <Edit className="h-3 w-3" />;
    case 'sending':   return <Send className="h-3 w-3" />;
    case 'failed':    return <XCircle className="h-3 w-3" />;
    default:          return <AlertCircle className="h-3 w-3" />;
  }
}

function getStatusBadgeClass(status: string) {
  switch (status) {
    case 'sent':      return 'bg-green-50 text-green-700 border-green-200';
    case 'scheduled': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'draft':     return 'bg-slate-100 text-slate-600 border-slate-200';
    case 'sending':   return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'failed':    return 'bg-red-50 text-red-700 border-red-200';
    default:          return '';
  }
}

function formatCampaignDate(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : format(d, 'MMM d, yyyy');
}

// ─── Progress bar ─────────────────────────────────────────────────────────────
type MetricColor = 'green' | 'blue' | 'orange' | 'amber' | 'red';

function MetricBar({ value, color, label }: { value: number; color: MetricColor; label: string }) {
  const s: Record<MetricColor, { bar: string; track: string; text: string }> = {
    green:  { bar: 'from-green-500 to-green-300',   track: 'bg-green-100',  text: 'text-green-700' },
    blue:   { bar: 'from-blue-500 to-blue-300',     track: 'bg-blue-100',   text: 'text-blue-700' },
    orange: { bar: 'from-orange-500 to-orange-300', track: 'bg-orange-100', text: 'text-orange-700' },
    amber:  { bar: 'from-amber-500 to-amber-300',   track: 'bg-amber-100',  text: 'text-amber-700' },
    red:    { bar: 'from-red-500 to-red-300',       track: 'bg-red-100',    text: 'text-red-700' },
  };
  const { bar, track, text } = s[color];

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground w-[52px] shrink-0">{label}</span>
      <div className={`flex-1 h-2 rounded-full overflow-hidden ${track}`}>
        <div
          className={`h-full rounded-full bg-gradient-to-r ${bar} transition-all duration-500`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      <span className={`text-xs font-bold w-10 text-right shrink-0 tabular-nums ${text}`}>
        {value.toFixed(1)}%
      </span>
    </div>
  );
}

// ─── Stat cards ───────────────────────────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  iconBg: string;
  valueColor: string;
}

function StatCard({ label, value, sub, icon, iconBg, valueColor }: StatCardProps) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
            <p className={`text-3xl font-bold leading-none ${valueColor}`}>{value}</p>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{sub}</p>
          </div>
          <div className={`shrink-0 rounded-xl p-2.5 ${iconBg}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CampaignStatCards({
  totalSent, totalDelivered, totalOpened, totalClicked, totalBounced, totalFailed,
}: {
  totalSent: number; totalDelivered: number; totalOpened: number;
  totalClicked: number; totalBounced: number; totalFailed: number;
}) {
  const deliveryPct = totalSent > 0      ? Math.round((totalDelivered / totalSent)      * 100) : 0;
  const openPct     = totalDelivered > 0 ? Math.round((totalOpened    / totalDelivered)  * 100) : 0;
  const clickPct    = totalOpened > 0    ? Math.round((totalClicked   / totalOpened)     * 100) : 0;
  const bouncePct   = totalSent > 0      ? Math.round((totalBounced   / totalSent)       * 100) : 0;
  const failedPct   = totalSent > 0      ? Math.round((totalFailed    / totalSent)       * 100) : 0;

  return (
    <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
      <StatCard
        label="Delivery Rate"
        value={`${deliveryPct}%`}
        sub={`${totalDelivered.toLocaleString()} of ${totalSent.toLocaleString()} sent`}
        icon={<CheckCircle2 className="h-5 w-5 text-green-600" />}
        iconBg="bg-green-100"
        valueColor="text-green-600"
      />
      <StatCard
        label="Open Rate"
        value={`${openPct}%`}
        sub={`${totalOpened.toLocaleString()} emails opened`}
        icon={<Inbox className="h-5 w-5 text-blue-600" />}
        iconBg="bg-blue-100"
        valueColor="text-blue-600"
      />
      <StatCard
        label="Click Rate"
        value={`${clickPct}%`}
        sub={`${totalClicked.toLocaleString()} links clicked`}
        icon={<MousePointerClick className="h-5 w-5 text-orange-600" />}
        iconBg="bg-orange-100"
        valueColor="text-orange-600"
      />
      <StatCard
        label="Bounce Rate"
        value={`${bouncePct}%`}
        sub={`${totalBounced.toLocaleString()} bounced`}
        icon={<AlertCircle className="h-5 w-5 text-amber-600" />}
        iconBg="bg-amber-100"
        valueColor="text-amber-600"
      />
      <StatCard
        label="Failed Rate"
        value={`${failedPct}%`}
        sub={`${totalFailed.toLocaleString()} failed`}
        icon={<XCircle className="h-5 w-5 text-red-600" />}
        iconBg="bg-red-100"
        valueColor="text-red-600"
      />
    </div>
  );
}

// ─── Campaign table ───────────────────────────────────────────────────────────
const COL = { gridTemplateColumns: '2fr 3fr 80px' };

function CampaignTableRow({
  campaign,
  onViewDetails,
  onSend,
  onDelete,
  canManage,
  shade,
}: {
  campaign: ApiCampaign;
  onViewDetails: (c: ApiCampaign) => void;
  onSend: (c: ApiCampaign) => void;
  onDelete: (id: string) => void;
  canManage: boolean;
  shade: boolean;
}) {
  const isSent = campaign.status === 'sent';
  const deliveryRate = isSent && campaign.stats.sent > 0       ? (campaign.stats.delivered / campaign.stats.sent)       * 100 : 0;
  const openRate     = isSent && campaign.stats.delivered > 0  ? (campaign.stats.opened    / campaign.stats.delivered)  * 100 : 0;
  const clickRate    = isSent && campaign.stats.opened > 0     ? (campaign.stats.clicked   / campaign.stats.opened)     * 100 : 0;
  const bounceRate   = isSent && campaign.stats.sent > 0       ? (campaign.stats.bounced   / campaign.stats.sent)       * 100 : 0;
  const failedRate   = isSent && campaign.stats.sent > 0       ? (campaign.stats.failed    / campaign.stats.sent)       * 100 : 0;

  const dateStr = isSent
    ? formatCampaignDate(campaign.sentAt)
    : campaign.status === 'scheduled'
    ? formatCampaignDate(campaign.scheduledDate)
    : formatCampaignDate(campaign.createdAt);

  return (
    <div
      className={`grid items-center gap-6 px-5 py-4 border-b last:border-b-0 transition-colors hover:bg-accent/40 ${shade ? 'bg-muted/20' : ''}`}
      style={COL}
    >
      {/* Name + meta */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="font-semibold text-sm leading-snug">{campaign.name}</span>
          {!isSent && (
            <Badge variant="outline" className={`capitalize text-[10px] px-1.5 py-0 h-4 font-medium ${getStatusBadgeClass(campaign.status)}`}>
              <span className="flex items-center gap-1">{getStatusIcon(campaign.status)}{campaign.status}</span>
            </Badge>
          )}
          {isSent && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-medium bg-green-50 text-green-700 border-green-200">
              <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />sent</span>
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">{campaign.subject}</p>
        <p className="text-[11px] text-muted-foreground/70 mt-0.5">
          {campaign.listName} · {campaign.totalRecipients.toLocaleString()} recipients
          {dateStr && ` · ${isSent ? 'Sent' : campaign.status === 'scheduled' ? 'Sched.' : 'Created'} ${dateStr}`}
        </p>
      </div>

      {/* 5 metrics in a 2-column grid: primary left, secondary right */}
      <div>
        {isSent ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            <MetricBar label="Delivered" value={deliveryRate} color="green"  />
            <MetricBar label="Bounced"   value={bounceRate}   color="amber"  />
            <MetricBar label="Opened"    value={openRate}     color="blue"   />
            <MetricBar label="Failed"    value={failedRate}   color="red"    />
            <MetricBar label="Clicked"   value={clickRate}    color="orange" />
            <div />
          </div>
        ) : (
          <span className="text-sm text-muted-foreground/40 pl-1">—</span>
        )}
      </div>

      <div className="flex items-center gap-0.5 justify-end">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-accent" onClick={() => onViewDetails(campaign)} title="View details">
          <Eye className="h-3.5 w-3.5" />
        </Button>
        {canManage && ['draft', 'scheduled'].includes(campaign.status) && (
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-primary hover:bg-primary/10" onClick={() => onSend(campaign)} title="Send now">
            <Send className="h-3.5 w-3.5" />
          </Button>
        )}
        {canManage && campaign.status === 'draft' && (
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10" onClick={() => onDelete(campaign.id)} title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function CampaignList({
  campaigns,
  isLoading,
  onViewDetails,
  onSend,
  onDelete,
  canManage,
  emptyMessage = 'No campaigns found',
  paginate = false,
  resetKey,
}: {
  campaigns: ApiCampaign[];
  isLoading?: boolean;
  onViewDetails: (c: ApiCampaign) => void;
  onSend: (c: ApiCampaign) => void;
  onDelete: (id: string) => void;
  canManage: boolean;
  emptyMessage?: string;
  paginate?: boolean;
  resetKey?: string;
}) {
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [resetKey]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-full bg-muted p-4 mb-3">
          <Mail className="h-8 w-8 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">{emptyMessage}</p>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(campaigns.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const rows       = paginate ? campaigns.slice(startIndex, startIndex + PAGE_SIZE) : campaigns;

  return (
    <>
      {/* Table column headers */}
      <div className="grid items-center gap-6 px-5 py-2.5 border-b bg-muted/30" style={COL}>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Campaign</p>
        <div className="grid grid-cols-2 gap-x-6">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-green-600">Delivered</span>
            <span className="text-[10px] text-muted-foreground/50">·</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Bounced</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600">Opened</span>
            <span className="text-[10px] text-muted-foreground/50">·</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-red-600">Failed</span>
          </div>
        </div>
        <div />
      </div>

      {rows.map((c, i) => (
        <CampaignTableRow
          key={c.id}
          campaign={c}
          onViewDetails={onViewDetails}
          onSend={onSend}
          onDelete={onDelete}
          canManage={canManage}
          shade={i % 2 === 0}
        />
      ))}

      {paginate && campaigns.length > PAGE_SIZE && (
        <div className="flex items-center justify-between px-5 py-3 border-t bg-muted/10">
          <p className="text-xs text-muted-foreground">
            {startIndex + 1}–{Math.min(startIndex + rows.length, campaigns.length)} of {campaigns.length}
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>Prev</Button>
            {(() => {
              const maxBtns = 7;
              const start = totalPages <= maxBtns ? 1 : Math.min(Math.max(1, safePage - 3), totalPages - maxBtns + 1);
              return Array.from({ length: Math.min(maxBtns, totalPages) }, (_, i) => start + i).map(p => (
                <Button key={p} variant={safePage === p ? 'default' : 'outline'} size="sm" className="h-7 w-7 p-0 text-xs" onClick={() => setPage(p)}>{p}</Button>
              ));
            })()}
            <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>Next</Button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Performance report card (wraps the table with header + search + tabs) ────
function PerformanceReportCard({
  campaigns,
  isLoading,
  onViewDetails,
  onSend,
  onDelete,
  canManage,
  onCreateClick,
  sentCount,
}: {
  campaigns: ApiCampaign[];
  isLoading: boolean;
  onViewDetails: (c: ApiCampaign) => void;
  onSend: (c: ApiCampaign) => void;
  onDelete: (id: string) => void;
  canManage: boolean;
  onCreateClick: () => void;
  sentCount: number;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab]   = useState('all');

  const filtered = campaigns.filter(c => {
    const q = searchTerm.toLowerCase();
    const match = c.name.toLowerCase().includes(q) || c.subject.toLowerCase().includes(q) || c.listName.toLowerCase().includes(q);
    return activeTab === 'all' ? match : match && c.status === activeTab;
  });

  const count = (s: string) => s === 'all' ? campaigns.length : campaigns.filter(c => c.status === s).length;

  return (
    <Card className="overflow-hidden">
      {/* Card header */}
      <CardHeader className="border-b bg-card pb-0 pt-5 px-5 space-y-0">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <BarChart3 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">Email Performance Report</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''} · {sentCount} sent
              </p>
            </div>
          </div>
          {canManage && (
            <Button size="sm" onClick={onCreateClick} className="h-8 gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              New Campaign
            </Button>
          )}
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, subject or list…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-9 h-8 text-sm bg-muted/30 border-muted"
          />
        </div>

        {/* Status filter tabs — segmented control */}
        <div className="flex bg-muted rounded-xl p-1 gap-0.5 self-start mb-1">
          {(
            [
              { key: 'all',       label: 'All'       },
              { key: 'draft',     label: 'Drafts'    },
              { key: 'scheduled', label: 'Scheduled' },
              { key: 'sent',      label: 'Sent'      },
              { key: 'failed',    label: 'Failed'    },
            ] as const
          ).map(({ key, label }) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-sm font-medium transition-all duration-150 whitespace-nowrap ${
                  active
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
                <span className={`text-[11px] font-semibold tabular-nums transition-colors ${
                  active ? 'text-foreground/60' : 'text-muted-foreground/50'
                }`}>
                  {count(key)}
                </span>
              </button>
            );
          })}
        </div>
      </CardHeader>

      {/* Campaign list */}
      <CardContent className="p-0">
        <CampaignList
          campaigns={filtered}
          isLoading={isLoading}
          onViewDetails={onViewDetails}
          onSend={onSend}
          onDelete={onDelete}
          canManage={canManage}
          emptyMessage={searchTerm ? 'No campaigns match your search' : 'No campaigns yet'}
          resetKey={`${activeTab}|${searchTerm}`}
        />
        {filtered.length === 0 && !isLoading && !searchTerm && canManage && activeTab === 'all' && (
          <div className="pb-6 flex justify-center">
            <Button variant="outline" onClick={onCreateClick} className="gap-2">
              <Plus className="h-4 w-4" />
              Create your first campaign
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Per-agency section ───────────────────────────────────────────────────────
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
  person?: { id: string; firstName: string; lastName: string; roleTitle?: string };
}) {
  const canManageCampaigns = useHasPermission('calls:read');
  const { data, isLoading } = useQuery({
    queryKey: ['campaigns-agency', agency.id, scopeKey],
    queryFn: () => fetchCampaigns({ subCompanyId: agency.id, ownerIds, limit: 100 }),
    staleTime: 0,
    refetchInterval: 30_000,
  });

  const campaigns    = data?.data ?? [];
  const sentC        = campaigns.filter(c => c.status === 'sent');
  const totalSent      = sentC.reduce((a, c) => a + c.stats.sent,       0);
  const totalDelivered = sentC.reduce((a, c) => a + c.stats.delivered,   0);
  const totalOpened    = sentC.reduce((a, c) => a + c.stats.opened,      0);
  const totalClicked   = sentC.reduce((a, c) => a + c.stats.clicked,     0);
  const totalBounced   = sentC.reduce((a, c) => a + c.stats.bounced,     0);
  const totalFailed    = sentC.reduce((a, c) => a + c.stats.failed,      0);

  const [searchTerm, setSearchTerm] = useState('');
  const filtered = campaigns.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.subject.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-5 pb-8 border-b last:border-b-0">
      {person ? (
        <PersonSectionHeader user={person} roleTitle={person.roleTitle} subtitle={subtitle} onView={onViewAgency} viewLabel={viewLabel} className="mb-0" />
      ) : (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{agency.name}</h2>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <Button size="sm" variant="outline" onClick={onViewAgency}>{viewLabel}</Button>
        </div>
      )}

      <AgencyBulkEmailConversionCard agencyId={agency.id} title={`${agency.name} — Mail Conversion Rate`} />

      <CampaignStatCards totalSent={totalSent} totalDelivered={totalDelivered} totalOpened={totalOpened} totalClicked={totalClicked} totalBounced={totalBounced} totalFailed={totalFailed} />

      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/20 py-3 px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Campaign Performance</span>
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{campaigns.length}</Badge>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-7 h-7 text-xs w-40 bg-background"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <CampaignList
            campaigns={filtered}
            isLoading={isLoading}
            onViewDetails={onViewDetails}
            onSend={onSend}
            onDelete={onDelete}
            canManage={canManageCampaigns}
            emptyMessage="No campaigns yet"
            paginate
            resetKey={`${agency.id}|${scopeKey}|${searchTerm}`}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function BulkEmails() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const canManageCampaigns = useHasPermission('calls:read');
  const preselectedListId = (location.state as { preselectedListId?: string } | null)?.preselectedListId;

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(!!preselectedListId);
  const [selectedCampaign, setSelectedCampaign]     = useState<ApiCampaign | null>(null);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  const [sendingCampaign, setSendingCampaign]       = useState<ApiCampaign | null>(null);
  const [isSending, setIsSending]                   = useState(false);

  const ownSubCompanyId = useAuthStore(s => s.user?.subCompanyId);
  const scopeFilter = useScopeFilter();
  const {
    isElevated, showHierarchyFilters, agencies, selectedAgencyId,
    setSelectedAgencyId, setSelectedUserId, setSelectedManagerId,
    filterRowProps, selectedManagerId, managerParamInUrl,
    selectedUserId, userParamInUrl, getManagersForLeader,
    getAssociatesForManager, selectedLeaderId, leaderParamInUrl,
    managers: allManagers, showAllTeamView, showAgencySections,
    sectionUsers, showManagerSections,
  } = scopeFilter;
  const { ownerIds, scopeKey } = useScopeQueryParams(scopeFilter);

  const campaignOwnerIds = useMemo(() => {
    if (userParamInUrl && selectedUserId !== 'all') return [selectedUserId];
    if (userParamInUrl && selectedUserId === 'all' && managerParamInUrl && selectedManagerId !== 'all') {
      const associates = getAssociatesForManager(selectedManagerId);
      return associates.length > 0 ? associates.map(a => a.id) : [EMPTY_OWNER_SENTINEL];
    }
    if (managerParamInUrl && selectedManagerId !== 'all') return [selectedManagerId];
    if (managerParamInUrl && selectedManagerId === 'all') {
      if (leaderParamInUrl && selectedLeaderId !== 'all') {
        const mgrs = getManagersForLeader(selectedLeaderId);
        return mgrs.length > 0 ? mgrs.map(m => m.id) : allManagers.map(m => m.id);
      }
      return allManagers.length > 0 ? allManagers.map(m => m.id) : undefined;
    }
    return ownerIds;
  }, [managerParamInUrl, selectedManagerId, userParamInUrl, selectedUserId, leaderParamInUrl, selectedLeaderId, getManagersForLeader, getAssociatesForManager, allManagers, ownerIds]);

  const showAllAgenciesView = showAgencySections;
  const querySubCompanyId   = isElevated
    ? selectedAgencyId === 'me' ? (ownSubCompanyId ?? undefined) : selectedAgencyId !== 'all' ? selectedAgencyId : undefined
    : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['campaigns', isElevated ? selectedAgencyId : 'own', ownSubCompanyId, scopeKey, campaignOwnerIds?.join(',') ?? ''],
    queryFn: () => fetchCampaigns({ limit: 100, subCompanyId: querySubCompanyId, ownerIds: campaignOwnerIds }),
    enabled: !showAllAgenciesView && !showAllTeamView,
    refetchInterval: 30_000,
  });

  const campaigns  = data?.data ?? [];
  const sentC      = campaigns.filter(c => c.status === 'sent');
  const totalSent      = sentC.reduce((a, c) => a + c.stats.sent,       0);
  const totalDelivered = sentC.reduce((a, c) => a + c.stats.delivered,   0);
  const totalOpened    = sentC.reduce((a, c) => a + c.stats.opened,      0);
  const totalClicked   = sentC.reduce((a, c) => a + c.stats.clicked,     0);
  const totalBounced   = sentC.reduce((a, c) => a + c.stats.bounced,     0);
  const totalFailed    = sentC.reduce((a, c) => a + c.stats.failed,      0);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ predicate: q => q.queryKey[0] === 'campaigns' || q.queryKey[0] === 'campaigns-agency' });
  };

  const handleViewDetails = (campaign: ApiCampaign) => {
    setSelectedCampaign(campaign);
    setIsDetailsDialogOpen(true);
  };

  const handleDeleteCampaign = async (id: string) => {
    const ok = await deleteCampaign(id);
    if (ok) { invalidateAll(); toast.success('Campaign deleted'); }
    else     { toast.error('Failed to delete campaign'); }
  };

  const handleConfirmSend = async () => {
    if (!sendingCampaign) return;
    setIsSending(true);
    const result = await sendCampaign(sendingCampaign.id);
    setIsSending(false);
    setSendingCampaign(null);
    if (result) { invalidateAll(); toast.success(`Campaign sent to ${result.totalRecipients} recipients`); }
    else        { toast.error('Failed to send campaign — check that clients have email addresses'); }
  };

  const selectedAgencyName =
    selectedAgencyId === 'me'
      ? agencies.find(a => a.id === ownSubCompanyId)?.name
      : agencies.find(a => a.id === selectedAgencyId)?.name;

  return (
    <div className="flex-1 space-y-6 px-8 pb-8 pt-0">
      {/* Page header */}
      <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between pt-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5">
            <Mail className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Bulk Email Campaigns</h1>
            <p className="text-sm text-muted-foreground">Create and manage email campaigns for your lists</p>
          </div>
        </div>
        {canManageCampaigns && !showAllAgenciesView && !showAllTeamView && (
          <Button onClick={() => setIsCreateDialogOpen(true)} className="gap-2 self-start md:self-auto">
            <Plus className="h-4 w-4" />
            Create Campaign
          </Button>
        )}
      </div>

      <StickyHeader zIndex={40}>
        <ScopeFilterBar show={showHierarchyFilters} filterRowProps={filterRowProps} />
      </StickyHeader>

      {/* ── People sections ── */}
      {showAllTeamView ? (
        sectionUsers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-muted p-4 mb-3">
              <Mail className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">
              {showManagerSections ? 'No managers / team in this agency' : 'No team members in this scope'}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {sectionUsers.map(user => {
              const agencyIdForUser =
                selectedAgencyId !== 'all' && selectedAgencyId !== 'me'
                  ? selectedAgencyId
                  : user.subCompanyId || ownSubCompanyId || '';
              const agencyName = agencies.find(a => a.id === agencyIdForUser)?.name ?? `${user.firstName} ${user.lastName}`.trim();
              if (!agencyIdForUser) return (
                <div key={user.id} className="space-y-1">
                  <h2 className="text-lg font-semibold">{user.firstName} {user.lastName}</h2>
                  <p className="text-sm text-muted-foreground">No agency found for this user</p>
                </div>
              );
              return (
                <AgencyCampaignsSection
                  key={user.id}
                  agency={{ id: agencyIdForUser, name: agencyName, countries: [] }}
                  person={{ id: user.id, firstName: user.firstName, lastName: user.lastName, roleTitle: getUserRoleTitle(user) }}
                  subtitle={agencyName}
                  viewLabel="View"
                  onViewAgency={() => showManagerSections ? setSelectedManagerId(user.id) : setSelectedUserId(user.id)}
                  onViewDetails={handleViewDetails}
                  onSend={c => setSendingCampaign(c)}
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
          {agencies.map(agency => (
            <AgencyCampaignsSection
              key={agency.id}
              agency={agency}
              onViewAgency={() => setSelectedAgencyId(agency.id)}
              onViewDetails={handleViewDetails}
              onSend={c => setSendingCampaign(c)}
              onDelete={handleDeleteCampaign}
              ownerIds={campaignOwnerIds}
              scopeKey={`${scopeKey}|${campaignOwnerIds?.join(',') ?? ''}`}
            />
          ))}
        </div>
      ) : (
        <>
          {/* Mail Conversion Rate */}
          {isElevated ? (
            <AgencyBulkEmailConversionCard
              agencyId={querySubCompanyId}
              title={selectedAgencyName ? `${selectedAgencyName} — Mail Conversion Rate` : undefined}
            />
          ) : (
            <AgencyBulkEmailConversionCard />
          )}

          {/* Stat cards */}
          <CampaignStatCards
            totalSent={totalSent}
            totalDelivered={totalDelivered}
            totalOpened={totalOpened}
            totalClicked={totalClicked}
            totalBounced={totalBounced}
            totalFailed={totalFailed}
          />

          {/* Performance report card */}
          <PerformanceReportCard
            campaigns={campaigns}
            isLoading={isLoading}
            onViewDetails={handleViewDetails}
            onSend={c => setSendingCampaign(c)}
            onDelete={handleDeleteCampaign}
            canManage={canManageCampaigns}
            onCreateClick={() => setIsCreateDialogOpen(true)}
            sentCount={sentC.length}
          />
        </>
      )}

      {/* Dialogs */}
      <CreateCampaignDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onSuccess={invalidateAll}
        defaultListId={preselectedListId}
        subCompanyId={isElevated ? querySubCompanyId : undefined}
      />
      {selectedCampaign && (
        <CampaignDetailsDialog
          campaign={selectedCampaign}
          open={isDetailsDialogOpen}
          onOpenChange={setIsDetailsDialogOpen}
          onStatsRefreshed={invalidateAll}
        />
      )}

      <AlertDialog open={!!sendingCampaign} onOpenChange={o => { if (!o) setSendingCampaign(null); }}>
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
