/**
 * Date-range filter for GET /campaigns.
 *
 * A campaign is "in" a period by its EFFECTIVE date — the same date the list row displays:
 *   sent                      -> sentAt (falls back to createdAt when sentAt is null)
 *   scheduled                 -> scheduledDate
 *   draft / sending / failed  -> createdAt   (failed rows carry sentAt but display "Created")
 *
 * Mirror of getCampaignDisplayDate in frontend/src/lib/campaignDate.ts - keep in sync.
 */
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

export type CampaignDateRange = { from?: Date; to?: Date };

/**
 * Query-param validator for an inclusive ISO instant (`from` / `to`). zod's datetime() accepts offsets up to
 * ±14:00, so '9999-12-31T23:59:59-14:00' is a *valid* string whose UTC instant is year 10000 — Prisma cannot
 * serialise that and the throw would escape an async Express 4 handler. So the instant itself is bounded.
 * The frontend clamps its own ranges well inside this window (normalizeRange).
 */
export const MIN_FILTER_YEAR = 1970;
export const MAX_FILTER_YEAR = 2100;
export const filterInstantSchema = z
  .string()
  .datetime({ offset: true })
  .refine((s) => {
    const year = new Date(s).getUTCFullYear();
    return year >= MIN_FILTER_YEAR && year <= MAX_FILTER_YEAR;
  }, { message: `Date must be between ${MIN_FILTER_YEAR} and ${MAX_FILTER_YEAR}` });

/** Shared refinement: when both bounds are present, `from` must not be after `to`. */
export function refineFromBeforeTo(q: { from?: string; to?: string }, ctx: z.RefinementCtx): void {
  if (q.from && q.to && new Date(q.from).getTime() > new Date(q.to).getTime()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['from'], message: 'from must be before or equal to to' });
  }
}

/** Inclusive on both ends; keys are omitted for an absent bound (open-ended range). */
function bounds(range: CampaignDateRange): { gte?: Date; lte?: Date } {
  const r: { gte?: Date; lte?: Date } = {};
  if (range.from) r.gte = range.from;
  if (range.to) r.lte = range.to;
  return r;
}

export function campaignEffectiveDateWhere(range: CampaignDateRange): Prisma.EmailCampaignWhereInput {
  const r = bounds(range);
  return {
    OR: [
      { status: 'sent', sentAt: r },
      { status: 'sent', sentAt: null, createdAt: r },
      { status: 'scheduled', scheduledDate: r },
      { status: { in: ['draft', 'sending', 'failed'] }, createdAt: r },
    ],
  };
}

/**
 * ANDs the date clause onto an existing where. Never writes a top-level OR: the owner-scope
 * expansion (linkedExpansionToWhere) may already have set one, and clobbering it would leak scope.
 */
export function applyCampaignDateRange(
  where: Prisma.EmailCampaignWhereInput,
  range: CampaignDateRange | null | undefined,
): Prisma.EmailCampaignWhereInput {
  if (!range || (!range.from && !range.to)) return where;
  const existing = where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : [];
  where.AND = [...existing, campaignEffectiveDateWhere(range)];
  return where;
}
