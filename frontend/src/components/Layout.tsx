import { Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { useIdleDetection } from '@/hooks/useIdleDetection';
import { useStore } from '@/lib/store';
import { documentTitleFromBranding } from '@/lib/branding';
import { useIsOwnScope } from '@/lib/access';
import { Timer, MousePointerClick, PauseCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useActAs } from '@/hooks/useActAs';
import { actAsHeader } from '@/lib/actAsHeader';

function formatIdleTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

export function Layout() {
  const isOnBreak = useStore((s) => s.isOnBreak);
  const currentSubCompany = useStore((s) => s.currentSubCompany);
  const isAssociateScope = useIsOwnScope();

  const { isIdle, idleSeconds, isTrackingPaused, handleImBack } = useIdleDetection(isOnBreak);
  const actAs = useActAs();

  useEffect(() => {
    document.title = documentTitleFromBranding(currentSubCompany);
  }, [currentSubCompany]);

  // Sync during render (before child effects) so team-members fetches never race the header.
  const nextActAsId = actAs.userId;
  if (actAsHeader.get() !== nextActAsId) {
    actAsHeader.set(nextActAsId);
  }

  return (
    <div className="flex h-screen w-full bg-white overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden bg-white">
        <TopBar />
        <main className="flex-1 px-6 pb-6 pt-0 overflow-y-auto overflow-x-clip bg-white">
          <Outlet />
        </main>
      </div>

      {/* Idle overlay — only dismissable via "I'm Back" + backend confirmation.
          When shift ends while idle, timer freezes and modal persists until user confirms. */}
      {isIdle && !isOnBreak && isAssociateScope && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center space-y-6">
            <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center">
              {isTrackingPaused
                ? <PauseCircle className="h-8 w-8 text-amber-500" />
                : <Timer className="h-8 w-8 text-amber-500 animate-pulse" />
              }
            </div>

            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {isTrackingPaused ? 'Shift Ended' : "You're Inactive"}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {isTrackingPaused
                  ? 'Your shift has ended. Timer is paused.'
                  : 'Your idle time is being tracked'}
              </p>
            </div>

            <div className={
              isTrackingPaused
                ? 'py-4 px-6 rounded-xl bg-red-500/10 border border-red-500/20'
                : 'py-4 px-6 rounded-xl bg-amber-500/10 border border-amber-500/20'
            }>
              <p className={
                isTrackingPaused
                  ? 'text-xs text-red-600 font-medium uppercase tracking-wider mb-1'
                  : 'text-xs text-amber-600 font-medium uppercase tracking-wider mb-1'
              }>Idle Time</p>
              <p className={
                isTrackingPaused
                  ? 'text-4xl font-mono font-bold text-red-600'
                  : 'text-4xl font-mono font-bold text-amber-600'
              }>
                {formatIdleTime(idleSeconds)}
              </p>
              {isTrackingPaused && (
                <p className="text-xs text-red-600 mt-2 font-medium">Timer is frozen — working hours are over</p>
              )}
            </div>

            <Button
              onClick={() => void handleImBack()}
              size="lg"
              className="w-full gap-2 bg-primary hover:bg-primary/90"
            >
              <MousePointerClick className="h-4 w-4" />
              I&apos;m Back
            </Button>

            <p className="text-[11px] text-muted-foreground">
              {isTrackingPaused
                ? 'Working hours have ended — timer will resume at next start time'
                : 'This time will be recorded in your activity report'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
