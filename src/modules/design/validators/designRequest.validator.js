const Joi = require('joi');
const { designRequestStatuses } = require('../constants/design.constants');
const id = Joi.string().hex().length(24);
function validate(schema, payload) {
  const result = schema.validate(payload, { abortEarly: false, stripUnknown: true });
  return result.error
    ? { value: result.value, details: result.error.details }
    : { value: result.value };
}

module.exports = {
  validate,
  designRequestIdSchema: Joi.object({ id }),
  designRequestAssignmentSchema: Joi.object({ assignedDesignerAccountId: id.required() }),
  designRequestStatusSchema: Joi.object({
    status: Joi.string().valid(...Object.values(designRequestStatuses)).required(),
  }),
};
