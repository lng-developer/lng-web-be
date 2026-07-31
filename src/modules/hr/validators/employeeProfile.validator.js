const Joi = require('joi');
const {
  hrEmployeeStatuses,
  hrEmploymentTypes,
  hrWorkModes,
} = require('../constants/hr.constants');

const objectId = Joi.string().hex().length(24);
const optionalString = Joi.string().trim().max(500).allow(null, '');
const isoDate = Joi.date().iso().allow(null);
const nonNegativeNumber = Joi.number().min(0);
const sensitiveFields = {
  identityCard: optionalString,
  taxIdentification: optionalString,
  socialInsuranceNumber: optionalString,
  bankAccount: Joi.object({
    bankName: optionalString,
    accountNumber: optionalString,
  }),
  baseSalary: Joi.number().min(0),
  allowances: Joi.object({
    lunch: nonNegativeNumber,
    fuel: nonNegativeNumber,
    other: nonNegativeNumber,
  }),
  responsibilityAllowance: nonNegativeNumber,
};

function validate(schema, payload, { stripUnknown = true } = {}) {
  const result = schema.validate(payload, {
    abortEarly: false,
    stripUnknown,
    convert: true,
  });
  return result.error
    ? { value: result.value, details: result.error.details.map(({ message, path, type }) => ({ message, path, type })) }
    : { value: result.value };
}

const profileFields = {
  accountId: objectId,
  employeeCode: Joi.string().trim().uppercase().min(1).max(80),
  fullName: Joi.string().trim().min(1).max(160),
  gender: Joi.string().trim().uppercase().max(20).allow(null, ''),
  birthDate: isoDate,
  phoneNumber: Joi.string().trim().max(40).allow(null, ''),
  address: optionalString,
  personalEmail: Joi.string().trim().lowercase().email().max(320).allow(null, ''),
  workEmail: Joi.string().trim().lowercase().email().max(320).allow(null, ''),
  emergencyContact: Joi.object({
    name: Joi.string().trim().max(160).allow(null, ''),
    phone: Joi.string().trim().max(40).allow(null, ''),
    relation: Joi.string().trim().max(80).allow(null, ''),
  }),
  departmentId: objectId.allow(null),
  teamId: objectId.allow(null),
  jobTitle: Joi.string().trim().max(160).allow(null, ''),
  jobLevel: Joi.string().trim().max(80).allow(null, ''),
  employmentType: Joi.string().valid(...Object.values(hrEmploymentTypes)),
  workMode: Joi.string().valid(...Object.values(hrWorkModes)),
  startDate: isoDate,
  probationEndDate: isoDate,
  endDate: isoDate,
  status: Joi.string().valid(...Object.values(hrEmployeeStatuses)),
  contractType: Joi.string().trim().max(80).allow(null, ''),
  contractNumber: Joi.string().trim().max(120).allow(null, ''),
  contractStartDate: isoDate,
  contractEndDate: isoDate,
  promotionDate: isoDate,
  transferDate: isoDate,
  dependantDetails: Joi.array().items(Joi.object({
    name: Joi.string().trim().max(160).required(),
    relation: Joi.string().trim().uppercase().max(80).required(),
    dob: isoDate,
    gender: Joi.string().trim().uppercase().max(20).allow(null, ''),
  })),
  dependants: Joi.number().integer().min(0),
  baseCurrency: Joi.string().trim().uppercase().length(3),
  isProfileUpdated: Joi.boolean(),
  ...sensitiveFields,
};

const createProfileSchema = Joi.object({
  ...profileFields,
  accountId: objectId.required(),
  employeeCode: Joi.string().trim().uppercase().min(1).max(80).required(),
  fullName: Joi.string().trim().min(1).max(160).required(),
});

const updateProfileSchema = Joi.object(profileFields).min(1);

const completeMyPersonalProfileSchema = Joi.object({
  gender: Joi.string().trim().uppercase().max(20).allow(null, ''),
  birthDate: isoDate,
  phoneNumber: Joi.string().trim().max(40).required(),
  address: optionalString.required(),
  personalEmail: Joi.string().trim().lowercase().email().max(320).required(),
  emergencyContact: Joi.object({
    name: Joi.string().trim().max(160).required(),
    phone: Joi.string().trim().max(40).required(),
    relation: Joi.string().trim().max(80).required(),
  }).required(),
  dependantDetails: profileFields.dependantDetails,
  identityCard: optionalString,
  taxIdentification: optionalString,
  socialInsuranceNumber: optionalString,
  bankAccount: Joi.object({
    bankName: optionalString,
    accountNumber: optionalString,
  }),
}).unknown(false);

const listProfilesSchema = Joi.object({
  status: Joi.string().valid(...Object.values(hrEmployeeStatuses)),
  departmentId: objectId,
  teamId: objectId,
  q: Joi.string().trim().max(160),
  includeDeleted: Joi.boolean(),
  includeSensitive: Joi.boolean(),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const profileDetailQuerySchema = Joi.object({
  includeSensitive: Joi.boolean(),
});

module.exports = {
  completeMyPersonalProfileSchema,
  createProfileSchema,
  listProfilesSchema,
  profileDetailQuerySchema,
  updateProfileSchema,
  validate,
};
