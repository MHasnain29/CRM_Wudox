import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { DismissableLayerBranch } from '@radix-ui/react-dismissable-layer';
import { useLocation } from 'react-router-dom';
import { Crop } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SnipRegionOverlay } from '@/components/SnipRegionOverlay';
import { SnipShareDialog } from '@/components/SnipShareDialog';
import { useFloatingActionDockLayout } from '@/lib/floatingActionDock';
import {
  ensureTabCaptureStream,
  hasCachedTabCapture,
  releaseTabCapture,
  subscribeTabCaptureSession,
  type TabCaptureFailReason,
} from '@/lib/captureScreen';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const PUBLIC_AUTH_PATHS = new Set(['/login', '/forgot-password', '/reset-password']);

export function SnippingToolWidget() {
  const location = useLocation();
  const { snip } = useFloatingActionDockLayout();
  const isAuthenticatedView = Boolean(localStorage.getItem('na_staffing_token')) && !PUBLIC_AUTH_PATHS.has(location.pathname);

  const [snipping, setSnipping] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [awaitingPermission, setAwaitingPermission] = useState(false);
  const [captureSessionActive, setCaptureSessionActive] = useState(false);
  const [croppedImage, setCroppedImage] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const reset = useCallback(() => {
    setSnipping(false);
    setPreparing(false);
    setAwaitingPermission(false);
    setCroppedImage(null);
    setShareOpen(false);
  }, []);

  const handleStartSnip = useCallback(async () => {
    if (snipping || preparing) return;

    const needsPermission = !hasCachedTabCapture();
    setPreparing(true);
    setAwaitingPermission(needsPermission);
    document.body.setAttribute('data-snip-active', '');

    const result = await ensureTabCaptureStream();
    setAwaitingPermission(false);
    setPreparing(false);

    if (result !== true) {
      const reason: TabCaptureFailReason = result;
      const msg =
        reason === 'wrong_surface'
          ? 'Please pick "Tab" (or "This Tab") in the browser picker — not Screen or Window.'
          : reason === 'not_supported'
          ? 'Screen capture is not supported in this browser. Try Chrome or Safari 17+.'
          : reason === 'denied'
          ? 'Permission denied or cancelled. Click Snip and allow screen access when prompted.'
          : needsPermission
          ? 'Snip needs screen access. In the browser prompt, pick "This Tab" (or "Tab" on Safari) and click Share.'
          : 'Tab capture ended. Click Snip again to re-share this tab.';
      toast.error(msg, { duration: 6000 });
      reset();
      return;
    }

    setSnipping(true);
  }, [snipping, preparing, reset]);

  const handleCropComplete = useCallback((dataUrl: string) => {
    setSnipping(false);
    setCroppedImage(dataUrl);
    setShareOpen(true);
  }, []);

  const handleCropCancel = useCallback(() => {
    reset();
  }, [reset]);

  const handleShareClose = useCallback(
    (open: boolean) => {
      setShareOpen(open);
      if (!open) reset();
    },
    [reset],
  );

  useEffect(() => {
    if (!snipping && !shareOpen && !preparing) return;
    document.body.setAttribute('data-snip-active', '');
    return () => document.body.removeAttribute('data-snip-active');
  }, [snipping, shareOpen, preparing]);

  useEffect(() => {
    if (!isAuthenticatedView) releaseTabCapture();
  }, [isAuthenticatedView]);

  useEffect(() => () => releaseTabCapture(), []);

  useEffect(() => subscribeTabCaptureSession(setCaptureSessionActive), []);

  if (!isAuthenticatedView) return null;

  const widget = (
    <>
      {!snipping && !preparing && (
        <div
          data-snip-ignore
          className={cn('fixed z-[250] pointer-events-none', snip.right)}
          style={{ bottom: snip.bottomPx }}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleStartSnip}
                aria-label="Snip and share"
                className={cn(
                  'pointer-events-auto h-12 w-12 rounded-full shadow-lg',
                  'bg-primary text-primary-foreground flex items-center justify-center',
                  'hover:bg-primary/90 transition-colors',
                  captureSessionActive && 'ring-2 ring-emerald-400/80 ring-offset-2 ring-offset-background'
                )}
              >
                <Crop className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="pointer-events-auto max-w-[220px]">
              {captureSessionActive ? 'Snip ready — no permission needed until idle/refresh' : 'Snip & share'}
            </TooltipContent>
          </Tooltip>
        </div>
      )}

      {preparing && awaitingPermission && (
        <div
          data-snip-ignore
          className="fixed inset-0 z-[9999] flex items-start justify-center pt-4 pointer-events-none"
        >
          <div className="rounded-lg bg-background/95 border px-4 py-2 text-sm shadow-lg max-w-md text-center">
            In the browser prompt, pick <strong>This Tab</strong> (Chrome) or <strong>Tab</strong> (Safari) and click Share.
            You only need to do this once until idle/refresh.
          </div>
        </div>
      )}

      {snipping && (
        <SnipRegionOverlay onComplete={handleCropComplete} onCancel={handleCropCancel} />
      )}

      <SnipShareDialog
        open={shareOpen}
        onOpenChange={handleShareClose}
        screenshotDataUrl={croppedImage}
        onSent={reset}
      />
    </>
  );

  return createPortal(<DismissableLayerBranch>{widget}</DismissableLayerBranch>, document.body);
}
