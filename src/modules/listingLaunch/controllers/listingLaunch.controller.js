const service = require('../services/listingLaunch.service');
const contentInputService = require('../services/listingContentInput.service');
const {
  createSchema,
  updateSchema,
  selectProductSchema,
  contentInputsSchema,
  listQuerySchema,
  idParamsSchema,
} = require('../validators/listingLaunch.validator');
const { assertValid } = require('./requestValidation');

async function createListingLaunch(req, res) {
  const payload = assertValid(createSchema, req.body);
  const result = await service.createListingLaunch(payload, req.auth);
  res.status(201).json({ success: true, data: result });
}

async function listListingLaunches(req, res) {
  const query = assertValid(listQuerySchema, req.query);
  const result = await service.listListingLaunches(query, req.auth);
  res.status(200).json({ success: true, data: result });
}

async function getListingLaunch(req, res) {
  const { id } = assertValid(idParamsSchema, req.params);
  const result = await service.getListingLaunch(id, req.auth);
  res.status(200).json({ success: true, data: result });
}

async function updateListingLaunch(req, res) {
  const { id } = assertValid(idParamsSchema, req.params);
  const payload = assertValid(updateSchema, req.body);
  const result = await service.updateListingLaunch(id, payload, req.auth);
  res.status(200).json({ success: true, data: result });
}

async function selectProduct(req, res) {
  const { id } = assertValid(idParamsSchema, req.params);
  const payload = assertValid(selectProductSchema, req.body);
  const result = await service.selectProduct(id, payload, req.auth);
  res.status(200).json({ success: true, data: result });
}

async function saveContentInputs(req, res) {
  const { id } = assertValid(idParamsSchema, req.params);
  const payload = assertValid(contentInputsSchema, req.body);
  const result = await contentInputService.saveContentInputs(id, payload, req.auth);
  res.status(200).json({ success: true, data: result });
}

module.exports = {
  createListingLaunch,
  listListingLaunches,
  getListingLaunch,
  updateListingLaunch,
  selectProduct,
  saveContentInputs,
};
