const path = require('path');
const dotenv = require('dotenv');
const Joi = require('joi');

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  MONGODB_URI: Joi.string()
    .trim()
    .pattern(/^mongodb(\+srv)?:\/\/\S+$/)
    .required()
    .messages({
      'string.pattern.base': 'MONGODB_URI must be a valid MongoDB connection string',
    }),
  REDIS_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  REDIS_HOST: Joi.string().hostname().default('127.0.0.1'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),
  REDIS_DB: Joi.number().integer().min(0).default(0),
}).unknown(true);

const { value, error } = schema.validate(process.env, {
  abortEarly: false,
  convert: true,
});

if (error) {
  throw new Error(`Environment validation failed: ${error.details.map((detail) => detail.message).join(', ')}`);
}

module.exports = {
  env: value.NODE_ENV,
  port: value.PORT,
  database: {
    uri: value.MONGODB_URI,
  },
  redis: {
    enabled: value.REDIS_ENABLED,
    host: value.REDIS_HOST,
    port: value.REDIS_PORT,
    password: value.REDIS_PASSWORD || undefined,
    db: value.REDIS_DB,
  },
};
