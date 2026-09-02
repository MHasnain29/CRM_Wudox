import { fetchClients } from '@/lib/api';
import type { Client } from '@/lib/types';

const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

export type ListPreviewFilters = {
  industryFilters: string[];
  locationFilters: string[];
  tagFilters: string[];
  companySizeFilters: string[];
  subCompanyId?: string;
};

type ApiListClient = Awaited<ReturnType<typeof fetchClients>>['data'][number];

/** Case-insensitive, trimmed membership — facets trim values but client rows may not. */
export function matchesAnyFilter(value: string | null | undefined, filters: string[]): boolean {
  if (filters.length === 0) return true;
  const needle = (value ?? '').trim().toLowerCase();
  if (!needle) return false;
  return filters.some((f) => f.trim().toLowerCase() === needle);
}

export function mapApiClientToListClient(c: ApiListClient): Client {
  return {
    id: c.id,
    name: c.name,
    industry: c.industry ?? '',
    location: c.location ?? '',
    address: c.address ?? '',
    companySize: c.companySize ?? '',
    tags: c.tags ?? [],
    contacts: (c.contacts ?? []).map((ct) => ({
      id: ct.id,
      clientId: c.id,
      name: ct.name,
      title: ct.title ?? '',
      email: ct.email ?? '',
      phone: ct.phone ?? '',
      phoneExtension: ct.phoneExtension ?? undefined,
      linkedin: ct.linkedin ?? undefined,
      website: ct.website ?? undefined,
      isPrimary: ct.isPrimary,
    })),
    lastActivity: c.lastActivity ? new Date(c.lastActivity) : undefined,
    status: c.status as Client['status'],
    createdAt: new Date(c.createdAt),
    notes: [],
  };
}

/**
 * Load every client matching list attribute filters from the API.
 * Industry matching is case-insensitive on the server and is not limited
 * to the first page of an unfiltered client list.
 */
export async function fetchListPreviewClients(filters: ListPreviewFilters): Promise<Client[]> {
  const params = {
    limit: PAGE_SIZE,
    industry: filters.industryFilters.length ? filters.industryFilters.join(',') : undefined,
    location: filters.locationFilters.length ? filters.locationFilters.join(',') : undefined,
    companySize: filters.companySizeFilters.length ? filters.companySizeFilters.join(',') : undefined,
    tags: filters.tagFilters.length ? filters.tagFilters.join(',') : undefined,
    subCompanyId: filters.subCompanyId,
    sortBy: 'name' as const,
    sortOrder: 'asc' as const,
  };

  const first = await fetchClients({ ...params, page: 1 });
  const pages = Math.min(Math.max(first.pagination.totalPages, 1), MAX_PAGES);
  const rest =
    pages > 1
      ? await Promise.all(
          Array.from({ length: pages - 1 }, (_, i) => fetchClients({ ...params, page: i + 2 })),
        )
      : [];

  return [first, ...rest].flatMap((r) => r.data.map(mapApiClientToListClient));
}
