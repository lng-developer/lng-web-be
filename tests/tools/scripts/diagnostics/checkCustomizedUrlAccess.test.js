const { Readable, Writable } = require('stream');
const { pipeline } = require('stream/promises');

const {
  redactUrl,
  validateSafeUrl,
  classifyResponse,
  createByteLimitTransform,
} = require('../../../../tools/scripts/diagnostics/checkCustomizedUrlAccess');

describe('checkCustomizedUrlAccess diagnostic helpers', () => {
  test('redacts query string from signed URLs', () => {
    expect(redactUrl('https://zme-caps.amazon.com/t/file.zip?token=secret&expires=soon'))
      .toBe('https://zme-caps.amazon.com/[REDACTED_PATH]?[REDACTED]');
  });

  test('rejects non-http protocols', async () => {
    await expect(validateSafeUrl('file:///etc/passwd')).rejects.toThrow('Unsupported protocol');
  });

  test('rejects localhost targets', async () => {
    await expect(validateSafeUrl('http://localhost/file.zip')).rejects.toThrow('Unsafe hostname');
  });

  test('rejects IPv6 loopback targets', async () => {
    await expect(validateSafeUrl('http://[::1]/file.zip')).rejects.toThrow('Unsafe IP address');
  });

  test('classifies html responses as html', () => {
    const result = classifyResponse({
      statusCode: 200,
      contentType: 'text/html; charset=utf-8',
      firstBytes: Buffer.from('<!doctype html><html><head><title>Report</title>'),
    });

    expect(result).toBe('html');
  });

  test('classifies sign-in html as login', () => {
    const result = classifyResponse({
      statusCode: 200,
      contentType: 'text/html; charset=utf-8',
      firstBytes: Buffer.from('<html><head><title>Amazon Sign-In</title></head>'),
    });

    expect(result).toBe('login');
  });

  test('classifies zip magic bytes as zip', () => {
    const result = classifyResponse({
      statusCode: 200,
      contentType: 'application/octet-stream',
      firstBytes: Buffer.from([0x50, 0x4B, 0x03, 0x04]),
    });

    expect(result).toBe('zip');
  });

  test('marks streamed response oversized when maxBytes is exceeded', async () => {
    await expect(pipeline(
      Readable.from([Buffer.alloc(5), Buffer.alloc(5)]),
      createByteLimitTransform(8),
      new Writable({
        write(chunk, encoding, callback) {
          callback();
        },
      }),
    )).rejects.toMatchObject({ code: 'REMOTE_STREAM_TOO_LARGE' });
  });
});
