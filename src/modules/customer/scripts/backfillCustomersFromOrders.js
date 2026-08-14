const mongoose = require('mongoose');

const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const config = require('../../../config');
const customerPublic = require('../public');

const batchSize = Number(process.env.BATCH_SIZE || 100);
const apply = process.argv.includes('--apply');

function paidAmount(items) {
  return items.reduce((sum, item) => {
    const price = item.price || {};
    return sum
      + Number(price.itemPriceAmount || 0)
      + Number(price.itemTaxAmount || 0)
      + Number(price.shippingPriceAmount || 0)
      + Number(price.shippingTaxAmount || 0)
      + Number(price.giftWrapPriceAmount || 0)
      - Number(price.itemPromotionDiscountAmount || 0)
      - Number(price.shipPromotionDiscountAmount || 0);
  }, 0);
}

function quantity(items) {
  return items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function hasBuyerIdentity(order) {
  return Boolean(
    order.buyer?.externalBuyerId
    || order.buyer?.emailMasked
    || order.buyer?.phoneMasked
    || order.buyer?.name
    || order.shippingAddress?.name,
  );
}

function buildSnapshot(order, items, shop) {
  const currency = items.find((item) => item.price?.currency)?.price.currency || 'USD';
  return {
    orderId: String(order._id),
    externalOrderId: order.externalOrderId,
    orderedAt: order.orderedAt || order.createdAt,
    salesChannelCode: order.salesChannelCode,
    marketplaceCode: order.marketplaceCode,
    shop: { id: order.shopId, name: shop?.name || null },
    buyer: order.buyer || {},
    shippingAddress: order.shippingAddress || {},
    pricing: {
      customerPaidAmount: paidAmount(items),
      totalCostAmount: 0,
      currency,
    },
    itemCount: items.length,
    quantity: quantity(items),
    caseStatus: order.caseStatus,
  };
}

async function run() {
  await connectDatabase();
  const db = mongoose.connection.db;
  const orders = db.collection('orders');
  const orderItems = db.collection('orderitems');
  const shops = db.collection('shops');

  const totalOrders = await orders.countDocuments();
  const cursor = orders.find({}, {
    projection: {
      shopId: 1,
      salesChannelCode: 1,
      marketplaceCode: 1,
      externalOrderId: 1,
      orderedAt: 1,
      createdAt: 1,
      buyer: 1,
      shippingAddress: 1,
      caseStatus: 1,
    },
  }).sort({ orderedAt: 1, _id: 1 }).batchSize(batchSize);

  const stats = {
    database: db.databaseName,
    mode: apply ? 'apply' : 'dry-run',
    totalOrders,
    scanned: 0,
    skippedNoIdentity: 0,
    projected: 0,
    failed: 0,
  };

  for await (const order of cursor) {
    stats.scanned += 1;
    if (!hasBuyerIdentity(order)) {
      stats.skippedNoIdentity += 1;
      continue;
    }

    try {
      const [items, shop] = await Promise.all([
        orderItems.find({ orderId: order._id }).toArray(),
        order.shopId ? shops.findOne({ _id: order.shopId }, { projection: { name: 1 } }) : null,
      ]);

      if (apply) {
        await customerPublic.upsertFromOrderSnapshot(buildSnapshot(order, items, shop));
      }
      stats.projected += 1;
    } catch (error) {
      stats.failed += 1;
      console.error(JSON.stringify({
        message: 'customer_backfill_order_failed',
        orderId: String(order._id),
        externalOrderId: order.externalOrderId,
        error: error.message,
      }));
    }
  }

  console.log(JSON.stringify(stats, null, 2));
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);

