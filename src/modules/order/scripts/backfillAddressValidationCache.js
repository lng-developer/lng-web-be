const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const Order = require('../models/order.model');
const AddressValidationCache = require('../models/addressValidationCache.model');
const addressValidationCacheRepository = require('../repositories/addressValidationCache.repository');

function parseArgs(argv = process.argv.slice(2)) {
  return argv.reduce((result, arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
    return { ...result, [key]: value };
  }, {});
}

async function backfillAddressValidationCache({ apply = false, batchSize = 100 } = {}) {
  const size = Math.min(Math.max(Number(batchSize) || 100, 1), 500);
  const summary = {
    database: mongoose.connection.db?.databaseName || null,
    apply,
    totalValidOrders: 0,
    uniqueAddressesProcessed: 0,
    cachedCount: 0,
    failures: [],
  };

  const query = {
    'shippingAddress.countryCode': 'US',
    addressValidationStatus: 'VALID',
    'shippingAddress.addressLine1': { $ne: null },
  };

  summary.totalValidOrders = await Order.countDocuments(query);
  if (!summary.totalValidOrders) return summary;

  const seenKeys = new Set();
  let lastId = null;

  while (true) {
    const batchQuery = lastId ? { ...query, _id: { $gt: lastId } } : query;
    const orders = await Order.find(batchQuery)
      .sort({ _id: 1 })
      .limit(size)
      .select('shippingAddress externalData.addressValidation')
      .lean();

    if (!orders.length) break;

    for (const order of orders) {
      lastId = order._id;
      const shippingAddress = order.shippingAddress || {};
      if (!shippingAddress.addressLine1) continue;

      const addressKey = addressValidationCacheRepository.computeAddressKey(shippingAddress);
      if (seenKeys.has(addressKey)) continue;
      seenKeys.add(addressKey);
      summary.uniqueAddressesProcessed += 1;

      if (apply) {
        try {
          const validationData = order.externalData?.addressValidation || {};
          const normalizedAddress = validationData.normalizedAddress || {
            addressLine1: shippingAddress.addressLine1,
            addressLine2: shippingAddress.addressLine2 || null,
            city: shippingAddress.city || null,
            stateOrProvince: shippingAddress.stateOrProvince || null,
            stateOrProvinceCode: shippingAddress.stateOrProvinceCode || null,
            postalCode: shippingAddress.postalCode || null,
            countryCode: shippingAddress.countryCode || 'US',
          };

          await addressValidationCacheRepository.upsertCache(addressKey, {
            rawAddress: {
              street: [shippingAddress.addressLine1, shippingAddress.addressLine2, shippingAddress.addressLine3]
                .filter(Boolean)
                .join(' '),
              city: shippingAddress.city || '',
              state: shippingAddress.stateOrProvinceCode || shippingAddress.stateOrProvince || '',
              postalCode: shippingAddress.postalCode || '',
              countryCode: shippingAddress.countryCode || 'US',
            },
            provider: validationData.provider || 'smarty',
            status: 'VALID',
            reason: validationData.reason || 'Backfilled from verified valid order',
            normalizedAddress,
            analysis: validationData.analysis || null,
            candidates: validationData.candidates || null,
          });
          summary.cachedCount += 1;
        } catch (error) {
          summary.failures.push({ orderId: String(order._id), error: error.message });
        }
      }
    }
  }

  return summary;
}

async function main() {
  const args = parseArgs();
  await connectDatabase();
  try {
    await AddressValidationCache.createIndexes();
    const result = await backfillAddressValidationCache({
      apply: String(args.apply || 'false').toLowerCase() === 'true',
      batchSize: args['batch-size'],
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { backfillAddressValidationCache, parseArgs };
