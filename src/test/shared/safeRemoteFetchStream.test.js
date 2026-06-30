const { PassThrough, Readable, Writable } = require('stream');
const { pipeline } = require('stream/promises');

const {
  redactUrl,
  validateSafeUrl,
  classifyResponse,
  createByteLimitTransform,
  createPeekClassificationTransform,
  createIdleTimeoutTransform,
} = require('../../shared/network/safeRemoteFetchStream');

async function drain(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe('safeRemoteFetchStream shared helpers', () => {
  test('redacts signed URL query strings', () => {
    expect(redactUrl('https://zme-caps.amazon.com/t/file.zip?token=secret'))
      .toBe('https://zme-caps.amazon.com/[REDACTED_PATH]?[REDACTED]');
  });

  test('rejects non-http protocols', async () => {
    await expect(validateSafeUrl('ftp://example.test/file.zip')).rejects.toThrow('Unsupported protocol');
  });

  test('rejects localhost and private IP targets', async () => {
    await expect(validateSafeUrl('http://localhost/file.zip')).rejects.toThrow('Unsafe hostname');
    await expect(validateSafeUrl('http://127.0.0.1/file.zip')).rejects.toThrow('Unsafe IP address');
    await expect(validateSafeUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow('Unsafe IP address');
  });

  test('classifies zip and html from first bytes', () => {
    expect(classifyResponse({
      statusCode: 200,
      contentType: 'application/octet-stream',
      firstBytes: Buffer.from([0x50, 0x4B, 0x03, 0x04]),
    })).toBe('zip');

    expect(classifyResponse({
      statusCode: 200,
      contentType: 'text/html',
      firstBytes: Buffer.from('<html><head><title>Amazon Sign-In</title></head>'),
    })).toBe('login');
  });

  test('peek classification transform does not consume first bytes', async () => {
    let metadata;
    const transform = createPeekClassificationTransform({
      statusCode: 200,
      contentType: 'application/zip',
      onClassified: (result) => { metadata = result; },
    });

    const output = await drain(Readable.from([
      Buffer.from([0x50, 0x4B]),
      Buffer.from([0x03, 0x04, 0x41, 0x42]),
    ]).pipe(transform));

    expect(output).toEqual(Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x41, 0x42]));
    expect(metadata.classification).toBe('zip');
    expect(metadata.firstBytesHex).toBe('50 4B 03 04 41 42');
  });

  test('byte limit transform aborts when streamed bytes exceed maxBytes', async () => {
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

  test('peek classification rejects html stream without buffering all bytes', async () => {
    const source = new PassThrough();
    const transform = createPeekClassificationTransform({
      statusCode: 200,
      contentType: 'text/html',
    });

    const readPromise = drain(source.pipe(transform));
    source.write('<html><head><title>Login</title></head>');
    source.end(Buffer.alloc(1024 * 1024));

    await expect(readPromise).rejects.toMatchObject({ code: 'REMOTE_RESPONSE_NOT_DOWNLOADABLE' });
  });

  test('idle timeout transform aborts stalled response streams', async () => {
    jest.useFakeTimers();
    const source = new PassThrough();
    const onTimeout = jest.fn();
    const result = pipeline(
      source,
      createIdleTimeoutTransform(25, onTimeout),
      new Writable({
        write(chunk, encoding, callback) {
          callback();
        },
      }),
    );

    source.write(Buffer.from([0x50, 0x4B]));
    await Promise.resolve();
    jest.advanceTimersByTime(26);

    await expect(result).rejects.toMatchObject({ code: 'REMOTE_STREAM_IDLE_TIMEOUT' });
    expect(onTimeout).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
