import {
  isRoleAncestorOf,
  isValidApprovalRouteStep,
  validateApprovalRouteHierarchy,
  buildParentKeyMap,
  findNextSeniorRoleKey,
  canSeniorOverrideTarget,
} from './roleHierarchy';

describe('roleHierarchy', () => {
  const roles = [
    { key: 'super_admin', name: 'Super Admin', parentKey: null },
    { key: 'director', name: 'Director', parentKey: 'super_admin' },
    { key: 'company_director', name: 'Company Director', parentKey: 'director' },
    { key: 'sales_manager', name: 'Sales Manager', parentKey: 'company_director' },
    { key: 'sales_associate', name: 'Sales Associate', parentKey: 'sales_manager' },
    { key: 'recruitment_manager', name: 'Recruitment Manager', parentKey: 'director' },
  ];

  it('isRoleAncestorOf walks parent chain', () => {
    const parentByKey = buildParentKeyMap(roles);
    expect(isRoleAncestorOf('company_director', 'sales_manager', parentByKey)).toBe(true);
    expect(isRoleAncestorOf('director', 'sales_manager', parentByKey)).toBe(true);
    expect(isRoleAncestorOf('sales_manager', 'sales_associate', parentByKey)).toBe(true);
    expect(isRoleAncestorOf('director', 'sales_associate', parentByKey)).toBe(true);
    expect(isRoleAncestorOf('sales_manager', 'director', parentByKey)).toBe(false);
    expect(isRoleAncestorOf('recruitment_manager', 'sales_manager', parentByKey)).toBe(false);
  });

  it('accepts junior to senior routes', () => {
    expect(validateApprovalRouteHierarchy(['sales_manager', 'company_director'], roles)).toEqual([]);
    expect(validateApprovalRouteHierarchy(['sales_associate', 'sales_manager', 'company_director'], roles)).toEqual([]);
    expect(validateApprovalRouteHierarchy(['sales_manager', 'director'], roles)).toEqual([]);
  });

  it('allows sales_manager to company_director via native ancestry', () => {
    const parentByKey = buildParentKeyMap(roles);
    expect(isValidApprovalRouteStep('sales_manager', 'company_director', parentByKey)).toBe(true);
    expect(isValidApprovalRouteStep('company_director', 'sales_manager', parentByKey)).toBe(false);
  });

  it('allows recruitment_manager to company_director via director-tier peer rule', () => {
    const parentByKey = buildParentKeyMap(roles);
    expect(isValidApprovalRouteStep('recruitment_manager', 'company_director', parentByKey)).toBe(true);
  });

  it('rejects senior before junior and sibling pairs', () => {
    const reversed = validateApprovalRouteHierarchy(['director', 'sales_manager'], roles);
    expect(reversed).toHaveLength(1);

    const siblings = validateApprovalRouteHierarchy(['sales_manager', 'recruitment_manager'], roles);
    expect(siblings).toHaveLength(1);
  });

  it('findNextSeniorRoleKey returns first ancestor not in route', () => {
    const parentByKey = buildParentKeyMap(roles);
    expect(findNextSeniorRoleKey('sales_manager', ['sales_manager'], parentByKey)).toBe('company_director');
    expect(findNextSeniorRoleKey('sales_associate', ['sales_associate'], parentByKey)).toBe('sales_manager');
  });

  it('canSeniorOverrideTarget for director-tier and super_admin', () => {
    const parentByKey = buildParentKeyMap(roles);
    expect(canSeniorOverrideTarget('super_admin', 'sales_manager', parentByKey)).toBe(true);
    expect(canSeniorOverrideTarget('director', 'sales_manager', parentByKey)).toBe(true);
    expect(canSeniorOverrideTarget('company_director', 'sales_manager', parentByKey)).toBe(true);
    expect(canSeniorOverrideTarget('company_director', 'company_director', parentByKey)).toBe(false);
    expect(canSeniorOverrideTarget('sales_manager', 'sales_associate', parentByKey)).toBe(false);
  });
});
