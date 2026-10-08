import { useEffect, useState } from 'react';
import { format } from 'date-fns';

const todayString = () => format(new Date(), 'yyyy-MM-dd');

/**
 * The viewer's local calendar day ("yyyy-MM-dd"). Changes once at local midnight so rolling date
 * presets (Today, Last 7 days, This month...) re-resolve on a page that was left open.
 *
 * A single setTimeout to midnight is not enough: background tabs throttle timers, laptops sleep and
 * bfcache restores skip them. So we cheaply re-compare on an interval and on every "I'm visible
 * again" event; state only changes when the day string does.
 */
export function useTodayKey(): string {
  const [today, setToday] = useState(todayString);

  useEffect(() => {
    const check = () => setToday((prev) => {
      const next = todayString();
      return next === prev ? prev : next;
    });
    const id = window.setInterval(check, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', check);
    window.addEventListener('focus', check);
    check();
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', check);
      window.removeEventListener('focus', check);
    };
  }, []);

  return today;
}
