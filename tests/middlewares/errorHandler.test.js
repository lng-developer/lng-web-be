jest.mock('../../src/shared/utils/logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
  http: jest.fn(),
  warn: jest.fn(),
}));
jest.mock('../../src/config', () => ({ env: 'production', metrics: { enabled: false } }));

const multer = require('multer');
const AppError = require('../../src/shared/errors/appError');
const errorHandler = require('../../src/middlewares/errorHandler');
const requestLogger = require('../../src/middlewares/requestLogger');
const logger = require('../../src/shared/utils/logger');

beforeEach(() => {
  jest.clearAllMocks();
});

test('returns the stable 413 envelope when Multer rejects an oversized file', () => {
  const error = new multer.MulterError('LIMIT_FILE_SIZE');
  const req = { id: 'request-413', method: 'POST', originalUrl: '/api/media/assets' };
  const res = {
    headersSent: false,
    locals: {},
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  };

  errorHandler(error, req, res, jest.fn());

  expect(res.status).toHaveBeenCalledWith(413);
  expect(res.json).toHaveBeenCalledWith({
    success: false,
    error: {
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Uploaded file exceeds the maximum allowed size',
      requestId: 'request-413',
    },
  });
});

test('logs common scanner 404s at debug level', () => {
  const error = new AppError('Route not found: GET /dispatch.asp', 404);
  const req = { id: 'request-404', method: 'GET', originalUrl: '/dispatch.asp', path: '/dispatch.asp' };
  const res = {
    headersSent: false,
    locals: {},
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  };

  errorHandler(error, req, res, jest.fn());

  expect(logger.debug).toHaveBeenCalledWith('request_failed', expect.objectContaining({
    requestId: 'request-404',
    statusCode: 404,
  }));
  expect(logger.warn).not.toHaveBeenCalled();
  expect(res.locals.errorLogged).toBe(true);
});

test('request logger does not duplicate errors already logged by the error handler', () => {
  const listeners = {};
  const req = { id: 'request-dup', method: 'GET', originalUrl: '/missing' };
  const res = {
    locals: { errorLogged: true },
    statusCode: 404,
    on: jest.fn((event, callback) => { listeners[event] = callback; }),
  };

  requestLogger(req, res, jest.fn());
  listeners.finish();

  expect(logger.http).not.toHaveBeenCalled();
});
