const path = require('path');
const dotenv = require('dotenv');
const Joi = require('joi');

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  LOG_LEVEL: Joi.string().valid('debug', 'info', 'warn', 'error', 'silent').default('info'),
  LOG_FORMAT: Joi.string().valid('pretty', 'json').optional(),
  METRICS_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  JWT_ACCESS_SECRET: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.string().default('dev-only-change-me'),
  }),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_DAYS: Joi.number().integer().min(1).default(30),
  CORS_ORIGIN: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.string().default('http://localhost:5173'),
  }),
  AUTH_REGISTER_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  MEDIA_UPLOAD_MAX_BYTES: Joi.number().integer().min(1).default(10 * 1024 * 1024),
  BOOTSTRAP_ADMIN_EMAIL: Joi.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: Joi.string().min(8).optional(),
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
  log: {
    level: value.LOG_LEVEL,
    format: value.LOG_FORMAT || (value.NODE_ENV === 'production' ? 'json' : 'pretty'),
  },
  metrics: {
    enabled: value.METRICS_ENABLED,
  },
  auth: {
    jwtAccessSecret: value.JWT_ACCESS_SECRET,
    jwtAccessExpiresIn: value.JWT_ACCESS_EXPIRES_IN,
    refreshTokenExpiresDays: value.REFRESH_TOKEN_EXPIRES_DAYS,
    registerEnabled: value.AUTH_REGISTER_ENABLED,
    bootstrapAdminEmail: value.BOOTSTRAP_ADMIN_EMAIL,
    bootstrapAdminPassword: value.BOOTSTRAP_ADMIN_PASSWORD,
  },
  http: {
    corsOrigins: value.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean),
  },
  media: {
    uploadMaxBytes: value.MEDIA_UPLOAD_MAX_BYTES,
  },
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
