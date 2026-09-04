const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const InternalTemplate = require('../models/internalTemplate.model');
const ProductTypeGroup = require('../models/productTypeGroup.model');

async function ensureCatalogIndexes({ manageConnection = true } = {}) {
  if (manageConnection) await connectDatabase();
  try {
    const [internalTemplates, productTypeGroups] = await Promise.all([
      InternalTemplate.createIndexes(),
      ProductTypeGroup.createIndexes(),
    ]);
    logger.info('catalog_indexes_created', { internalTemplates, productTypeGroups });
    return { internalTemplates, productTypeGroups };
  } finally {
    if (manageConnection) await disconnectDatabase();
  }
}

if (require.main === module) {
  ensureCatalogIndexes().catch((error) => {
    logger.error('catalog_indexes_create_failed', { error });
    process.exit(1);
  });
}

module.exports = { ensureCatalogIndexes };
