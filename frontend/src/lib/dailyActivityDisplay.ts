import { differenceInCalendarDays, parseISO, startOfDay } from 'date-fns';
import type { DailyActivityItemDto } from '@/lib/api';

/** Matches backend action_today — same source as agenda list */
export function countActionToday(c: { action_today?: number }): number {
  return Math.max(0, c.action_today ?? 0);
}

export const DAILY_ACTIVITY_STATUS_STYLES: Record<string, string> = {
  today: 'bg-blue-100 text-blue-800 border-blue-200',
  pending: 'bg-amber-100 text-amber-800 border-amber-200',
  overdue: 'bg-red-100 text-red-800 border-red-200',
  completed_today: 'bg-green-100 text-green-800 border-green-200',
  awaiting_approval: 'bg-purple-100 text-purple-800 border-purple-200',
};

function clientDaysOverdue(dueAt: string): number {
  const due = startOfDay(parseISO(dueAt));
  const today = startOfDay(new Date());
  return Math.max(1, differenceInCalendarDays(today, due));
}

/** Badge text for agenda rows — overdue items show day count. */
export function getDailyActivityStatusLabel(item: DailyActivityItemDto): string {
  if (item.status === 'overdue') {
    const days = item.daysOverdue ?? (item.dueAt ? clientDaysOverdue(item.dueAt) : 1);
    return days === 1 ? 'Overdue · 1 day' : `Overdue · ${days} days`;
  }
  if (item.status === 'today') return 'Due today';
  if (item.status === 'completed_today') return 'Done today';
  if (item.status === 'awaiting_approval') return 'Needs approval';
  if (item.status === 'pending') return 'Upcoming';
  return item.status;
}
