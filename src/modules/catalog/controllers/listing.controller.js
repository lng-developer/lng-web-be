const httpStatus = require('../../../shared/constants/httpStatus');
const catalogService = require('../services/catalog.service');
const {
  exportListingsQuerySchema,
  listListingsQuerySchema,
  createListingSchema,
  rejectListingSchema,
  requestPsdSchema,
  updateListingSchema,
} = require('../validators/catalog.validator');
const { assertValid } = require('./requestValidation');

function elapsedMs(startedAt) {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

function serverTimingValue(timing = {}) {
  return Object.entries(timing)
    .filter(([, duration]) => Number.isFinite(duration))
    .map(([name, duration]) => `${name};dur=${duration}`)
    .join(', ');
}

async function listListings(req, res) {
  const query = assertValid(listListingsQuerySchema, req.query);
  const timing = process.env.NODE_ENV === 'production' ? null : {};
  const startedAt = performance.now();
  const result = await catalogService.listListings(query, req.auth, timing);
  if (timing) {
    timing.catalog = elapsedMs(startedAt);
    res.setHeader('Server-Timing', serverTimingValue(timing));
  }
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

async function exportListingsCsv(req, res) {
  const query = assertValid(exportListingsQuerySchema, req.query);
  const result = await catalogService.exportListingsCsv(query, req.auth);
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.status(httpStatus.OK).send(result.content);
}

async function requestListingPsd(req, res) {
  const payload = assertValid(requestPsdSchema, req.body);
  const result = await catalogService.requestListingPsd(req.params.id, payload, req.auth);
  res.status(httpStatus.CREATED).json({ success: true, data: result });
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

module.exports = {
  getListingOptions,
  exportListingsCsv,
  listListings,
  getListingSummary,
  getListing,
  requestListingPsd,
  createListing,
  updateListing,
  approveListing,
  rejectListing,
};
