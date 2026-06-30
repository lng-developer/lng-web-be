const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const net = require('net');
const { PassThrough, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_IDLE_TIMEOUT_MS = 10000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const PEEK_BYTES = 512;
const OUTPUT_BYTES = 32;

function streamError(message, code) {
  return Object.assign(new Error(message), { code });
}

function streamErrorWithDetails(message, code, details) {
  return Object.assign(streamError(message, code), { details });
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    const pathLabel = url.pathname && url.pathname !== '/' ? '/[REDACTED_PATH]' : '';
    return `${url.protocol}//${url.host}${pathLabel}${url.search ? '?[REDACTED]' : ''}`;
  } catch (error) {
    return '[INVALID_URL]';
  }
}

function isUnsafeIp(ip) {
  if (!ip) return true;

  const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const version = net.isIP(normalized);

  if (version === 4) {
    const [a, b] = normalized.split('.').map((part) => Number(part));

    return (
      a === 0
      || a === 10
      || a === 127
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)
    );
  }

  if (version === 6) {
    const lower = normalized.toLowerCase();
    return lower === '::1'
      || lower.startsWith('fe80:')
      || lower.startsWith('fc')
      || lower.startsWith('fd');
  }

  return true;
}

async function validateSafeUrl(value) {
  let url;

  try {
    url = new URL(value);
  } catch (error) {
    throw streamError('Invalid URL', 'REMOTE_INVALID_URL');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw streamError('Unsupported protocol', 'REMOTE_UNSUPPORTED_PROTOCOL');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)]$/, '$1');

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw streamError('Unsafe hostname', 'REMOTE_UNSAFE_HOST');
  }

  if (net.isIP(hostname)) {
    if (isUnsafeIp(hostname)) {
      throw streamError('Unsafe IP address', 'REMOTE_UNSAFE_IP');
    }

    return url;
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: false });
  } catch (error) {
    throw streamError('Unable to resolve hostname', 'REMOTE_DNS_LOOKUP_FAILED');
  }

  if (addresses.some((entry) => isUnsafeIp(entry.address))) {
    throw streamError('Unsafe resolved IP address', 'REMOTE_UNSAFE_IP');
  }

  return url;
}

function startsWithBytes(buffer, bytes) {
  return bytes.every((byte, index) => buffer[index] === byte);
}

function looksLikeHtml(firstBytes) {
  const sample = firstBytes.toString('utf8').trimStart().toLowerCase();
  return sample.startsWith('<!doctype html')
    || sample.startsWith('<html')
    || sample.startsWith('<head')
    || sample.startsWith('<body');
}

function looksLikeLogin(firstBytes) {
  const sample = firstBytes.toString('utf8').toLowerCase();
  return sample.includes('sign-in')
    || sample.includes('signin')
    || sample.includes('login')
    || sample.includes('ap_signin')
    || sample.includes('authentication required');
}

function classifyResponse({
  statusCode,
  contentType,
  firstBytes = Buffer.alloc(0),
  oversized = false,
}) {
  if (oversized) return 'oversized';
  if (statusCode === 401 || statusCode === 403) return 'forbidden';

  const normalizedContentType = String(contentType || '').toLowerCase();
  const isHtml = normalizedContentType.includes('text/html') || looksLikeHtml(firstBytes);

  if (isHtml) {
    return looksLikeLogin(firstBytes) ? 'login' : 'html';
  }

  if (startsWithBytes(firstBytes, [0x50, 0x4B])) return 'zip';
  if (startsWithBytes(firstBytes, [0x89, 0x50, 0x4E, 0x47])) return 'png';
  if (startsWithBytes(firstBytes, [0xFF, 0xD8, 0xFF])) return 'jpeg';
  if (startsWithBytes(firstBytes, [0x25, 0x50, 0x44, 0x46])) return 'pdf';

  if (
    statusCode >= 200
    && statusCode < 300
    && firstBytes.length > 0
    && !normalizedContentType.startsWith('text/')
  ) {
    return 'binary';
  }

  return 'unknown';
}

function toHex(buffer) {
  if (!buffer || buffer.length === 0) return null;

  return buffer
    .subarray(0, OUTPUT_BYTES)
    .toString('hex')
    .match(/.{1,2}/g)
    .join(' ')
    .toUpperCase();
}

function isDownloadableClassification(classification) {
  return ['zip', 'png', 'jpeg', 'pdf', 'binary'].includes(classification);
}

function createByteLimitTransform(maxBytes = DEFAULT_MAX_BYTES) {
  let bytesRead = 0;

  return new Transform({
    transform(chunk, encoding, callback) {
      bytesRead += chunk.length;

      if (bytesRead > maxBytes) {
        callback(streamError('Response exceeded maxBytes', 'REMOTE_STREAM_TOO_LARGE'));
        return;
      }

      callback(null, chunk);
    },
  });
}

function createIdleTimeoutTransform(idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS, onTimeout) {
  let timer = null;

  const transform = new Transform({
    transform(chunk, encoding, callback) {
      resetTimer();
      callback(null, chunk);
    },
    flush(callback) {
      clearTimer();
      callback();
    },
    destroy(error, callback) {
      clearTimer();
      callback(error);
    },
  });

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function resetTimer() {
    clearTimer();
    timer = setTimeout(() => {
      const error = streamError('Remote stream idle timeout', 'REMOTE_STREAM_IDLE_TIMEOUT');
      if (onTimeout) {
        onTimeout(error);
      }
      transform.destroy(error);
    }, idleTimeoutMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  resetTimer();

  return transform;
}

function createPeekClassificationTransform({
  statusCode,
  contentType,
  peekBytes = PEEK_BYTES,
  onClassified,
} = {}) {
  const chunks = [];
  let bytesCaptured = 0;
  let classified = false;

  function classify(callback) {
    if (classified) return true;

    const firstBytes = Buffer.concat(chunks).subarray(0, peekBytes);
    const classification = classifyResponse({ statusCode, contentType, firstBytes });
    const result = {
      classification,
      firstBytes,
      firstBytesHex: toHex(firstBytes),
    };

    if (onClassified) {
      onClassified(result);
    }

    classified = true;

    if (!isDownloadableClassification(classification)) {
      callback(streamError('Remote response is not a downloadable asset', 'REMOTE_RESPONSE_NOT_DOWNLOADABLE'));
      return false;
    }

    return true;
  }

  return new Transform({
    transform(chunk, encoding, callback) {
      if (bytesCaptured < peekBytes) {
        const slice = chunk.subarray(0, peekBytes - bytesCaptured);
        chunks.push(slice);
        bytesCaptured += slice.length;
      }

      const contentTypeLooksHtml = String(contentType || '').toLowerCase().includes('text/html');
      const shouldClassifyNow = bytesCaptured >= peekBytes
        || contentTypeLooksHtml
        || statusCode === 401
        || statusCode === 403;

      if (shouldClassifyNow && !classify(callback)) {
        return;
      }

      callback(null, chunk);
    },
    flush(callback) {
      if (!classify(callback)) {
        return;
      }

      callback();
    },
  });
}

function parseNumberOption(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function requestOnce(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    let request;
    request = transport.request(url, {
      method: 'GET',
      headers: {
        Accept: '*/*',
        'User-Agent': 'lng-web-be-customization-download/1.0',
      },
    }, (response) => {
      resolve({ response, request });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(streamError('Request timed out', 'REMOTE_TIMEOUT'));
    });

    request.on('error', reject);
    request.end();
  });
}

async function safeRemoteFetchStream(rawUrl, options = {}) {
  const timeoutMs = parseNumberOption(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const idleTimeoutMs = parseNumberOption(options.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS);
  const maxBytes = parseNumberOption(options.maxBytes, DEFAULT_MAX_BYTES);
  const maxRedirects = parseNumberOption(options.maxRedirects, DEFAULT_MAX_REDIRECTS);
  const redirects = [];
  let currentUrl = await validateSafeUrl(rawUrl);

  for (let attempt = 0; attempt <= maxRedirects; attempt += 1) {
    const { response, request } = await requestOnce(currentUrl, timeoutMs);
    const statusCode = response.statusCode || null;
    const location = response.headers.location;
    const contentType = response.headers['content-type'] || null;
    const contentLength = response.headers['content-length'] ? Number(response.headers['content-length']) : null;

    if (statusCode >= 300 && statusCode < 400 && location) {
      if (attempt === maxRedirects) {
        response.resume();
        throw streamError('Maximum redirects exceeded', 'REMOTE_TOO_MANY_REDIRECTS');
      }

      const nextUrl = new URL(location, currentUrl);
      await validateSafeUrl(nextUrl.toString());
      redirects.push(redactUrl(nextUrl.toString()));
      response.resume();
      currentUrl = nextUrl;
      continue;
    }

    if (statusCode < 200 || statusCode >= 300) {
      response.resume();
      throw streamErrorWithDetails(`Remote responded with HTTP ${statusCode}`, 'REMOTE_BAD_STATUS', {
        statusCode,
        finalUrlRedacted: redactUrl(currentUrl.toString()),
        redirects,
        contentType,
        contentLength,
        classification: classifyResponse({ statusCode, contentType }),
        firstBytesHex: null,
      });
    }

    if (contentLength !== null && contentLength > maxBytes) {
      response.resume();
      throw streamErrorWithDetails('Response exceeded maxBytes', 'REMOTE_STREAM_TOO_LARGE', {
        statusCode,
        finalUrlRedacted: redactUrl(currentUrl.toString()),
        redirects,
        contentType,
        contentLength,
        classification: 'oversized',
        firstBytesHex: null,
      });
    }

    const metadata = {
      statusCode,
      finalUrlRedacted: redactUrl(currentUrl.toString()),
      redirects,
      contentType,
      contentLength,
      classification: null,
      firstBytesHex: null,
    };
    const stream = new PassThrough();
    const classifyTransform = createPeekClassificationTransform({
      statusCode,
      contentType,
      onClassified: (result) => {
        metadata.classification = result.classification;
        metadata.firstBytesHex = result.firstBytesHex;
      },
    });

    pipeline(
      response,
      createIdleTimeoutTransform(idleTimeoutMs, (error) => {
        request.destroy(error);
        response.destroy(error);
      }),
      createByteLimitTransform(maxBytes),
      classifyTransform,
      stream,
    ).catch((error) => {
      stream.destroy(error);
    });

    return { stream, metadata };
  }

  throw streamError('Unexpected redirect state', 'REMOTE_UNEXPECTED_STATE');
}

module.exports = {
  safeRemoteFetchStream,
  redactUrl,
  validateSafeUrl,
  classifyResponse,
  createByteLimitTransform,
  createIdleTimeoutTransform,
  createPeekClassificationTransform,
  parseNumberOption,
  toHex,
};
