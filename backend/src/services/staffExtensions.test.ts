import {
  assignExtensionIfMissing,
  collectReservedExtensions,
  nextAvailableStaffExtension,
  shouldAssignStaffExtension,
  STAFF_EXTENSION_START,
} from './staffExtensions';

describe('staffExtensions', () => {
  it('shouldAssignStaffExtension is false for org-wide roles', () => {
    expect(shouldAssignStaffExtension('super_admin', 'agency-1')).toBe(false);
    expect(shouldAssignStaffExtension('director', null)).toBe(false);
    expect(shouldAssignStaffExtension('operations_manager', 'agency-1')).toBe(false);
    expect(shouldAssignStaffExtension('database_manager', null)).toBe(false);
    expect(shouldAssignStaffExtension('data_entry_specialist', 'agency-1')).toBe(false);
  });

  it('shouldAssignStaffExtension is true for agency-scoped users', () => {
    expect(shouldAssignStaffExtension('sales_associate', 'agency-1')).toBe(true);
    expect(shouldAssignStaffExtension('company_director', 'agency-1')).toBe(true);
    expect(shouldAssignStaffExtension('sales_associate', null)).toBe(false);
  });

  it('nextAvailableStaffExtension starts at 101', () => {
    expect(nextAvailableStaffExtension(new Set())).toBe('101');
    expect(nextAvailableStaffExtension(new Set(), STAFF_EXTENSION_START)).toBe('101');
  });

  it('nextAvailableStaffExtension skips reserved numbers', () => {
    const reserved = collectReservedExtensions(
      [{ extension: '105' }],
      [{ extension: '106' }],
      [{ userId: 'u1', userName: 'A', extension: '101' }],
    );
    expect(nextAvailableStaffExtension(reserved)).toBe('102');
    reserved.add('102');
    reserved.add('103');
    reserved.add('104');
    expect(nextAvailableStaffExtension(reserved)).toBe('107');
  });

  it('assignExtensionIfMissing assigns 101 to first user', () => {
    const { updated, assigned } = assignExtensionIfMissing(
      [],
      'user-1',
      'Jane Doe',
      [],
      [],
    );
    expect(assigned).toBe('101');
    expect(updated).toEqual([{ userId: 'user-1', userName: 'Jane Doe', extension: '101' }]);
  });

  it('assignExtensionIfMissing respects ring-group reservation', () => {
    const { assigned } = assignExtensionIfMissing(
      [],
      'user-2',
      'Bob',
      [{ extension: '101' }],
      [],
    );
    expect(assigned).toBe('102');
  });

  it('assignExtensionIfMissing skips user who already has an extension', () => {
    const existing = [{ userId: 'user-1', userName: 'Jane', extension: '103' }];
    const { updated, assigned } = assignExtensionIfMissing(
      existing,
      'user-1',
      'Jane Doe',
      [],
      [],
    );
    expect(assigned).toBeNull();
    expect(updated).toBe(existing);
  });

  it('assignExtensionIfMissing does not reuse existing staff extensions', () => {
    const existing = [{ userId: 'user-1', userName: 'A', extension: '101' }];
    const { assigned } = assignExtensionIfMissing(existing, 'user-2', 'B', [], []);
    expect(assigned).toBe('102');
  });
});
