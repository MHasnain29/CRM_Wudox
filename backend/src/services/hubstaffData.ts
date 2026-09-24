/** Source normalization shared by the Hubstaff importer and its regression tests. */
export interface DailyActivityRecord {
  id: number | string;
  date: string;
  user_id: number;
  project_id: number | null;
  task_id?: number | string | null;
  global_todo_id?: number | string | null;
  tracked?: number;
  keyboard?: number;
  mouse?: number;
  overall?: number;
  input_tracked?: number;
  manual?: number;
  idle?: number;
  billable?: number;
}
export interface TimeTask {
  id: number | string;
  project_id: number;
  summary: string;
  status: string;
  integration_id?: number;
  global_todo_id?: number | string | null;
  remote_id?: string | null;
  assignee_ids?: number[];
  completed_at?: string | null;
  due_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  url?: string | null;
}
export function providerId(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    return String(value);
  }
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) ? value : null;
}
export function dateOnly(value: string): Date {
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error('Invalid calendar date');
  }
  return date;
}
export function sourceTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.includes('T') || !/(Z|[+-]\d\d:\d\d)$/.test(value))
    return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
export function taskKey(taskId: unknown, globalTodoId?: unknown): string | null {
  const task = providerId(taskId);
  const global = providerId(globalTodoId);
  return task ? `time:${task}` : global ? `global:${global}` : null;
}
function seconds(value: unknown): number {
  if (value == null) return 0;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 2147483647
  ) {
    throw new Error('Invalid Hubstaff duration');
  }
  return value;
}
export function normalizeActivity(rec: DailyActivityRecord) {
  const id = providerId(rec.id);
  if (
    !id ||
    !providerId(rec.user_id) ||
    (rec.project_id != null && rec.project_id !== 0 && !providerId(rec.project_id))
  ) {
    throw new Error('Invalid Hubstaff activity identity');
  }
  return {
    sourceActivityId: id,
    date: dateOnly(rec.date),
    hubstaffUserId: rec.user_id,
    hubstaffProjectId: rec.project_id ?? 0,
    taskKey: taskKey(rec.task_id, rec.global_todo_id),
    hubstaffTaskId: providerId(rec.task_id),
    globalTodoId: providerId(rec.global_todo_id),
    trackedSeconds: seconds(rec.tracked),
    keyboardSeconds: seconds(rec.keyboard),
    mouseSeconds: seconds(rec.mouse),
    overallSeconds: seconds(rec.overall),
    inputTrackedSeconds: seconds(rec.input_tracked),
    manualSeconds: seconds(rec.manual),
    idleSeconds: seconds(rec.idle),
    billableSeconds: seconds(rec.billable),
  };
}
export type NormalizedActivity = ReturnType<typeof normalizeActivity>;
export const durationFields = [
  'trackedSeconds',
  'keyboardSeconds',
  'mouseSeconds',
  'overallSeconds',
  'inputTrackedSeconds',
  'manualSeconds',
  'idleSeconds',
  'billableSeconds',
] as const;
export function aggregateActivities(records: NormalizedActivity[]) {
  const deduped = new Map<string, NormalizedActivity>();
  for (const row of records) {
    const prior = deduped.get(row.sourceActivityId);
    if (prior && JSON.stringify(prior) !== JSON.stringify(row))
      throw new Error('Conflicting Hubstaff activity IDs');
    deduped.set(row.sourceActivityId, row);
  }
  const groups = new Map<string, NormalizedActivity>();
  for (const row of deduped.values()) {
    const key = `${row.hubstaffUserId}:${row.date.toISOString()}:${row.hubstaffProjectId}`;
    const group = groups.get(key);
    if (!group) groups.set(key, { ...row });
    else for (const field of durationFields) group[field] += row[field];
  }
  return { records: [...deduped.values()], aggregates: [...groups.values()] };
}
export function completedStatus(status: string | null | undefined): boolean {
  return status === 'completed' || status === 'archived_native_completed';
}
export function observedCompletion(
  previousStatus: string | null | undefined,
  status: string,
  now: Date
): Date | null {
  // An initial snapshot of an already-completed task is not a completion event today.
  return previousStatus != null && !completedStatus(previousStatus) && completedStatus(status)
    ? now
    : null;
}
export function inputActivityPercent(overall: number, inputTracked: number): number | null {
  return inputTracked > 0
    ? Math.round(Math.min(100, Math.max(0, (overall / inputTracked) * 100)))
    : null;
}
export function retryDelay(retryAfter: string | null, attempt: number, now = Date.now()): number {
  if (retryAfter) {
    const numeric = Number(retryAfter);
    const ms = Number.isFinite(numeric) ? numeric * 1000 : Date.parse(retryAfter) - now;
    if (Number.isFinite(ms) && ms >= 0) return ms;
  }
  return Math.min(1000 * 2 ** attempt, 8000);
}

/** Source links must be real provider values; never derive a URL from an ID. */
export function sourceUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}
export function taskTransition(
  previous: string | null | undefined,
  next: string
): 'completed' | 'reopened' | null {
  if (previous == null || previous === next) return null;
  if (!completedStatus(previous) && completedStatus(next)) return 'completed';
  if (completedStatus(previous) && ['active', 'archived_native_active'].includes(next))
    return 'reopened';
  return null;
}
