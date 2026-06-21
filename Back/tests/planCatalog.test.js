const { normalizePlan, getPlanDetails } = require('../src/utils/planCatalog');

describe('planCatalog', () => {
  test('normalizePlan maps legacy values', () => {
    expect(normalizePlan('chill')).toBe('free');
    expect(normalizePlan('pro')).toBe('pro_plus');
    expect(normalizePlan('gratis')).toBe('free');
  });

  test('getPlanDetails returns configured benefits', () => {
    const details = getPlanDetails('pro_plus');
    expect(details.key).toBe('pro_plus');
    expect(details.benefits.length).toBeGreaterThan(0);
  });
});
