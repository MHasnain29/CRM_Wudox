import {
  getNextRoleInChain,
  isAtFinalApprovalStep,
  getCurrentTargetRole,
  isDirectApprovalOverride,
  initialStepIndexForSubmitter,
  resolveUserApprovalOptions,
} from './approvalChain';
import { getCapabilityMapForRoleKey } from './approvalPolicy';

jest.mock('./approvalPolicy', () => ({
  getCapabilityMapForRoleKey: jest.fn(),
}));

const mockGetCapabilityMapForRoleKey = getCapabilityMapForRoleKey as jest.MockedFunction<
  typeof getCapabilityMapForRoleKey
>;

function capabilityMap(workflow: string, mode: string) {
  return new Map([[workflow, mode]]) as Awaited<ReturnType<typeof getCapabilityMapForRoleKey>>;
}

describe('approvalChain helpers', () => {
  const entity = {
    chain: ['sales_manager', 'director'],
    currentStepIndex: 0,
  };

  it('isDirectApprovalOverride when senior acts before their step', () => {
    expect(isDirectApprovalOverride(entity.chain, 0, 'director')).toBe(true);
    expect(isDirectApprovalOverride(entity.chain, 0, 'sales_manager')).toBe(false);
    expect(isDirectApprovalOverride(entity.chain, 1, 'director')).toBe(false);
  });

  it('getCurrentTargetRole returns role at step index', () => {
    expect(getCurrentTargetRole(entity)).toBe('sales_manager');
    expect(getCurrentTargetRole({ ...entity, currentStepIndex: 1 })).toBe('director');
  });

  it('getNextRoleInChain returns following role', () => {
    expect(getNextRoleInChain(entity)).toBe('director');
    expect(getNextRoleInChain({ ...entity, currentStepIndex: 1 })).toBeNull();
  });

  it('isAtFinalApprovalStep is true only on last index', () => {
    expect(isAtFinalApprovalStep(entity)).toBe(false);
    expect(isAtFinalApprovalStep({ ...entity, currentStepIndex: 1 })).toBe(true);
  });

  it('initialStepIndexForSubmitter skips submitter role when a later approver exists', () => {
    expect(initialStepIndexForSubmitter(['sales_manager', 'director'], 'sales_manager')).toBe(1);
    expect(initialStepIndexForSubmitter(['sales_manager', 'director'], 'director')).toBe(0);
    expect(initialStepIndexForSubmitter(['sales_manager'], 'sales_manager')).toBe(0);
  });
});

describe('resolveUserApprovalOptions', () => {
  const baseEntity = {
    workflow: 'lead_request' as const,
    entityType: 'lead_requests',
    entityId: 'req-1',
    subCompanyId: 'agency-1',
    submitterRoleKey: 'sales_associate',
    submitterUserId: 'user-1',
    chain: ['sales_manager', 'director'],
    currentStepIndex: 0,
  };

  beforeEach(() => {
    mockGetCapabilityMapForRoleKey.mockReset();
  });

  it('shows forward (not reject) for intermediate target with forward permission only', async () => {
    mockGetCapabilityMapForRoleKey.mockResolvedValue(capabilityMap('lead_request', 'forward_only'));

    const options = await resolveUserApprovalOptions(
      'sales_manager',
      ['leads:manager_recommend'],
      baseEntity,
    );

    expect(options.allowedAction).toBe('forward');
    expect(options.canReject).toBe(false);
  });

  it('hides reject on intermediate step when user lacks forward permission but has final fallback', async () => {
    mockGetCapabilityMapForRoleKey.mockResolvedValue(capabilityMap('lead_request', 'forward_only'));

    const options = await resolveUserApprovalOptions(
      'sales_manager',
      ['leads:assign'],
      baseEntity,
    );

    expect(options.allowedAction).toBeNull();
    expect(options.canReject).toBe(false);
  });

  it('allows reject on final step with final permission', async () => {
    mockGetCapabilityMapForRoleKey.mockResolvedValue(capabilityMap('lead_request', 'forward_final'));

    const options = await resolveUserApprovalOptions(
      'director',
      ['leads:manager_recommend', 'leads:approve'],
      { ...baseEntity, currentStepIndex: 1 },
    );

    expect(options.allowedAction).toBe('approve');
    expect(options.canReject).toBe(true);
  });
});
