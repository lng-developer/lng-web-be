const config = require('../../config');

const levels = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
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

function write(level, message, meta = {}) {
  if (!shouldLog(level)) {
    return;
  }

  const payload = {
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

  const output = JSON.stringify(payload);

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

module.exports = {
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
};
