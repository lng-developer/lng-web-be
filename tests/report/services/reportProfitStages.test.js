const { profitStages } = require('../../../src/modules/report/services/reportProfitStages');
test('missing operating cost evidence preserves post-ads but not final profit', () => {
  expect(profitStages({ grossProfitAmount: 4999, operatingCostAmount: 0, operatingCostCoverage: 'MISSING' }, 1000))
    .toMatchObject({ profitAfterAdsAmount: 3999, profitAfterOperatingCostsAmount: null });
});
test('partial ads coverage does not produce complete post-ads profit', () => {
  expect(profitStages({ grossProfitAmount: 4999 }, 1000, false)).toMatchObject({ profitBeforeAdsAmount: 4999, profitAfterAdsAmount: null, adsCoverage: 'PARTIAL' });
});
test('reports deduct ads and operating costs once from persisted pre-ads profit', () => {
  expect(profitStages({ grossProfitAmount: 4999, refundAmount: 300, operatingCostAmount: 200 }, 1000))
    .toMatchObject({ profitBeforeAdsAmount: 4999, profitAfterAdsAmount: 3999, profitAfterOperatingCostsAmount: 3799 });
});
test('missing ads or missing profit stays unavailable; confirmed zero spend is valid', () => {
  expect(profitStages({ grossProfitAmount: 4999 }, null).profitAfterAdsAmount).toBeNull();
  expect(profitStages({ grossProfitAmount: 4999 }, 0).profitAfterAdsAmount).toBe(4999);
  expect(profitStages({ grossProfitAmount: null }, 1000).profitAfterAdsAmount).toBeNull();
});
