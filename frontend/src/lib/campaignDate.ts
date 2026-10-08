import { format } from 'date-fns';
import type { ApiCampaign } from '@/lib/api';
import { getBulkMailPeriodLabel, type DatePeriodPreset } from '@/lib/dateRangeFilter';

export type CampaignDateKind = 'sent' | 'scheduled' | 'created';

/**
 * The date a campaign row displays AND is filtered by. Mirror of campaignEffectiveDateWhere in
 * backend/src/services/campaignDateFilter.ts - keep in sync.
 *   sent (with sentAt)        -> sentAt
 *   sent (sentAt missing)     -> createdAt, labelled "Created" (never a false "Sent" date)
 *   scheduled                 -> scheduledDate
 *   draft / sending / failed  -> createdAt (failed rows carry sentAt but show "Created")
 */
export function getCampaignDisplayDate(
  c: Pick<ApiCampaign, 'status' | 'sentAt' | 'scheduledDate' | 'createdAt'>,
): { date: Date | null; kind: CampaignDateKind } {
  const parse = (iso?: string | null): Date | null => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  if (c.status === 'sent' && c.sentAt) return { date: parse(c.sentAt), kind: 'sent' };
  if (c.status === 'scheduled') return { date: parse(c.scheduledDate), kind: 'scheduled' };
  return { date: parse(c.createdAt), kind: 'created' };
}

function formatDay(d: Date, withYear: boolean): string {
  return format(d, withYear ? 'MMM d, yyyy' : 'MMM d');
}

/** "Oct 8, 2026" for a single day, "Oct 2 – Oct 8, 2026" otherwise (years shown when they differ from now). */
export function formatRangeText(range: { from: Date; to: Date }, now = new Date()): string {
  const sameDay = range.from.toDateString() === range.to.toDateString();
  if (sameDay) return formatDay(range.from, true);
  const thisYear = now.getFullYear();
  const withYear = range.from.getFullYear() !== thisYear || range.to.getFullYear() !== thisYear;
  return `${formatDay(range.from, withYear)} – ${formatDay(range.to, withYear)}`;
}

/**
 * Short label for sentences ("No campaigns for Last 7 days") and a longer caption for the stat cards.
 * `range` is the RESOLVED range, so a 'custom' period with no usable dates reads as "All time".
 */
export function describeCampaignPeriod(
  period: DatePeriodPreset,
  range: { from: Date; to: Date } | null,
  now = new Date(),
): { label: string; caption: string } {
  if (!range) return { label: 'All time', caption: 'All time' };
  const text = formatRangeText(range, now);
  if (period === 'custom') return { label: text, caption: text };
  const name = getBulkMailPeriodLabel(period);
  return { label: name, caption: `${name} · ${text}` };
}

export type CampaignTab = 'all' | 'draft' | 'scheduled' | 'sent' | 'failed';

/**
 * Empty-state copy for a campaign list. `dateFilteredCount` is the number of campaigns the SERVER
 * returned for the active date range, before the status tab / search narrow it further - that is what
 * tells "nothing in this period" (offer Clear date filter) apart from "tab/search matched nothing".
 */
export function buildCampaignEmptyState(opts: {
  isDateFilterActive: boolean;
  periodLabel: string;
  searchTerm: string;
  activeTab: CampaignTab;
  dateFilteredCount: number;
}): { message: string; showClearDate: boolean; showCreateCta: boolean } {
  const { isDateFilterActive, periodLabel, searchTerm, activeTab, dateFilteredCount } = opts;
  const suffix = isDateFilterActive ? ` for ${periodLabel}` : '';

  if (dateFilteredCount === 0) {
    return isDateFilterActive
      ? { message: `No campaigns for ${periodLabel}`, showClearDate: true, showCreateCta: false }
      : {
          message: searchTerm ? 'No campaigns match your search' : 'No campaigns yet',
          showClearDate: false,
          showCreateCta: !searchTerm && activeTab === 'all',
        };
  }

  if (searchTerm) {
    return {
      message: activeTab === 'all'
        ? `No campaigns match your search${suffix}`
        : `No ${activeTab} campaigns match your search${suffix}`,
      showClearDate: false,
      showCreateCta: false,
    };
  }
  if (activeTab !== 'all') {
    return { message: `No ${activeTab} campaigns${suffix}`, showClearDate: false, showCreateCta: false };
  }
  return { message: 'No campaigns found', showClearDate: false, showCreateCta: false };
}
