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
  identifier: Joi.string().trim().min(1).max(254),
  email: Joi.string().trim(),
  password: Joi.string().required(),
}).xor('identifier', 'email');

const googleLoginSchema = Joi.object({
  idToken: Joi.string().trim(),
  accessToken: Joi.string().trim(),
}).xor('idToken', 'accessToken');

const microsoftLoginSchema = Joi.object({
  idToken: Joi.string().trim().required(),
});

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

const logoutSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

const changeOwnPasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(6).required(),
});

const listAccountsQuerySchema = Joi.object({
  status: Joi.string().valid(...Object.values(accountStatuses)),
  search: Joi.string().trim().max(120),
  roleId: objectIdSchema,
  roleCode: Joi.string().trim().uppercase().max(80),
  departmentId: objectIdSchema,
  teamId: objectIdSchema,
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

const listScopedRolePermissionQuerySchema = Joi.object({
  scopeType: Joi.string().valid(...registryScopeTypes),
  scopeId: objectIdSchema,
  roleId: objectIdSchema,
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const accountStatusSchema = Joi.object({
  status: Joi.string().valid(accountStatuses.ACTIVE, accountStatuses.INACTIVE).required(),
});
const accountOperatingCostSchema = Joi.object({
  operatingCostAmount: Joi.number().integer().min(0).required(),
  operatingCostStartedAt: Joi.date().iso().allow(null).default(null),
});

const accountEmailSchema = Joi.object({
  email: Joi.string().email().required(),
});

const accountPasswordSchema = Joi.object({
  password: Joi.string().min(6).required(),
});

const accountAssignmentSchema = Joi.object({
  roleId: objectIdSchema.required(),
  scopeType: Joi.string().valid(...Object.values(accessScopeTypes)).required(),
  scopeId: objectIdSchema.allow(null),
  customPermissionIds: Joi.array().items(objectIdSchema).unique().default([]),
  overridePermissionIds: Joi.alternatives().try(
    Joi.array().items(objectIdSchema).unique(),
    Joi.valid(null),
  ),
  validFrom: Joi.date().iso().allow(null),
  validUntil: Joi.date().iso().allow(null),
});

const accountCreateSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  assignments: Joi.array()
    .items(accountAssignmentSchema.required())
    .min(1)
    .required(),
});

const accountAccessSchema = Joi.object({
  roleIds: Joi.array().items(objectIdSchema.required()).unique().min(1).required(),
  customPermissionIds: Joi.array().items(objectIdSchema).unique().default([]),
  validFrom: Joi.date().iso().allow(null),
  validUntil: Joi.date().iso().allow(null),
});

const accountBulkAccessSchema = Joi.object({
  accountIds: Joi.array().items(objectIdSchema.required()).unique().min(1).required(),
  roleIds: Joi.array().items(objectIdSchema.required()).unique().min(1).required(),
  customPermissionIds: Joi.array().items(objectIdSchema).unique().default([]),
  validFrom: Joi.date().iso().allow(null),
  validUntil: Joi.date().iso().allow(null),
});

const accountBulkRevokeAccessSchema = Joi.object({
  accountIds: Joi.array().items(objectIdSchema.required()).unique().min(1).required(),
});

const accessAssignmentCreateSchema = Joi.object({
  accountId: objectIdSchema.required(),
  roleId: objectIdSchema.required(),
  scopeType: Joi.string().valid(...Object.values(accessScopeTypes)).required(),
  scopeId: objectIdSchema.allow(null),
  customPermissionIds: Joi.array().items(objectIdSchema).unique().default([]),
  overridePermissionIds: Joi.alternatives().try(
    Joi.array().items(objectIdSchema).unique(),
    Joi.valid(null),
  ),
  validFrom: Joi.date().iso().allow(null),
  validUntil: Joi.date().iso().allow(null),
});

const accessAssignmentUpdateSchema = Joi.object({
  roleId: objectIdSchema,
  scopeType: Joi.string().valid(...Object.values(accessScopeTypes)),
  scopeId: objectIdSchema.allow(null),
  customPermissionIds: Joi.array().items(objectIdSchema).unique(),
  overridePermissionIds: Joi.alternatives().try(
    Joi.array().items(objectIdSchema).unique(),
    Joi.valid(null),
  ),
  validFrom: Joi.date().iso().allow(null),
  validUntil: Joi.date().iso().allow(null),
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
  description: Joi.string().trim().max(240).allow(null, '').default(null),
  permissionIds: Joi.array().items(objectIdSchema.required()).unique().default([]),
});

const roleUpdateSchema = Joi.object({
  code: Joi.string().trim().min(2).max(80),
  name: Joi.string().trim().min(1).max(120),
  description: Joi.string().trim().max(240).allow(null, ''),
  permissionIds: Joi.array().items(objectIdSchema.required()).unique(),
}).min(1);

const rolePermissionSchema = Joi.object({
  permissionId: objectIdSchema.required(),
});

const scopedRolePermissionSchema = Joi.object({
  scopeType: Joi.string().valid(...registryScopeTypes).required(),
  scopeId: objectIdSchema.required(),
  roleId: objectIdSchema.required(),
  permissionIds: Joi.array().items(objectIdSchema.required()).unique().default([]),
});

const permissionCreateSchema = Joi.object({
  code: Joi.string().trim().min(2).max(80).required(),
  name: Joi.string().trim().max(120).allow(null, '').default(null),
  description: Joi.string().trim().max(240).allow(null, '').default(null),
});

const permissionUpdateSchema = Joi.object({
  code: Joi.string().trim().min(2).max(80),
  name: Joi.string().trim().max(120).allow(null, ''),
  description: Joi.string().trim().max(240).allow(null, ''),
}).min(1);
const extensionTokenCreateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  shopId: objectIdSchema.required(),
  environment: Joi.string().valid('local', 'development', 'production').required(),
  expiresAt: Joi.date().iso().greater('now').allow(null).default(null),
});

const extensionTokenListSchema = Joi.object({
  shopId: objectIdSchema.required(),
  environment: Joi.string().valid('local', 'development', 'production').required(),
});

const extensionTokenIdSchema = Joi.object({
  tokenId: objectIdSchema.required(),
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
  googleLoginSchema,
  microsoftLoginSchema,
  registerSchema,
  refreshSchema,
  logoutSchema,
  changeOwnPasswordSchema,
  listAccountsQuerySchema,
  listRbacQuerySchema,
  listAccessAssignmentsQuerySchema,
  listScopeRegistryQuerySchema,
  listScopedRolePermissionQuerySchema,
  accountStatusSchema,
  accountOperatingCostSchema,
  accountEmailSchema,
  accountPasswordSchema,
  accountAssignmentSchema,
  accountCreateSchema,
  accountAccessSchema,
  accountBulkAccessSchema,
  accountBulkRevokeAccessSchema,
  accessAssignmentCreateSchema,
  accessAssignmentUpdateSchema,
  scopeRegistryCreateSchema,
  scopeRegistryUpdateSchema,
  roleCreateSchema,
  roleUpdateSchema,
  rolePermissionSchema,
  scopedRolePermissionSchema,
  permissionCreateSchema,
  permissionUpdateSchema,
  extensionTokenCreateSchema,
  extensionTokenListSchema,
  extensionTokenIdSchema,
  validate,
};
