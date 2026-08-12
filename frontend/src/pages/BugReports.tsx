import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StickyHeader } from '@/components/StickyHeader';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { fetchBugReports, closeBugReport, getBugReportScreenshotUrl, getAuthHeaders, type ApiBugReport } from '@/lib/api';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Loader2, Bug, CheckCircle2, User, Building2, X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { useHasPermission } from '@/lib/access';

export default function BugReports() {
  const canView = useHasPermission('bug_reports:read');

  const [activeTab, setActiveTab] = useState<'open' | 'closed'>('open');
  const [openBugs, setOpenBugs] = useState<ApiBugReport[]>([]);
  const [closedBugs, setClosedBugs] = useState<ApiBugReport[]>([]);
  const [loadingOpen, setLoadingOpen] = useState(false);
  const [loadingClosed, setLoadingClosed] = useState(false);
  const [closeDialogBugId, setCloseDialogBugId] = useState<string | null>(null);
  const [resolutionRemarks, setResolutionRemarks] = useState('');
  const [closing, setClosing] = useState(false);
  const [screenshotBugId, setScreenshotBugId] = useState<string | null>(null);
  const [screenshotBlobUrl, setScreenshotBlobUrl] = useState<string | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [screenshotError, setScreenshotError] = useState(false);
  const [screenshotZoom, setScreenshotZoom] = useState(1);

  const loadOpen = useCallback(async () => {
    if (!canView) return;
    setLoadingOpen(true);
    try {
      const { data } = await fetchBugReports({ status: 'open', limit: 100 });
      setOpenBugs(data);
    } catch {
      toast.error('Failed to load open bugs');
    } finally {
      setLoadingOpen(false);
    }
  }, [canView]);

  const loadClosed = useCallback(async () => {
    if (!canView) return;
    setLoadingClosed(true);
    try {
      const { data } = await fetchBugReports({ status: 'closed', limit: 100 });
      setClosedBugs(data);
    } catch {
      toast.error('Failed to load closed bugs');
    } finally {
      setLoadingClosed(false);
    }
  }, [canView]);

  useEffect(() => {
    if (activeTab === 'open') loadOpen();
    else loadClosed();
  }, [activeTab, loadOpen, loadClosed]);

  const handleViewScreenshot = useCallback(async (bugId: string) => {
    setScreenshotBugId(bugId);
    setScreenshotBlobUrl(null);
    setScreenshotError(false);
    setScreenshotZoom(1);
    setScreenshotLoading(true);
    try {
      const url = getBugReportScreenshotUrl(bugId);
      const res = await fetch(url, { credentials: 'include', headers: getAuthHeaders() as HeadersInit });
      if (!res.ok) {
        setScreenshotError(true);
        return;
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      setScreenshotBlobUrl(blobUrl);
    } catch {
      setScreenshotError(true);
    } finally {
      setScreenshotLoading(false);
    }
  }, []);

  const closeScreenshotDialog = useCallback(() => {
    setScreenshotBugId(null);
    if (screenshotBlobUrl) {
      URL.revokeObjectURL(screenshotBlobUrl);
      setScreenshotBlobUrl(null);
    }
    setScreenshotError(false);
  }, [screenshotBlobUrl]);

  const handleCloseBug = async () => {
    if (!closeDialogBugId || !resolutionRemarks.trim()) return;
    setClosing(true);
    try {
      await closeBugReport(closeDialogBugId, resolutionRemarks.trim());
      toast.success('Bug report closed');
      setCloseDialogBugId(null);
      setResolutionRemarks('');
      loadOpen();
      loadClosed();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to close');
    } finally {
      setClosing(false);
    }
  };

  if (!canView) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Bug Reports</h1>
          <p className="text-muted-foreground mt-1">View and manage reported bugs</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-muted-foreground">
              You don&apos;t have permission to access this page. Only Super Admin, Director, and Operations Manager can view bug reports.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="pt-6">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <Bug className="h-8 w-8" />
          Bug Reports
        </h1>
        <p className="text-muted-foreground mt-1">
          View and manage reported bugs. Close with resolution remarks to notify the reporter.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'open' | 'closed')}>
        <StickyHeader>
          <TabsList>
            <TabsTrigger value="open">
              Open
              {openBugs.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {openBugs.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="closed">Closed</TabsTrigger>
          </TabsList>
        </StickyHeader>
        <TabsContent value="open" className="mt-4">
          {loadingOpen ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : openBugs.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-center text-muted-foreground">No open bug reports.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {openBugs.map((bug) => (
                <BugReportCard
                  key={bug.id}
                  bug={bug}
                  onClose={() => {
                    setCloseDialogBugId(bug.id);
                    setResolutionRemarks('');
                  }}
                  onViewScreenshot={handleViewScreenshot}
                />
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="closed" className="mt-4">
          {loadingClosed ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : closedBugs.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-center text-muted-foreground">No closed bug reports.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {closedBugs.map((bug) => (
                <BugReportCard key={bug.id} bug={bug} onViewScreenshot={handleViewScreenshot} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!screenshotBugId} onOpenChange={(open) => !open && closeScreenshotDialog()}>
        <DialogContent
          aria-describedby={undefined}
          className="rounded-none border-0 p-0 flex flex-col bg-background [&>button]:hidden"
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
            maxWidth: 'none',
            maxHeight: 'none',
            transform: 'none',
            margin: 0,
          }}
          onEscapeKeyDown={() => closeScreenshotDialog()}
        >
          {/* Top bar: title, zoom controls, close */}
          <div className="flex items-center justify-between gap-4 shrink-0 h-14 px-4 border-b bg-muted/50">
            <DialogTitle className="text-lg font-semibold m-0">Screenshot</DialogTitle>
            {screenshotBlobUrl && !screenshotLoading && (
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => setScreenshotZoom((z) => Math.max(0.25, z - 0.25))}
                  title="Zoom out"
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="text-sm tabular-nums min-w-[3rem] text-center">{Math.round(screenshotZoom * 100)}%</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => setScreenshotZoom((z) => Math.min(4, z + 0.25))}
                  title="Zoom in"
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => setScreenshotZoom(1)}
                  title="Reset zoom"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground hidden sm:inline">Ctrl + scroll to zoom</span>
              </div>
            )}
            <div className="flex-1 min-w-0" />
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => closeScreenshotDialog()}
              title="Close"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          {/* Scrollable image area — Ctrl+wheel to zoom */}
          <div
            className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-4"
            onWheel={(e) => {
              if (!screenshotBlobUrl || screenshotLoading || !e.ctrlKey) return;
              e.preventDefault();
              const delta = e.deltaY > 0 ? -0.2 : 0.2;
              setScreenshotZoom((z) => Math.max(0.25, Math.min(4, z + delta)));
            }}
          >
            {screenshotLoading && (
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            )}
            {screenshotError && !screenshotLoading && (
              <p className="text-sm text-destructive">Failed to load screenshot</p>
            )}
            {screenshotBlobUrl && !screenshotLoading && (
              <img
                src={screenshotBlobUrl}
                alt="Bug report screenshot"
                className="max-w-full object-contain transition-transform origin-center select-none"
                style={{ transform: `scale(${screenshotZoom})` }}
                draggable={false}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!closeDialogBugId} onOpenChange={(open) => !open && setCloseDialogBugId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Close bug report</DialogTitle>
            <DialogDescription>
              Add resolution remarks. The reporter will receive an email and notification.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="resolution-remarks">Resolution remarks *</Label>
            <Textarea
              id="resolution-remarks"
              placeholder="Describe how the issue was resolved..."
              value={resolutionRemarks}
              onChange={(e) => setResolutionRemarks(e.target.value)}
              rows={4}
              className="resize-none"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialogBugId(null)} disabled={closing}>
              Cancel
            </Button>
            <Button
              onClick={handleCloseBug}
              disabled={!resolutionRemarks.trim() || closing}
            >
              {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Close report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BugReportCard({
  bug,
  onClose,
  onViewScreenshot,
}: {
  bug: ApiBugReport;
  onClose?: () => void;
  onViewScreenshot?: (bugId: string) => void;
}) {
  const isClosed = bug.status === 'closed';
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 flex-1 min-w-0">
            <CardTitle className="text-base flex items-center gap-2">
              {bug.title || 'Bug report'}
              <Badge variant={isClosed ? 'secondary' : 'default'}>
                {bug.status}
              </Badge>
            </CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              {bug.submittedBy && (
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {bug.submittedBy.name} ({bug.submittedBy.email})
                </span>
              )}
              {bug.subCompany && (
                <span className="flex items-center gap-1">
                  <Building2 className="h-3 w-3" />
                  {bug.subCompany.name}
                </span>
              )}
              <span>{format(new Date(bug.createdAt), 'MMM d, yyyy h:mm a')}</span>
            </CardDescription>
          </div>
          {!isClosed && onClose && (
            <Button size="sm" variant="outline" onClick={onClose}>
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Close
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-foreground whitespace-pre-wrap">{bug.description}</p>
        {bug.screenshotUrl && (
          <button
            type="button"
            onClick={() => onViewScreenshot?.(bug.id)}
            className="text-sm text-primary hover:underline text-left"
          >
            View screenshot
          </button>
        )}
        {isClosed && bug.resolutionRemarks && (
          <div className="rounded-md bg-muted p-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">Resolution</p>
            <p className="text-sm whitespace-pre-wrap">{bug.resolutionRemarks}</p>
            {bug.resolvedBy && bug.resolvedAt && (
              <p className="text-xs text-muted-foreground mt-2">
                Closed by {bug.resolvedBy.name} on {format(new Date(bug.resolvedAt), 'MMM d, yyyy h:mm a')}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
