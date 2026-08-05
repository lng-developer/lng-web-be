const Joi = require('joi');
const {
  designScoreLevels,
  designScoreStatuses,
  designTaskOutputTypes,
  designTaskPriorities,
  designTaskStatuses,
  designTaskTypes,
} = require('../constants/design.constants');

const objectId = Joi.string().hex().length(24);
const psdStatuses = Object.freeze(['MISSING', 'PRESENT']);
const taskSortFields = Object.freeze(['createdAt', 'updatedAt', 'submittedAt', 'priority', 'status']);

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

function normalizeSellerAlias(value, helpers) {
  if (value.sellerId && value.shopId && value.sellerId !== value.shopId) {
    return helpers.error('any.custom', { message: 'sellerId must match shopId when both are provided' });
  }
  if (value.sellerId && !value.shopId) value.shopId = value.sellerId;
  delete value.sellerId;
  return value;
}

const taskFilterQuery = {
  orderId: Joi.string().trim().max(160),
  search: Joi.string().trim().max(200),
  status: Joi.string().trim().uppercase().valid(...Object.values(designTaskStatuses)),
  taskType: Joi.string().trim().uppercase().valid(...Object.values(designTaskTypes)),
  listingId: objectId,
  sellerId: objectId,
  shopId: objectId,
  assignedDesignerId: objectId,
  unassigned: Joi.boolean(),
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date().iso(),
  priority: Joi.string().trim().uppercase().valid(...Object.values(designTaskPriorities)),
  psdStatus: Joi.string().trim().uppercase().valid(...psdStatuses),
  sortBy: Joi.string().trim().valid(...taskSortFields),
  sortOrder: Joi.string().trim().lowercase().valid('asc', 'desc'),
};

const listTasksQuerySchema = Joi.object({
  ...taskFilterQuery,
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
}).custom(normalizeSellerAlias);

const workloadQuerySchema = Joi.object({
  ...taskFilterQuery,
}).custom(normalizeSellerAlias);

const assigneesQuerySchema = Joi.object({
  taskType: Joi.string().trim().uppercase().valid(...Object.values(designTaskTypes)),
  search: Joi.string().trim().max(200),
}).custom(normalizeSellerAlias);

const psdTemplateCandidatesQuerySchema = Joi.object({
  search: Joi.string().trim().max(200),
  sellerId: objectId,
  shopId: objectId,
  salesChannelCode: Joi.string().trim().uppercase(),
  marketplaceCode: Joi.string().trim().uppercase(),
  productTypeGroupId: objectId,
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
}).custom(normalizeSellerAlias);

const createTaskSchema = Joi.object({
  listingId: objectId.required(),
  targetListingId: objectId,
  sourceListingId: objectId,
  sourceInternalTemplateId: objectId,
  taskType: Joi.string().trim().uppercase().valid(...Object.values(designTaskTypes)).required(),
  brief: Joi.string().trim().max(2000).allow(null, ''),
  referenceAssetIds: Joi.array().items(objectId).unique().default([]),
  expectedOutputs: Joi.array()
    .items(Joi.string().trim().uppercase().valid(...Object.values(designTaskOutputTypes)))
    .unique()
    .default([]),
  priority: Joi.string().trim().uppercase().valid(...Object.values(designTaskPriorities)),
  note: Joi.string().trim().max(1000).allow(null, ''),
}).custom((value, helpers) => {
  if (value.taskType === designTaskTypes.IDEA && !String(value.brief || '').trim()) {
    return helpers.error('any.custom', { message: 'brief is required for IDEA task' });
  }
  if (
    value.taskType === designTaskTypes.CLONE
    && !value.sourceListingId
    && !value.sourceInternalTemplateId
  ) {
    return helpers.error('any.custom', {
      message: 'sourceListingId or sourceInternalTemplateId is required for CLONE task',
    });
  }
  return value;
});

const assignTaskSchema = Joi.object({
  assignedDesignerId: objectId.required(),
  note: Joi.string().trim().max(1000).allow(null, ''),
});

const bulkAssignTasksSchema = Joi.object({
  taskIds: Joi.array().items(objectId).unique().min(1).max(100).required(),
  assignedDesignerId: objectId.required(),
});

const noteOnlySchema = Joi.object({
  note: Joi.string().trim().max(1000).allow(null, ''),
});

const bulkCreatePsdTasksFromListingsSchema = Joi.object({
  listingIds: Joi.array().items(objectId).unique().min(1).max(100),
  filters: Joi.object({
    shopId: objectId,
    salesChannelCode: Joi.string().trim().uppercase(),
    marketplaceCode: Joi.string().trim().uppercase(),
    productTypeGroupId: objectId,
  }).min(1),
  limit: Joi.number().integer().min(1).max(100).default(100),
  note: Joi.string().trim().max(1000).allow(null, ''),
}).xor('listingIds', 'filters');

const submitTaskSchema = Joi.object({
  submittedAssetIds: Joi.array().items(objectId).min(1).required(),
  note: Joi.string().trim().max(1000).allow(null, ''),
});

const approveTaskSchema = Joi.object({
  approvedAssetId: objectId.required(),
  submissionId: objectId,
  version: Joi.number().integer().min(1),
}).nand('submissionId', 'version');

const rejectTaskSchema = Joi.object({
  rejectReason: Joi.string().trim().min(1).max(1000).required(),
  submissionId: objectId,
  version: Joi.number().integer().min(1),
}).nand('submissionId', 'version');

const removeSubmissionParamsSchema = Joi.object({
  taskId: objectId.required(),
  submissionId: objectId.required(),
});

const cancelTaskSchema = Joi.object({
  cancelReason: Joi.string().trim().max(1000).allow(null, ''),
});

const scoreSummaryQuerySchema = Joi.object({
  designerId: objectId,
  teamId: objectId,
  departmentId: objectId,
  taskType: Joi.string().trim().uppercase().valid(...Object.values(designTaskTypes)),
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date().iso(),
}).custom((value, helpers) => {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    return helpers.error('any.custom', { message: 'dateFrom must not be after dateTo' });
  }
  return value;
});

const submissionScoresQuerySchema = Joi.object({
  search: Joi.string().trim().max(200),
  designerId: objectId,
  scoreLevel: Joi.string()
    .trim()
    .uppercase()
    .valid(...Object.values(designScoreLevels)),
  scoreStatus: Joi.string()
    .trim()
    .uppercase()
    .valid('ALL', ...Object.values(designScoreStatuses))
    .default('ACTIVE'),
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date().iso(),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
  sortBy: Joi.string().trim().valid('scoredAt', 'finalPoints', 'updatedAt'),
  sortOrder: Joi.string().trim().lowercase().valid('asc', 'desc'),
});

const psdFilesQuerySchema = Joi.object({
  search: Joi.string().trim().max(200),
  role: Joi.string().trim().uppercase().valid('REFERENCE', 'SUBMISSION', 'APPROVED'),
  designerId: objectId,
  taskStatus: Joi.string()
    .trim()
    .uppercase()
    .valid(...Object.values(designTaskStatuses)),
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date().iso(),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
  sortBy: Joi.string().trim().valid('createdAt', 'submittedAt'),
  sortOrder: Joi.string().trim().lowercase().valid('asc', 'desc'),
});

const overrideSubmissionScoreParamsSchema = Joi.object({
  scoreId: objectId.required(),
});

const overrideSubmissionScoreSchema = Joi.object({
  points: Joi.number().min(0).required(),
  scoreLevel: Joi.string().trim().uppercase().valid(...Object.values(designScoreLevels)),
  overrideReason: Joi.string().trim().min(2).max(500).required(),
});

const voidSubmissionScoreParamsSchema = Joi.object({
  taskId: objectId.required(),
  submissionId: objectId.required(),
  assetId: objectId.required(),
});

const voidSubmissionScoreSchema = Joi.object({
  voidReason: Joi.string().trim().min(2).max(500).required(),
});

module.exports = {
  approveTaskSchema,
  assigneesQuerySchema,
  assignTaskSchema,
  bulkAssignTasksSchema,
  bulkCreatePsdTasksFromListingsSchema,
  cancelTaskSchema,
  createTaskSchema,
  listTasksQuerySchema,
  noteOnlySchema,
  overrideSubmissionScoreParamsSchema,
  overrideSubmissionScoreSchema,
  psdFilesQuerySchema,
  psdTemplateCandidatesQuerySchema,
  rejectTaskSchema,
  removeSubmissionParamsSchema,
  scoreSummaryQuerySchema,
  submissionScoresQuerySchema,
  submitTaskSchema,
  validate,
  voidSubmissionScoreParamsSchema,
  voidSubmissionScoreSchema,
  workloadQuerySchema,
};
