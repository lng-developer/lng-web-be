const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/designTask.service');
const mediaPublic = require('../../media/public');
const scoreService = require('../services/designSubmissionScore.service');
const {
  approveTaskSchema,
  assigneesQuerySchema,
  assignTaskSchema,
  bulkAssignTasksSchema,
  cancelTaskSchema,
  createTaskSchema,
  exportTasksQuerySchema,
  listTasksQuerySchema,
  noteOnlySchema,
  overrideSubmissionScoreParamsSchema,
  overrideSubmissionScoreSchema,
  psdFilesQuerySchema,
  rejectTaskSchema,
  reopenTaskSchema,
  removeSubmissionParamsSchema,
  scoreSummaryQuerySchema,
  submissionScoresQuerySchema,
  submitTaskSchema,
  updateTaskPrioritySchema,
  voidSubmissionScoreParamsSchema,
  voidSubmissionScoreSchema,
  workloadQuerySchema,
} = require('../validators/designTask.validator');
const { assertValid } = require('./requestValidation');

async function listTasks(req, res) {
  const query = assertValid(listTasksQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listTasks(query, req.auth),
  });
}

async function exportTasksCsv(req, res) {
  const query = assertValid(exportTasksQuerySchema, req.query);
  const result = await service.exportTasksCsv(query, req.auth);
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.status(httpStatus.OK).send(result.content);
}

async function uploadAsset(req, res) {
  const asset = await mediaPublic.storeUploadedFile(req.file, {
    source: 'DESIGN_SUBMISSION', uploadedBy: req.auth?.accountId || null,
  });
  const id = String(asset._id || asset.id);
  res.location(`/api/media/assets/${id}`);
  res.status(httpStatus.CREATED).json({
    success: true,
    data: {
      id,
      originalFilename: asset.originalFilename || null,
      mimeType: asset.mimeType || null,
      size: asset.size ?? null,
      downloadUrl: `/api/media/assets/${id}/download`,
    },
  });
}

async function getTask(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getTask(req.params.taskId, req.auth),
  });
}

async function createTask(req, res) {
  const payload = assertValid(createTaskSchema, req.body);
  res.status(httpStatus.CREATED).json({
    success: true,
    data: await service.createTask(payload, req.auth),
  });
}

async function listSubmissions(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listSubmissions(req.params.taskId, req.auth),
  });
}

async function getAssignees(req, res) {
  const query = assertValid(assigneesQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getAssignees(query, req.auth),
  });
}

async function getWorkload(req, res) {
  const query = assertValid(workloadQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getWorkload(query, req.auth),
  });
}

async function summarizeTasks(req, res) {
  const query = assertValid(workloadQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.summarizeTasks(query, req.auth),
  });
}

async function createPsdTemplateTaskFromListingVariant(req, res) {
  const payload = assertValid(noteOnlySchema, req.body || {});
  res.status(httpStatus.CREATED).json({
    success: true,
    data: await service.createPsdTemplateTaskFromListingVariant(
      req.params.listingId,
      req.params.variantId,
      payload,
      req.auth,
    ),
  });
}

async function assignTask(req, res) {
  const payload = assertValid(assignTaskSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.assignTask(req.params.taskId, payload, req.auth),
  });
}

async function bulkAssignTasks(req, res) {
  const payload = assertValid(bulkAssignTasksSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.bulkAssignTasks(payload, req.auth),
  });
}

async function startTask(req, res) {
  const payload = assertValid(noteOnlySchema, req.body || {});
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.startTask(req.params.taskId, payload, req.auth),
  });
}

async function submitTask(req, res) {
  const payload = assertValid(submitTaskSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.submitTask(req.params.taskId, payload, req.auth),
  });
}

async function approveTask(req, res) {
  const payload = assertValid(approveTaskSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.approveTask(req.params.taskId, payload, req.auth),
  });
}

async function rejectTask(req, res) {
  const payload = assertValid(rejectTaskSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.rejectTask(req.params.taskId, payload, req.auth),
  });
}

async function reopenTask(req, res) {
  const payload = assertValid(reopenTaskSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.reopenTask(req.params.taskId, payload, req.auth),
  });
}

async function deleteTask(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.deleteTask(req.params.taskId, req.auth),
  });
}

async function cancelTask(req, res) {
  const payload = assertValid(cancelTaskSchema, req.body || {});
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.cancelTask(req.params.taskId, payload, req.auth),
  });
}

async function updateTaskPriority(req, res) {
  const payload = assertValid(updateTaskPrioritySchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.updateTaskPriority(req.params.taskId, payload.priority, req.auth),
  });
}

async function removeSubmission(req, res) {
  const params = assertValid(removeSubmissionParamsSchema, req.params);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.removeSubmission(params.taskId, params.submissionId, req.auth),
  });
}

async function summarizeScores(req, res) {
  const query = assertValid(scoreSummaryQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await scoreService.summarizeScores(query, req.auth),
  });
}

async function listSubmissionScores(req, res) {
  const query = assertValid(submissionScoresQuerySchema, req.query);
  res
    .status(httpStatus.OK)
    .json({ success: true, data: await service.listSubmissionScores(query, req.auth) });
}

async function listPsdFiles(req, res) {
  const query = assertValid(psdFilesQuerySchema, req.query);
  res
    .status(httpStatus.OK)
    .json({ success: true, data: await service.listPsdFiles(query, req.auth) });
}

async function overrideSubmissionScore(req, res) {
  const params = assertValid(overrideSubmissionScoreParamsSchema, req.params);
  const payload = assertValid(overrideSubmissionScoreSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await scoreService.overrideSubmissionScore(params.scoreId, payload, req.auth),
  });
}

async function voidSubmissionScore(req, res) {
  const params = assertValid(voidSubmissionScoreParamsSchema, req.params);
  const payload = assertValid(voidSubmissionScoreSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await scoreService.voidSubmissionScore(params.taskId, params.submissionId, params.assetId, payload, req.auth),
  });
}

module.exports = {
  uploadAsset,
  approveTask,
  assignTask,
  bulkAssignTasks,
  cancelTask,
  createPsdTemplateTaskFromListingVariant,
  createTask,
  deleteTask,
  exportTasksCsv,
  getAssignees,
  getTask,
  getWorkload,
  listSubmissions,
  listPsdFiles,
  listSubmissionScores,
  listTasks,
  overrideSubmissionScore,
  removeSubmission,
  rejectTask,
  reopenTask,
  startTask,
  submitTask,
  summarizeScores,
  summarizeTasks,
  updateTaskPriority,
  voidSubmissionScore,
};
