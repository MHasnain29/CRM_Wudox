import { useMemo, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TabChipText, TabChipUser } from '@/components/TabChip';
import { useLinkedAccounts } from '@/hooks/useLinkedAccounts';
import { useStore } from '@/lib/store';
import type { LinkedAccount } from '@/lib/api';

export function LinkedUserAgencyFilter() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Row 1 selection stored in URL — persists across page navigation
  // empty = own (unselected) | 'all' = All linked | 'own' = own agency chip | agencyId = linked agency
  const linkedScope = searchParams.get('linkedScope') ?? '';
  const linkedUserIdParam = searchParams.get('linkedUserId') ?? '';
  const activeLinkedIds = useMemo(
    () => (linkedUserIdParam ? linkedUserIdParam.split(',').filter(Boolean) : []),
    [linkedUserIdParam]
  );

  const currentUser = useStore((s) => s.currentUser);
  const currentSubCompany = useStore((s) => s.currentSubCompany);

  const { data: linkedAccounts = [], isLoading } = useLinkedAccounts();

  const activeLinked = useMemo(() => linkedAccounts.filter((a) => a.isActive), [linkedAccounts]);

  const allUsersIds = useMemo(
    () => (currentUser ? [currentUser.id, ...activeLinked.map((a) => a.userId)] : []),
    [currentUser, activeLinked]
  );

  const scopeByUserId = useMemo(() => {
    const map = new Map<string, LinkedAccount['dataScopeLevel']>();
    for (const a of activeLinked) map.set(a.userId, a.dataScopeLevel);
    return map;
  }, [activeLinked]);

  const clearToOwn = useCallback(() => {
    setSearchParams((p) => {
      p.delete('linkedScope');
      p.delete('linkedUserId');
      p.delete('leaderId');
      p.delete('managerId');
      p.delete('userId');
      return p;
    });
  }, [setSearchParams]);

  const setScope = useCallback(
    (scope: string, ids: string[]) => {
      setSearchParams((p) => {
        p.set('linkedScope', scope);
        if (ids.length === 0) p.delete('linkedUserId');
        else p.set('linkedUserId', ids.join(','));
        // Leaving linked mode / switching person: clear hierarchy drill so caller params don't leak.
        p.delete('leaderId');
        p.delete('managerId');
        p.delete('userId');
        return p;
      });
    },
    [setSearchParams],
  );

  // Stale linked user → unselected own (not All).
  useEffect(() => {
    if (isLoading || activeLinkedIds.length === 0 || !currentUser) return;
    const validIds = new Set(allUsersIds);
    const hasStale = activeLinkedIds.some((id) => !validIds.has(id));
    if (hasStale) clearToOwn();
  }, [linkedUserIdParam, activeLinked.length, currentUser?.id, isLoading, allUsersIds, activeLinkedIds, clearToOwn]);

  if (isLoading || !currentUser || !currentSubCompany) return null;
  if (activeLinked.length === 0) return null;

  // Agency → country map: use the first linked user's country as the agency's flag
  const linkedAgencyMap = new Map<string, { name: string; country: string }>();
  for (const a of activeLinked) {
    if (a.subCompanyId === currentSubCompany?.id) continue;
    if (!linkedAgencyMap.has(a.subCompanyId)) linkedAgencyMap.set(a.subCompanyId, { name: a.subCompanyName, country: a.country });
  }

  const row2Users =
    linkedScope === 'all'
      ? activeLinked.map((a) => ({
          userId: a.userId,
          firstName: a.firstName,
          lastName: a.lastName,
          agencyName: a.subCompanyName,
          country: a.country,
          dataScopeLevel: a.dataScopeLevel,
        }))
      : linkedScope && linkedScope !== 'own'
        ? activeLinked
            .filter((a) => a.subCompanyId === linkedScope)
            .map((a) => ({
              userId: a.userId,
              firstName: a.firstName,
              lastName: a.lastName,
              agencyName: a.subCompanyName,
              country: a.country,
              dataScopeLevel: a.dataScopeLevel,
            }))
        : [];

  // "All linked" is only truly active when the full group is selected. In act-as mode
  // (linkedScope=all but exactly one linked user picked) the single-user chip is the
  // accurate indicator — don't light up "All linked" too, and let clicking it re-expand.
  const isAllLinkedActive = linkedScope === 'all' && activeLinkedIds.length !== 1;
  const isOwnAgencyActive = linkedScope === 'own';

  /** Person subtitle: scope hint only — agency already shown in row 1 (avoid duplicate names). */
  function personSubtitle(user: {
    userId: string;
    dataScopeLevel?: LinkedAccount['dataScopeLevel'];
  }): string {
    const level = user.dataScopeLevel ?? scopeByUserId.get(user.userId);
    if (level === 'team') return 'Team';
    if (level === 'agency' || level === 'global') return 'Agency';
    return '';
  }

  return (
    <div className="space-y-1">
      {/* Row 1 — Agency chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        <TabChipText
          label="All linked accounts"
          active={isAllLinkedActive}
          onClick={() => {
            if (isAllLinkedActive) clearToOwn();
            else setScope('all', allUsersIds);
          }}
        />

        <TabChipText
          label={currentSubCompany.name}
          country={currentUser.country as string}
          active={isOwnAgencyActive}
          onClick={() => {
            if (isOwnAgencyActive) clearToOwn();
            else setScope('own', []);
          }}
        />

        {Array.from(linkedAgencyMap.entries()).map(([agencyId, agency]) => {
          const usersInAgency = activeLinked.filter((a) => a.subCompanyId === agencyId);
          const active = linkedScope === agencyId;
          return (
            <TabChipText
              key={agencyId}
              label={agency.name}
              country={agency.country}
              active={active}
              onClick={() => {
                if (active) clearToOwn();
                else setScope(agencyId, usersInAgency.map((u) => u.userId));
              }}
            />
          );
        })}
      </div>

      {/* Row 2 — other linked users only (no You). Hidden until a linked scope is selected. */}
      {!isOwnAgencyActive && linkedScope !== '' && row2Users.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {row2Users.map((user) => {
            const isUserActive = activeLinkedIds.length === 1 && activeLinkedIds[0] === user.userId;
            const subtitle = personSubtitle(user);
            return (
              <TabChipUser
                key={user.userId}
                firstName={user.firstName}
                lastName={user.lastName}
                roleTitle={subtitle}
                country={user.country}
                active={isUserActive}
                onClick={() => {
                  if (isUserActive) {
                    clearToOwn();
                  } else {
                    setSearchParams((p) => {
                      p.set('linkedUserId', user.userId);
                      if (!p.get('linkedScope')) p.set('linkedScope', 'all');
                      p.delete('leaderId');
                      p.delete('managerId');
                      p.delete('userId');
                      return p;
                    });
                  }
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
