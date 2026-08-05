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
  listFilterOptions: jest.fn(),
  findDateBounds: jest.fn(),
  upsertByOrderItem: jest.fn(),
}));

jest.mock('../../../modules/finance/repositories/financeImport.repository', () => ({
  sumFeesByOrderItem: jest.fn(),
  sumRefundsByOrderItem: jest.fn(),
}));

jest.mock('../../../modules/audit/public', () => ({
  record: jest.fn(),
}));

const orderPublic = require('../../../modules/order/public');
const mappingPublic = require('../../../modules/mapping/public');
const shipmentPublic = require('../../../modules/shipment/public');
const authPublic = require('../../../modules/auth/public');
const hrPublic = require('../../../modules/hr/public');
const organizationPublic = require('../../../modules/organization/public');
const repository = require('../../../modules/finance/repositories/financeSnapshot.repository');
const financeImportRepository = require('../../../modules/finance/repositories/financeImport.repository');
const auditPublic = require('../../../modules/audit/public');
const service = require('../../../modules/finance/services/financeSnapshot.service');

describe('financeSnapshot.service', () => {
  const orderId = '660000000000000000140001';
  const orderItemId = '660000000000000000140002';
  const shopId = '660000000000000000140003';
  const planId = '660000000000000000140004';
  const vendorProductId = '660000000000000000140005';
  const vendorCostCenterId = '660000000000000000140006';
  const shipmentId = '660000000000000000140007';
  let transactionSession;

  test('records sanitized audit evidence for each authenticated finance snapshot read', async () => {
    const auth = {
      accountId: '660000000000000000140099',
      permissions: ['FINANCE:READ'],
      auditContext: { requestId: 'finance-snapshot-read' },
    };
    repository.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    repository.summarizeOrderPnl.mockResolvedValue([]);
    orderPublic.findItemsByIds.mockResolvedValue([]);
    repository.findByOrderItem.mockResolvedValue({
      _id: '660000000000000000140020', orderItemId, orderId, shopId,
    });
    repository.listByOrder.mockResolvedValue([]);

    await service.listSnapshots({ page: 1, limit: 20 }, auth);
    await service.getSnapshotByOrderItem(orderItemId, auth);
    await service.getOrderSummary(orderId, auth);

    expect(auditPublic.record.mock.calls.map(([event]) => event.action)).toEqual([
      'FINANCE_SNAPSHOTS_READ',
      'FINANCE_SNAPSHOT_READ',
      'FINANCE_ORDER_SUMMARY_READ',
    ]);
    auditPublic.record.mock.calls.forEach(([event]) => {
      expect(event).toMatchObject({
        actorType: 'ACCOUNT', actorAccountId: auth.accountId, source: 'HTTP', requestId: 'finance-snapshot-read',
      });
      expect(JSON.stringify(event)).not.toMatch(/amount|salary|token|secret/i);
    });
  });

  test('returns readable filter options limited by finance scope', async () => {
    const auth = {
      permissions: [],
      scopes: [{ scopeType: 'team', scopeId: '660000000000000000140009', permissions: ['FINANCE:READ'] }],
    };
    repository.listFilterOptions.mockResolvedValue({
      channels: ['AMAZON'],
      marketplaces: ['AMAZON_US'],
      sellers: [{ employeeCode: 'J2508', name: 'Seller' }],
      teams: [{ id: '660000000000000000140009', code: 'SALES_A', name: 'Sales A' }],
      departments: [],
    });

    await expect(service.listFilterOptions(auth)).resolves.toMatchObject({ channels: ['AMAZON'] });
    expect(repository.listFilterOptions).toHaveBeenCalledWith({
      accessOr: [{ teamId: '660000000000000000140009' }],
    });
  });

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
    transactionSession = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn(),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(transactionSession);
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
    const result = await service.recalculateOrderItem(orderItemId, {
      accountId: '660000000000000000140008', permissions: ['FINANCE:WRITE'],
    }, { requestId: 'req-finance-1', ipAddress: '127.0.0.1', userAgent: 'jest' });

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
    }), { session: transactionSession });
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
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'ACCOUNT',
      actorAccountId: '660000000000000000140008',
      action: 'FINANCE_ORDER_ITEM_RECALCULATED',
      entityType: 'ORDER_ITEM',
      entityId: orderItemId,
      scopeType: 'SHOP',
      scopeId: shopId,
      outcome: 'SUCCEEDED',
      source: 'HTTP',
      requestId: 'req-finance-1',
      metadata: { snapshotStatus: 'ESTIMATED', costStatus: 'PRESENT' },
      deduplicationKey: expect.stringMatching(
        new RegExp(`^finance-recalculation:finance_order_item_recalculated:order_item:${orderItemId}:`),
      ),
    }), { session: transactionSession });
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
    }), { session: transactionSession });
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
    }), { session: transactionSession });
  });

  test('recalculate keeps seller employee code when profile is missing', async () => {
    hrPublic.getEmployeeProfileByEmployeeCode.mockResolvedValueOnce(null);

    await service.recalculateOrderItem(orderItemId, { permissions: ['FINANCE:WRITE'] });

    expect(repository.upsertByOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      sellerEmployeeCode: 'J2508',
      sellerAccountId: null,
      teamId: null,
    }), { session: transactionSession });
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
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'FINANCE_ORDER_RECALCULATED',
      entityType: 'ORDER',
      entityId: orderId,
      scopeType: 'SHOP',
      scopeId: shopId,
      metadata: { itemCount: 2, recalculatedCount: 2, missingCostCount: 1 },
      deduplicationKey: expect.stringMatching(
        new RegExp(`^finance-recalculation:finance_order_recalculated:order:${orderId}:`),
      ),
    }), { session: transactionSession });
    expect(auditPublic.record).toHaveBeenCalledTimes(1);
    expect(repository.upsertByOrderItem.mock.calls.every((call) => (
      call[2]?.session === transactionSession
    ))).toBe(true);
  });

  test('public item recalculation cannot bypass audit with internal-looking options', async () => {
    await service.recalculateOrderItem(
      orderItemId,
      { permissions: ['FINANCE:WRITE'] },
      null,
      { suppressAudit: true },
    );

    expect(auditPublic.record).toHaveBeenCalledTimes(1);
  });

  test('snapshot and audit share one transaction and audit failure aborts the operation', async () => {
    auditPublic.record.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(service.recalculateOrderItem(orderItemId, {
      permissions: ['FINANCE:WRITE'],
    })).rejects.toThrow('audit unavailable');

    expect(repository.upsertByOrderItem).toHaveBeenCalledWith(
      orderItemId, expect.any(Object), { session: transactionSession },
    );
    expect(transactionSession.withTransaction).toHaveBeenCalledTimes(1);
    expect(transactionSession.endSession).toHaveBeenCalledTimes(1);
  });

  test('order recalculation aborts before audit when a later item upsert fails', async () => {
    const secondOrderItemId = '660000000000000000140222';
    orderPublic.listItemsByOrder.mockResolvedValueOnce([
      item, { ...item, _id: secondOrderItemId },
    ]);
    orderPublic.findItemById
      .mockResolvedValueOnce(item)
      .mockResolvedValueOnce({ ...item, _id: secondOrderItemId });
    repository.upsertByOrderItem
      .mockImplementationOnce(async (_id, payload) => ({ _id: '660000000000000000140099', ...payload }))
      .mockRejectedValueOnce(new Error('second snapshot failed'));

    await expect(service.recalculateOrder(orderId, {
      permissions: ['FINANCE:WRITE'],
    })).rejects.toThrow('second snapshot failed');

    expect(repository.upsertByOrderItem).toHaveBeenCalledTimes(2);
    expect(repository.upsertByOrderItem.mock.calls.every((call) => (
      call[2]?.session === transactionSession
    ))).toBe(true);
    expect(auditPublic.record).not.toHaveBeenCalled();
    expect(transactionSession.endSession).toHaveBeenCalledTimes(1);
  });

  test('transaction callback replay reuses one server-owned recalculation key', async () => {
    transactionSession.withTransaction.mockImplementationOnce(async (callback) => {
      await callback();
      await callback();
    });

    await service.recalculateOrderItem(
      orderItemId,
      { permissions: ['FINANCE:WRITE'] },
      { requestId: 'request-retry-key' },
    );

    expect(auditPublic.record).toHaveBeenCalledTimes(2);
    const keys = auditPublic.record.mock.calls.map(([event]) => event.deduplicationKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(new RegExp(
      `^finance-recalculation:finance_order_item_recalculated:order_item:${orderItemId}:`,
    ));
    expect(keys[0]).not.toContain('request-retry-key');
  });

  test('separate recalculations with the same request ID get distinct server-owned keys', async () => {
    const httpContext = { requestId: 'client-reused-request-id' };

    await service.recalculateOrderItem(orderItemId, { permissions: ['FINANCE:WRITE'] }, httpContext);
    await service.recalculateOrderItem(orderItemId, { permissions: ['FINANCE:WRITE'] }, httpContext);

    const keys = auditPublic.record.mock.calls.map(([event]) => event.deduplicationKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys.every((key) => !key.includes(httpContext.requestId))).toBe(true);
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

  test('team-scoped writer can recalculate an item assigned to that team', async () => {
    authPublic.canAccessScope.mockReturnValue(false);

    await service.recalculateOrderItem(orderItemId, {
      permissions: [],
      scopes: [{
        scopeType: 'team',
        scopeId: '660000000000000000140009',
        permissions: ['FINANCE:WRITE'],
      }],
    });

    expect(repository.upsertByOrderItem).toHaveBeenCalledTimes(1);
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
      missingCostReason: 'COST_ESTIMATE_NOT_AVAILABLE',
      calculationHistory: [expect.objectContaining({
        snapshotStatus: 'MISSING_COST',
        missingCostReason: 'COST_ESTIMATE_NOT_AVAILABLE',
      })],
      grossProfitAmount: null,
      grossMarginBps: null,
    }), { session: transactionSession });
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

  test('order summary exposes all item deductions and recalculation history', async () => {
    repository.listByOrder.mockResolvedValueOnce([{
      orderId,
      orderItemId,
      shopId,
      customerPaidAmount: 10000,
      feeAmount: 900,
      refundAmount: 200,
      discountAmount: 300,
      baseCostAmount: 4000,
      totalCostAmount: 4500,
      grossProfitAmount: 4100,
      currency: 'USD',
      snapshotStatus: 'ESTIMATED',
      calculationHistory: [{
        calculatedAt: new Date('2026-08-03T03:00:00.000Z'),
        snapshotStatus: 'ESTIMATED',
        costStatus: 'PRESENT',
        missingCostReason: null,
      }],
    }]);

    const result = await service.getOrderSummary(orderId, { permissions: ['FINANCE:READ'] });

    expect(result.snapshots[0]).toMatchObject({
      orderPnl: {
        marketplaceFeeAmount: 900,
        refundAmount: 200,
        discountAmount: 300,
        baseCostAmount: 4000,
        additionalFulfillmentCostAmount: 500,
        totalDeductionAmount: 5900,
        profitAmount: 4100,
      },
      calculationHistory: [expect.objectContaining({ snapshotStatus: 'ESTIMATED' })],
    });
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

    const expectedQuery = { page: 1, limit: 20, accessOr: [
      { shopId },
      { shopId: secondShopId },
      { teamId: '660000000000000000140012' },
    ] };
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
const mongoose = require('mongoose');
