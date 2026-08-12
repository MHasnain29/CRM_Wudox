import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MessageVideoAttachmentProps {
  src: string;
  name: string;
  onClick: () => void;
  className?: string;
}

export function MessageVideoAttachment({
  src,
  name,
  onClick,
  className,
}: MessageVideoAttachmentProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative block overflow-hidden rounded-lg cursor-pointer',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className
      )}
      aria-label={`Play ${name}`}
    >
      <video
        src={src}
        muted
        playsInline
        preload="metadata"
        className="block max-w-full max-h-52 w-auto min-w-[160px] rounded-lg object-cover bg-black pointer-events-none"
      />
      <div
        className={cn(
          'absolute inset-0 flex items-center justify-center rounded-lg',
          'bg-black/30 transition-colors duration-200 group-hover:bg-black/45'
        )}
      >
        <span
          className={cn(
            'flex h-12 w-12 items-center justify-center rounded-full',
            'bg-background/95 text-foreground shadow-lg',
            'transition-transform duration-200 group-hover:scale-105'
          )}
        >
          <Play className="h-6 w-6 fill-current ml-0.5" strokeWidth={0} />
        </span>
      </div>
    </button>
  );
}
