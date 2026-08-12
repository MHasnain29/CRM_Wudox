import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Download,
  Eye,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Paperclip,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  formatFileSize,
  isImageFile,
  isPdfFile,
  isPreviewableFile,
  isVideoFile,
} from '@/lib/fileAttachmentUtils';
import { MessageImagePreview } from '@/components/MessageImagePreview';
import { MessageVideoPreview } from '@/components/MessageVideoPreview';
import { MessageImageAttachment } from '@/components/MessageImageAttachment';
import { MessageVideoAttachment } from '@/components/MessageVideoAttachment';
import { MessagePdfAttachment } from '@/components/MessagePdfAttachment';
import { FileBlobPreview } from '@/components/FileBlobPreview';

export type CrmAttachment = {
  id: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
};

export type CrmAttachmentListProps = {
  items: CrmAttachment[];
  fetchBlob: (item: CrmAttachment) => Promise<Blob>;
  onDownload: (item: CrmAttachment) => Promise<void>;
  /** Direct authenticated URL when available (messages). */
  getStreamUrl?: (item: CrmAttachment) => string | null;
  variant?: 'row' | 'media';
  inverted?: boolean;
  className?: string;
  showHeader?: boolean;
  headerLabel?: string;
  extraActions?: (item: CrmAttachment) => ReactNode;
};

function RowThumbnail({
  item,
  streamUrl,
  fetchBlob,
  onPreview,
}: {
  item: CrmAttachment;
  streamUrl: string | null;
  fetchBlob: (item: CrmAttachment) => Promise<Blob>;
  onPreview: () => void;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(streamUrl);
  const [loading, setLoading] = useState(!streamUrl);
  const thumbRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isImageFile(item.mimeType, item.name)) return;
    if (streamUrl) {
      setThumbUrl(streamUrl);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchBlob(item)
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        thumbRef.current = url;
        setThumbUrl(url);
      })
      .catch(() => {
        if (!cancelled) setThumbUrl(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (thumbRef.current) {
        URL.revokeObjectURL(thumbRef.current);
        thumbRef.current = null;
      }
    };
  }, [item, streamUrl, fetchBlob]);

  if (loading) {
    return (
      <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center shrink-0">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (thumbUrl) {
    return (
      <button
        type="button"
        onClick={onPreview}
        className="h-10 w-10 rounded-md overflow-hidden shrink-0 ring-1 ring-border hover:ring-primary/50 transition-shadow"
        aria-label={`Preview ${item.name}`}
      >
        <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
      </button>
    );
  }

  return <ImageIcon className="h-4 w-4 text-blue-500 shrink-0" />;
}

export function CrmAttachmentList({
  items,
  fetchBlob,
  onDownload,
  getStreamUrl,
  variant = 'row',
  inverted = false,
  className,
  showHeader = false,
  headerLabel,
  extraActions,
}: CrmAttachmentListProps) {
  const [downloading, setDownloading] = useState<Set<string>>(new Set());
  const [imagePreview, setImagePreview] = useState<{ url: string; name: string } | null>(null);
  const [videoPreview, setVideoPreview] = useState<{ url: string; name: string } | null>(null);
  const [pdfPreview, setPdfPreview] = useState<CrmAttachment | null>(null);
  const imageBlobRef = useRef<string | null>(null);

  const resolveStreamUrl = useCallback(
    (item: CrmAttachment) => getStreamUrl?.(item) ?? null,
    [getStreamUrl],
  );

  const resolveMediaUrl = useCallback(
    async (item: CrmAttachment): Promise<string> => {
      const direct = resolveStreamUrl(item);
      if (direct) return direct;
      const blob = await fetchBlob(item);
      return URL.createObjectURL(blob);
    },
    [fetchBlob, resolveStreamUrl],
  );

  const handleDownload = async (item: CrmAttachment) => {
    setDownloading((prev) => new Set(prev).add(item.id));
    try {
      await onDownload(item);
    } catch {
      toast.error(`Failed to download "${item.name}"`);
    } finally {
      setDownloading((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const openImagePreview = async (item: CrmAttachment) => {
    try {
      const url = await resolveMediaUrl(item);
      if (imageBlobRef.current && !resolveStreamUrl(item)) {
        URL.revokeObjectURL(imageBlobRef.current);
      }
      if (!resolveStreamUrl(item)) imageBlobRef.current = url;
      setImagePreview({ url, name: item.name });
    } catch {
      toast.error(`Could not preview "${item.name}"`);
    }
  };

  const openVideoPreview = async (item: CrmAttachment) => {
    try {
      const url = await resolveMediaUrl(item);
      setVideoPreview({ url, name: item.name });
    } catch {
      toast.error(`Could not preview "${item.name}"`);
    }
  };

  const closeImagePreview = (open: boolean) => {
    if (!open) {
      if (imageBlobRef.current) {
        URL.revokeObjectURL(imageBlobRef.current);
        imageBlobRef.current = null;
      }
      setImagePreview(null);
    }
  };

  const handlePreview = (item: CrmAttachment) => {
    if (isImageFile(item.mimeType, item.name)) {
      void openImagePreview(item);
      return;
    }
    if (isVideoFile(item.mimeType, item.name)) {
      void openVideoPreview(item);
      return;
    }
    if (isPdfFile(item.mimeType, item.name)) {
      setPdfPreview(item);
    }
  };

  if (items.length === 0) return null;

  const actionButtons = (item: CrmAttachment, compact = false) => {
    const busy = downloading.has(item.id);
    const previewable = isPreviewableFile(item.mimeType, item.name);
    const btnClass = compact
      ? 'p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-background/80 transition-colors disabled:opacity-50'
      : 'p-1.5 rounded-md opacity-80 hover:opacity-100 transition-opacity disabled:opacity-50';

    return (
      <div className="flex items-center gap-0.5 shrink-0">
        {previewable && (
          <button
            type="button"
            onClick={() => handlePreview(item)}
            className={btnClass}
            title="Preview"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleDownload(item)}
          className={btnClass}
          title="Download"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        </button>
        {extraActions?.(item)}
      </div>
    );
  };

  return (
    <>
      <div className={className}>
        {showHeader && (
          <p className="text-xs font-medium text-muted-foreground mb-2.5 flex items-center gap-1.5">
            <Paperclip className="h-3.5 w-3.5" />
            {headerLabel ?? `${items.length} attachment${items.length !== 1 ? 's' : ''}`}
          </p>
        )}

        {variant === 'media' ? (
          <div className="space-y-2">
            {items.map((item) => {
              const streamUrl = resolveStreamUrl(item);
              const sizeLabel = item.size != null ? formatFileSize(item.size) : undefined;

              if (isImageFile(item.mimeType, item.name)) {
                return (
                  <div key={item.id} className="space-y-1.5">
                    <MessageImageAttachment
                      src={streamUrl ?? ''}
                      alt={item.name}
                      onClick={() => void openImagePreview(item)}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs truncate opacity-80">{item.name}</p>
                      {actionButtons(item, true)}
                    </div>
                  </div>
                );
              }

              if (isVideoFile(item.mimeType, item.name)) {
                return (
                  <div key={item.id} className="space-y-1.5">
                    <MessageVideoAttachment
                      src={streamUrl ?? ''}
                      name={item.name}
                      onClick={() => void openVideoPreview(item)}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs truncate opacity-80">{item.name}</p>
                      {actionButtons(item, true)}
                    </div>
                  </div>
                );
              }

              if (isPdfFile(item.mimeType, item.name)) {
                return (
                  <div key={item.id} className="space-y-1.5">
                    <MessagePdfAttachment
                      name={item.name}
                      fileSizeLabel={sizeLabel}
                      inverted={inverted}
                      onClick={() => setPdfPreview(item)}
                    />
                    <div className="flex justify-end">{actionButtons(item, true)}</div>
                  </div>
                );
              }

              return (
                <div
                  key={item.id}
                  className={cn(
                    'flex items-center gap-2 p-2 rounded border',
                    inverted
                      ? 'border-primary-foreground/20 bg-primary-foreground/10'
                      : 'border-border bg-background',
                  )}
                >
                  <FileText className="h-4 w-4 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{item.name}</p>
                    {sizeLabel && <p className="text-xs opacity-70">{sizeLabel}</p>}
                  </div>
                  {actionButtons(item, true)}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {items.map((item) => {
              const isImage = isImageFile(item.mimeType, item.name);
              const isPdf = isPdfFile(item.mimeType, item.name);
              const isVideo = isVideoFile(item.mimeType, item.name);
              const streamUrl = resolveStreamUrl(item);

              return (
                <div
                  key={item.id}
                  className={cn(
                    'flex items-center gap-2.5 px-2.5 py-2 rounded-lg border bg-muted/30 text-sm min-w-0 max-w-full',
                    isPreviewableFile(item.mimeType, item.name) && 'hover:bg-muted/60 transition-colors',
                  )}
                >
                  {isImage ? (
                    <RowThumbnail
                      item={item}
                      streamUrl={streamUrl}
                      fetchBlob={fetchBlob}
                      onPreview={() => handlePreview(item)}
                    />
                  ) : isVideo ? (
                    <Film className="h-4 w-4 shrink-0 text-violet-500" />
                  ) : (
                    <FileText className={cn('h-4 w-4 shrink-0', isPdf ? 'text-red-500' : 'text-blue-500')} />
                  )}

                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate max-w-[180px] sm:max-w-[240px]" title={item.name}>
                      {item.name}
                    </p>
                    {item.size != null && (
                      <p className="text-xs text-muted-foreground">{formatFileSize(item.size)}</p>
                    )}
                  </div>

                  {actionButtons(item)}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <MessageImagePreview
        open={Boolean(imagePreview)}
        onOpenChange={closeImagePreview}
        imageUrl={imagePreview?.url ?? null}
        imageName={imagePreview?.name}
      />

      <MessageVideoPreview
        open={Boolean(videoPreview)}
        onOpenChange={(open) => {
          if (!open) setVideoPreview(null);
        }}
        videoUrl={videoPreview?.url ?? null}
        videoName={videoPreview?.name}
      />

      <FileBlobPreview
        open={Boolean(pdfPreview)}
        onOpenChange={(open) => {
          if (!open) setPdfPreview(null);
        }}
        fileName={pdfPreview?.name}
        loadBlob={
          pdfPreview
            ? () => fetchBlob(pdfPreview)
            : null
        }
        fallbackUrl={pdfPreview ? resolveStreamUrl(pdfPreview) : null}
      />
    </>
  );
}
