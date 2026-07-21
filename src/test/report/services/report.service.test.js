jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../modules/finance/public', () => ({
  summarizeBySeller: jest.fn(),
  summarizeByTeam: jest.fn(),
  summarizeDaily: jest.fn(),
  summarizeDailyProfit: jest.fn(),
  summarizeAdsByChannel: jest.fn(),
  summarizeAdsBySeller: jest.fn(),
  summarizeAdsDaily: jest.fn(),
}));

jest.mock('../../../modules/order/public', () => ({
  summarizeBuyerInsights: jest.fn(),
  summarizeNewBuyersByChannel: jest.fn(),
  summarizeOrderItems: jest.fn(),
}));

jest.mock('../../../modules/production/public', () => ({
  summarizeTasks: jest.fn(),
}));

jest.mock('../../../modules/shipment/public', () => ({
  summarizeShippedByOrderItemIds: jest.fn(),
  summarizeShipments: jest.fn(),
}));

jest.mock('../../../modules/vendorSubmission/public', () => ({
  summarizePerformance: jest.fn(),
  summarizePerformancePage: jest.fn(),
}));

const authPublic = require('../../../modules/auth/public');
const financePublic = require('../../../modules/finance/public');
const orderPublic = require('../../../modules/order/public');
const productionPublic = require('../../../modules/production/public');
const shipmentPublic = require('../../../modules/shipment/public');
const vendorSubmissionPublic = require('../../../modules/vendorSubmission/public');
const service = require('../../../modules/report/services/report.service');

describe('report.service', () => {
  const shopId = '660000000000000000000201';
  const scopedAuth = {
    permissions: [],
    scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['REPORTS:READ'] }],
  };

  beforeEach(() => {
    jest.resetAllMocks();
    authPublic.canAccessScope.mockReturnValue(true);
    financePublic.summarizeDaily.mockResolvedValue([]);
    financePublic.summarizeDailyProfit.mockResolvedValue([]);
    financePublic.summarizeAdsByChannel.mockResolvedValue([]);
    financePublic.summarizeAdsBySeller.mockResolvedValue([]);
    financePublic.summarizeBySeller.mockResolvedValue([]);
    financePublic.summarizeByTeam.mockResolvedValue([]);
    orderPublic.summarizeBuyerInsights.mockResolvedValue({});
    orderPublic.summarizeNewBuyersByChannel.mockResolvedValue([]);
    orderPublic.summarizeOrderItems.mockResolvedValue({});
    productionPublic.summarizeTasks.mockResolvedValue({});
    shipmentPublic.summarizeShippedByOrderItemIds.mockResolvedValue({});
    shipmentPublic.summarizeShipments.mockResolvedValue({});
    vendorSubmissionPublic.summarizePerformance.mockResolvedValue([]);
    vendorSubmissionPublic.summarizePerformancePage.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 100,
    });
  });

  test('finance daily scopes shop users and maps compact totals', async () => {
    financePublic.summarizeDaily.mockResolvedValueOnce([{
      date: '2026-07-11',
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      itemCount: 2,
      revenueAmount: 10000,
      baseCostAmount: 4000,
      grossProfitAmount: 5000,
      grossMarginBps: 5000,
      missingCostCount: 0,
      currency: 'USD',
    }]);

    const result = await service.getFinanceDaily({}, scopedAuth);

    expect(financePublic.summarizeDaily).toHaveBeenCalledWith(
      { shopIds: [shopId] },
      expect.objectContaining({ system: true, source: 'REPORT' }),
    );
    expect(result).toEqual([expect.objectContaining({
      date: '2026-07-11',
      itemCount: 2,
      revenueAmount: 10000,
      grossProfitAmount: 5000,
    })]);
  });

  test('daily profit keeps currencies separate and includes ad spend in net profit', async () => {
    financePublic.summarizeDailyProfit.mockResolvedValueOnce([{
      date: '2026-07-11',
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      currency: 'USD',
      itemCount: 2,
      revenueAmount: 10000,
      baseCostAmount: 4000,
      grossProfitAmount: 5000,
      adSpendAmount: 1250,
      netProfitAmount: 3750,
      netMarginBps: 3750,
      missingCostCount: 0,
    }, {
      date: '2026-07-11',
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      currency: 'CAD',
      itemCount: 1,
      revenueAmount: 8000,
      baseCostAmount: 3000,
      grossProfitAmount: 3500,
      adSpendAmount: 0,
      netProfitAmount: 3500,
      netMarginBps: 4375,
      missingCostCount: 0,
    }]);

    const result = await service.getFinanceDailyProfit({}, scopedAuth);

    expect(financePublic.summarizeDailyProfit).toHaveBeenCalledWith(
      { shopIds: [shopId] },
      expect.objectContaining({ system: true, source: 'REPORT' }),
    );
    expect(result).toEqual([
      expect.objectContaining({ currency: 'USD', adSpendAmount: 1250, netProfitAmount: 3750, netMarginBps: 3750 }),
      expect.objectContaining({ currency: 'CAD', adSpendAmount: 0, netProfitAmount: 3500, netMarginBps: 4375 }),
    ]);
  });

  test('out-of-scope explicit shop returns empty report', async () => {
    authPublic.canAccessScope.mockReturnValueOnce(false);

    const result = await service.getFinanceDaily({
      shopId: '660000000000000000000202',
    }, scopedAuth);

    expect(result).toEqual([]);
    expect(financePublic.summarizeDaily).not.toHaveBeenCalled();
  });

  test('finance by seller scopes query and maps seller totals', async () => {
    financePublic.summarizeBySeller.mockResolvedValueOnce([{
      sellerEmployeeCode: 'J2508',
      sellerAccountId: '660000000000000000000901',
      sellerName: 'J2508 Seller',
      currency: 'USD',
      itemCount: 3,
      revenueAmount: 12000,
      baseCostAmount: 5000,
      grossProfitAmount: 6000,
      operatingCostAmount: 3000,
      operatingCostDays: 1,
      netProfitAmount: 3000,
      netMarginBps: 2500,
      grossMarginBps: 5000,
      missingCostCount: 0,
    }]);

    const result = await service.getFinanceBySeller({}, scopedAuth);

    expect(financePublic.summarizeBySeller).toHaveBeenCalledWith(
      { shopIds: [shopId] },
      expect.objectContaining({ system: true, source: 'REPORT' }),
    );
    expect(result).toEqual([expect.objectContaining({
      sellerEmployeeCode: 'J2508',
      sellerName: 'J2508 Seller',
      itemCount: 3,
      grossProfitAmount: 6000,
      operatingCostAmount: 3000,
      netProfitAmount: 3000,
    })]);
  });

  test('finance by team allows null team bucket', async () => {
    financePublic.summarizeByTeam.mockResolvedValueOnce([{
      teamId: null,
      teamName: null,
      teamCode: null,
      currency: 'USD',
      itemCount: 1,
      revenueAmount: 1000,
      baseCostAmount: 400,
      grossProfitAmount: 500,
      grossMarginBps: 5000,
      missingCostCount: 0,
    }]);

    const result = await service.getFinanceByTeam({}, { permissions: ['REPORTS:READ'] });

    expect(financePublic.summarizeByTeam).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ system: true, source: 'REPORT' }),
    );
    expect(result).toEqual([expect.objectContaining({
      teamId: null,
      itemCount: 1,
      grossProfitAmount: 500,
    })]);
  });

  test('vendor performance adds shipped count and success rate', async () => {
    vendorSubmissionPublic.summarizePerformancePage.mockResolvedValueOnce({
      items: [{
      _id: '660000000000000000000301',
      vendorCode: 'BEEFUL',
      vendorName: 'Beeful',
      orderItemIds: ['660000000000000000000401'],
      readyCount: 1,
      submittedCount: 3,
      failedCount: 1,
      cancelledCount: 1,
      avgProcessingMs: 7200000,
    }, {
      _id: '660000000000000000000302',
      vendorCode: 'MANGOTEE',
      vendorName: 'Mangotee',
      orderItemIds: ['660000000000000000000402', '660000000000000000000403'],
      readyCount: 0,
      submittedCount: 1,
      failedCount: 0,
      cancelledCount: 0,
      avgProcessingMs: null,
    }],
      total: 2,
      page: 1,
      limit: 100,
    });
    shipmentPublic.summarizeShippedByOrderItemIds.mockResolvedValueOnce({
      '660000000000000000000401': 1,
      '660000000000000000000402': 1,
      '660000000000000000000403': 0,
    });

    const result = await service.getVendorPerformance({}, { permissions: ['REPORTS:READ'] });

    expect(vendorSubmissionPublic.summarizePerformancePage).toHaveBeenCalledWith(
      expect.objectContaining({}),
      expect.objectContaining({ system: true, source: 'REPORT' }),
    );
    expect(shipmentPublic.summarizeShippedByOrderItemIds).toHaveBeenCalledTimes(1);
    expect(shipmentPublic.summarizeShippedByOrderItemIds).toHaveBeenCalledWith([
      '660000000000000000000401',
      '660000000000000000000402',
      '660000000000000000000403',
    ], expect.objectContaining({ system: true, source: 'REPORT' }));
    expect(result).toEqual(expect.objectContaining({
      total: 2,
      page: 1,
      limit: 100,
      items: [expect.objectContaining({
      vendorCode: 'BEEFUL',
      submittedCount: 3,
      failedCount: 1,
      shippedCount: 1,
      successRateBps: 7500,
      avgProcessingHours: 2,
    }), expect.objectContaining({
      vendorCode: 'MANGOTEE',
      submittedCount: 1,
      failedCount: 0,
      shippedCount: 1,
      successRateBps: 10000,
    })],
    }));
  });

  test('operations overview merges source summaries', async () => {
    orderPublic.summarizeOrderItems.mockResolvedValueOnce({ SHIPPED: 4 });
    productionPublic.summarizeTasks.mockResolvedValueOnce({
      blocked: 1,
      needScale: 2,
      qcPending: 3,
      readyToSendVendor: 4,
      blockers: { PSD_MISSING: 1 },
    });
    vendorSubmissionPublic.summarizePerformance.mockResolvedValueOnce([{
      readyCount: 1,
      submittedCount: 2,
      failedCount: 3,
      cancelledCount: 4,
    }]);
    shipmentPublic.summarizeShipments.mockResolvedValueOnce({
      total: 5,
      byStatus: { SHIPPED: 5 },
      byCarrier: [],
    });

    const result = await service.getOperationsOverview({}, { permissions: ['REPORTS:READ'] });

    expect(result).toEqual({
      orderItemsByStatus: { SHIPPED: 4 },
      productionByStatus: {
        BLOCKED: 1,
        NEED_SCALE: 2,
        QC_PENDING: 3,
        READY_TO_SEND_VENDOR: 4,
      },
      productionBlockers: { PSD_MISSING: 1 },
      vendorSubmissionsByStatus: {
        READY: 1,
        SUBMITTED: 2,
        FAILED: 3,
        CANCELLED: 4,
      },
      shipmentsByStatus: { SHIPPED: 5 },
    });
  });

  test('buyer insights stays scoped and does not expose buyer identities', async () => {
    orderPublic.summarizeBuyerInsights.mockResolvedValueOnce({
      knownBuyerCount: 8,
      newBuyerCount: 3,
      returningBuyerCount: 5,
      repeatBuyerCount: 2,
      unidentifiedOrderCount: 1,
      totalOrderCount: 10,
    });

    const result = await service.getBuyerInsights({}, scopedAuth);

    expect(orderPublic.summarizeBuyerInsights).toHaveBeenCalledWith(
      { shopIds: [shopId] },
      expect.objectContaining({ system: true, source: 'REPORT' }),
    );
    expect(result).toEqual({
      knownBuyerCount: 8,
      newBuyerCount: 3,
      returningBuyerCount: 5,
      repeatBuyerCount: 2,
      unidentifiedOrderCount: 1,
      totalOrderCount: 10,
    });
    expect(result).not.toHaveProperty('externalBuyerId');
    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('name');
  });

  test('channel acquisition merges scoped spend and buyer aggregates without identities', async () => {
    financePublic.summarizeAdsByChannel.mockResolvedValueOnce([{
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      currency: 'USD',
      spendAmount: 8000,
      attributedSalesAmount: 24000,
      impressions: 10000,
      clicks: 100,
      attributedOrdersCount: 8,
    }, {
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      currency: 'CAD',
      spendAmount: 5000,
      attributedSalesAmount: 15000,
      impressions: 5000,
      clicks: 50,
      attributedOrdersCount: 5,
    }]);
    orderPublic.summarizeNewBuyersByChannel.mockResolvedValueOnce([{
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      currency: 'USD',
      newBuyerCount: 4,
    }, {
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      currency: 'CAD',
      newBuyerCount: 2,
    }]);

    const result = await service.getAdsChannelPerformance({}, scopedAuth);

    expect(financePublic.summarizeAdsByChannel).toHaveBeenCalledWith(
      { shopIds: [shopId] },
      expect.objectContaining({ system: true, source: 'REPORT' }),
    );
    expect(orderPublic.summarizeNewBuyersByChannel).toHaveBeenCalledWith(
      { shopIds: [shopId] },
      expect.objectContaining({ system: true, source: 'REPORT' }),
    );
    expect(result).toEqual([{
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      currency: 'USD',
      spendAmount: 8000,
      attributedSalesAmount: 24000,
      impressions: 10000,
      clicks: 100,
      attributedOrdersCount: 8,
      newBuyerCount: 4,
      ctrBps: 100,
      conversionBps: 800,
      cpaAmount: 2000,
    }, {
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      currency: 'CAD',
      spendAmount: 5000,
      attributedSalesAmount: 15000,
      impressions: 5000,
      clicks: 50,
      attributedOrdersCount: 5,
      newBuyerCount: 2,
      ctrBps: 100,
      conversionBps: 1000,
      cpaAmount: 2500,
    }]);
    expect(result[0]).not.toHaveProperty('externalBuyerId');
  });

  test('ads seller attribution scopes and maps seller metrics', async () => {
    financePublic.summarizeAdsBySeller.mockResolvedValueOnce([{
      sellerEmployeeCode: 'J2508',
      currency: 'USD',
      spendAmount: 8000,
      attributedSalesAmount: 24000,
      impressions: 10000,
      clicks: 100,
      attributedOrdersCount: 8,
    }, {
      sellerEmployeeCode: 'UNASSIGNED',
      currency: 'CAD',
      spendAmount: 0,
      attributedSalesAmount: 0,
      impressions: 0,
      clicks: 0,
      attributedOrdersCount: 0,
    }]);

    const result = await service.getAdsSellerAttribution({}, scopedAuth);

    expect(financePublic.summarizeAdsBySeller).toHaveBeenCalledWith(
      { shopIds: [shopId] },
      expect.objectContaining({ system: true, source: 'REPORT' }),
    );
    expect(result).toEqual([{
      sellerEmployeeCode: 'J2508',
      currency: 'USD',
      spendAmount: 8000,
      attributedSalesAmount: 24000,
      impressions: 10000,
      clicks: 100,
      attributedOrdersCount: 8,
      ctrBps: 100,
      conversionBps: 800,
      cpaAmount: 1000,
    }, {
      sellerEmployeeCode: 'UNASSIGNED',
      currency: 'CAD',
      spendAmount: 0,
      attributedSalesAmount: 0,
      impressions: 0,
      clicks: 0,
      attributedOrdersCount: 0,
      ctrBps: null,
      conversionBps: null,
      cpaAmount: null,
    }]);
  });

  test('ads daily scopes filters and maps daily attribution metrics', async () => {
    financePublic.summarizeAdsDaily.mockResolvedValueOnce([{
      reportDate: '2026-07-11',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      currency: 'USD',
      spendAmount: 8000,
      attributedSalesAmount: 24000,
      impressions: 10000,
      clicks: 100,
      attributedOrdersCount: 8,
    }]);

    const result = await service.getAdsDaily({ salesChannelCode: 'AMAZON' }, scopedAuth);

    expect(financePublic.summarizeAdsDaily).toHaveBeenCalledWith(
      { salesChannelCode: 'AMAZON', shopIds: [shopId] },
      expect.objectContaining({ system: true, source: 'REPORT' }),
    );
    expect(result).toEqual([expect.objectContaining({
      reportDate: '2026-07-11',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      currency: 'USD',
      spendAmount: 8000,
      attributedSalesAmount: 24000,
      impressions: 10000,
      clicks: 100,
      attributedOrdersCount: 8,
      ctrBps: 100,
      conversionBps: 800,
      cpaAmount: 1000,
    })]);
  });
});
