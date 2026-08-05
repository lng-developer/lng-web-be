const { assertValidObjectId } = require('../../../shared/utils/objectId');
const mediaPublic = require('../../media/public');
const listingRepository = require('../repositories/listing.repository');
const repository = require('../repositories/listingVariant.repository');
const internalTemplateRepository = require('../repositories/internalTemplate.repository');
const { toListingVariantDto } = require('../dtos/listingVariant.dto');
const { CATALOG_READ, CATALOG_WRITE, assertCanAccessShop } = require('./catalogAccess.helpers');
const { conflict, mapDuplicate, notFound } = require('./catalogError.helpers');
const { assertInternalTemplateActive } = require('./internalTemplate.service');
const { assertProductTypeGroupActive } = require('./productTypeGroup.service');
const { assertPsdAssetShape, resolvePsdReadiness } = require('./listing.service');

async function loadListing(listingId, permission, authContext) {
  assertValidObjectId(listingId, 'listingId');
  const listing = await listingRepository.findById(listingId);
  if (!listing) throw notFound('Listing not found');
  assertCanAccessShop(listing.shopId, permission, authContext);
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
  const template = templateId ? await internalTemplateRepository.findById(templateId) : null;
  return {
    ...toListingVariantDto(variant),
    psdReadiness: resolvePsdReadiness(variant, template, 'LISTING_VARIANT'),
  };
}

async function getListingVariantById(variantId) {
  assertValidObjectId(variantId, 'listingVariantId');
  return toDetail(await repository.findById(variantId));
}

async function setListingVariantPsdTemplateAsset(variantId, mediaAssetId) {
  assertValidObjectId(variantId, 'listingVariantId');
  assertValidObjectId(mediaAssetId, 'mediaAssetId');
  const variant = await repository.findById(variantId);
  if (!variant) throw notFound('Listing variant not found');
  await mediaPublic.assertMediaAssetExists(mediaAssetId);
  assertPsdAssetShape(await mediaPublic.getAsset(mediaAssetId) || {});
  return toDetail(await repository.update(variantId, { psdTemplateAssetId: mediaAssetId }));
}

async function requestListingVariantPsd(listingId, variantId, authContext) {
  await loadListing(listingId, CATALOG_WRITE, authContext);
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
  const listing = await loadListing(listingId, CATALOG_WRITE, authContext);
  await validateTemplate(payload);
  try {
    const variant = await repository.create({ listingId, ...payload });
    if (!listing.defaultVariantId) await listingRepository.update(listingId, { defaultVariantId: variant._id });
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
  if (payload.status === 'INACTIVE' && String(listing.defaultVariantId || '') === String(variantId)) {
    throw conflict('Default listing variant cannot be inactive');
  }
  const merged = { ...payload, productTypeGroupId: payload.productTypeGroupId || current.productTypeGroupId?._id || current.productTypeGroupId };
  await validateTemplate(merged);
  try {
    return toListingVariantDto(await repository.update(variantId, payload));
  } catch (error) {
    await mapDuplicate(error, 'Listing variant already exists for this product type');
  }
}

async function setDefaultListingVariant(listingId, variantId, authContext) {
  await loadListing(listingId, CATALOG_WRITE, authContext);
  const variant = await repository.findById(variantId);
  if (!variant || String(variant.listingId) !== String(listingId)) throw notFound('Listing variant not found');
  if (variant.status !== 'ACTIVE') throw conflict('Only an active listing variant can be default');
  await listingRepository.update(listingId, { defaultVariantId: variantId });
  return toListingVariantDto(variant);
}

async function resolveListingVariant(listingId, productTypeGroupId) {
  const listing = await listingRepository.findById(listingId);
  if (!listing) return null;
  const count = await repository.countByListing(listingId);
  if (!count) return { source: 'LEGACY', listing };
  const variant = productTypeGroupId
    ? await repository.findByListingAndProductType(listingId, productTypeGroupId)
    : listing.defaultVariantId && await repository.findById(listing.defaultVariantId);
  return variant && variant.status === 'ACTIVE'
    ? { source: productTypeGroupId ? 'VARIANT' : 'DEFAULT_VARIANT', listing, variant }
    : null;
}

module.exports = {
  listListingVariants,
  createListingVariant,
  updateListingVariant,
  setDefaultListingVariant,
  resolveListingVariant,
  getListingVariantById,
  setListingVariantPsdTemplateAsset,
  requestListingVariantPsd,
};
