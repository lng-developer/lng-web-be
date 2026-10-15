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
  AUTH_LOGIN_RATE_LIMIT_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  MEDIA_UPLOAD_MAX_BYTES: Joi.number().integer().min(1).default(10 * 1024 * 1024),
  WASABI_ENDPOINT: Joi.string().uri({ scheme: ['https'] }).allow('').default(''),
  WASABI_REGION: Joi.string().allow('').default(''),
  WASABI_BUCKET: Joi.string().allow('').default(''),
  WASABI_ACCESS_KEY_ID: Joi.string().allow('').default(''),
  WASABI_SECRET_ACCESS_KEY: Joi.string().allow('').default(''),
  WASABI_UPLOAD_URL_TTL_SECONDS: Joi.number().integer().min(60).max(3600).default(900),
  WASABI_DOWNLOAD_URL_TTL_SECONDS: Joi.number().integer().min(60).max(3600).default(600),
  WASABI_MULTIPART_PART_BYTES: Joi.number().integer().min(5 * 1024 * 1024).default(64 * 1024 * 1024),
  WASABI_MAX_ASSET_BYTES: Joi.number().integer().min(1).max(2 * 1024 * 1024 * 1024).default(2 * 1024 * 1024 * 1024),
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
  AMAZON_ADS_GMAIL_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  AMAZON_ADS_GMAIL_USER: Joi.string().email().allow('').default(''),
  AMAZON_ADS_GMAIL_APP_PASSWORD: Joi.string().allow('').default(''),
  AMAZON_ADS_GMAIL_SALES_CHANNEL_CODE: Joi.string().trim().uppercase().default('AMAZON'),
  AMAZON_ADS_GMAIL_MARKETPLACE_CODE: Joi.string().trim().uppercase().default('US'),
  AMAZON_ADS_GMAIL_POLL_INTERVAL_MS: Joi.number().integer().min(60 * 1000).default(5 * 60 * 1000),
  LNG_FULFILLMENT_FEE_AMOUNT: Joi.number().integer().min(0).default(100),
  GOOGLE_CLIENT_ID: Joi.string().allow('').default(''),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').default(''),
  MICROSOFT_CLIENT_ID: Joi.string().allow('').default(''),
  MICROSOFT_TENANT_ID: Joi.string().allow('').default('common'),
  MICROSOFT_ALLOWED_DOMAIN: Joi.string().trim().default('lngwork.co'),
  MICROSOFT_AUTO_PROVISION: Joi.boolean().truthy('true').falsy('false').default(true),
  TEAMS_SYNC_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  TEAMS_CLIENT_ID: Joi.string().allow('').default(''),
  TEAMS_CLIENT_SECRET: Joi.string().allow('').default(''),
  TEAMS_TENANT_ID: Joi.string().allow('').default(''),
  TEAMS_WEBHOOK_URL: Joi.string().uri({ scheme: ['https'] }).allow('').default(''),
  TEAMS_WEBHOOK_CLIENT_STATE: Joi.string().allow('').default(''),
  TEAMS_ENCRYPTION_KEY: Joi.string().allow('').default(''),
  TEAMS_OAUTH_REDIRECT_URI: Joi.string().uri({ scheme: ['https'] }).allow('').default(''),
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
    loginRateLimitEnabled: value.AUTH_LOGIN_RATE_LIMIT_ENABLED,
    bootstrapAdminEmail: value.BOOTSTRAP_ADMIN_EMAIL,
    bootstrapAdminPassword: value.BOOTSTRAP_ADMIN_PASSWORD,
    googleClientId: value.GOOGLE_CLIENT_ID || null,
    googleClientSecret: value.GOOGLE_CLIENT_SECRET || null,
    microsoftClientId: value.MICROSOFT_CLIENT_ID || null,
    microsoftTenantId: value.MICROSOFT_TENANT_ID || 'common',
    microsoftAllowedDomain: value.MICROSOFT_ALLOWED_DOMAIN || 'lngwork.co',
    microsoftAutoProvision: value.MICROSOFT_AUTO_PROVISION,
  },
  http: {
    corsOrigins: value.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean),
  },
  media: {
    uploadMaxBytes: value.MEDIA_UPLOAD_MAX_BYTES,
    wasabi: {
      endpoint: value.WASABI_ENDPOINT || null,
      region: value.WASABI_REGION || null,
      bucket: value.WASABI_BUCKET || null,
      accessKeyId: value.WASABI_ACCESS_KEY_ID || null,
      secretAccessKey: value.WASABI_SECRET_ACCESS_KEY || null,
      uploadUrlTtlSeconds: value.WASABI_UPLOAD_URL_TTL_SECONDS,
      downloadUrlTtlSeconds: value.WASABI_DOWNLOAD_URL_TTL_SECONDS,
      partBytes: value.WASABI_MULTIPART_PART_BYTES,
      maxAssetBytes: value.WASABI_MAX_ASSET_BYTES,
    },
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
  amazonAdsGmail: {
    enabled: value.AMAZON_ADS_GMAIL_ENABLED,
    user: value.AMAZON_ADS_GMAIL_USER || null,
    appPassword: value.AMAZON_ADS_GMAIL_APP_PASSWORD || null,
    salesChannelCode: value.AMAZON_ADS_GMAIL_SALES_CHANNEL_CODE,
    marketplaceCode: value.AMAZON_ADS_GMAIL_MARKETPLACE_CODE,
    pollIntervalMs: value.AMAZON_ADS_GMAIL_POLL_INTERVAL_MS,
  },
  finance: {
    lngFulfillmentFeeAmount: value.LNG_FULFILLMENT_FEE_AMOUNT,
  },
  teams: {
    enabled: Boolean(value.TEAMS_SYNC_ENABLED),
    clientId: value.TEAMS_CLIENT_ID || value.MICROSOFT_CLIENT_ID || null,
    clientSecret: value.TEAMS_CLIENT_SECRET || null,
    tenantId: value.TEAMS_TENANT_ID || value.MICROSOFT_TENANT_ID || 'common',
    webhookUrl: value.TEAMS_WEBHOOK_URL || null,
    webhookClientState: value.TEAMS_WEBHOOK_CLIENT_STATE || null,
    encryptionKey: value.TEAMS_ENCRYPTION_KEY || null,
    oauthRedirectUri: value.TEAMS_OAUTH_REDIRECT_URI || null,
  },
};
