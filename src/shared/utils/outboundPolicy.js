const AppError = require('../errors/appError');
const errorCodes = require('../constants/errorCodes');

function isOutboundBlocked() {
  const appEnv = process.env.APP_ENV || process.env.NODE_ENV || 'development';
  const mode = process.env.OUTBOUND_MODE || (appEnv === 'development' ? 'blocked' : 'live');
  if (!['blocked', 'live'].includes(mode) || (appEnv === 'development' && mode !== 'blocked')) {
    throw new Error('Invalid OUTBOUND_MODE: development requires blocked outbound');
  }
  return mode === 'blocked';
}

function blockedError() {
  return new AppError('Outbound integrations are disabled in this environment', 503, true, errorCodes.OUTBOUND_BLOCKED);
}

function assertOutboundAllowed() {
  if (isOutboundBlocked()) throw blockedError();
}

let mongoOptions;
function allowedTcpDestination(host, port) {
  const normalizedHost = String(host || 'localhost').toLowerCase().replace(/\.$/, '');
  const normalizedPort = Number(port);
  if (normalizedHost === (process.env.REDIS_HOST || '127.0.0.1').toLowerCase()
      && normalizedPort === Number(process.env.REDIS_PORT || 6379)) return true;
  if (!process.env.MONGODB_URI) return false;
  if (!mongoOptions) {
    try {
      // Use the installed driver's parser, including replica sets and IPv6.
      mongoOptions = new (require('mongoose').mongo.MongoClient)(process.env.MONGODB_URI).options;
    } catch {
      throw new Error('Invalid Mongo configuration for outbound isolation');
    }
  }
  if (mongoOptions.srvHost) {
    const domain = mongoOptions.srvHost.toLowerCase().split('.').slice(1).join('.');
    return domain.includes('.') && normalizedPort === 27017
      && normalizedHost.endsWith(`.${domain}`);
  }
  return mongoOptions.hosts.some(target => target.host.toLowerCase() === normalizedHost && target.port === normalizedPort);
}

let installed = false;
function install() {
  if (!isOutboundBlocked() || installed) return;
  installed = true;
  // Install before loading app clients: covers SDKs as well as handwritten adapters.
  for (const transport of ['http', 'https']) {
    const client = require(transport);
    client.request = () => { throw blockedError(); };
    client.get = () => { throw blockedError(); };
  }
  globalThis.fetch = async () => { throw blockedError(); };
  const net = require('net');
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function isolatedConnect(...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = typeof first === 'object' && first !== null
      ? first : { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
    if (!options.path && allowedTcpDestination(options.host, options.port)) return connect.apply(this, args);
    process.nextTick(() => this.destroy(blockedError()));
    return this;
  };
}

module.exports = { allowedTcpDestination, assertOutboundAllowed, install, isOutboundBlocked };
