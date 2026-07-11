jest.mock('../../../modules/order/public', () => ({
  findItemById: jest.fn(),
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

jest.mock('../../../modules/finance/repositories/financeSnapshot.repository', () => ({
  findByOrderItem: jest.fn(),
  list: jest.fn(),
  listByOrder: jest.fn(),
  listByOrderItemIds: jest.fn(),
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
    orderPublic.findItemById.mockResolvedValue(item);
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
    expect(result.snapshotStatus).toBe('MISSING_COST');
  });

  test('missing order item returns not found', async () => {
    orderPublic.findItemById.mockResolvedValueOnce(null);

    await expect(service.recalculateOrderItem(orderItemId, { permissions: ['FINANCE:WRITE'] }))
      .rejects.toMatchObject({ statusCode: 404, code: 'RESOURCE_NOT_FOUND' });
  });

  test('scoped user cannot read snapshot from unauthorized shop', async () => {
    authPublic.canAccessScope.mockReturnValueOnce(false);
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
});
