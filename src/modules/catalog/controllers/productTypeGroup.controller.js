const httpStatus = require('../../../shared/constants/httpStatus');
const catalogService = require('../services/catalog.service');
const {
  listProductTypeGroupsQuerySchema,
  createProductTypeGroupSchema,
  updateProductTypeGroupSchema,
} = require('../validators/catalog.validator');
const { assertValid } = require('./requestValidation');

async function listProductTypeGroups(req, res) {
  const query = assertValid(listProductTypeGroupsQuerySchema, req.query);
  const result = await catalogService.listProductTypeGroups(query);
  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function createProductTypeGroup(req, res) {
  const payload = assertValid(createProductTypeGroupSchema, req.body);
  const result = await catalogService.createProductTypeGroup(payload);
  res.status(httpStatus.CREATED).json({ success: true, data: result });
}

async function updateProductTypeGroup(req, res) {
  const payload = assertValid(updateProductTypeGroupSchema, req.body);
  const result = await catalogService.updateProductTypeGroup(req.params.id, payload);
  res.status(httpStatus.OK).json({ success: true, data: result });
}

module.exports = {
  listProductTypeGroups,
  createProductTypeGroup,
  updateProductTypeGroup,
};
