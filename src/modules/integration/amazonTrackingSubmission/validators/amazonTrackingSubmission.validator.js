const Joi = require('joi');

const objectIdSchema = Joi.string().hex().length(24);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const createSubmissionSchema = Joi.object({
  shopId: objectIdSchema.required(),
  agentId: objectIdSchema.required(),
  shipmentIds: Joi.array().items(objectIdSchema).min(1).max(200).required(),
});

const listSubmissionsQuerySchema = paginationSchema.keys({
  shopId: objectIdSchema.optional(),
});

const leasePayloadBodySchema = Joi.object({
  clientId: Joi.string().trim().required(),
  label: Joi.string().trim().required(),
  leaseToken: Joi.string().trim().required(),
});

const recordBatchBodySchema = leasePayloadBodySchema.keys({
  amazonBatchId: Joi.string().trim().required(),
});

const terminalBodySchema = leasePayloadBodySchema.keys({
  status: Joi.string().valid('SUCCEEDED', 'FAILED').required(),
  result: Joi.object({
    importedCount: Joi.number().integer().min(0).default(0),
    failedCount: Joi.number().integer().min(0).default(0),
    diagnostics: Joi.array().items(Joi.string()).default([]),
  }).default(),
});

module.exports = {
  createSubmissionSchema,
  listSubmissionsQuerySchema,
  leasePayloadBodySchema,
  recordBatchBodySchema,
  terminalBodySchema,
};
