const { Writable } = require('stream');
const { pipeline } = require('stream/promises');
const {
  safeRemoteFetchStream,
  redactUrl,
  validateSafeUrl,
  classifyResponse,
  createByteLimitTransform,
  createPeekClassificationTransform,
  parseNumberOption,
} = require('../../../src/shared/network/safeRemoteFetchStream');

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_IDLE_TIMEOUT_MS = 10000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;

function parseArgs(argv) {
  const args = {};

  argv.forEach((arg) => {
    if (!arg.startsWith('--')) return;
    const separator = arg.indexOf('=');
    if (separator === -1) {
      args[arg.slice(2)] = true;
      return;
    }
    args[arg.slice(2, separator)] = arg.slice(separator + 1);
  });

  return {
    url: args.url,
    timeoutMs: parseNumberOption(args.timeoutMs, DEFAULT_TIMEOUT_MS),
    idleTimeoutMs: parseNumberOption(args.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS),
    maxBytes: parseNumberOption(args.maxBytes, DEFAULT_MAX_BYTES),
    maxRedirects: parseNumberOption(args.maxRedirects, DEFAULT_MAX_REDIRECTS),
  };
}

function emptySummary(reason, classification = 'unknown') {
  return {
    ok: false,
    classification,
    statusCode: null,
    finalUrl: null,
    redirects: [],
    contentType: null,
    contentLength: null,
    firstBytesHex: null,
    reason,
  };
}

function summaryFromError(error) {
  const details = error.details || {};
  const classification = details.classification
    || (error.code === 'REMOTE_TIMEOUT'
      ? 'timeout'
      : error.code === 'REMOTE_STREAM_TOO_LARGE'
        ? 'oversized'
        : 'unknown');

  return {
    ok: false,
    classification,
    statusCode: details.statusCode || null,
    finalUrl: details.finalUrlRedacted || null,
    redirects: details.redirects || [],
    contentType: details.contentType || null,
    contentLength: details.contentLength || null,
    firstBytesHex: details.firstBytesHex || null,
    reason: error.message,
  };
}

async function checkCustomizedUrlAccess(rawUrl, options = {}) {
  try {
    const { stream, metadata } = await safeRemoteFetchStream(rawUrl, options);
    await pipeline(
      stream,
      new Writable({
        write(chunk, encoding, callback) {
          callback();
        },
      }),
    );

    return {
      ok: true,
      classification: metadata.classification,
      statusCode: metadata.statusCode,
      finalUrl: metadata.finalUrlRedacted,
      redirects: metadata.redirects,
      contentType: metadata.contentType,
      contentLength: metadata.contentLength,
      firstBytesHex: metadata.firstBytesHex,
      reason: null,
    };
  } catch (error) {
    return summaryFromError(error);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.url) {
    process.stdout.write(`${JSON.stringify(emptySummary('Missing required --url argument'), null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const result = await checkCustomizedUrlAccess(options.url, options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  checkCustomizedUrlAccess,
  parseArgs,
  redactUrl,
  validateSafeUrl,
  classifyResponse,
  createByteLimitTransform,
  createPeekClassificationTransform,
};
