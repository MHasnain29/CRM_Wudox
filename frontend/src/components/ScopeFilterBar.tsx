import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import type { ComponentProps } from 'react';
import { useLocation } from 'react-router-dom';
import { AgencyManagerUserFilterRows } from '@/components/AgencyManagerUserFilterRows';
import { LinkedUserAgencyFilter } from '@/components/LinkedUserAgencyFilter';
import { ActAsBanner } from '@/components/ActAsBanner';
import { ActAsHierarchyFilterRows } from '@/components/ActAsHierarchyFilterRows';
import { useMainScroll } from '@/hooks/useMainScroll';
import { useLinkedFilterOverride } from '@/hooks/useLinkedFilterOverride';
import { useLinkedAccounts } from '@/hooks/useLinkedAccounts';
import { cn } from '@/lib/utils';

type FilterRowProps = Omit<
  ComponentProps<typeof AgencyManagerUserFilterRows>,
  'hideUserRows' | 'hideAgencyRow' | 'collapsed' | 'showExpandPanel' | 'onExpandClick'
>;

type Props = {
  show?: boolean;
  filterRowProps: FilterRowProps;
  hideUserRows?: boolean;
};

/**
 * Unified RBAC scope filter bar — presentation wrapper only.
 * Filter selection / URL / queries stay in filterRowProps from useScopeFilter().
 */
export function ScopeFilterBar({ show = true, filterRowProps, hideUserRows = false }: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { pathname } = useLocation();
  const isScrolled = useMainScroll(show, isExpanded);
  const wrapRef = useRef<HTMLDivElement>(null);
  const expandedHeightRef = useRef(0);
  const wasCollapsedRef = useRef(false);
  const { linkedOverrideActive, actAsActive } = useLinkedFilterOverride();
  const { data: linkedAccounts = [] } = useLinkedAccounts();
  const hasLinkedAccounts = linkedAccounts.some((a) => a.isActive);

  // Mini-bar stays while Edit is open so Close never disappears.
  const collapsed = isScrolled || isExpanded;

  // Route change: never carry Edit panel across pages.
  useEffect(() => {
    setIsExpanded(false);
  }, [pathname]);

  useEffect(() => {
    if (!show) {
      setIsExpanded(false);
      return;
    }
    const el = document.querySelector<HTMLElement>('main');
    if (!el) return;

    const onScroll = () => {
      // Only true top dismisses Edit — not threshold flicker.
      if (el.scrollTop <= 2) setIsExpanded(false);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [show]);

  // Measure expanded height while full rows are in flow.
  useLayoutEffect(() => {
    const node = wrapRef.current;
    if (!node || collapsed) return;

    const measure = () => {
      expandedHeightRef.current = node.getBoundingClientRect().height;
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [collapsed, show]);

  // Compensate sticky shrink so scrollTop doesn't fall under restore and re-open.
  useLayoutEffect(() => {
    const node = wrapRef.current;
    const main = document.querySelector<HTMLElement>('main');
    const justCollapsed = collapsed && !wasCollapsedRef.current;
    wasCollapsedRef.current = collapsed;
    if (!justCollapsed || !node || !main) return;

    const collapsedH = node.getBoundingClientRect().height;
    const delta = expandedHeightRef.current - collapsedH;
    if (delta > 1) {
      main.scrollTop += delta;
    }
  }, [collapsed]);

  const showCallerHierarchy = show && !actAsActive;
  const dimCallerHierarchy = linkedOverrideActive && !actAsActive;
  // Linked row 1 already lists agencies — don't repeat them in hierarchy.
  const hideAgencyRow = hasLinkedAccounts;

  return (
    <>
      <ActAsBanner />
      <LinkedUserAgencyFilter />
      {actAsActive && <ActAsHierarchyFilterRows />}
      {showCallerHierarchy && (
        <div
          ref={wrapRef}
          className={cn(
            dimCallerHierarchy && 'opacity-40 pointer-events-none select-none',
          )}
          aria-disabled={dimCallerHierarchy || undefined}
        >
          <AgencyManagerUserFilterRows
            {...filterRowProps}
            hideUserRows={hideUserRows}
            hideAgencyRow={hideAgencyRow}
            collapsed={collapsed}
            showExpandPanel={isExpanded}
            onExpandClick={() => setIsExpanded((v) => !v)}
          />
        </div>
      )}
    </>
  );
}
