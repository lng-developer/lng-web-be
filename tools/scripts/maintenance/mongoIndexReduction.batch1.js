function covered(collection, indexName, key, coveredByName, coveredByKey, queryEvidence) {
  return {
    collection,
    indexName,
    originalDefinition: { name: indexName, key },
    classification: 'COVERED',
    coveredBy: { name: coveredByName, key: coveredByKey },
    queryEvidence,
  };
}

const batchOne = [
  covered('orders', 'orderedAt_1', { orderedAt: 1 }, 'orderedAt_-1__id_-1', { orderedAt: -1, _id: -1 }, [
    'src/modules/order/repositories/order.repository.js:15 default list sort',
    'explain: 814 keys and 814 docs for both indexes',
  ]),
  covered('orders', 'shopConnectionId_1', { shopConnectionId: 1 }, 'shopConnectionId_1_orderedAt_-1', { shopConnectionId: 1, orderedAt: -1 }, [
    'src/modules/order/repositories/order.repository.js buildFilter shopConnectionId',
    'explain: covering index accepted for shopConnectionId plus orderedAt sort',
  ]),
  covered('orderitems', 'orderId_1', { orderId: 1 }, 'orderId_1_createdAt_1__id_1', { orderId: 1, createdAt: 1, _id: 1 }, [
    'src/modules/order/repositories/orderItem.repository.js:160-180 order item reads',
    'explain: 1 key and 1 doc for both indexes',
  ]),
  covered('orderitems', 'asin_1', { asin: 1 }, 'asin_1_sku_1', { asin: 1, sku: 1 }, [
    'src/modules/order/repositories/orderItem.repository.js buildFilter and finance identity reads',
    'explain: 1 key and 1 doc for both indexes',
  ]),
  covered('orderitems', 'externalAccountId_1', { externalAccountId: 1 }, 'externalAccountId_1_createdAt_-1', { externalAccountId: 1, createdAt: -1 }, [
    'src/modules/order/repositories/orderItem.repository.js buildFilter external account reads',
    'explain: covering index accepted for externalAccountId plus createdAt sort',
  ]),
  covered('orderitems', 'shopId_1', { shopId: 1 }, 'shopId_1_createdAt_-1__id_-1', { shopId: 1, createdAt: -1, _id: -1 }, [
    'src/modules/order/repositories/orderItem.repository.js buildFilter shop reads',
    'explain: 28 keys and 28 docs for both indexes',
  ]),
  covered('financesnapshots', 'orderId_1', { orderId: 1 }, 'orderId_1_calculatedAt_-1', { orderId: 1, calculatedAt: -1 }, [
    'src/modules/finance/repositories/financeSnapshot.repository.js:39-40 listByOrder',
    'explain: 1 key and 1 doc for both indexes',
  ]),
  covered('financesnapshots', 'shopId_1', { shopId: 1 }, 'shopId_1_calculatedAt_-1', { shopId: 1, calculatedAt: -1 }, [
    'src/modules/finance/repositories/financeSnapshot.repository.js buildFilter shop reads',
    'explain: 28 keys and 28 docs for both indexes',
  ]),
  covered('financesnapshots', 'sellerEmployeeCode_1', { sellerEmployeeCode: 1 }, 'sellerEmployeeCode_1_calculatedAt_-1', { sellerEmployeeCode: 1, calculatedAt: -1 }, [
    'src/modules/finance/repositories/financeSnapshot.repository.js seller reporting filter',
    'explain: 4 keys and 4 docs for both indexes',
  ]),
  covered('financesnapshots', 'teamId_1', { teamId: 1 }, 'teamId_1_calculatedAt_-1', { teamId: 1, calculatedAt: -1 }, [
    'src/modules/finance/repositories/financeSnapshot.repository.js team reporting filter',
    'explain: covering index accepted for teamId plus calculatedAt sort',
  ]),
];

module.exports = { batchOne };
