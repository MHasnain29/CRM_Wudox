import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { fetchAssignableRoles } from '@/lib/rbacApi';
import { buildRoleOptionsForSelect } from '@/lib/roleLabels';
import { ROLE_OPTIONS } from '@/lib/roleOptions';
import { STATIC_ASSIGNABLE_ROLES } from '@/lib/hierarchyFilter';

const staticFallback = ROLE_OPTIONS.map((o) => ({ role: o.role, label: o.label }));

export function useAssignableRoles() {
  const query = useQuery({
    queryKey: ['roles-assignable'],
    queryFn: fetchAssignableRoles,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    meta: {
      onError: () => {
        toast.error('Could not load roles from server; using default list.');
      },
    },
  });

  const roleOptions = useMemo(() => {
    if (query.data && query.data.length > 0) {
      return buildRoleOptionsForSelect(query.data);
    }
    return staticFallback;
  }, [query.data]);

  return {
    ...query,
    assignableRoles: query.data?.length ? query.data : STATIC_ASSIGNABLE_ROLES,
    roleOptions,
  };
}
