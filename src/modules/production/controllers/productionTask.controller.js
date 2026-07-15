const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/productionTask.service');
const {
  assignDesignTaskSchema,
  assignCsTaskSchema,
  bulkAssignDesignTasksSchema,
  bulkPushVendorSchema,
  csAssigneesQuerySchema,
  csNoteSchema,
  csStatusSchema,
  designNoteSchema,
  fileCheckParamSchema,
  listTasksQuerySchema,
  orderItemParamSchema,
  qcSchema,
  recheckPsdBlockedSchema,
  scaleAssigneesQuerySchema,
  scaledOutputSchema,
  sentToVendorSchema,
  taskParamSchema,
  validate,
} = require('../validators/productionTask.validator');

function assertValid(schema, payload) {
  const { value, details } = validate(schema, payload);
  if (details) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  }
  return value;
}

async function getTaskByOrderItem(req, res) {
  const { orderItemId } = assertValid(orderItemParamSchema, req.params);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getTaskByOrderItem(orderItemId, req.auth),
  });
}

async function listTasks(req, res) {
  const query = assertValid(listTasksQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listTasks(query, req.auth),
  });
}

async function summarizeTasks(req, res) {
  const query = assertValid(listTasksQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.summarizeTasks(query, req.auth),
  });
}

async function getScaleAssignees(req, res) {
  const query = assertValid(scaleAssigneesQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getScaleAssignees(query, req.auth),
  });
}

async function getCsAssignees(req, res) {
  const query = assertValid(csAssigneesQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getCsAssignees(query, req.auth),
  });
}

async function recheckTask(req, res) {
  const { orderItemId } = assertValid(orderItemParamSchema, req.params);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.createOrRecheckTaskForOrderItem(orderItemId, req.auth),
  });
}

async function recheckPsdBlockedTasks(req, res) {
  const payload = assertValid(recheckPsdBlockedSchema, req.body || {});
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.recheckPsdBlockedTasks(payload, req.auth),
  });
}

async function assignDesignTask(req, res) {
  const { taskId } = assertValid(taskParamSchema, req.params);
  const payload = assertValid(assignDesignTaskSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.assignDesignTask(taskId, payload, req.auth),
  });
}

async function assignCsTask(req, res) {
  const { taskId } = assertValid(taskParamSchema, req.params);
  const payload = assertValid(assignCsTaskSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.assignCsTask(taskId, payload, req.auth),
  });
}

async function bulkAssignDesignTasks(req, res) {
  const payload = assertValid(bulkAssignDesignTasksSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.bulkAssignDesignTasks(payload, req.auth),
  });
}

async function bulkPushVendor(req, res) {
  const payload = assertValid(bulkPushVendorSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.bulkPushVendor(payload, req.auth),
  });
}

async function exportQcTasks(req, res) {
  const query = assertValid(listTasksQuerySchema, req.query);
  const result = await service.exportQcTasksExcel(query, req.auth);
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.status(httpStatus.OK).send(result.content);
}

async function claimDesignTask(req, res) {
  const { taskId } = assertValid(taskParamSchema, req.params);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.claimDesignTask(taskId, req.auth),
  });
}

async function updateDesignNote(req, res) {
  const { taskId } = assertValid(taskParamSchema, req.params);
  const payload = assertValid(designNoteSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.updateDesignNote(taskId, payload, req.auth),
  });
}

async function updateCsNote(req, res) {
  const { taskId } = assertValid(taskParamSchema, req.params);
  const payload = assertValid(csNoteSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.updateCsNote(taskId, payload, req.auth),
  });
}

async function updateCsStatus(req, res) {
  const { taskId } = assertValid(taskParamSchema, req.params);
  const payload = assertValid(csStatusSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.updateCsStatus(taskId, payload, req.auth),
  });
}

async function uploadScaledFile(req, res) {
  const { taskId, fileCheckId } = assertValid(fileCheckParamSchema, req.params);
  const { mediaAssetId } = assertValid(scaledOutputSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.uploadScaledFile(taskId, fileCheckId, mediaAssetId, req.auth),
  });
}

async function uploadScaledOutputFile(req, res) {
  const { taskId, fileCheckId } = assertValid(fileCheckParamSchema, req.params);
  if (!req.file) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, [{
      message: 'file is required',
      path: ['file'],
      type: 'any.required',
    }]);
  }
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.uploadScaledOutputFile(taskId, fileCheckId, req.file, req.auth),
  });
}

async function submitQc(req, res) {
  const { taskId } = assertValid(taskParamSchema, req.params);
  const payload = assertValid(qcSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.submitQc(taskId, payload, req.auth),
  });
}

async function markSentToVendor(req, res) {
  const { taskId } = assertValid(taskParamSchema, req.params);
  const payload = assertValid(sentToVendorSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.markSentToVendor(taskId, payload.vendorSubmissionId, req.auth),
  });
}

module.exports = {
  assignCsTask,
  assignDesignTask,
  bulkAssignDesignTasks,
  bulkPushVendor,
  claimDesignTask,
  exportQcTasks,
  getScaleAssignees,
  getCsAssignees,
  getTaskByOrderItem,
  listTasks,
  markSentToVendor,
  recheckPsdBlockedTasks,
  recheckTask,
  submitQc,
  summarizeTasks,
  updateDesignNote,
  updateCsNote,
  updateCsStatus,
  uploadScaledFile,
  uploadScaledOutputFile,
};
