/**
 * Job end-date helpers — surface jobs that are due (or overdue) to be closed.
 */
import type { Job } from '@/lib/jobTypes';

export type JobEndInfo = {
  endDate: Date | null;
  /** Draft/open job whose end date has passed — should be closed. */
  isOverdue: boolean;
  /** Draft/open job ending within the next 7 days. */
  endsSoon: boolean;
  /** Whole days until the end date (negative when past). Null without an end date. */
  daysLeft: number | null;
};

const ENDING_SOON_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export function getJobEndInfo(job: Pick<Job, 'status' | 'shiftSchedule'>): JobEndInfo {
  const raw = job.shiftSchedule?.jobEndDate;
  const endDate = raw ? new Date(raw) : null;
  if (!endDate || Number.isNaN(endDate.getTime())) {
    return { endDate: null, isOverdue: false, endsSoon: false, daysLeft: null };
  }
  const stillRunning = job.status === 'open' || job.status === 'draft';
  const daysLeft = Math.ceil((endDate.getTime() - Date.now()) / DAY_MS);
  return {
    endDate,
    isOverdue: stillRunning && daysLeft < 0,
    endsSoon: stillRunning && daysLeft >= 0 && daysLeft <= ENDING_SOON_DAYS,
    daysLeft,
  };
}
