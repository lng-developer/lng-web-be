const Joi = require('joi');
const id = Joi.string().hex().length(24);
const lease = Joi.object({ clientId: Joi.string().trim().max(120).required(), leaseToken: Joi.string().min(20).max(200).required() });
const result = lease.keys({
  asin: Joi.string().pattern(/^[A-Z0-9]{10}$/).required(),
  sourceUrl: Joi.string().uri({ scheme: ['https'] }).max(2000),
  errorCode: Joi.string().pattern(/^[A-Z0-9_]+$/).max(100),
  errorMessage: Joi.string().max(1000),
}).xor('sourceUrl', 'errorCode');
module.exports = {
  lease, result,
  pause: lease.keys({ errorMessage: Joi.string().max(1000) }),
  create: Joi.object({ shopId: id.required(), agentId: id.required(), asins: Joi.array().items(Joi.string().pattern(/^[A-Z0-9]{10}$/)).min(1).max(100).unique() }),
  schedule: Joi.object({ enabled: Joi.boolean().required() }),
  list: Joi.object({ shopId: id, page: Joi.number().integer().min(1).default(1), limit: Joi.number().integer().min(1).max(100).default(20) }),
  params: Joi.object({ agentId: id, jobId: id, commandId: id, itemId: id }),
};
