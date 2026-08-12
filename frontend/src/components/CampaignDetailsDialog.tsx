import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { type ApiCampaign, type ApiCampaignRecipient, fetchCampaignRecipients, refreshCampaignStats } from '@/lib/api';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { Mail, CheckCircle2, XCircle, Clock, MousePointerClick, AlertCircle, Loader2, RefreshCw, Send } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

interface CampaignDetailsDialogProps {
  campaign: ApiCampaign;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStatsRefreshed?: (updated: ApiCampaign) => void;
}

// Derive the true display status from timestamps — more reliable than the status field alone,
// since the DB status field can lag behind webhook events.
function deriveStatus(r: ApiCampaignRecipient): string {
  if (r.clickedAt) return 'clicked';
  if (r.openedAt) return 'opened';
  if (r.deliveredAt) return 'delivered';
  if (r.status === 'bounced') return 'bounced';
  if (r.status === 'failed' || r.errorMessage) return 'failed';
  if (r.sentAt) return 'sent';
  return 'pending';
}

const STATUS_ORDER: Record<string, number> = {
  clicked: 0, opened: 1, delivered: 2, sent: 3, pending: 4, bounced: 5, failed: 6,
};

const STATUS_FILTER_LABELS = ['All', 'Clicked', 'Opened', 'Delivered', 'Sent', 'Bounced', 'Failed'] as const;
type StatusFilter = typeof STATUS_FILTER_LABELS[number];

export function CampaignDetailsDialog({ campaign, open, onOpenChange, onStatsRefreshed }: CampaignDetailsDialogProps) {
  const [recipients, setRecipients] = useState<ApiCampaignRecipient[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [refreshingStats, setRefreshingStats] = useState(false);
  const [liveStats, setLiveStats] = useState(campaign.stats);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');

  useEffect(() => {
    setLiveStats(campaign.stats);
  }, [campaign.id, campaign.stats]);

  const loadRecipients = async () => {
    const data = await fetchCampaignRecipients(campaign.id);
    setRecipients(data);
  };

  useEffect(() => {
    if (!open) return;

    setLoadingRecipients(true);
    loadRecipients().finally(() => setLoadingRecipients(false));

    // Auto-refresh stats + recipient statuses from SendGrid when dialog opens
    if (campaign.status === 'sent') {
      refreshCampaignStats(campaign.id).then((updated) => {
        if (updated) {
          setLiveStats(updated.stats);
          onStatsRefreshed?.(updated);
          loadRecipients();
        }
      });
    }

    // Poll recipients every 30s while dialog is open (background job updates DB every 30s)
    if (campaign.status !== 'sent') return;
    const interval = setInterval(loadRecipients, 30_000);
    return () => clearInterval(interval);
  }, [open, campaign.id]);

  const handleRefreshStats = async () => {
    setRefreshingStats(true);
    const updated = await refreshCampaignStats(campaign.id);
    setRefreshingStats(false);
    if (updated) {
      setLiveStats(updated.stats);
      onStatsRefreshed?.(updated);
      await loadRecipients();
      toast.success('Stats updated from SendGrid');
    } else {
      toast.error('Failed to fetch stats from SendGrid');
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'delivered': return <CheckCircle2 className="h-3.5 w-3.5" />;
      case 'sent':      return <Send className="h-3.5 w-3.5" />;
      case 'opened':    return <Mail className="h-3.5 w-3.5" />;
      case 'clicked':   return <MousePointerClick className="h-3.5 w-3.5" />;
      case 'bounced':   return <AlertCircle className="h-3.5 w-3.5" />;
      case 'failed':    return <XCircle className="h-3.5 w-3.5" />;
      default:          return <Clock className="h-3.5 w-3.5" />;
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'delivered': return 'bg-green-500/10 text-green-700 border-green-500/20';
      case 'sent':      return 'bg-gray-500/10 text-gray-600 border-gray-400/20';
      case 'opened':    return 'bg-blue-500/10 text-blue-700 border-blue-500/20';
      case 'clicked':   return 'bg-purple-500/10 text-purple-700 border-purple-500/20';
      case 'bounced':   return 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20';
      case 'failed':    return 'bg-red-500/10 text-red-600 border-red-500/20';
      default:          return 'bg-gray-500/10 text-gray-500 border-gray-400/20';
    }
  };

  const formatDateTime = (iso?: string | null) => {
    if (!iso) return '-';
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return '-';
    return format(parsed, 'MMM dd, yyyy h:mm a');
  };

  // Sort recipients: most engaged first, then alphabetically by client name
  const sortedRecipients = [...recipients].sort((a, b) => {
    const aRank = STATUS_ORDER[deriveStatus(a)] ?? 99;
    const bRank = STATUS_ORDER[deriveStatus(b)] ?? 99;
    if (aRank !== bRank) return aRank - bRank;
    return a.clientName.localeCompare(b.clientName);
  });

  // Count per status for filter tabs
  const statusCounts = recipients.reduce<Record<string, number>>((acc, r) => {
    const s = deriveStatus(r);
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  const filteredRecipients = statusFilter === 'All'
    ? sortedRecipients
    : sortedRecipients.filter((r) => deriveStatus(r) === statusFilter.toLowerCase());

  const getLastActivity = (r: ApiCampaignRecipient) => {
    if (r.clickedAt)   return `Clicked: ${format(new Date(r.clickedAt), 'MMM dd, h:mm a')}`;
    if (r.openedAt)    return `Opened: ${format(new Date(r.openedAt), 'MMM dd, h:mm a')}`;
    if (r.deliveredAt) return `Delivered: ${format(new Date(r.deliveredAt), 'MMM dd, h:mm a')}`;
    if (r.errorMessage) return r.errorMessage;
    return '-';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
            <div className="flex items-center justify-between">
            <DialogTitle>{campaign.name}</DialogTitle>
            {campaign.status === 'sent' && (
              <Button variant="outline" size="sm" onClick={handleRefreshStats} disabled={refreshingStats}>
                {refreshingStats
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <RefreshCw className="h-4 w-4" />}
                <span className="ml-2">Refresh Stats</span>
              </Button>
            )}
          </div>
        </DialogHeader>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="recipients">
              Recipients ({loadingRecipients ? '…' : recipients.length})
            </TabsTrigger>
            <TabsTrigger value="content">Email Content</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Campaign Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">List:</span>
                    <span className="font-medium">{campaign.listName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Recipients:</span>
                    <span className="font-medium">{campaign.totalRecipients}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status:</span>
                    <Badge variant="secondary" className={`capitalize ${getStatusBadgeClass(campaign.status)}`}>
                      {campaign.status}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Created:</span>
                    <span className="font-medium">{formatDateTime(campaign.createdAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {campaign.status === 'scheduled' ? 'Scheduled' : 'Draft time'}:
                    </span>
                    <span className="font-medium">{formatDateTime(campaign.scheduledDate)}</span>
                  </div>
                  {campaign.sentAt && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Sent:</span>
                      <span className="font-medium">{formatDateTime(campaign.sentAt)}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Performance Stats</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { label: 'Sent', value: liveStats.sent, pct: campaign.totalRecipients > 0 ? Math.round((liveStats.sent / campaign.totalRecipients) * 100) : 0, color: '' },
                    { label: 'Delivered', value: liveStats.delivered, pct: liveStats.sent > 0 ? Math.round((liveStats.delivered / liveStats.sent) * 100) : 0, color: 'text-green-600' },
                    { label: 'Opened', value: liveStats.opened, pct: liveStats.delivered > 0 ? Math.round((liveStats.opened / liveStats.delivered) * 100) : 0, color: 'text-blue-600' },
                    { label: 'Clicked', value: liveStats.clicked, pct: liveStats.opened > 0 ? Math.round((liveStats.clicked / liveStats.opened) * 100) : 0, color: 'text-purple-600' },
                  ].map(({ label, value, pct, color }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">{label}</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-2xl font-bold ${color}`}>{value}</span>
                        <span className="text-sm text-muted-foreground">({pct}%)</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            {(liveStats.bounced > 0 || liveStats.failed > 0) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Issues</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {liveStats.bounced > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Bounced</span>
                      <span className="text-lg font-bold text-yellow-600">{liveStats.bounced}</span>
                    </div>
                  )}
                  {liveStats.failed > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Failed</span>
                      <span className="text-lg font-bold text-red-600">{liveStats.failed}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="recipients" className="space-y-3">
            {loadingRecipients ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : recipients.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No recipients yet</div>
            ) : (
              <>
                {/* Status filter chips */}
                <div className="flex flex-wrap gap-2">
                  {STATUS_FILTER_LABELS.map((label) => {
                    const count = label === 'All' ? recipients.length : (statusCounts[label.toLowerCase()] ?? 0);
                    if (label !== 'All' && count === 0) return null;
                    const isActive = statusFilter === label;
                    return (
                      <button
                        key={label}
                        onClick={() => setStatusFilter(label)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                          isActive
                            ? label === 'All'
                              ? 'bg-foreground text-background border-foreground'
                              : getStatusBadgeClass(label.toLowerCase()).replace('/10', '/20') + ' border'
                            : 'bg-transparent text-muted-foreground border-border hover:bg-muted'
                        }`}
                      >
                        {label !== 'All' && getStatusIcon(label.toLowerCase())}
                        {label}
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${isActive ? 'bg-background/20' : 'bg-muted'}`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="rounded-md border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead className="font-semibold">Client</TableHead>
                        <TableHead className="font-semibold">Email</TableHead>
                        <TableHead className="font-semibold">Status</TableHead>
                        <TableHead className="font-semibold">Sent At</TableHead>
                        <TableHead className="font-semibold">Last Activity</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRecipients.map((recipient) => {
                        const displayStatus = deriveStatus(recipient);
                        return (
                          <TableRow key={recipient.id} className="hover:bg-muted/30">
                            <TableCell className="font-medium">{recipient.clientName}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">{recipient.email}</TableCell>
                            <TableCell>
                              <Badge
                                variant="secondary"
                                className={`capitalize flex w-fit items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium border ${getStatusBadgeClass(displayStatus)}`}
                              >
                                {getStatusIcon(displayStatus)}
                                {displayStatus}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {recipient.sentAt ? format(new Date(recipient.sentAt), 'MMM dd, h:mm a') : '-'}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {getLastActivity(recipient)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {filteredRecipients.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No recipients with status "{statusFilter.toLowerCase()}"
                  </div>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="content" className="space-y-4">
            <div>
              <h4 className="text-sm font-medium mb-2">Subject</h4>
              <div className="p-4 rounded-lg bg-muted">
                <p className="text-sm">{campaign.subject}</p>
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium mb-2">Email Body</h4>
              <div
                className="p-4 rounded-lg border bg-background"
                dangerouslySetInnerHTML={{ __html: campaign.body }}
              />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
