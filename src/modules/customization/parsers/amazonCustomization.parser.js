const { customizationStatuses } = require('../constants/customizationStatuses');
const { customizationErrorCodes } = require('../constants/customizationErrorCodes');
const { customizationAssetTypes } = require('../constants/customizationAssetTypes');

function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
}

function buildParsedData({ hasCustomization, customizedUrl, customizedPage, itemExtensionsData }) {
  return {
    amazonCustomization: {
      hasCustomization,
      customizedUrl,
      customizedPage,
      itemExtensionsData,
    },
  };
}

function isAllowedUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function needsReview(parsedData, errorCode, errorMessage) {
  return {
    outcome: customizationStatuses.NEEDS_REVIEW,
    assets: [],
    parsedData,
    errorCode,
    errorMessage,
  };
}

function addAsset(assets, seen, { type, sourceUrl }) {
  if (!sourceUrl) return;

  const key = `${type}:${sourceUrl}`;
  if (seen.has(key)) return;
  seen.add(key);
  assets.push({
    type,
    sourceUrl,
    status: customizationStatuses.PENDING,
    metadata: {},
  });
}

function normalizeAmazonCustomization(rawCustomization = {}) {
  const customizedUrl = normalizeString(rawCustomization.customizedUrl);
  const customizedPage = normalizeString(rawCustomization.customizedPage);
  const itemExtensionsData = normalizeString(rawCustomization.itemExtensionsData);
  const hasEvidence = Boolean(customizedUrl || customizedPage || itemExtensionsData);
  const rawHasCustomization = rawCustomization.hasCustomization;
  const hasCustomization = rawHasCustomization === false ? false : Boolean(rawHasCustomization || hasEvidence);
  const parsedData = buildParsedData({
    hasCustomization,
    customizedUrl,
    customizedPage,
    itemExtensionsData,
  });

  if (!hasEvidence) {
    return needsReview(
      parsedData,
      customizationErrorCodes.MANUAL_REVIEW_REQUIRED,
      'No customization evidence found',
    );
  }

  if (rawHasCustomization === false && hasEvidence) {
    return needsReview(
      parsedData,
      customizationErrorCodes.MANUAL_REVIEW_REQUIRED,
      'rawCustomization.hasCustomization conflicts with customization evidence',
    );
  }

  const invalidUrl = [customizedUrl, customizedPage].filter(Boolean).find((url) => !isAllowedUrl(url));
  if (invalidUrl) {
    return needsReview(
      parsedData,
      customizationErrorCodes.INVALID_RAW_CUSTOMIZATION,
      `Unsupported or invalid customization URL: ${invalidUrl}`,
    );
  }

  const assets = [];
  const seenAssets = new Set();
  addAsset(assets, seenAssets, { type: customizationAssetTypes.CUSTOMIZED_URL, sourceUrl: customizedUrl });
  addAsset(assets, seenAssets, { type: customizationAssetTypes.CUSTOMIZED_PAGE, sourceUrl: customizedPage });

  return {
    outcome: customizationStatuses.PARSED,
    assets,
    parsedData,
    errorCode: null,
    errorMessage: null,
  };
}

module.exports = {
  normalizeAmazonCustomization,
};
