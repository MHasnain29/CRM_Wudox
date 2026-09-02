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

  const canQuery = enabled && hasAttributeFilters;

  const query = useQuery({
    queryKey: [
      'list-preview-clients',
      filters.subCompanyId ?? '',
      filters.industryFilters.slice().sort().join('\0'),
      filters.locationFilters.slice().sort().join('\0'),
      filters.tagFilters.slice().sort().join('\0'),
      filters.companySizeFilters.slice().sort().join('\0'),
    ],
    queryFn: ({ queryKey }) => {
      const [, subCompanyId, industry, location, tags, size] = queryKey as [
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      return fetchListPreviewClients({
        subCompanyId: subCompanyId || undefined,
        industryFilters: industry ? industry.split('\0') : [],
        locationFilters: location ? location.split('\0') : [],
        tagFilters: tags ? tags.split('\0') : [],
        companySizeFilters: size ? size.split('\0') : [],
      });
    },
    enabled: canQuery,
    staleTime: 0,
  });

  return {
    clients: query.data ?? [],
    isFetching: query.isFetching,
    isError: query.isError,
    usingServerPreview: canQuery,
  };
}
