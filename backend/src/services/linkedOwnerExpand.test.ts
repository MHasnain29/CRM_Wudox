import type { DataScopeLevel } from '@prisma/client';

const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();
const mockUserFindMany = jest.fn();

jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    userAgencyLink: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
    user: {
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
    },
  },
}));

const mockGetScope = jest.fn();
const mockGetPerms = jest.fn();
jest.mock('./rbac', () => ({
  getDataScopeLevelForRoleKey: (...args: unknown[]) => mockGetScope(...args),
  getEffectivePermissionKeysForRoleKey: (...args: unknown[]) => mockGetPerms(...args),
}));

import { expandLinkedOwnerScope, linkedExpansionToWhere } from './linkedOwnerExpand';

const CALLER = 'caller-1';
const CALLER_AGENCY = 'agency-ca';
const LINKED_MGR = 'sara-1';
const LINKED_ASSOC = 'ben-1';
const SARA_AGENCY = 'agency-us';
const BEN_AGENCY = 'agency-uk';
const REPORT = 'report-1';

describe('expandLinkedOwnerScope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPerms.mockResolvedValue([]);
  });

  function stubLinkGroup(matched: { userId: string; subCompanyId: string }[]) {
    mockFindFirst.mockResolvedValue({ groupId: 'g1' });
    mockFindMany.mockResolvedValue(
      matched.map((m) => ({
        userId: m.userId,
        user: { subCompanyId: m.subCompanyId },
      })),
    );
  }

  function stubUsers(
    users: { id: string; role: string; subCompanyId: string }[],
    reports: { id: string }[] = [],
  ) {
    mockUserFindMany.mockImplementation(async (args: { where?: { id?: { in?: string[] }; reportingManagerIds?: { has?: string } } }) => {
      if (args?.where?.reportingManagerIds?.has) {
        return reports;
      }
      const ids = args?.where?.id?.in ?? [];
      return users.filter((u) => ids.includes(u.id));
    });
  }

  function stubScope(map: Record<string, DataScopeLevel>) {
    mockGetScope.mockImplementation(async (role: string) => map[role] ?? 'own');
  }

  it('returns null for empty requested ids', async () => {
    expect(await expandLinkedOwnerScope(CALLER, CALLER_AGENCY, [])).toBeNull();
  });

  it('returns null when ids are not in the link group', async () => {
    mockFindFirst.mockResolvedValue({ groupId: 'g1' });
    mockFindMany.mockResolvedValue([]);
    expect(await expandLinkedOwnerScope(CALLER, CALLER_AGENCY, ['stranger'])).toBeNull();
  });

  it('associate↔associate → mode owners with two IDs', async () => {
    stubLinkGroup([{ userId: LINKED_ASSOC, subCompanyId: BEN_AGENCY }]);
    stubUsers([
      { id: CALLER, role: 'sales_associate', subCompanyId: CALLER_AGENCY },
      { id: LINKED_ASSOC, role: 'sales_associate', subCompanyId: BEN_AGENCY },
    ]);
    stubScope({ sales_associate: 'own' });

    const exp = await expandLinkedOwnerScope(CALLER, CALLER_AGENCY, [CALLER, LINKED_ASSOC]);
    expect(exp).toMatchObject({
      mode: 'owners',
      userIds: expect.arrayContaining([CALLER, LINKED_ASSOC]),
      subCompanyIds: expect.arrayContaining([CALLER_AGENCY, BEN_AGENCY]),
    });
    expect(exp!.userIds).toHaveLength(2);
  });

  it('manager expands to self + reports', async () => {
    stubLinkGroup([{ userId: LINKED_MGR, subCompanyId: SARA_AGENCY }]);
    stubUsers(
      [{ id: LINKED_MGR, role: 'sales_manager', subCompanyId: SARA_AGENCY }],
      [{ id: REPORT }],
    );
    stubScope({ sales_manager: 'team' });

    const exp = await expandLinkedOwnerScope(CALLER, CALLER_AGENCY, [LINKED_MGR]);
    expect(exp?.mode).toBe('owners');
    expect(exp?.userIds).toEqual(expect.arrayContaining([LINKED_MGR, REPORT]));
    expect(exp?.subCompanyIds).toEqual([SARA_AGENCY]);
  });

  it('All linked two managers → union of teams', async () => {
    stubLinkGroup([{ userId: LINKED_MGR, subCompanyId: SARA_AGENCY }]);
    stubUsers(
      [
        { id: CALLER, role: 'sales_manager', subCompanyId: CALLER_AGENCY },
        { id: LINKED_MGR, role: 'sales_manager', subCompanyId: SARA_AGENCY },
      ],
      [{ id: REPORT }],
    );
    stubScope({ sales_manager: 'team' });

    // teamMemberIds calls user.findMany per manager; return report only for Sara for simplicity
    mockUserFindMany.mockImplementation(async (args: { where?: { id?: { in?: string[] }; reportingManagerIds?: { has?: string } } }) => {
      if (args?.where?.reportingManagerIds?.has === LINKED_MGR) return [{ id: REPORT }];
      if (args?.where?.reportingManagerIds?.has === CALLER) return [{ id: 'ali-report' }];
      const ids = args?.where?.id?.in ?? [];
      return [
        { id: CALLER, role: 'sales_manager', subCompanyId: CALLER_AGENCY },
        { id: LINKED_MGR, role: 'sales_manager', subCompanyId: SARA_AGENCY },
      ].filter((u) => ids.includes(u.id));
    });

    const exp = await expandLinkedOwnerScope(CALLER, CALLER_AGENCY, [CALLER, LINKED_MGR]);
    expect(exp?.mode).toBe('owners');
    expect(exp?.userIds).toEqual(expect.arrayContaining([CALLER, 'ali-report', LINKED_MGR, REPORT]));
    expect(exp?.subCompanyIds).toEqual(expect.arrayContaining([CALLER_AGENCY, SARA_AGENCY]));
  });

  it('director/agency user → mode agencies (no owner dump)', async () => {
    stubLinkGroup([{ userId: LINKED_MGR, subCompanyId: SARA_AGENCY }]);
    stubUsers([{ id: LINKED_MGR, role: 'company_director', subCompanyId: SARA_AGENCY }]);
    stubScope({ company_director: 'agency' });

    const exp = await expandLinkedOwnerScope(CALLER, CALLER_AGENCY, [LINKED_MGR]);
    expect(exp).toEqual({
      mode: 'agencies',
      userIds: [],
      ownerSubCompanyIds: [],
      agencySubCompanyIds: [SARA_AGENCY],
      subCompanyIds: [SARA_AGENCY],
    });
  });

  it('mixed manager + director → mode mixed', async () => {
    stubLinkGroup([
      { userId: LINKED_MGR, subCompanyId: SARA_AGENCY },
      { userId: 'dir-1', subCompanyId: 'agency-dir' },
    ]);
    mockUserFindMany.mockImplementation(async (args: { where?: { id?: { in?: string[] }; reportingManagerIds?: { has?: string } } }) => {
      if (args?.where?.reportingManagerIds?.has === LINKED_MGR) return [{ id: REPORT }];
      const ids = args?.where?.id?.in ?? [];
      return [
        { id: LINKED_MGR, role: 'sales_manager', subCompanyId: SARA_AGENCY },
        { id: 'dir-1', role: 'company_director', subCompanyId: 'agency-dir' },
      ].filter((u) => ids.includes(u.id));
    });
    stubScope({ sales_manager: 'team', company_director: 'agency' });

    const exp = await expandLinkedOwnerScope(CALLER, CALLER_AGENCY, [LINKED_MGR, 'dir-1']);
    expect(exp?.mode).toBe('mixed');
    expect(exp?.userIds).toEqual(expect.arrayContaining([LINKED_MGR, REPORT]));
    expect(exp?.agencySubCompanyIds).toEqual(['agency-dir']);
    expect(exp?.ownerSubCompanyIds).toEqual([SARA_AGENCY]);
  });
});

describe('linkedExpansionToWhere', () => {
  it('owners mode ANDs owner + agency', () => {
    expect(
      linkedExpansionToWhere({
        mode: 'owners',
        userIds: ['a'],
        ownerSubCompanyIds: ['x'],
        agencySubCompanyIds: [],
        subCompanyIds: ['x'],
      }),
    ).toEqual({ ownerId: { in: ['a'] }, subCompanyId: { in: ['x'] } });
  });

  it('agencies mode filters only by subCompanyId', () => {
    expect(
      linkedExpansionToWhere({
        mode: 'agencies',
        userIds: [],
        ownerSubCompanyIds: [],
        agencySubCompanyIds: ['x'],
        subCompanyIds: ['x'],
      }),
    ).toEqual({ subCompanyId: { in: ['x'] } });
  });

  it('mixed mode ORs owner branch and agency branch', () => {
    expect(
      linkedExpansionToWhere({
        mode: 'mixed',
        userIds: ['a'],
        ownerSubCompanyIds: ['x'],
        agencySubCompanyIds: ['y'],
        subCompanyIds: ['x', 'y'],
      }),
    ).toEqual({
      OR: [
        { ownerId: { in: ['a'] }, subCompanyId: { in: ['x'] } },
        { subCompanyId: { in: ['y'] } },
      ],
    });
  });
});
