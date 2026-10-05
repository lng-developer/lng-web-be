const Joi = require('joi');

const linkAccountSchema = Joi.object({
  entraUserId: Joi.string().required().trim(),
  email: Joi.string().email().optional(),
  displayName: Joi.string().optional().allow(null, ''),
  refreshToken: Joi.string().optional().allow(null, ''),
});

module.exports = {
  linkAccountSchema,
};
