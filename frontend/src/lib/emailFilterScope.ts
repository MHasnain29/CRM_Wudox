import type { ApiUser } from './api';
import type { ScopeFilterState } from '../hooks/useElevatedScopeFilter';

export const EMPTY_EMAIL_OWNER = '00000000-0000-0000-0000-000000000000';
export type EmailFilterKey = 'agencyId' | 'leaderId' | 'managerId' | 'userId';

/** Only the Emails page uses these transitions. Parent changes clear every child. */
export function changeEmailFilter(params: URLSearchParams, key: EmailFilterKey, value?: string) {
  const next = new URLSearchParams(params);
  if (value === undefined) next.delete(key);
  else next.set(key, value);
  const keys: EmailFilterKey[] = ['agencyId', 'leaderId', 'managerId', 'userId'];
  for (const child of keys.slice(keys.indexOf(key) + 1)) next.delete(child);
  return next;
}

export function resetEmailFilters(params: URLSearchParams) {
  const next = changeEmailFilter(params, 'agencyId', 'me');
  next.delete('linkedScope');
  next.delete('linkedUserId');
  return next;
}

function unique(users: ApiUser[]) {
  return [...new Map(users.map((user) => [user.id, user])).values()];
}

/** Follow actual reporting assignments, never another authority with the same role. */
function managersReportingTo(f: ScopeFilterState, leaderId: string) {
  const descendants = new Set([leaderId]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const user of f.agencyUsers) {
      if (!descendants.has(user.id) && user.reportingManagerIds?.some((id) => descendants.has(id))) {
        descendants.add(user.id);
        expanded = true;
      }
    }
  }
  return f.managers.filter((user) => user.id !== leaderId && descendants.has(user.id));
}

export function resolveEmailFilterScope(f: ScopeFilterState, currentUserId?: string) {
  const leaderSelected = f.leaderParamInUrl && f.selectedLeaderId !== 'all';
  const managerSelected = f.managerParamInUrl && f.selectedManagerId !== 'all';
  const teamSelected = f.userParamInUrl && f.selectedUserId !== 'all';
  const personId = (id: string) => id === 'me' ? currentUserId : id;
  const managers = leaderSelected
    ? managersReportingTo(f, personId(f.selectedLeaderId) ?? '')
    : f.managers;

  // A bare All Team includes unassigned members. A parent manager/authority
  // selection limits it to that parent's managers' teams, never the managers.
  const members = f.isPureManager
    ? f.associates
    : managerSelected
      ? f.getAssociatesForManager(personId(f.selectedManagerId) ?? '')
      : leaderSelected || f.managerParamInUrl
        ? unique(managers.flatMap((manager) => f.getAssociatesForManager(manager.id)))
        : f.associates;

  let owners: string[] | undefined;
  let sectionUsers: ApiUser[] = [];
  let peopleMode: 'managers' | 'team' | undefined;
  if (teamSelected) {
    owners = [personId(f.selectedUserId) ?? EMPTY_EMAIL_OWNER];
  } else if (f.userParamInUrl) {
    sectionUsers = members;
    peopleMode = 'team';
    owners = members.map((user) => user.id);
  } else if (managerSelected) {
    owners = [personId(f.selectedManagerId) ?? EMPTY_EMAIL_OWNER];
  } else if (f.managerParamInUrl) {
    sectionUsers = managers;
    peopleMode = 'managers';
    owners = managers.map((user) => user.id);
  } else if (leaderSelected) {
    owners = [personId(f.selectedLeaderId) ?? EMPTY_EMAIL_OWNER];
  } else if (f.leaderParamInUrl) {
    owners = f.tiers.find((tier) => tier.paramKey === 'leaderId')?.users.map((user) => user.id) ?? [];
  } else {
    // Single-agency home context is hidden, so it never counts as a selected chip.
    const explicitAgency = !f.isPureManager && !f.isSingleAgencyLead &&
      !f.isAgencyScopedElevated && f.agencies.length > 1 &&
      !!f.selectedAgencyId && f.selectedAgencyId !== 'me';
    owners = explicitAgency ? undefined : [currentUserId ?? EMPTY_EMAIL_OWNER];
  }

  const ownDefault = !f.leaderParamInUrl && !f.managerParamInUrl && !f.userParamInUrl &&
    owners?.length === 1 && owners[0] === currentUserId;
  const agencyIds = !ownDefault && f.selectedAgencyId &&
    f.selectedAgencyId !== 'all' && f.selectedAgencyId !== 'me'
    ? [f.selectedAgencyId] : undefined;

  return {
    ownerIds: owners?.length === 0 ? [EMPTY_EMAIL_OWNER] : owners,
    agencyIds,
    members,
    managers,
    peopleMode,
    sectionUsers: [...sectionUsers].sort((a, b) =>
      `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)),
  };
}
