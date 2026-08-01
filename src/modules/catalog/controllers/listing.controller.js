const httpStatus = require('../../../shared/constants/httpStatus');
const catalogService = require('../services/catalog.service');
const {
  listListingsQuerySchema,
  createListingSchema,
  rejectListingSchema,
  updateListingSchema,
} = require('../validators/catalog.validator');
const { assertValid } = require('./requestValidation');

async function listListings(req, res) {
  const query = assertValid(listListingsQuerySchema, req.query);
  const result = await catalogService.listListings(query, req.auth);
  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function getListingOptions(req, res) {
  const result = await catalogService.getListingOptions(req.auth);
  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function getListingSummary(req, res) {
  const query = assertValid(listListingsQuerySchema, req.query);
  const result = await catalogService.getListingSummary(query, req.auth);
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

async function approveListing(req, res) {
  const result = await catalogService.approveListing(req.params.id, req.auth);
  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function rejectListing(req, res) {
  const payload = assertValid(rejectListingSchema, req.body);
  const result = await catalogService.rejectListing(req.params.id, payload.rejectionReason, req.auth);
  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function uploadListingPsdTemplate(req, res) {
  const result = await catalogService.uploadListingPsdTemplate(req.params.id, req.file, req.auth);
  res.status(httpStatus.OK).json({ success: true, data: result });
}

module.exports = {
  getListingOptions,
  listListings,
  getListingSummary,
  getListing,
  createListing,
  updateListing,
  approveListing,
  rejectListing,
  uploadListingPsdTemplate,
};
