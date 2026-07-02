const httpStatus = require('../../../shared/constants/httpStatus');
const catalogService = require('../services/catalog.service');
const {
  listInternalTemplatesQuerySchema,
  createInternalTemplateSchema,
  updateInternalTemplateSchema,
} = require('../validators/catalog.validator');
const { assertValid } = require('./requestValidation');

async function listInternalTemplates(req, res) {
  const query = assertValid(listInternalTemplatesQuerySchema, req.query);
  const result = await catalogService.listInternalTemplates(query);
  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function getInternalTemplate(req, res) {
  const result = await catalogService.getInternalTemplate(req.params.id);
  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function createInternalTemplate(req, res) {
  const payload = assertValid(createInternalTemplateSchema, req.body);
  const result = await catalogService.createInternalTemplate(payload);
  res.status(httpStatus.CREATED).json({ success: true, data: result });
}

async function updateInternalTemplate(req, res) {
  const payload = assertValid(updateInternalTemplateSchema, req.body);
  const result = await catalogService.updateInternalTemplate(req.params.id, payload);
  res.status(httpStatus.OK).json({ success: true, data: result });
}

module.exports = {
  listInternalTemplates,
  getInternalTemplate,
  createInternalTemplate,
  updateInternalTemplate,
};
