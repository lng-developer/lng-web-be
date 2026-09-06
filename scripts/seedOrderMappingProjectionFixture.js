const Order = require('../src/modules/order/models/order.model');
const OrderItem = require('../src/modules/order/models/orderItem.model');
const Vendor = require('../src/modules/vendor/models/vendor.model');
const FulfillmentPlan = require('../src/modules/mapping/models/fulfillmentPlan.model');
const OrderWorkbenchProjection = require('../src/modules/order/models/orderWorkbenchProjection.model');
const orderQueryService = require('../src/modules/order/services/orderQuery.service');
const projectionService = require('../src/modules/order/services/orderWorkbenchProjection.service');

async function seedOrderMappingProjectionFixture({ shopId, databaseName } = {}) {
  if (databaseName !== 'lng_web_be_test') throw new Error('Refusing to seed non-test database');
  const vendor = await Vendor.findOneAndUpdate(
    { code: 'TESTPARITY' },
    { $set: { code: 'TESTPARITY', name: 'Test Parity Vendor', status: 'ACTIVE' } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
  const order = await Order.findOneAndUpdate(
    { salesChannelCode: 'AMAZON', marketplaceCode: 'US', externalOrderId: 'ORDER-PROJECTION-MAPPING-PARITY-001' },
    { $set: { shopId, salesChannelCode: 'AMAZON', marketplaceCode: 'US', externalOrderId: 'ORDER-PROJECTION-MAPPING-PARITY-001', status: 'IMPORTED' } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
  const item = await OrderItem.findOneAndUpdate(
    { orderId: order._id, externalItemId: 'ORDER-PROJECTION-MAPPING-PARITY-ITEM-001' },
    { $set: { orderId: order._id, externalItemId: 'ORDER-PROJECTION-MAPPING-PARITY-ITEM-001', sku: 'PARITY-TS1S-001', status: 'IMPORTED' } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
  await FulfillmentPlan.findOneAndUpdate(
    { orderItemId: item._id },
    { $set: { orderItemId: item._id, status: 'READY', snapshot: { vendor: { id: String(vendor._id), code: vendor.code, name: vendor.name } } } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
  const { items } = await orderQueryService.listOrderWorkbench({ shopId, search: order.externalOrderId });
  const row = items[0];
  await projectionService.upsertOrderWorkbenchRow(row, { source: 'ORDER_PROJECTION_MAPPING_PARITY_SEED' });
  const projection = await OrderWorkbenchProjection.findOne({ orderId: order._id }).lean();
  return { orderId: String(order._id), orderItemId: String(item._id), vendorId: String(vendor._id), projectionVerified: Boolean(projection) };
}

module.exports = { seedOrderMappingProjectionFixture };
