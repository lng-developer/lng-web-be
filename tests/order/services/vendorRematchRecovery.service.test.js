jest.mock('../../../src/modules/order/repositories/orderItem.repository', () => ({
  findById: jest.fn(),
}));
jest.mock('../../../src/modules/order/repositories/order.repository', () => ({
  findById: jest.fn(),
}));
jest.mock('../../../src/modules/order/services/orderAccess.service', () => ({
  assertCanWriteOrder: jest.fn(),
}));
jest.mock('../../../src/modules/order/services/orderItemStatusTransition.service', () => ({
  transitionItemStatus: jest.fn(),
}));
jest.mock('../../../src/modules/order/services/orderWorkbenchProjection.service', () => ({
  rebuildOrderWorkbenchProjection: jest.fn(),
}));
jest.mock('../../../src/modules/vendorSubmission/public', () => ({
  getByOrderItemId: jest.fn(),
  cancelAfterExternalCancellation: jest.fn(),
}));
jest.mock('../../../src/modules/production/public', () => ({
  cancelTaskAfterExternalVendorCancellation: jest.fn(),
}));
jest.mock('../../../src/modules/mapping/public', () => ({
  resetFulfillmentPlanForVendorRematch: jest.fn(),
}));
jest.mock('../../../src/modules/shipment/public', () => ({
  getShipmentByOrderItem: jest.fn(),
  updateStatus: jest.fn(),
}));

const orderItemRepository = require('../../../src/modules/order/repositories/orderItem.repository');
const orderRepository = require('../../../src/modules/order/repositories/order.repository');
const orderAccess = require('../../../src/modules/order/services/orderAccess.service');
const status = require('../../../src/modules/order/services/orderItemStatusTransition.service');
const workbench = require('../../../src/modules/order/services/orderWorkbenchProjection.service');
const vendorSubmission = require('../../../src/modules/vendorSubmission/public');
const production = require('../../../src/modules/production/public');
const mapping = require('../../../src/modules/mapping/public');
const shipment = require('../../../src/modules/shipment/public');
const service = require('../../../src/modules/order/services/vendorRematchRecovery.service');

describe('vendorRematchRecovery.service', () => {
  const orderItemId = '660000000000000000000401';
  const orderId = '660000000000000000000301';
  const authContext = { permissions: ['ORDERS:WRITE'], accountId: '660000000000000000000901' };
  const payload = { externalCancellationConfirmed: true, reason: 'Vendor cancelled because item is unavailable' };

  beforeEach(() => {
    jest.clearAllMocks();
    orderItemRepository.findById.mockResolvedValue({ _id: orderItemId, orderId });
    orderRepository.findById.mockResolvedValue({ _id: orderId, shopId: '660000000000000000000201' });
    status.transitionItemStatus.mockResolvedValue({ _id: orderItemId, orderId, status: 'MAPPING_PENDING' });
    shipment.getShipmentByOrderItem.mockResolvedValue({
      id: '660000000000000000000601', status: 'CANCELLED', trackingNumber: null, marketplaceConfirmationStatus: 'PENDING',
    });
  });

  test('resets an externally cancelled submission without cancelling it again', async () => {
    vendorSubmission.getByOrderItemId.mockResolvedValue({ id: '660000000000000000000501', status: 'CANCELLED' });

    const result = await service.recoverForVendorRematch(orderItemId, payload, authContext);

    expect(result.status).toBe('MAPPING_PENDING');
    expect(vendorSubmission.cancelAfterExternalCancellation).not.toHaveBeenCalled();
    expect(shipment.updateStatus).not.toHaveBeenCalled();
    expect(production.cancelTaskAfterExternalVendorCancellation).toHaveBeenCalledWith(orderItemId, { reason: payload.reason }, authContext);
    expect(mapping.resetFulfillmentPlanForVendorRematch).toHaveBeenCalledWith(orderItemId, authContext);
    expect(workbench.rebuildOrderWorkbenchProjection).toHaveBeenCalledWith(orderId, authContext, { source: 'VENDOR_REMATCH_RECOVERY' });
  });
});
