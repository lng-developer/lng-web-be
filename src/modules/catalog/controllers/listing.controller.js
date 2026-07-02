const httpStatus = require('../../../shared/constants/httpStatus');
const catalogService = require('../services/catalog.service');
const {
  listListingsQuerySchema,
  createListingSchema,
  updateListingSchema,
} = require('../validators/catalog.validator');
const { assertValid } = require('./requestValidation');

async function listListings(req, res) {
  const query = assertValid(listListingsQuerySchema, req.query);
  const result = await catalogService.listListings(query, req.auth);
  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function getListing(req, res) {
  const result = await catalogService.getListing(req.params.id, req.auth);
  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function createListing(req, res) {
  const payload = assertValid(createListingSchema, req.body);
  const result = await catalogService.createListing(payload, req.auth);
  res.status(httpStatus.CREATED).json({ success: true, data: result });
}

async function updateListing(req, res) {
  const payload = assertValid(updateListingSchema, req.body);
  const result = await catalogService.updateListing(req.params.id, payload, req.auth);
  res.status(httpStatus.OK).json({ success: true, data: result });
}

module.exports = {
  listListings,
  getListing,
  createListing,
  updateListing,
};
