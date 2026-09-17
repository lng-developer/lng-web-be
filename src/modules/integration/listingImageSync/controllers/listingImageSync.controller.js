const AppError = require('../../../../shared/errors/appError');
const errorCodes = require('../../../../shared/constants/errorCodes');
const service = require('../services/listingImageSync.service');
const schemas = require('../validators/listingImageSync.validator');
function valid(schema, input) {
  const { value, error } = schema.validate(input, { abortEarly: false, stripUnknown: true });
  if (error) throw new AppError('Validation failed', 400, true, errorCodes.VALIDATION_ERROR, error.details);
  return value;
}
const send = (res, data, status = 200) => res.status(status).json({ success: true, data });
async function listSchedules(req, res) { send(res, await service.listSchedules(req.auth)); }
async function upsertSchedule(req, res) { const { agentId } = valid(schemas.params, req.params); send(res, await service.upsertSchedule(agentId, valid(schemas.schedule, req.body), req.auth)); }
async function listJobs(req, res) { send(res, await service.listJobs(valid(schemas.list, req.query), req.auth)); }
async function createJob(req, res) { send(res, await service.createJob(valid(schemas.create, req.body), req.auth), 201); }
function change(action) { return async (req, res) => { const { jobId } = valid(schemas.params, req.params); send(res, await service.changeJob(jobId, action, req.auth)); }; }
async function getCommandItems(req, res) { const { commandId } = valid(schemas.params, req.params); send(res, await service.getCommandItems(commandId, valid(schemas.lease, req.body), req.auth)); }
async function recordResult(req, res) { const { commandId, itemId } = valid(schemas.params, req.params); send(res, await service.recordResult(commandId, itemId, valid(schemas.result, req.body), req.file, req.auth)); }
async function pauseCommand(req, res) { const { commandId } = valid(schemas.params, req.params); send(res, await service.pauseCommand(commandId, valid(schemas.pause, req.body), req.auth)); }
module.exports = { listSchedules, upsertSchedule, listJobs, createJob, pause: change('pause'), resume: change('resume'), retry: change('retry'), getCommandItems, recordResult, pauseCommand };
