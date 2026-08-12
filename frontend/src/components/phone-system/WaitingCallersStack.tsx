import { useCallback, useEffect, useRef, useState } from 'react';
import { PhoneForwarded, PhoneIncoming, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCallStore } from '@/lib/callStore';
import { useStore } from '@/lib/store';
import { getSocket } from '@/lib/socket';
import {
  cancelQueueEntry,
  getLiveQueue,
  getMyPresence,
  pickupQueueEntry,
  type QueueEntry,
} from '@/lib/api';
import { resolveAgencyIdForApi } from '@/lib/resolveAgencyId';
import { toast } from 'sonner';

function waitLabel(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface WaitingCallersStackProps {
  /** Tighter layout when embedded in the active-call widget. */
  compact?: boolean;
}

export function WaitingCallersStack({ compact = false }: WaitingCallersStackProps) {
  const subCompanies = useStore((s) => s.subCompanies);
  const currentSubCompanyId = useStore((s) => s.currentSubCompany?.id);
  const viewedSubCompanyId = useStore((s) => s.viewedSubCompanyId);
  const subCompanyId = resolveAgencyIdForApi(subCompanies, {
    currentId: currentSubCompanyId,
    viewedId: viewedSubCompanyId,
  });

  const pendingInboundCall = useCallStore((s) => s.pendingInboundCall);
  const activeInboundCall = useCallStore((s) => s.activeInboundCall);
  const heldInboundCall = useCallStore((s) => s.heldInboundCall);
  const swapInProgress = useCallStore((s) => s.swapInProgress);
  const answerSecondCall = useCallStore((s) => s.answerSecondCall);
  const rejectInboundCall = useCallStore((s) => s.rejectInboundCall);

  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [pickupId, setPickupId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [canPickupFromQueue, setCanPickupFromQueue] = useState(true);
  const [, forceTick] = useState(0);
  const mounted = useRef(true);

  const onCall = Boolean(activeInboundCall || heldInboundCall || pendingInboundCall);
  const pickupBlocked =
    Boolean(heldInboundCall) || Boolean(pendingInboundCall) || !canPickupFromQueue;

  const refreshQueue = useCallback(() => {
    getLiveQueue(subCompanyId)
      .then((rows) => {
        if (mounted.current) setQueue(rows);
      })
      .catch(() => undefined);
  }, [subCompanyId]);

  const refreshCapacity = useCallback(() => {
    getMyPresence()
      .then((p) => {
        if (mounted.current) setCanPickupFromQueue(p.canPickupFromQueue ?? true);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    mounted.current = true;
    refreshQueue();
    refreshCapacity();
    // Poll faster while on a call so busy→queue pickups appear quickly.
    const pollMs = onCall ? 3000 : 10000;
    const poll = setInterval(refreshQueue, pollMs);
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    const socket = getSocket();
    const onQueue = () => refreshQueue();
    socket.on('queue:refresh', onQueue);
    return () => {
      mounted.current = false;
      clearInterval(poll);
      clearInterval(tick);
      socket.off('queue:refresh', onQueue);
    };
  }, [refreshQueue, refreshCapacity, onCall]);

  useEffect(() => {
    refreshCapacity();
  }, [activeInboundCall, heldInboundCall, pendingInboundCall, refreshCapacity]);

  const handlePickup = async (entry: QueueEntry) => {
    setPickupId(entry.id);
    try {
      await pickupQueueEntry(entry.id);
      toast.success('Connecting caller…');
      refreshQueue();
      refreshCapacity();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to pick up caller';
      if (msg.toLowerCase().includes('max capacity')) {
        toast.error('At max calls — finish or swap first');
      } else {
        toast.error(msg);
      }
      refreshQueue();
      refreshCapacity();
    } finally {
      setPickupId(null);
    }
  };

  const handleCancel = async (entry: QueueEntry) => {
    setCancelId(entry.id);
    try {
      await cancelQueueEntry(entry.id);
      refreshQueue();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove caller');
      refreshQueue();
    } finally {
      setCancelId(null);
    }
  };

  const showCallWaiting = Boolean(pendingInboundCall && activeInboundCall);
  if (!showCallWaiting && queue.length === 0) {
    if (compact) return null;
    return (
      <p className="text-xs text-muted-foreground py-2 text-center">
        {activeInboundCall
          ? 'No parked callers — waiting rings appear as Call waiting'
          : 'No callers waiting.'}
      </p>
    );
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {showCallWaiting && pendingInboundCall && (
        <div className="rounded-lg border border-blue-500/40 bg-blue-50 dark:bg-blue-950/30 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-blue-800 dark:text-blue-200 flex items-center gap-1">
                <PhoneIncoming className="h-3.5 w-3.5 shrink-0" />
                Call waiting
              </p>
              <p className="text-sm truncate">
                {pendingInboundCall.callerName || pendingInboundCall.fromNumber}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="sm"
                className="h-7"
                disabled={swapInProgress}
                onClick={() => void answerSecondCall()}
              >
                {swapInProgress ? 'Connecting…' : 'Answer'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                disabled={swapInProgress}
                onClick={rejectInboundCall}
              >
                Decline
              </Button>
            </div>
          </div>
        </div>
      )}

      {queue.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">In queue</p>
            <span className="text-[10px] text-muted-foreground">{queue.length} waiting</span>
          </div>
          <ul className="space-y-1.5 max-h-40 overflow-y-auto">
            {queue.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border px-2 py-1.5"
              >
                <div className="min-w-0">
                  <p className="text-sm truncate">{e.callerName || e.callerNumber}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {e.ringGroupName ? `${e.ringGroupName} · ` : ''}
                    {e.status === 'connecting'
                      ? 'ringing you'
                      : `waiting ${waitLabel(e.enqueuedAt)}`}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    className="h-7"
                    disabled={pickupBlocked || pickupId === e.id || cancelId === e.id}
                    title={
                      pickupBlocked
                        ? heldInboundCall || pendingInboundCall
                          ? 'End or swap a call first'
                          : 'At max capacity'
                        : undefined
                    }
                    onClick={() => void handlePickup(e)}
                  >
                    <PhoneForwarded className="h-3.5 w-3.5 mr-1" />
                    Pick up
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    disabled={pickupId === e.id || cancelId === e.id}
                    onClick={() => void handleCancel(e)}
                    title="Remove from queue"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
