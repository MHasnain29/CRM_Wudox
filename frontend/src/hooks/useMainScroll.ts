import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/** Collapse only after a clear scroll — keeps sticky shrink from fighting the threshold. */
const COLLAPSE_AT = 96;
/** Restore only when truly near the top. */
const RESTORE_AT = 8;
/** Ignore flip-flops while layout settles after a state change. */
const STATE_LOCK_MS = 550;

function readMainScrolled(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.querySelector<HTMLElement>('main');
  return !!el && el.scrollTop > COLLAPSE_AT;
}

/**
 * True when Layout <main> is past the collapse threshold.
 * Presentation-only — does not touch filter params, queries, or RBAC.
 *
 * @param holdScrolled While Edit is open, do not restore from scroll noise.
 *   Caller clears Edit at scrollTop≈0; we then re-sync immediately.
 */
export function useMainScroll(enabled = true, holdScrolled = false): boolean {
  const [isScrolled, setIsScrolled] = useState(readMainScrolled);
  const { pathname } = useLocation();
  const lockUntilRef = useRef(0);
  const scrolledRef = useRef(isScrolled);
  const holdRef = useRef(holdScrolled);
  holdRef.current = holdScrolled;

  const apply = (next: boolean) => {
    if (next === scrolledRef.current) return;
    scrolledRef.current = next;
    lockUntilRef.current = Date.now() + STATE_LOCK_MS;
    setIsScrolled(next);
  };

  // Sync before paint so navigation / remount never flashes expanded then collapsed.
  useLayoutEffect(() => {
    if (!enabled) {
      apply(false);
      return;
    }
    const el = document.querySelector<HTMLElement>('main');
    if (!el) return;

    apply(el.scrollTop > COLLAPSE_AT);

    const handler = () => {
      const top = el.scrollTop;
      const now = Date.now();
      const prev = scrolledRef.current;

      if (now < lockUntilRef.current) return;

      if (!prev && top > COLLAPSE_AT) {
        apply(true);
        return;
      }
      if (prev && top < RESTORE_AT) {
        if (holdRef.current) return;
        apply(false);
      }
    };

    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
    // pathname: re-bind after route change; apply() reads live scrollTop
  }, [pathname, enabled]);

  // When Edit closes, re-check top so we don't stay stuck collapsed at scrollTop≈0.
  useLayoutEffect(() => {
    if (holdScrolled || !enabled) return;
    const el = document.querySelector<HTMLElement>('main');
    if (!el) return;
    if (el.scrollTop < RESTORE_AT) apply(false);
    else if (el.scrollTop > COLLAPSE_AT) apply(true);
  }, [holdScrolled, enabled]);

  return isScrolled;
}
