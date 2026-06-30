const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const AppError = require('../../../shared/errors/appError');
const { salesChannelCodes, externalOrderSources } = require('../constants/externalOrderSources');
const { orderItemStatuses } = require('../constants/orderStatuses');

function validationError(message, details) {
  return new AppError(
    message,
    httpStatus.BAD_REQUEST,
    true,
    errorCodes.VALIDATION_ERROR,
    details,
  );
}

function conflictError(message, details) {
  return new AppError(
    message,
    httpStatus.CONFLICT,
    true,
    errorCodes.CONFLICT_ERROR,
    details,
  );
}

function requireValue(value, field) {
  if (value === undefined || value === null || value === '') {
    throw validationError(`${field} is required`, { field });
  }
}

function compactObject(input) {
  return Object.entries(input).reduce((result, [key, value]) => {
    if (value !== undefined) {
      result[key] = value;
    }

    return result;
  }, {});
}

function normalizeUpper(value) {
  if (value === undefined || value === null) return value;
  return String(value).trim().toUpperCase();
}

function normalizeTrimmed(value) {
  if (value === undefined || value === null) return value;
  return String(value).trim();
}

function normalizeArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function uniqueByString(values = []) {
  const seen = new Set();
  const result = [];

  values.filter((value) => value !== undefined && value !== null && value !== '').forEach((value) => {
    const key = String(value);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  });

  return result;
}

function getEntityId(entity) {
  return entity && (entity._id || entity.id);
}

function getImportSources(dto) {
  const validSources = new Set(Object.values(externalOrderSources));
  const sources = uniqueByString([dto.source, ...normalizeArray(dto.importSources)]
    .map((value) => normalizeTrimmed(value)));
  const invalidSources = sources.filter((source) => !validSources.has(source));

  if (sources.length === 0) {
    throw validationError('source or importSources is required', { field: 'source' });
  }

  if (invalidSources.length > 0) {
    throw validationError('importSources contains unsupported source', {
      field: 'importSources',
      invalidSources,
    });
  }

  return sources;
}

function getOrderRawRecordIds(dto) {
  return uniqueByString(normalizeArray(dto.rawRecordIds));
}

function getItemRawRecordIds(item) {
  return uniqueByString([...normalizeArray(item.rawRecordId), ...normalizeArray(item.rawRecordIds)]);
}

function hasCustomization(item) {
  if (typeof item?.customizationRawSummary?.hasCustomization === 'boolean') {
    return item.customizationRawSummary.hasCustomization;
  }

  if (typeof item?.customization?.hasCustomization === 'boolean') {
    return item.customization.hasCustomization;
  }

  return false;
}

function getCustomizationResult(item) {
  return hasCustomization(item) ? (item.customization || item.customizationRawSummary || null) : null;
}

function getInitialItemStatus(item) {
  return hasCustomization(item)
    ? orderItemStatuses.CUSTOMIZATION_PENDING
    : orderItemStatuses.MAPPING_PENDING;
}

function buildExternalIdentity(dto) {
  return {
    salesChannelCode: normalizeUpper(dto.salesChannelCode || salesChannelCodes.AMAZON),
    marketplaceCode: normalizeUpper(dto.marketplaceCode),
    externalOrderId: normalizeTrimmed(dto.externalOrderId),
  };
}

// Mapper contract: buyer, shippingAddress, shippingService, and externalData are
// full normalized snapshots when provided. Raw payloads stay in integration
// raw records. externalItemId must remain a deterministic string, and money
// amounts must already be integer minor units before reaching order import.
function validateDto(dto) {
  requireValue(dto.shopId, 'shopId');
  requireValue(dto.marketplaceCode, 'marketplaceCode');
  requireValue(dto.externalOrderId, 'externalOrderId');

  if (!Array.isArray(dto.items) || dto.items.length === 0) {
    throw validationError('items must be a non-empty array', { field: 'items' });
  }

  dto.items.forEach((item, index) => {
    requireValue(item.externalItemId, `items[${index}].externalItemId`);

    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw validationError('item.quantity must be an integer greater than or equal to 1', {
        field: `items[${index}].quantity`,
      });
    }
  });
}

module.exports = {
  buildExternalIdentity,
  compactObject,
  conflictError,
  getCustomizationResult,
  getEntityId,
  getImportSources,
  getInitialItemStatus,
  getItemRawRecordIds,
  getOrderRawRecordIds,
  hasCustomization,
  normalizeTrimmed,
  validateDto,
};
