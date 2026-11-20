const { EventEmitter } = require('events');

jest.mock('../../src/shared/utils/logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
  http: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
}));

const logger = require('../../src/shared/utils/logger');
const requestLogger = require('../../src/middlewares/requestLogger');

test('records a client-aborted response as HTTP 499', () => {
  const req = { id: 'request-1', method: 'GET', originalUrl: '/api/media/assets/asset-1/download' };
  const res = Object.assign(new EventEmitter(), {
    locals: {},
    statusCode: 200,
    writableEnded: false,
  });

  requestLogger(req, res, jest.fn());
  res.emit('close');

  expect(logger.http).toHaveBeenCalledWith('warn', expect.objectContaining({
    rid: 'request-1',
    m: 'GET',
    path: '/api/media/assets/asset-1/download',
    st: 499,
  }));
});
