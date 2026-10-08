import { format, startOfMonth } from 'date-fns';

/** Bulk Mail's date filter as the conversion card receives it: exact instants, or no bounds at all. */
export type ConversionCardRange = { from: string; to: string } | 'all';

export interface ConversionQueryInputs {
  agencyId?: string;
  agencyIds?: string[];
  ownerIds?: string[];
  ownerExact?: boolean;
  startDate?: string; // YYYY-MM-DD (legacy; the Reports page)
  endDate?: string;   // YYYY-MM-DD (legacy)
  /** Takes precedence over startDate/endDate and the month-to-date default. */
  range?: ConversionCardRange;
}

/**
 * Query key + request params for GET /reports/bulk-email-conversion-rate, as a pure function so the
 * composition is unit-testable without a DOM. Every input that changes the request is in the key.
 */
export function conversionQueryArgs(p: ConversionQueryInputs, now = new Date()) {
  const legacyStart = p.startDate ?? format(startOfMonth(now), 'yyyy-MM-dd');
  const legacyEnd   = p.endDate   ?? format(now, 'yyyy-MM-dd');
  const period =
    p.range === 'all' ? { allTime: true }
    : p.range ? { from: p.range.from, to: p.range.to }
    : { startDate: legacyStart, endDate: legacyEnd };
  const periodKey = p.range === 'all' ? 'all' : p.range ? `${p.range.from}|${p.range.to}` : `${legacyStart}|${legacyEnd}`;
  return {
    // 'bulk-email-conversion' first: BulkEmails.invalidateAll() matches on queryKey[0].
    key: ['bulk-email-conversion', p.agencyId ?? '', p.agencyIds?.join(',') ?? '', p.ownerIds?.join(',') ?? '', p.ownerExact ? 1 : 0, periodKey] as const,
    params: {
      ...period,
      agencyId: p.agencyId,
      agencyIds: p.agencyIds,
      ownerIds: p.ownerIds,
      ownerExact: p.ownerExact,
      source: 'mail' as const,
      dateBasis: 'assigned' as const,
    },
  };
}
