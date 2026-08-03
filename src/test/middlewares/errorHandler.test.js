jest.mock('../../shared/utils/logger', () => ({ error: jest.fn(), warn: jest.fn() }));
jest.mock('../../config', () => ({ env: 'production' }));

const multer = require('multer');
const errorHandler = require('../../middlewares/errorHandler');

test('returns the stable 413 envelope when Multer rejects an oversized file', () => {
  const error = new multer.MulterError('LIMIT_FILE_SIZE');
  const req = { id: 'request-413', method: 'POST', originalUrl: '/api/media/assets' };
  const res = {
    headersSent: false,
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
