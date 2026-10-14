export const MAX_NORMAL_ELAPSED_S = 40;

export type ActivityMeasurementInterval = {
  state: 'active' | 'idle';
  startedAt: Date;
  endedAt: Date;
};

type TimeInterval = { startedAt: Date; endedAt: Date };

type WorkingTimeWindow = {
  from: Date;
  to: Date;
  workStartTime?: string | null;
  workEndTime?: string | null;
  timeZone: string;
};

function clockMinutes(value: string): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

/**
 * Intersect a confirmed observation window with the recurring local work schedule.
 * Boundaries are half-open and retain milliseconds. Inspecting each local minute
 * also handles skipped/repeated clock hours during daylight-saving transitions.
 * An absent schedule is unrestricted; an invalid/partial schedule is unknown.
 */
export function workingTimeIntervals(input: WorkingTimeWindow): TimeInterval[] {
  const from = input.from.getTime();
  const to = input.to.getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || !input.timeZone) return [];

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: input.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return [];
  }

  const startMissing = input.workStartTime == null;
  const endMissing = input.workEndTime == null;
  if (startMissing && endMissing) return [{ startedAt: new Date(from), endedAt: new Date(to) }];
  if (startMissing || endMissing) return [];
  const start = clockMinutes(input.workStartTime!);
  const end = clockMinutes(input.workEndTime!);
  if (start === null || end === null) return [];
  // Matching endpoints explicitly represent a 24-hour schedule.
  if (start === end) return [{ startedAt: new Date(from), endedAt: new Date(to) }];

  const intervals: TimeInterval[] = [];
  let cursor = from;
  while (cursor < to) {
    const date = new Date(cursor);
    const parts = formatter.formatToParts(date);
    const hour = Number(parts.find(part => part.type === 'hour')!.value);
    const minute = Number(parts.find(part => part.type === 'minute')!.value);
    const second = Number(parts.find(part => part.type === 'second')!.value);
    const localMinute = hour * 60 + minute;
    // Align to actual clock boundaries, never to "60 seconds after the heartbeat".
    const next = Math.min(to, cursor + 60_000 - second * 1000 - date.getUTCMilliseconds());
    const inHours = start < end
      ? localMinute >= start && localMinute < end
      : localMinute >= start || localMinute < end;
    if (inHours) {
      const previous = intervals[intervals.length - 1];
      if (previous?.endedAt.getTime() === cursor) previous.endedAt = new Date(next);
      else intervals.push({ startedAt: new Date(cursor), endedAt: new Date(next) });
    }
    cursor = next;
  }
  return intervals;
}

/**
 * Measure only a continuously observed window; callers reject heartbeat gaps.
 * Idle starts at the last real input plus the configured grace period. A first
 * input timestamp ends idle at that input, even if a later input is also present.
 * A latest timestamp alone cannot prove when activity resumed, so any ambiguous
 * period preceding it is omitted instead of guessed to be active or idle.
 */
export function measureActivityWindow(input: WorkingTimeWindow & {
  previousInputAt: Date;
  firstInputAt?: Date | null;
  lastInputAt: Date | null;
  thresholdSeconds: number;
  onBreak: boolean;
}): { intervals: ActivityMeasurementInterval[] } {
  const from = input.from.getTime();
  const to = input.to.getTime();
  const previousInput = input.previousInputAt.getTime();
  const latestInput = input.lastInputAt?.getTime() ?? previousInput;
  const firstInput = input.firstInputAt?.getTime();
  const threshold = input.thresholdSeconds * 1000;
  if (input.onBreak || ![from, to, previousInput, latestInput, threshold].every(Number.isFinite)
    || to <= from || previousInput > from || latestInput > to || threshold < 0
    || (firstInput !== undefined && (!Number.isFinite(firstInput) || firstInput > latestInput))) {
    return { intervals: [] };
  }

  const workIntervals = workingTimeIntervals(input);
  const measured: ActivityMeasurementInterval[] = [];
  const add = (state: 'active' | 'idle', start: number, end: number): void => {
    start = Math.max(from, start);
    end = Math.min(to, end);
    if (end <= start) return;
    const previous = measured[measured.length - 1];
    if (previous?.state === state && previous.endedAt.getTime() === start) previous.endedAt = new Date(end);
    else measured.push({ state, startedAt: new Date(start), endedAt: new Date(end) });
  };
  const classify = (start: number, end: number, lastInput: number): void => {
    const idleStart = lastInput + threshold;
    add('active', start, Math.min(end, idleStart));
    add('idle', Math.max(start, idleStart), end);
  };

  if (latestInput <= previousInput) {
    classify(from, to, previousInput);
  } else if (firstInput !== undefined && firstInput > previousInput) {
    classify(from, Math.max(from, firstInput), previousInput);
    // First/latest inputs cover the whole span when its length is below the
    // threshold (normal heartbeats are <=40s and thresholds are >=60s).
    add('active', Math.max(from, firstInput), Math.min(latestInput, firstInput + threshold));
    classify(Math.max(from, latestInput), to, latestInput);
  } else {
    add('active', from, Math.min(latestInput, previousInput + threshold));
    classify(Math.max(from, latestInput), to, latestInput);
  }

  const intervals: ActivityMeasurementInterval[] = [];
  for (const activity of measured) {
    for (const work of workIntervals) {
      const startedAt = Math.max(activity.startedAt.getTime(), work.startedAt.getTime());
      const endedAt = Math.min(activity.endedAt.getTime(), work.endedAt.getTime());
      if (endedAt > startedAt) intervals.push({ state: activity.state, startedAt: new Date(startedAt), endedAt: new Date(endedAt) });
    }
  }
  return { intervals };
}
