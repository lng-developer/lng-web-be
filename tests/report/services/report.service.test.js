jest.mock('../../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../src/modules/finance/public', () => ({
  listFilterOptions: jest.fn(),
  summarizeBySeller: jest.fn(),
  summarizeByTeam: jest.fn(),
  summarizeSellerDaily: jest.fn(),
  summarizeDaily: jest.fn(),
  summarizeDailyProfit: jest.fn(),
  summarizeAdsByChannel: jest.fn(),
  summarizeAdsBySeller: jest.fn(),
  summarizeAdsDaily: jest.fn(),
  summarizeAdsSellerDaily: jest.fn(),
}));

jest.mock('../../../src/modules/hr/public', () => ({
  getEmployeeProfileByAccountId: jest.fn(),
  listAssignableProfiles: jest.fn(),
  listEmployeeProfilesByEmployeeCodes: jest.fn(),
}));

jest.mock('../../../src/modules/organization/public', () => ({
  listAccountOrganizationSummaries: jest.fn(),
  listTeamsByDepartment: jest.fn(),
}));

jest.mock('../../../src/modules/order/public', () => ({
  summarizeBuyerInsights: jest.fn(),
  summarizeNewBuyersByChannel: jest.fn(),
  summarizeOrderItems: jest.fn(),
}));

jest.mock('../../../src/modules/shop/public', () => ({
  findByIds: jest.fn(),
}));

jest.mock('../../../src/modules/production/public', () => ({
  summarizeTasks: jest.fn(),
}));

jest.mock('../../../src/modules/shipment/public', () => ({
  summarizeShippedByOrderItemIds: jest.fn(),
  summarizeShipments: jest.fn(),
}));

jest.mock('../../../src/modules/vendorSubmission/public', () => ({
  summarizePerformance: jest.fn(),
  summarizePerformancePage: jest.fn(),
}));

jest.mock('../../../src/modules/audit/public', () => ({
  record: jest.fn(),
}));

const authPublic = require('../../../src/modules/auth/public');
const financePublic = require('../../../src/modules/finance/public');
const hrPublic = require('../../../src/modules/hr/public');
const organizationPublic = require('../../../src/modules/organization/public');
const orderPublic = require('../../../src/modules/order/public');
const shopPublic = require('../../../src/modules/shop/public');
const productionPublic = require('../../../src/modules/production/public');
const shipmentPublic = require('../../../src/modules/shipment/public');
const vendorSubmissionPublic = require('../../../src/modules/vendorSubmission/public');
const auditPublic = require('../../../src/modules/audit/public');
const service = require('../../../src/modules/report/services/report.service');

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
    financePublic.summarizeAdsDaily.mockResolvedValue([]);
    financePublic.summarizeBySeller.mockResolvedValue([]);
    financePublic.summarizeByTeam.mockResolvedValue([]);
    financePublic.summarizeSellerDaily.mockResolvedValue([]);
    financePublic.summarizeAdsSellerDaily.mockResolvedValue([]);
    hrPublic.getEmployeeProfileByAccountId.mockResolvedValue(null);
    hrPublic.listAssignableProfiles.mockResolvedValue([]);
    hrPublic.listEmployeeProfilesByEmployeeCodes.mockResolvedValue([]);
    organizationPublic.listAccountOrganizationSummaries.mockResolvedValue([]);
    organizationPublic.listTeamsByDepartment.mockResolvedValue([]);
    financePublic.listFilterOptions.mockResolvedValue({
      channels: [], marketplaces: [], sellers: [], teams: [], departments: [], shops: [],
    });
    shopPublic.findByIds.mockResolvedValue([]);
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

  test('does not audit routine finance and ads report reads', async () => {
    const auth = {
      accountId: '660000000000000000000299',
      permissions: ['REPORTS:READ'],
      auditContext: { requestId: 'report-sensitive-read' },
    };
    const query = { shopId, dateFrom: '2026-07-01', dateTo: '2026-07-28' };

    await service.getFinanceDaily(query, auth);
    await service.getAdsChannelPerformance(query, auth);
    await service.getAdsSellerAttribution(query, auth);
    await service.getAdsDaily(query, auth);
    await service.getFinanceDailyProfit(query, auth);
    await service.getFinanceBySeller(query, auth);
    await service.getFinanceByTeam(query, auth);
    await service.getFinanceSellerDaily(query, auth);
    await service.getBuyerInsights(query, auth);
    await service.getVendorPerformance(query, auth);
    await service.getOperationsOverview(query, auth);

    expect(auditPublic.record).not.toHaveBeenCalled();
  });

  test('seller daily report merges seller-attributed ads on the same day and currency', async () => {
    financePublic.summarizeSellerDaily.mockResolvedValueOnce([{
      date: '2026-09-05', sellerEmployeeCode: 'J2502', sellerAccountId: 'account-1', sellerName: 'Mai',
      currency: 'USD', itemCount: 1, revenueAmount: 10000, baseCostAmount: 4000,
      totalCostAmount: 4500, additionalFulfillmentCostAmount: 500, marketplaceFeeAmount: 1500,
      refundAmount: 0, discountAmount: 0, taxAmount: 0, grossProfitAmount: 4500, missingCostCount: 0,
      operatingCostAmount: 3000,
    }]);
    financePublic.summarizeAdsSellerDaily.mockResolvedValueOnce([{
      date: '2026-09-05', sellerEmployeeCode: 'J2502', currency: 'USD', adSpendAmount: 800,
    }]);

    const result = await service.getFinanceSellerDaily({}, { permissions: ['REPORTS:READ'] });

    expect(financePublic.summarizeSellerDaily).toHaveBeenCalledWith(
      {}, expect.objectContaining({ system: true, source: 'REPORT' }),
    );
    expect(result).toEqual([expect.objectContaining({
      date: '2026-09-05', sellerEmployeeCode: 'J2502', adSpendAmount: 800, netProfitAmount: 700,
    })]);
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

  test.each([
    ['department', '660000000000000000000501', { departmentId: '660000000000000000000501' }],
    ['team', '660000000000000000000502', { teamId: '660000000000000000000502' }],
    ['own', null, { sellerAccountId: '660000000000000000000503' }],
  ])('finance daily applies %s report scope', async (scopeType, scopeId, condition) => {
    const auth = {
      accountId: '660000000000000000000503',
      permissions: [],
      scopes: [{ scopeType, scopeId, permissions: ['REPORTS:READ'] }],
    };

    await service.getFinanceDaily({}, auth);

    expect(financePublic.summarizeDaily).toHaveBeenCalledWith(
      { accessOr: [condition] },
      expect.objectContaining({ system: true, source: 'REPORT' }),
    );
  });

  test('organization scoped users do not fall back to global operational data', async () => {
    const auth = {
      permissions: [],
      scopes: [{
        scopeType: 'team',
        scopeId: '660000000000000000000502',
        permissions: ['REPORTS:READ'],
      }],
    };

    expect(await service.getOperationsOverview({}, auth)).toEqual({
      orderItemsByStatus: {},
      productionByStatus: {},
      productionBlockers: {},
      vendorSubmissionsByStatus: {},
      shipmentsByStatus: {},
    });
    expect(orderPublic.summarizeOrderItems).not.toHaveBeenCalled();
  });

  test('filter options use the same scoped finance dimensions', async () => {
    const auth = {
      permissions: [],
      scopes: [{
        scopeType: 'department',
        scopeId: '660000000000000000000501',
        permissions: ['REPORTS:READ'],
      }],
    };

    await service.getFilterOptions(auth);

    expect(financePublic.listFilterOptions).toHaveBeenCalledWith(
      { accessOr: [{ departmentId: '660000000000000000000501' }] },
      expect.objectContaining({ system: true, source: 'REPORT' }),
    );
  });

  test('filter options resolve shop labels instead of exposing bare ids', async () => {
    financePublic.listFilterOptions.mockResolvedValueOnce({
      channels: [], marketplaces: [], sellers: [], teams: [], departments: [],
      shops: [{ id: shopId }],
    });
    shopPublic.findByIds.mockResolvedValueOnce([{
      _id: shopId,
      name: 'Amazon US',
      code: 'AMZ_US',
    }]);

    const result = await service.getFilterOptions({ permissions: ['REPORTS:READ'] });

    expect(result.shops).toEqual([{ id: shopId, name: 'Amazon US', code: 'AMZ_US' }]);
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

  test('daily profit preserves unavailable profit when any included item lacks cost', async () => {
    financePublic.summarizeDailyProfit.mockResolvedValueOnce([{
      date: '2026-07-11',
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      currency: 'USD',
      itemCount: 2,
      revenueAmount: 10000,
      baseCostAmount: 4000,
      grossProfitAmount: null,
      adSpendAmount: 1250,
      netProfitAmount: null,
      netMarginBps: null,
      missingCostCount: 1,
      estimatedFeeCount: 1,
      estimatedCostCount: 1,
    }]);

    await expect(service.getFinanceDailyProfit({}, scopedAuth)).resolves.toEqual([
      expect.objectContaining({
        grossProfitAmount: null,
        netProfitAmount: null,
        missingCostCount: 1,
        estimatedFeeCount: 1,
        estimatedCostCount: 1,
      }),
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

  test('finance by seller subtracts attributed ads spend and keeps unassigned spend visible', async () => {
    financePublic.summarizeBySeller.mockResolvedValueOnce([{
      sellerEmployeeCode: 'J2508', sellerAccountId: '660000000000000000000901', sellerName: 'J2508 Seller',
      currency: 'USD', itemCount: 3, revenueAmount: 12000, baseCostAmount: 5000,
      grossProfitAmount: 6000, operatingCostAmount: 3000, operatingCostDays: 1,
      netProfitAmount: 3000, netMarginBps: 2500, grossMarginBps: 5000, missingCostCount: 0,
    }]);
    financePublic.summarizeAdsBySeller.mockResolvedValueOnce([
      { sellerEmployeeCode: 'J2508', currency: 'USD', spendAmount: 800 },
      { sellerEmployeeCode: 'UNASSIGNED', currency: 'USD', spendAmount: 200 },
    ]);

    const result = await service.getFinanceBySeller({}, { permissions: ['REPORTS:READ'] });

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sellerEmployeeCode: 'J2508', adSpendAmount: 800, netProfitAmount: 2200, netMarginBps: 1833,
      }),
      expect.objectContaining({
        sellerEmployeeCode: 'UNASSIGNED', revenueAmount: 0, adSpendAmount: 200, netProfitAmount: null,
      }),
    ]));
  });

  test('finance by seller restricts ads spend to the team sellers in a scoped report', async () => {
    const teamId = '660000000000000000000501';
    hrPublic.listAssignableProfiles.mockResolvedValueOnce([{ employeeCode: 'J2508' }]);

    await service.getFinanceBySeller({}, {
      permissions: [],
      scopes: [{ scopeType: 'team', scopeId: teamId, permissions: ['REPORTS:READ'] }],
    });

    expect(financePublic.summarizeAdsBySeller).toHaveBeenCalledWith(
      { adsAccessOr: [{ sellerEmployeeCodes: ['J2508'] }] },
      expect.objectContaining({ system: true, source: 'REPORT' }),
    );
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

  test('finance by team includes ads-only sellers in their organization team', async () => {
    financePublic.summarizeAdsBySeller.mockResolvedValueOnce([{
      sellerEmployeeCode: 'J2522', currency: 'USD', spendAmount: 291,
    }]);
    hrPublic.listEmployeeProfilesByEmployeeCodes.mockResolvedValueOnce([{
      accountId: '660000000000000000000922', employeeCode: 'J2522', fullName: 'Seller 2522',
    }]);
    organizationPublic.listAccountOrganizationSummaries.mockResolvedValueOnce([{
      accountId: '660000000000000000000922',
      team: { id: '660000000000000000000522', code: 'SALES', name: 'Sales' },
      department: { id: '660000000000000000000622', code: 'COM', name: 'Commercial' },
    }]);

    const result = await service.getFinanceByTeam({}, { permissions: ['REPORTS:READ'] });

    expect(result).toEqual([expect.objectContaining({
      teamCode: 'SALES', teamName: 'Sales', activeSellerCount: 1,
      adSpendAmount: 291, netProfitAmount: null,
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
