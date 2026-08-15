const fs = require('fs');
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
  exportTasksQuerySchema,
  fileCheckParamSchema,
  listTasksQuerySchema,
  manualFileCheckSchema,
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

function objectPayload(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function auditAuth(req) {
  return {
    ...req.auth,
    auditActorType: req.auth?.accountId ? 'ACCOUNT' : 'SYSTEM',
    auditSource: 'HTTP',
    auditContext: {
      requestId: req.id ? String(req.id).slice(0, 200) : null,
      ipAddress: req.ip ? String(req.ip).slice(0, 100) : null,
      userAgent: req.get?.('user-agent') ? String(req.get('user-agent')).slice(0, 500) : null,
    },
  };
}

async function removeUploadedFile(file) {
  if (file?.path) await fs.promises.rm(file.path, { force: true, maxRetries: 3, retryDelay: 50 });
}

function compactUploadResponse(task, slotKey) {
  const fileCheck = (task.fileChecks || []).find((check) => check.slotKey === slotKey)
    || (task.fileChecks || []).find((check) => check.outputAssetId);
  return {
    taskId: task.id,
    taskStatus: task.status || null,
    scaleStatus: task.scaleStatus || null,
    qcStatus: task.qcStatus || null,
    fileCheckId: fileCheck?.id || null,
    slotKey: fileCheck?.slotKey || slotKey || null,
    slotLabel: fileCheck?.slotLabel || null,
    outputAssetId: fileCheck?.outputAssetId || null,
    outputAssetDownloadUrl: fileCheck?.outputAssetDownloadUrl || null,
    outputStatus: fileCheck?.outputStatus || null,
    fileCheckScaleStatus: fileCheck?.scaleStatus || null,
    fileCheckQcStatus: fileCheck?.qcStatus || null,
  };
}

function wantsCompact(query = {}) {
  return String(query.compact || '').toLowerCase() === 'true';
}

async function getTaskByOrderItem(req, res) {
  const { orderItemId } = assertValid(orderItemParamSchema, req.params);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getTaskByOrderItem(orderItemId, req.auth),
  });
}

async function getTaskById(req, res) {
  const { taskId } = assertValid(taskParamSchema, req.params);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getTaskById(taskId, req.auth),
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
    data: await service.createOrRecheckTaskForOrderItem(orderItemId, auditAuth(req)),
  });
}

async function recheckPsdBlockedTasks(req, res) {
  const payload = assertValid(recheckPsdBlockedSchema, req.body || {});
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.recheckPsdBlockedTasks(payload, auditAuth(req)),
  });
}

async function assignDesignTask(req, res) {
  const { taskId } = assertValid(taskParamSchema, req.params);
  const payload = assertValid(assignDesignTaskSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.assignDesignTask(taskId, payload, auditAuth(req)),
  });
}

async function assignCsTask(req, res) {
  const { taskId } = assertValid(taskParamSchema, req.params);
  const payload = assertValid(assignCsTaskSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.assignCsTask(taskId, payload, auditAuth(req)),
  });
}

async function bulkAssignDesignTasks(req, res) {
  const payload = assertValid(bulkAssignDesignTasksSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.bulkAssignDesignTasks(payload, auditAuth(req)),
  });
}

async function bulkPushVendor(req, res) {
  const payload = assertValid(bulkPushVendorSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.bulkPushVendor(payload, auditAuth(req)),
  });
}

async function exportQcTasks(req, res) {
  const query = assertValid(listTasksQuerySchema, req.query);
  const result = await service.exportQcTasksExcel(query, req.auth);
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.status(httpStatus.OK).send(result.content);
}

async function exportTasksCsv(req, res) {
  const query = assertValid(exportTasksQuerySchema, req.query);
  const result = await service.exportTasksCsv(query, req.auth);
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.status(httpStatus.OK).send(result.content);
}

async function claimDesignTask(req, res) {
  const { taskId } = assertValid(taskParamSchema, req.params);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.claimDesignTask(taskId, auditAuth(req)),
  });
}

async function updateDesignNote(req, res) {
  const { taskId } = assertValid(taskParamSchema, req.params);
  const payload = assertValid(designNoteSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.updateDesignNote(taskId, payload, auditAuth(req)),
  });
}

async function updateCsNote(req, res) {
  const { taskId } = assertValid(taskParamSchema, req.params);
  const payload = assertValid(csNoteSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.updateCsNote(taskId, payload, auditAuth(req)),
  });
}

async function updateCsStatus(req, res) {
  const { taskId } = assertValid(taskParamSchema, req.params);
  const payload = assertValid(csStatusSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.updateCsStatus(taskId, payload, auditAuth(req)),
  });
}

async function uploadScaledFile(req, res) {
  const { taskId, fileCheckId } = assertValid(fileCheckParamSchema, req.params);
  const { mediaAssetId } = assertValid(scaledOutputSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.uploadScaledFile(taskId, fileCheckId, mediaAssetId, auditAuth(req)),
  });
}

async function addManualFileCheck(req, res) {
  const { taskId } = assertValid(taskParamSchema, req.params);
  const payload = assertValid(manualFileCheckSchema, objectPayload(req.body));
  res.status(httpStatus.CREATED).json({
    success: true,
    data: await service.addManualFileCheck(taskId, payload, auditAuth(req)),
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
    data: await service.uploadScaledOutputFile(taskId, fileCheckId, req.file, auditAuth(req)),
  });
}

async function addManualScaledOutputFile(req, res) {
  const { taskId } = assertValid(taskParamSchema, req.params);
  let payload;
  try {
    payload = assertValid(manualFileCheckSchema, {
      ...objectPayload(req.query),
      ...objectPayload(req.body),
    });
    if (!req.file) {
      throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, [{
        message: 'file is required',
        path: ['file'],
        type: 'any.required',
      }]);
    }
  } catch (error) {
    await removeUploadedFile(req.file);
    throw error;
  }
  const data = await service.addManualScaledOutputFile(taskId, payload, req.file, auditAuth(req));
  res.status(httpStatus.OK).json({
    success: true,
    data: wantsCompact(req.query) ? compactUploadResponse(data, payload.slotKey) : data,
  });
}

async function submitQc(req, res) {
  const { taskId } = assertValid(taskParamSchema, req.params);
  const payload = assertValid(qcSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.submitQc(taskId, payload, auditAuth(req)),
  });
}

async function submitScaleForQc(req, res) {
  const { taskId } = assertValid(taskParamSchema, req.params);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.submitScaleForQc(taskId, auditAuth(req)),
  });
}

async function markSentToVendor(req, res) {
  const { taskId } = assertValid(taskParamSchema, req.params);
  const payload = assertValid(sentToVendorSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.markSentToVendor(taskId, payload.vendorSubmissionId, auditAuth(req)),
  });
}

module.exports = {
  addManualFileCheck,
  addManualScaledOutputFile,
  assignCsTask,
  assignDesignTask,
  bulkAssignDesignTasks,
  bulkPushVendor,
  claimDesignTask,
  exportTasksCsv,
  exportQcTasks,
  getScaleAssignees,
  getCsAssignees,
  getTaskByOrderItem,
  getTaskById,
  listTasks,
  markSentToVendor,
  recheckPsdBlockedTasks,
  recheckTask,
  submitQc,
  submitScaleForQc,
  summarizeTasks,
  updateDesignNote,
  updateCsNote,
  updateCsStatus,
  uploadScaledFile,
  uploadScaledOutputFile,
};
