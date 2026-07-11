const Joi = require('joi');
const {
  financeCostStatuses,
  financeSnapshotStatuses,
} = require('../constants/finance.constants');

const objectId = Joi.string().hex().length(24);

function validate(schema, payload) {
  const result = schema.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });

  if (!result.error) return { value: result.value };

  return {
    value: result.value,
    details: result.error.details.map((detail) => ({
      message: detail.message,
      path: detail.path,
      type: detail.type,
    })),
  };
}

const listSnapshotsQuerySchema = Joi.object({
  orderId: objectId,
  orderItemId: objectId,
  shopId: objectId,
  snapshotStatus: Joi.string().trim().uppercase().valid(...Object.values(financeSnapshotStatuses)),
  costStatus: Joi.string().trim().uppercase().valid(...Object.values(financeCostStatuses)),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const financeImportContextSchema = Joi.object({
  shopId: objectId.required(),
  salesChannelCode: Joi.string().trim().uppercase().required(),
  marketplaceCode: Joi.string().trim().uppercase().required(),
  sourceRef: Joi.string().trim().max(255).default('finance-import'),
  dryRun: Joi.boolean().default(true),
});

module.exports = {
  financeImportContextSchema,
  listSnapshotsQuerySchema,
  validate,
};
