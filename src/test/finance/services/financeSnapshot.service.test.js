jest.mock('../../../modules/order/public', () => ({
  findItemById: jest.fn(),
  findItemIds: jest.fn(),
  findItemsByIds: jest.fn(),
  listItems: jest.fn(),
  listItemsByOrder: jest.fn(),
}));

jest.mock('../../../modules/mapping/public', () => ({
  getFulfillmentPlanForOrderItem: jest.fn(),
}));

jest.mock('../../../modules/shipment/public', () => ({
  getShipmentByOrderItem: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../modules/hr/public', () => ({
  getEmployeeProfileByEmployeeCode: jest.fn(),
}));

jest.mock('../../../modules/organization/public', () => ({
  getTeamByCode: jest.fn(),
  listTeamMembers: jest.fn(),
  listAccountOrganizationSummaries: jest.fn(),
}));

jest.mock('../../../modules/finance/repositories/financeSnapshot.repository', () => ({
  findByOrderItem: jest.fn(),
  list: jest.fn(),
  listByOrder: jest.fn(),
  listByOrderItemIds: jest.fn(),
  summarizeOrderPnl: jest.fn(),
  summarizeBySeller: jest.fn(),
  summarizeByTeam: jest.fn(),
  summarizeDaily: jest.fn(),
  summarizeAdsBySeller: jest.fn(),
  findDateBounds: jest.fn(),
  upsertByOrderItem: jest.fn(),
}));

jest.mock('../../../modules/finance/repositories/financeImport.repository', () => ({
  sumFeesByOrderItem: jest.fn(),
  sumRefundsByOrderItem: jest.fn(),
}));

const orderPublic = require('../../../modules/order/public');
const mappingPublic = require('../../../modules/mapping/public');
const shipmentPublic = require('../../../modules/shipment/public');
const authPublic = require('../../../modules/auth/public');
const hrPublic = require('../../../modules/hr/public');
const organizationPublic = require('../../../modules/organization/public');
const repository = require('../../../modules/finance/repositories/financeSnapshot.repository');
const financeImportRepository = require('../../../modules/finance/repositories/financeImport.repository');
const service = require('../../../modules/finance/services/financeSnapshot.service');

describe('financeSnapshot.service', () => {
  const orderId = '660000000000000000140001';
  const orderItemId = '660000000000000000140002';
  const shopId = '660000000000000000140003';
  const planId = '660000000000000000140004';
  const vendorProductId = '660000000000000000140005';
  const vendorCostCenterId = '660000000000000000140006';
  const shipmentId = '660000000000000000140007';

  const item = {
    _id: orderItemId,
    orderId,
    shopId,
    salesChannelCode: 'AMAZON',
    marketplaceCode: 'AMAZON_US',
    sku: 'J2508-TS1S-05032026-335',
    price: {
      itemPriceAmount: 3385,
      itemTaxAmount: 237,
      shippingPriceAmount: 595,
      shippingTaxAmount: 0,
      giftWrapPriceAmount: 0,
      giftWrapTaxAmount: 0,
      itemPromotionDiscountAmount: 100,
      shipPromotionDiscountAmount: 0,
      currency: 'USD',
    },
    externalData: {
      finance: {
        feeAmount: 300,
        refundAmount: 200,
      },
    },
  };

  const fulfillmentPlan = {
    id: planId,
    vendorProduct: { id: vendorProductId },
    vendorCostCenter: { id: vendorCostCenterId },
    costEstimate: {
      currency: 'USD',
      totalAmount: 1228,
      lines: [
        { code: 'BASE_COST', label: 'Base cost', amount: 1200 },
        { code: 'IMPORT_TAX', label: 'Import tax', amount: 28 },
      ],
    },
  };

  beforeEach(() => {
    jest.resetAllMocks();
    authPublic.canAccessScope.mockReturnValue(true);
    hrPublic.getEmployeeProfileByEmployeeCode.mockResolvedValue({
      accountId: '660000000000000000140008',
      employeeCode: 'J2508',
      fullName: 'J2508 Seller',
    });
    organizationPublic.listAccountOrganizationSummaries.mockResolvedValue([{
      accountId: '660000000000000000140008',
      team: {
        id: '660000000000000000140009',
        name: 'Sales Team A',
        code: 'SALES_A',
      },
      department: {
        id: '660000000000000000140010',
        name: 'Sales',
        code: 'SALES',
      },
    }]);
    organizationPublic.getTeamByCode.mockResolvedValue({
      id: '660000000000000000140009',
      code: 'SALES',
      name: 'Sales Team',
    });
    organizationPublic.listTeamMembers.mockResolvedValue({
      team: { id: '660000000000000000140009', code: 'SALES', name: 'Sales Team' },
      leaders: [],
      members: [],
    });
    orderPublic.findItemById.mockResolvedValue(item);
    orderPublic.findItemsByIds.mockResolvedValue([item]);
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValue(fulfillmentPlan);
    shipmentPublic.getShipmentByOrderItem.mockResolvedValue({ id: shipmentId });
    financeImportRepository.sumFeesByOrderItem.mockResolvedValue(null);
    financeImportRepository.sumRefundsByOrderItem.mockResolvedValue(null);
    repository.upsertByOrderItem.mockImplementation(async (_id, payload) => ({
      _id: '660000000000000000140099',
      ...payload,
      createdAt: new Date('2026-07-06T00:00:00.000Z'),
      updatedAt: new Date('2026-07-06T00:00:00.000Z'),
    }));
  });

  test('recalculates estimated snapshot from order item and fulfillment plan', async () => {
    const result = await service.recalculateOrderItem(orderItemId, { permissions: ['FINANCE:WRITE'] });

    expect(mappingPublic.getFulfillmentPlanForOrderItem).toHaveBeenCalledWith(orderItemId);
    expect(repository.upsertByOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      orderId,
      orderItemId,
      shopId,
      fulfillmentPlanId: planId,
      vendorProductId,
      vendorCostCenterId,
      shipmentId,
      itemPriceAmount: 3385,
      taxAmount: 237,
      shippingAmount: 595,
      discountAmount: 100,
      feeAmount: 300,
      refundAmount: 200,
      customerPaidAmount: 3980,
      baseCostAmount: 1200,
      totalCostAmount: 1228,
      costStatus: 'PRESENT',
      snapshotStatus: 'ESTIMATED',
      grossProfitAmount: 2180,
      grossMarginBps: 5477,
    }));
    expect(result).toMatchObject({
      orderItemId,
      snapshotStatus: 'ESTIMATED',
      revenue: {
        customerPaidAmount: 3980,
        discountAmount: 100,
        feeAmount: 300,
        refundAmount: 200,
      },
      cost: { baseCostAmount: 1200, totalCostAmount: 1228, costStatus: 'PRESENT' },
      margin: { grossProfitAmount: 2180, grossMarginBps: 5477 },
    });
  });

  test('exposes order P&L using the full fulfillment cost', async () => {
    orderPublic.findItemById.mockResolvedValueOnce({
      ...item,
      price: {
        ...item.price,
        itemPriceAmount: 10000,
        shippingPriceAmount: 0,
        itemPromotionDiscountAmount: 300,
      },
      externalData: { finance: { feeAmount: 900, refundAmount: 200 } },
    });
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValueOnce({
      ...fulfillmentPlan,
      costEstimate: {
        ...fulfillmentPlan.costEstimate,
        totalAmount: 4500,
        lines: [{ code: 'BASE_COST', label: 'Base cost', amount: 4000 }],
      },
    });

    const result = await service.recalculateOrderItem(orderItemId, { permissions: ['FINANCE:WRITE'] });

    expect(result.orderPnl).toEqual({
      marketplaceFeeAmount: 900,
      refundAmount: 200,
      discountAmount: 300,
      baseCostAmount: 4000,
      additionalFulfillmentCostAmount: 500,
      totalCostAmount: 4500,
      totalDeductionAmount: 5900,
      profitAmount: 4100,
    });
  });

  test('recalculate uses linked finance fee and refund rows before externalData fallback', async () => {
    financeImportRepository.sumFeesByOrderItem.mockResolvedValueOnce(425);
    financeImportRepository.sumRefundsByOrderItem.mockResolvedValueOnce(150);

    await service.recalculateOrderItem(orderItemId, { permissions: ['FINANCE:WRITE'] });

    expect(repository.upsertByOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      feeAmount: 425,
      refundAmount: 150,
      grossProfitAmount: 2105,
    }));
  });

  test('recalculate stores seller and current team dimensions from SKU employee code', async () => {
    await service.recalculateOrderItem(orderItemId, { permissions: ['FINANCE:WRITE'] });

    expect(hrPublic.getEmployeeProfileByEmployeeCode).toHaveBeenCalledWith('J2508');
    expect(organizationPublic.listAccountOrganizationSummaries).toHaveBeenCalledWith(['660000000000000000140008']);
    expect(repository.upsertByOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      sellerEmployeeCode: 'J2508',
      sellerAccountId: '660000000000000000140008',
      sellerName: 'J2508 Seller',
      teamId: '660000000000000000140009',
      teamName: 'Sales Team A',
      teamCode: 'SALES_A',
      departmentId: '660000000000000000140010',
      departmentName: 'Sales',
      departmentCode: 'SALES',
    }));
  });

  test('recalculate keeps seller employee code when profile is missing', async () => {
    hrPublic.getEmployeeProfileByEmployeeCode.mockResolvedValueOnce(null);

    await service.recalculateOrderItem(orderItemId, { permissions: ['FINANCE:WRITE'] });

    expect(repository.upsertByOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      sellerEmployeeCode: 'J2508',
      sellerAccountId: null,
      teamId: null,
    }));
    expect(organizationPublic.listAccountOrganizationSummaries).not.toHaveBeenCalled();
  });

  test('recalculates all order items and returns compact totals', async () => {
    const secondOrderItemId = '660000000000000000140222';
    const secondItem = {
      ...item,
      _id: secondOrderItemId,
      price: {
        ...item.price,
        itemPriceAmount: 2000,
        shippingPriceAmount: 0,
        itemPromotionDiscountAmount: 0,
      },
    };
    orderPublic.listItemsByOrder.mockResolvedValueOnce([item, secondItem]);
    orderPublic.findItemById
      .mockResolvedValueOnce(item)
      .mockResolvedValueOnce(secondItem);
    mappingPublic.getFulfillmentPlanForOrderItem
      .mockResolvedValueOnce(fulfillmentPlan)
      .mockResolvedValueOnce({ id: '660000000000000000140223' });

    const result = await service.recalculateOrder(orderId, { permissions: ['FINANCE:WRITE'] });

    expect(orderPublic.listItemsByOrder).toHaveBeenCalledWith(orderId);
    expect(repository.upsertByOrderItem).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      orderId,
      itemCount: 2,
      recalculatedCount: 2,
      missingCostCount: 1,
      summary: {
        revenueAmount: 5980,
        baseCostAmount: 1200,
        grossProfitAmount: 2180,
      },
    });
  });

  test('scoped user cannot recalculate order items from unauthorized shop', async () => {
    authPublic.canAccessScope.mockReturnValueOnce(false);
    orderPublic.listItemsByOrder.mockResolvedValueOnce([item]);

    await expect(service.recalculateOrder(orderId, {
      permissions: [],
      scopes: [],
    })).rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
    expect(repository.upsertByOrderItem).not.toHaveBeenCalled();
  });

  test('persists missing cost snapshot when fulfillment plan has no cost estimate', async () => {
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValueOnce({ id: planId });

    const result = await service.recalculateOrderItem(orderItemId, { permissions: ['FINANCE:WRITE'] });

    expect(repository.upsertByOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      baseCostAmount: null,
      totalCostAmount: null,
      costLines: [],
      costStatus: 'MISSING',
      snapshotStatus: 'MISSING_COST',
      grossProfitAmount: null,
      grossMarginBps: null,
    }));
    expect(result).toMatchObject({
      snapshotStatus: 'MISSING_COST',
      margin: { grossProfitAmount: null, grossMarginBps: null },
      orderPnl: {
        baseCostAmount: null,
        additionalFulfillmentCostAmount: null,
        totalCostAmount: null,
        totalDeductionAmount: null,
        profitAmount: null,
      },
    });
  });

  test('missing order item returns not found', async () => {
    orderPublic.findItemById.mockResolvedValueOnce(null);

    await expect(service.recalculateOrderItem(orderItemId, { permissions: ['FINANCE:WRITE'] }))
      .rejects.toMatchObject({ statusCode: 404, code: 'RESOURCE_NOT_FOUND' });
  });

  test('scoped user cannot read snapshot from unauthorized shop', async () => {
    authPublic.canAccessScope.mockReturnValue(false);
    repository.findByOrderItem.mockResolvedValueOnce({
      _id: '660000000000000000140099',
      orderId,
      orderItemId,
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      snapshotStatus: 'ESTIMATED',
    });

    await expect(service.getSnapshotByOrderItem(orderItemId, {
      permissions: [],
      scopes: [],
    })).rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
  });

  test('order summary uses persisted gross profit instead of customer paid minus total cost', async () => {
    repository.listByOrder.mockResolvedValueOnce([{
      orderId,
      orderItemId,
      shopId,
      customerPaidAmount: 3980,
      baseCostAmount: 1200,
      totalCostAmount: 1228,
      grossProfitAmount: 2180,
      currency: 'USD',
      snapshotStatus: 'ESTIMATED',
    }]);

    const result = await service.getOrderSummary(orderId, { permissions: ['FINANCE:READ'] });

    expect(result.grossProfitAmount).toBe(2180);
    expect(result.grossMarginBps).toBe(5477);
  });

  test('summarizeDaily delegates daily aggregation to repository', async () => {
    repository.summarizeDaily.mockResolvedValueOnce([{ date: '2026-07-11', itemCount: 1 }]);

    await expect(service.summarizeDaily({ shopId })).resolves.toEqual([{ date: '2026-07-11', itemCount: 1 }]);
    expect(repository.summarizeDaily).toHaveBeenCalledWith({ shopId });
  });

  test('lists snapshots with external order IDs and filters by that value', async () => {
    item.externalOrderId = '113-1234567-1234567';
    orderPublic.findItemIds.mockResolvedValueOnce([orderItemId]);
    repository.list.mockResolvedValueOnce({
      items: [{
        _id: '660000000000000000140099',
        orderId,
        orderItemId,
        shopId,
        salesChannelCode: 'AMAZON',
        marketplaceCode: 'AMAZON_US',
        snapshotStatus: 'ESTIMATED',
      }],
      total: 1,
      page: 1,
      limit: 20,
    });
    repository.summarizeOrderPnl.mockResolvedValueOnce([{
      currency: 'USD',
      revenueAmount: 3980,
      marketplaceFeeAmount: 300,
      refundAmount: 200,
      discountAmount: 100,
      baseCostAmount: 1200,
      totalCostAmount: 1228,
      additionalFulfillmentCostAmount: 28,
      totalDeductionAmount: 1828,
      profitAmount: 2152,
      missingCostCount: 0,
    }]);

    const result = await service.listSnapshots(
      { externalOrderId: '113-1234567-1234567', page: 1, limit: 20 },
      { permissions: ['FINANCE:READ'] },
    );

    expect(orderPublic.findItemIds).toHaveBeenCalledWith({
      externalOrderId: '113-1234567-1234567',
    });
    expect(orderPublic.listItems).not.toHaveBeenCalled();
    expect(repository.list).toHaveBeenCalledWith({
      orderItemIds: [orderItemId],
      page: 1,
      limit: 20,
    });
    expect(repository.summarizeOrderPnl).toHaveBeenCalledWith({
      orderItemIds: [orderItemId],
      page: 1,
      limit: 20,
    });
    expect(result.items[0].externalOrderId).toBe('113-1234567-1234567');
    expect(result.summaryByCurrency).toEqual([expect.objectContaining({
      currency: 'USD',
      profitAmount: 2152,
    })]);
  });

  test('applies the same scoped shop IDs to snapshot rows and Order P&L totals', async () => {
    const secondShopId = '660000000000000000140011';
    repository.list.mockResolvedValueOnce({ items: [], total: 0, page: 1, limit: 20 });
    repository.summarizeOrderPnl.mockResolvedValueOnce([]);

    await service.listSnapshots({ page: 1, limit: 20 }, {
      permissions: [],
      scopes: [
        { scopeType: 'shop', scopeId: shopId, permissions: ['FINANCE:READ'] },
        { scopeType: 'shop', scopeId: secondShopId, permissions: ['FINANCE:WRITE'] },
        { scopeType: 'team', scopeId: '660000000000000000140012', permissions: ['FINANCE:READ'] },
      ],
    });

    const expectedQuery = { page: 1, limit: 20, shopIds: [shopId, secondShopId] };
    expect(repository.list).toHaveBeenCalledWith(expectedQuery);
    expect(repository.summarizeOrderPnl).toHaveBeenCalledWith(expectedQuery);
  });

  test('summarizeAdsBySeller delegates seller ads aggregation to repository', async () => {
    repository.summarizeAdsBySeller.mockResolvedValueOnce([{ sellerEmployeeCode: 'J2508' }]);

    await expect(service.summarizeAdsBySeller({ shopId })).resolves.toEqual([{ sellerEmployeeCode: 'J2508' }]);
    expect(repository.summarizeAdsBySeller).toHaveBeenCalledWith({ shopId });
  });

  test('applies $30 daily operating cost to every active sales seller, including sellers without sales', async () => {
    repository.summarizeBySeller.mockResolvedValueOnce([{
      sellerEmployeeCode: 'J2508',
      sellerAccountId: '660000000000000000140008',
      sellerName: 'Seller One',
      currency: 'USD',
      itemCount: 2,
      revenueAmount: 12000,
      baseCostAmount: 5000,
      grossProfitAmount: 6000,
      missingCostCount: 0,
    }]);
    organizationPublic.listTeamMembers.mockResolvedValueOnce({
      team: { id: '660000000000000000140009', code: 'SALES', name: 'Sales Team' },
      leaders: [],
      members: [
        { accountId: '660000000000000000140008', employeeCode: 'J2508', fullName: 'Seller One' },
        { accountId: '660000000000000000140011', employeeCode: 'J2509', fullName: 'Seller Two' },
      ],
    });

    const result = await service.summarizeBySeller({
      shopId,
      dateFrom: '2026-07-01T00:00:00.000Z',
      dateTo: '2026-07-03T00:00:00.000Z',
    });

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sellerEmployeeCode: 'J2508',
        operatingCostAmount: 9000,
        netProfitAmount: -3000,
      }),
      expect.objectContaining({
        sellerEmployeeCode: 'J2509',
        itemCount: 0,
        operatingCostAmount: 9000,
        netProfitAmount: -9000,
      }),
    ]));
  });

  test('applies active sales roster operating cost to the sales team summary', async () => {
    repository.summarizeByTeam.mockResolvedValueOnce([{
      teamId: '660000000000000000140009',
      teamCode: 'SALES',
      teamName: 'Sales Team',
      currency: 'USD',
      itemCount: 2,
      revenueAmount: 12000,
      baseCostAmount: 5000,
      grossProfitAmount: 6000,
      missingCostCount: 0,
    }]);
    organizationPublic.listTeamMembers.mockResolvedValueOnce({
      team: { id: '660000000000000000140009', code: 'SALES', name: 'Sales Team' },
      leaders: [],
      members: [
        { accountId: '660000000000000000140008' },
        { accountId: '660000000000000000140011' },
      ],
    });

    const result = await service.summarizeByTeam({
      shopId,
      dateFrom: '2026-07-01T00:00:00.000Z',
      dateTo: '2026-07-02T00:00:00.000Z',
    });

    expect(result).toEqual([expect.objectContaining({
      teamCode: 'SALES',
      operatingCostAmount: 12000,
      netProfitAmount: -6000,
    })]);
  });

  test('uses the snapshot date bounds when the report range is omitted', async () => {
    repository.summarizeBySeller.mockResolvedValueOnce([]);
    repository.findDateBounds.mockResolvedValueOnce({
      dateFrom: new Date('2026-07-01T00:00:00.000Z'),
      dateTo: new Date('2026-07-03T00:00:00.000Z'),
    });
    organizationPublic.listTeamMembers.mockResolvedValueOnce({
      team: { id: '660000000000000000140009', code: 'SALES', name: 'Sales Team' },
      leaders: [],
      members: [{ accountId: '660000000000000000140008', employeeCode: 'J2508', fullName: 'Seller One' }],
    });

    const result = await service.summarizeBySeller({ shopId });

    expect(repository.findDateBounds).toHaveBeenCalledWith({ shopId });
    expect(result).toEqual([expect.objectContaining({
      sellerEmployeeCode: 'J2508',
      operatingCostAmount: 9000,
      netProfitAmount: -9000,
    })]);
  });
});
