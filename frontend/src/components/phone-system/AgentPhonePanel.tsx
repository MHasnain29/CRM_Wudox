import { useCallback, useEffect, useRef, useState } from 'react';
import { Users, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStore } from '@/lib/store';
import { useCallStore } from '@/lib/callStore';
import { getSocket } from '@/lib/socket';
import { getLiveQueue } from '@/lib/api';
import { resolveAgencyIdForApi } from '@/lib/resolveAgencyId';
import { useAgentPhoneDockLayout } from '@/lib/floatingActionDock';
import { WaitingCallersStack } from './WaitingCallersStack';

/** Queue / waiting callers only — availability lives in the sidebar beside the version. */
export function AgentPhonePanel() {
  const subCompanies = useStore((s) => s.subCompanies);
  const currentSubCompanyId = useStore((s) => s.currentSubCompany?.id);
  const viewedSubCompanyId = useStore((s) => s.viewedSubCompanyId);
  const subCompanyId = resolveAgencyIdForApi(subCompanies, {
    currentId: currentSubCompanyId,
    viewedId: viewedSubCompanyId,
  });
  const activeInboundCall = useCallStore((s) => s.activeInboundCall);
  const heldInboundCall = useCallStore((s) => s.heldInboundCall);
  const pendingInboundCall = useCallStore((s) => s.pendingInboundCall);
  const onCall = Boolean(activeInboundCall || heldInboundCall || pendingInboundCall);
  const { agent } = useAgentPhoneDockLayout();
  const [open, setOpen] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const mounted = useRef(true);

  const refreshQueueCount = useCallback(() => {
    getLiveQueue(subCompanyId)
      .then((rows) => {
        if (mounted.current) setQueueCount(rows.length);
      })
      .catch(() => undefined);
  }, [subCompanyId]);

  useEffect(() => {
    mounted.current = true;
    refreshQueueCount();
    const pollMs = onCall ? 3000 : 10000;
    const poll = setInterval(refreshQueueCount, pollMs);
    const socket = getSocket();
    const onQueue = () => refreshQueueCount();
    socket.on('queue:refresh', onQueue);
    return () => {
      mounted.current = false;
      clearInterval(poll);
      socket.off('queue:refresh', onQueue);
    };
  }, [refreshQueueCount, onCall]);

  const hasWaiting = queueCount > 0 || Boolean(pendingInboundCall);
  useEffect(() => {
    if (!hasWaiting) setOpen(false);
  }, [hasWaiting]);

  if (!hasWaiting) return null;

  return (
    <div
      className={cn('fixed z-[240] w-72', agent.left)}
      style={{ bottom: agent.bottomPx }}
    >
      <div className="relative">
        {open && (
          <div className="absolute bottom-full left-0 right-0 bg-card border border-b-0 border-border rounded-t-xl shadow-2xl p-3 max-h-[min(60vh,420px)] overflow-y-auto">
            <WaitingCallersStack />
          </div>
        )}

        <div
          className={cn(
            'bg-card border border-border shadow-2xl',
            open ? 'rounded-b-xl' : 'rounded-xl',
          )}
        >
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted/50 transition-colors rounded-[inherit]"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium truncate">Waiting callers</span>
              <span className="inline-flex items-center rounded-full bg-red-500 text-white text-[10px] px-1.5 py-0.5 shrink-0">
                {queueCount > 0 ? queueCount : 1}
              </span>
            </div>
            {open ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
