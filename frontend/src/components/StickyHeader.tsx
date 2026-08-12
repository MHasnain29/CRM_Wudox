import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

/** Secondary sticky bars (status tabs, toolbars) sit under the filter sticky. */
export const STICKY_Z_DEFAULT = 30;
/** Scope filter + Edit/Close must stack above other sticky sections on the page. */
export const STICKY_Z_FILTER = 40;

export function StickyHeader({
  children,
  className,
  zIndex = STICKY_Z_DEFAULT,
  bleed = true,
}: {
  children: ReactNode;
  className?: string;
  zIndex?: number;
  /** Extend to the edges of the main scroll area (offsets Layout px-6). */
  bleed?: boolean;
}) {
  return (
    <div
      style={{ top: 'var(--app-header-height, 0px)', zIndex }}
      className={cn(
        'sticky top-0 bg-white border-b border-border py-2',
        bleed && '-mx-6 px-6',
        className,
      )}
    >
      {children}
    </div>
  );
}
