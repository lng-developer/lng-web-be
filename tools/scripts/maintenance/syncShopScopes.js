const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const logger = require('../../../src/shared/utils/logger');
const authPublic = require('../../../src/modules/auth/public');
const {
  accessScopeTypes,
  scopeRegistryStatuses,
} = require('../../../src/modules/auth/constants/auth.constants');
const Shop = require('../../../src/modules/shop/models/shop.model');
const { shopStatuses } = Shop;

function toScopeStatus(status) {
  return status === shopStatuses.ACTIVE
    ? scopeRegistryStatuses.ACTIVE
    : scopeRegistryStatuses.INACTIVE;
}

async function syncShopScopes({ manageConnection = true } = {}) {
  if (manageConnection) {
    await connectDatabase();
  }

  try {
    const shops = await Shop.find({})
      .select('_id name status')
      .lean();

    for (const shop of shops) {
      await authPublic.syncScopeRegistry({
        scopeType: accessScopeTypes.SHOP,
        scopeId: shop._id,
        name: shop.name,
        status: toScopeStatus(shop.status),
      });
    }

    logger.info('shop_scopes_sync_completed', {
      shops: shops.length,
    });

    return { shops: shops.length };
  } finally {
    if (manageConnection) {
      await disconnectDatabase();
    }
  }
}

if (require.main === module) {
  syncShopScopes().catch((error) => {
    logger.error('shop_scopes_sync_failed', { error });
    process.exit(1);
  });
}

module.exports = {
  syncShopScopes,
};
