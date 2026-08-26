import { getRoleLabel, isLegacyMarketingTitle, MARKETING_ROLE_LABEL } from './permissions';

describe('marketing role display name', () => {
  it('labels the marketing role as Sales & Marketing Executive', () => {
    expect(getRoleLabel('marketing')).toBe(MARKETING_ROLE_LABEL);
    expect(getRoleLabel('sales_executive')).toBe('Sales Executive');
  });

  it('treats the old Marketing title as legacy for that role only', () => {
    expect(isLegacyMarketingTitle('marketing', 'Marketing')).toBe(true);
    expect(isLegacyMarketingTitle('marketing', 'Sales & Marketing Executive')).toBe(false);
    expect(isLegacyMarketingTitle('sales_associate', 'Marketing')).toBe(false);
  });
});
