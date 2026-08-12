import { useEffect, useRef } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface MessageVideoPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoUrl: string | null;
  videoName?: string;
}

export function MessageVideoPreview({
  open,
  onOpenChange,
  videoUrl,
  videoName,
}: MessageVideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!open) {
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.currentTime = 0;
      }
      return;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKeyDown);

    const video = videoRef.current;
    if (video) {
      void video.play().catch(() => {
        // Autoplay may be blocked until user interacts; controls still work.
      });
    }

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  if (!open || !videoUrl) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-black/95"
      role="dialog"
      aria-modal="true"
      aria-label={videoName ?? 'Video preview'}
      onClick={() => onOpenChange(false)}
    >
      <div className="flex items-center justify-between gap-2 p-3 shrink-0">
        <p className="text-sm text-white/80 truncate min-w-0 px-1">
          {videoName ?? 'Video'}
        </p>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10 hover:text-white"
            asChild
          >
            <a
              href={videoUrl}
              download={videoName}
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
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          playsInline
          className="max-h-full max-w-full rounded-lg bg-black outline-none"
          onClick={(e) => e.stopPropagation()}
        >
          Your browser does not support video playback.
        </video>
      </div>
    </div>
  );
}
