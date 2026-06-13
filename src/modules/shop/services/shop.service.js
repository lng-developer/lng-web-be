const mongoose = require('mongoose');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { normalizePagination } = require('../../../shared/utils/pagination');
const authPublic = require('../../auth/public');
const shopPublic = require('../public');
const shopRepository = require('../repositories/shop.repository');
const { shopStatuses } = require('../models/shop.model');
const { toShopDto, toPaginatedResponse } = require('../dtos/shop.dto');

const SHOP_SCOPE_TYPE = 'shop';
const SHOP_READ_PERMISSION = 'SHOPS:READ';
const ACTIVE_SCOPE_STATUS = 'active';
const INACTIVE_SCOPE_STATUS = 'inactive';

function assertValidObjectId(value, fieldName) {
  if (!mongoose.isValidObjectId(value)) {
    throw new AppError(`${fieldName} is invalid`, httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
}

function mapShopStatusToScopeStatus(status) {
  return status === shopStatuses.ACTIVE ? ACTIVE_SCOPE_STATUS : INACTIVE_SCOPE_STATUS;
}

async function syncShopScope(shop) {
  await authPublic.syncScopeRegistry({
    scopeType: SHOP_SCOPE_TYPE,
    scopeId: shop._id || shop.id,
    name: shop.name,
    status: mapShopStatusToScopeStatus(shop.status),
  });
}

function hasGlobalShopRead(authContext = {}) {
  return (authContext.permissions || []).includes(SHOP_READ_PERMISSION);
}

function getScopedReadableShopIds(authContext = {}) {
  return [...new Set((authContext.scopes || [])
    .filter((scope) => (
      scope.scopeType === SHOP_SCOPE_TYPE
      && scope.scopeId
      && (scope.permissions || []).includes(SHOP_READ_PERMISSION)
    ))
    .map((scope) => String(scope.scopeId)))];
}

function emptyPaginatedShopResult(query = {}) {
  const { page, limit } = normalizePagination(query);

  return toPaginatedResponse({
    items: [],
    total: 0,
    page,
    limit,
  }, toShopDto);
}

async function createShop(payload) {
  const shop = await shopRepository.create({
    name: payload.name,
    currency: payload.currency,
    status: shopStatuses.ACTIVE,
  });

  await syncShopScope(shop);

  return toShopDto(shop);
}

async function getShop(shopId) {
  assertValidObjectId(shopId, 'shopId');
  const shop = await shopPublic.assertShopIsActive(shopId);

  return toShopDto(shop);
}

async function updateShopStatus(shopId, status) {
  assertValidObjectId(shopId, 'shopId');
  const shop = await shopRepository.updateStatus(shopId, status);

  if (!shop) {
    throw new AppError('Shop not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  await syncShopScope(shop);

  return toShopDto(shop);
}

async function listShops(query = {}, authContext = {}) {
  if (hasGlobalShopRead(authContext)) {
    const result = await shopRepository.list(query);
    return toPaginatedResponse(result, toShopDto);
  }

  const shopIds = getScopedReadableShopIds(authContext);

  if (shopIds.length === 0) {
    return emptyPaginatedShopResult(query);
  }

  const result = await shopRepository.list({
    ...query,
    shopIds,
  });

  return toPaginatedResponse(result, toShopDto);
}

module.exports = {
  createShop,
  getShop,
  updateShopStatus,
  listShops,
  mapShopStatusToScopeStatus,
};
