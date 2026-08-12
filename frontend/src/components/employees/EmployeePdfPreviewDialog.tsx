/**
 * In-page modal document preview (PDF / images via iframe).
 * Used for signed agreements and employee document View — no new browser tab.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, Download, ExternalLink, FileText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { fetchEmployeeDocumentBlob } from '@/components/employees/openEmployeeDocument';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  docId: string | null;
  fileName?: string | null;
  /** MIME type of the document, used to pick the right renderer. */
  mimeType?: string | null;
  title?: string;
  /** Header pill; pass null to hide (general documents). Default "Signed" for agreements. */
  badge?: string | null;
};

type PreviewKind = 'pdf' | 'image' | 'text' | 'other';

/** Decide how to render, from MIME type first then the filename extension. */
function resolvePreviewKind(
  mimeType?: string | null,
  fileName?: string | null,
): PreviewKind {
  const mt = (mimeType || '').toLowerCase();
  if (mt === 'application/pdf') return 'pdf';
  if (mt.startsWith('image/')) return 'image';
  if (mt.startsWith('text/')) return 'text';

  const ext = (fileName || '').toLowerCase().split('.').pop() || '';
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic'].includes(ext)) return 'image';
  if (['txt', 'csv', 'log', 'json', 'md'].includes(ext)) return 'text';
  return 'other';
}

export function EmployeePdfPreviewDialog({
  open,
  onOpenChange,
  employeeId,
  docId,
  fileName,
  mimeType,
  title = 'Signed Onboarding Agreement',
  badge = 'Signed',
}: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const kind = resolvePreviewKind(mimeType, fileName);

  useEffect(() => {
    if (!open || !docId) {
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
        const blob = await fetchEmployeeDocumentBlob(employeeId, docId, fileName);
        if (cancelled) return;
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setBlobUrl(url);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to open document');
        setBlobUrl(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, employeeId, docId, fileName]);

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
            <DialogTitle className="text-[15px] font-semibold tracking-tight">{title}</DialogTitle>
            {badge ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-900">
                {badge}
              </span>
            ) : null}
          </div>
          {fileName?.trim() ? (
            <p className="text-[12px] text-muted-foreground truncate">{fileName.trim()}</p>
          ) : (
            <p className="text-[12px] text-muted-foreground">Document preview</p>
          )}
        </DialogHeader>

        <div className="relative min-h-0 flex-1 bg-muted/30">
          {loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/70">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-[12px] text-muted-foreground">Loading document…</p>
            </div>
          )}
          {error && !loading && (
            <div className="flex h-full items-center justify-center p-6">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
          {blobUrl && !error && kind === 'pdf' && (
            <iframe
              title={title}
              src={`${blobUrl}#toolbar=1`}
              className="h-full w-full border-0"
            />
          )}
          {blobUrl && !error && kind === 'image' && (
            <div className="flex h-full w-full items-center justify-center overflow-auto p-4">
              <img
                src={blobUrl}
                alt={fileName?.trim() || title}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          )}
          {blobUrl && !error && kind === 'text' && (
            <iframe title={title} src={blobUrl} className="h-full w-full border-0 bg-white" />
          )}
          {blobUrl && !error && kind === 'other' && (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted">
                <FileText className="h-7 w-7 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Preview isn't available for this file type</p>
                <p className="text-[12px] text-muted-foreground">
                  {fileName?.trim() || 'Download or open it to view the contents.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => window.open(blobUrl, '_blank', 'noopener,noreferrer')}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open in new tab
                </Button>
                <a href={blobUrl} download={fileName?.trim() || 'document'}>
                  <Button size="sm" className="h-8 gap-1.5 text-xs">
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </Button>
                </a>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
