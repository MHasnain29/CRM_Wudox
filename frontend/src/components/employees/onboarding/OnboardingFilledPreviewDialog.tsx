import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { EmployeeOnboardingPrefill } from './buildOnboardingPrefill';
import { fillOnboardingPdf } from './fillOnboardingPdf';

export const ONBOARDING_PACKAGE_NAME = 'Candidate Onboarding Compliance Package';
export const ONBOARDING_PACKAGE_META = '5 sections · PandaDoc · e-sign';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill: EmployeeOnboardingPrefill | null;
  /** Master-only: include name-based demo signatures in the filled PDF. */
  includeDemoSignature?: boolean;
};

export function OnboardingFilledPreviewDialog({
  open,
  onOpenChange,
  prefill,
  includeDemoSignature = false,
}: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !prefill) {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      setBlobUrl(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const blob = await fillOnboardingPdf(prefill, { includeDemoSignature });
        if (cancelled) return;
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setBlobUrl(url);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to fill preview PDF');
        setBlobUrl(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, prefill, includeDemoSignature]);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(90vh,860px)] w-[min(96vw,920px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
        <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="text-[15px] font-semibold tracking-tight">
              {ONBOARDING_PACKAGE_NAME}
            </DialogTitle>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-900">
              Demo · local fill
            </span>
          </div>
          <p className="text-[12px] text-muted-foreground">
            {ONBOARDING_PACKAGE_META} · filled PDF preview (no PandaDoc credits)
          </p>
        </DialogHeader>

        <div className="relative min-h-0 flex-1 bg-muted/30">
          {loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/70">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-[12px] text-muted-foreground">Filling document…</p>
            </div>
          )}
          {error && !loading && (
            <div className="flex h-full items-center justify-center p-6">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
          {blobUrl && !error && (
            <iframe
              title={ONBOARDING_PACKAGE_NAME}
              src={`${blobUrl}#toolbar=1`}
              className="h-full w-full border-0"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
