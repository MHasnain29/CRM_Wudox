import { Expand } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MessageImageAttachmentProps {
  src: string;
  alt: string;
  onClick: () => void;
  className?: string;
}

export function MessageImageAttachment({
  src,
  alt,
  onClick,
  className,
}: MessageImageAttachmentProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative block overflow-hidden rounded-lg cursor-pointer',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className
      )}
      aria-label={`Preview ${alt}`}
    >
      <img
        src={src}
        alt={alt}
        className="block max-w-full max-h-52 w-auto rounded-lg object-cover"
        draggable={false}
      />
      <div
        className={cn(
          'absolute inset-0 flex items-center justify-center rounded-lg',
          'bg-black/0 transition-colors duration-200 group-hover:bg-black/40'
        )}
      >
        <span
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full',
            'bg-background/95 text-foreground shadow-lg',
            'opacity-0 scale-75 transition-all duration-200',
            'group-hover:opacity-100 group-hover:scale-100'
          )}
        >
          <Expand className="h-5 w-5" strokeWidth={2} />
        </span>
      </div>
    </button>
  );
}
