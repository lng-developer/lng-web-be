const {
  listingQcStatuses,
  recordStatuses,
  salesChannelCodes,
  setupStatuses,
} = require('../constants/catalog.constants');
const { Joi, objectId } = require('./validator.helpers');

const listListingsQuerySchema = Joi.object({
  shopId: objectId,
  salesChannelCode: Joi.string().trim().uppercase().valid(...Object.values(salesChannelCodes)),
  marketplaceCode: Joi.string().trim().uppercase().max(40),
  search: Joi.string().trim().max(160),
  asin: Joi.string().trim().uppercase().max(40),
  etsyListingId: Joi.string().trim().max(80),
  sku: Joi.string().trim().max(120),
  status: Joi.string().valid(...Object.values(recordStatuses)),
  qcStatus: Joi.string().valid(...Object.values(listingQcStatuses)),
  costCenterStatus: Joi.string().valid(...Object.values(setupStatuses)),
  psdStatus: Joi.string().valid(...Object.values(setupStatuses)),
  sort: Joi.string().valid('createdAtDesc', 'orderCountDesc', 'quantitySoldDesc', 'lastSoldAtDesc'),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const listingPayload = {
  shopId: objectId.required(),
  salesChannelCode: Joi.string().trim().uppercase().valid(...Object.values(salesChannelCodes)).required(),
  marketplaceCode: Joi.string().trim().uppercase().max(40).required(),
  sku: Joi.string().trim().uppercase().min(1).max(120).required(),
  asin: Joi.string().trim().uppercase().max(40).allow(null, ''),
  etsyListingId: Joi.string().trim().max(80).allow(null, ''),
  title: Joi.string().trim().min(1).max(500).required(),
  baseCostAmount: Joi.number().integer().min(0),
  currency: Joi.string().trim().uppercase().length(3),
  costCenterStatus: Joi.string().valid(...Object.values(setupStatuses)),
  status: Joi.string().valid(...Object.values(recordStatuses)),
};

const createListingSchema = Joi.object(listingPayload);
const updateListingSchema = Joi.object({
  title: listingPayload.title.optional(),
  asin: listingPayload.asin,
  etsyListingId: listingPayload.etsyListingId,
  baseCostAmount: listingPayload.baseCostAmount,
  currency: listingPayload.currency,
  costCenterStatus: listingPayload.costCenterStatus,
  status: listingPayload.status,
}).min(1);

const rejectListingSchema = Joi.object({
  rejectionReason: Joi.string().trim().min(1).max(1000).required(),
});

module.exports = {
  listListingsQuerySchema,
  createListingSchema,
  updateListingSchema,
  rejectListingSchema,
};
