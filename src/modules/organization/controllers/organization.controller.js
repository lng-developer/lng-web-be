const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');
const organizationService = require('../services/organization.service');
const {
  listDepartmentsQuerySchema,
  departmentCreateSchema,
  departmentUpdateSchema,
  listTeamsQuerySchema,
  teamCreateSchema,
  teamUpdateSchema,
  teamMemberCreateSchema,
  validate,
} = require('../validators/organization.validator');

function assertValid(schema, payload) {
  const { value, details } = validate(schema, payload);

  if (details) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  }

  return value;
}

async function listDepartments(req, res) {
  const query = assertValid(listDepartmentsQuerySchema, req.query);
  const result = await organizationService.listDepartments(query, { actorAuth: req.auth });

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function createDepartment(req, res) {
  const payload = assertValid(departmentCreateSchema, req.body);
  const result = await organizationService.createDepartment(payload);

  res.status(httpStatus.CREATED).json({ success: true, data: result });
}

async function getDepartment(req, res) {
  const result = await organizationService.getDepartment(req.params.departmentId, { actorAuth: req.auth });

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function updateDepartment(req, res) {
  const payload = assertValid(departmentUpdateSchema, req.body);
  const result = await organizationService.updateDepartment(req.params.departmentId, payload);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function listTeams(req, res) {
  const query = assertValid(listTeamsQuerySchema, req.query);
  const result = await organizationService.listTeams(query, { actorAuth: req.auth });

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function createTeam(req, res) {
  const payload = assertValid(teamCreateSchema, req.body);
  const result = await organizationService.createTeam(payload);

  res.status(httpStatus.CREATED).json({ success: true, data: result });
}

async function getTeam(req, res) {
  const result = await organizationService.getTeam(req.params.teamId, { actorAuth: req.auth });

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function updateTeam(req, res) {
  const payload = assertValid(teamUpdateSchema, req.body);
  const result = await organizationService.updateTeam(req.params.teamId, payload);

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function addTeamMember(req, res) {
  const payload = assertValid(teamMemberCreateSchema, req.body);
  const result = await organizationService.addTeamMember(req.params.teamId, payload, { actorAuth: req.auth });

  res.status(httpStatus.CREATED).json({ success: true, data: result });
}

async function removeTeamMember(req, res) {
  const result = await organizationService.removeTeamMember(
    req.params.teamId,
    req.params.accountId,
    { actorAuth: req.auth },
  );

  res.status(httpStatus.OK).json({ success: true, data: result });
}

async function listTeamMembers(req, res) {
  const result = await organizationService.listTeamMembers(req.params.teamId, { actorAuth: req.auth });

  res.status(httpStatus.OK).json({ success: true, data: result });
}

module.exports = {
  listDepartments,
  createDepartment,
  getDepartment,
  updateDepartment,
  listTeams,
  createTeam,
  getTeam,
  updateTeam,
  addTeamMember,
  removeTeamMember,
  listTeamMembers,
};
