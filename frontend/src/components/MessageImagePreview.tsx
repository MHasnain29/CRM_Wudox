import { useEffect } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface MessageImagePreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string | null;
  imageName?: string;
}

export function MessageImagePreview({
  open,
  onOpenChange,
  imageUrl,
  imageName,
}: MessageImagePreviewProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  if (!open || !imageUrl) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-black/95"
      role="dialog"
      aria-modal="true"
      aria-label={imageName ?? 'Image preview'}
      onClick={() => onOpenChange(false)}
    >
      <div className="flex items-center justify-between gap-2 p-3 shrink-0">
        <p className="text-sm text-white/80 truncate min-w-0 px-1">
          {imageName ?? 'Image'}
        </p>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10 hover:text-white"
            asChild
          >
            <a
              href={imageUrl}
              download={imageName}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <Download className="h-5 w-5" />
              <span className="sr-only">Download</span>
            </a>
          </Button>
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

      <div className="flex flex-1 items-center justify-center min-h-0 p-4">
        <img
          src={imageUrl}
          alt={imageName ?? 'Image preview'}
          className="max-h-full max-w-full object-contain select-none"
          draggable={false}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}
