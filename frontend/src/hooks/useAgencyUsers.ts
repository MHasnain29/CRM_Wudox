import { useEffect, useState } from 'react';
import { fetchUsers, type ApiUser } from '@/lib/api';
import { staffUserLabel } from '@/lib/phoneSystemExtensions';

export function useAgencyUsers(agencyId: string | null) {
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!agencyId) {
      setUsers([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchUsers({ subCompanyId: agencyId })
      .then((list) => {
        if (!cancelled) setUsers(list.filter((u) => u.isActive));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [agencyId]);

  return { users, loading, userLabel: staffUserLabel };
}
