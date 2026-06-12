const Joi = require('joi');
const { accountStatuses } = require('../constants/auth.constants');
const {
  accessAssignmentStatuses,
  accessScopeTypes,
  scopeRegistryStatuses,
} = require('../constants/auth.constants');

const objectIdSchema = Joi.string().hex().length(24);
const registryScopeTypes = [
  accessScopeTypes.DEPARTMENT,
  accessScopeTypes.TEAM,
  accessScopeTypes.SHOP,
  accessScopeTypes.VENDOR,
];

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  fullName: Joi.string().trim().min(1).required(),
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

const logoutSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

const listAccountsQuerySchema = Joi.object({
  status: Joi.string().valid(...Object.values(accountStatuses)),
  search: Joi.string().trim().max(120),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const listRbacQuerySchema = Joi.object({
  search: Joi.string().trim().max(120),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const listAccessAssignmentsQuerySchema = Joi.object({
  accountId: objectIdSchema,
  roleId: objectIdSchema,
  scopeType: Joi.string().valid(...Object.values(accessScopeTypes)),
  scopeId: objectIdSchema,
  status: Joi.string().valid(...Object.values(accessAssignmentStatuses)),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const listScopeRegistryQuerySchema = Joi.object({
  scopeType: Joi.string().valid(...registryScopeTypes),
  scopeId: objectIdSchema,
  status: Joi.string().valid(...Object.values(scopeRegistryStatuses)),
  search: Joi.string().trim().max(120),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const accountStatusSchema = Joi.object({
  status: Joi.string().valid(accountStatuses.ACTIVE, accountStatuses.INACTIVE).required(),
});

const accountProfileSchema = Joi.object({
  fullName: Joi.string().trim().min(1).max(160).required(),
});

const accountEmailSchema = Joi.object({
  email: Joi.string().email().required(),
});

const accountPasswordSchema = Joi.object({
  password: Joi.string().min(6).required(),
});

const accountCreateSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  fullName: Joi.string().trim().min(1).max(160).required(),
  roleIds: Joi.array().items(objectIdSchema.required()).unique().min(1).required(),
  customPermissionIds: Joi.array().items(objectIdSchema.required()).unique().default([]),
});

const accountAccessSchema = Joi.object({
  roleIds: Joi.array().items(objectIdSchema.required()).unique().min(1).required(),
  customPermissionIds: Joi.array().items(objectIdSchema.required()).unique().default([]),
});

const accessAssignmentCreateSchema = Joi.object({
  accountId: objectIdSchema.required(),
  roleId: objectIdSchema.required(),
  scopeType: Joi.string().valid(...Object.values(accessScopeTypes)).required(),
  scopeId: objectIdSchema.allow(null),
  customPermissionIds: Joi.array().items(objectIdSchema.required()).unique().default([]),
});

const accessAssignmentUpdateSchema = Joi.object({
  roleId: objectIdSchema,
  scopeType: Joi.string().valid(...Object.values(accessScopeTypes)),
  scopeId: objectIdSchema.allow(null),
  customPermissionIds: Joi.array().items(objectIdSchema.required()).unique(),
  status: Joi.string().valid(...Object.values(accessAssignmentStatuses)),
}).min(1);

const scopeRegistryCreateSchema = Joi.object({
  scopeType: Joi.string().valid(...registryScopeTypes).required(),
  scopeId: objectIdSchema.required(),
  name: Joi.string().trim().min(1).max(160).required(),
});

const scopeRegistryUpdateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(160),
  status: Joi.string().valid(...Object.values(scopeRegistryStatuses)),
}).min(1);

const roleCreateSchema = Joi.object({
  code: Joi.string().trim().min(2).max(80).required(),
  name: Joi.string().trim().min(1).max(120).required(),
  permissionIds: Joi.array().items(objectIdSchema.required()).unique().default([]),
});

const roleUpdateSchema = Joi.object({
  code: Joi.string().trim().min(2).max(80),
  name: Joi.string().trim().min(1).max(120),
  permissionIds: Joi.array().items(objectIdSchema.required()).unique(),
}).min(1);

const rolePermissionSchema = Joi.object({
  permissionId: objectIdSchema.required(),
});

const permissionCreateSchema = Joi.object({
  code: Joi.string().trim().min(2).max(80).required(),
});

const permissionUpdateSchema = Joi.object({
  code: Joi.string().trim().min(2).max(80).required(),
});

function validate(schema, payload) {
  const { value, error } = schema.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return {
      value,
      details: error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      })),
    };
  }

  return {
    value,
    details: null,
  };
}

module.exports = {
  loginSchema,
  registerSchema,
  refreshSchema,
  logoutSchema,
  listAccountsQuerySchema,
  listRbacQuerySchema,
  listAccessAssignmentsQuerySchema,
  listScopeRegistryQuerySchema,
  accountStatusSchema,
  accountProfileSchema,
  accountEmailSchema,
  accountPasswordSchema,
  accountCreateSchema,
  accountAccessSchema,
  accessAssignmentCreateSchema,
  accessAssignmentUpdateSchema,
  scopeRegistryCreateSchema,
  scopeRegistryUpdateSchema,
  roleCreateSchema,
  roleUpdateSchema,
  rolePermissionSchema,
  permissionCreateSchema,
  permissionUpdateSchema,
  validate,
};
