const { assertValidObjectId } = require('../../../shared/utils/objectId');
const logger = require('../../../shared/utils/logger');
const mediaPublic = require('../../media/public');
const listingRepository = require('../repositories/listing.repository');
const repository = require('../repositories/listingVariant.repository');
const internalTemplateRepository = require('../repositories/internalTemplate.repository');
const { toListingVariantDto } = require('../dtos/listingVariant.dto');
const { CATALOG_READ, CATALOG_WRITE, assertCanAccessShop } = require('./catalogAccess.helpers');
const { conflict, mapDuplicate, notFound } = require('./catalogError.helpers');
const { assertInternalTemplateActive } = require('./internalTemplate.service');
const { assertProductTypeGroupActive } = require('./productTypeGroup.service');
const {
  assertPsdAssetShape,
  canReadAssignedListing,
  canReadListing,
  resolvePsdReadiness,
} = require('./listing.service');

function toPlainId(value) {
  if (!value) return null;
  if (typeof value === 'object') return String(value._id || value.id || value);
  return String(value);
}

function withScaleDifficultyMetadata(payload = {}, authContext = {}) {
  if (!payload.scaleDifficulty) return payload;
  return {
    ...payload,
    scaleDifficulty: {
      level: payload.scaleDifficulty.level || 'NORMAL',
      reason: payload.scaleDifficulty.reason?.trim() || null,
      updatedBy: authContext.accountId || null,
      updatedAt: new Date(),
    },
  };
}

function effectivePrintMethod(variant = {}) {
  return variant.printMethod || variant.productTypeGroupId?.printMethod || null;
}

function sameNullableId(left, right) {
  return toPlainId(left) === toPlainId(right);
}

function isPsdCompatibleVariant(source = {}, candidate = {}) {
  if (toPlainId(source._id || source.id) === toPlainId(candidate._id || candidate.id)) return false;
  return sameNullableId(source.internalTemplateId, candidate.internalTemplateId)
    && String(effectivePrintMethod(source) || '') === String(effectivePrintMethod(candidate) || '');
}

async function loadListing(listingId, permission, authContext) {
  assertValidObjectId(listingId, 'listingId');
  const listing = await listingRepository.findById(listingId);
  if (!listing) throw notFound('Listing not found');
  if (permission === CATALOG_READ && await canReadListing(listing, authContext)) return listing;
  assertCanAccessShop(listing.shopId, permission, authContext);
  return listing;
}

async function loadListingForVariantRequest(listingId, authContext) {
  assertValidObjectId(listingId, 'listingId');
  const listing = await listingRepository.findById(listingId);
  if (!listing) throw notFound('Listing not found');
  try {
    assertCanAccessShop(listing.shopId, CATALOG_WRITE, authContext);
    return listing;
  } catch (error) {
    if (error?.code !== 'AUTHORIZATION_ERROR') throw error;
  }
  if (await canReadAssignedListing(listing, authContext)) return listing;
  assertCanAccessShop(listing.shopId, CATALOG_WRITE, authContext);
  return listing;
}

async function validateTemplate(payload) {
  await assertProductTypeGroupActive(payload.productTypeGroupId);
  await assertInternalTemplateActive(payload.internalTemplateId, payload.productTypeGroupId);
  await Promise.all(['psdTemplateAssetId', 'previewAssetId']
    .filter((field) => payload[field])
    .map((field) => mediaPublic.assertMediaAssetExists(payload[field])));
}

async function toDetail(variant) {
  if (!variant) return null;
  const templateId = variant.internalTemplateId?._id || variant.internalTemplateId;
  const [template, listing] = await Promise.all([
    templateId ? internalTemplateRepository.findById(templateId) : null,
    variant.listingId ? listingRepository.findById(variant.listingId) : null,
  ]);
  return {
    ...toListingVariantDto(variant),
    psdReadiness: resolvePsdReadiness(variant, template, 'LISTING_VARIANT', listing),
  };
}

async function recheckBlockedPlansForVariant(variant, authContext = {}) {
  const listingId = toPlainId(variant?.listingId);
  const productTypeGroupId = toPlainId(variant?.productTypeGroupId);
  if (!listingId || !productTypeGroupId) return;
  try {
    const mappingPublic = require('../../mapping/public');
    if (typeof mappingPublic.recheckBlockedFulfillmentPlansForListingVariant === 'function') {
      await mappingPublic.recheckBlockedFulfillmentPlansForListingVariant(listingId, productTypeGroupId, {
        ...(authContext || {}),
        system: true,
        source: 'CATALOG_VARIANT',
      });
    }
  } catch (error) {
    logger.warn('Catalog variant fulfillment recheck skipped', { listingId, productTypeGroupId, error });
  }
  try {
    const orderPublic = require('../../order/public');
    if (typeof orderPublic.updatePsdStatusesForListing === 'function') {
      await orderPublic.updatePsdStatusesForListing(listingId);
    }
  } catch (error) {
    logger.warn('Catalog variant order PSD status sync skipped', { listingId, productTypeGroupId, error });
  }
}

async function getListingVariantById(variantId) {
  assertValidObjectId(variantId, 'listingVariantId');
  return toDetail(await repository.findById(variantId));
}

async function getListingVariantsByIds(variantIds = []) {
  const ids = [...new Set((variantIds || []).filter(Boolean).map(String))];
  ids.forEach((variantId) => assertValidObjectId(variantId, 'listingVariantId'));
  return (await repository.findByIds(ids)).map(toListingVariantDto);
}

async function listListingVariantIdsByScaleDifficulty(level) {
  return (await repository.listIdsByScaleDifficulty(String(level).trim().toUpperCase()))
    .map((id) => String(id));
}

async function listListingVariantScaleDifficultiesByIds(ids = []) {
  return repository.listScaleDifficultiesByIds(ids);
}

async function setListingVariantPsdTemplateAsset(variantId, mediaAssetId) {
  assertValidObjectId(variantId, 'listingVariantId');
  assertValidObjectId(mediaAssetId, 'mediaAssetId');
  const variant = await repository.findById(variantId);
  if (!variant) throw notFound('Listing variant not found');
  await mediaPublic.assertMediaAssetReady(mediaAssetId);
  assertPsdAssetShape(await mediaPublic.getAsset(mediaAssetId) || {});
  const updated = await repository.update(variantId, { psdTemplateAssetId: mediaAssetId });
  await recheckBlockedPlansForVariant(updated);
  return toDetail(updated);
}

async function applyListingVariantPsdToCompatible(listingId, variantId, payload = {}, authContext) {
  await loadListing(listingId, CATALOG_WRITE, authContext);
  assertValidObjectId(variantId, 'variantId');
  const source = await repository.findById(variantId);
  if (!source || String(source.listingId) !== String(listingId)) throw notFound('Listing variant not found');
  if (!source.psdTemplateAssetId) throw conflict('Source listing variant PSD is missing');

  const variants = await repository.listByListing(listingId);
  const targets = variants.filter((variant) => (
    isPsdCompatibleVariant(source, variant)
    && (!payload.onlyMissing || !variant.psdTemplateAssetId)
  ));
  const targetIds = targets.map((variant) => variant._id || variant.id);
  if (targetIds.length) {
    await repository.updateManyByIds(targetIds, { psdTemplateAssetId: source.psdTemplateAssetId });
    await Promise.all([...new Set(targets.map((variant) => toPlainId(variant.productTypeGroupId)).filter(Boolean))]
      .map((productTypeGroupId) => recheckBlockedPlansForVariant({ listingId, productTypeGroupId }, authContext)));
  }

  return {
    sourceVariantId: toPlainId(source),
    psdTemplateAssetId: toPlainId(source.psdTemplateAssetId),
    matchedCount: targets.length,
    updatedVariantIds: targetIds.map(toPlainId),
  };
}

async function requestListingVariantPsd(listingId, variantId, authContext) {
  await loadListingForVariantRequest(listingId, authContext);
  assertValidObjectId(variantId, 'listingVariantId');
  const variant = await repository.findById(variantId);
  if (!variant || String(variant.listingId) !== String(listingId)) {
    throw notFound('Listing variant not found');
  }
  const detail = await toDetail(variant);
  if (detail.psdReadiness.status !== 'MISSING') {
    throw conflict('Listing variant PSD is not missing');
  }
  const designPublic = require('../../design/public');
  return designPublic.createPsdTemplateTaskFromListingVariant(
    listingId,
    variantId,
    { note: 'Requested from Catalog listing variant' },
    { ...(authContext || {}), system: true, source: 'CATALOG' },
  );
}

async function listListingVariants(listingId, authContext) {
  await loadListing(listingId, CATALOG_READ, authContext);
  return Promise.all((await repository.listByListing(listingId)).map(toDetail));
}

async function createListingVariant(listingId, payload, authContext) {
  const listing = await loadListingForVariantRequest(listingId, authContext);
  await validateTemplate(payload);
  try {
    const variant = await repository.create({
      listingId,
      ...withScaleDifficultyMetadata({
        ...payload,
        psdTemplateAssetId: payload.psdTemplateAssetId || listing.defaultPsdTemplateAssetId || null,
      }, authContext),
    });
    await recheckBlockedPlansForVariant(variant, authContext);
    return toListingVariantDto(variant);
  } catch (error) {
    await mapDuplicate(error, 'Listing variant already exists for this product type');
  }
}

async function updateListingVariant(listingId, variantId, payload, authContext) {
  const listing = await loadListing(listingId, CATALOG_WRITE, authContext);
  assertValidObjectId(variantId, 'variantId');
  const current = await repository.findById(variantId);
  if (!current || String(current.listingId) !== String(listingId)) throw notFound('Listing variant not found');
  const merged = { ...payload, productTypeGroupId: payload.productTypeGroupId || current.productTypeGroupId?._id || current.productTypeGroupId };
  await validateTemplate(merged);
  try {
    const updated = await repository.update(variantId, withScaleDifficultyMetadata(payload, authContext));
    await recheckBlockedPlansForVariant(updated, authContext);
    return toListingVariantDto(updated);
  } catch (error) {
    await mapDuplicate(error, 'Listing variant already exists for this product type');
  }
}

async function resolveListingVariant(listingId, productTypeGroupId) {
  const listing = await listingRepository.findById(listingId);
  if (!listing) return null;
  const count = await repository.countByListing(listingId);
  if (!count) return { source: 'LEGACY', listing };
  const variant = productTypeGroupId
    ? await repository.findByListingAndProductType(listingId, productTypeGroupId)
    : null;
  return variant && variant.status === 'ACTIVE'
    ? { source: 'VARIANT', listing, variant }
    : null;
}

module.exports = {
  listListingVariants,
  createListingVariant,
  updateListingVariant,
  applyListingVariantPsdToCompatible,
  resolveListingVariant,
  getListingVariantById,
  getListingVariantsByIds,
  listListingVariantIdsByScaleDifficulty,
  listListingVariantScaleDifficultiesByIds,
  setListingVariantPsdTemplateAsset,
  requestListingVariantPsd,
};
