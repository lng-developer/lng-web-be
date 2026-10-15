const yauzl = require('yauzl');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { safeRemoteFetchStream, redactUrl } = require('../../../shared/network/safeRemoteFetchStream');
const authPublic = require('../../auth/public');
const mediaPublic = require('../../media/public');
const orderPublic = require('../../order/public');
const repository = require('../repositories/customizationPayload.repository');
const { customizationAssetTypes } = require('../constants/customizationAssetTypes');
const { customizationStatuses } = require('../constants/customizationStatuses');
const { customizationZipInspectionStatuses } = require('../constants/customizationZipInspectionStatuses');
const {
  DEFAULT_LIMITS,
  buildZipEntryManifestEntry,
  summarizeZipManifest,
} = require('../helpers/zipSafety.helper');

const ORDER_WRITE_PERMISSION = 'ORDERS:WRITE';
const SHOP_SCOPE_TYPE = 'shop';
const DEFAULT_REMOTE_ZIP_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const JSON_EXTENSION = '.json';
const MAX_JSON_BYTES = 1024 * 1024;

function appError(message, statusCode, code, details) {
  return new AppError(message, statusCode, true, code, details);
}

function notFound(message) {
  return appError(message, httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
}

function forbidden() {
  return appError('Forbidden', httpStatus.FORBIDDEN, errorCodes.AUTHORIZATION_ERROR);
}

function hasGlobalPermission(authContext, permission) {
  return Boolean(authContext && (authContext.permissions || []).includes(permission));
}

function assertCanAccessShop(shopId, permission, authContext) {
  if (!authContext || hasGlobalPermission(authContext, permission)) {
    return;
  }

  if (!authPublic.canAccessScope(authContext, permission, {
    scopeType: SHOP_SCOPE_TYPE,
    scopeId: shopId,
  })) {
    throw forbidden();
  }
}

function normalizeOptions(options = {}) {
  return {
    maxEntries: positiveInteger(options.maxEntries, DEFAULT_LIMITS.maxEntries),
    maxTotalUncompressedBytes: positiveInteger(
      options.maxTotalUncompressedBytes,
      DEFAULT_LIMITS.maxTotalUncompressedBytes,
    ),
    maxSingleEntryUncompressedBytes: positiveInteger(
      options.maxSingleEntryUncompressedBytes,
      DEFAULT_LIMITS.maxSingleEntryUncompressedBytes,
    ),
  };
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function findDownloadedZipAsset(assets = []) {
  return assets.find((asset) => (
    asset.type === customizationAssetTypes.CUSTOMIZED_URL
    && asset.status === customizationStatuses.DOWNLOADED
    && (asset.assetId || asset.sourceUrl)
  ));
}

function findZipUrlAsset(assets = []) {
  return assets.find((asset) => (
    asset.type === customizationAssetTypes.CUSTOMIZED_URL
    && asset.sourceUrl
  ));
}

function setInspectionMetadata(asset, patch) {
  return {
    ...asset,
    metadata: {
      ...(asset.metadata || {}),
      ...patch,
    },
  };
}

async function persistAsset(payload, targetAsset, updatedAsset) {
  const assets = (payload.assets || []).map((asset) => (
    asset === targetAsset
      || (
        String(asset.assetId || '') === String(targetAsset.assetId || '')
        && asset.type === targetAsset.type
        && asset.sourceUrl === targetAsset.sourceUrl
      )
      ? updatedAsset
      : asset
  ));
  const updatedPayload = await repository.updateAssets(payload._id, assets);

  if (!updatedPayload) {
    throw notFound('Customization payload not found');
  }

  return updatedPayload;
}

function openZip(localPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(localPath, { lazyEntries: true, validateEntrySizes: true }, (error, zipfile) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(zipfile);
    });
  });
}

function openZipReadStream(zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(stream);
    });
  });
}

async function inspectZipFile(localPath, mediaAsset, options) {
  const zipfile = await openZip(localPath);
  const entries = [];

  return new Promise((resolve, reject) => {
    let done = false;

    function finish() {
      if (done) return;
      done = true;
      zipfile.close();
      const summary = summarizeZipManifest(entries, options);
      const inspectedAt = new Date();

      resolve({
        ...summary,
        manifest: {
          inspectedAt,
          mediaAssetId: String(mediaAsset._id || mediaAsset.id),
          classification: 'zip',
          fileCount: summary.fileCount,
          directoryCount: summary.directoryCount,
          totalCompressedBytes: summary.totalCompressedBytes,
          totalUncompressedBytes: summary.totalUncompressedBytes,
          entries,
          warnings: summary.warnings,
          errors: summary.errors,
        },
      });
    }

    zipfile.on('entry', (entry) => {
      entries.push(buildZipEntryManifestEntry(entry, entries.length, options));

      if (entries.length > options.maxEntries) {
        finish();
        return;
      }

      zipfile.readEntry();
    });
    zipfile.once('end', finish);
    zipfile.once('error', reject);
    zipfile.readEntry();
  });
}

function imageMimeType(extension) {
  if (extension === '.png') return 'image/png';
  return 'image/jpeg';
}

function streamToString(stream, maxBytes = MAX_JSON_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    stream.on('data', (chunk) => {
      size += chunk.length;

      if (size > maxBytes) {
        stream.destroy(Object.assign(new Error('Customization JSON exceeded maxBytes'), {
          code: 'CUSTOMIZATION_JSON_TOO_LARGE',
        }));
        return;
      }

      chunks.push(chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

function walkCustomizationTree(value, visit) {
  if (Array.isArray(value)) {
    value.forEach((entry) => walkCustomizationTree(entry, visit));
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  visit(value);
  Object.values(value).forEach((entry) => walkCustomizationTree(entry, visit));
}

function compactList(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function positionValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') return String(value);
  return value.key || value.name || value.label || value.value || value.displayValue || null;
}

function normalizeSlotKey(value) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!normalized) return null;
  return /^[A-Z]/.test(normalized) ? normalized : `SLOT_${normalized}`;
}

function positionMetadata(node = {}) {
  const keys = ['position', 'placement', 'surface', 'side', 'printArea'];
  const positionRaw = keys.reduce((result, key) => {
    if (Object.prototype.hasOwnProperty.call(node, key) && node[key] !== undefined && node[key] !== null) {
      result[key] = node[key];
    }
    return result;
  }, {});
  const rawValues = Object.values(positionRaw);
  const rawValue = rawValues.map(positionValue).find(Boolean);
  const slotKey = normalizeSlotKey(rawValue);
  return slotKey ? { slotKey, positionRaw } : {};
}

function firstImageUrl(value) {
  let found = null;
  walkCustomizationTree(value, (node) => {
    if (found) return;
    const imageUrl = node.baseImage?.imageUrl
      || node.thumbnailImage?.imageUrl
      || node.optionSelection?.thumbnailImage?.imageUrl
      || null;
    if (/^https?:\/\//i.test(String(imageUrl || ''))) {
      found = imageUrl;
    }
  });
  return found;
}

function parseAmazonCustomizationJson(document, sourceJsonPath) {
  const texts = [];
  const options = [];
  const images = [];
  const listingPreviewImageUrl = firstImageUrl(document);

  walkCustomizationTree(document, (node) => {
    if (node.type === 'TextCustomization' && node.inputValue !== undefined) {
      texts.push({
        label: node.label || node.name || null,
        name: node.name || null,
        value: String(node.inputValue),
        ...positionMetadata(node),
      });
    }

    if (node.type === 'OptionCustomization') {
      const value = node.displayValue
        || node.optionSelection?.label
        || node.optionSelection?.name
        || null;

      if (value !== null) {
        options.push({
          label: node.label || node.name || null,
          name: node.name || null,
          value,
          ...positionMetadata(node),
        });
      }
    }

    if (node.type === 'ImageCustomization' && node.image?.imageName) {
      images.push({
        label: node.label || node.name || null,
        name: node.name || null,
        imageName: node.image.imageName,
        buyerFilename: node.image.buyerFilename || null,
        ...positionMetadata(node),
      });
    }

    if (node.customizationType === 'TextPrinting' && node.text !== undefined) {
      texts.push({
        label: node.label || node.name || null,
        name: node.name || null,
        value: String(node.text),
        ...positionMetadata(node),
      });
    }

    if (node.customizationType === 'Options' && node.optionValue !== undefined) {
      options.push({
        label: node.label || node.name || null,
        name: node.name || null,
        value: node.optionValue,
        ...positionMetadata(node),
      });
    }
  });

  return {
    sourceJsonPath,
    orderId: document.orderId || null,
    orderItemId: document.orderItemId || null,
    asin: document.asin || null,
    title: document.title || null,
    quantity: document.quantity ?? null,
    ...(listingPreviewImageUrl ? { listingPreviewImageUrl } : {}),
    texts: compactList(texts),
    options: compactList(options),
    images: compactList(images),
  };
}

function linkCustomerImages(customerInputs, extractedImages) {
  if (!customerInputs) return null;

  const byFilename = new Map((extractedImages || []).map((image) => [
    String(image.filename || image.normalizedPath || '').toLowerCase(),
    image,
  ]));

  return {
    ...customerInputs,
    images: (customerInputs.images || []).map((image) => {
      const extracted = byFilename.get(String(image.imageName || '').toLowerCase());

      if (!extracted) return image;

      return {
        ...image,
        assetId: extracted.assetId,
        provider: extracted.provider,
        providerAssetId: extracted.providerAssetId,
        resourceType: extracted.resourceType,
        secureUrl: extracted.secureUrl,
        mimeType: extracted.mimeType,
        size: extracted.size,
        sha256: extracted.sha256,
      };
    }),
  };
}

async function downloadZipToTempFile(sourceUrl, options) {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'customization-zip-'));
  const localPath = path.join(tempDir, 'source.zip');
  const { stream } = await safeRemoteFetchStream(sourceUrl, {
    timeoutMs: positiveInteger(options.timeoutMs, 15000),
    idleTimeoutMs: positiveInteger(options.idleTimeoutMs, 10000),
    maxBytes: positiveInteger(options.maxBytes, DEFAULT_REMOTE_ZIP_MAX_BYTES),
    maxRedirects: positiveInteger(options.maxRedirects, 3),
  });

  await pipeline(stream, fs.createWriteStream(localPath, { flags: 'wx' }));

  return {
    localPath,
    cleanup: async () => fs.promises.rm(tempDir, { recursive: true, force: true }),
  };
}

async function extractImagesFromZipFile(localPath, targetAsset) {
  const zipfile = await openZip(localPath);
  const extractedImages = [];
  const failedImages = [];
  const parsedJsonFiles = [];
  const failedJsonFiles = [];
  const existingImages = new Map(((targetAsset.metadata || {}).extractedImages || []).map((image) => [
    image.normalizedPath,
    image,
  ]));
  let skippedCount = 0;
  let failedCount = 0;

  return new Promise((resolve, reject) => {
    let done = false;

    async function finish() {
      if (done) return;
      done = true;
      zipfile.close();
      resolve({
        extractedImages,
        failedImages,
        parsedJsonFiles,
        failedJsonFiles,
        skippedCount,
        failedCount,
      });
    }

    zipfile.on('entry', async (entry) => {
      const entryManifest = buildZipEntryManifestEntry(entry, extractedImages.length + skippedCount + failedCount);
      const extension = entryManifest.extension;

      if (entryManifest.directory || !entryManifest.safe) {
        skippedCount += 1;
        zipfile.readEntry();
        return;
      }

      try {
        if (extension === JSON_EXTENSION) {
          const stream = await openZipReadStream(zipfile, entry);
          const text = await streamToString(stream);
          parsedJsonFiles.push({
            path: entryManifest.normalizedPath,
            data: parseAmazonCustomizationJson(JSON.parse(text), entryManifest.normalizedPath),
          });
          zipfile.readEntry();
          return;
        }

        if (!IMAGE_EXTENSIONS.has(extension)) {
          skippedCount += 1;
          zipfile.readEntry();
          return;
        }

        const existingImage = existingImages.get(entryManifest.normalizedPath);
        if (existingImage) {
          extractedImages.push(existingImage);
          zipfile.readEntry();
          return;
        }

        const stream = await openZipReadStream(zipfile, entry);
        const mediaAsset = await mediaPublic.storeAsset({
          stream,
          filename: entryManifest.filename,
          mimeType: imageMimeType(extension),
          sourceUrlRedacted: null,
          sourceUrlHash: null,
          metadata: {
            source: 'CUSTOMIZATION_ZIP_ENTRY',
            sourceZipAssetId: targetAsset.assetId ? String(targetAsset.assetId) : null,
            sourceZipUrlRedacted: redactUrl(targetAsset.sourceUrl),
            zipEntryPath: entryManifest.normalizedPath,
          },
        });
        extractedImages.push({
          index: entryManifest.index,
          originalPath: entryManifest.originalPath,
          normalizedPath: entryManifest.normalizedPath,
          filename: entryManifest.filename,
          extension,
          assetId: String(mediaAsset._id || mediaAsset.id),
          provider: mediaAsset.provider || null,
          providerAssetId: mediaAsset.providerAssetId || null,
          resourceType: mediaAsset.resourceType || null,
          secureUrl: mediaAsset.secureUrl || null,
          mimeType: mediaAsset.mimeType || imageMimeType(extension),
          size: mediaAsset.size,
          sha256: mediaAsset.sha256,
        });
      } catch (error) {
        failedCount += 1;
        failedImages.push({
          index: entryManifest.index,
          originalPath: entryManifest.originalPath,
          normalizedPath: entryManifest.normalizedPath,
          filename: entryManifest.filename,
          extension,
          errorCode: error.code || 'ZIP_IMAGE_EXTRACT_FAILED',
          errorMessage: error.message,
        });

        if (extension === JSON_EXTENSION) {
          failedJsonFiles.push({
            path: entryManifest.normalizedPath,
            errorCode: error.code || 'CUSTOMIZATION_JSON_PARSE_FAILED',
            errorMessage: error.message,
          });
        }
      }

      zipfile.readEntry();
    });
    zipfile.once('end', finish);
    zipfile.once('error', reject);
    zipfile.readEntry();
  });
}

async function loadPayloadByOrderItem(orderItemId) {
  const payload = await repository.findByOrderItem(orderItemId);

  if (!payload) {
    throw notFound('Customization payload not found');
  }

  return payload;
}

async function loadPayloadById(payloadId) {
  const payload = await repository.findById(payloadId);

  if (!payload) {
    throw notFound('Customization payload not found');
  }

  return payload;
}

function buildFailureResult(payload, asset, error, updatedPayload) {
  return {
    payloadId: String(payload._id),
    inspectedAssetId: asset.assetId ? String(asset.assetId) : null,
    zipInspectionStatus: customizationZipInspectionStatuses.FAILED,
    fileCount: 0,
    totalUncompressedBytes: 0,
    entries: [],
    warnings: [],
    errors: ['ZIP_OPEN_FAILED'],
    errorCode: 'ZIP_OPEN_FAILED',
    errorMessage: error.message,
    payload: updatedPayload,
  };
}

async function inspectTargetAsset(targetAsset, normalizedOptions) {
  if (targetAsset.assetId) {
    return mediaPublic.withAssetLocalReadFile(targetAsset.assetId, async ({ localPath, mediaAsset }) => (
      inspectZipFile(localPath, mediaAsset, normalizedOptions)
    ));
  }

  const temp = await downloadZipToTempFile(targetAsset.sourceUrl, normalizedOptions);
  try {
    return inspectZipFile(temp.localPath, { _id: null, id: null }, normalizedOptions);
  } finally {
    await temp.cleanup();
  }
}

async function inspectPayload(payload, options, authContext) {
  assertCanAccessShop(payload.shopId, ORDER_WRITE_PERMISSION, authContext);
  const normalizedOptions = normalizeOptions(options);
  const targetAsset = findDownloadedZipAsset(payload.assets);

  if (!targetAsset) {
    throw notFound('Downloaded ZIP customization asset not found');
  }

  try {
    const inspected = await inspectTargetAsset(targetAsset, normalizedOptions);
    const updatedAsset = setInspectionMetadata(targetAsset, {
      zipInspectionStatus: inspected.status,
      zipInspectedAt: inspected.manifest.inspectedAt,
      zipInspectionErrorCode: null,
      zipInspectionErrorMessage: null,
      zipManifest: inspected.manifest,
    });
    const updatedPayload = await persistAsset(payload, targetAsset, updatedAsset);

    return {
      payloadId: String(payload._id),
      inspectedAssetId: String(targetAsset.assetId),
      zipInspectionStatus: inspected.status,
      fileCount: inspected.fileCount,
      totalUncompressedBytes: inspected.totalUncompressedBytes,
      entries: inspected.manifest.entries,
      warnings: inspected.warnings,
      errors: inspected.errors,
      payload: updatedPayload,
    };
  } catch (error) {
    const inspectedAt = new Date();
    const updatedAsset = setInspectionMetadata(targetAsset, {
      zipInspectionStatus: customizationZipInspectionStatuses.FAILED,
      zipInspectedAt: inspectedAt,
      zipInspectionErrorCode: 'ZIP_OPEN_FAILED',
      zipInspectionErrorMessage: error.message,
      zipManifest: {
        inspectedAt,
        mediaAssetId: targetAsset.assetId ? String(targetAsset.assetId) : null,
        classification: 'zip',
        fileCount: 0,
        directoryCount: 0,
        totalCompressedBytes: 0,
        totalUncompressedBytes: 0,
        entries: [],
        warnings: [],
        errors: ['ZIP_OPEN_FAILED'],
      },
    });
    const updatedPayload = await persistAsset(payload, targetAsset, updatedAsset);

    return buildFailureResult(payload, targetAsset, error, updatedPayload);
  }
}

function mergeExtractedImagesIntoManifest(zipManifest, extractedImages) {
  if (!zipManifest || !Array.isArray(zipManifest.entries)) {
    return zipManifest;
  }

  const byPath = new Map(extractedImages.map((image) => [image.normalizedPath, image]));

  return {
    ...zipManifest,
    entries: zipManifest.entries.map((entry) => {
      const extracted = byPath.get(entry.normalizedPath);

      if (!extracted) return entry;

      return {
        ...entry,
        extractedAssetId: extracted.assetId,
        extractedProvider: extracted.provider,
        extractedProviderAssetId: extracted.providerAssetId,
        extractedAt: new Date(),
      };
    }),
  };
}

function buildParsedDataWithCustomerInputs(payload, result) {
  const existingParsedData = payload.parsedData || {};
  const amazonCustomization = existingParsedData.amazonCustomization || {};
  const customerInputs = result.parsedJsonFiles[0]
    ? linkCustomerImages(result.parsedJsonFiles[0].data, result.extractedImages)
    : null;

  return {
    ...existingParsedData,
    amazonCustomization: {
      ...amazonCustomization,
      ...(customerInputs ? { customerInputs } : {}),
      zipJsonFiles: result.parsedJsonFiles.map((entry) => entry.path),
      zipJsonParseErrors: result.failedJsonFiles,
    },
  };
}

async function syncOrderItemAsin(orderItemId, customerInputs) {
  const asin = String(customerInputs?.asin || '').trim();
  if (!asin) return;

  const item = await orderPublic.findItemById(orderItemId);
  if (!item?.asin) await orderPublic.updateItemAsin(orderItemId, asin);
}

async function extractImagesForPayload(payload, options = {}, authContext) {
  assertCanAccessShop(payload.shopId, ORDER_WRITE_PERMISSION, authContext);
  const targetAsset = findZipUrlAsset(payload.assets);

  if (!targetAsset) {
    throw notFound('Customization ZIP URL asset not found');
  }

  const temp = await downloadZipToTempFile(targetAsset.sourceUrl, options);

  try {
    const result = await extractImagesFromZipFile(temp.localPath, targetAsset);
    const extractedAt = new Date();
    const updatedAsset = setInspectionMetadata(targetAsset, {
      zipImageExtractionStatus: result.failedCount > 0 ? 'PARTIAL_FAILED' : 'EXTRACTED',
      zipImageExtractedAt: extractedAt,
      zipImageExtractionErrorCode: result.failedCount > 0 ? 'ZIP_IMAGE_EXTRACT_PARTIAL_FAILED' : null,
      extractedImages: result.extractedImages,
      failedImages: result.failedImages,
      zipManifest: mergeExtractedImagesIntoManifest(
        targetAsset.metadata && targetAsset.metadata.zipManifest,
        result.extractedImages,
      ),
    });
    const assets = (payload.assets || []).map((asset) => (
      asset === targetAsset
        || (
          String(asset.assetId || '') === String(targetAsset.assetId || '')
          && asset.type === targetAsset.type
          && asset.sourceUrl === targetAsset.sourceUrl
        )
        ? updatedAsset
        : asset
    ));
    const updatedPayload = await repository.updateParsedData(
      payload._id,
      buildParsedDataWithCustomerInputs(payload, result),
      { assets },
    );

    if (!updatedPayload) {
      throw notFound('Customization payload not found');
    }

    await syncOrderItemAsin(
      payload.orderItemId,
      updatedPayload.parsedData?.amazonCustomization?.customerInputs,
    );
    await require('./customizationPayload.service').syncWorkbenchCustomization(updatedPayload);

    return {
      payloadId: String(payload._id),
      sourceAssetId: targetAsset.assetId ? String(targetAsset.assetId) : null,
      extractedCount: result.extractedImages.length,
      skippedCount: result.skippedCount,
      failedCount: result.failedCount,
      extractedImages: result.extractedImages,
      failedImages: result.failedImages,
      payload: updatedPayload,
    };
  } finally {
    await temp.cleanup();
  }
}

async function extractZipImagesForOrderItem(orderItemId, options = {}, authContext) {
  const payload = await loadPayloadByOrderItem(orderItemId);
  return extractImagesForPayload(payload, options, authContext);
}

async function extractZipImagesForPayload(payloadId, options = {}, authContext) {
  const payload = await loadPayloadById(payloadId);
  return extractImagesForPayload(payload, options, authContext);
}

async function inspectDownloadedZipForOrderItem(orderItemId, options = {}, authContext) {
  const payload = await loadPayloadByOrderItem(orderItemId);
  return inspectPayload(payload, options, authContext);
}

async function inspectDownloadedZipForPayload(payloadId, options = {}, authContext) {
  const payload = await loadPayloadById(payloadId);
  return inspectPayload(payload, options, authContext);
}

module.exports = {
  inspectDownloadedZipForOrderItem,
  inspectDownloadedZipForPayload,
  extractZipImagesForOrderItem,
  extractZipImagesForPayload,
};
