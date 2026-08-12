/**
 * Hierarchy filter rows for the act-as target (not the caller's tree).
 * Reuses chip row pattern; writes the same leaderId/managerId/userId URL params.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { TabChipText, TabChipUser } from '@/components/TabChip';
import { useActAs } from '@/hooks/useActAs';
import { useLinkedAccounts } from '@/hooks/useLinkedAccounts';
import { fetchScopeFilterUsers, fetchTeamMembers, type ApiUser } from '@/lib/api';
import { getUserRoleTitle } from '@/lib/roleLabels';
import { actAsHeader } from '@/lib/actAsHeader';

function isManagerLike(level: string | undefined): boolean {
  return level === 'team';
}

function isAgencyLike(level: string | undefined): boolean {
  return level === 'agency' || level === 'global';
}

export function ActAsHierarchyFilterRows() {
  const actAs = useActAs();
  const { data: linkedAccounts = [] } = useLinkedAccounts();
  const [searchParams, setSearchParams] = useSearchParams();

  const linked = useMemo(
    () => linkedAccounts.find((a) => a.userId === actAs.userId && a.isActive),
    [linkedAccounts, actAs.userId],
  );

  const scopeLevel = linked?.dataScopeLevel;
  const agencyId = linked?.subCompanyId;

  const selectedUserId = searchParams.get('userId') ?? '';
  const selectedManagerId = searchParams.get('managerId') ?? '';
  const userParamInUrl = searchParams.has('userId');
  const managerParamInUrl = searchParams.has('managerId');

  // Also set on the act-as hierarchy fetch path so the header is never stale.
  const nextHeader = actAs.userId;
  if (actAsHeader.get() !== nextHeader) {
    actAsHeader.set(nextHeader);
  }

  const teamQuery = useQuery({
    queryKey: ['act-as-team-members', actAs.userId],
    queryFn: fetchTeamMembers,
    enabled: !!actAs.isActive && isManagerLike(scopeLevel),
  });

  const agencyUsersQuery = useQuery({
    queryKey: ['act-as-scope-users', actAs.userId, agencyId],
    queryFn: () => fetchScopeFilterUsers(agencyId!),
    enabled: !!actAs.isActive && !!agencyId && isAgencyLike(scopeLevel),
  });

  if (!actAs.isActive || !linked) return null;
  if (!scopeLevel || scopeLevel === 'own') return null;

  const teamUsers: ApiUser[] = (teamQuery.data ?? []).filter((u) => u.id !== actAs.userId);
  const agencyUsers: ApiUser[] = agencyUsersQuery.data ?? [];

  const managers = agencyUsers.filter((u) => {
    const role = u.role;
    return (
      role === 'sales_manager' ||
      role === 'recruitment_manager' ||
      role === 'operations_manager'
    );
  });

  const associatesForManager = (managerId: string) =>
    agencyUsers.filter(
      (u) =>
        Array.isArray(u.reportingManagerIds) &&
        u.reportingManagerIds.includes(managerId),
    );

  function setParam(key: 'managerId' | 'userId', value: string | null) {
    setSearchParams((p) => {
      if (!value || value === 'all') p.delete(key);
      else p.set(key, value);
      if (key === 'managerId') p.delete('userId');
      return p;
    });
  }

  if (isManagerLike(scopeLevel)) {
    if (teamQuery.isLoading) {
      return <p className="text-xs text-muted-foreground py-1">Loading team filters…</p>;
    }
    if (teamUsers.length === 0) return null;
    return (
      <div className="space-y-1 mt-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          {actAs.firstName}&apos;s Team
        </p>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <TabChipText
            label="All Team"
            active={userParamInUrl && selectedUserId === 'all'}
            onClick={() => setParam('userId', selectedUserId === 'all' ? null : 'all')}
          />
          {teamUsers.map((u) => (
            <TabChipUser
              key={u.id}
              firstName={u.firstName}
              lastName={u.lastName}
              roleTitle={getUserRoleTitle(u)}
              country={u.country}
              active={selectedUserId === u.id}
              onClick={() => setParam('userId', selectedUserId === u.id ? null : u.id)}
            />
          ))}
        </div>
      </div>
    );
  }

  if (isAgencyLike(scopeLevel)) {
    if (agencyUsersQuery.isLoading) {
      return <p className="text-xs text-muted-foreground py-1">Loading filters…</p>;
    }
    const showTeamRow =
      managerParamInUrl &&
      selectedManagerId &&
      selectedManagerId !== 'all' &&
      selectedManagerId !== 'me';
    const teamForManager = showTeamRow ? associatesForManager(selectedManagerId) : [];

    return (
      <div className="space-y-1 mt-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          {actAs.firstName}&apos;s Managers
        </p>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <TabChipText
            label="All Managers"
            active={managerParamInUrl && selectedManagerId === 'all'}
            onClick={() => setParam('managerId', selectedManagerId === 'all' ? null : 'all')}
          />
          {managers.map((u) => (
            <TabChipUser
              key={u.id}
              firstName={u.firstName}
              lastName={u.lastName}
              roleTitle={getUserRoleTitle(u)}
              country={u.country}
              active={selectedManagerId === u.id}
              onClick={() => setParam('managerId', selectedManagerId === u.id ? null : u.id)}
            />
          ))}
        </div>
        {showTeamRow && teamForManager.length > 0 && (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Team</p>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {teamForManager.map((u) => (
                <TabChipUser
                  key={u.id}
                  firstName={u.firstName}
                  lastName={u.lastName}
                  roleTitle={getUserRoleTitle(u)}
                  country={u.country}
                  active={selectedUserId === u.id}
                  onClick={() => setParam('userId', selectedUserId === u.id ? null : u.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  return null;
}
