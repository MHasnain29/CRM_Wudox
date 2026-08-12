import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLinkedAccounts } from '@/hooks/useLinkedAccounts';
import { useStore } from '@/lib/store';

export interface ActAsState {
  isActive: boolean;
  userId: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  agencyName: string | null;
}

const INACTIVE: ActAsState = {
  isActive: false,
  userId: null,
  firstName: null,
  lastName: null,
  email: null,
  agencyName: null,
};

/**
 * Derives act-as state purely from URL params + linked accounts.
 * Active only when linkedUserId contains exactly ONE non-self linked user.
 * URL-driven: always in sync, no separate store, no useEffect needed here.
 */
export function useActAs(): ActAsState {
  const [searchParams] = useSearchParams();
  const { data: linkedAccounts = [] } = useLinkedAccounts();
  const currentUserId = useStore((s) => s.currentUser?.id);

  return useMemo(() => {
    const param = searchParams.get('linkedUserId') ?? '';
    const ids = param.split(',').filter(Boolean);

    // Only activate for exactly one selected user
    if (ids.length !== 1) return INACTIVE;
    const [singleId] = ids;
    if (singleId === currentUserId) return INACTIVE;

    // Must be in active linked accounts
    const linked = linkedAccounts.find((a) => a.userId === singleId && a.isActive);
    if (!linked) return INACTIVE;

    return {
      isActive: true,
      userId: singleId,
      firstName: linked.firstName,
      lastName: linked.lastName,
      email: linked.email,
      agencyName: linked.subCompanyName,
    };
  }, [searchParams, linkedAccounts, currentUserId]);
}
