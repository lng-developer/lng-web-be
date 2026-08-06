const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const repository = require('../repositories/mediaAsset.repository');
const wasabi = require('../services/wasabiStorage.service');

async function cleanupMultipartUploads({ limit = 100, now = new Date() } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('limit must be between 1 and 500');
  const assets = await repository.findExpiredUploads(now, limit);
  let aborted = 0;
  let failed = 0;
  for (const asset of assets) {
    try {
      await wasabi.abortMultipartUpload({
        key: asset.providerAssetId,
        uploadId: asset.metadata.multipartUploadId,
      });
      await repository.transitionUploadStatus(asset._id, 'UPLOADING', 'ABORTED', {
        'metadata.abortedAt': now,
        'metadata.abortReason': 'EXPIRED',
      });
      aborted += 1;
    } catch (_error) {
      failed += 1;
    }
  }
  return { selected: assets.length, aborted, failed };
}

async function main() {
  const rawLimit = process.argv.find((value) => value.startsWith('--limit='))?.split('=')[1];
  const limit = rawLimit === undefined ? 100 : Number(rawLimit);
  await connectDatabase();
  try {
    console.log(JSON.stringify(await cleanupMultipartUploads({ limit })));
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { cleanupMultipartUploads };
