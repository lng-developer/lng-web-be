const Joi = require('joi');
const uploadSchema = Joi.object({
  expectedMockupRevision: Joi.number().integer().min(0).max(Number.MAX_SAFE_INTEGER).required(),
  expectedInputVersion: Joi.number().integer().min(0).max(Number.MAX_SAFE_INTEGER).required(),
}).required();
module.exports = { uploadSchema };
