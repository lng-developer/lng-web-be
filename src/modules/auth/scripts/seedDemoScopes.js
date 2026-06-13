const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const ScopeRegistry = require('../models/scopeRegistry.model');
const {
  accessScopeTypes,
  scopeRegistryStatuses,
} = require('../constants/auth.constants');

const demoScopes = [
  {
    scopeType: accessScopeTypes.DEPARTMENT,
    scopeId: '660000000000000000000001',
    name: 'Operations Department',
  },
  {
    scopeType: accessScopeTypes.TEAM,
    scopeId: '660000000000000000000101',
    name: 'Sales Team',
  },
  {
    scopeType: accessScopeTypes.TEAM,
    scopeId: '660000000000000000000102',
    name: 'Design Team',
  },
  {
    scopeType: accessScopeTypes.SHOP,
    scopeId: '660000000000000000000201',
    name: 'Amazon US - Main',
  },
  {
    scopeType: accessScopeTypes.SHOP,
    scopeId: '660000000000000000000202',
    name: 'Etsy - Handmade',
  },
];

async function upsertDemoScopes() {
  for (const scope of demoScopes) {
    await ScopeRegistry.findOneAndUpdate(
      {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
      },
      {
        $set: {
          name: scope.name,
          status: scopeRegistryStatuses.ACTIVE,
        },
        $setOnInsert: {
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
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

async function seedDemoScopes() {
  await connectDatabase();

  try {
    await upsertDemoScopes();
    logger.info('rbac_demo_scopes_seed_completed', {
      scopes: demoScopes.length,
    });
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  seedDemoScopes().catch((error) => {
    logger.error('rbac_demo_scopes_seed_failed', { error });
    process.exit(1);
  });
}

module.exports = {
  demoScopes,
  upsertDemoScopes,
  seedDemoScopes,
};
