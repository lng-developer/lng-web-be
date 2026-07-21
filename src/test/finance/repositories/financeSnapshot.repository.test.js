jest.mock('../../../modules/finance/models/financeSnapshot.model', () => ({}));
jest.mock('../../../modules/finance/models/adsSpendDaily.model', () => ({ aggregate: jest.fn() }));

const AdsSpendDaily = require('../../../modules/finance/models/adsSpendDaily.model');
const repository = require('../../../modules/finance/repositories/financeSnapshot.repository');

describe('financeSnapshot.repository', () => {
  test('summarizes ads by seller and currency with an unassigned seller bucket', async () => {
    AdsSpendDaily.aggregate.mockResolvedValueOnce([]);

    await repository.summarizeAdsBySeller({
      shopId: '660000000000000000000201',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      dateFrom: new Date('2026-07-01T00:00:00.000Z'),
      dateTo: new Date('2026-07-11T00:00:00.000Z'),
    });

    expect(AdsSpendDaily.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        $group: expect.objectContaining({
          _id: {
            sellerEmployeeCode: { $ifNull: ['$sellerEmployeeCode', 'UNASSIGNED'] },
            currency: '$currency',
          },
          spendAmount: { $sum: '$spendAmount' },
          attributedSalesAmount: { $sum: '$attributedSalesAmount' },
          impressions: { $sum: '$impressions' },
          clicks: { $sum: '$clicks' },
          attributedOrdersCount: { $sum: '$orders7d' },
        }),
      }),
      expect.objectContaining({ $sort: { sellerEmployeeCode: 1, currency: 1 } }),
    ]));
  });
});
