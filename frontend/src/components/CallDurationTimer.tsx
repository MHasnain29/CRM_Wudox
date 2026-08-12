import { useEffect } from 'react';
import { useCallStore } from '@/lib/callStore';

/**
 * Global invisible component that keeps the call duration ticking.
 * Mounted in App.tsx so it NEVER unmounts — even when PhoneDialer is minimized.
 * Uses startTime-based calculation for accuracy (tab switch / browser sleep proof).
 */
export function CallDurationTimer() {
  const status = useCallStore((s) => s.activeCall?.status);
  const updateDuration = useCallStore((s) => s.updateDuration);
  const activeInboundCall = useCallStore((s) => s.activeInboundCall);
  const updateInboundDuration = useCallStore((s) => s.updateInboundDuration);

  useEffect(() => {
    if (!status || status === 'ended' || status === 'connecting') return;

    const interval = setInterval(() => {
      updateDuration();
    }, 1000);

    return () => clearInterval(interval);
  }, [status, updateDuration]);

  useEffect(() => {
    if (!activeInboundCall) return;

    const interval = setInterval(() => {
      updateInboundDuration();
    }, 1000);

    return () => clearInterval(interval);
  }, [activeInboundCall, updateInboundDuration]);

  return null;
}
