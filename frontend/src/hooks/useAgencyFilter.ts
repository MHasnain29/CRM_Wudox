/**
 * useAgencyFilter — resolves which agencies the current user can filter by.
 * Uses RBAC permissions / data scope (not hardcoded role names).
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../lib/authStore';
import { useCanAccessMultipleAgencies, useCanViewGlobalScope } from '../lib/access';
import { isAgencyIndependentRole } from '../lib/agencyIndependentRoles';
import { fetchAccessibleAgencies } from '../lib/api';
import { AGENCY_FILTER_KEY } from '../lib/sessionKeys';

export type Agency = { id: string; name: string; countries: string[] };

export function useAgencyFilter() {
  const isElevated = useCanAccessMultipleAgencies();
  const isGlobalScope = useCanViewGlobalScope();
  const role = useAuthStore((s) => s.user?.role);
  const subCompanyId = useAuthStore((s) => s.user?.subCompanyId);

  const { data: agencies = [], isLoading } = useQuery<Agency[]>({
    queryKey: ['accessible-agencies'],
    queryFn: fetchAccessibleAgencies,
    enabled: isElevated || isAgencyIndependentRole(role),
    staleTime: 5 * 60 * 1000,
  });

  const [selectedIds, setSelectedIdsRaw] = useState<string[]>(() => {
    if (!isElevated) return [];
    try {
      const stored = localStorage.getItem(AGENCY_FILTER_KEY);
      return stored ? (JSON.parse(stored) as string[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (!isElevated || !agencies.length) return;
    const validIds = agencies.map((a) => a.id);
    setSelectedIdsRaw((prev) => {
      const valid = prev.filter((id) => validIds.includes(id));
      if (valid.length > 0) return valid;
      if (!isGlobalScope && subCompanyId && validIds.includes(subCompanyId)) {
        return [subCompanyId];
      }
      return [];
    });
  }, [agencies, isElevated, isGlobalScope, subCompanyId]);

  const setSelectedIds = useCallback((ids: string[]) => {
    setSelectedIdsRaw(ids);
    try {
      localStorage.setItem(AGENCY_FILTER_KEY, JSON.stringify(ids));
    } catch {
      // ignore storage errors
    }
  }, []);

  const effectiveAgencyIds = useMemo(
    () =>
      isElevated
        ? selectedIds.length > 0
          ? selectedIds
          : isGlobalScope
            ? []
            : subCompanyId
              ? [subCompanyId]
              : []
        : undefined,
    [isElevated, selectedIds, isGlobalScope, subCompanyId],
  );

  return {
    isElevated,
    isLoading,
    agencies,
    selectedIds,
    setSelectedIds,
    effectiveAgencyIds,
  };
}
