const Joi = require('joi');
const { accountAssignmentSchema } = require('../../auth/validators/auth.validator');
const { hrEmployeeStatuses, hrEmploymentTypes, hrWorkModes } = require('../constants/hr.constants');

const objectId = Joi.string().hex().length(24);

const staffProvisioningSchema = Joi.object({
  employeeCode: Joi.string().trim().uppercase().min(1).max(80).required(),
  workEmail: Joi.string().trim().lowercase().email().required(),
  fullName: Joi.string().trim().min(1).max(160).required(),
  departmentId: objectId.allow(null),
  teamId: objectId.allow(null),
  jobTitle: Joi.string().trim().max(160).allow(null, ''),
  jobLevel: Joi.string().trim().max(80).allow(null, ''),
  employmentType: Joi.string().valid(...Object.values(hrEmploymentTypes)).default(hrEmploymentTypes.FULL_TIME),
  workMode: Joi.string().valid(...Object.values(hrWorkModes)).default(hrWorkModes.ONSITE),
  startDate: Joi.date().iso().default(() => new Date()),
  probationEndDate: Joi.date().iso().allow(null),
  status: Joi.string().valid(...Object.values(hrEmployeeStatuses)).default(hrEmployeeStatuses.PROBATION),
  baseCurrency: Joi.string().trim().uppercase().length(3).default('VND'),
  baseSalary: Joi.number().min(0).default(0),
  assignments: Joi.array().items(accountAssignmentSchema.required()).min(1).required(),
});

function validate(schema, payload) {
  const result = schema.validate(payload, { abortEarly: false, stripUnknown: true, convert: true });
  return result.error
    ? { value: result.value, details: result.error.details.map(({ message, path, type }) => ({ message, path, type })) }
    : { value: result.value };
}

module.exports = { staffProvisioningSchema, validate };
