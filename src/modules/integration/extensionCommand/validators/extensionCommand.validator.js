const Joi = require('joi');
const { extensionCommandTypes } = require('../constants/extensionCommand.constants');
const objectId = Joi.string().hex().length(24);
const adsDate = Joi.date().iso().raw();
const financeDateCommandTypes = [extensionCommandTypes.IMPORT_ADS_SPEND, extensionCommandTypes.IMPORT_TRANSACTIONS];
const createCommandSchema = Joi.object({ maxOrders: Joi.number().integer().min(1).max(200), type: Joi.string().valid(...Object.values(extensionCommandTypes)).required(), shopId: objectId.required(), agentId: objectId.required(), numDays: Joi.number().integer().valid(1, 2, 7, 15, 30).default(1), dateFrom: adsDate.when('type', { is: Joi.valid(...financeDateCommandTypes), then: Joi.required() }), dateTo: adsDate.when('type', { is: Joi.valid(...financeDateCommandTypes), then: Joi.required() }) }).custom((value, helpers) => {
  if (value.type === extensionCommandTypes.IMPORT_SETTLEMENTS && (!!value.dateFrom !== !!value.dateTo)) return helpers.error('any.invalid');
  if (!financeDateCommandTypes.includes(value.type) && !(value.type === extensionCommandTypes.IMPORT_SETTLEMENTS && value.dateFrom)) return value;
  const from = new Date(value.dateFrom);
  const to = new Date(value.dateTo);
  if (from > to || (to - from) / 86400000 > 119) return helpers.error('any.invalid');
  return value;
});
const heartbeatSchema = Joi.object({ provider: Joi.string().valid('ETSY'), protocolVersion: Joi.number().valid(1), clientId: Joi.string().trim().max(120).required(), label: Joi.string().trim().max(120).required(), version: Joi.string().trim().max(40).allow('', null), listingImageSync: Joi.boolean().default(false), apiBaseUrl: Joi.string().uri({ scheme: ['http', 'https'] }).max(300).allow('', null) }).and('provider', 'protocolVersion');
const manualOrderImportSchema = heartbeatSchema.keys({ numDays: Joi.number().integer().valid(1, 2, 7, 15, 30).default(1) });
const manualAdsImportSchema = heartbeatSchema.keys({ dateFrom: adsDate.required(), dateTo: adsDate.required() }).custom((value, helpers) => value.dateFrom === value.dateTo ? value : helpers.error('any.invalid'));
const commandIdSchema = Joi.object({ commandId: objectId.required() });
const leaseSchema = Joi.object({ leaseToken: Joi.string().trim().min(20).max(200).required() });
const renewSchema = leaseSchema.keys({ importJobId: objectId });
const completeSchema = leaseSchema.keys({ success: Joi.boolean().required(), importJobId: objectId.allow(null), importedCount: Joi.number().integer().min(0).max(1000000).default(0), failedCount: Joi.number().integer().min(0).max(1000000).default(0), errorMessage: Joi.string().trim().max(1000).allow('', null) });
const listSchema = Joi.object({ page: Joi.number().integer().min(1).default(1), limit: Joi.number().integer().min(1).max(100).default(20) });
const upsertOrderScheduleSchema = Joi.object({ enabled: Joi.boolean().required(), intervalMinutes: Joi.number().integer().valid(60, 120, 180, 240).required() });
const upsertFinanceScheduleSchema = Joi.object({ enabled: Joi.boolean().required() });
function validate(schema, payload) { const result = schema.validate(payload, { abortEarly: false, stripUnknown: true }); return result.error ? { details: result.error.details } : { value: result.value }; }
module.exports = { createCommandSchema, heartbeatSchema, manualOrderImportSchema, manualAdsImportSchema, commandIdSchema, leaseSchema, renewSchema, completeSchema, listSchema, upsertOrderScheduleSchema, upsertFinanceScheduleSchema, validate };
