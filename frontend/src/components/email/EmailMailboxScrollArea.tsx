import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface EmailMailboxScrollAreaProps {
  children: ReactNode;
  className?: string;
  viewKey: string;
  loadedCount: number;
  totalCount: number;
  hasNextPage: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  nextPageError: Error | null;
  loadNextPage: () => Promise<void>;
}

/** Keeps pagination attached to the mailbox viewport, including filtered empty lists. */
export function EmailMailboxScrollArea({
  children,
  className,
  viewKey,
  loadedCount,
  totalCount,
  hasNextPage,
  isFetching,
  isFetchingNextPage,
  nextPageError,
  loadNextPage,
}: EmailMailboxScrollAreaProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = rootRef.current?.querySelector<HTMLDivElement>('[data-radix-scroll-area-viewport]');
    if (viewport) viewport.scrollTop = 0;
  }, [viewKey]);

  useEffect(() => {
    const viewport = rootRef.current?.querySelector<HTMLDivElement>('[data-radix-scroll-area-viewport]');
    const sentinel = sentinelRef.current;
    if (!viewport || !sentinel || !hasNextPage || isFetching || nextPageError) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadNextPage();
    }, { root: viewport, rootMargin: '0px 0px 200px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [viewKey, hasNextPage, isFetching, nextPageError, loadNextPage]);

  return (
    <ScrollArea ref={rootRef} className={className}>
      {children}
      <div ref={sentinelRef} className="h-px" aria-hidden />
      <div className="py-3 text-center text-xs text-muted-foreground" aria-live="polite" role="status">
        {isFetchingNextPage ? (
          <p>Loading more emails…</p>
        ) : nextPageError ? (
          <div className="space-y-2">
            {loadedCount > 0 && <p role="alert">Could not update emails. Your loaded emails are still available.</p>}
            <Button type="button" size="sm" variant="outline" disabled={isFetching} onClick={() => void loadNextPage()}>
              Try again
            </Button>
          </div>
        ) : loadedCount > 0 ? (
          <p>{hasNextPage ? `${loadedCount} of ${totalCount} emails loaded` : `All ${loadedCount} emails loaded`}</p>
        ) : null}
      </div>
    </ScrollArea>
  );
}
