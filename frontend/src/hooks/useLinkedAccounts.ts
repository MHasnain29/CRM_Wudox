import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMyLinkedAccounts } from '@/lib/api';
import { useStore } from '@/lib/store';
import { onAgencyLinkChanged } from '@/lib/socket';

export function useLinkedAccounts() {
  const queryClient = useQueryClient();
  const currentUser = useStore((s) => s.currentUser);

  useEffect(() => {
    return onAgencyLinkChanged(() => {
      queryClient.invalidateQueries({ queryKey: ['my-linked-accounts'] });
    });
  }, [queryClient]);

  return useQuery({
    queryKey: ['my-linked-accounts'],
    queryFn: fetchMyLinkedAccounts,
    staleTime: 5 * 60 * 1000,
    enabled: !!currentUser,
  });
}
