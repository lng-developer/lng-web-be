const httpStatus = require('../../../shared/constants/httpStatus');
const catalogService = require('../services/catalog.service');
const mediaPublic = require('../../media/public');
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

async function uploadCatalogAsset(req, res) {
  const asset = await mediaPublic.storeUploadedFile(req.file, {
    source: 'CATALOG_TEMPLATE',
    uploadedBy: req.auth?.accountId || null,
  });
  const id = String(asset._id || asset.id);
  res.location(`/api/media/assets/${id}`);
  res.status(httpStatus.CREATED).json({
    success: true,
    data: {
      id,
      originalFilename: asset.originalFilename,
      mimeType: asset.mimeType,
      size: asset.size,
      downloadUrl: `/api/media/assets/${id}/download`,
    },
  });
}

module.exports = {
  listInternalTemplates,
  getInternalTemplate,
  createInternalTemplate,
  updateInternalTemplate,
  uploadCatalogAsset,
};
