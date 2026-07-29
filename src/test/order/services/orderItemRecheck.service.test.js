jest.mock('../../../modules/order/repositories/orderItem.repository', () => ({
  findById: jest.fn(),
}));

jest.mock('../../../modules/customization/public', () => ({
  getByOrderItemDto: jest.fn(),
}));

jest.mock('../../../modules/mapping/public', () => ({
  recheckFulfillmentPlan: jest.fn(),
}));

jest.mock('../../../modules/production/public', () => ({
  createOrRecheckTaskForOrderItem: jest.fn(),
}));

jest.mock('../../../modules/shipment/public', () => ({
  getShipmentByOrderItem: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));
jest.mock('../../../modules/audit/public', () => ({ record: jest.fn() }));

const orderItemRepository = require('../../../modules/order/repositories/orderItem.repository');
const customizationPublic = require('../../../modules/customization/public');
const mappingPublic = require('../../../modules/mapping/public');
const productionPublic = require('../../../modules/production/public');
const shipmentPublic = require('../../../modules/shipment/public');
const auditPublic = require('../../../modules/audit/public');
const service = require('../../../modules/order/services/orderItemRecheck.service');

describe('orderItemRecheck.service', () => {
  const orderItemId = '660000000000000000000401';
  const shopId = '660000000000000000000201';

  const item = {
    _id: orderItemId,
    orderId: '660000000000000000000301',
    shopId,
    status: 'MAPPING_PENDING',
    customizationRawSummary: { hasCustomization: true },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    orderItemRepository.findById
      .mockResolvedValueOnce(item)
      .mockResolvedValueOnce({ ...item, status: 'NEED_PRODUCTION' });
    customizationPublic.getByOrderItemDto.mockResolvedValue({ status: 'PARSED' });
    mappingPublic.recheckFulfillmentPlan.mockResolvedValue({
      id: '660000000000000000000501',
      status: 'READY',
      blockingReasons: [],
    });
    productionPublic.createOrRecheckTaskForOrderItem.mockResolvedValue({
      id: '660000000000000000000601',
      status: 'NEED_PRODUCTION',
      blockers: [],
    });
    shipmentPublic.getShipmentByOrderItem.mockResolvedValue(null);
  });

  test('rechecks customization mapping production shipment and reloads item status', async () => {
    const result = await service.recheckOrderItem(orderItemId, { permissions: ['ORDERS:WRITE'] });

    expect(customizationPublic.getByOrderItemDto).toHaveBeenCalledWith(orderItemId, expect.any(Object));
    expect(mappingPublic.recheckFulfillmentPlan).toHaveBeenCalledWith(orderItemId, {}, expect.any(Object));
    expect(productionPublic.createOrRecheckTaskForOrderItem).toHaveBeenCalledWith(orderItemId, expect.any(Object));
    expect(shipmentPublic.getShipmentByOrderItem).toHaveBeenCalledWith(orderItemId, expect.any(Object));
    expect(result).toMatchObject({
      orderItemId,
      statusBefore: 'MAPPING_PENDING',
      statusAfter: 'NEED_PRODUCTION',
      steps: {
        customization: { ok: true, status: 'PARSED' },
        mapping: { ok: true, status: 'READY', planId: '660000000000000000000501' },
        production: { ok: true, status: 'NEED_PRODUCTION', taskId: '660000000000000000000601' },
        shipment: { ok: true, status: null },
      },
      blockingReasons: [],
    });
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_ITEM_RECHECKED', entityType: 'ORDER_ITEM', entityId: orderItemId,
      metadata: expect.not.objectContaining({ trackingNumber: expect.anything() }),
    }), { session: null });
  });

  test('skips production when mapping is still blocked', async () => {
    mappingPublic.recheckFulfillmentPlan.mockResolvedValue({
      ready: false,
      blockingReasons: ['NO_VENDOR_COST_CENTER_CANDIDATE'],
    });

    const result = await service.recheckOrderItem(orderItemId, { permissions: ['ORDERS:WRITE'] });

    expect(productionPublic.createOrRecheckTaskForOrderItem).not.toHaveBeenCalled();
    expect(result.steps.production).toEqual({ ok: true, status: 'SKIPPED' });
    expect(result.blockingReasons).toContain('NO_VENDOR_COST_CENTER_CANDIDATE');
  });

  test('keeps a completed cross-module recheck successful when audit storage is unavailable', async () => {
    auditPublic.record.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(service.recheckOrderItem(orderItemId, { permissions: ['ORDERS:WRITE'] }))
      .resolves.toMatchObject({ orderItemId, statusAfter: 'NEED_PRODUCTION' });
  });
});
