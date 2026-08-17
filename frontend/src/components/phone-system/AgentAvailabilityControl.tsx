import { useCallback, useEffect, useRef, useState } from 'react';
import { Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getMyPresence, setMyPresence, type AgentPresenceStatus } from '@/lib/api';
import { toast } from 'sonner';
import { useHasPermission } from '@/lib/access';

const STATUS_META: Record<AgentPresenceStatus, { label: string; color: string }> = {
  available: { label: 'Available', color: 'text-green-500' },
  busy: { label: 'Busy', color: 'text-red-500' },
  away: { label: 'Away', color: 'text-amber-500' },
  offline: { label: 'Offline', color: 'text-slate-400' },
};

const AUTO = '__auto__';

type Props = {
  /** Compact row for sidebar footer (beside version). */
  compact?: boolean;
  className?: string;
};

export function AgentAvailabilityControl({ compact = false, className }: Props) {
  const hasVoice = useHasPermission('voice:use');
  const [manualStatus, setManualStatus] = useState<AgentPresenceStatus | null>(null);
  const [effective, setEffective] = useState<AgentPresenceStatus>('available');
  const mounted = useRef(true);

  const refreshPresence = useCallback(() => {
    if (!hasVoice) return;
    getMyPresence()
      .then((p) => {
        if (!mounted.current) return;
        setManualStatus(p.manualStatus);
        setEffective(p.effective);
      })
      .catch(() => undefined);
  }, [hasVoice]);

  useEffect(() => {
    mounted.current = true;
    refreshPresence();
    return () => {
      mounted.current = false;
    };
  }, [refreshPresence]);

  if (!hasVoice) return null;

  const handleStatusChange = async (value: string) => {
    const next = value === AUTO ? null : (value as AgentPresenceStatus);
    setManualStatus(next);
    try {
      const res = await setMyPresence(next);
      setManualStatus(res.manualStatus);
      setEffective(res.effective);
    } catch {
      toast.error('Failed to update availability');
      refreshPresence();
    }
  };

  const dotColor = STATUS_META[effective].color;

  if (compact) {
    return (
      <div className={cn('flex items-center gap-1.5 min-w-0 flex-1', className)}>
        <Circle className={cn('h-2.5 w-2.5 fill-current shrink-0', dotColor)} aria-hidden />
        <Select value={manualStatus ?? AUTO} onValueChange={handleStatusChange}>
          <SelectTrigger
            className="h-7 min-w-0 flex-1 border-sidebar-border bg-sidebar-accent/40 px-2 text-xs text-sidebar-foreground shadow-none [&>span]:line-clamp-none [&>span]:truncate"
            aria-label="My availability"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72 z-[300]" position="popper" side="top" align="start">
            <SelectItem value={AUTO}>Auto</SelectItem>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="busy">Busy</SelectItem>
            <SelectItem value="away">Away</SelectItem>
            <SelectItem value="offline">Offline</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <label className="text-xs font-medium text-muted-foreground">My availability</label>
      <Select value={manualStatus ?? AUTO} onValueChange={handleStatusChange}>
        <SelectTrigger className="h-8 [&>span]:line-clamp-none [&>span]:truncate">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72" position="popper" side="top">
          <SelectItem value={AUTO}>Auto</SelectItem>
          <SelectItem value="available">Available</SelectItem>
          <SelectItem value="busy">Busy</SelectItem>
          <SelectItem value="away">Away</SelectItem>
          <SelectItem value="offline">Offline</SelectItem>
        </SelectContent>
      </Select>
      {manualStatus == null && (
        <p className="text-[11px] text-muted-foreground leading-snug">
          Busy automatically while on a call.
        </p>
      )}
    </div>
  );
}

export { STATUS_META };
