/**
 * Date-range filter for GET /emails (Inbox / Sent / Drafts).
 *
 * An email is "in" a range by Email.timestamp - never null (defaults to now(), no create site sets it),
 * indexed, the list's sort key and the date every card displays. So the filter, the order and what the
 * user reads on screen always agree. The Sent folder also merges synthetic PandaDoc items that are not
 * Email rows; their displayed date is pandaDocUpdatedAt ?? createdAt, which proposalDateWhere mirrors.
 *
 * The filter MUST run in the database query: the list is paginated server-side, so a client-side filter
 * would only ever see the pages already loaded.
 */
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { filterInstantSchema, refineFromBeforeTo } from './campaignDateFilter';

export type EmailDateRange = { from?: Date; to?: Date };

/** Query-param shape for `from` / `to` (inclusive ISO instants with offset). Route and tests share it. */
export const emailDateQueryShape = {
  from: filterInstantSchema.optional(),
  to: filterInstantSchema.optional(),
};

/** `.superRefine` target for a schema built on emailDateQueryShape: rejects a reversed range. */
export const refineEmailDateQuery: (q: { from?: string; to?: string }, ctx: z.RefinementCtx) => void =
  refineFromBeforeTo;

/** Validated ISO strings -> Dates. Keys are omitted for an absent bound (open-ended range). */
export function parseEmailDateRange(q: { from?: string; to?: string }): EmailDateRange {
  const range: EmailDateRange = {};
  if (q.from) range.from = new Date(q.from);
  if (q.to) range.to = new Date(q.to);
  return range;
}

function hasBounds(range: EmailDateRange | null | undefined): range is EmailDateRange {
  return !!range && (!!range.from || !!range.to);
}

/** Inclusive on both ends; keys are omitted for an absent bound. */
function bounds(range: EmailDateRange): { gte?: Date; lte?: Date } {
  const r: { gte?: Date; lte?: Date } = {};
  if (range.from) r.gte = range.from;
  if (range.to) r.lte = range.to;
  return r;
}

export function emailTimestampWhere(range: EmailDateRange): Prisma.EmailWhereInput {
  return { timestamp: bounds(range) };
}

/**
 * ANDs the date clause onto an existing where and returns a NEW object (the caller still needs the undated
 * where for the PandaDoc de-dupe). Never writes a top-level OR: every owner-scope branch of GET /emails
 * already sets one, and replacing it would leak other people's mail into the range.
 */
export function applyEmailDateRange(
  where: Prisma.EmailWhereInput,
  range: EmailDateRange | null | undefined,
): Prisma.EmailWhereInput {
  if (!hasBounds(range)) return where;
  const existing = where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : [];
  return { ...where, AND: [...existing, emailTimestampWhere(range)] };
}

/**
 * Range for the synthetic PandaDoc "sent" items, applied in the proposal query so it lands before `take`.
 * Mirrors the route's ts = pandaDocUpdatedAt ?? createdAt. A bare `pandaDocUpdatedAt` range is not enough:
 * a NULL never satisfies gte/lte, so proposals without it need their own createdAt branch.
 */
export function proposalDateWhere(range: EmailDateRange | null | undefined): Prisma.ProposalWhereInput | undefined {
  if (!hasBounds(range)) return undefined;
  const r = bounds(range);
  return {
    OR: [
      { pandaDocUpdatedAt: r },
      { pandaDocUpdatedAt: null, createdAt: r },
    ],
  };
}
