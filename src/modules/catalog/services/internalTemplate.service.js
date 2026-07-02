const { assertValidObjectId } = require('../../../shared/utils/objectId');
const mediaPublic = require('../../media/public');
const internalTemplateRepository = require('../repositories/internalTemplate.repository');
const { recordStatuses } = require('../constants/catalog.constants');
const { toInternalTemplateDto, toPaginatedResponse } = require('../dtos/catalog.dto');
const { assertProductTypeGroupActive } = require('./productTypeGroup.service');
const {
  conflict,
  mapDuplicate,
  notFound,
  validationError,
} = require('./catalogError.helpers');

function toPlainId(value) {
  if (!value) return null;
  if (typeof value === 'object') return String(value._id || value.id || value);
  return String(value);
}

function normalizeCode(value) {
  return value === undefined || value === null ? value : String(value).trim().toUpperCase();
}

function assertUniqueKeys(items = [], path) {
  const seen = new Set();
  for (const item of items || []) {
    const key = item && item.key;
    if (!key) continue;
    if (seen.has(key)) {
      throw validationError(`Duplicate ${path} key`, [{ path: [path, key] }]);
    }
    seen.add(key);
  }
}

function assertArtworkFieldReferences(requiredFields = [], artworkSlots = []) {
  const fieldKeys = new Set((requiredFields || []).map((field) => field.key));
  for (const slot of artworkSlots || []) {
    for (const fieldKey of slot.acceptedFieldKeys || []) {
      if (!fieldKeys.has(fieldKey)) {
        throw validationError('Artwork slot references unknown required field', [{
          path: ['artworkSlots', slot.key, 'acceptedFieldKeys'],
          message: `${fieldKey} is not defined in requiredFields`,
        }]);
      }
    }
  }
}

async function validateDesignAssets(designAssets = []) {
  await Promise.all((designAssets || []).map((asset) => (
    mediaPublic.assertMediaAssetExists(asset.mediaAssetId)
  )));
}

async function validateTemplateDefinition(payload = {}) {
  if (payload.requiredFields) assertUniqueKeys(payload.requiredFields, 'requiredFields');
  if (payload.artworkSlots) assertUniqueKeys(payload.artworkSlots, 'artworkSlots');
  assertArtworkFieldReferences(payload.requiredFields || [], payload.artworkSlots || []);
  if (payload.designAssets) await validateDesignAssets(payload.designAssets);
}

async function assertInternalTemplateActive(templateId, productTypeGroupId) {
  if (!templateId) return null;
  assertValidObjectId(templateId, 'internalTemplateId');
  const template = await internalTemplateRepository.findById(templateId);
  if (!template) throw notFound('Internal template not found');
  if (template.status !== recordStatuses.ACTIVE) throw conflict('Internal template is not active');
  if (productTypeGroupId && toPlainId(template.productTypeGroupId) !== String(productTypeGroupId)) {
    throw conflict('Internal template product type group does not match listing');
  }
  return template;
}

function mutableTemplatePatch(patch = {}) {
  const allowedFields = [
    'name',
    'description',
    'productTypeGroupId',
    'requiredFields',
    'artworkSlots',
    'designAssets',
    'status',
  ];

  return allowedFields.reduce((result, field) => {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      result[field] = patch[field];
    }
    return result;
  }, {});
}

async function listInternalTemplates(query = {}) {
  const result = await internalTemplateRepository.list(query);
  return toPaginatedResponse(result, (item) => toInternalTemplateDto(item));
}

async function getInternalTemplate(templateId) {
  assertValidObjectId(templateId, 'internalTemplateId');
  const template = await internalTemplateRepository.findById(templateId);
  if (!template) throw notFound('Internal template not found');
  return toInternalTemplateDto(template, { detail: true });
}

async function createInternalTemplate(payload) {
  const createPayload = {
    ...payload,
    code: normalizeCode(payload.code),
  };
  await assertProductTypeGroupActive(createPayload.productTypeGroupId);
  await validateTemplateDefinition(createPayload);

  try {
    return toInternalTemplateDto(await internalTemplateRepository.create(createPayload), { detail: true });
  } catch (error) {
    await mapDuplicate(error, 'Internal template code already exists');
  }
}

async function updateInternalTemplate(templateId, patch) {
  assertValidObjectId(templateId, 'internalTemplateId');
  const updatePatch = mutableTemplatePatch(patch);
  const existing = await internalTemplateRepository.findById(templateId);
  if (!existing) throw notFound('Internal template not found');
  if (updatePatch.productTypeGroupId) await assertProductTypeGroupActive(updatePatch.productTypeGroupId);
  await validateTemplateDefinition({
    requiredFields: updatePatch.requiredFields || existing.requiredFields || [],
    artworkSlots: updatePatch.artworkSlots || existing.artworkSlots || [],
    designAssets: updatePatch.designAssets || [],
  });

  try {
    return toInternalTemplateDto(await internalTemplateRepository.update(templateId, updatePatch), { detail: true });
  } catch (error) {
    await mapDuplicate(error, 'Internal template code already exists');
  }
}

async function getInternalTemplateById(templateId) {
  assertValidObjectId(templateId, 'internalTemplateId');
  const template = await internalTemplateRepository.findById(templateId);
  return template && template.status === recordStatuses.ACTIVE ? template : null;
}

async function findInternalTemplateByCode(code) {
  const template = await internalTemplateRepository.findByCode(normalizeCode(code));
  return template && template.status === recordStatuses.ACTIVE ? template : null;
}

module.exports = {
  assertInternalTemplateActive,
  getInternalTemplateById,
  findInternalTemplateByCode,
  listInternalTemplates,
  getInternalTemplate,
  createInternalTemplate,
  updateInternalTemplate,
  toPlainId,
};
