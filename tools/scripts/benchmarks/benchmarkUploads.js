const crypto = require('crypto');
const { performance } = require('perf_hooks');
const mongoose = require('mongoose');
const createApp = require('../../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const listingRepository = require('../../../src/modules/catalog/repositories/listing.repository');
const mediaPublic = require('../../../src/modules/media/public');
const { FIXTURE_SIZES, runUploadBenchmark } = require('./uploadBenchmark');

function validatePreflight({ identifier, password, databaseName, provider }) {
  if (!identifier) throw new Error('UPLOAD_BENCHMARK_IDENTIFIER is required');
  if (!password) throw new Error('UPLOAD_BENCHMARK_PASSWORD is required');
  if (databaseName !== 'lng_web_be') throw new Error(`Upload benchmark requires database lng_web_be, received ${databaseName}`);
  if (provider !== 'cloudinary') throw new Error(`Upload benchmark requires cloudinary, received ${provider}`);
  return true;
}

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    throw new Error(`HTTP ${response.status}: ${body.message || 'request failed'}`);
  }
  return body.data;
}

async function main({
  identifier = process.env.UPLOAD_BENCHMARK_IDENTIFIER,
  password = process.env.UPLOAD_BENCHMARK_PASSWORD,
  listingId = process.env.UPLOAD_BENCHMARK_LISTING_ID,
  sizes = FIXTURE_SIZES,
  sampleCount = 3,
  output = console.log,
} = {}) {
  let server;
  await connectDatabase();
  try {
    validatePreflight({
      identifier,
      password,
      databaseName: mongoose.connection.name,
      provider: mediaPublic.getStorageProvider(),
    });

    server = await new Promise((resolve, reject) => {
      const listener = createApp().listen(0, '127.0.0.1', () => resolve(listener));
      listener.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    const session = await readJson(loginResponse);
    const token = session.accessToken;
    if (!token) throw new Error('Benchmark login returned no access token');

    if (!listingId) {
      const response = await fetch(`${baseUrl}/api/catalog/listings?limit=1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await readJson(response);
      listingId = data.items?.[0]?.id;
    }
    if (!listingId) throw new Error('No accessible benchmark listing found');

    const originalListing = await listingRepository.findById(listingId);
    if (!originalListing) throw new Error('Benchmark listing does not exist');
    const originalState = {
      psdTemplateAssetId: originalListing.psdTemplateAssetId || null,
      psdStatus: originalListing.psdStatus,
    };
    const runId = crypto.randomUUID();

    async function upload(endpoint, { label, buffer, measured, sample = 0 }) {
      const filename = `upload-benchmark-${runId}-${endpoint}-${label}-${measured ? sample : 'warm'}.psd`;
      const form = new FormData();
      form.append('file', new Blob([buffer], { type: 'application/octet-stream' }), filename);
      const startedAt = performance.now();
      const response = await fetch(endpoint === 'media'
        ? `${baseUrl}/api/media/assets`
        : `${baseUrl}/api/catalog/listings/${listingId}/psd-template`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await readJson(response);
      const durationMs = performance.now() - startedAt;
      const assetId = endpoint === 'media'
        ? data.id
        : (await listingRepository.findById(listingId))?.psdTemplateAssetId;
      const asset = await mediaPublic.getAsset(assetId);
      if (!asset || asset.originalFilename !== filename) throw new Error('Uploaded benchmark asset could not be verified');
      return { durationMs, asset: { id: String(asset._id || asset.id), metadata: asset.metadata || {} } };
    }

    const report = await runUploadBenchmark({
      sizes,
      sampleCount,
      uploadMedia: (input) => upload('media', input),
      uploadListing: (input) => upload('listing', input),
      restoreListing: () => listingRepository.update(listingId, originalState),
      cleanup: ({ id, metadata }) => mediaPublic.discardUnattachedAsset(
        id, metadata, 'LOCAL_UPLOAD_BENCHMARK_COMPLETE',
      ),
    });

    const result = {
      database: mongoose.connection.name,
      provider: mediaPublic.getStorageProvider(),
      listingId: String(listingId),
      originalState: {
        psdTemplateAssetId: originalState.psdTemplateAssetId ? String(originalState.psdTemplateAssetId) : null,
        psdStatus: originalState.psdStatus,
      },
      ...report,
    };
    output(JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      error: error.message,
      code: error.code || null,
      orphanAssetIds: error.orphanAssetIds || [],
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, validatePreflight };
