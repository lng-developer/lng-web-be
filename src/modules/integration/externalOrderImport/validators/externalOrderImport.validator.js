const Joi = require('joi');
const {
  externalOrderImportSources,
  externalOrderImportSourceTypes,
} = require('../constants/externalOrderImportSources');
const {
  externalOrderImportJobStatuses,
  externalOrderPostImportStatuses,
} = require('../constants/externalOrderImportStatuses');
const {
  externalOrderImportIssueSeverities,
  externalOrderImportIssueStatuses,
  externalOrderImportIssueTypes,
} = require('../constants/externalOrderImportIssueTypes');

const objectIdSchema = Joi.string().hex().length(24);
const paginationQuerySchema = Joi.object({
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const manualExcelImportSchema = Joi.object({
  originalFilename: Joi.string().trim().required(),
  mimeType: Joi.string().trim().allow(null, ''),
  shopId: objectIdSchema.required(),
  shopConnectionId: objectIdSchema.allow(null),
  marketplaceCode: Joi.string().trim().uppercase().required(),
  externalAccountId: Joi.string().trim().allow(null, ''),
  fileContent: Joi.string().allow(''),
  fileBase64: Joi.string().allow(''),
});

const jobIdParamSchema = Joi.object({
  jobId: objectIdSchema.required(),
});

const issueListQuerySchema = paginationQuerySchema.keys({
  importJobId: objectIdSchema,
  source: Joi.string().trim().uppercase().valid(...Object.values(externalOrderImportSources)),
  status: Joi.string().trim().uppercase().valid(...Object.values(externalOrderImportIssueStatuses)),
  issueType: Joi.string().trim().uppercase().valid(...Object.values(externalOrderImportIssueTypes)),
  severity: Joi.string().trim().uppercase().valid(...Object.values(externalOrderImportIssueSeverities)),
  externalOrderId: Joi.string().trim().max(160),
  externalItemId: Joi.string().trim().max(160),
});

const jobListQuerySchema = paginationQuerySchema.keys({
  status: Joi.string().trim().uppercase().valid(...Object.values(externalOrderImportJobStatuses)),
  shopId: objectIdSchema,
  source: Joi.string().trim().uppercase().valid(...Object.values(externalOrderImportSources)),
  sourceType: Joi.string().trim().uppercase().valid(...Object.values(externalOrderImportSourceTypes)),
});

const rawRecordListQuerySchema = paginationQuerySchema.keys({
  importStatus: Joi.string().trim().uppercase(),
  normalizeStatus: Joi.string().trim().uppercase(),
  postImportStatus: Joi.string().trim().uppercase().valid(...Object.values(externalOrderPostImportStatuses)),
});

function validate(schema, payload) {
  const result = schema.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });

  if (!result.error) {
    return { value: result.value, details: null };
  }

  return {
    value: result.value,
    details: result.error.details.map((detail) => ({
      message: detail.message,
      path: detail.path,
      type: detail.type,
    })),
  };
}

module.exports = {
  manualExcelImportSchema,
  jobIdParamSchema,
  jobListQuerySchema,
  issueListQuerySchema,
  rawRecordListQuerySchema,
  paginationQuerySchema,
  validate,
};
