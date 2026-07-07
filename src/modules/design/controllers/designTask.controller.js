const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/designTask.service');
const {
  approveTaskSchema,
  assignTaskSchema,
  cancelTaskSchema,
  createTaskSchema,
  listTasksQuerySchema,
  noteOnlySchema,
  rejectTaskSchema,
  submitTaskSchema,
} = require('../validators/designTask.validator');
const { assertValid } = require('./requestValidation');

async function listTasks(req, res) {
  const query = assertValid(listTasksQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listTasks(query, req.auth),
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

async function assignTask(req, res) {
  const payload = assertValid(assignTaskSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.assignTask(req.params.taskId, payload, req.auth),
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

async function cancelTask(req, res) {
  const payload = assertValid(cancelTaskSchema, req.body || {});
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.cancelTask(req.params.taskId, payload, req.auth),
  });
}

module.exports = {
  approveTask,
  assignTask,
  cancelTask,
  createTask,
  getTask,
  listTasks,
  rejectTask,
  startTask,
  submitTask,
};
