const AppError = require('../../shared/errors/appError');
const errorCodes = require('../../shared/constants/errorCodes');
const httpStatus = require('../../shared/constants/httpStatus');
const shopRepository = require('./repositories/shop.repository');
const { shopStatuses } = require('./models/shop.model');

async function findById(shopId) {
  return shopRepository.findById(shopId);
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

const publicPort = {
  findById,
  assertShopIsActive,
};

module.exports = publicPort;
