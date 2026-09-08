jest.mock('../../../src/modules/finance/models/financeSnapshot.model', () => ({ aggregate: jest.fn() }));
jest.mock('../../../src/modules/finance/models/adsSpendDaily.model', () => ({ aggregate: jest.fn() }));

const FinanceSnapshot = require('../../../src/modules/finance/models/financeSnapshot.model');
const AdsSpendDaily = require('../../../src/modules/finance/models/adsSpendDaily.model');
const repository = require('../../../src/modules/finance/repositories/financeSnapshot.repository');

describe('financeSnapshot.repository', () => {
  test('forwards the owning transaction session to snapshot upserts', async () => {
    const lean = jest.fn().mockResolvedValue({});
    FinanceSnapshot.findOneAndUpdate = jest.fn(() => ({ lean }));
    const session = { id: 'finance-session' };

    await repository.upsertByOrderItem('660000000000000000000201', { snapshotStatus: 'ESTIMATED' }, { session });

    expect(FinanceSnapshot.findOneAndUpdate).toHaveBeenCalledWith(
      { orderItemId: '660000000000000000000201' },
      { $set: { snapshotStatus: 'ESTIMATED' } },
      expect.objectContaining({ session }),
    );
  });
  test('keeps an empty scoped shop list as an empty database filter', () => {
    expect(repository.buildFilter({ shopIds: [] })).toEqual({ shopId: { $in: [] } });
  });

  test('uses order date rather than calculation time for ORDERED_AT profitability filters', () => {
    const dateFrom = new Date('2026-07-01T00:00:00.000Z');
    const dateTo = new Date('2026-07-31T23:59:59.999Z');

    expect(repository.buildFilter({ dateBasis: 'ORDERED_AT', dateFrom, dateTo })).toEqual({
      orderedAt: { $gte: dateFrom, $lte: dateTo },
    });
  });

  test('groups ORDERED_AT profitability by order date', async () => {
    FinanceSnapshot.aggregate.mockResolvedValueOnce([]);

    await repository.summarizeDaily({ dateBasis: 'ORDERED_AT' });

    const pipeline = FinanceSnapshot.aggregate.mock.calls.at(-1)[0];
    expect(pipeline.find((stage) => stage.$group).$group._id.date).toEqual({
      $dateToString: { format: '%Y-%m-%d', date: '$orderedAt' },
    });
  });

  test('counts distinct orders in each seller-day profitability row', async () => {
    FinanceSnapshot.aggregate.mockResolvedValueOnce([]);

    await repository.summarizeSellerDaily({ dateBasis: 'ORDERED_AT' });

    const pipeline = FinanceSnapshot.aggregate.mock.calls.at(-1)[0];
    const group = pipeline.find((stage) => stage.$group).$group;
    const project = pipeline.find((stage) => stage.$project).$project;

    expect(group.orderIds).toEqual({ $addToSet: '$orderId' });
    expect(project.orderCount).toEqual({ $size: '$orderIds' });
  });

  test('keeps missing selected dates outside the period coverage aggregate', async () => {
    FinanceSnapshot.aggregate
      .mockResolvedValueOnce([{ currency: 'USD', itemCount: 4, actualCount: 2, estimatedCount: 1, incompleteCostCount: 1 }])
      .mockResolvedValueOnce([{ currency: 'USD', missingDateCount: 3 }]);

    const result = await repository.summarizeQuality({
      dateBasis: 'ORDERED_AT',
      dateFrom: new Date('2026-09-01T00:00:00.000Z'),
      dateTo: new Date('2026-09-07T00:00:00.000Z'),
    });

    expect(result).toEqual([expect.objectContaining({ currency: 'USD', itemCount: 4, missingDateCount: 3 })]);
    expect(FinanceSnapshot.aggregate.mock.calls.at(-1)[0][0].$match).toEqual({ orderedAt: null });
  });

  test('summarizes filtered Order P&L by currency', async () => {
    FinanceSnapshot.aggregate.mockResolvedValueOnce([]);

    await repository.summarizeOrderPnl({
      salesChannelCode: 'AMAZON',
      costStatus: 'PRESENT',
    });

    expect(FinanceSnapshot.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      { $match: { salesChannelCode: 'AMAZON', costStatus: 'PRESENT' } },
      expect.objectContaining({
        $group: expect.objectContaining({
          _id: '$currency',
          revenueAmount: { $sum: '$customerPaidAmount' },
          marketplaceFeeAmount: { $sum: { $ifNull: ['$feeAmount', 0] } },
          refundAmount: { $sum: { $ifNull: ['$refundAmount', 0] } },
          discountAmount: { $sum: { $ifNull: ['$discountAmount', 0] } },
          baseCostAmount: { $sum: { $ifNull: ['$baseCostAmount', 0] } },
          totalCostAmount: { $sum: { $ifNull: ['$totalCostAmount', 0] } },
          orderIds: { $addToSet: '$orderId' },
          missingCostCount: {
            $sum: {
              $cond: [
                { $eq: [{ $ifNull: ['$totalCostAmount', null] }, null] },
                1,
                0,
              ],
            },
          },
        }),
      }),
      expect.objectContaining({
        $project: expect.objectContaining({
          _id: 0,
          currency: '$_id',
          orderCount: { $size: '$orderIds' },
          knownCostAmount: '$totalCostAmount',
          additionalFulfillmentCostAmount: expect.any(Object),
          totalDeductionAmount: expect.any(Object),
          profitAmount: expect.any(Object),
        }),
      }),
      { $sort: { currency: 1 } },
    ]));
  });

  test('ESTIMATED snapshot with null total cost makes fulfillment totals and profit unavailable', async () => {
    FinanceSnapshot.aggregate.mockResolvedValueOnce([]);

    await repository.summarizeOrderPnl();

    const pipeline = FinanceSnapshot.aggregate.mock.calls.at(-1)[0];
    const group = pipeline.find((stage) => stage.$group).$group;
    const project = pipeline.find((stage) => stage.$project).$project;

    expect(JSON.stringify(pipeline)).not.toContain('$snapshotStatus');
    expect(group.missingCostCount).toEqual({
      $sum: {
        $cond: [
          { $eq: [{ $ifNull: ['$totalCostAmount', null] }, null] },
          1,
          0,
        ],
      },
    });
    expect(project.totalCostAmount).toEqual({
      $cond: [{ $eq: ['$missingCostCount', 0] }, '$totalCostAmount', null],
    });
    expect(project.additionalFulfillmentCostAmount.$cond[2]).toBeNull();
    expect(project.totalDeductionAmount.$cond[2]).toBeNull();
    expect(project.profitAmount.$cond[2]).toBeNull();
  });

  test('daily profit aggregate keeps gross profit unavailable when any item lacks cost', async () => {
    FinanceSnapshot.aggregate.mockResolvedValueOnce([]);

    await repository.summarizeDaily();

    const pipeline = FinanceSnapshot.aggregate.mock.calls.at(-1)[0];
    const project = pipeline.find((stage) => stage.$project).$project;

    expect(project.grossProfitAmount).toEqual({
      $cond: [{ $eq: ['$missingCostCount', 0] }, '$grossProfitAmount', null],
    });
    expect(project.grossMarginBps.$cond[0]).toEqual({ $and: [
      { $eq: ['$missingCostCount', 0] },
      { $gt: ['$revenueAmount', 0] },
    ] });
  });

  test('summarizes ads daily by date, channel, marketplace, and currency', async () => {
    AdsSpendDaily.aggregate.mockResolvedValueOnce([]);

    await repository.summarizeAdsDaily({
      shopIds: ['660000000000000000000201'],
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      dateFrom: new Date('2026-07-01T00:00:00.000Z'),
      dateTo: new Date('2026-07-11T00:00:00.000Z'),
    });

    expect(AdsSpendDaily.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        $group: expect.objectContaining({
          _id: {
            reportDate: { $dateToString: { format: '%Y-%m-%d', date: '$reportDate' } },
            salesChannelCode: '$salesChannelCode',
            marketplaceCode: '$marketplaceCode',
            currency: '$currency',
          },
          spendAmount: { $sum: '$spendAmount' },
          attributedSalesAmount: { $sum: '$attributedSalesAmount' },
          impressions: { $sum: '$impressions' },
          clicks: { $sum: '$clicks' },
          attributedOrdersCount: { $sum: '$orders7d' },
        }),
      }),
      expect.objectContaining({ $sort: { reportDate: 1, salesChannelCode: 1, marketplaceCode: 1, currency: 1 } }),
    ]));
  });

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

  test('limits ads aggregates to permitted seller employee codes', async () => {
    AdsSpendDaily.aggregate.mockResolvedValueOnce([]);

    await repository.summarizeAdsBySeller({ sellerEmployeeCodes: ['J2501', 'J2502'] });

    expect(AdsSpendDaily.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      { $match: { sellerEmployeeCode: { $in: ['J2501', 'J2502'] } } },
    ]));
  });

  test('applies team seller scope as an OR branch beside any permitted shop scope', async () => {
    AdsSpendDaily.aggregate.mockResolvedValueOnce([]);

    await repository.summarizeAdsBySeller({
      adsAccessOr: [{ shopId: '660000000000000000000201' }, { sellerEmployeeCodes: ['J2501'] }],
    });

    const pipeline = AdsSpendDaily.aggregate.mock.calls.at(-1)[0];
    expect(pipeline[0].$match.$or[0].shopId.toString()).toBe('660000000000000000000201');
    expect(pipeline[0].$match.$or[1]).toEqual({ sellerEmployeeCode: { $in: ['J2501'] } });
  });

  test('summarizes seller ads by date, seller, and currency', async () => {
    AdsSpendDaily.aggregate.mockResolvedValueOnce([]);

    await repository.summarizeAdsSellerDaily({ shopId: '660000000000000000000201' });

    expect(AdsSpendDaily.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        $group: expect.objectContaining({
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$reportDate' } },
            sellerEmployeeCode: { $ifNull: ['$sellerEmployeeCode', 'UNASSIGNED'] },
            currency: '$currency',
          },
          spendAmount: { $sum: '$spendAmount' },
        }),
      }),
      expect.objectContaining({ $sort: { date: 1, sellerEmployeeCode: 1, currency: 1 } }),
    ]));
  });
});
