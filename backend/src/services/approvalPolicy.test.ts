import {
  parseAgencyWorkflowsJson,
  DEFAULT_WORKFLOW_POLICIES,
  DEFAULT_ROLE_CAPABILITY_BY_KEY,
  mergeSystemRoleCapabilityDefaults,
} from './approvalPolicy';

describe('approvalPolicy', () => {
  it('parseAgencyWorkflowsJson merges defaults with route overrides', () => {
    const parsed = parseAgencyWorkflowsJson({
      client_manual_add: { mode: 'route', route: ['director'] },
      lead_request: { mode: 'bypass' },
    });
    expect(parsed.client_manual_add).toEqual({ mode: 'route', route: ['director'] });
    expect(parsed.lead_request).toEqual({ mode: 'bypass' });
    expect(parsed.client_import).toEqual(DEFAULT_WORKFLOW_POLICIES.client_import);
  });

  it('migrates legacy fixed_steps to explicit routes', () => {
    const parsed = parseAgencyWorkflowsJson({
      client_manual_add: { mode: 'fixed_steps', steps: 2 },
      lead_request: { mode: 'fixed_steps', steps: 1 },
    });
    expect(parsed.client_manual_add).toEqual({
      mode: 'route',
      route: ['sales_manager', 'company_director'],
    });
    expect(parsed.lead_request).toEqual({ mode: 'route', route: ['sales_manager'] });
  });

  it('migrates legacy full_hierarchy to manager-company-director route', () => {
    const parsed = parseAgencyWorkflowsJson({
      proposal_review: { mode: 'full_hierarchy' },
    });
    expect(parsed.proposal_review).toEqual({
      mode: 'route',
      route: ['sales_manager', 'company_director'],
    });
  });

  it('defaults use explicit routes', () => {
    expect(DEFAULT_WORKFLOW_POLICIES.client_manual_add).toEqual({
      mode: 'route',
      route: ['sales_manager', 'company_director'],
    });
    expect(DEFAULT_WORKFLOW_POLICIES.client_import).toEqual({
      mode: 'route',
      route: ['sales_manager', 'company_director'],
    });
    expect(DEFAULT_WORKFLOW_POLICIES.proposal_review).toEqual({
      mode: 'route',
      route: ['sales_manager', 'company_director'],
    });
    expect(DEFAULT_WORKFLOW_POLICIES.lead_request).toEqual({
      mode: 'route',
      route: ['sales_manager'],
    });
    expect(DEFAULT_WORKFLOW_POLICIES.lead_reassignment).toEqual({
      mode: 'route',
      route: ['sales_manager'],
    });
  });

  it('mergeWorkflowsWithDefaults fills missing workflows', async () => {
    const { mergeWorkflowsWithDefaults } = await import('./approvalPolicy');
    const merged = mergeWorkflowsWithDefaults({
      lead_request: { mode: 'bypass' },
    });
    expect(merged.lead_request).toEqual({ mode: 'bypass' });
    expect(merged.lead_reassignment).toEqual(DEFAULT_WORKFLOW_POLICIES.lead_reassignment);
  });

  it('company_director has forward_final on all workflows', () => {
    const caps = DEFAULT_ROLE_CAPABILITY_BY_KEY.company_director;
    expect(caps).toBeDefined();
    expect(Object.values(caps!)).toEqual(
      expect.arrayContaining(['forward_final']),
    );
  });

  it('mergeSystemRoleCapabilityDefaults fills missing database workflow capabilities', () => {
    const merged = mergeSystemRoleCapabilityDefaults('director', new Map([['client_manual_add', 'forward_final']]));
    expect(merged.get('client_manual_add')).toBe('forward_final');
    expect(merged.get('database_client_add')).toBe('forward_final');
    expect(merged.get('database_client_import')).toBe('forward_final');
  });

  it('validateOrgWorkflowsConfig allows bypass for global database workflows', async () => {
    const { validateOrgWorkflowsConfig } = await import('./approvalPolicy');
    const issues = await validateOrgWorkflowsConfig({
      database_client_add: { mode: 'bypass' },
      database_client_import: { mode: 'bypass' },
      database_contact_import: { mode: 'bypass' },
    });
    expect(issues).toEqual([]);
  });
});
