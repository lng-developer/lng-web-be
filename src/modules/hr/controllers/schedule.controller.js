const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/schedule.service');
const {
  createAssignmentSchema,
  createCalendarOverrideSchema,
  createShiftSchema,
  createWorkLocationSchema,
  idParamsSchema,
  listScheduleSchema,
  updateAssignmentSchema,
  updateCalendarOverrideSchema,
  updateShiftSchema,
  updateWorkLocationSchema,
  validate,
} = require('../validators/schedule.validator');

function assertValid(schema, payload) {
  const { value, details } = validate(schema, payload);
  if (details) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  }
  return value;
}

function createCollectionController(method, schema) {
  return async (req, res) => {
    const payload = assertValid(schema, req.body);
    res.status(httpStatus.CREATED).json({ success: true, data: await service[method](payload, req.auth) });
  };
}

function listCollectionController(method) {
  return async (req, res) => {
    const query = assertValid(listScheduleSchema, req.query);
    res.status(httpStatus.OK).json({ success: true, data: await service[method](query, req.auth) });
  };
}

function updateRecordController(method, schema) {
  return async (req, res) => {
    const { id } = assertValid(idParamsSchema, req.params);
    const payload = assertValid(schema, req.body);
    res.status(httpStatus.OK).json({ success: true, data: await service[method](id, payload, req.auth) });
  };
}

module.exports = {
  createAssignment: createCollectionController('createAssignment', createAssignmentSchema),
  createCalendarOverride: createCollectionController('createCalendarOverride', createCalendarOverrideSchema),
  createShift: createCollectionController('createShift', createShiftSchema),
  createWorkLocation: createCollectionController('createWorkLocation', createWorkLocationSchema),
  listAssignments: listCollectionController('listAssignments'),
  listCalendarOverrides: listCollectionController('listCalendarOverrides'),
  listShifts: listCollectionController('listShifts'),
  listWorkLocations: listCollectionController('listWorkLocations'),
  updateAssignment: updateRecordController('updateAssignment', updateAssignmentSchema),
  updateCalendarOverride: updateRecordController('updateCalendarOverride', updateCalendarOverrideSchema),
  updateShift: updateRecordController('updateShift', updateShiftSchema),
  updateWorkLocation: updateRecordController('updateWorkLocation', updateWorkLocationSchema),
};
