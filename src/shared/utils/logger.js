const config = require('../../config');

const levels = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
});

const colors = Object.freeze({
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  reset: '\x1b[0m',
});

function shouldLog(level) {
  const configuredLevel = config.log.level;
  return levels[level] >= levels[configuredLevel];
}

function serializeError(error) {
  if (!error) {
    return undefined;
  }

  return {
    name: error.name,
    message: error.message,
    stack: config.env === 'production' ? undefined : error.stack,
    code: error.code,
    statusCode: error.statusCode,
    isOperational: error.isOperational,
  };
}

function buildJsonPayload(level, message, meta, options) {
  const payload = options.http
    ? {
        ts: new Date().toISOString(),
        lvl: level,
        msg: message,
        ...meta,
      }
    : {
        timestamp: new Date().toISOString(),
        level,
        message,
        service: 'lng-web-be',
        env: config.env,
        ...meta,
      };

  if (payload.error instanceof Error) {
    payload.error = serializeError(payload.error);
  }

  return payload;
}

function formatValue(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

function formatMeta(meta, excludedKeys = []) {
  return Object.entries(meta)
    .filter(([key, value]) => !excludedKeys.includes(key) && value !== undefined && value !== null)
    .map(([key, value]) => {
      const formattedValue = formatValue(value);
      return formattedValue.includes(' ') ? `${key}="${formattedValue}"` : `${key}=${formattedValue}`;
    })
    .join(' ');
}

function formatPrettyLog(level, message, meta, options) {
  const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const levelLabel = level.toUpperCase();
  const coloredLevelLabel = `${colors[level] || ''}${levelLabel}${colors.reset}`;

  if (options.http) {
    const statusLabel = String(meta.st).padEnd(3, ' ');
    const durationLabel = `srv=${meta.ms}ms`;

    return `${timestamp} [${coloredLevelLabel}] HTTP ${meta.m} ${meta.path} ${statusLabel} ${durationLabel} rid=${meta.rid}`;
  }

  const errorMessage = meta.error instanceof Error ? ` error="${meta.error.message}"` : '';
  const formattedMeta = formatMeta(meta, ['error']);
  const metaSuffix = formattedMeta ? ` ${formattedMeta}` : '';

  return `${timestamp} [${coloredLevelLabel}] ${message}${metaSuffix}${errorMessage}`;
}

function writeOutput(level, output) {
  if (level === 'error') {
    console.error(output);
    return;
  }

  if (level === 'warn') {
    console.warn(output);
    return;
  }

  console.log(output);
}

function write(level, message, meta = {}, options = {}) {
  if (!shouldLog(level)) {
    return;
  }

  const output = config.log.format === 'pretty'
    ? formatPrettyLog(level, message, meta, options)
    : JSON.stringify(buildJsonPayload(level, message, meta, options));

  writeOutput(level, output);
}

module.exports = {
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
  http: (level, meta) => write(level, 'http', meta, { http: true }),
};
