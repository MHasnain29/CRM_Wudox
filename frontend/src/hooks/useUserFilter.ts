import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchUsers, fetchTeamMembers, type ApiUser } from '@/lib/api';
import { useStore } from '@/lib/store';
import { useCanAccessMultipleAgencies, useCanViewTeamScope } from '@/lib/access';
import { USER_FILTER_PREFIX } from '@/lib/sessionKeys';

function getStorageKey(agencyId: string | undefined): string {
  return `${USER_FILTER_PREFIX}${agencyId ?? 'none'}`;
}

/**
 * @deprecated Use useScopeFilter + URL params instead.
 */
export function useUserFilter() {
  const { currentSubCompany, currentUser } = useStore();
  const agencyId = currentSubCompany?.id ?? currentUser?.subCompanyId;
  const userId = currentUser?.id;

  const isElevated = useCanAccessMultipleAgencies();
  const isManager = useCanViewTeamScope() && !isElevated;
  const canFilter = isElevated || isManager;

  const { data: allUsers = [], isLoading: allUsersLoading } = useQuery<ApiUser[]>({
    queryKey: ['agency-users', agencyId],
    queryFn: () => fetchUsers({ subCompanyId: agencyId }),
    enabled: isElevated && !!agencyId,
    staleTime: 2 * 60 * 1000,
  });

  const { data: teamMembers = [], isLoading: teamMembersLoading } = useQuery<ApiUser[]>({
    queryKey: ['team-members', userId],
    queryFn: () => fetchTeamMembers(),
    enabled: isManager,
    staleTime: 2 * 60 * 1000,
  });

  const users = isManager ? teamMembers : allUsers;
  const isLoading = isManager ? teamMembersLoading : allUsersLoading;

  const storageKey = getStorageKey(agencyId);

  const [selectedIds, setSelectedIdsRaw] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? (JSON.parse(stored) as string[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (users.length === 0) return;
    const validIds = users.map((u) => u.id);
    setSelectedIdsRaw((prev) => {
      const filtered = prev.filter((id) => validIds.includes(id));
      if (filtered.length !== prev.length) {
        try { localStorage.setItem(storageKey, JSON.stringify(filtered)); } catch { /* ignore */ }
        return filtered;
      }
      return prev;
    });
  }, [users, storageKey]);

  useEffect(() => {
    setSelectedIdsRaw([]);
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agencyId]);

  const setSelectedIds = useCallback(
    (ids: string[]) => {
      setSelectedIdsRaw(ids);
      try {
        if (ids.length === 0) {
          localStorage.removeItem(storageKey);
        } else {
          localStorage.setItem(storageKey, JSON.stringify(ids));
        }
      } catch { /* ignore */ }
    },
    [storageKey]
  );

  return {
    canFilter,
    isLoading,
    users,
    selectedIds,
    setSelectedIds,
    effectiveOwnerIds: selectedIds.length > 0 ? selectedIds : undefined,
  };
}
