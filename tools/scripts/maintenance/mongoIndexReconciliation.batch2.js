function covered(collection, indexName, key, coveredByName, coveredByKey) {
  return {
    collection,
    indexName,
    originalDefinition: { name: indexName, key },
    coveredBy: { name: coveredByName, key: coveredByKey },
  };
}

const listingsIdentityKey = {
  shopId: 1,
  salesChannelCode: 1,
  marketplaceCode: 1,
  asin: 1,
};

const requiredIndexes = Object.freeze([
  {
    collection: 'listings',
    installedDefinition: {
      name: 'shopId_1_salesChannelCode_1_marketplaceCode_1_asin_1',
      key: listingsIdentityKey,
    },
    desiredDefinition: {
      name: 'shopId_1_salesChannelCode_1_marketplaceCode_1_asin_1',
      key: listingsIdentityKey,
      unique: true,
      partialFilterExpression: { asin: { $type: 'string', $gt: '' } },
    },
    duplicatePipeline: [
      { $match: { asin: { $type: 'string', $gt: '' } } },
      {
        $group: {
          _id: {
            shopId: '$shopId',
            salesChannelCode: '$salesChannelCode',
            marketplaceCode: '$marketplaceCode',
            asin: '$asin',
          },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ],
  },
  {
    collection: 'hrattendanceimportbatches',
    installedDefinition: null,
    desiredDefinition: {
      name: 'sourceBatchId_1',
      key: { sourceBatchId: 1 },
      unique: true,
    },
    duplicatePipeline: [
      { $group: { _id: '$sourceBatchId', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ],
  },
]);

const reductions = Object.freeze([
  covered('hrattendancedailies', 'workDateKey_1', { workDateKey: 1 }, 'workDateKey_-1_status_1', { workDateKey: -1, status: 1 }),
  covered('vendorcostcenters', 'vendorProductId_1', { vendorProductId: 1 }, 'vendorProductId_1_status_1', { vendorProductId: 1, status: 1 }),
  covered('vendorcostcenters', 'vendorId_1', { vendorId: 1 }, 'vendorId_1_status_1', { vendorId: 1, status: 1 }),
  covered('auditevents', 'entityType_1_entityId_1_createdAt_-1', { entityType: 1, entityId: 1, createdAt: -1 }, 'audit_entity_timeline', { entityType: 1, entityId: 1, createdAt: -1, _id: -1 }),
  covered('orders', 'shopId_1', { shopId: 1 }, 'shopId_1_orderedAt_-1', { shopId: 1, orderedAt: -1 }),
  covered('orders', 'salesChannelCode_1', { salesChannelCode: 1 }, 'salesChannelCode_1_marketplaceCode_1_externalStatus_1', { salesChannelCode: 1, marketplaceCode: 1, externalStatus: 1 }),
  covered('orderitems', 'salesChannelCode_1', { salesChannelCode: 1 }, 'salesChannelCode_1_marketplaceCode_1_externalOrderId_1', { salesChannelCode: 1, marketplaceCode: 1, externalOrderId: 1 }),
  covered('ordertimelines', 'orderId_1', { orderId: 1 }, 'orderId_1_createdAt_-1', { orderId: 1, createdAt: -1 }),
  covered('listings', 'shopId_1', { shopId: 1 }, 'shopId_1_status_1_sku_1', { shopId: 1, status: 1, sku: 1 }),
  covered('listings', 'productTypeGroupId_1', { productTypeGroupId: 1 }, 'productTypeGroupId_1_status_1', { productTypeGroupId: 1, status: 1 }),
]);

module.exports = { reductions, requiredIndexes };
