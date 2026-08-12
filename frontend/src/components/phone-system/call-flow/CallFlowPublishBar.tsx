import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, Loader2, Radio, Save } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CallFlowLiveStatus = 'never' | 'pending' | 'live';

interface CallFlowPublishBarProps {
  status: CallFlowLiveStatus;
  saving?: boolean;
  savingLabel?: string;
  onPublish: () => void | Promise<void>;
  onSaveDraft: () => void | Promise<void>;
}

const STATUS_COPY: Record<
  CallFlowLiveStatus,
  { title: string; detail: string; dot: string }
> = {
  never: {
    title: 'Not live yet',
    detail: 'Publish when ready — inbound callers will hear this flow.',
    dot: 'bg-muted-foreground/50',
  },
  pending: {
    title: 'Changes not live',
    detail: 'You have edits that callers will not hear until you publish.',
    dot: 'bg-amber-500',
  },
  live: {
    title: 'Live for inbound calls',
    detail: 'This flow matches what callers hear right now.',
    dot: 'bg-emerald-500',
  },
};

export function CallFlowPublishBar({
  status,
  saving = false,
  savingLabel = 'Publishing…',
  onPublish,
  onSaveDraft,
}: CallFlowPublishBarProps) {
  const copy = STATUS_COPY[status];

  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border px-3 py-2.5',
        status === 'pending'
          ? 'border-amber-400/50 bg-amber-50/80 dark:bg-amber-950/30'
          : 'bg-muted/30',
      )}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <span
          className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', copy.dot)}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-sm font-medium leading-tight">{copy.title}</p>
          <p className="text-xs text-muted-foreground leading-snug mt-0.5">{copy.detail}</p>
        </div>
      </div>

      <div className="flex items-center gap-0 shrink-0 self-end sm:self-center">
        <Button
          size="sm"
          disabled={saving}
          className="rounded-r-none pr-3"
          onClick={() => void onPublish()}
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Radio className="h-3.5 w-3.5 mr-1.5" />
          )}
          {saving ? savingLabel : 'Publish'}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              disabled={saving}
              className="rounded-l-none border-l border-primary-foreground/20 px-2"
              aria-label="More publish options"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => void onSaveDraft()}>
              <Save className="h-3.5 w-3.5 mr-2" />
              Save draft only
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
