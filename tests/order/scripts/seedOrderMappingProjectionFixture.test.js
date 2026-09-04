jest.mock('../../../src/modules/order/models/order.model', () => ({ findOneAndUpdate: jest.fn() }));
jest.mock('../../../src/modules/order/models/orderItem.model', () => ({ findOneAndUpdate: jest.fn() }));
jest.mock('../../../src/modules/vendor/models/vendor.model', () => ({ findOneAndUpdate: jest.fn() }));
jest.mock('../../../src/modules/mapping/models/fulfillmentPlan.model', () => ({ findOneAndUpdate: jest.fn() }));
jest.mock('../../../src/modules/order/models/orderWorkbenchProjection.model', () => ({ findOne: jest.fn() }));
jest.mock('../../../src/modules/order/services/orderQuery.service', () => ({ listOrderWorkbench: jest.fn() }));
jest.mock('../../../src/modules/order/services/orderWorkbenchProjection.service', () => ({ upsertOrderWorkbenchRow: jest.fn() }));
jest.mock('../../../src/config/database', () => ({ connectDatabase: jest.fn(), disconnectDatabase: jest.fn() }));

const Order = require('../../../src/modules/order/models/order.model');
const OrderItem = require('../../../src/modules/order/models/orderItem.model');
const Vendor = require('../../../src/modules/vendor/models/vendor.model');
const FulfillmentPlan = require('../../../src/modules/mapping/models/fulfillmentPlan.model');
const OrderWorkbenchProjection = require('../../../src/modules/order/models/orderWorkbenchProjection.model');
const orderQueryService = require('../../../src/modules/order/services/orderQuery.service');
const projectionService = require('../../../src/modules/order/services/orderWorkbenchProjection.service');

const chain = (value) => ({ lean: jest.fn().mockResolvedValue(value) });

describe('seedOrderMappingProjectionFixture', () => {
  test('upserts a mapped order and its projection row for a supplied test shop', async () => {
    Vendor.findOneAndUpdate.mockReturnValue(chain({ _id: '660000000000000000009003', code: 'TESTPARITY', name: 'Test Parity Vendor', status: 'ACTIVE' }));
    Order.findOneAndUpdate.mockReturnValue(chain({ _id: '660000000000000000009001', shopId: '660000000000000000009999', externalOrderId: 'ORDER-PROJECTION-MAPPING-PARITY-001' }));
    OrderItem.findOneAndUpdate.mockReturnValue(chain({ _id: '660000000000000000009002', orderId: '660000000000000000009001', sku: 'PARITY-TS1S-001' }));
    FulfillmentPlan.findOneAndUpdate.mockReturnValue(chain({ _id: '660000000000000000009004' }));
    const row = {
      order: { _id: '660000000000000000009001', shopId: '660000000000000000009999', externalOrderId: 'ORDER-PROJECTION-MAPPING-PARITY-001' },
      items: [{ item: { _id: '660000000000000000009002' }, fulfillmentPlan: { vendor: { id: '660000000000000000009003' } } }],
    };
    orderQueryService.listOrderWorkbench.mockResolvedValue({ items: [row] });
    projectionService.upsertOrderWorkbenchRow.mockResolvedValue({ orderId: row.order._id });
    OrderWorkbenchProjection.findOne.mockReturnValue(chain({ orderId: row.order._id }));

    const { seedOrderMappingProjectionFixture } = require('../../../scripts/seedOrderMappingProjectionFixture');
    const result = await seedOrderMappingProjectionFixture({ shopId: '660000000000000000009999', databaseName: 'lng_web_be_test' });

    expect(FulfillmentPlan.findOneAndUpdate).toHaveBeenCalledWith(
      { orderItemId: '660000000000000000009002' },
      expect.objectContaining({ $set: expect.objectContaining({
        status: 'READY',
        snapshot: expect.objectContaining({ vendor: expect.objectContaining({ id: '660000000000000000009003' }) }),
      }) }),
      expect.objectContaining({ upsert: true }),
    );
    expect(projectionService.upsertOrderWorkbenchRow).toHaveBeenCalledWith(row, { source: 'ORDER_PROJECTION_MAPPING_PARITY_SEED' });
    expect(result).toMatchObject({
      orderId: '660000000000000000009001',
      orderItemId: '660000000000000000009002',
      vendorId: '660000000000000000009003',
      projectionVerified: true,
    });
  });
});
