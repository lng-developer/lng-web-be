const Joi = require('joi');

const objectId = Joi.string().hex().length(24);
const attachment = Joi.object({
  mediaId: Joi.string().trim().min(1).max(200).required(),
  filename: Joi.string().trim().max(255).allow(null, ''),
  mimeType: Joi.string().trim().max(100).allow(null, ''),
});
const eventDetails = Joi.object({
  startDate: Joi.date().iso(),
  endDate: Joi.date().iso().min(Joi.ref('startDate')),
  location: Joi.string().trim().max(300).allow(null, ''),
  isMandatory: Joi.boolean(),
});
const fields = {
  title: Joi.string().trim().min(1).max(200),
  content: Joi.string().trim().min(1).max(20000),
  category: Joi.string().valid('NEWS', 'POLICY', 'EVENT', 'OTHER'),
  priority: Joi.string().valid('LOW', 'NORMAL', 'HIGH', 'URGENT'),
  attachments: Joi.array().items(attachment).unique('mediaId').max(20),
  sendToAll: Joi.boolean(),
  targetDepartmentIds: Joi.array().items(objectId).unique().max(100),
  targetProfileIds: Joi.array().items(objectId).unique().max(500),
  status: Joi.string().valid('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED'),
  isPinned: Joi.boolean(),
  scheduledAt: Joi.date().iso().allow(null),
  remindAt: Joi.date().iso().allow(null),
  eventDetails: eventDetails.allow(null),
};

const createAnnouncementSchema = Joi.object({
  ...fields,
  title: fields.title.required(),
  content: fields.content.required(),
}).custom((value, helpers) => (
  value.sendToAll === false && !value.targetDepartmentIds?.length && !value.targetProfileIds?.length
    ? helpers.error('any.custom', { message: 'A targeted announcement requires an audience' })
    : value
));
const updateAnnouncementSchema = Joi.object(fields).min(1);
const announcementParamsSchema = Joi.object({ id: objectId.required() });
const listAnnouncementSchema = Joi.object({
  category: fields.category,
  status: fields.status,
  search: Joi.string().trim().max(200),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

function validate(schema, payload) {
  const result = schema.validate(payload, { abortEarly: false, stripUnknown: true, convert: true });
  return result.error
    ? { value: result.value, details: result.error.details.map(({ message, path, type }) => ({ message, path, type })) }
    : { value: result.value };
}

module.exports = {
  announcementParamsSchema,
  createAnnouncementSchema,
  listAnnouncementSchema,
  updateAnnouncementSchema,
  validate,
};
