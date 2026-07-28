const Joi = require('joi');
const {
  organizationStatuses,
  teamMemberTypes,
} = require('../constants');

const objectIdSchema = Joi.string().hex().length(24);
const codeSchema = Joi.string().trim().uppercase().min(2).max(80);

const listDepartmentsQuerySchema = Joi.object({
  status: Joi.string().valid(...Object.values(organizationStatuses)),
  search: Joi.string().trim().max(120),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const departmentCreateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(160).required(),
  code: codeSchema.required(),
});

const departmentUpdateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(160),
  code: codeSchema,
  status: Joi.string().valid(...Object.values(organizationStatuses)),
}).min(1);

const listTeamsQuerySchema = Joi.object({
  departmentId: objectIdSchema,
  status: Joi.string().valid(...Object.values(organizationStatuses)),
  search: Joi.string().trim().max(120),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const teamCreateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(160).required(),
  code: codeSchema.required(),
  departmentId: objectIdSchema.required(),
});

const teamUpdateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(160),
  code: codeSchema,
  departmentId: objectIdSchema,
  status: Joi.string().valid(...Object.values(organizationStatuses)),
}).min(1);

const teamMemberCreateSchema = Joi.object({
  accountId: objectIdSchema.required(),
  memberType: Joi.string().valid(...Object.values(teamMemberTypes)).required(),
});

function validate(schema, payload) {
  const result = schema.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });

  if (!result.error) {
    return { value: result.value };
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
  listDepartmentsQuerySchema,
  departmentCreateSchema,
  departmentUpdateSchema,
  listTeamsQuerySchema,
  teamCreateSchema,
  teamUpdateSchema,
  teamMemberCreateSchema,
  validate,
};
