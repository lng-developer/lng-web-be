const crypto = require('crypto');

const MIB = 1024 * 1024;
const FIXTURE_SIZES = [
  { label: '1MiB', bytes: MIB },
  { label: '5MiB', bytes: 5 * MIB },
  { label: '9MiB', bytes: 9 * MIB },
];

function createFixtureBuffer(bytes, seed = 'upload-benchmark') {
  if (!Number.isInteger(bytes) || bytes <= 0) throw new TypeError('bytes must be a positive integer');
  const output = Buffer.allocUnsafe(bytes);
  for (let offset = 0, chunk = 0; offset < bytes; chunk += 1) {
    const digest = crypto.createHash('sha256').update(`${seed}:${chunk}`).digest();
    digest.copy(output, offset, 0, Math.min(digest.length, bytes - offset));
    offset += digest.length;
  }
  return output;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function summarizeSamples(samples, bytes) {
  if (!Array.isArray(samples) || samples.length === 0) throw new TypeError('samples must not be empty');
  if (!Number.isFinite(bytes) || bytes <= 0) throw new TypeError('bytes must be positive');
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  return {
    count: sorted.length,
    medianMs: round(median),
    p95Ms: round(p95),
    throughputMiBPerSecond: round((bytes / MIB) / (median / 1000)),
    variationPercent: round(((sorted.at(-1) - sorted[0]) / median) * 100),
  };
}

function classifyBottleneck(mediaSummary, listingSummary) {
  const incrementalMs = round(listingSummary.medianMs - mediaSummary.medianMs);
  const incrementalPercent = round((incrementalMs / mediaSummary.medianMs) * 100);
  let decision = 'storage-network';
  if (mediaSummary.variationPercent > 20 || listingSummary.variationPercent > 20) {
    decision = 'increase-samples';
  } else if (incrementalMs >= 500 || incrementalPercent >= 20) {
    decision = 'post-actions';
  }
  return { incrementalMs, incrementalPercent, decision };
}

async function runUploadBenchmark({
  sizes = FIXTURE_SIZES,
  sampleCount = 3,
  uploadMedia,
  uploadListing,
  restoreListing,
  cleanup,
}) {
  const assets = [];
  const results = [];
  let runError = null;

  async function upload(fn, input) {
    const result = await fn(input);
    if (!result?.asset?.id || !Number.isFinite(result.durationMs)) {
      throw new Error('Upload result must include durationMs and asset.id');
    }
    assets.push(result.asset);
    return result.durationMs;
  }

  try {
    const warmBuffer = createFixtureBuffer(sizes[0].bytes, `warm:${sizes[0].label}`);
    await upload(uploadMedia, { ...sizes[0], buffer: warmBuffer, measured: false });
    await upload(uploadListing, { ...sizes[0], buffer: warmBuffer, measured: false });

    for (const size of sizes) {
      const buffer = createFixtureBuffer(size.bytes, `measure:${size.label}`);
      const mediaSamples = [];
      const listingSamples = [];
      for (let sample = 0; sample < sampleCount; sample += 1) {
        mediaSamples.push(await upload(uploadMedia, { ...size, buffer, measured: true, sample }));
        listingSamples.push(await upload(uploadListing, { ...size, buffer, measured: true, sample }));
      }
      const media = summarizeSamples(mediaSamples, size.bytes);
      const listing = summarizeSamples(listingSamples, size.bytes);
      results.push({ ...size, media, listing, decision: classifyBottleneck(media, listing) });
    }
  } catch (error) {
    runError = error;
  }

  try {
    await restoreListing();
    for (let index = assets.length - 1; index >= 0; index -= 1) {
      try {
        await cleanup(assets[index]);
      } catch (cause) {
        const error = new Error(`Upload benchmark cleanup failed: ${cause.message}`);
        error.code = 'UPLOAD_BENCHMARK_CLEANUP_FAILED';
        error.cause = cause;
        error.orphanAssetIds = assets.slice(0, index + 1).reverse().map(({ id }) => id);
        throw error;
      }
    }
  } catch (cleanupError) {
    if (cleanupError.code === 'UPLOAD_BENCHMARK_CLEANUP_FAILED') throw cleanupError;
    const error = new Error(`Upload benchmark restoration failed: ${cleanupError.message}`);
    error.code = 'UPLOAD_BENCHMARK_RESTORE_FAILED';
    error.cause = cleanupError;
    error.orphanAssetIds = assets.map(({ id }) => id);
    throw error;
  }

  if (runError) throw runError;
  return { results, assetIds: assets.map(({ id }) => id) };
}

module.exports = {
  FIXTURE_SIZES,
  classifyBottleneck,
  createFixtureBuffer,
  runUploadBenchmark,
  summarizeSamples,
};
