const Joi = require('joi');
const { chatConversationTypes } = require('../constants/chat.constants');

const objectId = Joi.string().hex().length(24);
const pagination = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
};

const createConversationSchema = Joi.object({
  type: Joi.string().valid(...Object.values(chatConversationTypes)).required(),
  title: Joi.string().trim().max(160).allow(null, ''),
  shopId: objectId.allow(null),
  relatedResource: Joi.object({
    type: Joi.string().trim().max(80).required(),
    id: Joi.string().trim().max(120).required(),
  }).allow(null),
  participantAccountIds: Joi.array().items(objectId).max(100).default([]),
});

const sendMessageSchema = Joi.object({
  body: Joi.string().trim().max(4000).allow('').default(''),
  assetIds: Joi.array().items(objectId).max(20).default([]),
  mentions: Joi.array().items(objectId).max(50).default([]),
  replyToMessageId: objectId.allow(null),
}).custom((value, helpers) => {
  if (!value.body && value.assetIds.length === 0) return helpers.error('any.required');
  return value;
}, 'message content');

const listSchema = Joi.object(pagination);
const listParticipantsSchema = Joi.object({
  search: Joi.string().trim().max(120).allow('', null),
  limit: Joi.number().integer().min(1).max(100).default(50),
});

function validate(schema, payload) {
  return schema.validate(payload, { abortEarly: false, stripUnknown: true });
}

module.exports = {
  createConversationSchema,
  listParticipantsSchema,
  listSchema,
  sendMessageSchema,
  validate,
};
