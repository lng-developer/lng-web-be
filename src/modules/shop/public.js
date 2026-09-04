const AppError = require('../../shared/errors/appError');
const errorCodes = require('../../shared/constants/errorCodes');
const httpStatus = require('../../shared/constants/httpStatus');
const shopRepository = require('./repositories/shop.repository');
const { shopStatuses } = require('./models/shop.model');

async function findById(shopId) {
  return shopRepository.findById(shopId);
}

async function findByIds(shopIds) {
  return shopRepository.findByIds(shopIds);
}

async function assertShopIsActive(shopId) {
  const shop = await shopRepository.findById(shopId);

  if (!shop) {
    throw new AppError('Shop not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  if (shop.status !== shopStatuses.ACTIVE) {
    throw new AppError('Shop is not active', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  return shop;
}

async function listActiveShops({ shopIds } = {}) {
  if (shopIds && shopIds.length === 0) return [];
  const result = await shopRepository.list({
    page: 1,
    limit: 1000,
    status: shopStatuses.ACTIVE,
    shopIds,
  });
  return result.items;
}

async function listActiveShopOptions({ shopIds } = {}) {
  if (shopIds && shopIds.length === 0) return [];
  return shopRepository.listActiveForOptions({ shopIds });
}

const publicPort = {
  findById,
  findByIds,
  assertShopIsActive,
  listActiveShops,
  listActiveShopOptions,
};

module.exports = publicPort;
