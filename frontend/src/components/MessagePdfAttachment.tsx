import { Expand, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MessagePdfAttachmentProps {
  name: string;
  fileSizeLabel?: string;
  onClick: () => void;
  className?: string;
  inverted?: boolean;
}

export function MessagePdfAttachment({
  name,
  fileSizeLabel,
  onClick,
  className,
  inverted = false,
}: MessagePdfAttachmentProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex w-full min-w-[200px] max-w-[280px] items-center gap-3 rounded-lg p-3 text-left cursor-pointer',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        inverted
          ? 'border border-primary-foreground/20 bg-primary-foreground/10 hover:bg-primary-foreground/15'
          : 'border border-border bg-background hover:bg-muted/50',
        className
      )}
      aria-label={`Preview ${name}`}
    >
      <div
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-md',
          inverted ? 'bg-primary-foreground/15' : 'bg-red-500/10'
        )}
      >
        <FileText className={cn('h-5 w-5', inverted ? 'text-primary-foreground' : 'text-red-500')} />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-sm font-medium truncate',
            inverted ? 'text-primary-foreground' : 'text-foreground'
          )}
        >
          {name}
        </p>
        <p
          className={cn(
            'text-xs',
            inverted ? 'text-primary-foreground/70' : 'text-muted-foreground'
          )}
        >
          {[fileSizeLabel, 'PDF'].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div
        className={cn(
          'absolute inset-0 flex items-center justify-center rounded-lg',
          'bg-black/0 transition-colors duration-200 group-hover:bg-black/30'
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
