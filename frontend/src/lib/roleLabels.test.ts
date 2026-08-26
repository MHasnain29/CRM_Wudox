import { describe, expect, it } from 'vitest';
import { getRoleLabel, getUserRoleTitle } from './roleLabels';
import { MARKETING_ROLE_LABEL, ROLE_OPTIONS } from './roleOptions';
import type { AssignableRoleOption } from '@/lib/rbacApi';

describe('marketing role display name', () => {
  it('uses Sales & Marketing Executive in the static catalog', () => {
    expect(ROLE_OPTIONS.find((o) => o.role === 'marketing')?.label).toBe(MARKETING_ROLE_LABEL);
    expect(getRoleLabel('marketing')).toBe(MARKETING_ROLE_LABEL);
  });

  it('replaces a stale RBAC name of Marketing', () => {
    const assignableRoles = [
      { key: 'marketing', name: 'Marketing', scopeLevel: 'own', sortOrder: 13, isSystem: true, parentKey: 'sales_manager' },
    ] as AssignableRoleOption[];
    expect(getRoleLabel('marketing', assignableRoles)).toBe(MARKETING_ROLE_LABEL);
  });

  it('maps a leftover userType of Marketing to the new title', () => {
    expect(
      getUserRoleTitle({ role: 'marketing', userType: 'Marketing' }),
    ).toBe(MARKETING_ROLE_LABEL);
    expect(
      getUserRoleTitle({ role: 'marketing', userType: 'Brand Manager' }),
    ).toBe('Brand Manager');
  });
});
