const AppError = require('../../../../shared/errors/appError');
const httpStatus = require('../../../../shared/constants/httpStatus');
const errorCodes = require('../../../../shared/constants/errorCodes');
const service = require('../services/extensionCommand.service');
const { toAgentDto, toCommandDto } = require('../dtos/extensionCommand.dto');
const schemas = require('../validators/extensionCommand.validator');
function valid(schema, payload) { const result = schemas.validate(schema, payload); if (result.details) throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, result.details); return result.value; }
async function heartbeat(req, res) { const agent = await service.heartbeat(valid(schemas.heartbeatSchema, req.body), req.auth); res.status(httpStatus.OK).json({ success: true, data: toAgentDto(agent) }); }
async function listAgents(req, res) { const agents = await service.listAgents(req.auth); res.status(httpStatus.OK).json({ success: true, data: { items: agents.map(toAgentDto) } }); }
async function listManagementAgents(req, res) { const result = await service.listManagementAgents(req.auth); res.status(httpStatus.OK).json({ success: true, data: result }); }
async function createCommand(req, res) { const command = await service.createCommand(valid(schemas.createCommandSchema, req.body), req.auth); res.status(httpStatus.CREATED).json({ success: true, data: toCommandDto(command) }); }
async function listCommands(req, res) { const result = await service.listCommands(valid(schemas.listSchema, req.query), req.auth); res.status(httpStatus.OK).json({ success: true, data: { items: result.items.map(toCommandDto), pagination: { total: result.total, page: result.page, limit: result.limit } } }); }
async function claimNext(req, res) { const payload = valid(schemas.heartbeatSchema, req.body); const claim = await service.claimNext(payload, req.auth); res.status(httpStatus.OK).json({ success: true, data: claim ? { command: toCommandDto(claim.command), leaseToken: claim.leaseToken } : null }); }
async function startCommand(req, res) { const { commandId } = valid(schemas.commandIdSchema, req.params); const input = { ...valid(schemas.heartbeatSchema, req.body), ...valid(schemas.leaseSchema, req.body) }; const command = await service.startCommand(commandId, input, req.auth); res.status(httpStatus.OK).json({ success: true, data: toCommandDto(command) }); }
async function completeCommand(req, res) { const { commandId } = valid(schemas.commandIdSchema, req.params); const input = { ...valid(schemas.heartbeatSchema, req.body), ...valid(schemas.completeSchema, req.body) }; const command = await service.completeCommand(commandId, input, req.auth); res.status(httpStatus.OK).json({ success: true, data: toCommandDto(command) }); }
module.exports = { heartbeat, listAgents, listManagementAgents, createCommand, listCommands, claimNext, startCommand, completeCommand };
