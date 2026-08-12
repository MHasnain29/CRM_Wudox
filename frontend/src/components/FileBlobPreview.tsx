import { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface FileBlobPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName?: string;
  loadBlob: (() => Promise<Blob>) | null;
  fallbackUrl?: string | null;
}

export function FileBlobPreview({
  open,
  onOpenChange,
  fileName,
  loadBlob,
  fallbackUrl,
}: FileBlobPreviewProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const clearBlobUrl = () => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setBlobUrl(null);
  };

  useEffect(() => {
    if (!open || !loadBlob) {
      clearBlobUrl();
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    clearBlobUrl();

    loadBlob()
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setBlobUrl(url);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load preview.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [open, loadBlob]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  const downloadUrl = blobUrl ?? fallbackUrl ?? undefined;
  const openInTabUrl = fallbackUrl ?? blobUrl ?? undefined;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-black/95"
      role="dialog"
      aria-modal="true"
      aria-label={fileName ?? 'PDF preview'}
      onClick={() => onOpenChange(false)}
    >
      <div className="flex items-center justify-between gap-2 p-3 shrink-0">
        <p className="text-sm text-white/80 truncate min-w-0 px-1">{fileName ?? 'PDF'}</p>
        <div className="flex items-center gap-1 shrink-0">
          {openInTabUrl && (
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/10 hover:text-white"
              asChild
            >
              <a
                href={openInTabUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-5 w-5" />
                <span className="sr-only">Open in new tab</span>
              </a>
            </Button>
          )}
          {downloadUrl && (
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/10 hover:text-white"
              asChild
            >
              <a
                href={downloadUrl}
                download={fileName}
                onClick={(e) => e.stopPropagation()}
              >
                <Download className="h-5 w-5" />
                <span className="sr-only">Download</span>
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10 hover:text-white"
            onClick={(e) => {
              e.stopPropagation();
              onOpenChange(false);
            }}
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 p-4" onClick={(e) => e.stopPropagation()}>
        {loading && (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-white/70" />
          </div>
        )}
        {!loading && error && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center px-4">
            <p className="text-sm text-white/80">{error}</p>
            {openInTabUrl && (
              <Button variant="secondary" size="sm" asChild>
                <a href={openInTabUrl} target="_blank" rel="noopener noreferrer">
                  Open in new tab
                </a>
              </Button>
            )}
          </div>
        )}
        {!loading && !error && blobUrl && (
          <iframe
            src={blobUrl}
            title={fileName ?? 'PDF preview'}
            className="h-full w-full rounded-lg border-0 bg-white"
          />
        )}
      </div>
    </div>
  );
}
