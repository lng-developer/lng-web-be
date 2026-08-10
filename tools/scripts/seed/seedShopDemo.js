const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const logger = require('../../../src/shared/utils/logger');
const Shop = require('../../../src/modules/shop/models/shop.model');
const { syncShopScopes } = require('../maintenance/syncShopScopes');

const { shopStatuses } = Shop;

const demoShops = Object.freeze([
  {
    _id: '660000000000000000000201',
    name: 'Football US Shop',
    currency: 'USD',
    status: shopStatuses.ACTIVE,
  },
  {
    _id: '660000000000000000000202',
    name: 'Pet Memorial Shop',
    currency: 'USD',
    status: shopStatuses.ACTIVE,
  },
  {
    _id: '660000000000000000000203',
    name: 'Nurse Gift Shop',
    currency: 'USD',
    status: shopStatuses.ACTIVE,
  },
  {
    _id: '660000000000000000000204',
    name: 'Family Custom Shirt Shop',
    currency: 'USD',
    status: shopStatuses.INACTIVE,
  },
  {
    _id: '660000000000000000000205',
    name: 'Compliance Hold Shop',
    currency: 'USD',
    status: shopStatuses.SUSPENDED,
  },
]);

async function upsertDemoShops() {
  for (const shop of demoShops) {
    await Shop.findOneAndUpdate(
      { _id: shop._id },
      {
        $set: {
          name: shop.name,
          currency: shop.currency,
          status: shop.status,
        },
        $setOnInsert: {
          _id: new mongoose.Types.ObjectId(shop._id),
        },
      },
      {
        returnDocument: 'after',
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    ).lean();
  }
}

async function seedShopDemo() {
  await connectDatabase();

  try {
    await upsertDemoShops();
    await syncShopScopes({ manageConnection: false });

    logger.info('shop_demo_seed_completed', {
      shops: demoShops.length,
    });
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  seedShopDemo().catch((error) => {
    logger.error('shop_demo_seed_failed', { error });
    process.exit(1);
  });
}

module.exports = {
  demoShops,
  seedShopDemo,
  upsertDemoShops,
};
