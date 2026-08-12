import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,      // always consider data stale → always refetch on mount/key-change
      gcTime: 0,         // evict cache immediately when query goes inactive → no stale flash on key change
      refetchOnWindowFocus: false,
    },
  },
});
