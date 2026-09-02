import { useQuery } from '@tanstack/react-query';
import {
  fetchListPreviewClients,
  type ListPreviewFilters,
} from '@/lib/listClientPreview';

export function useListClientPreview(filters: ListPreviewFilters, enabled: boolean) {
  const hasAttributeFilters =
    filters.industryFilters.length > 0 ||
    filters.locationFilters.length > 0 ||
    filters.tagFilters.length > 0 ||
    filters.companySizeFilters.length > 0;

  const query = useQuery({
    queryKey: [
      'list-preview-clients',
      filters.subCompanyId ?? '',
      filters.industryFilters.slice().sort().join('\0'),
      filters.locationFilters.slice().sort().join('\0'),
      filters.tagFilters.slice().sort().join('\0'),
      filters.companySizeFilters.slice().sort().join('\0'),
    ],
    queryFn: () => fetchListPreviewClients(filters),
    enabled: enabled && hasAttributeFilters,
    staleTime: 30_000,
  });

  return {
    clients: query.data ?? [],
    isFetching: query.isFetching,
    usingServerPreview: enabled && hasAttributeFilters,
  };
}
