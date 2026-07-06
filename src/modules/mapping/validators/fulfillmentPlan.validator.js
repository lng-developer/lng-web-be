const Joi = require('joi');

const objectId = Joi.string().hex().length(24);
const optionalObjectId = objectId.allow(null);

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

const selectFulfillmentPlanSchema = Joi.object({
  vendorProductId: objectId.required(),
  vendorCostCenterId: objectId.required(),
});

module.exports = {
  confirmFulfillmentPlanSchema: selectFulfillmentPlanSchema,
  objectId,
  optionalObjectId,
  selectFulfillmentPlanSchema,
  validate,
};
