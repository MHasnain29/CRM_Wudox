import { differenceInCalendarDays, format } from 'date-fns';
import { PICKER_MAX_DATE, PICKER_MIN_DATE, parsePickerDate } from '@/lib/dateRangeFilter';

/**
 * Pure state logic for the custom date-range picker. The inputs hold text (yyyy-MM-dd) so a half-typed or
 * out-of-range value is never silently replaced; everything derived (dates, validity) comes from the text.
 */
export interface RangeDraft {
  fromText: string;
  toText: string;
}

export const toInputValue = (d: Date): string => format(d, 'yyyy-MM-dd');

export function draftFromRange(range?: { from?: Date; to?: Date }): RangeDraft {
  if (!range?.from) return { fromText: '', toText: '' };
  return { fromText: toInputValue(range.from), toText: toInputValue(range.to ?? range.from) };
}

/**
 * A calendar click. No start yet, or a finished range (or a bad end text) -> begin a new range at that day.
 * Otherwise it is the end day; clicking before the start swaps them, clicking the start again is a one-day range.
 */
export function applyDayClick(draft: RangeDraft, day: Date): RangeDraft {
  const from = parsePickerDate(draft.fromText);
  if (!from || draft.toText !== '') return { fromText: toInputValue(day), toText: '' };
  return day.getTime() < from.getTime()
    ? { fromText: toInputValue(day), toText: toInputValue(from) }
    : { fromText: draft.fromText, toText: toInputValue(day) };
}

// `error?: undefined` on the ok branch lets callers read `.error` without narrowing (this project has strict off,
// where TypeScript does not narrow `ok: true | false` unions in the else branch).
export type DraftValidation =
  | { ok: true; from: Date; to: Date; days: number; endPending: boolean; error?: undefined }
  | { ok: false; error?: string };

const RANGE_HINT = `${PICKER_MIN_DATE.slice(0, 4)}–${PICKER_MAX_DATE.slice(0, 4)}`;

/** `endPending` = only a start day is chosen, which Apply treats as a one-day range. */
export function validateDraft(draft: RangeDraft): DraftValidation {
  if (draft.fromText === '') return { ok: false };
  const from = parsePickerDate(draft.fromText);
  if (!from) return { ok: false, error: `Enter a valid start date (${RANGE_HINT}).` };
  if (draft.toText === '') return { ok: true, from, to: from, days: 1, endPending: true };
  const to = parsePickerDate(draft.toText);
  if (!to) return { ok: false, error: `Enter a valid end date (${RANGE_HINT}).` };
  if (to.getTime() < from.getTime()) return { ok: false, error: "End date can't be before the start date." };
  // Calendar-day difference (not ms / 86_400_000) so a DST change inside the range can't make it 37.96 days.
  return { ok: true, from, to, days: differenceInCalendarDays(to, from) + 1, endPending: false };
}

export function describeDraft(v: DraftValidation): string {
  if (!v.ok) return v.error ? '' : 'Select a start date';
  if (v.endPending) return 'Pick an end date, or Apply for a single day';
  return `${v.days} ${v.days === 1 ? 'day' : 'days'} selected`;
}
