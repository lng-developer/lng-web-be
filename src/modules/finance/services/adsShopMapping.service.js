const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const { financePermissions } = require('../constants/finance.constants');
const financeAccess = require('./financeAccess.service');
const repository = require('../repositories/adsShopMapping.repository');

function normalizeExternalId(value) {
  return String(value || '').trim().replace(/^="(.*)"$/, '$1');
}

function forbidden() {
  return new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
}

function assertWriteAccess(authContext = {}) {
  if (!financeAccess.hasGlobal(authContext, financePermissions.WRITE)) throw forbidden();
}

async function resolveShopForAdsRow(row = {}, context = {}, authContext = {}) {
  assertWriteAccess(authContext);
  const advertiserAccountId = normalizeExternalId(row.advertiserAccountId);
  const campaignId = normalizeExternalId(row.campaignId);
  const portfolioId = normalizeExternalId(row.portfolioId);
  const externalIds = [campaignId, portfolioId].filter(Boolean);
  if (!advertiserAccountId || !externalIds.length) return { shopId: null, matchedBy: 'UNASSIGNED' };

  const mappings = await repository.findActiveByExternalIds({
    advertiserAccountId,
    salesChannelCode: String(context.salesChannelCode || '').trim().toUpperCase(),
    marketplaceCode: String(context.marketplaceCode || '').trim().toUpperCase(),
    externalIds,
  });
  const campaign = mappings.find((mapping) => mapping.matchType === 'CAMPAIGN' && mapping.externalId === campaignId);
  if (campaign) return { shopId: String(campaign.shopId), matchedBy: 'CAMPAIGN' };
  const portfolio = mappings.find((mapping) => mapping.matchType === 'PORTFOLIO' && mapping.externalId === portfolioId);
  return portfolio ? { shopId: String(portfolio.shopId), matchedBy: 'PORTFOLIO' } : { shopId: null, matchedBy: 'UNASSIGNED' };
}

async function upsertAdsShopMapping(input = {}, authContext = {}) {
  assertWriteAccess(authContext);
  assertValidObjectId(input.shopId, 'shopId');
  const advertiserAccountId = normalizeExternalId(input.advertiserAccountId);
  const externalId = normalizeExternalId(input.externalId);
  if (!advertiserAccountId || !externalId || !['CAMPAIGN', 'PORTFOLIO'].includes(input.matchType)) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
  return repository.upsert({
    advertiserAccountId,
    externalId,
    matchType: input.matchType,
    shopId: input.shopId,
    salesChannelCode: String(input.salesChannelCode || 'AMAZON').trim().toUpperCase(),
    marketplaceCode: String(input.marketplaceCode || 'US').trim().toUpperCase(),
    active: input.active !== false,
  });
}

async function listAdsShopMappings(query = {}, authContext = {}) {
  if (!financeAccess.hasGlobal(authContext, financePermissions.READ)) throw forbidden();
  return repository.list({
    ...query,
    advertiserAccountId: query.advertiserAccountId && normalizeExternalId(query.advertiserAccountId),
  });
}

module.exports = { listAdsShopMappings, normalizeExternalId, resolveShopForAdsRow, upsertAdsShopMapping };
